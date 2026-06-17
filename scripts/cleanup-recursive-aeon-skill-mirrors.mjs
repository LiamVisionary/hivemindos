#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const metadataFile = ".hivemind-skill-source.json";
const knownProviderSlugPrefixes = new Set([
  "aeon",
  "claude",
  "codex",
  "hermes",
  "gemini",
  "openclaw",
  "shared",
  "shared-brain",
]);

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function expandHome(value) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function sanitizeSlug(value) {
  return (
    String(value || "skill")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "skill"
  );
}

function skillDirSlugFromSourcePath(sourcePath) {
  const normalized = normalizePath(sourcePath);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) return "";
  const last = String(parts[parts.length - 1] || "").toLowerCase();
  return sanitizeSlug(last === "skill.md" ? parts[parts.length - 2] : parts[parts.length - 1]);
}

function looksProviderPrefixed(slug) {
  const firstSegment = sanitizeSlug(slug).split("-").find(Boolean);
  return Boolean(firstSegment && knownProviderSlugPrefixes.has(firstSegment));
}

function isRecursiveAeonMirror(slug, metadata) {
  if (metadata?.provider !== "aeon") return false;
  const sourcePath = normalizePath(metadata.sourcePath);
  if (!sourcePath.includes("/.aeon/skills/")) return false;
  return looksProviderPrefixed(slug) || looksProviderPrefixed(skillDirSlugFromSourcePath(sourcePath));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path) {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function findCandidates(skillsFolder) {
  const entries = await readdir(skillsFolder, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillDir = join(skillsFolder, entry.name);
    const skillPath = join(skillDir, "SKILL.md");
    const metadataPath = join(skillDir, metadataFile);
    if (!existsSync(skillPath) || !existsSync(metadataPath)) continue;
    const metadata = await readJson(metadataPath);
    if (!isRecursiveAeonMirror(entry.name, metadata)) continue;
    const skillText = await readFile(skillPath, "utf8").catch(() => "");
    candidates.push({
      slug: entry.name,
      path: skillDir,
      sourcePath: String(metadata?.sourcePath || ""),
      sourceMachine: String(metadata?.sourceMachine || ""),
      sourceChecksum: String(metadata?.sourceChecksum || ""),
      skillChecksum: skillText ? sha256(skillText) : "",
      reason: "Recursive AEON provider mirror",
    });
  }
  candidates.sort((left, right) => left.slug.localeCompare(right.slug));
  return candidates;
}

async function refreshSkillsReadme(vaultPath) {
  const { getSharedBrainSkills, writeSkillsReadme } = await import(
    "../src/lib/services/obsidian/brain-skills.ts"
  );
  const shared = await getSharedBrainSkills(vaultPath, { summaryMode: "fast" });
  await writeSkillsReadme({
    ...shared,
    providers: [],
    totals: { shared: shared.shared.length, providerSkills: 0, importable: 0 },
  });
}

const vaultPath = resolve(expandHome(argValue("--vault") || process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH || "~/Documents/Obsidian/hivemindos-vault"));
const apply = process.argv.includes("--apply");
const skillsFolder = join(vaultPath, "Skills");
const manifestDir = join(vaultPath, "Operations", "Vault Migrations");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const manifestPath = join(manifestDir, `recursive-aeon-skill-mirror-cleanup-${timestamp}.json`);

if (!existsSync(skillsFolder)) {
  throw new Error(`Skills folder not found: ${skillsFolder}`);
}

const candidates = await findCandidates(skillsFolder);
const manifest = {
  generatedAt: new Date().toISOString(),
  dryRun: !apply,
  vaultPath,
  skillsFolder,
  candidateCount: candidates.length,
  removedCount: 0,
  retainedAeonSourceHint: "Non-provider-prefixed AEON imports are retained for manual review.",
  candidates,
};

await mkdir(manifestDir, { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

let removedCount = 0;
if (apply) {
  for (const candidate of candidates) {
    if (dirname(candidate.path) !== skillsFolder || basename(candidate.path) !== candidate.slug) {
      throw new Error(`Refusing to delete unexpected path: ${candidate.path}`);
    }
    await rm(candidate.path, { recursive: true, force: true });
    removedCount += 1;
  }
  manifest.removedCount = removedCount;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await refreshSkillsReadme(vaultPath);
}

console.log(`${apply ? "Removed" : "Would remove"} ${candidates.length} recursive AEON skill mirror director${candidates.length === 1 ? "y" : "ies"}.`);
console.log(`Manifest: ${manifestPath}`);
