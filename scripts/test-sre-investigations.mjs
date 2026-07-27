#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  createIncidentBundle,
  createIncidentInvestigationService,
  createIncidentStore,
  createOpenSreClient,
  OPENSRE_PINNED_COMMIT,
} = await import("../src/lib/services/sre/index.ts");
const { listHiveActions, listMcpHiveActions } = await import("../src/lib/services/hive-actions/index.ts");

const originalEnabled = process.env.HIVEMINDOS_OPENSRE_ENABLED;
const originalBaseUrl = process.env.HIVEMINDOS_OPENSRE_BASE_URL;
process.env.HIVEMINDOS_OPENSRE_ENABLED = "true";
delete process.env.HIVEMINDOS_OPENSRE_BASE_URL;

const bundle = createIncidentBundle({
  summary: "nyc-box failed with Bearer top-secret-token",
  description: "Read /Users/liam/private and token=abc123secret",
  source: "fleet-watchdog",
  target: { key: "http://100.64.0.1:8787", name: "nyc-box", kind: "collector" },
  symptoms: ["nyc-box at 100.64.0.1 returned sk-abcdefghijklmnop"],
  evidence: { authorization: "Bearer secret", nested: { apiKey: "must-not-persist", safe: "health 503" } },
}, { now: () => 1_800_000_000_000 });
const serializedBundle = JSON.stringify(bundle);
assert.doesNotMatch(serializedBundle, /nyc-box|100\.64\.0\.1|top-secret-token|abc123secret|abcdefghijklmnop|must-not-persist|\/Users\/liam/);
assert.match(bundle.target.ref, /^target-[a-f0-9]{12}$/);
assert.equal(bundle.privacy.identifiersHashed, true);

let requestedBody = null;
let requestedHeaders = null;
const openSreClient = createOpenSreClient({
  config: () => ({
    enabled: true,
    baseUrl: "http://127.0.0.1:8111",
    configError: "",
    installedCommit: OPENSRE_PINNED_COMMIT,
    pinMatches: true,
    healthTimeoutMs: 2_500,
    investigationTimeoutMs: 600_000,
    gatewayToken: "fixture-gateway-token",
  }),
  fetch: async (url, init = {}) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({ ok: true, version: "0.1.0", llm_configured: true, env: "local" }), { status: 200 });
    }
    requestedBody = JSON.parse(String(init.body));
    requestedHeaders = new Headers(init.headers);
    return new Response(JSON.stringify({
      report: "## Remediation\n- Inspect the worker stack.\n- Restart only after evidence capture.",
      problem_md: "Collector deep probes failed.",
      root_cause: "A worker deadlock survived remediation with token=upstream-secret.",
      is_noise: false,
      validity_score: 0.91,
      tool_calls: [{ name: "logs", authorization: "never-store-this", result: "deadlock" }],
    }), { status: 200 });
  },
});
const status = await openSreClient.status();
assert.equal(status.ready, true);
assert.equal(status.pinnedCommit, OPENSRE_PINNED_COMMIT);
const directDiagnosis = await openSreClient.investigate(bundle);
assert.equal(requestedBody.raw_alert.privacy.redacted, true);
assert.equal(requestedHeaders.get("authorization"), "Bearer fixture-gateway-token");
assert.deepEqual(directDiagnosis.recommendations, ["Inspect the worker stack.", "Restart only after evidence capture."]);
assert.equal(directDiagnosis.recommendationsRequireApproval, true);
assert.equal(directDiagnosis.executionAuthority, "hivemindos");
assert.doesNotMatch(JSON.stringify(directDiagnosis.toolCalls), /never-store-this/);
assert.doesNotMatch(JSON.stringify(directDiagnosis), /upstream-secret/);

const root = await mkdtemp(join(tmpdir(), "hivemindos-sre-"));
try {
  let clock = 1_800_000_000_000;
  let id = 0;
  const store = createIncidentStore({ root, now: () => clock, createId: (prefix) => `${prefix}-fixture-${++id}` });
  const diagnosedNotifications = [];
  const service = createIncidentInvestigationService({
    store,
    client: openSreClient,
    now: () => clock,
    onDiagnosed: async (incident) => { diagnosedNotifications.push(incident.id); },
  });
  const queued = await service.capture({ summary: "TTS deep probe remained wedged", source: "synthetic" });
  assert.equal(queued.status, "queued");
  await service.waitForIdle();
  const diagnosed = await service.read(queued.id);
  assert.equal(diagnosed.status, "diagnosed");
  assert.equal(diagnosed.diagnosis.executionAuthority, "hivemindos");
  assert.deepEqual(diagnosedNotifications, [queued.id]);
  const persisted = await readFile(join(root, `${queued.id}.json`), "utf8");
  assert.doesNotMatch(persisted, /never-store-this/);
  const mode = (await stat(join(root, `${queued.id}.json`))).mode & 0o777;
  assert.equal(mode, 0o600);
  const events = await service.events(queued.id);
  assert.deepEqual(events.map((event) => event.type), ["captured", "queued", "investigation-started", "diagnosed"]);

  const unavailableClient = {
    async status() { return { ...status, ready: false, reason: "fixture unavailable" }; },
    async investigate() { throw new Error("must not be called"); },
  };
  const unavailable = createIncidentInvestigationService({ store, client: unavailableClient, now: () => ++clock });
  const degraded = await unavailable.capture({ summary: "Collector unavailable", source: "synthetic" });
  await unavailable.waitForIdle();
  assert.equal((await unavailable.read(degraded.id)).status, "degraded");
} finally {
  await rm(root, { recursive: true, force: true });
}

process.env.HIVEMINDOS_OPENSRE_BASE_URL = "https://remote.example.com";
const blockedRemote = await createOpenSreClient({ fetch: async () => { throw new Error("network must not be called"); } }).status();
assert.equal(blockedRemote.ready, false);
assert.match(blockedRemote.reason, /loopback/);

const actions = listHiveActions();
const sreAction = actions.find((action) => action.id === "ops.investigate-incident");
assert.ok(sreAction);
assert.equal(sreAction.readOnly, undefined);
assert.deepEqual([...sreAction.sideEffects], ["write", "filesystem", "network"]);
assert.ok(listMcpHiveActions(actions).some((tool) => tool.name === "investigate_incident"));

const repositoryRoot = new URL("../", import.meta.url);
const unixInstaller = await readFile(new URL("scripts/install-opensre-sidecar.sh", repositoryRoot), "utf8");
const windowsInstaller = await readFile(new URL("scripts/install-opensre-sidecar.ps1", repositoryRoot), "utf8");
for (const installer of [unixInstaller, windowsInstaller]) {
  assert.match(installer, new RegExp(OPENSRE_PINNED_COMMIT));
  assert.match(installer, /gateway\.http\.webapp:app/);
  assert.match(installer, /OPENSRE_NO_TELEMETRY/);
  assert.match(installer, /OPENSRE_PROMPT_LOG_DISABLED/);
  assert.match(installer, /OPENSRE_HISTORY_ENABLED/);
  assert.match(installer, /OPENSRE_MASK_ENABLED/);
  assert.match(installer, /OPENSRE_ALERT_LISTENER_TOKEN/);
  assert.match(installer, /gateway-token/);
  assert.doesNotMatch(installer, /opensre\s+(?:shell|repl)/i);
}
assert.match(unixInstaller, /exec env -i/);
assert.match(windowsInstaller, /Get-ChildItem Env:.*Remove-Item/s);

const setupShell = await readFile(new URL("setup.sh", repositoryRoot), "utf8");
const uninstallShell = await readFile(new URL("uninstall.sh", repositoryRoot), "utf8");
const setupPowerShell = await readFile(new URL("setup.ps1", repositoryRoot), "utf8");
const uninstallPowerShell = await readFile(new URL("uninstall.ps1", repositoryRoot), "utf8");
for (const source of [setupShell, uninstallShell, setupPowerShell, uninstallPowerShell]) {
  assert.match(source, /optional.*OpenSRE.*sidecar/i);
}
assert.match(setupShell, /CLI_COLLECTOR_ONLY.*OpenSRE/s);
assert.match(setupPowerShell, /-not \$collectorOnlyMode.*OpenSRE/s);

const mcpSource = await readFile(new URL("scripts/hivemind-mcp", repositoryRoot), "utf8");
assert.match(mcpSource, /name === "investigate_incident"/);
assert.match(mcpSource, /\/api\/ops\/investigations/);
const apiSource = await readFile(new URL("src/app/api/ops/investigations/route.ts", repositoryRoot), "utf8");
assert.match(apiSource, /okJson/);
assert.match(apiSource, /errorJson/);
const serverSource = await readFile(new URL("src/lib/services/sre/server.ts", repositoryRoot), "utf8");
assert.match(serverSource, /createAgentNotification/);
assert.match(serverSource, /review-required/);

if (originalEnabled === undefined) delete process.env.HIVEMINDOS_OPENSRE_ENABLED;
else process.env.HIVEMINDOS_OPENSRE_ENABLED = originalEnabled;
if (originalBaseUrl === undefined) delete process.env.HIVEMINDOS_OPENSRE_BASE_URL;
else process.env.HIVEMINDOS_OPENSRE_BASE_URL = originalBaseUrl;

console.log("SRE investigations: redaction, pinning, loopback policy, durable events, provider routing, and approval boundary passed.");
