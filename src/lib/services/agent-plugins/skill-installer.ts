import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { invalidateCachedCall } from "@/lib/services/async-cache";
import {
  getBrainSkillInventory,
  invalidateSkillFileListCache,
  SHARED_BRAIN_CACHE_PREFIX,
  writeSkillsReadme,
} from "@/lib/services/obsidian/brain-skills";
import {
  auditSkillDirectory,
  createSkillManifest,
  SKILL_MANIFEST_FILE,
} from "@/lib/services/skills/skill-os";
import type {
  AgentPluginDiagnostic,
  AgentPluginInspection,
  AgentPluginSkill,
} from "./loader";

const SOURCE_METADATA_FILE = ".hivemind-skill-source.json";
const PLUGIN_METADATA_FILE = ".hivemind-agent-plugin.json";
const PLUGIN_SKILLS_FOLDER = "agent-plugins";

export type AgentPluginSkillInstallResult = {
  name: string;
  slug: string;
  destinationPath?: string;
  status: "installed" | "updated" | "skipped";
  reason?: string;
  archivePath?: string;
};

export type AgentPluginSkillsInstallReport = {
  vaultPath?: string;
  skillsFolder?: string;
  results: AgentPluginSkillInstallResult[];
  diagnostics: AgentPluginDiagnostic[];
};

function isWithin(root: string, target: string, allowRoot = true) {
  const rel = relative(root, target);
  return (allowRoot && rel === "") || (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
}

function safeArchivePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "component";
}

function sourceRef(inspection: AgentPluginInspection) {
  const version = inspection.manifest?.version ? "@" + inspection.manifest.version : "";
  return "agent-plugin:" + inspection.manifest?.name + version;
}

function pluginRootHash(root: string) {
  return createHash("sha256").update(root).digest("hex");
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyContainedTree(input: {
  pluginRoot: string;
  sourceDir: string;
  destinationDir: string;
  skill: AgentPluginSkill;
  diagnostics: AgentPluginDiagnostic[];
}) {
  const visitedDirectories = new Set<string>();
  const pluginRoot = await realpath(input.pluginRoot);

  async function copyDirectory(source: string, destination: string, relativePath: string): Promise<void> {
    const resolvedSource = await realpath(source);
    if (!isWithin(pluginRoot, resolvedSource)) {
      input.diagnostics.push({
        severity: "warning",
        code: "skill-resource-denied",
        message: "Skipped a skill resource that resolves outside the plugin root.",
        component: "skill",
        componentId: input.skill.name,
        path: relativePath || basename(source),
      });
      return;
    }
    if (visitedDirectories.has(resolvedSource)) {
      input.diagnostics.push({
        severity: "warning",
        code: "skill-resource-cycle-skipped",
        message: "Skipped a repeated skill resource directory to avoid a symlink cycle.",
        component: "skill",
        componentId: input.skill.name,
        path: relativePath || basename(source),
      });
      return;
    }
    visitedDirectories.add(resolvedSource);
    await mkdir(destination, { recursive: true });

    const entries = await readdir(resolvedSource, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".git") continue;
      const logicalSource = join(source, entry.name);
      let resolvedEntry: string;
      try {
        resolvedEntry = await realpath(logicalSource);
      } catch {
        continue;
      }
      const childRelative = relativePath ? relativePath + "/" + entry.name : entry.name;
      if (!isWithin(pluginRoot, resolvedEntry)) {
        input.diagnostics.push({
          severity: "warning",
          code: "skill-resource-denied",
          message: "Skipped a skill resource that resolves outside the plugin root.",
          component: "skill",
          componentId: input.skill.name,
          path: childRelative,
        });
        continue;
      }
      const entryStat = await stat(resolvedEntry).catch(() => null);
      if (!entryStat) continue;
      const destinationPath = join(destination, entry.name);
      if (entryStat.isDirectory()) {
        await copyDirectory(logicalSource, destinationPath, childRelative);
        continue;
      }
      if (!entryStat.isFile()) continue;
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(resolvedEntry, destinationPath);
      await chmod(destinationPath, entryStat.mode & 0o777).catch(() => {});
    }
  }

  await copyDirectory(input.sourceDir, input.destinationDir, "");
}

async function managedDestination(path: string, pluginName: string, skillName: string) {
  if (!(await pathExists(path))) return { exists: false, managed: false };
  const markerPath = join(path, PLUGIN_METADATA_FILE);
  const marker = await readFile(markerPath, "utf8")
    .then((value) => JSON.parse(value) as Record<string, unknown>)
    .catch(() => null);
  return {
    exists: true,
    managed: marker?.managedBy === "hivemindos"
      && marker?.format === "agent-plugins-1.0.0"
      && marker?.pluginName === pluginName
      && marker?.skillName === skillName,
  };
}

async function installOneSkill(input: {
  inspection: AgentPluginInspection;
  skill: AgentPluginSkill;
  skillsFolder: string;
  diagnostics: AgentPluginDiagnostic[];
}): Promise<AgentPluginSkillInstallResult> {
  const manifest = input.inspection.manifest!;
  const pluginFolder = join(input.skillsFolder, PLUGIN_SKILLS_FOLDER, manifest.name);
  const destination = resolve(pluginFolder, input.skill.name);
  if (!isWithin(resolve(input.skillsFolder), destination, false)) {
    return {
      name: input.skill.name,
      slug: input.skill.name,
      status: "skipped",
      reason: "Destination escaped the shared Skills folder.",
    };
  }

  const existing = await managedDestination(destination, manifest.name, input.skill.name);
  if (existing.exists && !existing.managed) {
    return {
      name: input.skill.name,
      slug: relative(input.skillsFolder, destination).replaceAll("\\", "/"),
      status: "skipped",
      reason: "A non-plugin-managed skill already occupies the destination.",
    };
  }

  const stageRoot = join(input.skillsFolder, ".archive", ".agent-plugin-staging");
  const stage = join(stageRoot, safeArchivePart(manifest.name + "-" + input.skill.name) + "-" + randomUUID());
  await mkdir(stageRoot, { recursive: true });
  await copyContainedTree({
    pluginRoot: input.inspection.pluginRoot,
    sourceDir: input.skill.directoryPath,
    destinationDir: stage,
    skill: input.skill,
    diagnostics: input.diagnostics,
  });

  const audit = await auditSkillDirectory({
    slug: input.skill.name,
    dir: stage,
    sourceRef: sourceRef(input.inspection),
  });
  if (audit.status === "blocked") {
    await rm(stage, { recursive: true, force: true });
    return {
      name: input.skill.name,
      slug: relative(input.skillsFolder, destination).replaceAll("\\", "/"),
      status: "skipped",
      reason: "HivemindOS security audit blocked this skill: " + audit.findings.map((finding) => finding.title).join(", "),
    };
  }

  const markdown = await readFile(join(stage, "SKILL.md"), "utf8");
  await writeFile(join(stage, SKILL_MANIFEST_FILE), JSON.stringify(createSkillManifest({
    slug: input.skill.name,
    name: input.skill.name,
    description: input.skill.description,
    sourceType: "provider",
    sourceLabel: "Agent Plugin " + manifest.name,
    sourceUrl: manifest.homepage,
    sourceRepo: manifest.repository,
    sourceRef: sourceRef(input.inspection),
    sourcePath: "skills/" + input.skill.directoryName,
    audit,
    markdown,
  }), null, 2) + "\n", "utf8");
  await writeFile(join(stage, SOURCE_METADATA_FILE), JSON.stringify({
    provider: "agent-plugin",
    providerLabel: "Agent Plugin " + manifest.name,
    managedBy: "hivemindos",
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    skillName: input.skill.name,
    specificationVersion: input.inspection.specificationVersion,
    sourceRootHash: pluginRootHash(input.inspection.pluginRoot),
    importedAt: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
  await writeFile(join(stage, PLUGIN_METADATA_FILE), JSON.stringify({
    managedBy: "hivemindos",
    format: "agent-plugins-1.0.0",
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    skillName: input.skill.name,
    sourceRootHash: pluginRootHash(input.inspection.pluginRoot),
  }, null, 2) + "\n", "utf8");

  await mkdir(pluginFolder, { recursive: true });
  let archivePath: string | undefined;
  if (existing.exists) {
    archivePath = join(
      input.skillsFolder,
      ".archive",
      "agent-plugins",
      safeArchivePart(manifest.name),
      safeArchivePart(input.skill.name) + "-" + new Date().toISOString().replace(/[:.]/g, "-"),
    );
    await mkdir(dirname(archivePath), { recursive: true });
    await rename(destination, archivePath);
  }

  try {
    await rename(stage, destination);
  } catch (error) {
    if (archivePath && await pathExists(archivePath) && !(await pathExists(destination))) {
      await rename(archivePath, destination).catch(() => {});
    }
    await rm(stage, { recursive: true, force: true });
    throw error;
  }

  return {
    name: input.skill.name,
    slug: relative(input.skillsFolder, destination).replaceAll("\\", "/"),
    destinationPath: destination,
    status: existing.exists ? "updated" : "installed",
    archivePath,
  };
}

export async function installAgentPluginSkills(input: {
  inspection: AgentPluginInspection;
  vaultPath?: string;
}): Promise<AgentPluginSkillsInstallReport> {
  if (!input.inspection.valid || !input.inspection.manifest) {
    return {
      results: [],
      diagnostics: [{
        severity: "error",
        code: "plugin-rejected",
        message: "Skills were not installed because the plugin manifest is invalid.",
        component: "plugin",
      }],
    };
  }
  if (!input.inspection.skills.length) return { results: [], diagnostics: [] };

  const diagnostics: AgentPluginDiagnostic[] = [];
  const before = await getBrainSkillInventory(input.vaultPath);
  await mkdir(before.skillsFolder, { recursive: true });
  const results: AgentPluginSkillInstallResult[] = [];
  for (const skill of input.inspection.skills) {
    try {
      results.push(await installOneSkill({
        inspection: input.inspection,
        skill,
        skillsFolder: before.skillsFolder,
        diagnostics,
      }));
    } catch (error) {
      results.push({
        name: skill.name,
        slug: skill.name,
        status: "skipped",
        reason: error instanceof Error ? error.message : "Skill installation failed.",
      });
    }
  }

  invalidateSkillFileListCache();
  invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
  const after = await getBrainSkillInventory(input.vaultPath);
  await writeSkillsReadme(after);
  return {
    vaultPath: after.vaultPath,
    skillsFolder: after.skillsFolder,
    results,
    diagnostics,
  };
}
