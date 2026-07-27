import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

async function waitForServer(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // Collector is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("collector did not start");
}

const sandbox = await mkdtemp(join(tmpdir(), "hive-slash-catalog-"));
const home = join(sandbox, "home");
const fakePython = join(sandbox, "fake-hermes-python.mjs");
let collector;

try {
  await mkdir(home, { recursive: true });
  await writeFile(
    fakePython,
    `#!/usr/bin/env node
console.log(JSON.stringify({ commands: [{ name: "status", description: "Show session info", category: "Session", argsHint: null, aliases: [] }] }));
`
  );
  await chmod(fakePython, 0o755);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  collector = spawn(
    process.execPath,
    [new URL("./agent-telemetry-collector.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        HERMES_PYTHON: fakePython,
        AGENT_TELEMETRY_PORT: String(port),
        AGENT_TELEMETRY_HOST: "127.0.0.1",
        HIVEMINDOS_MDNS_DISABLE: "1",
        AGENT_TELEMETRY_DISABLE_SELF_RELOAD: "1",
        AGENT_TELEMETRY_ENV_SYNC_DISABLED: "1",
        AGENT_TELEMETRY_CHAT_DISABLED: "1",
        HIVE_COLLECTOR_ONLY: "1",
        HIVEMINDOS_SYNC_PATH: join(sandbox, "vault"),
      },
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
  let stderr = "";
  collector.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await waitForServer(baseUrl);
  const response = await fetch(`${baseUrl}/slash-commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: { runtime: "hermes", localDataDir: "~/.hermes" } }),
  });
  assert.equal(response.status, 200, stderr.slice(-500));
  assert.deepEqual(await response.json(), {
    runtime: "hermes",
    source: "hermes-command-registry",
    commands: [
      {
        name: "status",
        description: "Show session info",
        category: "Session",
        argsHint: null,
        aliases: [],
      },
    ],
    totalCommands: 1,
  });

  console.log("✓ collector exposes safe Hermes gateway slash-command metadata");
} finally {
  if (collector && !collector.killed) collector.kill("SIGTERM");
  await rm(sandbox, { recursive: true, force: true });
}
