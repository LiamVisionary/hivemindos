#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { generateHiveComputeArtifactKeyPair } = await import("../src/lib/services/hive-compute-artifact-e2ee.ts");
const { decryptHiveComputeArtifactWire } = await import("../src/lib/services/hive-compute-artifact-wire.ts");
const { spoolHiveComputeEncryptedInputArtifact } = await import(
  "../src/lib/services/hive-compute-input-artifact-spool.ts"
);

test("spools only encrypted HIVEART1 bytes, decrypts locally, and removes the spool", async (t) => {
  const rootDir = await temporaryRoot(t);
  const keys = await generateHiveComputeArtifactKeyPair();
  const marker = "PLAINTEXT-MUST-NEVER-TOUCH-DISK::";
  const plaintext = Buffer.from(marker + "abcdefghij".repeat(1_500));
  const spool = await spoolHiveComputeEncryptedInputArtifact({
    body: chunkedStream(plaintext, 733),
    jobId: "job-input-fixture",
    artifactId: "source-image",
    mimeType: "image/png",
    enclavePublicKeyPem: keys.publicKeyPem,
    enclavePublicKeySha256: keys.publicKeySha256,
    maxPlaintextBytes: plaintext.byteLength,
    chunkSize: 1_024,
    rootDir,
  });

  assert.equal((await fs.stat(rootDir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(spool.path)).mode & 0o777, 0o600);
  const encrypted = await fs.readFile(spool.path);
  assert.equal(encrypted.subarray(0, 8).toString("utf8"), "HIVEART1");
  assert.equal(encrypted.includes(Buffer.from(marker)), false, "plaintext marker must not occur in the encrypted spool");
  assert.equal(spool.manifest.ciphertextBytes, encrypted.byteLength);
  assert.equal(spool.manifest.ciphertextSha256, createHash("sha256").update(encrypted).digest("hex"));
  assert.equal(spool.manifest.encryption.chunks, Math.ceil(plaintext.byteLength / 1_024));
  assert.equal(spool.manifest.encryption.publicKeySha256, keys.publicKeySha256);

  const decrypted = await collectStream(decryptHiveComputeArtifactWire({
    body: await spool.openStream(),
    privateKey: keys.privateKey,
    jobId: "job-input-fixture",
    descriptor: spool.manifest,
  }));
  assert.deepEqual(decrypted, plaintext);

  const tampered = Buffer.from(encrypted);
  tampered[tampered.byteLength - 1] ^= 1;
  await fs.writeFile(spool.path, tampered);
  await assert.rejects(collectStream(decryptHiveComputeArtifactWire({
    body: await spool.openStream(),
    privateKey: keys.privateKey,
    jobId: "job-input-fixture",
    descriptor: spool.manifest,
  })), /operation failed|hash does not match|authenticated|decrypt/i);

  await spool.cleanup();
  await assert.rejects(fs.access(spool.path));
  await assert.rejects(spool.openStream());
  keys.privateKeyPkcs8.fill(0);
});

test("oversized, empty, and key-mismatched inputs leave no temporary or final artifact", async (t) => {
  const rootDir = await temporaryRoot(t);
  const keys = await generateHiveComputeArtifactKeyPair();
  const base = {
    jobId: "job-bounded",
    artifactId: "input-bounded",
    mimeType: "application/octet-stream",
    enclavePublicKeyPem: keys.publicKeyPem,
    enclavePublicKeySha256: keys.publicKeySha256,
    chunkSize: 64,
    rootDir,
  };
  await assert.rejects(spoolHiveComputeEncryptedInputArtifact({
    ...base,
    body: chunkedStream(Buffer.alloc(65, 7), 65),
    maxPlaintextBytes: 64,
  }), /exceeds its negotiated plaintext byte limit/);
  assert.deepEqual(await fs.readdir(rootDir), []);

  await assert.rejects(spoolHiveComputeEncryptedInputArtifact({
    ...base,
    body: chunkedStream(Buffer.alloc(0), 1),
    maxPlaintextBytes: 64,
  }), /cannot be empty/);
  assert.deepEqual(await fs.readdir(rootDir), []);

  await assert.rejects(spoolHiveComputeEncryptedInputArtifact({
    ...base,
    body: chunkedStream(Buffer.from("secret"), 2),
    maxPlaintextBytes: 64,
    enclavePublicKeySha256: "0".repeat(64),
  }), /does not match its attested SHA-256 binding/);
  assert.deepEqual(await fs.readdir(rootDir), []);
  keys.privateKeyPkcs8.fill(0);
});

test("implementation publishes only encrypted frames and uses exclusive private files", async () => {
  const source = await fs.readFile(
    new URL("../src/lib/services/hive-compute-input-artifact-spool.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /O_CREAT \| fsConstants\.O_EXCL \| fsConstants\.O_WRONLY, 0o600/);
  assert.match(source, /fs\.link\(temporaryPath, finalPath\)/);
  assert.equal(source.includes("writeEncryptedBytes(plaintext"), false);
  assert.equal(source.includes("writeFile(input.body"), false);
});

function chunkedStream(bytes, size) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(Uint8Array.from(bytes.subarray(offset, offset + size)));
      offset += size;
    },
  });
}

async function collectStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function temporaryRoot(t) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), "hive-compute-input-spool-"));
  const root = path.join(parent, "encrypted-inputs");
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return root;
}
