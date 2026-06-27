#!/usr/bin/env node
// Keeps packaged-agents/auto-install/<id>/AGENT.md in sync with the compiled built-in
// worker-class presets/souls (src/lib/config/bee-worker-presets.ts + bee-worker-souls.json).
//
// The AGENT.md folder is the authored source of truth for the built-in agent subclasses.
// Single-line profile fields live in JSON-quoted frontmatter; the multi-line soul is the
// body (read to EOF) so it round-trips losslessly even when it contains "##" headings.
//
//   node scripts/packaged-agents.mjs export   # write AGENT.md from current presets/souls
//   node scripts/packaged-agents.mjs verify   # round-trip AGENT.md -> presets/souls, assert equal
//   node scripts/packaged-agents.mjs --list    # list discovered agent packages
//
// No file is committed; this is a producer/verifier only.

import { register } from "node:module";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTO_INSTALL_ROOT = join(REPO_ROOT, "packaged-agents", "auto-install");
const SOULS_JSON = join(REPO_ROOT, "src", "lib", "config", "bee-worker-souls.json");
const PRESETS_JSON = join(REPO_ROOT, "src", "lib", "config", "bee-worker-presets.generated.json");

// Canonical display order (UI selector + BEE_WORKER_PRESET_LIST). Order is presentation, not
// content, so it lives here rather than in each AGENT.md. queen is soul-only (no preset).
const SOUL_ORDER = ["queen", "general", "planner", "code", "vision", "writer", "research", "artist", "ops", "qa", "security"];

// Lazily imported so `build` can regenerate the data files without first importing the
// module that consumes them (avoids a chicken-and-egg after the source-of-truth flip).
async function loadCompiled() {
  return import("../src/lib/config/bee-worker-presets.ts");
}

// Single-line scalar profile fields carried in frontmatter (in this order).
const SCALAR_FIELDS = ["label", "summary", "modelHint", "taskProfile", "qualityBar"];

function titleCase(value) {
  return String(value).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function serializeAgent(id, soulLines, preset) {
  const fm = [`id: ${id}`, "tier: built-in"];
  fm.push(`label: ${JSON.stringify(preset?.label ?? titleCase(id))}`);
  if (preset) {
    fm.push(`summary: ${JSON.stringify(preset.summary)}`);
    fm.push(`modelHint: ${JSON.stringify(preset.modelHint)}`);
    fm.push(`taskProfile: ${JSON.stringify(preset.taskProfile)}`);
    fm.push(`qualityBar: ${JSON.stringify(preset.qualityBar)}`);
    fm.push(`skillSlugs: ${JSON.stringify(preset.skillSlugs)}`);
  }
  const soul = soulLines.join("\n");
  return `---\n${fm.join("\n")}\n---\n\n## Soul\n\n${soul}\n`;
}

function parseAgent(markdown) {
  const m = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!m) throw new Error("missing frontmatter");
  const fields = {};
  for (const line of m[1].split("\n")) {
    const f = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!f) continue;
    const raw = f[2];
    fields[f[1]] = raw.startsWith('"') || raw.startsWith("[") ? JSON.parse(raw) : raw;
  }
  // Body after the frontmatter: drop the "## Soul" header line, keep the rest verbatim to EOF.
  const body = markdown.slice(m[0].length);
  const soulMatch = body.match(/^##\s+Soul\s*\n\n?([\s\S]*)$/);
  if (!soulMatch) throw new Error("missing ## Soul section");
  const soul = soulMatch[1].replace(/\n+$/, ""); // strip the single trailing newline we wrote
  return { fields, soulLines: soul.split("\n") };
}

function reconstructPreset(id, fields, soulLines) {
  return {
    id,
    label: fields.label,
    summary: fields.summary,
    soulTemplate: soulLines.join("\n"),
    modelHint: fields.modelHint,
    taskProfile: fields.taskProfile,
    qualityBar: fields.qualityBar,
    skillSlugs: fields.skillSlugs,
  };
}

async function discover() {
  const out = [];
  const entries = await readdir(AUTO_INSTALL_ROOT, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = join(AUTO_INSTALL_ROOT, e.name, "AGENT.md");
    if (existsSync(file)) out.push({ id: e.name, file });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function runExport() {
  const { BEE_WORKER_PRESETS, BEE_SOUL_TEMPLATE_LINES } = await loadCompiled();
  const ids = Object.keys(BEE_SOUL_TEMPLATE_LINES);
  for (const id of ids) {
    const soulLines = BEE_SOUL_TEMPLATE_LINES[id];
    const preset = BEE_WORKER_PRESETS[id];
    const dir = join(AUTO_INSTALL_ROOT, id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "AGENT.md"), serializeAgent(id, soulLines, preset));
    console.log(`  wrote auto-install/${id}/AGENT.md${preset ? "" : "  (soul-only)"}`);
  }
  console.log(`\n${ids.length} built-in agent class(es) exported.`);
}

async function runVerify() {
  const { BEE_WORKER_PRESETS, BEE_SOUL_TEMPLATE_LINES } = await loadCompiled();
  const found = await discover();
  if (!found.length) throw new Error("no AGENT.md found; run `export` first.");
  const souls = {};
  const presets = {};
  for (const { id, file } of found) {
    const { fields, soulLines } = parseAgent(await readFile(file, "utf8"));
    souls[id] = soulLines;
    if (fields.taskProfile !== undefined) presets[id] = reconstructPreset(id, fields, soulLines);
  }
  // Fidelity gates: folder must reproduce the compiled source exactly.
  assert.deepEqual(souls, BEE_SOUL_TEMPLATE_LINES, "soul templates drifted from compiled source");
  assert.deepEqual(presets, BEE_WORKER_PRESETS, "worker presets drifted from compiled source");
  console.log(
    `  ${Object.keys(souls).length} souls and ${Object.keys(presets).length} presets round-trip exactly.`,
  );
  console.log("\nPackaged-agents fidelity OK.");
}

// Generate the compiled data files (bee-worker-souls.json + bee-worker-presets.generated.json)
// from the auto-install/ AGENT.md folder, which is the authored source of truth.
async function runBuild() {
  const found = await discover();
  const byId = new Map(found.map((f) => [f.id, f]));
  const souls = {};
  const presets = {};
  for (const id of SOUL_ORDER) {
    const entry = byId.get(id);
    if (!entry) throw new Error(`missing packaged-agents/auto-install/${id}/AGENT.md`);
    const { fields, soulLines } = parseAgent(await readFile(entry.file, "utf8"));
    souls[id] = soulLines;
    if (fields.taskProfile !== undefined) {
      // soulTemplate is derived from souls at load time, so it is not stored here.
      presets[id] = {
        label: fields.label,
        summary: fields.summary,
        modelHint: fields.modelHint,
        taskProfile: fields.taskProfile,
        qualityBar: fields.qualityBar,
        skillSlugs: fields.skillSlugs,
      };
    }
  }
  for (const id of found.map((f) => f.id)) {
    if (!SOUL_ORDER.includes(id)) throw new Error(`auto-install/${id} is not in SOUL_ORDER; add it.`);
  }
  await writeFile(SOULS_JSON, `${JSON.stringify(souls, null, 2)}\n`);
  await writeFile(PRESETS_JSON, `${JSON.stringify(presets, null, 2)}\n`);
  console.log(`  wrote ${Object.keys(souls).length} souls -> src/lib/config/bee-worker-souls.json`);
  console.log(`  wrote ${Object.keys(presets).length} presets -> src/lib/config/bee-worker-presets.generated.json`);
  console.log("\nRegenerated compiled agent data from packaged-agents/auto-install/.");
}

const mode = process.argv[2];
if (mode === "export") {
  await runExport();
} else if (mode === "build") {
  await runBuild();
} else if (mode === "verify") {
  await runVerify();
} else if (mode === "--list") {
  for (const { id, file } of await discover()) console.log(`  ${id}\t${file}`);
} else {
  console.error("Usage: packaged-agents.mjs <export|verify|--list>");
  process.exit(2);
}
