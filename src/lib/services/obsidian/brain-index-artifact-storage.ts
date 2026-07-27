import "server-only";

import { createHash } from "crypto";
import { gzipSync, gunzipSync } from "zlib";

export const BRAIN_INDEX_TEXT_DELTA_SCHEMA = "hivemindos.brain-index-text-delta.v1" as const;

export type BrainIndexArtifactEncoding = "full" | "gzip" | "text-delta" | "gzip-text-delta";

export type BrainIndexArtifactStorageReceipt = {
  encoding: BrainIndexArtifactEncoding;
  storageSha256: string;
  storageBytes: number;
  baseGenerationId?: string;
  baseSha256?: string;
};

type BrainIndexTextDelta = {
  schema: typeof BRAIN_INDEX_TEXT_DELTA_SCHEMA;
  baseSha256: string;
  resultSha256: string;
  prefixLength: number;
  suffixLength: number;
  inserted: string;
};

const MIN_STORAGE_SAVINGS_BYTES = 64;
const MIN_STORAGE_SAVINGS_RATIO = 0.9;
const MAX_DECOMPRESSED_STORAGE_BYTES = 512 * 1024 * 1024;

export function brainIndexSha256(value: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compressedCandidate(contents: Uint8Array, plainEncoding: BrainIndexArtifactEncoding, gzipEncoding: BrainIndexArtifactEncoding) {
  const compressed = gzipSync(contents, { level: 6 });
  if (
    compressed.byteLength + MIN_STORAGE_SAVINGS_BYTES < contents.byteLength
    && compressed.byteLength < contents.byteLength * MIN_STORAGE_SAVINGS_RATIO
  ) return { encoding: gzipEncoding, storage: Uint8Array.from(compressed) };
  return { encoding: plainEncoding, storage: contents };
}

function textDelta(base: string, result: string): BrainIndexTextDelta {
  const limit = Math.min(base.length, result.length);
  let prefixLength = 0;
  while (prefixLength < limit && base.charCodeAt(prefixLength) === result.charCodeAt(prefixLength)) prefixLength += 1;
  let suffixLength = 0;
  while (
    suffixLength < limit - prefixLength
    && base.charCodeAt(base.length - suffixLength - 1) === result.charCodeAt(result.length - suffixLength - 1)
  ) suffixLength += 1;
  return {
    schema: BRAIN_INDEX_TEXT_DELTA_SCHEMA,
    baseSha256: brainIndexSha256(base),
    resultSha256: brainIndexSha256(result),
    prefixLength,
    suffixLength,
    inserted: result.slice(prefixLength, result.length - suffixLength),
  };
}

export function storeBrainIndexArtifact(input: {
  name: string;
  contents: string;
  parentContents?: string;
  parentGenerationId?: string;
  forceFull?: boolean;
}) {
  const contentBytes = Uint8Array.from(Buffer.from(input.contents, "utf8"));
  const full = compressedCandidate(contentBytes, "full", "gzip");
  if (input.forceFull || input.parentContents === undefined || !input.parentGenerationId) {
    return storedResult(input.name, input.contents, full.encoding, full.storage);
  }
  const delta = textDelta(input.parentContents, input.contents);
  const deltaBytes = Uint8Array.from(Buffer.from(JSON.stringify(delta), "utf8"));
  const deltaCandidate = compressedCandidate(deltaBytes, "text-delta", "gzip-text-delta");
  if (
    deltaCandidate.storage.byteLength + MIN_STORAGE_SAVINGS_BYTES >= full.storage.byteLength
    || deltaCandidate.storage.byteLength >= full.storage.byteLength * MIN_STORAGE_SAVINGS_RATIO
  ) return storedResult(input.name, input.contents, full.encoding, full.storage);
  return storedResult(input.name, input.contents, deltaCandidate.encoding, deltaCandidate.storage, {
    baseGenerationId: input.parentGenerationId,
    baseSha256: delta.baseSha256,
  });
}

function storedResult(
  name: string,
  contents: string,
  encoding: BrainIndexArtifactEncoding,
  storage: Uint8Array,
  base?: { baseGenerationId: string; baseSha256: string },
) {
  const file = encoding === "full"
    ? `${name}.jsonl`
    : encoding === "gzip"
      ? `${name}.jsonl.gz`
      : encoding === "text-delta"
        ? `${name}.delta.json`
        : `${name}.delta.json.gz`;
  return {
    file,
    storage,
    contentSha256: brainIndexSha256(contents),
    contentBytes: Buffer.byteLength(contents, "utf8"),
    storageReceipt: {
      encoding,
      storageSha256: brainIndexSha256(storage),
      storageBytes: storage.byteLength,
      ...base,
    } satisfies BrainIndexArtifactStorageReceipt,
  };
}

export function expectedBrainIndexArtifactFile(name: string, encoding: BrainIndexArtifactEncoding) {
  if (encoding === "full") return `${name}.jsonl`;
  if (encoding === "gzip") return `${name}.jsonl.gz`;
  if (encoding === "text-delta") return `${name}.delta.json`;
  return `${name}.delta.json.gz`;
}

export function restoreBrainIndexArtifact(input: {
  storage: Uint8Array;
  encoding: BrainIndexArtifactEncoding;
  expectedStorageSha256: string;
  expectedStorageBytes: number;
  expectedContentSha256: string;
  expectedContentBytes: number;
  parentContents?: string;
  expectedBaseGenerationId?: string;
  actualBaseGenerationId?: string;
  expectedBaseSha256?: string;
}) {
  if (
    input.storage.byteLength !== input.expectedStorageBytes
    || brainIndexSha256(input.storage) !== input.expectedStorageSha256
  ) throw new Error("Brain index artifact storage checksum verification failed.");
  const unpacked = input.encoding === "gzip" || input.encoding === "gzip-text-delta"
    ? Uint8Array.from(gunzipSync(input.storage, { maxOutputLength: MAX_DECOMPRESSED_STORAGE_BYTES }))
    : input.storage;
  let contents: string;
  if (input.encoding === "text-delta" || input.encoding === "gzip-text-delta") {
    if (
      input.parentContents === undefined
      || !input.expectedBaseGenerationId
      || input.expectedBaseGenerationId !== input.actualBaseGenerationId
      || !input.expectedBaseSha256
      || brainIndexSha256(input.parentContents) !== input.expectedBaseSha256
    ) throw new Error("Brain index delta base verification failed.");
    let delta: BrainIndexTextDelta;
    try {
      delta = JSON.parse(Buffer.from(unpacked).toString("utf8")) as BrainIndexTextDelta;
    } catch {
      throw new Error("Brain index text delta is malformed.");
    }
    if (
      delta.schema !== BRAIN_INDEX_TEXT_DELTA_SCHEMA
      || delta.baseSha256 !== input.expectedBaseSha256
      || delta.resultSha256 !== input.expectedContentSha256
      || !Number.isInteger(delta.prefixLength)
      || delta.prefixLength < 0
      || !Number.isInteger(delta.suffixLength)
      || delta.suffixLength < 0
      || delta.prefixLength + delta.suffixLength > input.parentContents.length
      || typeof delta.inserted !== "string"
    ) throw new Error("Brain index text delta is malformed.");
    contents = input.parentContents.slice(0, delta.prefixLength)
      + delta.inserted
      + input.parentContents.slice(input.parentContents.length - delta.suffixLength);
  } else {
    contents = Buffer.from(unpacked).toString("utf8");
  }
  if (
    Buffer.byteLength(contents, "utf8") !== input.expectedContentBytes
    || brainIndexSha256(contents) !== input.expectedContentSha256
  ) throw new Error("Brain index artifact content checksum verification failed.");
  return contents;
}
