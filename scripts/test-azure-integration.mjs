import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const integrationTypes = read("src/lib/types/integrations.ts");
const manifests = read("src/lib/services/integrations/connector-manifests.ts");
const oauth = read("src/lib/services/integrations/azure-oauth.ts");
const arm = read("src/lib/services/integrations/azure-arm.ts");
const installer = read("scripts/install-azure-mcp.mjs");
const registrar = read("scripts/register-mcp-clients.mjs");
const azureMcp = read("src/lib/services/mcp/azure-mcp.ts");
const ui = read("src/features/integrations/AzureMcpSetup.tsx");
const connectionsUi = read("src/features/integrations/ConnectionsPanel.tsx");
const actions = read("src/lib/services/hive-actions/integrations/azure-resources.ts");
const hivemindMcp = read("scripts/hivemind-mcp");

assert.match(integrationTypes, /"azure"/);
assert.match(manifests, /key: "azure"/);
assert.match(manifests, /Hosted access is read-only/);
assert.match(oauth, /4399c52c-8cde-41fe-bea8-634bed72fd13/);
assert.match(oauth, /https:\/\/management\.azure\.com\/user_impersonation/);
assert.match(oauth, /AZURE_AUTHORIZE_ORIGIN/);
assert.match(oauth, /authority/);
assert.match(oauth, /Azure tenantId must be a Microsoft Entra tenant UUID/);
assert.match(oauth, /code_challenge_method: "S256"/);
assert.doesNotMatch(oauth, /process\.env\.AZURE_CLIENT_SECRET/);
assert.match(arm, /method: "GET"/);
assert.doesNotMatch(arm, /method: "(?:POST|PUT|PATCH|DELETE)"/);
assert.match(arm, /MAX_RESPONSE_BYTES = 2_000_000/);

assert.match(installer, /const PACKAGE_VERSION = "2\.0\.4"/);
assert.match(installer, /sha512-W93sHb0uh4WxgL5VOQlFKLu\+Xyex9npVKvVFQPCQPuRZMRjIRVF4CpVhtI3i593foSDxD8BsFvGrnifOxI51Fw==/);
assert.match(installer, /artifact\.integrity !== EXPECTED_INTEGRITY/);
assert.match(installer, /AZURE_MCP_COLLECT_TELEMETRY: "false"/);
assert.match(registrar, /"--read-only"/);
assert.match(azureMcp, /ENABLE_AZURE_MCP_MANAGEMENT/);
assert.match(ui, /Install read-only MCP · ~114 MB/);
assert.match(ui, /HivemindOS cannot enforce a hard Azure spending cap/);
assert.match(connectionsUi, /\/api\/integrations\/azure\/oauth\/start/);
assert.match(connectionsUi, /Personal Microsoft account/);
assert.match(connectionsUi, /Microsoft Entra tenant ID/);
assert.match(actions, /toolName: "azure_resources"/);
assert.match(hivemindMcp, /\/api\/integrations\/azure\/resources/);

const privateWorkerRoot = path.resolve(root, "../hivemind-cloud-services/workers/google-oauth-exchange");
const worker = fs.readFileSync(path.join(privateWorkerRoot, "src/index.ts"), "utf8");
const workerConfig = fs.readFileSync(path.join(privateWorkerRoot, "wrangler.toml"), "utf8");
for (const route of ["/azure/start", "/azure/callback", "/azure/result", "/azure/refresh"]) {
  assert.ok(worker.includes(route), `Hosted broker should implement ${route}.`);
}
assert.match(worker, /code_verifier/);
assert.match(worker, /login\.microsoftonline\.com\/\$\{authority\}\/oauth2\/v2\.0\/token/);
assert.match(worker, /authority: string/);
assert.match(worker, /claims\.nonce !== flow\.nonce/);
assert.match(worker, /env\.AZURE_CLIENT_SECRET/);
assert.match(workerConfig, /AZURE_CLIENT_ID = "4399c52c-8cde-41fe-bea8-634bed72fd13"/);
assert.doesNotMatch(workerConfig, /^AZURE_CLIENT_SECRET\s*=/m);

// Exercise every config serializer in a disposable HOME. This proves the
// registered server is read-only by default, telemetry-off, and removable
// without touching the developer's real runtime configs.
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-azure-registrar-"));
try {
  const env = { ...process.env, HOME: tempHome, USERPROFILE: tempHome };
  const targets = "claude,codex,gemini,openclaw,hermes";
  execFileSync(process.execPath, [path.join(root, "scripts/register-mcp-clients.mjs"), "--server", "azure", "--targets", targets, "--force"], { cwd: root, env });

  const claude = JSON.parse(fs.readFileSync(path.join(tempHome, ".claude.json"), "utf8"));
  assert.deepEqual(claude.mcpServers.azure.args, ["server", "start", "--mode", "consolidated", "--read-only"]);
  assert.deepEqual(claude.mcpServers.azure.env, { AZURE_MCP_COLLECT_TELEMETRY: "false" });
  assert.ok(claude.mcpServers.azure.command.startsWith(tempHome));
  const codex = fs.readFileSync(path.join(tempHome, ".codex/config.toml"), "utf8");
  assert.match(codex, /\[mcp_servers\.azure\]/);
  assert.match(codex, /--read-only/);
  assert.match(codex, /AZURE_MCP_COLLECT_TELEMETRY = "false"/);
  const hermes = fs.readFileSync(path.join(tempHome, ".hermes/config.yaml"), "utf8");
  assert.match(hermes, /^  azure:$/m);
  assert.match(hermes, /AZURE_MCP_COLLECT_TELEMETRY: "false"/);

  execFileSync(process.execPath, [path.join(root, "scripts/register-mcp-clients.mjs"), "--server", "azure", "--azure-access", "manage", "--targets", targets, "--force"], { cwd: root, env });
  const managed = JSON.parse(fs.readFileSync(path.join(tempHome, ".claude.json"), "utf8"));
  assert.ok(!managed.mcpServers.azure.args.includes("--read-only"));

  execFileSync(process.execPath, [path.join(root, "scripts/register-mcp-clients.mjs"), "--server", "azure", "--remove", "--targets", targets, "--force"], { cwd: root, env });
  const removed = JSON.parse(fs.readFileSync(path.join(tempHome, ".claude.json"), "utf8"));
  assert.ok(!removed.mcpServers.azure);
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}

console.log("Azure integration safety and runtime registration checks passed.");
