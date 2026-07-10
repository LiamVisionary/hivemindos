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
//   node scripts/register-mcp-clients.mjs [--server hivemind|xapi|azure] [--targets all|none|claude,codex,…] [--azure-access read|manage] [--remove] [--force] [--dry-run] [--aeon-project <dir>]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, "..");
const HOME = os.homedir();
const NODE_COMMAND = process.execPath; // absolute node — no PATH dependency for GUI harnesses

const KNOWN = ["claude", "codex", "gemini", "openclaw", "hermes", "aeon"];
const RUNTIME_COMMANDS = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  openclaw: "openclaw",
  hermes: "hermes",
  aeon: "aeon",
};

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const FORCE = argv.includes("--force");
const REMOVE = argv.includes("--remove");
function flagValue(name) {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return "";
  return argv[i].includes("=") ? argv[i].split("=").slice(1).join("=") : (argv[i + 1] || "");
}
const AEON_PROJECT_INPUT = flagValue("--aeon-project") || process.env.AEON_LOCAL_PATH || process.env.AEON_HOME || "";
const AEON_PROJECT = AEON_PROJECT_INPUT.startsWith("~/")
  ? path.join(HOME, AEON_PROJECT_INPUT.slice(2))
  : AEON_PROJECT_INPUT;
const AZURE_ACCESS = flagValue("--azure-access").trim().toLowerCase() === "manage" ? "manage" : "read";
const AZURE_MCP_COMMAND = path.join(
  HOME,
  ".hivemindos",
  "integrations",
  "azure-mcp",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "azmcp.cmd" : "azmcp",
);
const SERVER_CATALOG = {
  hivemind: {
    name: "hivemind",
    command: NODE_COMMAND,
    args: [path.join(ROOT, "scripts", "hivemind-mcp")],
    env: { HIVE_ENV_PROJECT_ROOT: ROOT },
    description: "HivemindOS MCP",
  },
  xapi: {
    name: "xapi",
    command: NODE_COMMAND,
    args: [path.join(ROOT, "scripts", "x-mcp-bridge.mjs")],
    env: { HIVE_ENV_PROJECT_ROOT: ROOT },
    description: "X API MCP",
  },
  azure: {
    name: "azure",
    command: AZURE_MCP_COMMAND,
    args: ["server", "start", "--mode", "consolidated", ...(AZURE_ACCESS === "read" ? ["--read-only"] : [])],
    env: { AZURE_MCP_COLLECT_TELEMETRY: "false" },
    description: `Microsoft Azure MCP (${AZURE_ACCESS === "read" ? "read-only" : "management"})`,
  },
};
const SERVER_KEY = (flagValue("--server") || flagValue("--name") || "hivemind").trim().toLowerCase();
const SERVER = SERVER_CATALOG[SERVER_KEY];
if (!SERVER) {
  console.error(`Unknown MCP server "${SERVER_KEY}". Expected one of: ${Object.keys(SERVER_CATALOG).join(", ")}`);
  process.exit(2);
}
const NAME = SERVER.name;
const COMMAND = SERVER.command;
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
function runtimeCommandPaths() {
  const pathParts = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const fallbackParts = process.platform === "win32"
    ? [path.dirname(process.execPath)]
    : [
      path.join(HOME, ".local", "bin"),
      path.join(HOME, ".nvm", "versions", "node", process.version, "bin"),
      path.dirname(process.execPath),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];
  return [...new Set([...fallbackParts, ...pathParts])];
}
function runtimeCommandCandidateNames(command) {
  if (process.platform !== "win32" || /\.[^\\/]+$/.test(command)) return [command];
  const pathExt = String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(path.delimiter)
    .map((extension) => extension.trim())
    .filter(Boolean);
  return [command, ...pathExt.map((extension) => `${command}${extension}`)];
}
function commandPresent(command) {
  if (!command) return false;
  if (/[\\/]/.test(command)) return fs.existsSync(command);
  const candidates = runtimeCommandCandidateNames(command);
  return runtimeCommandPaths().some((directory) => candidates.some((candidate) => fs.existsSync(path.join(directory, candidate))));
}
function runtimePresent(runtime, ...candidates) {
  return present(...candidates) || commandPresent(RUNTIME_COMMANDS[runtime]);
}
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
  const env = Object.entries(ENV)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join(", ");
  return [
    `[mcp_servers.${NAME}]`,
    `command = ${JSON.stringify(COMMAND)}`,
    `args = [${ARGS.map((a) => JSON.stringify(a)).join(", ")}]`,
    `env = { ${env} }`,
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
    ...ARGS.map((arg) => `      - ${yamlStr(arg)}`),
    "    env:",
    ...Object.entries(ENV).map(([key, value]) => `      ${key}: ${yamlStr(value)}`),
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
  claude: () => (!FORCE && !runtimePresent("claude", path.join(HOME, ".claude"), path.join(HOME, ".claude.json"))) ? { skipped: "not installed" } : mergeJson(path.join(HOME, ".claude.json")),
  gemini: () => (!FORCE && !runtimePresent("gemini", path.join(HOME, ".gemini"))) ? { skipped: "not installed" } : mergeJson(path.join(HOME, ".gemini", "settings.json")),
  openclaw: () => (!FORCE && !runtimePresent("openclaw", path.join(HOME, ".openclaw"))) ? { skipped: "not installed" } : mergeJson(path.join(HOME, ".openclaw", "openclaw.json")),
  codex: () => (!FORCE && !runtimePresent("codex", path.join(HOME, ".codex"))) ? { skipped: "not installed" } : mergeCodex(path.join(HOME, ".codex", "config.toml")),
  hermes: () => (!FORCE && !runtimePresent("hermes", path.join(HOME, ".hermes"))) ? { skipped: "not installed" } : mergeHermes(path.join(HOME, ".hermes", "config.yaml")),
  aeon: () => {
    // AEON v0.1 keeps MCP config in a concrete repo checkout. Never invent a
    // ~/.aeon project: target an explicit checkout or AEON_LOCAL_PATH/AEON_HOME.
    if (!AEON_PROJECT) return { skipped: "no project (pass --aeon-project or set AEON_LOCAL_PATH)" };
    const hasV01Layout = present(
      path.join(AEON_PROJECT, "apps", "cli", "aeon"),
      path.join(AEON_PROJECT, "aeon"),
    ) && fs.existsSync(path.join(AEON_PROJECT, "aeon.yml"))
      && fs.existsSync(path.join(AEON_PROJECT, "catalog", "skills.json"));
    if (!FORCE && !hasV01Layout) return { skipped: "project is not an AEON v0.1 checkout" };
    const file = path.join(AEON_PROJECT, ".mcp.json");
    return mergeJson(file, { wrapperKey: null, includeType: true });
  },
};

const targets = parseTargets();
console.log(`${SERVER.description} ${REMOVE ? "removal" : "registration"} → server "${NAME}" = ${COMMAND} ${ARGS.join(" ")}`);
if (ENV.HIVE_ENV_PROJECT_ROOT) console.log(`  repo root: ${ROOT}`);
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
