#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import process from "node:process";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  normalizeHiveComputeArtifactDescriptor,
  normalizeHiveComputeJobDraftRequest,
  normalizeHiveComputeJobSubmission,
  normalizeHiveComputeResourceId,
  normalizeHiveComputeWorkloadManifest,
} = await import("../src/lib/services/hive-compute-workloads.ts");
const {
  decryptHiveComputeArtifactChunk,
  encryptHiveComputeJobPayload,
  generateHiveComputeArtifactKeyPair,
  hiveComputeArtifactChunkAad,
  verifyHiveComputeCiphertext,
} = await import("../src/lib/services/hive-compute-artifact-e2ee.ts");
const {
  decryptHiveComputeArtifactWire,
  encodeHiveComputeArtifactWire,
} = await import("../src/lib/services/hive-compute-artifact-wire.ts");

const hash = "a".repeat(64);
const offering = {
  id: "image-fixture",
  adapter: "confidential-sidecar",
  protocol: "hive-compute.workload.v1",
  kind: "image",
  task: "image.generate",
  model: "fixture-image",
  inputMimeTypes: ["application/json"],
  outputMimeTypes: ["image/png"],
  billingUnit: "image",
  usdMicroPerUnit: 20_000,
  minimumJobUsdMicro: 0,
  maxUnits: 4,
  maxInputBytes: 1_048_576,
  maxOutputBytes: 67_108_864,
  asynchronous: true,
  privacy: "hardware-tee-e2ee",
};

const manifest = normalizeHiveComputeWorkloadManifest({
  protocol: "hive-compute.workload.v1",
  offerings: [offering, { ...offering, id: "custom-fixture", kind: "custom", task: "vendor.task", billingUnit: "job" }],
});
assert(manifest.offerings.length === 2 && manifest.offerings[0].kind === "image", "canonical workload manifest");
throws(() => normalizeHiveComputeWorkloadManifest({ protocol: "hive-compute.workload.v1", offerings: [{ ...offering, adapter: "http-json" }] }), "non-confidential adapter");
throws(() => normalizeHiveComputeWorkloadManifest({ protocol: "hive-compute.workload.v1", offerings: [{ ...offering, kind: "custom", task: "shell" }] }), "unnamespaced custom task");
throws(() => normalizeHiveComputeWorkloadManifest({ protocol: "hive-compute.workload.v1", offerings: [{ ...offering, kind: "model3d" }] }), "parallel 3d spelling");

const draft = normalizeHiveComputeJobDraftRequest({
  kind: "3d",
  model: "fixture-3d",
  task: "mesh.generate",
  billingUnit: "artifact",
  requestedUnits: 1,
  inputMimeTypes: ["application/octet-stream"],
  outputMimeTypes: ["model/gltf-binary"],
  maxInputBytes: 10_000_000,
  maxOutputBytes: 100_000_000,
  idempotencyKey: "fixture-draft",
});
assert(draft.kind === "3d" && draft.billingUnit === "artifact", "canonical draft");

const artifact = normalizeHiveComputeArtifactDescriptor({
  artifactId: "input-1",
  role: "input",
  mimeType: "image/png",
  ciphertextBytes: 128,
  ciphertextSha256: hash,
  encryption: {
    algorithm: "hive-artifact-aes256gcm-v1",
    encryptedKey: "fixture-key",
    publicKeySha256: hash,
    chunkSize: 64,
    chunks: 2,
  },
});
assert(artifact.role === "input" && artifact.encryption.chunks === 2, "input ciphertext artifact manifest");

const submission = {
  jobId: "job-fixture",
  kind: "image",
  model: "fixture-image",
  encryptedPayload: { algorithm: "rsa-oaep-a256gcm", ciphertext: "opaque" },
  inputArtifacts: [artifact],
  outputEncryption: { required: true, algorithm: "rsa-oaep-a256gcm", publicKey: "fixture-public-key", publicKeySha256: hash },
  idempotencyKey: "fixture-submit",
};
assert(normalizeHiveComputeJobSubmission(submission).inputArtifacts.length === 1, "ciphertext-only submit");
throws(() => normalizeHiveComputeJobSubmission({ ...submission, parameters: { prompt: "plaintext" } }), "plaintext parameters");
throws(() => normalizeHiveComputeJobSubmission({ ...submission, options: { command: "rm" } }), "plaintext options");
throws(() => normalizeHiveComputeResourceId("job/path", "job id"), "slash in resource id");
throws(() => normalizeHiveComputeResourceId("../job", "job id"), "path-like resource id");

const keys = await generateHiveComputeArtifactKeyPair();
assert(keys.publicKeyPem.includes("BEGIN PUBLIC KEY") && keys.privateKeyPkcs8.byteLength > 1000, "renter key generation");
const sealedPayload = await encryptHiveComputeJobPayload({
  payload: { prompt: "must remain encrypted", seed: 42 },
  publicKeyPem: keys.publicKeyPem,
  publicKeySha256: keys.publicKeySha256,
  aad: "hive-compute-job-input:job-fixture",
});
const payloadKey = await crypto.subtle.decrypt(
  { name: "RSA-OAEP" },
  keys.privateKey,
  Buffer.from(sealedPayload.encryptedKey, "base64"),
);
const decryptedPayload = await crypto.subtle.decrypt(
  {
    name: "AES-GCM",
    iv: Buffer.from(sealedPayload.nonce, "base64"),
    additionalData: new TextEncoder().encode(sealedPayload.aad),
    tagLength: 128,
  },
  await crypto.subtle.importKey("raw", payloadKey, "AES-GCM", false, ["decrypt"]),
  Buffer.concat([Buffer.from(sealedPayload.ciphertext, "base64"), Buffer.from(sealedPayload.tag, "base64")]),
);
assert(JSON.parse(new TextDecoder().decode(decryptedPayload)).prompt === "must remain encrypted", "hybrid encrypted job payload round-trip");

const outputKey = crypto.getRandomValues(new Uint8Array(32));
const encryptedOutputKey = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, keys.publicKey, outputKey));
const outputNonce = crypto.getRandomValues(new Uint8Array(12));
const outputDescriptor = {
  artifactId: "output-1",
  role: "output",
  mimeType: "image/png",
  ciphertextBytes: 0,
  ciphertextSha256: hash,
  encryption: {
    algorithm: "hive-artifact-aes256gcm-v1",
    encryptedKey: Buffer.from(encryptedOutputKey).toString("base64"),
    publicKeySha256: keys.publicKeySha256,
    chunkSize: 1024,
    chunks: 1,
  },
};
const outputAad = hiveComputeArtifactChunkAad("job-fixture", outputDescriptor, 0, true);
const sealedOutput = new Uint8Array(await crypto.subtle.encrypt(
  { name: "AES-GCM", iv: outputNonce, additionalData: new TextEncoder().encode(outputAad), tagLength: 128 },
  await crypto.subtle.importKey("raw", outputKey, "AES-GCM", false, ["encrypt"]),
  new TextEncoder().encode("renter-only image bytes"),
));
const outputCiphertext = sealedOutput.slice(0, -16);
const normalizedOutputDescriptor = normalizeHiveComputeArtifactDescriptor({
  ...outputDescriptor,
  ciphertextBytes: outputCiphertext.byteLength,
  ciphertextSha256: await digestHex(outputCiphertext),
});
const openedOutput = await decryptHiveComputeArtifactChunk({
  privateKey: keys.privateKey,
  jobId: "job-fixture",
  descriptor: normalizedOutputDescriptor,
  envelope: {
    nonce: Buffer.from(outputNonce).toString("base64"),
    tag: Buffer.from(sealedOutput.slice(-16)).toString("base64"),
    ciphertext: Buffer.from(outputCiphertext).toString("base64"),
    aad: outputAad,
    chunkIndex: 0,
    final: true,
  },
});
assert(new TextDecoder().decode(openedOutput) === "renter-only image bytes", "encrypted artifact round-trip");
await verifyHiveComputeCiphertext(outputCiphertext, normalizedOutputDescriptor);
await rejects(() => verifyHiveComputeCiphertext(Uint8Array.from([...outputCiphertext, 1]), normalizedOutputDescriptor), "artifact hash/size tampering");
await rejects(() => decryptHiveComputeArtifactChunk({
  privateKey: keys.privateKey,
  jobId: "wrong-job",
  descriptor: normalizedOutputDescriptor,
  envelope: {
    nonce: Buffer.from(outputNonce).toString("base64"),
    tag: Buffer.from(sealedOutput.slice(-16)).toString("base64"),
    ciphertext: Buffer.from(outputCiphertext).toString("base64"),
    aad: outputAad,
    chunkIndex: 0,
    final: true,
  },
}), "artifact AAD/job tampering");
const artifactWire = encodeHiveComputeArtifactWire([{
  nonce: Buffer.from(outputNonce).toString("base64"),
  tag: Buffer.from(sealedOutput.slice(-16)).toString("base64"),
  aad: outputAad,
  chunkIndex: 0,
  final: true,
  ciphertext: outputCiphertext,
}]);
const wireDescriptor = normalizeHiveComputeArtifactDescriptor({
  ...outputDescriptor,
  ciphertextBytes: artifactWire.byteLength,
  ciphertextSha256: await digestHex(artifactWire),
});
const openedWire = await collectStream(decryptHiveComputeArtifactWire({
  body: chunkedStream(artifactWire, 7),
  privateKey: keys.privateKey,
  jobId: "job-fixture",
  descriptor: wireDescriptor,
}));
assert(new TextDecoder().decode(openedWire) === "renter-only image bytes", "length-prefixed encrypted artifact wire round-trip");
const tamperedWire = Uint8Array.from(artifactWire);
tamperedWire[tamperedWire.length - 1] ^= 1;
await rejects(() => collectStream(decryptHiveComputeArtifactWire({
  body: chunkedStream(tamperedWire, 5),
  privateKey: keys.privateKey,
  jobId: "job-fixture",
  descriptor: wireDescriptor,
})), "artifact wire authentication/hash tampering");
keys.privateKeyPkcs8.fill(0);

const root = process.cwd();
const service = readFileSync(join(root, "src/lib/services/hive-compute-marketplace.ts"), "utf8");
const confidentialChat = readFileSync(join(root, "src/lib/services/hive-compute-confidential-chat.ts"), "utf8");
const gatewayClient = readFileSync(join(root, "src/lib/services/hive-compute-marketplace/gateway-client.ts"), "utf8");
assert(service.indexOf("...forwardedHiveComputePrivacyHeaders(requestHeaders)") < service.indexOf("...(confidential?.headers ?? {})"), "caller headers cannot override renter key/hardware policy");
assert(service.includes("HIVE_COMPUTE_SELF_HOSTED_ALLOW_NONCONFIDENTIAL_ENV") && service.includes("isExplicitSelfHostedHiveComputeUrl"), "plaintext compatibility is self-hosted only");
assert(confidentialChat.includes("envelope.publicKeySha256 !== publicKeySha256") && confidentialChat.includes("envelope.sequence !== nextSequence") && confidentialChat.includes("envelope.aad !== expectedAad"), "chat decryptor fails closed on key, AAD, and sequence tampering");
const gatewayBody = gatewayClient.slice(gatewayClient.indexOf("function gatewayJobBody"), gatewayClient.indexOf("async function cleanupTerminalJobKey"));
assert(!gatewayBody.includes("privateKey") && !gatewayBody.includes("privateKeyPkcs8"), "renter private key must never enter a gateway body");
assert(gatewayClient.includes("storeHiveComputeJobPrivateKey") && gatewayClient.includes("deleteHiveComputeJobPrivateKey"), "async renter keys must use the encrypted local vault");
assert(gatewayClient.includes("streamDecryptedHiveComputeArtifact") && gatewayClient.includes("decryptHiveComputeArtifactWireFromVault"), "artifact download must expose a local renter-key decryption stream");
for (const header of ["X-Hive-Compute-Encrypted-Key", "X-Hive-Compute-Chunk-Size", "X-Hive-Compute-Chunks"]) {
  assert(gatewayClient.includes(header), `input artifact upload must forward canonical ${header} metadata`);
}

console.log("Hive Compute confidential workload tests passed.");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function throws(run, label) {
  let failed = false;
  try { run(); } catch { failed = true; }
  assert(failed, `Expected rejection: ${label}`);
}

async function rejects(run, label) {
  let failed = false;
  try { await run(); } catch { failed = true; }
  assert(failed, `Expected async rejection: ${label}`);
}

async function digestHex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Buffer.from(digest).toString("hex");
}

function chunkedStream(bytes, size) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + size));
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
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
