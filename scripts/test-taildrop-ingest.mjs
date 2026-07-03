#!/usr/bin/env node
// Hermetic tests for the Taildrop ingest watcher. A stub `tailscale` binary on
// PATH simulates the inbox drain (writing files into the target dir) and the
// error case; a throwaway HTTP server plays the dashboard notifications API.
// Never touches the real ~/.hivemindos, tailscaled, or the network.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "taildrop-ingest-test-"));
const fakeHome = join(scratch, "home");
const binDir = join(scratch, "bin");
const ingestDir = join(fakeHome, "HiveDrop");
mkdirSync(fakeHome, { recursive: true });
mkdirSync(binDir, { recursive: true });

// Dashboard notifications stub: record every POST body.
const notifications = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    notifications.push({ url: req.url, body });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

function writeTailscaleStub(script) {
  const path = join(binDir, "tailscale");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

function runWatcherOnce(extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/taildrop-ingest-watcher.mjs"], {
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: `${binDir}:${process.env.PATH}`,
        HIVE_TAILSCALE_CLI: join(binDir, "tailscale"),
        HIVE_TAILDROP_INGEST_DIR: ingestDir,
        HIVE_TAILDROP_APP_PORTS: String(port),
        HIVE_TAILDROP_ONCE: "1",
        HIVE_TAILDROP_RETRY_MS: "50",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    child.on("close", (code) => resolve({ code, out }));
  });
}

// --- Case 1: files arrive — moved set is detected, logged, and announced.
writeTailscaleStub(`
if [ "$1" = "version" ]; then echo "1.99.0"; exit 0; fi
if [ "$1" = "file" ] && [ "$2" = "get" ]; then
  # last argument is the target directory
  for last; do :; done
  printf 'from the phone' > "$last/shared-photo.jpg"
  printf 'notes' > "$last/note.txt"
  exit 0
fi
exit 1
`);
const received = await runWatcherOnce();
assert.equal(received.code, 0, `watcher exits clean, got:\n${received.out}`);
const landed = readdirSync(ingestDir).sort();
assert.deepEqual(landed, ["note.txt", "shared-photo.jpg"], "inbox files land in the ingest dir");
assert.match(received.out, /received shared-photo\.jpg/, "arrival is logged");
assert.equal(notifications.length, 2, "one dashboard notification per received file");
assert.match(notifications[0].body, /Taildrop/, "notification names the transport");
const ingestLog = readFileSync(join(fakeHome, ".hivemindos", "taildrop-ingest.log"), "utf8");
assert.match(ingestLog, /note\.txt/, "receipt log records the file");

// --- Case 2: CLI errors (tailscaled down / GUI-owned inbox) — logged, no crash.
writeTailscaleStub(`
if [ "$1" = "version" ]; then echo "1.99.0"; exit 0; fi
echo "Failed to connect to local Tailscale daemon" >&2
exit 1
`);
const errored = await runWatcherOnce();
assert.equal(errored.code, 0, "error path still exits clean in ONCE mode");
assert.match(errored.out, /drain error: .*Tailscale daemon/, "drain error is surfaced");

// --- Case 3: files that were already in the ingest dir are not re-announced.
notifications.length = 0;
writeTailscaleStub(`
if [ "$1" = "version" ]; then echo "1.99.0"; exit 0; fi
if [ "$1" = "file" ] && [ "$2" = "get" ]; then exit 0; fi
exit 1
`);
const quiet = await runWatcherOnce();
assert.equal(quiet.code, 0);
assert.equal(notifications.length, 0, "an empty drain announces nothing");

// --- Case 4: GUI-variant path — a file appearing in the ingest dir from the
// outside (Tailscale GUI saving directly there) is announced by the dir watch,
// and files that predate the watcher are not.
notifications.length = 0;
writeFileSync(join(ingestDir, "note.txt"), "predates this run"); // already there from case 1
writeTailscaleStub(`
if [ "$1" = "version" ]; then echo "1.99.0"; exit 0; fi
if [ "$1" = "file" ] && [ "$2" = "get" ]; then sleep 60; exit 0; fi
exit 1
`);
const watchChild = spawn(process.execPath, ["scripts/taildrop-ingest-watcher.mjs"], {
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${binDir}:${process.env.PATH}`,
    HIVE_TAILSCALE_CLI: join(binDir, "tailscale"),
    HIVE_TAILDROP_INGEST_DIR: ingestDir,
    HIVE_TAILDROP_APP_PORTS: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve) => setTimeout(resolve, 1_200)); // let it snapshot + arm the watch
writeFileSync(join(ingestDir, "gui-delivered.png"), "bytes from the tailscale gui");
const deadline = Date.now() + 10_000;
while (notifications.length === 0 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
watchChild.kill("SIGTERM");
assert.equal(notifications.length, 1, "externally-delivered file announces exactly once");
assert.match(notifications[0].body, /gui-delivered\.png/, "notification names the delivered file");

server.close();
rmSync(scratch, { recursive: true, force: true });
console.log("taildrop ingest watcher tests passed");
