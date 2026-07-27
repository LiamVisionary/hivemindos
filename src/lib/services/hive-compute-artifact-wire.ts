import "server-only";

import { createHash } from "node:crypto";

import {
  decryptHiveComputeArtifactChunk,
  importHiveComputeArtifactPrivateKey,
  type HiveComputeArtifactChunkEnvelope,
} from "@/lib/services/hive-compute-artifact-e2ee";
import { getHiveComputeJobPrivateKey } from "@/lib/services/hive-compute-marketplace/job-key-vault";
import type { HiveComputeArtifactDescriptor } from "@/lib/services/hive-compute-workloads";

export const HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC = new TextEncoder().encode("HIVEART1");
const FRAME_PREFIX_BYTES = 8;
const MAX_FRAME_HEADER_BYTES = 4_096;
const MAX_FRAME_CIPHERTEXT_BYTES = 64 * 1024 * 1024;

export type HiveComputeArtifactWireFrame = Omit<HiveComputeArtifactChunkEnvelope, "ciphertext"> & {
  ciphertext: Uint8Array;
};

type WireFrameHeader = Omit<HiveComputeArtifactChunkEnvelope, "ciphertext">;

export async function decryptHiveComputeArtifactWireFromVault(input: {
  body: ReadableStream<Uint8Array>;
  jobId: string;
  descriptor: HiveComputeArtifactDescriptor;
}) {
  const stored = await getHiveComputeJobPrivateKey({
    jobId: input.jobId,
    publicKeySha256: input.descriptor.encryption.publicKeySha256,
  });
  if (!stored) throw new Error("The renter key for this Hive Compute artifact is unavailable or expired.");
  try {
    const privateKey = await importHiveComputeArtifactPrivateKey(stored.privateKeyPkcs8);
    return decryptHiveComputeArtifactWire({ ...input, privateKey });
  } finally {
    stored.privateKeyPkcs8.fill(0);
  }
}

export function decryptHiveComputeArtifactWire(input: {
  body: ReadableStream<Uint8Array>;
  privateKey: CryptoKey;
  jobId: string;
  descriptor: HiveComputeArtifactDescriptor;
}) {
  if (input.descriptor.encryption.chunkSize > MAX_FRAME_CIPHERTEXT_BYTES) {
    throw new Error("Hive Compute artifact chunk size exceeds the local streaming safety limit.");
  }
  const hash = createHash("sha256");
  let bytesRead = 0;
  let buffer = new Uint8Array();
  let magicRead = false;
  let nextChunk = 0;
  let finalSeen = false;

  return input.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      if (!(chunk instanceof Uint8Array) || !chunk.byteLength) return;
      bytesRead += chunk.byteLength;
      if (bytesRead > input.descriptor.ciphertextBytes) {
        throw new Error("Hive Compute artifact wire stream exceeds its signed byte count.");
      }
      hash.update(chunk);
      buffer = concatBytes(buffer, chunk);
      while (true) {
        if (!magicRead) {
          if (buffer.byteLength < HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC.byteLength) return;
          if (!equalBytes(buffer.subarray(0, HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC.byteLength), HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC)) {
            throw new Error("Hive Compute artifact wire magic is invalid.");
          }
          buffer = buffer.slice(HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC.byteLength);
          magicRead = true;
        }
        if (buffer.byteLength < FRAME_PREFIX_BYTES) return;
        const view = new DataView(buffer.buffer, buffer.byteOffset, FRAME_PREFIX_BYTES);
        const headerBytes = view.getUint32(0, false);
        const ciphertextBytes = view.getUint32(4, false);
        if (!headerBytes || headerBytes > MAX_FRAME_HEADER_BYTES) {
          throw new Error("Hive Compute artifact frame header is invalid.");
        }
        if (!ciphertextBytes || ciphertextBytes > input.descriptor.encryption.chunkSize) {
          throw new Error("Hive Compute artifact frame exceeds its signed chunk size.");
        }
        const frameBytes = FRAME_PREFIX_BYTES + headerBytes + ciphertextBytes;
        if (buffer.byteLength < frameBytes) return;
        if (finalSeen) throw new Error("Hive Compute artifact has data after its final frame.");
        const header = parseFrameHeader(buffer.subarray(FRAME_PREFIX_BYTES, FRAME_PREFIX_BYTES + headerBytes));
        if (header.chunkIndex !== nextChunk) {
          throw new Error("Hive Compute artifact frames were duplicated, omitted, or reordered.");
        }
        if (header.final !== (nextChunk === input.descriptor.encryption.chunks - 1)) {
          throw new Error("Hive Compute artifact final-frame marker does not match its signed chunk count.");
        }
        const ciphertext = buffer.subarray(FRAME_PREFIX_BYTES + headerBytes, frameBytes);
        const plaintext = await decryptHiveComputeArtifactChunk({
          privateKey: input.privateKey,
          jobId: input.jobId,
          descriptor: input.descriptor,
          envelope: { ...header, ciphertext: Buffer.from(ciphertext).toString("base64") },
        });
        controller.enqueue(plaintext);
        nextChunk += 1;
        finalSeen = header.final;
        buffer = buffer.slice(frameBytes);
      }
    },
    flush() {
      if (!magicRead || buffer.byteLength || !finalSeen || nextChunk !== input.descriptor.encryption.chunks) {
        throw new Error("Hive Compute artifact wire stream ended before its signed frames completed.");
      }
      if (bytesRead !== input.descriptor.ciphertextBytes) {
        throw new Error("Hive Compute artifact wire byte count does not match its signed descriptor.");
      }
      if (hash.digest("hex") !== input.descriptor.ciphertextSha256) {
        throw new Error("Hive Compute artifact wire hash does not match its signed descriptor.");
      }
    },
  }));
}

export function encodeHiveComputeArtifactWire(frames: HiveComputeArtifactWireFrame[]) {
  if (!frames.length) throw new Error("Hive Compute artifact wire requires at least one frame.");
  const chunks: Uint8Array[] = [HIVE_COMPUTE_ARTIFACT_WIRE_MAGIC];
  for (const frame of frames) {
    chunks.push(encodeHiveComputeArtifactWireFrame(frame));
  }
  return concatMany(chunks);
}

export function encodeHiveComputeArtifactWireFrame(frame: HiveComputeArtifactWireFrame) {
  const header = new TextEncoder().encode(JSON.stringify({
    nonce: frame.nonce,
    tag: frame.tag,
    aad: frame.aad,
    chunkIndex: frame.chunkIndex,
    final: frame.final,
  } satisfies WireFrameHeader));
  if (!header.byteLength || header.byteLength > MAX_FRAME_HEADER_BYTES || !frame.ciphertext.byteLength
    || frame.ciphertext.byteLength > MAX_FRAME_CIPHERTEXT_BYTES) {
    throw new Error("Hive Compute artifact wire frame is invalid.");
  }
  const prefix = new Uint8Array(FRAME_PREFIX_BYTES);
  const view = new DataView(prefix.buffer);
  view.setUint32(0, header.byteLength, false);
  view.setUint32(4, frame.ciphertext.byteLength, false);
  return concatMany([prefix, header, Uint8Array.from(frame.ciphertext)]);
}

function parseFrameHeader(bytes: Uint8Array): WireFrameHeader {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error("Hive Compute artifact frame header is not valid UTF-8 JSON.", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hive Compute artifact frame header must be an object.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["nonce", "tag", "aad", "chunkIndex", "final"].includes(key))) {
    throw new Error("Hive Compute artifact frame header has unsupported fields.");
  }
  const nonce = boundedBase64(record.nonce, 64, 12, "nonce");
  const tag = boundedBase64(record.tag, 64, 16, "authentication tag");
  const aad = typeof record.aad === "string" && record.aad.length <= 1_024 ? record.aad : "";
  const chunkIndex = Number(record.chunkIndex);
  if (!aad || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || typeof record.final !== "boolean") {
    throw new Error("Hive Compute artifact frame binding is invalid.");
  }
  return { nonce, tag, aad, chunkIndex, final: record.final };
}

function boundedBase64(value: unknown, maximum: number, expectedBytes: number, label: string) {
  const text = typeof value === "string" && value.length <= maximum ? value : "";
  if (!text || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(text) || Buffer.from(text, "base64").byteLength !== expectedBytes) {
    throw new Error(`Hive Compute artifact frame ${label} is invalid.`);
  }
  return text;
}

function concatBytes(left: Uint8Array, right: Uint8Array) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(left);
  bytes.set(right, left.byteLength);
  return bytes;
}

function concatMany(chunks: Uint8Array[]) {
  return chunks.reduce((combined, chunk) => concatBytes(combined, chunk), new Uint8Array());
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
