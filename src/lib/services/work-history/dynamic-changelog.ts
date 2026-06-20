import { access, readFile, readdir, stat } from "fs/promises";
import { constants } from "fs";
import { homedir } from "@/lib/home-dir";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import type { WorkHistoryEntry, WorkHistoryPayload, WorkHistoryProject } from "@/lib/types/work-history";

const MAX_SCAN_DEPTH = 4;
const MAX_CHANGELOG_FILES = 80;
const MAX_CHANGELOG_BYTES = 512_000;
const DEFAULT_HISTORY_LIMIT = 10;
const MAX_HISTORY_LIMIT = 50;
const HISTORY_CACHE_TTL_MS = 60_000;
const SKIPPED_DIRS = new Set([".git", ".next", ".obsidian", ".trash", "node_modules", "dist", "build", "coverage"]);
const TZ_OFFSETS: Record<string, string> = {
  WITA: "+08:00",
  WIT: "+09:00",
  WIB: "+07:00",
  UTC: "Z",
};
const CHANGELOG_HEADING_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?(?:\s+(?:[A-Z]{2,5}|[+-]\d{2}(?::?\d{2})?))?(?:\s+[+-]\d{4})?)?)\s+-\s+/;

type ChangelogCandidate = {
  file: string;
  root: string;
  source: WorkHistoryProject["source"];
};

type ListOptions = {
  vaultPath?: string;
  project?: string;
  query?: string;
  limit?: number;
  offset?: number;
};

type WorkHistoryIndex = {
  projects: WorkHistoryProject[];
  entries: WorkHistoryEntry[];
};

const historyIndexCache = new Map<string, { cachedAt: number; index: WorkHistoryIndex }>();

export async function listDynamicWorkHistory(options: ListOptions = {}): Promise<WorkHistoryPayload> {
  const index = await readWorkHistoryIndex(options.vaultPath);
  const query = options.query?.trim().toLowerCase();
  const projectFilter = options.project?.trim();
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const filteredEntries = index.entries
    .filter((entry) => !projectFilter || entry.projectId === projectFilter)
    .filter((entry) => {
      if (!query) return true;
      return [entry.projectName, entry.title, entry.status, entry.areas, entry.summary, entry.body]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .sort((a, b) => b.sortTime - a.sortTime || a.projectName.localeCompare(b.projectName));
  const pageEntries = filteredEntries.slice(offset, offset + limit);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    projects: index.projects,
    entries: pageEntries,
    totalEntries: filteredEntries.length,
    offset,
    limit,
    hasMore: offset + pageEntries.length < filteredEntries.length,
    truncated: filteredEntries.length > pageEntries.length,
  };
}

async function readWorkHistoryIndex(vaultPath?: string): Promise<WorkHistoryIndex> {
  const cacheKey = `${resolve(process.cwd())}:${resolveObsidianVaultPath(vaultPath)}`;
  const cached = historyIndexCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < HISTORY_CACHE_TTL_MS) return cached.index;

  const candidates = await findChangelogCandidates(vaultPath);
  const projects = new Map<string, WorkHistoryProject>();
  const entries: WorkHistoryEntry[] = [];

  for (const candidate of candidates) {
    const project = projectFromCandidate(candidate);
    projects.set(project.id, project);
    const raw = await readFile(candidate.file, "utf-8").catch(() => "");
    if (!raw.trim()) continue;
    entries.push(...parseChangelog(raw, project));
  }

  const index = {
    projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
    entries: dedupeWorkHistoryEntries(entries),
  };
  historyIndexCache.set(cacheKey, { cachedAt: Date.now(), index });
  return index;
}

function dedupeWorkHistoryEntries(entries: WorkHistoryEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = [
      entry.projectId,
      compactDedupeKey(entry.timestamp),
      compactDedupeKey(entry.title),
      compactDedupeKey(entry.status),
      compactDedupeKey(entry.commitSummary),
      compactDedupeKey(entry.summary),
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactDedupeKey(value?: string) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function clampLimit(limit?: number) {
  if (!Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.max(Math.floor(limit ?? DEFAULT_HISTORY_LIMIT), 1), MAX_HISTORY_LIMIT);
}

function clampOffset(offset?: number) {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.floor(offset ?? 0));
}

async function findChangelogCandidates(vaultPath?: string): Promise<ChangelogCandidate[]> {
  const cwd = resolve(process.cwd());
  const projectRoot = resolve(homedir(), "Documents/code/projects");
  const vaultRoot = resolveObsidianVaultPath(vaultPath);
  const roots: Array<{ root: string; source: WorkHistoryProject["source"]; depth: number }> = [
    { root: cwd, source: "workspace", depth: 1 },
    { root: projectRoot, source: "projects", depth: MAX_SCAN_DEPTH },
    { root: join(vaultRoot, "Projects"), source: "vault", depth: MAX_SCAN_DEPTH },
  ];

  const seen = new Set<string>();
  const candidates: ChangelogCandidate[] = [];
  for (const item of roots) {
    if (candidates.length >= MAX_CHANGELOG_FILES) break;
    if (!(await canReadDir(item.root))) continue;
    for (const file of await findChangelogs(item.root, item.depth)) {
      if (seen.has(file)) continue;
      seen.add(file);
      candidates.push({ file, root: item.root, source: item.source });
      if (candidates.length >= MAX_CHANGELOG_FILES) break;
    }
  }
  return candidates;
}

async function findChangelogs(root: string, maxDepth: number, depth = 0, output: string[] = []): Promise<string[]> {
  if (output.length >= MAX_CHANGELOG_FILES || depth > maxDepth) return output;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= MAX_CHANGELOG_FILES) break;
    if (entry.name.startsWith(".") && SKIPPED_DIRS.has(entry.name)) continue;
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await findChangelogs(fullPath, maxDepth, depth + 1, output);
    } else if (entry.isFile() && entry.name === "CHANGELOG.md") {
      const fileStat = await stat(fullPath).catch(() => null);
      if (fileStat && fileStat.size <= MAX_CHANGELOG_BYTES) output.push(fullPath);
    }
  }
  return output;
}

async function canReadDir(path: string) {
  try {
    const pathStat = await stat(path);
    await access(path, constants.R_OK);
    return pathStat.isDirectory();
  } catch {
    return false;
  }
}

function projectFromCandidate(candidate: ChangelogCandidate): WorkHistoryProject {
  const root = candidate.source === "workspace"
    ? dirname(candidate.file)
    : projectRootFromChangelog(candidate.file, candidate.root);
  const name = humanizeProjectName(basename(root));
  const id = `${candidate.source}:${relative(candidate.root, root).split(sep).join("/") || name}`;
  return {
    id,
    name,
    root,
    source: candidate.source,
    changelogPath: candidate.file,
  };
}

function projectRootFromChangelog(file: string, scanRoot: string) {
  const relativeParts = relative(scanRoot, dirname(file)).split(sep).filter(Boolean);
  if (relativeParts.length === 0) return dirname(file);
  return resolve(scanRoot, relativeParts[0]);
}

function humanizeProjectName(name: string) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseChangelog(raw: string, project: WorkHistoryProject): WorkHistoryEntry[] {
  const matches = [...raw.matchAll(/^##\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const heading = match[1].trim();
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? raw.length;
    const body = raw.slice(bodyStart, bodyEnd).trim();
    const timestamp = extractTimestamp(heading);
    const title = extractTitle(heading);
    const fields = extractBulletFields(body);
    const summary = fields.summary || firstParagraph(body) || title;
    const sortTime = parseChangelogTime(timestamp) ?? -index;
    return {
      id: `${project.id}:${heading}:${index}`,
      projectId: project.id,
      projectName: project.name,
      source: project.source,
      changelogPath: project.changelogPath,
      heading,
      title: cleanCompactText(title) ?? title,
      timestamp,
      status: cleanCompactText(fields.status),
      areas: cleanAreasText(fields.areas),
      summary,
      verification: cleanDetailText(fields.verification),
      commitSummary: cleanCommitSummaryText(fields.commitSummary),
      body,
      sortTime,
    };
  });
}

function extractTimestamp(heading: string) {
  return heading.match(CHANGELOG_HEADING_TIMESTAMP_PATTERN)?.[1]
    ?? heading.match(/(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?(?:\s+(?:[A-Z]{2,5}|[+-]\d{2}(?::?\d{2})?))?(?:\s+[+-]\d{4})?)?)/)?.[1];
}

function extractTitle(heading: string) {
  return heading.replace(CHANGELOG_HEADING_TIMESTAMP_PATTERN, "").trim();
}

const CHANGELOG_FIELD_GROUPS = {
  status: ["Status"],
  areas: ["Areas changed", "Files or areas changed", "Files changed"],
  summary: ["Summary"],
  verification: ["Verification", "Verification performed", "Checks", "Tests"],
  commitSummary: [
    "Intended commit message",
    "Intended commit-message",
    "Intended commit-message summary",
    "Commit message",
    "Commit-message summary",
    "Commit summary",
  ],
} as const;

const CHANGELOG_FIELD_NAMES = Object.values(CHANGELOG_FIELD_GROUPS).flat();
const CHANGELOG_FIELD_START_PATTERN = new RegExp(`^\\s*-\\s+(?:${CHANGELOG_FIELD_NAMES.map(escapeRegExp).join("|")}):\\s*`, "i");

function extractBulletFields(body: string) {
  const field = (names: readonly string[]) => extractFieldValue(body, names);
  return {
    status: field(CHANGELOG_FIELD_GROUPS.status),
    areas: field(CHANGELOG_FIELD_GROUPS.areas),
    summary: field(CHANGELOG_FIELD_GROUPS.summary),
    verification: field(CHANGELOG_FIELD_GROUPS.verification),
    commitSummary: field(CHANGELOG_FIELD_GROUPS.commitSummary),
  };
}

function extractFieldValue(body: string, names: readonly string[]) {
  const fieldStartPattern = new RegExp(`^\\s*-\\s+(?:${names.map(escapeRegExp).join("|")}):\\s*(.*)$`, "im");
  const match = fieldStartPattern.exec(body);
  if (!match) return undefined;
  const lines = [match[1] ?? ""];
  const rest = body.slice((match.index ?? 0) + match[0].length);
  for (const line of rest.split("\n")) {
    if (CHANGELOG_FIELD_START_PATTERN.test(line)) break;
    lines.push(line);
  }
  return normalizeFieldMarkdown(lines.join("\n"));
}

function normalizeFieldMarkdown(value: string) {
  const normalized = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s{2}/, ""))
    .join("\n")
    .trim();
  return normalized || undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstParagraph(body: string) {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/^-+\s*/gm, "").trim())
    .find(Boolean);
}

function cleanCompactText(value?: string) {
  return value
    ?.trim()
    .replace(/^`([^`]+)`$/, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1");
}

function cleanAreasText(value?: string) {
  const compact = cleanCompactText(value);
  if (!compact) return compact;
  return compact
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .join(", ");
}

function cleanCommitSummaryText(value?: string) {
  return cleanCompactText(value)
    ?.split(/\n+/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .find(Boolean);
}

function cleanDetailText(value?: string) {
  const compact = cleanCompactText(value);
  if (!compact) return compact;
  return compact
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .join("; ");
}

function parseChangelogTime(timestamp?: string) {
  if (!timestamp) return undefined;
  const normalized = timestamp
    .replace(/\s+[A-Z]{2,5}\s+([+-]\d{4})$/, " $1")
    .replace(/\s+[+-]\d{2}\s+([+-]\d{4})$/, " $1")
    .replace(/\s+([A-Z]{2,5})$/, (_, zone) => TZ_OFFSETS[zone] ? ` ${TZ_OFFSETS[zone]}` : "")
    .replace(/\s+([+-]\d{2})$/, " $1:00");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}
