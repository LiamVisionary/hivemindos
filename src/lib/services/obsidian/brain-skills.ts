import { constants } from "fs";
import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { homedir } from "os";
import { basename, dirname, join, relative, resolve } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { cachedCall } from "@/lib/services/async-cache";
import {
  auditSkillDirectory,
  auditSkillInput,
  createSkillManifest,
  normalizeAgentAgnosticSkill,
  SKILL_MANIFEST_FILE,
  sourceRefFromGitHubUrl,
} from "@/lib/services/skills/skill-os";

export type BrainSkillProviderId = "claude" | "codex" | "hermes" | "gemini" | "openclaw" | "aeon";

export type BrainSkillSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  provider: BrainSkillProviderId | "shared";
  providerLabel: string;
  path: string;
  relativePath: string;
  checksum: string;
  updatedAt: number;
  imported: boolean;
  importedAs?: string;
  sourceMachine?: string;
  sourcePath?: string;
  sourceStatus?: string;
  sourceFiles?: BrainSkillSourceFile[];
};

export type BrainSkillSourceFile = {
  path: string;
  contentBase64: string;
};

export type BrainSkillProviderInventory = {
  id: BrainSkillProviderId;
  label: string;
  home: string;
  skills: BrainSkillSummary[];
  installed: boolean;
};

export type BrainSkillInventory = {
  vaultPath: string;
  skillsFolder: string;
  readmePath: string;
  shared: BrainSkillSummary[];
  providers: BrainSkillProviderInventory[];
  totals: {
    shared: number;
    providerSkills: number;
    importable: number;
  };
};

export type BrainSkillImportResult = BrainSkillInventory & {
  imported: BrainSkillSummary[];
  skipped: BrainSkillSummary[];
  provider: BrainSkillProviderId | "all";
};

export type BrainSkillProviderAutoSyncPolicy = {
  autoImport?: boolean;
  autoUpdate?: boolean;
  trackRemovals?: boolean;
  allowDelete?: boolean;
};

export type BrainSkillReconcileResult = BrainSkillInventory & {
  imported: BrainSkillSummary[];
  updated: BrainSkillSummary[];
  markedMissing: BrainSkillSummary[];
  skipped: Array<BrainSkillSummary & { reason: string }>;
  deletionFreeze: boolean;
};

export type BrainSkillAeonSyncResult = {
  vaultPath: string;
  aeonRoot: string;
  skillsFolder: string;
  manifestPath: string;
  synced: BrainSkillSummary[];
  skipped: Array<BrainSkillSummary & { reason: string }>;
  totalShared: number;
};

export type RemoteBrainSkillInput = {
  slug?: string;
  name?: string;
  description?: string;
  source?: string;
  category?: string;
  skillMdUrl?: string;
  githubUrl?: string;
};

export type UploadedBrainSkillFile = {
  path: string;
  content: string;
};

type GitHubSkillSource = {
  owner: string;
  repo: string;
  ref?: string;
  path: string;
};

type GitHubContentEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | string;
  size?: number;
  download_url?: string | null;
  content?: string;
  encoding?: string;
};

export type RemoteBrainSkillProviderInventory = BrainSkillProviderInventory;

const PROVIDERS: Array<{
  id: BrainSkillProviderId;
  label: string;
  home: string;
  roots: Array<{ path: string; maxDepth: number }>;
}> = [
  {
    id: "claude",
    label: "Claude",
    home: "~/.claude",
    roots: [
      { path: "~/.claude/skills", maxDepth: 3 },
      { path: "~/.claude/plugins", maxDepth: 8 },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    home: "~/.codex",
    roots: [
      { path: "~/.codex/skills", maxDepth: 4 },
      { path: "~/.codex/plugins/cache", maxDepth: 8 },
    ],
  },
  {
    id: "hermes",
    label: "Hermes",
    home: "~/.hermes",
    roots: [
      { path: "~/.hermes/skills", maxDepth: 4 },
      { path: "~/.hermes/plugins", maxDepth: 8 },
      { path: "~/.hermes/agents", maxDepth: 6 },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    home: "~/.gemini",
    roots: [
      { path: "~/.gemini/skills", maxDepth: 4 },
      { path: "~/.gemini/extensions", maxDepth: 8 },
    ],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    home: "~/.openclaw",
    roots: [
      { path: "~/.openclaw/skills", maxDepth: 4 },
      { path: "~/Documents/code/projects/hivemind-os/openclaw-next/skills", maxDepth: 4 },
    ],
  },
  {
    id: "aeon",
    label: "Aeon",
    home: "~/.aeon",
    roots: [
      { path: "~/.aeon/skills", maxDepth: 4 },
      { path: "~/.aeon/plugins", maxDepth: 8 },
      { path: "~/.aeon/agents", maxDepth: 6 },
      { path: process.env.AEON_LOCAL_PATH ? `${process.env.AEON_LOCAL_PATH}/skills` : "~/.aeon/repo/skills", maxDepth: 3 },
    ],
  },
];

const SKIPPED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", ".archive"]);
const SOURCE_METADATA_FILE = ".hivemind-skill-source.json";
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_GITHUB_SKILL_FILES = 120;
const MAX_GITHUB_SKILL_FILE_BYTES = 5 * 1024 * 1024;
const BUNDLED_SHARED_SKILLS = [
  {
    slug: "karpathy-guidelines",
    providerLabel: "Bundled skills",
    sourceUrl: "https://github.com/multica-ai/andrej-karpathy-skills/tree/main/skills/karpathy-guidelines",
  },
];

function expandHome(path: string) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

async function canRead(path: string) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string) {
  return readFile(path, "utf8").catch(() => "");
}

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function slugToName(slug: string) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function skillNameFromMarkdown(markdown: string) {
  const frontmatter = parseFrontmatter(markdown);
  const frontmatterName = frontmatter.get("name");
  if (frontmatterName) return frontmatterName;
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || "Written Skill";
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  const fields = new Map<string, string>();
  if (!match) return fields;
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    fields.set(field[1].toLowerCase(), field[2].replace(/^["']|["']$/g, "").trim());
  }
  return fields;
}

function sanitizeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "skill";
}

function namespacedSharedSlug(basePath: string, skillPath: string) {
  const relativeDir = relative(basePath, dirname(skillPath)).split(/[\\/]+/).filter(Boolean);
  if (relativeDir.length <= 1) return sanitizeSlug(basename(dirname(skillPath)));
  return relativeDir.map((part) => sanitizeSlug(part)).join("/");
}

async function findSkillFiles(root: string, maxDepth: number) {
  const resolvedRoot = resolve(expandHome(root));
  if (!(await canRead(resolvedRoot))) return [];
  const found: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "SKILL.md") {
        found.push(join(current, entry.name));
        continue;
      }
      if (!entry.isDirectory() || SKIPPED_DIRS.has(entry.name)) continue;
      await walk(join(current, entry.name), depth + 1);
    }
  }

  await walk(resolvedRoot, 0);
  return found;
}

async function skillSummary(input: {
  skillPath: string;
  provider: BrainSkillProviderId | "shared";
  providerLabel: string;
  basePath: string;
  sharedByChecksum: Map<string, BrainSkillSummary>;
  sharedBySlug: Map<string, BrainSkillSummary>;
}): Promise<BrainSkillSummary> {
  const markdown = await readText(input.skillPath);
  const frontmatter = parseFrontmatter(markdown);
  const slug = input.provider === "shared"
    ? namespacedSharedSlug(input.basePath, input.skillPath)
    : sanitizeSlug(basename(dirname(input.skillPath)));
  const sourceMetadata = input.provider === "shared" ? await readSourceMetadata(dirname(input.skillPath)) : null;
  const existing = input.sharedByChecksum.get(checksum(markdown)) ?? input.sharedBySlug.get(slug);
  const updatedAt = (await stat(input.skillPath).catch(() => null))?.mtimeMs ?? 0;
  return {
    id: `${input.provider}:${input.skillPath}`,
    slug,
    name: frontmatter.get("name") || slugToName(slug),
    description: frontmatter.get("description") || firstParagraph(markdown),
    provider: input.provider,
    providerLabel: sourceMetadata?.providerLabel ?? input.providerLabel,
    path: input.skillPath,
    relativePath: relative(input.basePath, input.skillPath),
    checksum: checksum(markdown),
    updatedAt,
    imported: input.provider === "shared" || Boolean(existing),
    importedAs: existing?.slug,
    sourceStatus: sourceMetadata?.status,
  };
}

async function readSourceMetadata(skillDir: string): Promise<{ providerLabel?: string; status?: string } | null> {
  const metadata = await readText(join(skillDir, SOURCE_METADATA_FILE));
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { providerLabel?: unknown; status?: unknown };
    return {
      providerLabel: typeof parsed.providerLabel === "string" ? parsed.providerLabel : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
    };
  } catch {
    return null;
  }
}

async function readManagedMetadata(skillDir: string): Promise<Record<string, unknown> | null> {
  const metadata = await readText(join(skillDir, SOURCE_METADATA_FILE));
  if (!metadata) return null;
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "hivemindos-skill-browser",
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function classifyGitHubError(status: number) {
  switch (status) {
    case 401:
      return "GitHub could not authenticate this request. Check GITHUB_TOKEN or GH_TOKEN for private repositories.";
    case 403:
      return "GitHub rate limit or permissions blocked the download.";
    case 404:
      return "GitHub repository or skill path was not found.";
    case 422:
      return "GitHub could not read that repository. It may be empty or unavailable.";
    default:
      return `GitHub API error (HTTP ${status}).`;
  }
}

function parseGitHubSkillUrl(url: string): GitHubSkillSource {
  const parsed = new URL(url.trim());
  const host = parsed.hostname.toLowerCase();
  if (host === "raw.githubusercontent.com") {
    const [owner, repo, ref, ...pathParts] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo || !ref || !pathParts.length) throw new Error("Enter a GitHub repository, skill folder, or SKILL.md URL.");
    const filePath = pathParts.join("/");
    return { owner, repo, ref, path: filePath.endsWith("/SKILL.md") ? dirname(filePath) : filePath };
  }

  if (host !== "github.com") throw new Error("Enter a github.com URL.");
  const [owner, repoWithSuffix, view, ref, ...pathParts] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repoWithSuffix) throw new Error("Enter a GitHub repository URL.");
  const repo = repoWithSuffix.replace(/\.git$/, "");
  if (!view) return { owner, repo, path: "" };
  if (view !== "tree" && view !== "blob") throw new Error("Use a GitHub repository, folder, or SKILL.md URL.");
  if (!ref) throw new Error("GitHub URL is missing a branch or tag.");
  const requestedPath = pathParts.join("/");
  const skillPath = view === "blob" && requestedPath.endsWith("SKILL.md") ? dirname(requestedPath) : requestedPath;
  return { owner, repo, ref, path: skillPath === "." ? "" : skillPath };
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(classifyGitHubError(response.status));
  return response.json() as Promise<T>;
}

async function getDefaultBranch(source: GitHubSkillSource) {
  if (source.ref) return source.ref;
  const repo = await fetchGitHubJson<{ default_branch?: string }>(
    `${GITHUB_API_BASE}/repos/${source.owner}/${source.repo}`,
  );
  return repo.default_branch || "main";
}

function encodedGitHubPath(path: string) {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

async function listGitHubDirectory(source: GitHubSkillSource, path: string, ref: string): Promise<GitHubContentEntry[]> {
  const encodedPath = encodedGitHubPath(path);
  const url = `${GITHUB_API_BASE}/repos/${source.owner}/${source.repo}/contents${encodedPath ? `/${encodedPath}` : ""}?ref=${encodeURIComponent(ref)}`;
  const contents = await fetchGitHubJson<GitHubContentEntry | GitHubContentEntry[]>(url);
  return Array.isArray(contents) ? contents : [contents];
}

async function fetchGitHubFileBytes(source: GitHubSkillSource, path: string, ref: string) {
  const encodedPath = encodedGitHubPath(path);
  const file = await fetchGitHubJson<GitHubContentEntry>(
    `${GITHUB_API_BASE}/repos/${source.owner}/${source.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  );
  if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
    throw new Error(`GitHub did not return file content for ${path}.`);
  }
  const cleanBase64 = file.content.replace(/\n/g, "");
  return Uint8Array.from(Buffer.from(cleanBase64, "base64"));
}

async function resolveGitHubSkillDirectory(source: GitHubSkillSource, ref: string) {
  const entries = await listGitHubDirectory(source, source.path, ref);
  if (entries.some((entry) => entry.type === "file" && entry.name === "SKILL.md")) return source.path;

  const skillDirs: string[] = [];
  async function walk(path: string, depth: number): Promise<void> {
    if (depth > 4 || skillDirs.length > 8) return;
    const dirEntries = await listGitHubDirectory(source, path, ref);
    if (dirEntries.some((entry) => entry.type === "file" && entry.name === "SKILL.md")) {
      skillDirs.push(path);
      return;
    }
    for (const entry of dirEntries) {
      if (entry.type !== "dir" || SKIPPED_DIRS.has(entry.name)) continue;
      await walk(entry.path, depth + 1);
    }
  }
  await walk(source.path, 0);

  if (skillDirs.length === 1) return skillDirs[0];
  if (skillDirs.length > 1) {
    throw new Error("That repository contains multiple skills. Paste the GitHub URL for one skill folder or its SKILL.md file.");
  }
  throw new Error("No SKILL.md was found at that GitHub URL.");
}

function safeDestinationPath(root: string, relativePath: string) {
  const destination = resolve(root, relativePath);
  if (destination !== root && !destination.startsWith(`${root}/`)) throw new Error("GitHub skill contains an unsafe file path.");
  return destination;
}

async function downloadGitHubSkillDirectory(input: {
  source: GitHubSkillSource;
  ref: string;
  sourcePath: string;
  destinationDir: string;
}) {
  let fileCount = 0;
  const root = resolve(input.destinationDir);

  async function walk(path: string) {
    const entries = await listGitHubDirectory(input.source, path, input.ref);
    for (const entry of entries) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      const relativePath = relative(input.sourcePath || ".", entry.path);
      if (!relativePath || relativePath.startsWith("..")) continue;
      if (entry.type === "dir") {
        await walk(entry.path);
        continue;
      }
      if (entry.type !== "file") continue;
      if ((entry.size ?? 0) > MAX_GITHUB_SKILL_FILE_BYTES) {
        throw new Error(`${entry.path} is too large to import as a shared skill.`);
      }
      fileCount += 1;
      if (fileCount > MAX_GITHUB_SKILL_FILES) throw new Error("That GitHub skill contains too many files to import safely.");
      const destination = safeDestinationPath(root, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await fetchGitHubFileBytes(input.source, entry.path, input.ref));
    }
  }

  await walk(input.sourcePath);
  if (!(await exists(join(input.destinationDir, "SKILL.md")))) throw new Error("GitHub download finished without a SKILL.md file.");
}

function firstParagraph(markdown: string) {
  return markdown
    .replace(/^---\n[\s\S]*?\n---/, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/, "").trim())
    .find(Boolean) ?? "";
}

async function readSharedSkills(vaultPath: string) {
  const skillsFolder = join(vaultPath, "Skills");
  const files = await findSkillFiles(skillsFolder, 3);
  const blank = new Map<string, BrainSkillSummary>();
  const summaries = await Promise.all(files.map((skillPath) => skillSummary({
    skillPath,
    provider: "shared",
    providerLabel: "Shared brain",
    basePath: skillsFolder,
    sharedByChecksum: blank,
    sharedBySlug: blank,
  })));
  const unique = new Map<string, BrainSkillSummary>();
  for (const skill of summaries.sort((a, b) => (
    sourcePriority(a) - sourcePriority(b)
    || a.slug.length - b.slug.length
    || a.relativePath.localeCompare(b.relativePath)
  ))) {
    const key = skill.slug.includes("/") ? skill.slug : sanitizeSlug(skill.name || skill.slug);
    if (!unique.has(key)) unique.set(key, skill);
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureSharedSkillsFolder(vaultPath: string) {
  const skillsFolder = join(vaultPath, "Skills");
  await mkdir(skillsFolder, { recursive: true });

  let seeded = false;
  for (const skill of BUNDLED_SHARED_SKILLS) {
    const sourceDir = join(process.cwd(), "skills", skill.slug);
    const sourceSkillPath = join(sourceDir, "SKILL.md");
    if (!(await exists(sourceSkillPath))) continue;

    const destinationDir = join(skillsFolder, skill.slug);
    const destinationSkillPath = join(destinationDir, "SKILL.md");
    if (await exists(destinationSkillPath)) continue;

    await cp(sourceDir, destinationDir, {
      recursive: true,
      errorOnExist: false,
      force: false,
      filter: (path) => !path.split("/").some((part) => SKIPPED_DIRS.has(part)),
    });
    await writeFile(join(destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
      provider: "bundled",
      providerLabel: skill.providerLabel,
      sourceUrl: skill.sourceUrl,
      importedAt: new Date().toISOString(),
    }, null, 2), "utf8");
    seeded = true;
  }

  return seeded;
}

function sourcePriority(skill: BrainSkillSummary) {
  if (skill.providerLabel === "Shared brain") return 0;
  return 1;
}

function newestSkill(left: BrainSkillSummary, right: BrainSkillSummary) {
  if ((right.updatedAt ?? 0) !== (left.updatedAt ?? 0)) {
    return (right.updatedAt ?? 0) > (left.updatedAt ?? 0) ? right : left;
  }
  return right.providerLabel.localeCompare(left.providerLabel) > 0 ? right : left;
}

function markProviderSkillImports(
  skill: BrainSkillSummary,
  sharedByChecksum: Map<string, BrainSkillSummary>,
  sharedBySlug: Map<string, BrainSkillSummary>,
): BrainSkillSummary {
  const existing = sharedByChecksum.get(skill.checksum) ?? sharedBySlug.get(skill.slug);
  return {
    ...skill,
    imported: Boolean(existing),
    importedAs: existing?.slug,
  };
}

function mergeProviderInventories(
  localProviders: BrainSkillProviderInventory[],
  remoteProviders: RemoteBrainSkillProviderInventory[] | undefined,
  sharedByChecksum: Map<string, BrainSkillSummary>,
  sharedBySlug: Map<string, BrainSkillSummary>,
) {
  const providerMap = new Map<BrainSkillProviderId, BrainSkillProviderInventory>();
  for (const provider of localProviders) {
    providerMap.set(provider.id, { ...provider, skills: [...provider.skills] });
  }

  for (const remoteProvider of remoteProviders ?? []) {
    const existing = providerMap.get(remoteProvider.id);
    if (!existing) {
      providerMap.set(remoteProvider.id, {
        ...remoteProvider,
        skills: remoteProvider.skills.map((skill) => markProviderSkillImports(skill, sharedByChecksum, sharedBySlug)),
      });
      continue;
    }
    existing.installed = existing.installed || remoteProvider.installed;
    existing.skills.push(...remoteProvider.skills.map((skill) => markProviderSkillImports(skill, sharedByChecksum, sharedBySlug)));
  }

  return PROVIDERS.map((provider) => {
    const merged = providerMap.get(provider.id) ?? {
      id: provider.id,
      label: provider.label,
      home: provider.home,
      skills: [],
      installed: false,
    };
    const latestBySlug = new Map<string, BrainSkillSummary>();
    for (const skill of merged.skills) {
      const existing = latestBySlug.get(skill.slug);
      latestBySlug.set(skill.slug, existing ? newestSkill(existing, skill) : skill);
    }
    return {
      ...merged,
      skills: [...latestBySlug.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export async function getBrainSkillInventory(
  vaultPath?: string,
  remoteProviders?: RemoteBrainSkillProviderInventory[],
): Promise<BrainSkillInventory> {
  const resolvedVault = resolveObsidianVaultPath(vaultPath);
  const skillsFolder = join(resolvedVault, "Skills");
  const readmePath = join(skillsFolder, "README.md");
  const seeded = await ensureSharedSkillsFolder(resolvedVault);
  const shared = await readSharedSkills(resolvedVault);
  const sharedByChecksum = new Map(shared.map((skill) => [skill.checksum, skill]));
  const sharedBySlug = new Map(shared.map((skill) => [skill.slug, skill]));

  const localProviders = await Promise.all(PROVIDERS.map(async (provider) => {
    const skillFiles = [...new Set((await Promise.all(
      provider.roots.map((root) => findSkillFiles(root.path, root.maxDepth)),
    )).flat())];
    const summaries = await Promise.all(skillFiles.map((skillPath) => skillSummary({
      skillPath,
      provider: provider.id,
      providerLabel: provider.label,
      basePath: resolve(expandHome(provider.home)),
      sharedByChecksum,
      sharedBySlug,
    })));
    const skills = summaries
      .filter((skill) => !skill.path.startsWith(skillsFolder))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: provider.id,
      label: provider.label,
      home: provider.home,
      skills,
      installed: await canRead(resolve(expandHome(provider.home))),
    };
  }));

  const providers = mergeProviderInventories(localProviders, remoteProviders, sharedByChecksum, sharedBySlug);
  const providerSkills = providers.reduce((sum, provider) => sum + provider.skills.length, 0);
  const importable = providers.reduce((sum, provider) => sum + provider.skills.filter((skill) => !skill.imported).length, 0);

  const inventory = {
    vaultPath: resolvedVault,
    skillsFolder,
    readmePath,
    shared,
    providers,
    totals: {
      shared: shared.length,
      providerSkills,
      importable,
    },
  };
  if (seeded) await writeSkillsReadme(inventory);
  return inventory;
}

export async function getSharedBrainSkills(vaultPath?: string): Promise<{
  vaultPath: string;
  skillsFolder: string;
  readmePath: string;
  shared: BrainSkillSummary[];
}> {
  const resolvedVault = resolveObsidianVaultPath(vaultPath);
  const skillsFolder = join(resolvedVault, "Skills");
  const readmePath = join(skillsFolder, "README.md");
  const seeded = await ensureSharedSkillsFolder(resolvedVault);
  const shared = await readSharedSkills(resolvedVault);
  if (seeded) {
    await writeSkillsReadme({
      vaultPath: resolvedVault,
      skillsFolder,
      readmePath,
      shared,
      providers: [],
      totals: { shared: shared.length, providerSkills: 0, importable: 0 },
    });
  }
  return { vaultPath: resolvedVault, skillsFolder, readmePath, shared };
}

// Cache key prefix for the shared-brain inventory. Mutating flows (skill imports,
// writes) call invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX) so the next read
// reflects the change immediately.
export const SHARED_BRAIN_CACHE_PREFIX = "shared-brain:";

// Short-TTL wrapper around getSharedBrainSkills. The AEON panel reads the shared
// skill list from several endpoints in one refresh (skills, secrets, analytics);
// caching the underlying vault scan collapses those into a single read.
export function getSharedBrainSkillsCached(vaultPath?: string) {
  return cachedCall(`${SHARED_BRAIN_CACHE_PREFIX}${vaultPath ?? ""}`, 15_000, () => getSharedBrainSkills(vaultPath));
}

async function writeSourceFiles(destinationDir: string, files: BrainSkillSourceFile[]) {
  const root = resolve(destinationDir);
  await mkdir(root, { recursive: true });
  for (const file of files) {
    if (!file.path || file.path.startsWith("/") || file.path.split(/[\\/]+/).some((part) => part === ".." || SKIPPED_DIRS.has(part))) {
      continue;
    }
    const destination = resolve(root, file.path);
    if (destination !== root && !destination.startsWith(`${root}/`)) continue;
    await mkdir(dirname(destination), { recursive: true });
    const content = Buffer.from(file.contentBase64, "base64");
    await writeFile(destination, new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
  }
}

async function copySkillSource(source: BrainSkillSummary, destinationDir: string) {
  if (source.sourceFiles?.length) {
    await writeSourceFiles(destinationDir, source.sourceFiles);
    return;
  }
  await cp(dirname(source.path), destinationDir, {
    recursive: true,
    errorOnExist: false,
    force: true,
    filter: (path) => !path.split("/").some((part) => SKIPPED_DIRS.has(part)),
  });
}

async function canCopySkillSource(source: BrainSkillSummary) {
  if (source.sourceFiles?.length) return true;
  return exists(dirname(source.path));
}

async function writeImportedMetadata(destinationDir: string, source: BrainSkillSummary, extra: Record<string, unknown> = {}) {
  await writeFile(join(destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
    provider: source.provider,
    providerLabel: source.providerLabel,
    sourcePath: source.sourcePath ?? source.path,
    sourceMachine: source.sourceMachine,
    sourceChecksum: source.checksum,
    sourceUpdatedAt: source.updatedAt,
    importedAt: new Date().toISOString(),
    ...extra,
  }, null, 2), "utf8");
}

async function archiveSharedSkill(skillsFolder: string, slug: string, sourceDir: string) {
  const archiveDir = join(skillsFolder, ".archive", `${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(dirname(archiveDir), { recursive: true });
  await cp(sourceDir, archiveDir, {
    recursive: true,
    errorOnExist: false,
    force: false,
    filter: (path) => !path.split("/").some((part) => SKIPPED_DIRS.has(part)),
  });
  return archiveDir;
}

export async function importBrainSkills(input: {
  vaultPath?: string;
  provider?: BrainSkillProviderId | "all";
  remoteProviders?: RemoteBrainSkillProviderInventory[];
}): Promise<BrainSkillImportResult> {
  const provider = input.provider ?? "all";
  const before = await getBrainSkillInventory(input.vaultPath, input.remoteProviders);
  await mkdir(before.skillsFolder, { recursive: true });

  const selectedProviders = before.providers.filter((item) => provider === "all" || item.id === provider);
  const sharedBySlug = new Map(before.shared.map((skill) => [skill.slug, skill]));
  const imported: BrainSkillSummary[] = [];
  const skipped: BrainSkillSummary[] = [];

  for (const source of selectedProviders.flatMap((item) => item.skills)) {
    const existingSharedSkill = sharedBySlug.get(source.slug);
    if (source.imported || existingSharedSkill) {
      skipped.push(source);
      continue;
    }

    const destinationSlug = await nextDestinationSlug(before.skillsFolder, source.slug, source.provider, sharedBySlug);
    const destinationDir = join(before.skillsFolder, destinationSlug);
    await copySkillSource(source, destinationDir);
    await writeImportedMetadata(destinationDir, source);
    const copied = { ...source, imported: true, importedAs: destinationSlug };
    imported.push(copied);
    sharedBySlug.set(destinationSlug, copied);
    sharedBySlug.set(source.slug, copied);
  }

  const after = await getBrainSkillInventory(input.vaultPath, input.remoteProviders);
  if (imported.length) await writeSkillsReadme(after);
  return {
    ...after,
    imported,
    skipped,
    provider,
  };
}

export async function reconcileBrainSkills(input: {
  vaultPath?: string;
  remoteProviders?: RemoteBrainSkillProviderInventory[];
  policies?: Partial<Record<BrainSkillProviderId, BrainSkillProviderAutoSyncPolicy>>;
}): Promise<BrainSkillReconcileResult> {
  const before = await getBrainSkillInventory(input.vaultPath, input.remoteProviders);
  await mkdir(before.skillsFolder, { recursive: true });

  const sharedBySlug = new Map(before.shared.map((skill) => [skill.slug, skill]));
  const imported: BrainSkillSummary[] = [];
  const updated: BrainSkillSummary[] = [];
  const markedMissing: BrainSkillSummary[] = [];
  const skipped: Array<BrainSkillSummary & { reason: string }> = [];
  const activeSources = new Map<string, BrainSkillSummary>();

  for (const provider of before.providers) {
    const policy = input.policies?.[provider.id];
    if (!policy?.autoImport && !policy?.autoUpdate && !policy?.trackRemovals) continue;
    for (const source of provider.skills) {
      activeSources.set(`${source.provider}:${source.slug}`, source);
      const shared = sharedBySlug.get(source.slug);
      if (!shared) {
        if (!policy.autoImport) {
          skipped.push({ ...source, reason: "auto-import disabled" });
          continue;
        }
        if (!(await canCopySkillSource(source))) {
          skipped.push({ ...source, reason: "source files unavailable" });
          continue;
        }
        const destinationSlug = await nextDestinationSlug(before.skillsFolder, source.slug, source.provider, sharedBySlug);
        const destinationDir = join(before.skillsFolder, destinationSlug);
        await copySkillSource(source, destinationDir);
        await writeImportedMetadata(destinationDir, source, { autoSyncedAt: new Date().toISOString() });
        const copied = { ...source, imported: true, importedAs: destinationSlug };
        imported.push(copied);
        sharedBySlug.set(destinationSlug, copied);
        sharedBySlug.set(source.slug, copied);
        continue;
      }

      if (shared.checksum === source.checksum) continue;
      if (!policy.autoUpdate) {
        skipped.push({ ...source, reason: "auto-update disabled" });
        continue;
      }
      if ((source.updatedAt ?? 0) < (shared.updatedAt ?? 0)) {
        skipped.push({ ...source, reason: "shared copy is newer" });
        continue;
      }
      if (!(await canCopySkillSource(source))) {
        skipped.push({ ...source, reason: "source files unavailable" });
        continue;
      }
      const destinationDir = dirname(shared.path);
      const archivedTo = await archiveSharedSkill(before.skillsFolder, shared.slug, destinationDir);
      await rm(destinationDir, { recursive: true, force: true });
      await copySkillSource(source, destinationDir);
      await writeImportedMetadata(destinationDir, source, {
        autoSyncedAt: new Date().toISOString(),
        previousChecksum: shared.checksum,
        archivedTo,
      });
      updated.push({ ...source, imported: true, importedAs: shared.slug });
    }
  }

  const managedMetadata = await Promise.all(before.shared.map(async (skill) => ({
    skill,
    metadata: await readManagedMetadata(dirname(skill.path)),
  })));
  const missing = managedMetadata.filter(({ skill, metadata }) => {
    const provider = metadata?.provider;
    if (!provider || typeof provider !== "string" || !(provider in (input.policies ?? {}))) return false;
    const policy = input.policies?.[provider as BrainSkillProviderId];
    if (!policy?.trackRemovals) return false;
    return !activeSources.has(`${provider}:${skill.slug}`);
  });
  const deletionFreeze = missing.length >= 20 || missing.length > Math.max(5, before.shared.length * 0.25);
  if (!deletionFreeze) {
    for (const { skill, metadata } of missing) {
      const currentStatus = typeof metadata?.status === "string" ? metadata.status : "";
      if (currentStatus === "missing-upstream") {
        markedMissing.push(skill);
        continue;
      }
      await writeFile(join(dirname(skill.path), SOURCE_METADATA_FILE), JSON.stringify({
        ...metadata,
        status: "missing-upstream",
        missingAt: new Date().toISOString(),
        deletionPolicy: "archive-only",
      }, null, 2), "utf8");
      markedMissing.push(skill);
    }
  } else {
    for (const { skill } of missing) {
      skipped.push({ ...skill, reason: "deletion freeze: too many upstream skills disappeared at once" });
    }
  }

  const after = await getBrainSkillInventory(input.vaultPath, input.remoteProviders);
  if (imported.length || updated.length || markedMissing.length) await writeSkillsReadme(after);
  return {
    ...after,
    imported,
    updated,
    markedMissing,
    skipped,
    deletionFreeze,
  };
}

export async function importRemoteBrainSkill(input: {
  vaultPath?: string;
  skill: RemoteBrainSkillInput;
}): Promise<BrainSkillInventory> {
  const before = await getBrainSkillInventory(input.vaultPath);
  await mkdir(before.skillsFolder, { recursive: true });
  const skill = input.skill;
  const slug = sanitizeSlug(skill.slug || skill.name || "skill");
  const sharedBySlug = new Map(before.shared.map((item) => [item.slug, item]));
  const destinationSlug = await nextDestinationSlug(before.skillsFolder, slug, "shared", sharedBySlug);
  const destinationDir = join(before.skillsFolder, destinationSlug);
  await mkdir(destinationDir, { recursive: true });

  let markdown = "";
  if (skill.skillMdUrl) {
    const response = await fetch(skill.skillMdUrl, { signal: AbortSignal.timeout(12_000) });
    if (response.ok) markdown = await response.text();
  }

  if (!markdown.trim()) {
    markdown = [
      "---",
      `name: "${(skill.name || slugToName(destinationSlug)).replace(/"/g, "'")}"`,
      `description: "${(skill.description || "Shared agent skill.").replace(/"/g, "'")}"`,
      "---",
      "",
      `# ${skill.name || slugToName(destinationSlug)}`,
      "",
      skill.description || "Use this skill when its title matches the task.",
      "",
      "## Source",
      "",
      skill.githubUrl ? `- Repository: ${skill.githubUrl}` : "",
      skill.skillMdUrl ? `- SKILL.md: ${skill.skillMdUrl}` : "",
    ].filter(Boolean).join("\n");
  }
  markdown = normalizeAgentAgnosticSkill(markdown, skill.source || skill.githubUrl || skill.skillMdUrl || "remote catalog");
  const audit = await auditSkillInput({
    slug: destinationSlug,
    markdown,
    sourceRef: skill.githubUrl ? sourceRefFromGitHubUrl(skill.githubUrl) : skill.skillMdUrl,
  });
  if (audit.status === "blocked") {
    await rm(destinationDir, { recursive: true, force: true });
    throw new Error(`Skill audit blocked ${destinationSlug}: ${audit.findings.map((finding) => finding.title).join(", ")}`);
  }

  await writeFile(join(destinationDir, "SKILL.md"), markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  await writeFile(join(destinationDir, SKILL_MANIFEST_FILE), JSON.stringify(createSkillManifest({
    slug: destinationSlug,
    name: skill.name || slugToName(destinationSlug),
    description: skill.description || "Shared agent skill.",
    sourceType: "registry",
    sourceLabel: skill.source || "Skill browser",
    sourceUrl: skill.skillMdUrl || skill.githubUrl || "",
    sourceRef: skill.githubUrl ? sourceRefFromGitHubUrl(skill.githubUrl) : skill.skillMdUrl,
    audit,
    markdown,
  }), null, 2), "utf8");
  await writeFile(join(destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
    provider: "remote",
    providerLabel: skill.source || "Skill browser",
    sourceUrl: skill.skillMdUrl || skill.githubUrl || "",
    agentAgnostic: true,
    auditStatus: audit.status,
    capabilities: audit.capabilities,
    envKeys: audit.envKeys,
    importedAt: new Date().toISOString(),
  }, null, 2), "utf8");

  const after = await getBrainSkillInventory(input.vaultPath);
  await writeSkillsReadme(after);
  return after;
}

export async function importGitHubBrainSkill(input: {
  vaultPath?: string;
  githubUrl: string;
}): Promise<BrainSkillInventory> {
  const source = parseGitHubSkillUrl(input.githubUrl);
  const ref = await getDefaultBranch(source);
  const sourcePath = await resolveGitHubSkillDirectory(source, ref);
  const before = await getBrainSkillInventory(input.vaultPath);
  await mkdir(before.skillsFolder, { recursive: true });

  const skillSlug = sanitizeSlug(basename(sourcePath) || source.repo);
  const sharedBySlug = new Map(before.shared.map((item) => [item.slug, item]));
  const destinationSlug = await nextDestinationSlug(before.skillsFolder, skillSlug, "shared", sharedBySlug);
  const destinationDir = join(before.skillsFolder, destinationSlug);
  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(destinationDir, { recursive: true });

  try {
    await downloadGitHubSkillDirectory({ source, ref, sourcePath, destinationDir });
  } catch (error) {
    await rm(destinationDir, { recursive: true, force: true });
    throw error;
  }
  const skillPath = join(destinationDir, "SKILL.md");
  const rawMarkdown = await readFile(skillPath, "utf8");
  const markdown = normalizeAgentAgnosticSkill(rawMarkdown, input.githubUrl);
  await writeFile(skillPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  const audit = await auditSkillDirectory({
    slug: destinationSlug,
    dir: destinationDir,
    sourceRef: `${source.owner}/${source.repo}@${ref}`,
  });
  if (audit.status === "blocked") {
    await rm(destinationDir, { recursive: true, force: true });
    throw new Error(`Skill audit blocked ${destinationSlug}: ${audit.findings.map((finding) => finding.title).join(", ")}`);
  }

  await writeFile(join(destinationDir, SKILL_MANIFEST_FILE), JSON.stringify(createSkillManifest({
    slug: destinationSlug,
    name: skillNameFromMarkdown(markdown),
    description: firstParagraph(markdown) || "Shared agent skill.",
    sourceType: "github",
    sourceLabel: "GitHub",
    sourceUrl: input.githubUrl.trim(),
    sourceRepo: `${source.owner}/${source.repo}`,
    sourceRef: ref,
    sourcePath,
    audit,
    markdown,
  }), null, 2), "utf8");
  await writeFile(join(destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
    provider: "github",
    providerLabel: "GitHub",
    sourceUrl: input.githubUrl.trim(),
    sourceRepo: `${source.owner}/${source.repo}`,
    sourceRef: ref,
    sourcePath,
    agentAgnostic: true,
    auditStatus: audit.status,
    capabilities: audit.capabilities,
    envKeys: audit.envKeys,
    importedAt: new Date().toISOString(),
  }, null, 2), "utf8");

  const after = await getBrainSkillInventory(input.vaultPath);
  await writeSkillsReadme(after);
  return after;
}

export async function writeBrainSkill(input: {
  vaultPath?: string;
  markdown: string;
}): Promise<BrainSkillInventory> {
  const rawMarkdown = input.markdown.trim();
  if (!rawMarkdown) throw new Error("Write the skill content before adding it.");
  const markdown = normalizeAgentAgnosticSkill(rawMarkdown, "written skill");

  const before = await getBrainSkillInventory(input.vaultPath);
  await mkdir(before.skillsFolder, { recursive: true });

  const sharedBySlug = new Map(before.shared.map((item) => [item.slug, item]));
  const destinationSlug = await nextDestinationSlug(
    before.skillsFolder,
    sanitizeSlug(skillNameFromMarkdown(markdown)),
    "shared",
    sharedBySlug,
  );
  const destinationDir = join(before.skillsFolder, destinationSlug);
  await mkdir(destinationDir, { recursive: true });
  const audit = await auditSkillInput({ slug: destinationSlug, markdown, sourceRef: "written" });
  if (audit.status === "blocked") throw new Error(`Skill audit blocked this draft: ${audit.findings.map((finding) => finding.title).join(", ")}`);
  await writeFile(join(destinationDir, "SKILL.md"), `${markdown}\n`, "utf8");
  await writeFile(join(destinationDir, SKILL_MANIFEST_FILE), JSON.stringify(createSkillManifest({
    slug: destinationSlug,
    name: skillNameFromMarkdown(markdown),
    description: firstParagraph(markdown) || "Written shared skill.",
    sourceType: "written",
    sourceLabel: "Written skills",
    sourceRef: "written",
    audit,
    markdown,
  }), null, 2), "utf8");
  await writeFile(join(destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
    provider: "written",
    providerLabel: "Written skills",
    agentAgnostic: true,
    auditStatus: audit.status,
    capabilities: audit.capabilities,
    envKeys: audit.envKeys,
    writtenAt: new Date().toISOString(),
  }, null, 2), "utf8");

  const after = await getBrainSkillInventory(input.vaultPath);
  await writeSkillsReadme(after);
  return after;
}

export async function importUploadedBrainSkill(input: {
  vaultPath?: string;
  files: UploadedBrainSkillFile[];
  name?: string;
}): Promise<BrainSkillInventory> {
  const files = input.files
    .map((file) => ({ path: file.path.replace(/\\/g, "/").replace(/^\/+/, ""), content: file.content }))
    .filter((file) => file.path && typeof file.content === "string");
  if (!files.length) throw new Error("Choose a skill folder or files to import.");
  const skillFile = files.find((file) => /(^|\/)SKILL\.md$/i.test(file.path)) ?? files.find((file) => /\.skill$/i.test(file.path));
  if (!skillFile) throw new Error("Imported skill must include SKILL.md.");

  const before = await getBrainSkillInventory(input.vaultPath);
  await mkdir(before.skillsFolder, { recursive: true });
  const sharedBySlug = new Map(before.shared.map((item) => [item.slug, item]));
  const slugSource = input.name || skillNameFromMarkdown(skillFile.content) || basename(dirname(skillFile.path)) || "uploaded-skill";
  const destinationSlug = await nextDestinationSlug(before.skillsFolder, sanitizeSlug(slugSource), "shared", sharedBySlug);
  const destinationDir = join(before.skillsFolder, destinationSlug);
  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(destinationDir, { recursive: true });

  const commonPrefix = skillFile.path.includes("/") ? dirname(skillFile.path) : "";
  for (const file of files) {
    const relativePath = commonPrefix && file.path.startsWith(`${commonPrefix}/`) ? file.path.slice(commonPrefix.length + 1) : basename(file.path);
    if (!relativePath || relativePath.includes("..") || relativePath.startsWith(".")) continue;
    const target = join(destinationDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content.endsWith("\n") ? file.content : `${file.content}\n`, "utf8");
  }
  await writeFile(join(destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
    provider: "upload",
    providerLabel: "Uploaded folder",
    importedAt: new Date().toISOString(),
    sourceFiles: files.map((file) => file.path).slice(0, 80),
  }, null, 2), "utf8");

  const after = await getBrainSkillInventory(input.vaultPath);
  await writeSkillsReadme(after);
  return after;
}

function resolveAeonRoot(aeonLocalPath?: string) {
  const configured = aeonLocalPath?.trim()
    || process.env.AEON_LOCAL_PATH?.trim()
    || process.env.AEON_HOME?.trim()
    || "~/.aeon";
  return resolve(expandHome(configured));
}

export async function syncSharedBrainSkillsToAeon(input: {
  vaultPath?: string;
  aeonLocalPath?: string;
}): Promise<BrainSkillAeonSyncResult> {
  const inventory = await getBrainSkillInventory(input.vaultPath);
  const aeonRoot = resolveAeonRoot(input.aeonLocalPath);
  const skillsFolder = join(aeonRoot, "skills");
  const manifestPath = join(aeonRoot, "skills.json");
  await mkdir(skillsFolder, { recursive: true });

  const synced: BrainSkillSummary[] = [];
  const skipped: Array<BrainSkillSummary & { reason: string }> = [];

  for (const skill of inventory.shared) {
    const sourceDir = dirname(skill.path);
    const destinationDir = join(skillsFolder, skill.slug);
    const destinationSkill = join(destinationDir, "SKILL.md");
    const destinationExists = await exists(destinationSkill);
    const destinationMetadata = destinationExists ? await readManagedMetadata(destinationDir) : null;
    const destinationText = destinationExists ? await readText(destinationSkill) : "";
    const destinationChecksum = destinationText ? checksum(destinationText) : "";
    const managedByHivemind = destinationMetadata?.managedBy === "hivemindos" || destinationMetadata?.provider === "shared-brain";

    if (destinationExists && destinationChecksum !== skill.checksum && !managedByHivemind) {
      skipped.push({ ...skill, reason: `Aeon already has an unmanaged skill at ${destinationDir}` });
      continue;
    }

    if (managedByHivemind) await rm(destinationDir, { recursive: true, force: true });
    await cp(sourceDir, destinationDir, {
      recursive: true,
      errorOnExist: false,
      force: true,
      filter: (path) => !path.split("/").some((part) => SKIPPED_DIRS.has(part)),
    });
    await writeFile(join(destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
      managedBy: "hivemindos",
      provider: "shared-brain",
      providerLabel: "Shared brain",
      sourcePath: skill.path,
      sourceChecksum: skill.checksum,
      syncedAt: new Date().toISOString(),
    }, null, 2), "utf8");
    synced.push(skill);
  }

  await writeAeonSkillsManifest(manifestPath, inventory.shared, skipped);
  return {
    vaultPath: inventory.vaultPath,
    aeonRoot,
    skillsFolder,
    manifestPath,
    synced,
    skipped,
    totalShared: inventory.shared.length,
  };
}

async function nextDestinationSlug(
  skillsFolder: string,
  slug: string,
  provider: BrainSkillProviderId | "shared",
  sharedBySlug: Map<string, BrainSkillSummary>,
) {
  const candidates = [slug, `${provider}-${slug}`].map(sanitizeSlug);
  for (const candidate of candidates) {
    if (!sharedBySlug.has(candidate) && !(await exists(join(skillsFolder, candidate)))) return candidate;
  }
  let index = 2;
  while (true) {
    const candidate = sanitizeSlug(`${provider}-${slug}-${index}`);
    if (!sharedBySlug.has(candidate) && !(await exists(join(skillsFolder, candidate)))) return candidate;
    index += 1;
  }
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeAeonSkillsManifest(
  manifestPath: string,
  shared: BrainSkillSummary[],
  skipped: Array<BrainSkillSummary & { reason: string }>,
) {
  let existingSkills: Array<Record<string, unknown>> = [];
  const existing = await readText(manifestPath);
  if (existing.trim()) {
    try {
      const parsed = JSON.parse(existing) as { skills?: Array<Record<string, unknown>> };
      existingSkills = Array.isArray(parsed.skills) ? parsed.skills : [];
    } catch {
      existingSkills = [];
    }
  }

  const skippedSlugs = new Set(skipped.map((skill) => skill.slug));
  const retained = existingSkills.filter((skill) => {
    const slug = typeof skill.slug === "string" ? skill.slug : "";
    if (!slug) return false;
    if (skill.source === "shared-brain") return false;
    return true;
  });
  const sharedEntries = shared
    .filter((skill) => !skippedSlugs.has(skill.slug))
    .map((skill) => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      source: "shared-brain",
      skillMdPath: skill.path,
      checksum: skill.checksum,
    }));

  const manifest = {
    managedBy: "hivemindos",
    updatedAt: new Date().toISOString(),
    skills: [...retained, ...sharedEntries].sort((a, b) => String(a.slug).localeCompare(String(b.slug))),
  };
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function writeSkillsReadme(inventory: BrainSkillInventory) {
  const grouped = new Map<string, BrainSkillSummary[]>();
  for (const skill of inventory.shared) {
    const key = skill.providerLabel || "Shared brain";
    grouped.set(key, [...(grouped.get(key) ?? []), skill]);
  }

  const lines = [
    "# Skills",
    "",
    "Operational know-how distilled into self-contained recipes. Each subfolder is a single skill: a `SKILL.md` with frontmatter plus optional helper files.",
    "",
    "This index is maintained by HivemindOS skill import. Edit individual `SKILL.md` files at the source when a provider owns them, then import again to mirror them here.",
    "",
    "## Index",
    "",
  ];

  for (const [label, skills] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${label}`, "");
    for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
      const linkPath = skill.relativePath.replace(/\.md$/i, "");
      lines.push(`- [[${linkPath}]] - ${skill.description || skill.name}`);
    }
    lines.push("");
  }

  await writeFile(inventory.readmePath, `${lines.join("\n").trim()}\n`, "utf8");
}
