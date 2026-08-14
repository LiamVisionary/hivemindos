#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-capability-materialization-"));
const home = join(sandbox, "home");
const vault = join(sandbox, "vault");
const hermesHome = join(home, ".hermes", "profiles", "test-agent");
const skillDir = join(vault, "Skills", "selected-video");
const remoteAdapterDir = join(vault, "Skills", "hive-remote-capability-use");
const fakeHermes = join(sandbox, "fake-hermes");
await mkdir(skillDir, { recursive: true });
await mkdir(remoteAdapterDir, { recursive: true });
await mkdir(hermesHome, { recursive: true });
await writeFile(join(skillDir, "SKILL.md"), "---\nname: selected-video\ndescription: selected test video generator\n---\n\n# Selected video\n");
await writeFile(join(remoteAdapterDir, "SKILL.md"), "---\nname: hive-remote-capability-use\ndescription: execute selected remote fleet capabilities\n---\n\n# Remote capability adapter\n");
await writeFile(fakeHermes, `#!/bin/sh
prefix='__HIVEMIND_HERMES_EVENT__'
receipt_id='skill:shared:selected-video'
case "$*" in *connected-app:remote-media*) receipt_id='connected-app:remote-media' ;; esac
case "$*" in
  *omit-receipt*) ;;
  *)
    printf '%s{"type":"capability.started","id":"%s","name":"%s","status":"running"}\n' "$prefix" "$receipt_id" "$receipt_id"
    printf '%s{"type":"capability.completed","id":"%s","name":"%s","status":"completed"}\n' "$prefix" "$receipt_id" "$receipt_id"
    ;;
esac
printf '%s%s\n' "$prefix" '{"type":"assistant.delta","delta":"Finished with selected capability."}'
`);
await chmod(fakeHermes, 0o755);

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const collectorScript = process.env.HIVEMINDOS_TEST_COLLECTOR_SCRIPT || new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname;
const collector = spawn(process.execPath, [collectorScript], {
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HERMES_HOME: hermesHome,
    HERMES_BIN: fakeHermes,
    HERMES_PYTHON: "",
    AGENT_TELEMETRY_PORT: String(port),
    AGENT_TELEMETRY_HOST: "127.0.0.1",
    AGENT_TELEMETRY_CHAT_TIMEOUT_MS: "30000",
    HIVEMINDOS_MDNS_DISABLE: "1",
    AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
    AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
    HIVE_COLLECTOR_ONLY: "1",
    HIVEMINDOS_SYNC_PATH: vault,
  },
  stdio: ["ignore", "ignore", "pipe"],
});

const request = async (message, capabilityId = "skill:shared:selected-video") => fetch(`${baseUrl}/chat`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    agent: { id: "test-agent", name: "Test agent", runtime: "hermes", localDataDir: hermesHome },
    rawUserMessage: message,
    message: `[HIVEMINDOS_CAPABILITY_PLAN_APPROVED]\nCapability intent: video-generation\nCapability id: ${capabilityId}\n${message}`,
    messages: [{ role: "user", content: message }],
    stream: true,
    forceHermesCli: true,
    sharedVault: { vaultPath: vault },
    approvedCapabilities: [{
      id: capabilityId,
      intent: "video-generation",
      locator: join(skillDir, "SKILL.md"),
      executionReceiptRequired: true,
    }],
  }),
}).then((response) => response.text());

try {
  await waitFor(
    () => fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) }).then((response) => response.ok, () => false),
    "collector did not start",
  );

  const completed = await request("execute selected capability");
  assert.match(completed, /capability\.ready/, "collector reports the selected shared skill as provisioned before execution");
  assert.match(completed, /capability\.completed/, "collector forwards an authoritative selected-capability execution receipt");
  assert.match(completed, /Finished with selected capability\./);
  assert.doesNotMatch(completed, /did not execute the approved capability/);

  const overlaySkill = join(hermesHome, ".hivemindos", "capabilities", "selected-video", "SKILL.md");
  assert.match(await readFile(overlaySkill, "utf8"), /name: selected-video/, "selected skill is materialized into the exact Hermes runtime home");
  assert.match(await readFile(join(hermesHome, "skills", "selected-video", "SKILL.md"), "utf8"), /name: selected-video/, "selected skill is mirrored into Hermes native discovery");

  const remoteCompleted = await request("execute remote selected capability", "connected-app:remote-media");
  assert.match(remoteCompleted, /capability\.ready/);
  assert.match(remoteCompleted, /capability\.completed/, "a remote connected-app selection receives its own execution receipt");
  assert.match(
    await readFile(join(hermesHome, ".hivemindos", "capabilities", "hive-remote-capability-use", "SKILL.md"), "utf8"),
    /name: hive-remote-capability-use/,
    "HivemindOS provisions its remote-capability adapter when the selected implementation lives on another Hive machine",
  );

  const rejected = await request("omit-receipt");
  assert.match(rejected, /did not execute the approved capability before finishing/, "an unevidenced fallback cannot be accepted as a successful run");

  const evidencedFallback = await request("omit-receipt after provisioning failure", "skill:shared:not-on-this-machine");
  assert.match(evidencedFallback, /capability\.provisioning_failed/, "a real pre-launch provisioning failure is preserved as fallback evidence");
  assert.match(evidencedFallback, /Finished with selected capability\./, "the task may continue through a fallback after concrete provisioning failure");
  assert.doesNotMatch(evidencedFallback, /did not execute the approved capability before finishing/);
} finally {
  if (!collector.killed) collector.kill("SIGTERM");
  await rm(sandbox, { recursive: true, force: true });
}

console.log("collector capability materialization tests passed");
