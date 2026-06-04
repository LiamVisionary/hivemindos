#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";

const DEFAULT_VAULT = "~/Documents/Obsidian/hivemindos-vault";
const MIGRATION_ROOT = "Operations/Vault Migrations";
const IGNORE_ROOTS = new Set([".git", ".obsidian", ".trash"]);
const LEGACY_ROOT_FOLDERS = new Set([
  "Inbox",
  "agent-notifications",
  "kanban",
  "claw-code",
  "foo-empty",
  ".omni-sync-test",
]);

const notesMigration = new Map([
  ["Notes/Secure", "Operations/Secure"],
  ["Notes/Daily Briefings", "Memory/Daily Briefings"],
  ["Notes/Weekly Reviews", "Memory/Weekly Reviews"],
  ["Notes/Imported Sources", "Memory/Imported Sources"],
  ["Notes/Readwise", "Memory/Imported Sources/Readwise"],
  ["Notes/Web Clips", "Memory/Imported Sources/Web Clips"],
  ["Notes/Podcast Clips", "Synthesis/Podcast Clips"],
  ["Notes/Project Autopilot", "Operations/Automations/Project Autopilot"],
]);

const rootMigrations = new Map([
  ["Scheduled", "Operations/Automations"],
]);

function parseArgs(argv) {
  const args = { fix: false, json: false, includeArchive: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fix") args.fix = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--include-archive") args.includeArchive = true;
    else if (arg === "--vault") args.vault = argv[++index];
    else if (arg === "--archive-root") args.archiveRoot = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function expandHome(path) {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function slash(path) {
  return path.split(/[\\/]+/).filter(Boolean).join("/");
}

function todayStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

function conflictArtifact(path) {
  const name = basename(path);
  return /(sync-conflict|conflicted copy|from-HivemindOS-Vault|pre-HivemindOS|pre-omni|pre-collector|-migration\.bak|\.bak$)/i.test(name);
}

function shouldSkip(relPath, includeArchive) {
  const normalized = slash(relPath);
  const first = normalized.split("/")[0];
  if (IGNORE_ROOTS.has(first)) return true;
  return !includeArchive && normalized.startsWith(`${MIGRATION_ROOT}/`);
}

async function walk(root, includeArchive) {
  const entries = [];
  async function visit(path) {
    const relPath = slash(relative(root, path));
    if (relPath && shouldSkip(relPath, includeArchive)) return;
    const stats = await stat(path).catch(() => null);
    if (!stats) return;
    entries.push({ path, relPath, stats });
    if (!stats.isDirectory()) return;
    for (const entry of await readdir(path)) {
      await visit(join(path, entry));
    }
  }
  await visit(root);
  return entries;
}

async function skillHash(path) {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
}

async function skillMetadata(dir) {
  const raw = await readFile(join(dir, ".hivemind-skill-source.json"), "utf8").catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function targetArchivePath(archiveRoot, category, relPath) {
  return join(archiveRoot, category, slash(relPath));
}

async function uniquePath(path) {
  if (!(await exists(path))) return path;
  const ext = extname(path);
  const base = ext ? path.slice(0, -ext.length) : path;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not find unique target for ${path}`);
}

async function movePath(source, destination, manifest, reason) {
  if (!(await exists(source))) return null;
  const sourceStats = await stat(source);
  if (sourceStats.isDirectory() && await isDirectory(destination)) {
    for (const entry of await readdir(source)) {
      await movePath(join(source, entry), join(destination, entry), manifest, reason);
    }
    await rmdir(source).catch(() => undefined);
    return { source, destination, reason, merged: true };
  }
  const target = await uniquePath(destination);
  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
  const record = {
    at: new Date().toISOString(),
    reason,
    source,
    destination: target,
  };
  manifest.push(record);
  return record;
}

async function findDuplicateSkills(vault) {
  const skillsRoot = join(vault, "Skills");
  if (!(await isDirectory(skillsRoot))) return [];
  const groups = new Map();
  for (const slug of await readdir(skillsRoot)) {
    const dir = join(skillsRoot, slug);
    const skillPath = join(dir, "SKILL.md");
    if (!(await isDirectory(dir)) || !(await exists(skillPath))) continue;
    const hash = await skillHash(skillPath);
    const metadata = await skillMetadata(dir);
    const item = { slug, dir, skillPath, hash, metadata };
    groups.set(hash, [...(groups.get(hash) ?? []), item]);
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length < 2) return [];
    const sorted = group.toSorted((left, right) => {
      const leftMissing = left.metadata?.status === "missing-upstream" ? 1 : 0;
      const rightMissing = right.metadata?.status === "missing-upstream" ? 1 : 0;
      if (leftMissing !== rightMissing) return leftMissing - rightMissing;
      return left.slug.localeCompare(right.slug);
    });
    return sorted.slice(1).map((item) => ({ ...item, kept: sorted[0].slug }));
  });
}

async function inspectVault(vault, includeArchive) {
  const entries = await walk(vault, includeArchive);
  const rels = new Set(entries.map((entry) => entry.relPath).filter(Boolean));
  const duplicateSkills = await findDuplicateSkills(vault);
  const conflictArtifacts = entries
    .filter((entry) => entry.relPath && !entry.stats.isDirectory() && conflictArtifact(entry.relPath))
    .map((entry) => entry.relPath);
  const legacyRootItems = [...LEGACY_ROOT_FOLDERS]
    .filter((name) => rels.has(name))
    .map((name) => ({ relPath: name }));
  for (const relPath of rels) {
    if (/^pineapple-.+\.md$/i.test(relPath)) legacyRootItems.push({ relPath });
  }
  const e2eSkills = entries
    .filter((entry) => entry.stats.isDirectory() && /^Skills\/hive-e2e-[^/]+$/i.test(entry.relPath))
    .map((entry) => entry.relPath);
  const runtimeMirrors = [];
  if (rels.has("Agents/AEON/.aeon")) {
    const isFullRuntimeMirror = rels.has("Agents/AEON/.aeon/skills")
      || rels.has("Agents/AEON/.aeon/skills.json")
      || rels.has("Agents/AEON/.aeon/aeon.yml");
    if (isFullRuntimeMirror) {
      runtimeMirrors.push({ source: "Agents/AEON/.aeon", destination: "Operations/Runtime Mirrors/AEON/.aeon" });
    }
  }
  const hiddenProfileStubs = [];
  if (rels.has("Agents/AEON/.aeon") && !runtimeMirrors.some((item) => item.source === "Agents/AEON/.aeon")) {
    hiddenProfileStubs.push("Agents/AEON/.aeon");
  }
  for (const relPath of rels) {
    if (/^Operations\/Runtime Mirrors\/AEON\/\.aeon\/(?:README-\d+\.md|profile-\d+\.json)$/i.test(relPath)) {
      hiddenProfileStubs.push(relPath);
    }
  }
  const rootMoves = [];
  for (const [source, destination] of rootMigrations) {
    if (rels.has(source)) rootMoves.push({ source, destination });
  }
  const noteMoves = [];
  for (const [source, destination] of notesMigration) {
    if (rels.has(source)) noteMoves.push({ source, destination });
  }
  const notesRoot = join(vault, "Notes");
  if (await isDirectory(notesRoot)) {
    for (const entry of await readdir(notesRoot)) {
      const source = `Notes/${entry}`;
      if (notesMigration.has(source)) continue;
      noteMoves.push({ source, destination: `Memory/Imported Sources/Legacy Notes/${entry}` });
    }
  }
  return { duplicateSkills, conflictArtifacts, legacyRootItems, e2eSkills, runtimeMirrors, hiddenProfileStubs, rootMoves, noteMoves };
}

async function fixVault(vault, report, archiveRoot) {
  const manifest = [];
  for (const item of report.duplicateSkills) {
    await movePath(item.dir, targetArchivePath(archiveRoot, "duplicate-skills", `Skills/${item.slug}`), manifest, `duplicate skill; kept ${item.kept}`);
  }
  for (const relPath of report.conflictArtifacts) {
    await movePath(join(vault, relPath), targetArchivePath(archiveRoot, "conflicts-and-backups", relPath), manifest, "conflict or backup artifact");
  }
  for (const item of report.legacyRootItems) {
    await movePath(join(vault, item.relPath), targetArchivePath(archiveRoot, "legacy-root", item.relPath), manifest, "legacy root item");
  }
  for (const relPath of report.e2eSkills) {
    await movePath(join(vault, relPath), targetArchivePath(archiveRoot, "e2e-skills", relPath), manifest, "E2E skill cleanup");
  }
  for (const item of report.runtimeMirrors) {
    await movePath(join(vault, item.source), join(vault, item.destination), manifest, "runtime mirror moved to Operations");
  }
  for (const relPath of report.hiddenProfileStubs) {
    await movePath(join(vault, relPath), targetArchivePath(archiveRoot, "hidden-profile-stubs", relPath), manifest, "hidden managed profile stub");
  }
  for (const item of report.rootMoves) {
    await movePath(join(vault, item.source), join(vault, item.destination), manifest, "legacy root folder moved to canonical Operations path");
  }
  for (const item of report.noteMoves) {
    await movePath(join(vault, item.source), join(vault, item.destination), manifest, "Notes migration");
  }
  await rmdir(join(vault, "Notes")).catch(() => undefined);
  if (manifest.length) {
    await mkdir(archiveRoot, { recursive: true });
    await appendFile(join(archiveRoot, "manifest.jsonl"), manifest.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  }
  return manifest;
}

function countReport(report) {
  return {
    duplicateSkills: report.duplicateSkills.length,
    conflictArtifacts: report.conflictArtifacts.length,
    legacyRootItems: report.legacyRootItems.length,
    e2eSkills: report.e2eSkills.length,
    runtimeMirrors: report.runtimeMirrors.length,
    hiddenProfileStubs: report.hiddenProfileStubs.length,
    rootMoves: report.rootMoves.length,
    noteMoves: report.noteMoves.length,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/vault-doctor.mjs [--vault PATH] [--fix] [--json]

Audits the shared Obsidian vault for duplicate shared skills, sync conflict artifacts,
legacy root folders, E2E test skills, runtime mirrors in the human graph, and legacy
Notes/ content. Without --fix it only reports. With --fix it moves material into
canonical folders or archives it under Operations/Vault Migrations.`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const vault = expandHome(args.vault || process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH || process.env.HIVE_SHARED_BRAIN_PATH || DEFAULT_VAULT);
const archiveRoot = args.archiveRoot
  ? (isAbsolute(args.archiveRoot) ? args.archiveRoot : join(vault, args.archiveRoot))
  : join(vault, MIGRATION_ROOT, `${todayStamp()}-vault-doctor`);

if (!(await isDirectory(vault))) {
  throw new Error(`Vault not found: ${vault}`);
}

const before = await inspectVault(vault, args.includeArchive);
const manifest = args.fix ? await fixVault(vault, before, archiveRoot) : [];
const after = args.fix ? await inspectVault(vault, args.includeArchive) : null;
const result = {
  ok: true,
  vault,
  fix: args.fix,
  archiveRoot: args.fix ? archiveRoot : null,
  before: countReport(before),
  after: after ? countReport(after) : null,
  moved: manifest.length,
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Vault doctor ${args.fix ? "fixed" : "report"} for ${vault}`);
  console.log(`Before: ${JSON.stringify(result.before)}`);
  if (result.after) console.log(`After: ${JSON.stringify(result.after)}`);
  if (args.fix) console.log(`Moved ${manifest.length} item(s). Manifest: ${join(archiveRoot, "manifest.jsonl")}`);
}
