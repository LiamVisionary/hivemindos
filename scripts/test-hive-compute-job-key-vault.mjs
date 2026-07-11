#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { promises as fs } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { createHiveComputeJobKeyVault } = await import(
  "../src/lib/services/hive-compute-marketplace/job-key-vault.ts"
);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PKCS8 = new Uint8Array(privateKey.export({ format: "der", type: "pkcs8" }));
const START = Date.parse("2030-01-01T00:00:00.000Z");

test("stores PKCS8 encrypted at rest with private directory and file permissions", async (t) => {
  const rootDir = await temporaryRoot(t);
  const vault = createHiveComputeJobKeyVault({ rootDir, now: () => START });
  const binding = { jobId: "job-private-roundtrip", publicKeySha256: hash("roundtrip") };
  const stored = await vault.store({ ...binding, privateKeyPkcs8: PKCS8, expiresAt: START + 60_000 });

  assert.equal(stored.expiresAt, "2030-01-01T00:01:00.000Z");
  assert.equal((await fs.stat(rootDir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(vault.paths.vaultFile)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(vault.paths.masterKeyFile)).mode & 0o777, 0o600);

  const vaultJson = await fs.readFile(vault.paths.vaultFile, "utf8");
  const masterKeyText = (await fs.readFile(vault.paths.masterKeyFile, "utf8")).trim();
  assert.equal(Buffer.from(masterKeyText, "base64url").byteLength, 32);
  assert.equal(vaultJson.includes(Buffer.from(PKCS8).toString("base64url")), false, "PKCS8 must not appear at rest");
  assert.match(vaultJson, /"algorithm": "aes-256-gcm"/);

  const restored = await vault.get(binding);
  assert.ok(restored);
  assert.deepEqual(restored.privateKeyPkcs8, PKCS8);
  assert.equal(restored.jobId, binding.jobId);
  assert.equal(restored.publicKeySha256, binding.publicKeySha256);
});

test("fails closed on job/public-key binding mismatches and authenticated metadata tampering", async (t) => {
  const rootDir = await temporaryRoot(t);
  const vault = createHiveComputeJobKeyVault({ rootDir, now: () => START });
  const binding = { jobId: "job-bound", publicKeySha256: hash("bound") };
  await vault.store({ ...binding, privateKeyPkcs8: PKCS8, expiresAt: START + 60_000 });

  await assert.rejects(
    vault.get({ ...binding, publicKeySha256: hash("wrong") }),
    /binding does not match/,
  );
  await assert.rejects(
    vault.store({ ...binding, publicKeySha256: hash("replacement"), privateKeyPkcs8: PKCS8, expiresAt: START + 60_000 }),
    /already bound to a different public key/,
  );

  const stored = JSON.parse(await fs.readFile(vault.paths.vaultFile, "utf8"));
  stored.records[binding.jobId].expiresAt = "2030-01-01T00:02:00.000Z";
  await fs.writeFile(vault.paths.vaultFile, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(vault.get(binding), /failed authenticated decryption/);
});

test("deletes only the exactly bound key and cleans expired records", async (t) => {
  const rootDir = await temporaryRoot(t);
  let currentTime = START;
  const vault = createHiveComputeJobKeyVault({ rootDir, now: () => currentTime });
  const first = { jobId: "job-expiring-first", publicKeySha256: hash("first") };
  const second = { jobId: "job-expiring-second", publicKeySha256: hash("second") };
  const deleted = { jobId: "job-delete", publicKeySha256: hash("delete") };
  await vault.store({ ...first, privateKeyPkcs8: PKCS8, expiresAt: START + 1_000 });
  await vault.store({ ...second, privateKeyPkcs8: PKCS8, expiresAt: START + 2_000 });
  await vault.store({ ...deleted, privateKeyPkcs8: PKCS8, expiresAt: START + 60_000 });

  await assert.rejects(vault.delete({ ...deleted, publicKeySha256: hash("not-delete") }), /binding does not match/);
  assert.equal(await vault.delete(deleted), true);
  assert.equal(await vault.delete(deleted), false);

  currentTime = START + 1_500;
  assert.equal(await vault.get(first), null, "get must delete an expired record before returning");
  assert.ok(await vault.get(second));
  currentTime = START + 2_500;
  assert.equal(await vault.cleanupExpired(), 1);
  assert.equal(await vault.get(second), null);
});

test("serializes concurrent mutations through the filesystem lock and atomic vault replacement", async (t) => {
  const rootDir = await temporaryRoot(t);
  const vault = createHiveComputeJobKeyVault({ rootDir, now: () => START, lockRetryMs: 2 });
  const bindings = Array.from({ length: 16 }, (_, index) => ({
    jobId: `job-concurrent-${index}`,
    publicKeySha256: hash(`concurrent-${index}`),
  }));
  await Promise.all(bindings.map((binding) => vault.store({
    ...binding,
    privateKeyPkcs8: PKCS8,
    expiresAt: START + 60_000,
  })));

  const restored = await Promise.all(bindings.map((binding) => vault.get(binding)));
  assert.equal(restored.every((record) => record && Buffer.from(record.privateKeyPkcs8).equals(Buffer.from(PKCS8))), true);
  const files = await fs.readdir(rootDir);
  assert.equal(files.includes(path.basename(vault.paths.lockDir)), false);
  assert.equal(files.some((name) => name.endsWith(".tmp")), false);
  const rawVault = await fs.readFile(vault.paths.vaultFile, "utf8");
  assert.doesNotThrow(() => JSON.parse(rawVault));
});

test("waits for an existing filesystem lock and never falls back to unlocked writes", async (t) => {
  const rootDir = await temporaryRoot(t);
  const vault = createHiveComputeJobKeyVault({
    rootDir,
    now: () => START,
    lockTimeoutMs: 1_000,
    staleLockMs: 5_000,
    lockRetryMs: 10,
  });
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(vault.paths.lockDir, { mode: 0o700 });
  let completed = false;
  const pending = vault.store({
    jobId: "job-lock-wait",
    publicKeySha256: hash("lock-wait"),
    privateKeyPkcs8: PKCS8,
    expiresAt: START + 60_000,
  }).then(() => {
    completed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(completed, false);
  await fs.rm(vault.paths.lockDir, { recursive: true });
  await pending;
  assert.equal(completed, true);
});

test("rejects invalid and already-expired records without touching the real user vault", async (t) => {
  const rootDir = await temporaryRoot(t);
  const vault = createHiveComputeJobKeyVault({ rootDir, now: () => START });
  assert.equal(vault.paths.rootDir, path.resolve(rootDir));
  await assert.rejects(
    vault.store({ jobId: "../escape", publicKeySha256: hash("escape"), privateKeyPkcs8: PKCS8, expiresAt: START + 1_000 }),
    /job id/,
  );
  await assert.rejects(
    vault.store({ jobId: "job-bad-hash", publicKeySha256: "bad", privateKeyPkcs8: PKCS8, expiresAt: START + 1_000 }),
    /SHA-256/,
  );
  await assert.rejects(
    vault.store({ jobId: "job-expired", publicKeySha256: hash("expired"), privateKeyPkcs8: PKCS8, expiresAt: START }),
    /expiry must be in the future/,
  );
  await assert.rejects(
    vault.store({ jobId: "job-empty", publicKeySha256: hash("empty"), privateKeyPkcs8: new Uint8Array(), expiresAt: START + 1_000 }),
    /PKCS8 bytes are required/,
  );
  await assert.rejects(fs.access(vault.paths.vaultFile));
});

test("implementation has no browser, environment, or Shared Brain persistence path", async () => {
  const source = await fs.readFile(
    new URL("../src/lib/services/hive-compute-marketplace/job-key-vault.ts", import.meta.url),
    "utf8",
  );
  for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "process.env", "hive-brain", "Obsidian"]) {
    assert.equal(source.includes(forbidden), false, `job key vault must not use ${forbidden}`);
  }
});

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryRoot(t) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), "hive-compute-job-keys-"));
  const root = path.join(parent, ".hivemindos", "hive-compute", "job-key-vault");
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return root;
}
