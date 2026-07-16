#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const installer = read("scripts/install-notebooklm.mjs");
assert.match(installer, /PACKAGE_VERSION = "0\.8\.0b1"/, "installer should pin the native MCP preview version");
assert.match(installer, /752ceb76dac486d09a517ed97a651117d43fe113cb1e648952bc16be1dc16703/, "installer should pin the published wheel digest");
assert.match(installer, /createHash\("sha256"\)/, "installer should verify the downloaded wheel");
assert.match(installer, /"-m", "venv"/, "installer should use an isolated virtual environment");
assert.match(installer, /"-m", "playwright", "install", "chromium"/, "installer should install the browser runtime");
assert.match(installer, /"--server", "notebooklm"/, "installer should register the native MCP server");
assert.match(installer, /backup-\$\{process\.pid\}/, "installer should preserve a rollback directory during replacement");

const service = read("src/lib/services/mcp/notebooklm.ts");
assert.match(service, /authenticationIsAvailable/, "service should check local authentication status");
assert.match(service, /SIGN_OUT_NOTEBOOKLM/, "sign-out should require explicit confirmation");
assert.match(service, /REMOVE_NOTEBOOKLM_PACKAGE/, "package removal should require explicit confirmation");
assert.match(service, /authPreserved: true/, "package removal should preserve the separate auth profile");
assert.doesNotMatch(service, /storage_state\.json/, "service must not read NotebookLM browser credentials");

const route = read("src/app/api/integrations/notebooklm/route.ts");
for (const action of ["install", "login", "configure", "logout", "remove"]) {
  assert.match(route, new RegExp(`action === "${action}"`), `route should expose the ${action} action`);
}
assert.match(route, /requireAuth/, "NotebookLM setup route should require dashboard authentication");
assert.match(route, /okJson/, "NotebookLM setup route should use the shared response envelope");

const card = read("src/features/integrations/NotebookLmIntegrationCard.tsx");
assert.match(card, /not affiliated with Google/, "UI should disclose unofficial status");
assert.match(card, /SIGN_OUT_NOTEBOOKLM/, "UI should send the sign-out confirmation token");
assert.match(card, /REMOVE_NOTEBOOKLM_PACKAGE/, "UI should send the package-removal confirmation token");
assert.match(card, /window\.confirm/, "UI should visibly confirm destructive local actions");
assert.match(read("src/features/integrations/ConnectionsPanel.tsx"), /<NotebookLmIntegrationCard \/>/, "Connections should render the setup card");
assert.match(read("src/features/integrations/IntegrationsView.tsx"), /notebooklm: \{ transport: "stdio"/, "MCP catalog UI should have local stdio defaults");

const catalog = read("src/lib/services/mcp/catalog.ts");
assert.match(catalog, /id: "notebooklm"/, "capability catalog should discover NotebookLM");
assert.match(catalog, /"audio-overviews"/, "catalog should describe NotebookLM artifact capabilities");
assert.match(catalog, /undocumented Google APIs/, "catalog should state the upstream stability boundary");

const skill = read("packaged-skills/auto-install/notebooklm/SKILL.md");
assert.match(skill, /^---\nname: notebooklm\n/, "packaged skill should have valid frontmatter");
assert.match(skill, /Use the registered `notebooklm` MCP server first/, "skill should prefer native MCP tools");
assert.match(skill, /Never describe it as a Google-supported API/, "skill should preserve the unofficial boundary");
assert.match(skill, /confirm.*true/i, "skill should document destructive confirmation");
assert.ok(fs.existsSync(path.join(ROOT, "packaged-skills/auto-install/notebooklm/LICENSE")), "packaged skill should ship the upstream MIT license");
assert.ok(fs.existsSync(path.join(ROOT, "packaged-skills/auto-install/notebooklm/references/setup-and-auth.md")), "packaged skill should ship setup guidance");
assert.ok(fs.existsSync(path.join(ROOT, "packaged-skills/auto-install/notebooklm/references/command-reference.md")), "packaged skill should ship a command reference");

const wrapup = read("packaged-skills/auto-install/wrapup/SKILL.md");
assert.match(wrapup, /^---\nname: wrapup\n/, "wrap-up skill should have valid frontmatter");
assert.match(wrapup, /Activates on \/wrapup, wrap up, save this session, end of session, or session summary/, "wrap-up skill should expose the requested triggers");
assert.match(wrapup, /fact\/notebooklm\/ai-brain-notebook/, "wrap-up skill should use one canonical typed-memory key for the Brain notebook");
assert.match(wrapup, /hive-brain evolve/, "wrap-up skill should evolve stale durable memory instead of duplicating it");
assert.match(wrapup, /`source_add`.*`source_type: "file"`/s, "wrap-up skill should add the summary through the local NotebookLM MCP");
assert.match(wrapup, /Do not create the notebook until the user agrees/, "wrap-up skill should gate first-time Brain notebook creation");
assert.doesNotMatch(wrapup, /pip install|Memory file:/, "wrap-up skill should not create a parallel memory system or install an unpinned package");
assert.ok(fs.existsSync(path.join(ROOT, "packaged-skills/auto-install/wrapup/references/ai-brain-notebook.md")), "wrap-up skill should ship NotebookLM Brain routing guidance");
assert.ok(fs.existsSync(path.join(ROOT, "packaged-skills/auto-install/wrapup/references/memory-routing.md")), "wrap-up skill should ship typed-memory routing guidance");
assert.match(read("packaged-skills/README.md"), /`wrapup` for explicit end-of-session capture/, "packaged skill catalog should list wrapup");
assert.match(read("docs/for-users/packaged-skills/hive-skills.md"), /\| `wrapup` \|/, "Hive skill docs should list wrapup");

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-notebooklm-registrar-"));
const aeonProject = path.join(tempHome, "aeon-project");
fs.mkdirSync(aeonProject, { recursive: true });
const registrar = path.join(ROOT, "scripts", "register-mcp-clients.mjs");
const registrarEnv = { ...process.env, HOME: tempHome, USERPROFILE: tempHome };

try {
  execFileSync(process.execPath, [
    registrar,
    "--server", "notebooklm",
    "--targets", "claude,codex,gemini,openclaw,hermes,aeon",
    "--aeon-project", aeonProject,
    "--force",
  ], { cwd: ROOT, env: registrarEnv, stdio: "pipe" });

  const expectedCommand = path.join(
    tempHome,
    ".hivemindos",
    "integrations",
    "notebooklm",
    "venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "notebooklm-mcp.exe" : "notebooklm-mcp",
  );
  const jsonTargets = [
    [path.join(tempHome, ".claude.json"), "mcpServers"],
    [path.join(tempHome, ".gemini", "settings.json"), "mcpServers"],
    [path.join(tempHome, ".openclaw", "openclaw.json"), "mcpServers"],
    [path.join(aeonProject, ".mcp.json"), ""],
  ];
  for (const [file, wrapper] of jsonTargets) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const entry = wrapper ? parsed[wrapper].notebooklm : parsed.notebooklm;
    assert.equal(entry.command, expectedCommand, `${file} should use the isolated NotebookLM MCP binary`);
    assert.deepEqual(entry.args, [], `${file} should not invent MCP arguments`);
  }
  assert.match(fs.readFileSync(path.join(tempHome, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.notebooklm\]/, "Codex config should include NotebookLM");
  assert.match(fs.readFileSync(path.join(tempHome, ".hermes", "config.yaml"), "utf8"), /^  notebooklm:/m, "Hermes config should include NotebookLM");

  execFileSync(process.execPath, [
    registrar,
    "--server", "notebooklm",
    "--targets", "claude,codex,gemini,openclaw,hermes,aeon",
    "--aeon-project", aeonProject,
    "--remove",
    "--force",
  ], { cwd: ROOT, env: registrarEnv, stdio: "pipe" });

  for (const [file, wrapper] of jsonTargets) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const container = wrapper ? parsed[wrapper] : parsed;
    assert.equal(container.notebooklm, undefined, `${file} should remove only the NotebookLM entry`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(tempHome, ".codex", "config.toml"), "utf8"), /mcp_servers\.notebooklm/, "Codex removal should remove NotebookLM");
  assert.doesNotMatch(fs.readFileSync(path.join(tempHome, ".hermes", "config.yaml"), "utf8"), /^  notebooklm:/m, "Hermes removal should remove NotebookLM");
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}

console.log("NotebookLM and wrapup integration checks passed.");
