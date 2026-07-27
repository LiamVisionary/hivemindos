import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { homedir } from "@/lib/home-dir";
import { hiveComputeArtifactChunkAad } from "@/lib/services/hive-compute-artifact-e2ee";
import {
  encodeHiveComputeArtifactWireFrame,
  HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC,
} from "@/lib/services/hive-compute-artifact-wire";
import {
  normalizeHiveComputeArtifactDescriptor,
  normalizeHiveComputeResourceId,
  type HiveComputeArtifactDescriptor,
} from "@/lib/services/hive-compute-workloads";

const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;

export type HiveComputeEncryptedInputSpool = {
  path: string;
  manifest: HiveComputeArtifactDescriptor;
  openStream(): Promise<ReadableStream<Uint8Array>>;
  cleanup(): Promise<void>;
};

export async function spoolHiveComputeEncryptedInputArtifact(input: {
  body: ReadableStream<Uint8Array>;
  jobId: unknown;
  artifactId: unknown;
  mimeType: unknown;
  enclavePublicKeyPem: string;
  enclavePublicKeySha256: string;
  maxPlaintextBytes: number;
  chunkSize?: number;
  rootDir?: string;
  signal?: AbortSignal;
}): Promise<HiveComputeEncryptedInputSpool> {
  const jobId = normalizeHiveComputeResourceId(input.jobId, "job id");
  const artifactId = normalizeHiveComputeResourceId(input.artifactId, "artifact id");
  const mimeType = normalizeMimeType(input.mimeType);
  const chunkSize = normalizeChunkSize(input.chunkSize);
  const maxPlaintextBytes = normalizeMaximumBytes(input.maxPlaintextBytes);
  const publicKeyPem = String(input.enclavePublicKeyPem || "").trim();
  const publicKeySha256 = String(input.enclavePublicKeySha256 || "").trim().toLowerCase();
  if (createHash("sha256").update(publicKeyPem, "utf8").digest("hex") !== publicKeySha256) {
    throw new Error("Hive Compute enclave public key does not match its attested SHA-256 binding.");
  }
  const enclaveKey = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(publicKeyDer(publicKeyPem)).buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const keyAlgorithm = enclaveKey.algorithm as RsaHashedKeyAlgorithm;
  if (keyAlgorithm.modulusLength < 2_048) throw new Error("Hive Compute enclave RSA key must be at least 2048 bits.");
  const contentKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  let contentKey: CryptoKey;
  let encryptedKey: Uint8Array;
  try {
    contentKey = await crypto.subtle.importKey("raw", contentKeyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
    encryptedKey = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, enclaveKey, contentKeyBytes));
  } finally {
    contentKeyBytes.fill(0);
  }

  const rootDir = path.resolve(input.rootDir ?? path.join(homedir(), ".hivemindos", "hive-compute", "input-artifacts"));
  await ensurePrivateDirectory(rootDir);
  const suffix = randomUUID();
  const temporaryPath = path.join(rootDir, `.${suffix}.tmp`);
  const finalPath = path.join(rootDir, `${suffix}.hiveart1`);
  const digest = createHash("sha256");
  let ciphertextBytes = 0;
  let chunks = 0;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let finalized = false;
  let published = false;

  const writeEncryptedBytes = async (bytes: Uint8Array) => {
    if (!handle) throw new Error("Hive Compute encrypted input spool is not open.");
    await handle.writeFile(bytes);
    digest.update(bytes);
    ciphertextBytes += bytes.byteLength;
  };

  try {
    handle = await fs.open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
    await writeEncryptedBytes(HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC);
    let pending: Uint8Array | undefined;
    try {
      for await (const plaintext of plaintextChunks(input.body, chunkSize, maxPlaintextBytes, input.signal)) {
        if (pending) {
          await writeEncryptedBytes(await encryptFrame({
            plaintext: pending,
            contentKey,
            jobId,
            artifactId,
            mimeType,
            chunkIndex: chunks,
            final: false,
          }));
          pending.fill(0);
          chunks += 1;
        }
        pending = plaintext;
      }
      if (!pending?.byteLength) throw new Error("Hive Compute input artifact cannot be empty.");
      await writeEncryptedBytes(await encryptFrame({
        plaintext: pending,
        contentKey,
        jobId,
        artifactId,
        mimeType,
        chunkIndex: chunks,
        final: true,
      }));
      pending.fill(0);
      pending = undefined;
      chunks += 1;
    } finally {
      pending?.fill(0);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.link(temporaryPath, finalPath);
    published = true;
    await fs.unlink(temporaryPath);
    await fs.chmod(finalPath, 0o600);
    await syncDirectory(rootDir);
    finalized = true;

    const manifest = normalizeHiveComputeArtifactDescriptor({
      artifactId,
      role: "input",
      mimeType,
      ciphertextBytes,
      ciphertextSha256: digest.digest("hex"),
      encryption: {
        algorithm: "hive-artifact-aes256gcm-v1",
        encryptedKey: Buffer.from(encryptedKey).toString("base64"),
        publicKeySha256,
        chunkSize,
        chunks,
      },
    });
    return {
      path: finalPath,
      manifest,
      async openStream() {
        await fs.access(finalPath, fsConstants.R_OK);
        return Readable.toWeb(createReadStream(finalPath)) as ReadableStream<Uint8Array>;
      },
      async cleanup() {
        await fs.rm(finalPath, { force: true });
      },
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (published || finalized) await fs.rm(finalPath, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    encryptedKey.fill(0);
  }
}

async function encryptFrame(input: {
  plaintext: Uint8Array;
  contentKey: CryptoKey;
  jobId: string;
  artifactId: string;
  mimeType: string;
  chunkIndex: number;
  final: boolean;
}) {
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const aad = hiveComputeArtifactChunkAad(input.jobId, input, input.chunkIndex, input.final);
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
      input.contentKey,
      Uint8Array.from(input.plaintext).buffer,
    ));
    return encodeHiveComputeArtifactWireFrame({
      nonce: Buffer.from(nonce).toString("base64"),
      tag: Buffer.from(sealed.slice(-16)).toString("base64"),
      ciphertext: sealed.slice(0, -16),
      aad,
      chunkIndex: input.chunkIndex,
      final: input.final,
    });
  } finally {
    input.plaintext.fill(0);
  }
}

async function* plaintextChunks(
  body: ReadableStream<Uint8Array>,
  chunkSize: number,
  maximumBytes: number,
  signal?: AbortSignal,
) {
  const reader = body.getReader();
  let chunk = new Uint8Array(chunkSize);
  let used = 0;
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error("Hive Compute input encryption was aborted.");
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new Error("Hive Compute input stream emitted a non-binary chunk.");
      total += next.value.byteLength;
      if (total > maximumBytes) throw new Error("Hive Compute input artifact exceeds its negotiated plaintext byte limit.");
      let offset = 0;
      while (offset < next.value.byteLength) {
        const copied = Math.min(chunkSize - used, next.value.byteLength - offset);
        chunk.set(next.value.subarray(offset, offset + copied), used);
        used += copied;
        offset += copied;
        if (used === chunkSize) {
          yield chunk;
          chunk = new Uint8Array(chunkSize);
          used = 0;
        }
      }
    }
    if (used) yield chunk.slice(0, used);
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    chunk.fill(0);
    reader.releaseLock();
  }
}

function normalizeMaximumBytes(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1024 * 1024 * 1024 * 1024) {
    throw new Error("Hive Compute input artifact maximum must be between 1 byte and 1 TiB.");
  }
  return value;
}

function normalizeChunkSize(value: number | undefined) {
  const chunkSize = value ?? DEFAULT_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_BYTES) {
    throw new Error("Hive Compute input artifact chunk size must be between 1 byte and 64 MiB.");
  }
  return chunkSize;
}

function normalizeMimeType(value: unknown) {
  const mimeType = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType) || mimeType.length > 120) {
    throw new Error("Hive Compute input artifact MIME type is invalid.");
  }
  return mimeType;
}

function publicKeyDer(value: string) {
  const encoded = value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
  if (!encoded) throw new Error("Hive Compute enclave public key is invalid.");
  return Buffer.from(encoded, "base64");
}

async function ensurePrivateDirectory(rootDir: string) {
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  await fs.chmod(rootDir, 0o700);
}

async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, fsConstants.O_RDONLY).catch(() => null);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}
