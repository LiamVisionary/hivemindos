#!/usr/bin/env node
// Hermetic test of the Hive Compute remote quick-host orchestration: a mock
// hivemind-linkd (file rail + shell session rail) stands in for the remote
// machine, and the suite asserts the real service pushes the worker module
// files, composes safe commands (env inlined, pid-file stop — never pkill),
// and parses the sentinel results. Localhost only, ephemeral port.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { register } from "node:module";
import process from "node:process";

const filePushes = [];
const commands = [];
let lastCommand = "";

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "PUT" && url.pathname.endsWith("/_hivemind/file")) {
    let bytes = 0;
    for await (const chunk of request) bytes += chunk.length;
    filePushes.push({ name: url.searchParams.get("name"), dir: url.searchParams.get("dir"), bytes });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method === "POST" && url.pathname.includes("/_hivemind/shell/sessions/")) {
    let body = "";
    for await (const chunk of request) body += chunk;
    lastCommand = JSON.parse(body || "{}").command || "";
    commands.push(lastCommand);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method === "GET" && url.pathname.includes("/_hivemind/shell/sessions/")) {
    // Synthesize the sentinel output the real linkd would produce for the
    // most recent command.
    const lines = [];
    if (lastCommand.includes("npm install")) lines.push("HMOS_HC_SETUP_OK");
    else if (lastCommand.includes("nohup")) lines.push("HMOS_HC_LIVE_OK");
    else if (lastCommand.includes("rm -f worker.pid")) lines.push("HMOS_HC_STOPPED");
    else if (lastCommand.includes("kill -0")) lines.push("HMOS_HC_RUNNING", "HMOS_HC_LOG:[hive-compute] connected");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, lines }));
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const mockBase = `http://127.0.0.1:${server.address().port}`;

// The service resolves the shell base through hivemindLinkControlUrl(); the
// peer-proxy URL form keeps the SSRF guard satisfied while reaching the mock.
process.env.HIVE_LINK_CONTROL_URL = mockBase;
const collectorUrl = `${mockBase}/peer/100.64.0.9:8787`;

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const {
  readRemoteHiveComputeHostRun,
  setupRemoteHiveComputeHosting,
  startRemoteHiveComputeWorker,
  stopRemoteHiveComputeWorker,
} = await import("../src/lib/services/hive-compute-marketplace/remote-host.ts");

const target = { collectorUrl, machineName: "Test Remote Mac" };

try {
  // Setup pushes the four module files and installs dependencies.
  const setup = await setupRemoteHiveComputeHosting(target);
  assert.equal(setup.ok, true, "setup must report the OK sentinel");
  assert.deepEqual(
    filePushes.map((push) => push.name).sort(),
    ["NOTICE.md", "README.md", "package.json", "worker.mjs"],
    "all module files must be pushed over the linkd file rail",
  );
  assert.ok(filePushes.every((push) => push.dir === "~/.hivemindos/modules/hive-compute-worker"), "files must land in the module dir");
  assert.ok(filePushes.find((push) => push.name === "worker.mjs").bytes > 10_000, "worker.mjs must carry the real source");

  // Go-live inlines the discovered models and conservative guardrails; secrets
  // come from the REMOTE machine's hive env (hive-env-run), never from here.
  const models = [
    { id: "llama3.2:3b", providerModelId: "llama3.2:3b", backendKind: "ollama", inputPer1m: 0, outputPer1m: 0, minimumJobUsdMicro: 0, pricingSource: "starter" },
    { id: "qwen-9b", providerModelId: "qwen-9b", backendKind: "lmstudio", inputPer1m: 0, outputPer1m: 0, minimumJobUsdMicro: 0, pricingSource: "starter" },
  ];
  const live = await startRemoteHiveComputeWorker(target, models);
  assert.equal(live.ok, true, "go-live must report the OK sentinel");
  const liveCommand = commands.find((command) => command.includes("nohup"));
  assert.ok(liveCommand.includes("HIVE_COMPUTE_MODELS='llama3.2:3b,qwen-9b'"), "models must be inlined");
  assert.ok(liveCommand.includes('"llama3.2:3b":"ollama"') && liveCommand.includes('"qwen-9b":"openai"'), "per-model engines must be inlined");
  assert.ok(liveCommand.includes("HIVE_COMPUTE_WORKER_HOST_WHEN=idle") && liveCommand.includes("HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY=1"), "conservative guardrails must be pinned");
  assert.ok(liveCommand.includes("hive-env-run -- npm start"), "gateway URL/token must resolve from the remote hive env");
  assert.ok(!liveCommand.includes("TOKEN") && !liveCommand.includes("http"), "no secrets or URLs may be inlined into the remote command");
  assert.ok(liveCommand.includes("echo $! > worker.pid"), "the started worker must record its pid");

  // Status probe parses running state and the log tail.
  const run = await readRemoteHiveComputeHostRun(target);
  assert.equal(run.running, true, "status must parse the running sentinel");
  assert.ok(run.logTail.includes("[hive-compute] connected"), "status must carry the log tail");

  // Stop kills only the recorded pid — never by name or port.
  const stop = await stopRemoteHiveComputeWorker(target);
  assert.equal(stop.ok, true, "stop must report the OK sentinel");
  const stopCommand = commands.find((command) => command.includes("rm -f worker.pid"));
  assert.ok(stopCommand.includes("kill $(cat worker.pid)"), "stop must kill by the recorded pid");
  assert.ok(!stopCommand.includes("pkill") && !stopCommand.includes("lsof"), "stop must never kill by name or port");

  console.log("Hive Compute remote quick-host tests passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  server.close();
}
process.exit(process.exitCode ?? 0);
