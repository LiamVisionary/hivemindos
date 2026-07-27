import { cp, mkdir, readFile, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import {
  auditSkillDirectory,
  auditSkillInput,
  createSkillManifest,
  normalizeAgentAgnosticSkill,
  SKILL_MANIFEST_FILE,
  sourceRefFromGitHubUrl,
} from "@/lib/services/skills/skill-os";
import type { BrainSkillInventory, BrainSkillSummary } from "@/lib/services/obsidian/brain-skills";

const SOURCE_METADATA_FILE = ".hivemind-skill-source.json";
const SKIPPED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", ".archive"]);

export type RemoteBrainSkillInput = {
  slug?: string;
  name?: string;
  description?: string;
  source?: string;
  category?: string;
  skillMdUrl?: string;
  githubUrl?: string;
  packagedPath?: string;
};

type RemoteBrainSkillImportDependencies = {
  getInventory: (vaultPath?: string) => Promise<BrainSkillInventory>;
  nextDestinationSlug: (
    skillsFolder: string,
    slug: string,
    provider: "shared",
    sharedBySlug: Map<string, BrainSkillSummary>,
  ) => Promise<string>;
  writeSkillsReadme: (inventory: BrainSkillInventory) => Promise<void>;
  sanitizeSlug: (value: string) => string;
  slugToName: (slug: string) => string;
  skillNameFromMarkdown: (markdown: string) => string;
  firstParagraph: (markdown: string) => string;
};

export async function importRemoteBrainSkillWithDependencies(
  input: { vaultPath?: string; skill: RemoteBrainSkillInput },
  dependencies: RemoteBrainSkillImportDependencies,
): Promise<BrainSkillInventory> {
  const before = await dependencies.getInventory(input.vaultPath);
  await mkdir(before.skillsFolder, { recursive: true });
  const skill = input.skill;
  const slug = dependencies.sanitizeSlug(skill.slug || skill.name || "skill");
  const sharedBySlug = new Map(before.shared.map((item) => [item.slug, item]));
  const destinationSlug = await dependencies.nextDestinationSlug(before.skillsFolder, slug, "shared", sharedBySlug);
  const destinationDir = join(before.skillsFolder, destinationSlug);
  await mkdir(destinationDir, { recursive: true });

  if (skill.packagedPath?.trim()) {
    await installPackagedSkill({
      destinationDir,
      destinationSlug,
      skill: { ...skill, packagedPath: skill.packagedPath },
      dependencies,
    });
  } else {
    await installRemoteCatalogSkill({ destinationDir, destinationSlug, skill, dependencies });
  }

  const after = await dependencies.getInventory(input.vaultPath);
  await dependencies.writeSkillsReadme(after);
  return after;
}

async function installPackagedSkill(input: {
  destinationDir: string;
  destinationSlug: string;
  skill: RemoteBrainSkillInput & { packagedPath: string };
  dependencies: RemoteBrainSkillImportDependencies;
}) {
  const sourceDir = resolvePackagedSkillDir(input.skill.packagedPath);
  const sourceSkillPath = join(sourceDir, "SKILL.md");
  const rawMarkdown = await readFile(sourceSkillPath, "utf8").catch(() => "");
  if (!rawMarkdown.trim()) throw new Error("Packaged skill is missing SKILL.md.");
  const sourceMetadata = await readSourceMetadata(sourceDir);
  const sourceRef = typeof sourceMetadata?.commit === "string"
    ? sourceMetadata.commit
    : `packaged:${input.skill.packagedPath}`;
  const sourceUrl = typeof sourceMetadata?.sourceUrl === "string"
    ? sourceMetadata.sourceUrl
    : input.skill.githubUrl || input.skill.skillMdUrl || "";
  await rm(input.destinationDir, { recursive: true, force: true });
  await cp(sourceDir, input.destinationDir, {
    recursive: true,
    force: true,
    filter: (path) => !path.split(/[\\/]/).some((part) => SKIPPED_DIRS.has(part)),
  });
  const markdown = normalizeAgentAgnosticSkill(rawMarkdown, input.skill.source || input.skill.packagedPath);
  await writeFile(join(input.destinationDir, "SKILL.md"), markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  const audit = await auditSkillDirectory({
    slug: input.destinationSlug,
    dir: input.destinationDir,
    sourceRef,
  });
  if (audit.status === "blocked") {
    await rm(input.destinationDir, { recursive: true, force: true });
    throw new Error(`Skill audit blocked ${input.destinationSlug}: ${audit.findings.map((finding) => finding.title).join(", ")}`);
  }
  await writeFile(join(input.destinationDir, SKILL_MANIFEST_FILE), JSON.stringify(createSkillManifest({
    slug: input.destinationSlug,
    name: input.skill.name || input.dependencies.skillNameFromMarkdown(markdown),
    description: input.skill.description || input.dependencies.firstParagraph(markdown) || "Shared agent skill.",
    sourceType: "pack",
    sourceLabel: input.skill.source || "HivemindOS optional packaged skills",
    sourceUrl,
    sourceRef,
    sourcePath: input.skill.packagedPath,
    audit,
    markdown,
  }), null, 2), "utf8");
  await writeFile(join(input.destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
    ...(sourceMetadata ?? {}),
    provider: "packaged-optional",
    providerLabel: input.skill.source || "HivemindOS optional packaged skills",
    sourceUrl,
    sourcePath: input.skill.packagedPath,
    agentAgnostic: true,
    auditStatus: audit.status,
    capabilities: audit.capabilities,
    envKeys: audit.envKeys,
    installedAt: new Date().toISOString(),
  }, null, 2), "utf8");
}

async function installRemoteCatalogSkill(input: {
  destinationDir: string;
  destinationSlug: string;
  skill: RemoteBrainSkillInput;
  dependencies: RemoteBrainSkillImportDependencies;
}) {
  let markdown = "";
  if (input.skill.skillMdUrl) {
    const response = await fetch(input.skill.skillMdUrl, { signal: AbortSignal.timeout(12_000) });
    if (response.ok) markdown = await response.text();
  }
  if (!markdown.trim()) {
    markdown = [
      "---",
      `name: "${(input.skill.name || input.dependencies.slugToName(input.destinationSlug)).replace(/"/g, "'")}"`,
      `description: "${(input.skill.description || "Shared agent skill.").replace(/"/g, "'")}"`,
      "---",
      "",
      `# ${input.skill.name || input.dependencies.slugToName(input.destinationSlug)}`,
      "",
      input.skill.description || "Use this skill when its title matches the task.",
      "",
      "## Source",
      "",
      input.skill.githubUrl ? `- Repository: ${input.skill.githubUrl}` : "",
      input.skill.skillMdUrl ? `- SKILL.md: ${input.skill.skillMdUrl}` : "",
    ].filter(Boolean).join("\n");
  }
  markdown = normalizeAgentAgnosticSkill(markdown, input.skill.source || input.skill.githubUrl || input.skill.skillMdUrl || "remote catalog");
  const sourceRef = input.skill.githubUrl ? sourceRefFromGitHubUrl(input.skill.githubUrl) : input.skill.skillMdUrl;
  const audit = await auditSkillInput({ slug: input.destinationSlug, markdown, sourceRef });
  if (audit.status === "blocked") {
    await rm(input.destinationDir, { recursive: true, force: true });
    throw new Error(`Skill audit blocked ${input.destinationSlug}: ${audit.findings.map((finding) => finding.title).join(", ")}`);
  }
  await writeFile(join(input.destinationDir, "SKILL.md"), markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
  await writeFile(join(input.destinationDir, SKILL_MANIFEST_FILE), JSON.stringify(createSkillManifest({
    slug: input.destinationSlug,
    name: input.skill.name || input.dependencies.slugToName(input.destinationSlug),
    description: input.skill.description || "Shared agent skill.",
    sourceType: "registry",
    sourceLabel: input.skill.source || "Skill browser",
    sourceUrl: input.skill.skillMdUrl || input.skill.githubUrl || "",
    sourceRef,
    audit,
    markdown,
  }), null, 2), "utf8");
  await writeFile(join(input.destinationDir, SOURCE_METADATA_FILE), JSON.stringify({
    provider: "remote",
    providerLabel: input.skill.source || "Skill browser",
    sourceUrl: input.skill.skillMdUrl || input.skill.githubUrl || "",
    agentAgnostic: true,
    auditStatus: audit.status,
    capabilities: audit.capabilities,
    envKeys: audit.envKeys,
    importedAt: new Date().toISOString(),
  }, null, 2), "utf8");
}

function resolvePackagedSkillDir(packagedPath: string) {
  const packageRoot = resolve(process.cwd(), "packaged-skills");
  const sourceDir = resolve(process.cwd(), packagedPath.trim());
  if (sourceDir !== packageRoot && !sourceDir.startsWith(`${packageRoot}/`)) {
    throw new Error("Packaged skill path is outside the HivemindOS packaged-skills folder.");
  }
  return sourceDir;
}

async function readSourceMetadata(skillDir: string): Promise<Record<string, unknown> | null> {
  const raw = await readFile(join(skillDir, SOURCE_METADATA_FILE), "utf8").catch(() => "");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
