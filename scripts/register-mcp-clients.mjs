#!/usr/bin/env node
// Register (or remove) the HivemindOS MCP server (scripts/hivemind-mcp) in each
// installed agent harness so their agents get HivemindOS tools — fleet handoff,
// brain / compiled-knowledge, crypto read/prepare, and the governed send / swap
// / stock EXECUTE tools — regardless of runtime. This is the TOOLS analog of the
// shared skill shelf that seed-shared-skills.sh mirrors into each harness.
//
// Safe by construction:
//   - Merge-only + idempotent: touches just the `hivemind` entry, preserving
//     every other MCP server and setting. Backs up each file before writing.
//   - No secrets written: the server reads the device token from the checkout
//     via HIVE_ENV_PROJECT_ROOT (see scripts/hivemind-mcp), so the harness config
//     carries only the launch command + repo root, never the token.
//   - Only touches harnesses that are installed (a config dir/file exists),
//     unless --force.
//
// Per-harness config (verified against each tool's docs + the local machine):
//   claude   ~/.claude.json            JSON  mcpServers.<name>
//   codex    ~/.codex/config.toml      TOML  [mcp_servers.<name>]
//   gemini   ~/.gemini/settings.json   JSON  mcpServers.<name>
//   openclaw ~/.openclaw/openclaw.json JSON  mcpServers.<name>
//   hermes   ~/.hermes/config.yaml     YAML  mcp_servers.<name>  (top level)
//   aeon     <project>/.mcp.json       JSON  <name> (top level; type:stdio)  — project-scoped
//
// Node path: the command is the absolute `node` that ran this script. A node
// upgrade changes that path, so setup AND hive-update re-run this to self-heal.
//
// Usage:
//   node scripts/register-mcp-clients.mjs [--server hivemind|xapi] [--targets all|none|claude,codex,…] [--remove] [--force] [--dry-run] [--aeon-project <dir>]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, "..");
const HOME = os.homedir();
const COMMAND = process.execPath; // absolute node — no PATH dependency for GUI harnesses
const SERVER_CATALOG = {
  hivemind: {
    name: "hivemind",
    script: path.join(ROOT, "scripts", "hivemind-mcp"),
    args: [path.join(ROOT, "scripts", "hivemind-mcp")],
    env: { HIVE_ENV_PROJECT_ROOT: ROOT },
    description: "HivemindOS MCP",
  },
  xapi: {
    name: "xapi",
    script: path.join(ROOT, "scripts", "x-mcp-bridge.mjs"),
    args: [path.join(ROOT, "scripts", "x-mcp-bridge.mjs")],
    env: { HIVE_ENV_PROJECT_ROOT: ROOT },
    description: "X API MCP",
  },
};

const KNOWN = ["claude", "codex", "gemini", "openclaw", "hermes", "aeon"];

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");
const REMOVE = argv.includes("--remove");
function flagValue(name) {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return "";
  return argv[i].includes("=") ? argv[i].split("=").slice(1).join("=") : (argv[i + 1] || "");
}
const AEON_PROJECT = flagValue("--aeon-project");
const SERVER_KEY = (flagValue("--server") || flagValue("--name") || "hivemind").trim().toLowerCase();
const SERVER = SERVER_CATALOG[SERVER_KEY];
if (!SERVER) {
  console.error(`Unknown MCP server "${SERVER_KEY}". Expected one of: ${Object.keys(SERVER_CATALOG).join(", ")}`);
  process.exit(2);
}
const NAME = SERVER.name;
const ARGS = SERVER.args;
const ENV = SERVER.env;

function parseTargets() {
  let raw = flagValue("--targets") || "all";
  raw = String(raw).trim().toLowerCase();
  if (raw === "none") return [];
  if (raw === "all" || raw === "") return [...KNOWN];
  return raw.split(",").map((s) => s.trim()).filter((s) => KNOWN.includes(s));
}

function present(...candidates) { return candidates.some((p) => fs.existsSync(p)); }
function yamlStr(value) { return JSON.stringify(String(value)); } // JSON double-quote is valid YAML

function writeFile(file, content) {
  if (DRY) { console.log(`  [dry-run] would write ${file}`); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, `${file}.hivemind-bak`); } catch {} }
  fs.writeFileSync(file, content);
}

// ---- JSON harnesses (claude / gemini / openclaw / aeon) ---------------------
function mergeJson(file, { wrapperKey = "mcpServers", includeType = false } = {}) {
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8") || "{}"); }
    catch { return { error: `${file} is not valid JSON; left untouched` }; }
  }
  let container = cfg;
  if (wrapperKey) {
    if (cfg[wrapperKey] && (typeof cfg[wrapperKey] !== "object" || Array.isArray(cfg[wrapperKey])))
      return { error: `${file} has a non-object ${wrapperKey}; left untouched` };
    cfg[wrapperKey] = cfg[wrapperKey] || {};
    container = cfg[wrapperKey];
  }
  if (REMOVE) {
    if (!(NAME in container)) return { skipped: "no entry" };
    delete container[NAME];
  } else {
    container[NAME] = includeType
      ? { type: "stdio", command: COMMAND, args: ARGS, env: ENV }
      : { command: COMMAND, args: ARGS, env: ENV };
  }
  writeFile(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return { ok: file };
}

// ---- Codex (TOML) -----------------------------------------------------------
function codexBlock() {
  return [
    `[mcp_servers.${NAME}]`,
    `command = ${JSON.stringify(COMMAND)}`,
    `args = [${ARGS.map((a) => JSON.stringify(a)).join(", ")}]`,
    `env = { HIVE_ENV_PROJECT_ROOT = ${JSON.stringify(ROOT)} }`,
    "",
  ].join("\n");
}
function mergeCodex(file) {
  if (!fs.existsSync(file) && REMOVE) return { skipped: "no config" };
  let toml = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const header = `[mcp_servers.${NAME}]`;
  const has = toml.includes(header);
  if (REMOVE) {
    if (!has) return { skipped: "no entry" };
    toml = toml.replace(new RegExp(`(^|\\n)\\[mcp_servers\\.${NAME}\\][\\s\\S]*?(?=\\n\\[|$)`), "");
    writeFile(file, `${toml.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "")}`);
    return { ok: file };
  }
  if (has) {
    toml = toml.replace(new RegExp(`(^|\\n)\\[mcp_servers\\.${NAME}\\][\\s\\S]*?(?=\\n\\[|$)`), (_m, p1) => (p1 || "") + codexBlock().replace(/\n$/, ""));
  } else {
    toml = toml.replace(/\s*$/, "");
    toml = toml ? `${toml}\n\n${codexBlock()}` : codexBlock();
  }
  writeFile(file, toml.endsWith("\n") ? toml : `${toml}\n`);
  return { ok: file };
}

// ---- Hermes (YAML, top-level mcp_servers:) ----------------------------------
function hermesBlockLines() {
  return [
    `  ${NAME}:`,
    `    command: ${yamlStr(COMMAND)}`,
    "    args:",
    `      - ${yamlStr(ARGS[0])}`,
    "    env:",
    `      HIVE_ENV_PROJECT_ROOT: ${yamlStr(ROOT)}`,
  ];
}
function mergeHermes(file) {
  if (!fs.existsSync(file)) {
    if (REMOVE) return { skipped: "no config" };
    writeFile(file, `mcp_servers:\n${hermesBlockLines().join("\n")}\n`);
    return { ok: file };
  }
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const idx = lines.findIndex((l) => /^mcp_servers:\s*(\{\s*\})?\s*$/.test(l));
  if (idx === -1) {
    if (REMOVE) return { skipped: "no mcp_servers" };
    let text = lines.join("\n").replace(/\s*$/, "");
    text = `${text ? `${text}\n\n` : ""}mcp_servers:\n${hermesBlockLines().join("\n")}\n`;
    writeFile(file, text);
    return { ok: file };
  }
  lines[idx] = "mcp_servers:"; // normalize an inline `mcp_servers: {}`
  let end = idx + 1;
  while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]))) end += 1;
  const body = lines.slice(idx + 1, end);
  const cleaned = [];
  let hadEntry = false;
  for (let i = 0; i < body.length; i += 1) {
    if (new RegExp(`^  ${NAME}:\\s*$`).test(body[i])) {
      hadEntry = true;
      i += 1;
      while (i < body.length && !/^  \S/.test(body[i])) i += 1; // skip its deeper-indented children
      i -= 1;
      continue;
    }
    cleaned.push(body[i]);
  }
  if (REMOVE && !hadEntry) return { skipped: "no entry" };
  const newBody = REMOVE ? cleaned : [...hermesBlockLines(), ...cleaned];
  lines.splice(idx + 1, end - (idx + 1), ...newBody);
  writeFile(file, lines.join("\n"));
  return { ok: file };
}

// ---- registrar dispatch -----------------------------------------------------
const REGISTRARS = {
  claude: () => (!FORCE && !present(path.join(HOME, ".claude"), path.join(HOME, ".claude.json"))) ? { skipped: "not installed" } : mergeJson(path.join(HOME, ".claude.json")),
  gemini: () => (!FORCE && !present(path.join(HOME, ".gemini"))) ? { skipped: "not installed" } : mergeJson(path.join(HOME, ".gemini", "settings.json")),
  openclaw: () => (!FORCE && !present(path.join(HOME, ".openclaw"))) ? { skipped: "not installed" } : mergeJson(path.join(HOME, ".openclaw", "openclaw.json")),
  codex: () => (!FORCE && !present(path.join(HOME, ".codex"))) ? { skipped: "not installed" } : mergeCodex(path.join(HOME, ".codex", "config.toml")),
  hermes: () => (!FORCE && !present(path.join(HOME, ".hermes"))) ? { skipped: "not installed" } : mergeHermes(path.join(HOME, ".hermes", "config.yaml")),
  aeon: () => {
    // Aeon's MCP config is project-scoped (a committed <repo>/.mcp.json). With an
    // explicit --aeon-project, register there; otherwise fall back to ~/.aeon
    // (Aeon's local home on this machine). Top-level keys + type:stdio per its README.
    const file = AEON_PROJECT ? path.join(AEON_PROJECT, ".mcp.json") : path.join(HOME, ".aeon", ".mcp.json");
    if (!FORCE && !AEON_PROJECT && !present(path.join(HOME, ".aeon"))) return { skipped: "not installed" };
    return mergeJson(file, { wrapperKey: null, includeType: true });
  },
};

const targets = parseTargets();
console.log(`${SERVER.description} ${REMOVE ? "removal" : "registration"} → server "${NAME}" = ${COMMAND} ${ARGS.join(" ")}`);
console.log(`  repo root: ${ROOT}`);
console.log(`  targets: ${targets.join(", ") || "(none)"}${DRY ? "  [dry-run]" : ""}${FORCE ? "  [force]" : ""}`);
let changed = 0;
for (const t of targets) {
  const r = REGISTRARS[t]();
  if (r.ok) { console.log(`  ${REMOVE ? "✓ removed from" : "✓"} ${t}: ${r.ok}`); changed += 1; }
  else if (r.skipped) console.log(`  - ${t}: skipped (${r.skipped})`);
  else if (r.error) console.log(`  ! ${t}: ${r.error}`);
}
const verb = REMOVE ? "Removed from" : "Registered into";
console.log(`Done. ${verb} ${changed} harness config(s).${changed && !REMOVE ? " Restart the harness (or start a new session) to load the tools." : ""}`);
