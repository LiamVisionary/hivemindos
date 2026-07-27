#!/usr/bin/env node
// E2E-style test for the hive-env-add tailnet sync retry queue and
// pull-reconcile, using a stub peer collector on loopback. Hermetic:
// HOME points at a temp dir and HIVE_ENV_COLLECTOR_PORTS pins probing
// to the stub port so the real local collector is never touched.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const tmp = await mkdtemp(join(tmpdir(), "hive-env-sync-"));
const envFile = join(tmp, ".hivemindos", ".env");
const metaFile = `${envFile}.meta.json`;
const pendingFile = join(tmp, ".hivemindos", "env-sync-pending.json");

const peerStore = { values: {}, updatedAt: {} };
const peerPosts = [];
const peer = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        machineId: "test-machine-peer",
        capabilities: { envHttpSync: true },
        envSync: { ready: true, user: "tester" },
      }),
    );
    return;
  }
  if (url.pathname === "/env" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body);
      peerPosts.push(parsed);
      for (const [key, value] of Object.entries(parsed.entries || {})) {
        if (value === "") delete peerStore.values[key];
        else peerStore.values[key] = value;
        peerStore.updatedAt[key] = Date.now() / 1000;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (url.pathname === "/env" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        values: peerStore.values,
        updatedAt: peerStore.updatedAt,
      }),
    );
    return;
  }
  response.writeHead(404);
  response.end();
});

// Async spawn keeps the event loop free so the in-process stub collector
// can answer the CLI's HTTP probes while the CLI runs.
function run(args, extraEnv = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      "python3",
      [
        join(root, "scripts", "hive-env-add"),
        "--agent-env-file",
        envFile,
        "--no-backup",
        "--no-aeon-auto-sync",
        ...args,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          HOME: tmp,
          HIVE_ENV_PROJECT_ROOT: tmp,
          HIVE_ENV_TAILNET_TARGETS: "127.0.0.1",
          ...extraEnv,
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectRun);
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

async function readPending() {
  try {
    return JSON.parse(await readFile(pendingFile, "utf8")).pending;
  } catch {
    return {};
  }
}

try {
  await mkdir(join(tmp, ".hivemindos"), { recursive: true });
  await writeFile(join(tmp, ".hivemindos", "machine-id"), "test-machine-local\n");

  await new Promise((resolveListen) => peer.listen(0, "127.0.0.1", resolveListen));
  const peerPort = peer.address().port;
  const livePorts = { HIVE_ENV_COLLECTOR_PORTS: String(peerPort) };
  const deadPort = await new Promise((resolveListen) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const found = probe.address().port;
      probe.close(() => resolveListen(found));
    });
  });
  const deadPorts = { HIVE_ENV_COLLECTOR_PORTS: String(deadPort) };

  // 1. A push that reaches no ready collector must queue the update.
  let result = await run(["HIVE_SYNC_QUEUED=first"], deadPorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /queued for retry/);
  let pending = await readPending();
  assert.ok(pending.HIVE_SYNC_QUEUED, "failed push should queue the key");
  assert.deepEqual(pending.HIVE_SYNC_QUEUED.delivered, {});
  assert.equal(peerPosts.length, 0);

  // 2. --retry-pending drains the queue once the peer collector is ready.
  result = await run(["--retry-pending"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(peerStore.values.HIVE_SYNC_QUEUED, "first");
  pending = await readPending();
  assert.ok(
    !pending.HIVE_SYNC_QUEUED,
    "fully delivered entries should leave the queue",
  );

  // 3. A push with the peer reachable delivers immediately and queues nothing.
  result = await run(["HIVE_SYNC_DIRECT=direct"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(peerStore.values.HIVE_SYNC_DIRECT, "direct");
  pending = await readPending();
  assert.ok(!pending.HIVE_SYNC_DIRECT);

  // 4. Removals queued while the peer is down propagate on drain.
  result = await run(["HIVE_SYNC_DIRECT="], deadPorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  pending = await readPending();
  assert.ok(pending.HIVE_SYNC_DIRECT, "removal should queue like any update");
  result = await run(["--retry-pending"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(
    !("HIVE_SYNC_DIRECT" in peerStore.values),
    "drained removal should delete the key on the peer",
  );

  // 5. Pull-reconcile imports remote-only keys and adopts remote timestamps,
  //    prefers newer remote values, keeps newer local values, and does not
  //    resurrect locally tombstoned keys.
  const now = Date.now() / 1000;
  result = await run(["HIVE_SYNC_LOCAL_NEWER=local"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = await run(["HIVE_SYNC_REMOTE_NEWER=stale"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = await run(["HIVE_SYNC_TOMBSTONED=temp"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = await run(["HIVE_SYNC_TOMBSTONED="], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  Object.assign(peerStore.values, {
    HIVE_SYNC_REMOTE_ONLY: "imported",
    HIVE_SYNC_LOCAL_NEWER: "remote-stale",
    HIVE_SYNC_REMOTE_NEWER: "remote-fresh",
    HIVE_SYNC_TOMBSTONED: "zombie",
  });
  Object.assign(peerStore.updatedAt, {
    HIVE_SYNC_REMOTE_ONLY: now + 100,
    HIVE_SYNC_LOCAL_NEWER: now - 9000,
    HIVE_SYNC_REMOTE_NEWER: now + 9000,
    HIVE_SYNC_TOMBSTONED: now - 9000,
  });

  result = await run(["--pull-reconcile"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const envText = await readFile(envFile, "utf8");
  assert.match(envText, /HIVE_SYNC_REMOTE_ONLY=imported/);
  assert.match(envText, /HIVE_SYNC_LOCAL_NEWER=local/);
  assert.match(envText, /HIVE_SYNC_REMOTE_NEWER=remote-fresh/);
  assert.ok(
    !envText.includes("HIVE_SYNC_TOMBSTONED="),
    "pull-reconcile must not resurrect locally removed keys",
  );
  const meta = JSON.parse(await readFile(metaFile, "utf8")).updatedAt;
  assert.equal(
    Math.round(meta.HIVE_SYNC_REMOTE_ONLY),
    Math.round(now + 100),
    "imported keys should adopt the origin timestamp",
  );

  // 6. --sync-maintenance reports both phases as machine-readable JSON.
  result = await run(["--sync-maintenance"], livePorts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(summary.version, 1);
  assert.ok(summary.retry);
  assert.ok(summary.pull);
  assert.ok(summary.push, "sync-maintenance reports the push-missing phase");

  // 7. push-missing: --sync-maintenance seeds a peer with a key it is entirely
  //    missing (the strand-heals-automatically case), and NEVER clobbers a value
  //    the peer already holds (missing-only — no ping-pong / no overwrite).
  {
    // Seed keys DIRECTLY into the local store (not via the write path) so the
    // stranded key is NOT in the pending queue — this isolates push-missing from
    // drain_pending, proving the new phase (not retry) delivered it.
    const localEnv = await readFile(envFile, "utf8");
    await writeFile(envFile, `${localEnv}\nHIVE_PUSH_STRANDED=on-hub-only\nHIVE_PUSH_EXISTING=local-older\n`);
    const metaObj = JSON.parse(await readFile(metaFile, "utf8"));
    metaObj.updatedAt.HIVE_PUSH_STRANDED = now;
    metaObj.updatedAt.HIVE_PUSH_EXISTING = now - 5000;
    await writeFile(metaFile, JSON.stringify(metaObj));
    // Peer already holds HIVE_PUSH_EXISTING with a NEWER value — must survive.
    peerStore.values.HIVE_PUSH_EXISTING = "peer-value";
    peerStore.updatedAt.HIVE_PUSH_EXISTING = now + 5000;

    peerPosts.length = 0;
    const maint = await run(["--sync-maintenance"], livePorts);
    assert.equal(maint.status, 0, maint.stderr || maint.stdout);
    assert.equal(peerStore.values.HIVE_PUSH_STRANDED, "on-hub-only", "push-missing seeds a key the peer was entirely missing");
    assert.equal(peerStore.values.HIVE_PUSH_EXISTING, "peer-value", "push-missing never overwrites a value the peer already holds");
    const sm = JSON.parse(maint.stdout.trim().split("\n").at(-1));
    const pushedKeys = Object.values(sm.push.pushed || {}).flat();
    assert.ok(pushedKeys.includes("HIVE_PUSH_STRANDED"), "the stranded key is reported as pushed");
    assert.ok(!pushedKeys.includes("HIVE_PUSH_EXISTING"), "a key the peer already has is never in the push set");

    // Kill switch: HIVE_ENV_PUSH_MISSING=0 disables the seeding.
    await writeFile(envFile, `${await readFile(envFile, "utf8")}\nHIVE_PUSH_KILLED=should-stay-local\n`);
    const metaObj2 = JSON.parse(await readFile(metaFile, "utf8"));
    metaObj2.updatedAt.HIVE_PUSH_KILLED = now;
    await writeFile(metaFile, JSON.stringify(metaObj2));
    const killed = await run(["--sync-maintenance"], { ...livePorts, HIVE_ENV_PUSH_MISSING: "0" });
    assert.equal(killed.status, 0, killed.stderr || killed.stdout);
    assert.ok(!("HIVE_PUSH_KILLED" in peerStore.values), "HIVE_ENV_PUSH_MISSING=0 disables push-missing");
    const km = JSON.parse(killed.stdout.trim().split("\n").at(-1));
    assert.equal(km.push.disabled, true, "the disabled push phase is reported");
  }

  // 8. Per-machine credential families (USEPOD_HOST_*) are local-only: never
  //    pushed to a peer, never served, even though the peer lacks them. Prevents
  //    one host's provider identity from hijacking another's.
  {
    const localEnv = await readFile(envFile, "utf8");
    await writeFile(envFile, `${localEnv}\nUSEPOD_HOST_TOKEN=pod_host_thismac\nUSEPOD_HOST_TOKEN__NYC=pod_host_should_not_leave\n`);
    const metaObj = JSON.parse(await readFile(metaFile, "utf8"));
    metaObj.updatedAt.USEPOD_HOST_TOKEN = now;
    metaObj.updatedAt.USEPOD_HOST_TOKEN__NYC = now;
    await writeFile(metaFile, JSON.stringify(metaObj));
    delete peerStore.values.USEPOD_HOST_TOKEN;
    delete peerStore.values.USEPOD_HOST_TOKEN__NYC;

    const maint = await run(["--sync-maintenance"], livePorts);
    assert.equal(maint.status, 0, maint.stderr || maint.stdout);
    assert.ok(!("USEPOD_HOST_TOKEN" in peerStore.values), "a bare USEPOD_HOST_ key is never pushed to a peer");
    assert.ok(!("USEPOD_HOST_TOKEN__NYC" in peerStore.values), "a machine-scoped USEPOD_HOST_ key is never pushed either");
    // And the peer's /env view of THIS machine must not serve them.
    const served = JSON.parse((await run(["--export-json"], livePorts)).stdout.trim().split("\n").at(-1) || "{}").values || {};
    assert.ok(!("USEPOD_HOST_TOKEN" in served), "USEPOD_HOST_ keys are excluded from the served/shared env");
  }

  // 9. meta-backfill: a key written into the env file with NO meta timestamp
  //    (a raw edit / out-of-repo tool) reads as UnknownAge and is frozen out of
  //    reconcile in both directions; the backfill stamps it so it becomes
  //    sync-eligible again — the root fix so no key can strand however it was
  //    written. Kill switch: HIVE_ENV_BACKFILL_META=0.
  {
    // Simulate a raw write: the key is in .env but deliberately NOT in meta.
    await writeFile(envFile, `${await readFile(envFile, "utf8")}\nHIVE_BACKFILL_UNSTAMPED=local-raw\n`);
    // Peer holds a DIFFERENT, real-timestamped value → the divergence case that
    // UnknownAge silently freezes (neither side ever adopts the other).
    peerStore.values.HIVE_BACKFILL_UNSTAMPED = "peer-raw";
    peerStore.updatedAt.HIVE_BACKFILL_UNSTAMPED = now - 10000;

    // Backfill DISABLED: pull skips the key as UnknownAge and it stays unstamped.
    const frozen = await run(["--sync-maintenance"], { ...livePorts, HIVE_ENV_BACKFILL_META: "0" });
    assert.equal(frozen.status, 0, frozen.stderr || frozen.stdout);
    const fs = JSON.parse(frozen.stdout.trim().split("\n").at(-1));
    assert.ok(
      (fs.pull.skippedUnknownAge || []).includes("HIVE_BACKFILL_UNSTAMPED"),
      "without backfill, an unstamped key is frozen out of reconcile as UnknownAge",
    );
    assert.equal(fs.backfill.disabled, true, "the disabled backfill phase is reported");
    let meta = JSON.parse(await readFile(metaFile, "utf8")).updatedAt;
    assert.ok(!("HIVE_BACKFILL_UNSTAMPED" in meta), "disabled backfill leaves the key unstamped");

    // Backfill ON: the key is stamped and leaves UnknownAge limbo.
    const healed = await run(["--sync-maintenance"], livePorts);
    assert.equal(healed.status, 0, healed.stderr || healed.stdout);
    const hs = JSON.parse(healed.stdout.trim().split("\n").at(-1));
    assert.ok(
      (hs.backfill.stamped || []).includes("HIVE_BACKFILL_UNSTAMPED"),
      "the backfill stamps the previously-unstamped key",
    );
    assert.ok(
      !(hs.pull.skippedUnknownAge || []).includes("HIVE_BACKFILL_UNSTAMPED"),
      "after backfill the key is no longer frozen as UnknownAge",
    );
    meta = JSON.parse(await readFile(metaFile, "utf8")).updatedAt;
    assert.equal(
      typeof meta.HIVE_BACKFILL_UNSTAMPED,
      "number",
      "the key now carries a real meta timestamp and can sync",
    );

    // Idempotent: backfill only fills gaps — it never rewrites an existing stamp.
    const stamp1 = JSON.parse(await readFile(metaFile, "utf8")).updatedAt.HIVE_BACKFILL_UNSTAMPED;
    await run(["--backfill-meta"], livePorts);
    const stamp2 = JSON.parse(await readFile(metaFile, "utf8")).updatedAt.HIVE_BACKFILL_UNSTAMPED;
    assert.equal(stamp2, stamp1, "an already-stamped key keeps its original timestamp");
  }

  console.log("env sync queue + pull-reconcile tests passed");
} finally {
  peer.close();
  await rm(tmp, { recursive: true, force: true });
}
