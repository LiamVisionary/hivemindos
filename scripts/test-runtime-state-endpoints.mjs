// HTTP smoke test for the collector's runtime-state endpoints.
//
// Boots a minimal agent-telemetry-collector in a sandbox HOME (heavy subsystems
// disabled, loopback only) and exercises export / import / backup / list plus
// the requireLinkOwner gate. Verifies the clone path end to end without touching
// the real runtime dirs or the network.
//
// Run: node scripts/test-runtime-state-endpoints.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SECRET = "sk-ant-deadbeefdeadbeefdeadbeefdeadbeef01";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(base, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status === 200) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("collector did not come up in time");
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-rt-ep-"));
const home = join(sandbox, "home");
const claude = join(home, ".claude");
let child;
try {
  // Sandbox ~/.claude fixtures.
  await mkdir(join(claude, "skills", "foo"), { recursive: true });
  await mkdir(join(claude, "projects", "big"), { recursive: true });
  await writeFile(join(claude, "skills", "foo", "SKILL.md"), "# foo\n");
  await writeFile(join(claude, "CLAUDE.md"), "claude md\n");
  await writeFile(join(claude, "settings.json"), JSON.stringify({ theme: "dark", apiKey: SECRET }));
  await writeFile(join(claude, ".credentials.json"), JSON.stringify({ token: SECRET }));
  await writeFile(join(claude, "projects", "big", "x.jsonl"), "x".repeat(5000));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const collectorPath = new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname;
  child = spawn(process.execPath, [collectorPath], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      AGENT_TELEMETRY_PORT: String(port),
      AGENT_TELEMETRY_HOST: "127.0.0.1",
      HIVEMINDOS_MDNS_DISABLE: "1",
      AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
      AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
      AGENT_TELEMETRY_CHAT_DISABLED: "1",
      HIVE_COLLECTOR_ONLY: "1",
      AGENT_TELEMETRY_HEALTH_CACHE_MS: "0",
      HIVEMINDOS_SYNC_PATH: join(sandbox, "vault"),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });

  await waitForServer(base);

  // --- 1. Export over loopback (allowed) returns a gzip tar ---
  const exp = await fetch(`${base}/runtimes/claude-code/export-runtime-state`, { method: "POST" });
  assert.equal(exp.status, 200, `export should be 200 (stderr: ${stderr.slice(-400)})`);
  assert.match(exp.headers.get("content-type") || "", /gzip/, "export should be gzip");
  const tarBytes = Buffer.from(await exp.arrayBuffer());
  assert.ok(tarBytes.length > 0, "export tar should be non-empty");

  // --- 2. requireLinkOwner gate: a stamped (non-owner) request is NOT served ---
  const spoof = await fetch(`${base}/runtimes/claude-code/export-runtime-state`, {
    method: "POST",
    headers: { "x-hivemind-link-user": "attacker@example.com" },
  });
  assert.notEqual(spoof.status, 200, "a stamped non-owner request must be gated (403/503), not 200");
  assert.ok([403, 503].includes(spoof.status), `expected 403/503, got ${spoof.status}`);

  // --- 3. Import the tar back: backs up, overlays portable files, strips secrets ---
  await rm(join(claude, "CLAUDE.md"), { force: true });
  await rm(join(claude, "skills", "foo", "SKILL.md"), { force: true });
  const imp = await fetch(`${base}/runtimes/claude-code/import-runtime-state`, {
    method: "POST",
    headers: { "content-type": "application/gzip" },
    body: tarBytes,
  });
  assert.equal(imp.status, 200, "import should be 200");
  const impJson = await imp.json();
  assert.ok(impJson.applied >= 2, "import should apply the portable files");
  assert.ok(impJson.backupPath, "import should record a backup path");
  assert.equal(existsSync(join(claude, "CLAUDE.md")), true, "CLAUDE.md should be restored by import");
  assert.equal(existsSync(join(claude, "skills", "foo", "SKILL.md")), true, "skill should be restored");
  // The imported settings.json must be redacted; .credentials.json must never appear via import.
  const settings = await readFile(join(claude, "settings.json"), "utf8");
  assert.ok(!settings.includes(SECRET), "imported settings.json must be redacted");

  // --- 4. Backup + list ---
  const bk = await fetch(`${base}/runtimes/claude-code/backup-runtime-state`, { method: "POST" });
  assert.equal(bk.status, 200, "backup should be 200");
  const list = await fetch(`${base}/runtimes/claude-code/runtime-state-backups`);
  const listJson = await list.json();
  assert.ok(Array.isArray(listJson.backups) && listJson.backups.length >= 1, "backups should be listed");

  // --- 5. Unknown runtime -> 404 ---
  const unknown = await fetch(`${base}/runtimes/not-a-runtime/export-runtime-state`, { method: "POST" });
  assert.equal(unknown.status, 404, "unknown runtime should 404");

  // --- 6. Capability advertisement + runtime-state-sync config (Mechanism C) ---
  const health1 = await (await fetch(`${base}/health`)).json();
  assert.equal(health1.capabilities?.runtimeState, true, "/health should advertise runtimeState");
  assert.ok(
    Array.isArray(health1.capabilities?.runtimeStateRuntimes) &&
      health1.capabilities.runtimeStateRuntimes.includes("claude-code"),
    "/health should list runtime-state runtimes",
  );
  assert.equal(health1.capabilities?.runtimeStateSync, false, "runtime-state sync should be OFF by default");

  const cfg = await fetch(`${base}/runtimes/state-sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, runtimes: ["claude-code"] }),
  });
  assert.equal(cfg.status, 200, "configuring runtime-state sync should be 200");
  const cfgJson = await cfg.json();
  assert.equal(cfgJson.enabled, true, "sync should report enabled after configure");

  const status = await (await fetch(`${base}/runtimes/state-sync`)).json();
  assert.equal(status.enabled, true, "GET state-sync should report enabled");

  const health2 = await (await fetch(`${base}/health`)).json();
  assert.equal(health2.capabilities?.runtimeStateSync, true, "/health should now advertise runtimeStateSync=true");

  // Manual run with no reachable peers should succeed (no-op) rather than throw.
  const run = await fetch(`${base}/runtimes/state-sync/run`, { method: "POST" });
  assert.equal(run.status, 200, "manual sync run should be 200 even with no peers");

  // Disable again so the sandbox leaves nothing enabled.
  await fetch(`${base}/runtimes/state-sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });

  console.log("✓ export (loopback) returns gzip; spoofed-identity request gated");
  console.log("✓ import overlays portable files, backs up, redacts secrets");
  console.log("✓ backup + list + unknown-runtime 404");
  console.log("✓ /health advertises runtimeState capability; state-sync configure/status/run wired");
  console.log("\nRuntime-state endpoint smoke test passed.");
} finally {
  if (child && !child.killed) child.kill("SIGTERM");
  await rm(sandbox, { recursive: true, force: true });
}
