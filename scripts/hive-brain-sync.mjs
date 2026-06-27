#!/usr/bin/env node
/*
 * hive-brain-sync.mjs — push the latest bundled HivemindOS brain content into a
 * user's shared vault. ONE engine for both delivery channels:
 *   • source installs:  invoked by scripts/update-hivemindos.sh after git pull
 *   • packaged desktop: invoked by the Tauri first-run-after-update hook against
 *                       brain content bundled in the app resources
 *
 * It is checksum-managed (the safe contract, mirroring reconcileBrainSkills):
 *   - missing in vault            -> seed it
 *   - present, matches last sync  -> update it ONLY if the source changed
 *   - present, user-edited        -> PRESERVE the user's copy, log it
 *   - present, not ours           -> leave untouched
 * So re-running on every update never clobbers user edits and never duplicates
 * (it writes/overwrites in place, keyed by slug + managed provenance metadata).
 *
 * No app/server imports, no network — safe to run from a shell update step or a
 * native hook. Cross-platform (Node fs only); replaces the bash/ps1 seed drift.
 *
 * Usage:
 *   node scripts/hive-brain-sync.mjs [--content-base DIR] [--vault DIR]
 *                                    [--app-version X] [--dry] [--quiet]
 *   --content-base  dir containing skills/, packaged-skills/auto-install/, docs/
 *                   (default: repo root = this script's parent)
 *   --vault         vault path (default: $NEXT_PUBLIC_OBSIDIAN_VAULT_PATH or
 *                   ~/Documents/Obsidian/hivemindos-vault)
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SKILL_METADATA_FILE = ".hivemind-skill-source.json"; // matches brain-skills.ts SOURCE_METADATA_FILE
const DOCS_MANIFEST_FILE = ".hivemind-docs-source.json";
const VERSION_STAMP_FILE = ".hivemind-brain-sync.json";
const SKIPPED = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", ".archive"]);

function parseArgs(argv) {
  const a = { contentBase: REPO_ROOT, vault: "", appVersion: "", dry: false, quiet: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--content-base") a.contentBase = resolve(argv[++i] ?? "");
    else if (v === "--vault") a.vault = argv[++i] ?? "";
    else if (v === "--app-version") a.appVersion = argv[++i] ?? "";
    else if (v === "--dry") a.dry = true;
    else if (v === "--quiet") a.quiet = true;
    else if (v === "--force") a.force = true;
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const log = (...m) => { if (!args.quiet) console.log(...m); };
const expandHome = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const vaultPath = expandHome(args.vault || process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH || join(homedir(), "Documents", "Obsidian", "hivemindos-vault"));

// ---- content hashing: stable hash of a directory's non-skipped files ----
function walkFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIPPED.has(name) || name === SKILL_METADATA_FILE || name === DOCS_MANIFEST_FILE) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, base, out);
    else out.push(relative(base, abs).split("\\").join("/"));
  }
  return out;
}
function hashDir(dir) {
  if (!existsSync(dir)) return "";
  const h = createHash("sha256");
  for (const rel of walkFiles(dir)) {
    h.update(rel); h.update("\0"); h.update(readFileSync(join(dir, rel))); h.update("\0");
  }
  return h.digest("hex");
}
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function replaceDir(src, dest) {
  if (args.dry) return;
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, filter: (s) => !s.split(/[\\/]/).some((seg) => SKIPPED.has(seg)) });
}
function writeJson(p, obj) { if (!args.dry) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, "utf8"); } }

const stats = { seeded: 0, updated: 0, preserved: 0, upToDate: 0, foreign: 0 };

// ---- managed sync of one skill dir (slug) from a source provider ----
function syncSkill(sourceDir, slug, provider, providerLabel, sourceUrl) {
  const srcSkill = join(sourceDir, "SKILL.md");
  if (!existsSync(srcSkill)) return;
  const dest = join(vaultPath, "Skills", slug);
  const sourceChecksum = hashDir(sourceDir);
  const writeMeta = () => writeJson(join(dest, SKILL_METADATA_FILE), {
    provider, providerLabel, sourceUrl, managedBy: "hivemindos",
    sourceChecksum, importedAt: new Date().toISOString(),
  });
  if (!existsSync(join(dest, "SKILL.md"))) {
    replaceDir(sourceDir, dest); writeMeta(); stats.seeded++;
    log(`  + seeded   ${slug}`); return;
  }
  const meta = readJson(join(dest, SKILL_METADATA_FILE));
  const managed = meta && (meta.managedBy === "hivemindos" || meta.provider === provider || meta.provider === "bundled" || meta.provider === "packaged-auto-install" || meta.provider === "shared-brain");
  if (!managed) { stats.foreign++; log(`  · skip     ${slug} (unmanaged local skill)`); return; }
  const destChecksum = hashDir(dest);
  if (meta.sourceChecksum && destChecksum !== meta.sourceChecksum) {
    stats.preserved++; log(`  · preserve ${slug} (user-edited; not overwriting)`); return;
  }
  if (sourceChecksum === meta.sourceChecksum) { stats.upToDate++; return; }
  replaceDir(sourceDir, dest); writeMeta(); stats.updated++;
  log(`  ↑ updated  ${slug}`);
}

function syncSkillRoot(root, provider, providerLabel, urlBase) {
  if (!existsSync(root)) return;
  for (const slug of readdirSync(root).sort()) {
    const d = join(root, slug);
    if (!statSync(d).isDirectory() || SKIPPED.has(slug)) continue;
    syncSkill(d, slug, provider, providerLabel, `${urlBase}/${slug}`);
  }
}

// ---- managed sync of a docs tree as one unit (canonical reference) ----
function syncDocs() {
  const docsSrcRoot = join(args.contentBase, "docs");
  const sets = ["for-users", "for-investors"].map((s) => join(docsSrcRoot, s)).filter(existsSync);
  if (!sets.length) { log("  · docs: no for-users/for-investors content in this bundle"); return; }
  const destRoot = join(vaultPath, "HivemindOS Docs");
  const sourceChecksum = createHash("sha256").update(sets.map(hashDir).join("|")).digest("hex");
  const manifestPath = join(destRoot, DOCS_MANIFEST_FILE);
  const stamp = () => writeJson(manifestPath, { managedBy: "hivemindos", sourceChecksum, syncedAt: new Date().toISOString(), note: "Canonical HivemindOS product docs (For Users / For Investors). Managed — local edits are preserved but block auto-refresh." });
  if (!existsSync(destRoot)) {
    for (const s of sets) replaceDir(s, join(destRoot, relative(docsSrcRoot, s)));
    stamp(); stats.seeded++; log("  + seeded   HivemindOS Docs"); return;
  }
  const meta = readJson(manifestPath);
  // current vault docs checksum (each set folder), excluding the manifest
  const destChecksum = createHash("sha256").update(sets.map((s) => hashDir(join(destRoot, relative(docsSrcRoot, s)))).join("|")).digest("hex");
  if (meta && meta.sourceChecksum && destChecksum !== meta.sourceChecksum) { stats.preserved++; log("  · preserve HivemindOS Docs (user-edited)"); return; }
  if (meta && sourceChecksum === meta.sourceChecksum) { stats.upToDate++; return; }
  for (const s of sets) replaceDir(s, join(destRoot, relative(docsSrcRoot, s)));
  stamp(); stats.updated++; log("  ↑ updated  HivemindOS Docs");
}

// ---- run ----
if (!existsSync(join(args.contentBase, "skills")) && !existsSync(join(args.contentBase, "packaged-skills"))) {
  console.error(`hive-brain-sync: no brain content at ${args.contentBase} (expected skills/ + packaged-skills/). Nothing to sync.`);
  process.exit(0);
}
// Version gate: the packaged native first-run hook spawns this on every launch,
// so skip the work when this app version already synced into this vault (unless
// --force). The checksum logic below would no-op anyway; this just avoids
// hashing the whole bundle each launch.
if (args.appVersion && !args.force) {
  const prior = readJson(join(vaultPath, VERSION_STAMP_FILE));
  if (prior && prior.appVersion === args.appVersion) {
    log(`hive-brain-sync: vault already synced for ${args.appVersion}; nothing to do.`);
    process.exit(0);
  }
}
log(`hive-brain-sync${args.dry ? " [DRY]" : ""}: ${args.contentBase} -> ${vaultPath}`);
mkdirSync(join(vaultPath, "Skills"), { recursive: true });
syncSkillRoot(join(args.contentBase, "skills"), "bundled", "Bundled skills", "https://github.com/LiamVisionary/hivemindos/tree/main/skills");
syncSkillRoot(join(args.contentBase, "packaged-skills", "auto-install"), "packaged-auto-install", "HivemindOS packaged skills", "https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install");
syncDocs();
writeJson(join(vaultPath, VERSION_STAMP_FILE), {
  appVersion: args.appVersion || null, syncedAt: new Date().toISOString(),
  contentBase: args.contentBase, stats,
});
log(`hive-brain-sync done: +${stats.seeded} seeded, ↑${stats.updated} updated, ${stats.upToDate} up-to-date, ${stats.preserved} preserved (user-edited), ${stats.foreign} unmanaged left alone`);
