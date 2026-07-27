#!/usr/bin/env node
// Regression test: env-sync peer accounting must fold a machine's two tailnet
// nodes (system tailscaled + embedded hivemind-linkd) even after an OS
// hostname rename splits their names. NYC Mac, 2026-07-03: the linkd tsnet
// node re-registered as hivemindos-liamsmbp481146-lan while the system node
// kept its sticky liams-macbook-pro-1 MagicDNS name, so the hostname-identity
// heuristic in drop_reachable_machine_duplicates never matched — the system
// node sat in envSync maintenance pull.unreachable forever and queued env
// updates for that ghost peer were stranded indefinitely. Ready collectors
// self-report their system node in /health (tailnetSelf, sticky dnsName);
// the dedup now matches that too — dnsName ONLY, never tailnetSelf.name (the
// OS ComputerName, which distinct machines can share).
//
// Hermetic: HOME is a temp dir, a fake `tailscale` CLI on PATH serves canned
// status JSON, the one ready collector is a stub on 127.0.0.1 (ephemeral
// port, pinned via HIVE_ENV_COLLECTOR_PORTS), and dead peers use
// 255.255.255.255 — TCP connect to the limited-broadcast address fails
// synchronously on every platform, so no probe ever waits on a timeout.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const scriptPath = join(root, "scripts", "hive-env-add");

// --- Part 1: unit coverage of drop_reachable_machine_duplicates -------------

const UNIT_PY = `
import importlib.machinery
import importlib.util
import os

loader = importlib.machinery.SourceFileLoader("hive_env_add", os.environ["HIVE_ENV_ADD_PATH"])
spec = importlib.util.spec_from_loader("hive_env_add", loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)
drop = mod.drop_reachable_machine_duplicates

nyc_linkd = {
    "host": "hivemindos-liamsmbp481146-lan.tail0000.ts.net",
    "tailnetSelfDnsName": "liams-macbook-pro-1.tail0000.ts.net",
}

# The rename case: node names share no identity, but the ready collector
# claims the system node as its own — it must be folded.
assert drop([nyc_linkd], ["liams-macbook-pro-1.tail0000.ts.net"]) == []

# tailnetSelf matching is case- and trailing-dot-insensitive.
assert drop([nyc_linkd], ["Liams-MacBook-Pro-1.tail0000.ts.net."]) == []

# Pre-rename convention (no tailnetSelf): the hostname-identity heuristic
# still folds a hivemindos-prefixed linkd node with its system sibling.
assert drop([{"host": "hivemindos-vps.tail0000.ts.net"}], ["vps.tail0000.ts.net"]) == []

# A genuinely unreachable distinct machine is never folded.
assert drop([nyc_linkd], ["workshop-pc.tail0000.ts.net"]) == ["workshop-pc.tail0000.ts.net"]

# -N tailnet suffixes distinguish physical machines that share a hostname:
# a ready liams-macbook-pro must not swallow the distinct liams-macbook-pro-1,
# and its tailnetSelf (its OWN system node) must not either.
this_mac = {
    "host": "hivemindos-liams-macbook-pro.tail0000.ts.net",
    "tailnetSelfDnsName": "liams-macbook-pro.tail0000.ts.net",
}
assert drop([this_mac], ["liams-macbook-pro-1.tail0000.ts.net"]) == [
    "liams-macbook-pro-1.tail0000.ts.net"
]

# An empty tailnetSelfDnsName never matches anything.
assert drop(
    [{"host": "hivemindos-box.tail0000.ts.net", "tailnetSelfDnsName": ""}],
    ["other-box.tail0000.ts.net"],
) == ["other-box.tail0000.ts.net"]

print("unit ok")
`;

const unit = spawnSync("python3", ["-c", UNIT_PY], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, HIVE_ENV_ADD_PATH: scriptPath },
});
assert.equal(unit.status, 0, unit.stderr || unit.stdout);
assert.match(unit.stdout, /unit ok/);

// --- Part 2: E2E through the real entry path --------------------------------

const tmp = await mkdtemp(join(tmpdir(), "hive-env-dedup-"));
const envFile = join(tmp, ".hivemindos", ".env");
const pendingFile = join(tmp, ".hivemindos", "env-sync-pending.json");
const binDir = join(tmp, "bin");

const DEAD_IP = "255.255.255.255";
const LINKD_HOST = "hivemindos-liamsmbp481146-lan.tail0000.ts.net";
const SYSTEM_HOST = "liams-macbook-pro-1.tail0000.ts.net";
const STRANGER_HOST = "workshop-pc.tail0000.ts.net";

function statusJson(peers) {
  return JSON.stringify({
    Self: { DNSName: "this-mac.tail0000.ts.net.", TailscaleIPs: ["100.99.0.1"] },
    Peer: Object.fromEntries(
      peers.map((peer, index) => [
        `nodekey:${index}`,
        { Online: true, OS: "macOS", DNSName: `${peer.host}.`, TailscaleIPs: [peer.ip] },
      ]),
    ),
  });
}

const peerPosts = [];
const collector = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        machineId: "machine-nyc",
        capabilities: { envHttpSync: true },
        envSync: { ready: true, user: "tester" },
        // The renamed machine's collector claims its system node. `name` is
        // the shared ComputerName on purpose: matching it would be a bug.
        tailnetSelf: { name: "Liams-MacBook-Pro", dnsName: SYSTEM_HOST },
      }),
    );
    return;
  }
  if (url.pathname === "/env" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, values: {}, updatedAt: {} }));
    return;
  }
  if (url.pathname === "/env" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      peerPosts.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

function run(args, statusFile, collectorPort) {
  return new Promise((resolveRun, rejectRun) => {
    const env = {
      ...process.env,
      HOME: tmp,
      HIVE_ENV_PROJECT_ROOT: tmp,
      PATH: `${binDir}${delimiter}${process.env.PATH || ""}`,
      HIVE_ENV_COLLECTOR_PORTS: String(collectorPort),
      FAKE_TAILSCALE_STATUS_FILE: statusFile,
    };
    // The peer-enumeration branch under test only runs when no targets are
    // pinned; scrub any pins or CLI overrides leaking from the outer env.
    delete env.HIVE_ENV_TAILNET_TARGETS;
    delete env.HIVE_TAILSCALE_CLI;
    delete env.HIVE_ENV_COLLECTOR_PORT;
    const child = spawn(
      "python3",
      [scriptPath, "--agent-env-file", envFile, "--no-backup", "--no-aeon-auto-sync", ...args],
      { cwd: root, env },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectRun);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

try {
  await mkdir(join(tmp, ".hivemindos"), { recursive: true });
  await writeFile(join(tmp, ".hivemindos", "machine-id"), "test-machine-local\n");

  // Fake tailscale CLI: first on PATH, serves the canned status JSON.
  await mkdir(binDir, { recursive: true });
  await writeFile(join(binDir, "tailscale"), '#!/bin/sh\ncat "$FAKE_TAILSCALE_STATUS_FILE"\n');
  await chmod(join(binDir, "tailscale"), 0o755);
  await writeFile(join(binDir, "tailscale.cmd"), '@type "%FAKE_TAILSCALE_STATUS_FILE%"\r\n');

  await new Promise((resolveListen) => collector.listen(0, "127.0.0.1", resolveListen));
  const collectorPort = collector.address().port;

  const fullStatus = join(tmp, "status-full.json");
  await writeFile(
    fullStatus,
    statusJson([
      { host: LINKD_HOST, ip: "127.0.0.1" },
      { host: SYSTEM_HOST, ip: DEAD_IP },
      { host: STRANGER_HOST, ip: DEAD_IP },
    ]),
  );
  const nycOnlyStatus = join(tmp, "status-nyc-only.json");
  await writeFile(
    nycOnlyStatus,
    statusJson([
      { host: LINKD_HOST, ip: "127.0.0.1" },
      { host: SYSTEM_HOST, ip: DEAD_IP },
    ]),
  );

  // 1. Maintenance accounting: the renamed machine's dead system node is
  //    folded into its ready linkd sibling; a real unreachable machine stays.
  let result = await run(["--sync-maintenance"], fullStatus, collectorPort);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.deepEqual(summary.pull.peers, [LINKD_HOST]);
  assert.deepEqual(
    summary.pull.unreachable,
    [STRANGER_HOST],
    "the renamed machine's system node must not be reported unreachable while its collector answers",
  );

  // 2. Delivery accounting: with the pair folded, a push to the renamed
  //    machine is FULLY delivered — nothing queues for eternal retry.
  result = await run(["HIVE_DEDUP_PROOF=delivered"], nycOnlyStatus, collectorPort);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /updated 1 peer/);
  assert.ok(
    !/queued for retry/.test(result.stdout + result.stderr),
    "a push must not queue for retry against the folded system node",
  );
  assert.equal(peerPosts.at(-1)?.entries?.HIVE_DEDUP_PROOF, "delivered");
  let pending = {};
  try {
    pending = JSON.parse(await readFile(pendingFile, "utf8")).pending;
  } catch {}
  assert.ok(
    !pending.HIVE_DEDUP_PROOF,
    "a fully delivered update must leave no pending queue entry",
  );

  console.log("env sync machine dedup tests passed");
} finally {
  collector.close();
  await rm(tmp, { recursive: true, force: true });
}
