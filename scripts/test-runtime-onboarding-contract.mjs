#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const [{ RUNTIME_INSTALL_CATALOG }, runtimeTypes, gatewayProtocol] = await Promise.all([
  import("../src/lib/services/runtime-install-catalog.ts"),
  import("../src/lib/types/agent-runtime.ts"),
  import("../src/lib/services/openclaw/gateway-client.ts"),
]);

assert.equal(runtimeTypes.DEFAULT_NEW_AGENT_RUNTIME, "hermes", "new agents should default to Hermes");

const hermes = RUNTIME_INSTALL_CATALOG.hermes;
assert.equal(hermes?.inAppInstall, true, "Hermes should be installable in app");
assert.equal(hermes?.installKind, "curl");
assert.equal(hermes?.curlInstallUrl, "https://hermes-agent.nousresearch.com/install.sh");
assert.equal(hermes?.powershellInstallUrl, "https://hermes-agent.nousresearch.com/install.ps1");
assert.equal(hermes?.oauth?.command, "hermes auth add openai-codex --type oauth --no-browser");

const openclaw = RUNTIME_INSTALL_CATALOG.openclaw;
assert.equal(openclaw?.inAppInstall, true, "OpenClaw should be installable in app");
assert.equal(openclaw?.installKind, "curl");
assert.equal(openclaw?.curlInstallUrl, "https://openclaw.ai/install.sh");
assert.equal(openclaw?.powershellInstallUrl, "https://openclaw.ai/install.ps1");
assert.deepEqual(openclaw?.curlInstallArgs, ["--no-onboard"]);
assert.deepEqual(openclaw?.powershellInstallArgs, ["-NoOnboard"]);
assert.equal(openclaw?.oauth?.command, "openclaw models auth login --provider openai --device-code");

assert.ok(gatewayProtocol.OPENCLAW_GATEWAY_MIN_PROTOCOL <= 3, "OpenClaw protocol v3 gateways should remain supported");
assert.ok(gatewayProtocol.OPENCLAW_GATEWAY_MAX_PROTOCOL >= 4, "current OpenClaw protocol v4 gateways should be supported");

const collector = await readFile(new URL("./agent-telemetry-collector.mjs", import.meta.url), "utf8");
for (const url of [hermes?.curlInstallUrl, hermes?.powershellInstallUrl, openclaw?.curlInstallUrl, openclaw?.powershellInstallUrl]) {
  assert.ok(url && collector.includes(url), `collector installer mirror should include ${url}`);
}
assert.match(collector, /async function detectedOpenClawAgents/, "collector should enumerate configured OpenClaw agents");
assert.match(collector, /configuredAgents[\s\S]*coveredOpenClawAgentIds/, "configured OpenClaw profiles should merge with detected agents without duplicates");
assert.match(collector, /\.npm-global["'],\s*["']bin/, "collector detection should include OpenClaw's default npm prefix");

const runtimeCommandEnv = await readFile(new URL("../src/lib/services/runtime-command-env.ts", import.meta.url), "utf8");
const runtimeAvailability = await readFile(new URL("../src/lib/services/runtime-availability.ts", import.meta.url), "utf8");
const agentSettingsModal = await readFile(new URL("../src/features/dashboard/views/chat/AgentSettingsModal.tsx", import.meta.url), "utf8");
const mcpRegistration = await readFile(new URL("./register-mcp-clients.mjs", import.meta.url), "utf8");
const nativeSetup = await readFile(new URL("../src-tauri/src/setup.rs", import.meta.url), "utf8");
for (const [surface, source] of [
  ["runtime command environment", runtimeCommandEnv],
  ["runtime availability", runtimeAvailability],
  ["MCP registration", mcpRegistration],
  ["native setup", nativeSetup],
]) {
  assert.match(source, /\.npm-global/, `${surface} should include OpenClaw's default npm prefix`);
}

assert.match(agentSettingsModal, /<RuntimeInstallSetup/, "Agent Settings should use the shared in-app runtime downloader");
assert.match(
  agentSettingsModal,
  /Array\.isArray\(agentCreateMachine\?\.capabilities\?\.runtimes\)/,
  "an explicitly empty remote runtime inventory should open the downloader instead of falling back to local/manual setup",
);
assert.doesNotMatch(
  agentSettingsModal,
  /targetMachineRuntimes\.length > 0/,
  "an empty runtime inventory is authoritative, not an unknown inventory",
);

const collectorInstaller = await readFile(new URL("./install-telemetry-collector.sh", import.meta.url), "utf8");
assert.match(collectorInstaller, /loginctl enable-linger/, "Linux background services should survive SSH logout");
assert.match(collectorInstaller, /Environment=AGENT_TELEMETRY_HOST=127\.0\.0\.1/, "collector should bind to loopback behind Hivemind Link or Tailscale Serve");

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-codex-registration-"));
const codexConfigPath = path.join(codexHome, ".codex", "config.toml");
const registrarPath = fileURLToPath(new URL("./register-mcp-clients.mjs", import.meta.url));
try {
  fs.mkdirSync(path.dirname(codexConfigPath), { recursive: true });
  fs.writeFileSync(codexConfigPath, [
    "[mcp_servers.hivemind]",
    'command = "old-node"',
    'args = ["old-server"]',
    "",
    "[mcp_servers.hivemind.env]",
    'HIVE_ENV_PROJECT_ROOT = "/old/root"',
    "",
    "[desktop]",
    'appearanceTheme = "dark"',
    "",
  ].join("\n"));
  const registrarEnv = { ...process.env, HOME: codexHome, USERPROFILE: codexHome };
  const registrarArgs = [registrarPath, "--server", "hivemind", "--targets", "codex", "--force"];
  execFileSync(process.execPath, registrarArgs, { env: registrarEnv });
  const once = fs.readFileSync(codexConfigPath, "utf8");
  assert.equal((once.match(/^\[mcp_servers\.hivemind\]$/gm) || []).length, 1, "Codex should contain one Hivemind MCP table");
  assert.doesNotMatch(once, /^\[mcp_servers\.hivemind\.env\]$/m, "registration should remove stale nested env tables");
  assert.match(once, /^env = \{ HIVE_ENV_PROJECT_ROOT = ".+" \}$/m, "registration should keep one inline environment table");
  assert.match(once, /^\[desktop\]$/m, "registration should preserve unrelated Codex settings");
  execFileSync(process.execPath, registrarArgs, { env: registrarEnv });
  assert.equal(fs.readFileSync(codexConfigPath, "utf8"), once, "Codex registration should remain idempotent");
} finally {
  fs.rmSync(codexHome, { recursive: true, force: true });
}

const uninstaller = await readFile(new URL("../uninstall.sh", import.meta.url), "utf8");
assert.match(uninstaller, /systemd-linger-enabled-by-hivemindos/, "uninstall should mirror HivemindOS-managed lingering");
assert.match(uninstaller, /loginctl disable-linger/, "uninstall should offer to remove HivemindOS-managed lingering");

console.log("runtime onboarding contract tests passed");
