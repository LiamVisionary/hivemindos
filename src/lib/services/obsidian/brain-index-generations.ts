import "server-only";

import { createHash, randomUUID } from "crypto";
import { constants } from "fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import {
  expectedBrainIndexArtifactFile,
  restoreBrainIndexArtifact,
  storeBrainIndexArtifact,
  type BrainIndexArtifactEncoding,
} from "@/lib/services/obsidian/brain-index-artifact-storage";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

export const BRAIN_INDEX_GENERATIONS_FOLDER = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Index Generations`;
export const LEGACY_BRAIN_INDEX_GENERATION_SCHEMA = "hivemindos.brain-index-generation.v1" as const;
export const BRAIN_INDEX_GENERATION_SCHEMA = "hivemindos.brain-index-generation.v2" as const;
export const BRAIN_INDEX_POINTER_SCHEMA = "hivemindos.brain-index-pointer.v1" as const;
export const BRAIN_INDEX_REPLAY_COVERAGE_SCHEMA = "hivemindos.brain-index-replay-coverage.v1" as const;

export type BrainIndexGenerationKind = "agent-memory" | "full-vault";

export type BrainIndexRetentionPolicy = {
  maxGenerations: number;
  checkpointInterval: number;
};

export const BRAIN_INDEX_RETENTION_POLICIES: Record<BrainIndexGenerationKind, BrainIndexRetentionPolicy> = {
  "agent-memory": { maxGenerations: 256, checkpointInterval: 32 },
  "full-vault": { maxGenerations: 32, checkpointInterval: 4 },
};

export type BrainIndexSourceReceipt = {
  path: string;
  sha256: string;
};

export type BrainIndexArtifactReceipt = {
  name: string;
  file: string;
  /** Checksum and size of the reconstructed complete artifact. */
  sha256: string;
  bytes: number;
  records: number;
  encoding?: BrainIndexArtifactEncoding;
  /** Checksum and size of the stored full, compressed, or delta payload. */
  storageSha256?: string;
  storageBytes?: number;
  baseGenerationId?: string;
  baseSha256?: string;
};

type BrainIndexGenerationManifestBase = {
  kind: BrainIndexGenerationKind;
  generationId: string;
  createdAt: string;
  parentGenerationId?: string;
  sourceCount: number;
  sourceSetHash: string;
  sources: BrainIndexSourceReceipt[];
  artifacts: BrainIndexArtifactReceipt[];
  metadata?: Record<string, unknown>;
};

export type LegacyBrainIndexGenerationManifest = BrainIndexGenerationManifestBase & {
  schema: typeof LEGACY_BRAIN_INDEX_GENERATION_SCHEMA;
};

export type BrainIndexGenerationManifestV2 = BrainIndexGenerationManifestBase & {
  schema: typeof BRAIN_INDEX_GENERATION_SCHEMA;
  checkpoint: boolean;
  distanceFromCheckpoint: number;
  retentionPolicy: BrainIndexRetentionPolicy;
};

export type BrainIndexGenerationManifest = LegacyBrainIndexGenerationManifest | BrainIndexGenerationManifestV2;

type BrainIndexPointer = {
  schema: typeof BRAIN_INDEX_POINTER_SCHEMA;
  kind: BrainIndexGenerationKind;
  generationId: string;
  previousGenerationId?: string;
  manifestSha256: string;
  updatedAt: string;
};

type BrainIndexReplayCoverageRecord = {
  schema: typeof BRAIN_INDEX_REPLAY_COVERAGE_SCHEMA;
  kind: BrainIndexGenerationKind;
  policy: BrainIndexRetentionPolicy;
  prunedGenerationCount: number;
  prunedThroughGenerationId?: string;
  prunedThroughCreatedAt?: string;
  updatedAt: string;
};

export type BrainIndexReplayCoverage = {
  coverageReceipt: "absent" | "valid" | "invalid" | "missing";
  policy: BrainIndexRetentionPolicy;
  retainedGenerationCount: number;
  verifiedGenerationCount: number;
  invalidGenerationCount: number;
  checkpointCount: number;
  unexpectedMissingParentCount: number;
  earliestRetainedGenerationId?: string;
  earliestRetainedAt?: string;
  latestRetainedGenerationId?: string;
  latestRetainedAt?: string;
  replayCompleteFromGenerationId?: string;
  replayCompleteFrom?: string;
  prunedGenerationCount: number;
  prunedGenerationCountKnown: boolean;
  prunedThroughGenerationId?: string;
  prunedThrough?: string;
  completeHistory: boolean;
};

type PublishArtifact = {
  name: string;
  contents: string;
  records: number;
  legacyPath?: string;
};

type VerifiedGeneration = {
  manifest: BrainIndexGenerationManifest;
  artifacts: Map<string, string>;
  manifestPath: string;
  verified: true;
};

type VerificationContext = {
  memo: Map<string, Promise<VerifiedGeneration | null>>;
};

const GENERATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,96}$/;
const ARTIFACT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const MAX_DELTA_CHAIN_DEPTH = 1024;

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function kindRoot(root: string, kind: BrainIndexGenerationKind) {
  return join(root, BRAIN_INDEX_GENERATIONS_FOLDER, kind);
}

function pointerPath(root: string, kind: BrainIndexGenerationKind) {
  return join(kindRoot(root, kind), "current.json");
}

function coveragePath(root: string, kind: BrainIndexGenerationKind) {
  return join(kindRoot(root, kind), "coverage.json");
}

function isValidGenerationId(value: unknown): value is string {
  return typeof value === "string" && GENERATION_ID_PATTERN.test(value);
}

function isSafeReceiptPath(value: unknown): value is string {
  return typeof value === "string"
    && Boolean(value)
    && value.length <= 1024
    && !isAbsolute(value)
    && !/[\0\r\n]/.test(value)
    && !value.split(/[\\/]+/).includes("..");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isRetentionPolicy(value: unknown): value is BrainIndexRetentionPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as BrainIndexRetentionPolicy;
  return Number.isInteger(policy.maxGenerations)
    && policy.maxGenerations >= 2
    && policy.maxGenerations <= 100_000
    && Number.isInteger(policy.checkpointInterval)
    && policy.checkpointInterval >= 1
    && policy.checkpointInterval <= Math.min(policy.maxGenerations, MAX_DELTA_CHAIN_DEPTH);
}

function retentionPolicy(input: BrainIndexRetentionPolicy | undefined, kind: BrainIndexGenerationKind) {
  const policy = input ?? BRAIN_INDEX_RETENTION_POLICIES[kind];
  if (!isRetentionPolicy(policy)) throw new Error("Invalid brain index retention policy.");
  return { ...policy };
}

function generationRoot(root: string, kind: BrainIndexGenerationKind, generationId: string) {
  if (!isValidGenerationId(generationId)) throw new Error("Invalid brain index generation id.");
  const path = join(kindRoot(root, kind), generationId);
  const rel = relative(resolve(root), resolve(path));
  if (rel.startsWith("..")) throw new Error("Brain index generation path escaped the vault.");
  return path;
}

async function writeAtomic(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readPointer(root: string, kind: BrainIndexGenerationKind) {
  const path = pointerPath(root, kind);
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw) return null;
  try {
    const pointer = JSON.parse(raw) as BrainIndexPointer;
    if (
      pointer.schema !== BRAIN_INDEX_POINTER_SCHEMA
      || pointer.kind !== kind
      || !isValidGenerationId(pointer.generationId)
      || (pointer.previousGenerationId !== undefined && !isValidGenerationId(pointer.previousGenerationId))
      || !isSha256(pointer.manifestSha256)
      || !Number.isFinite(Date.parse(pointer.updatedAt))
    ) return null;
    return { pointer, path };
  } catch {
    return null;
  }
}

function isManifestCheckpoint(manifest: BrainIndexGenerationManifest) {
  return manifest.schema === LEGACY_BRAIN_INDEX_GENERATION_SCHEMA || manifest.checkpoint;
}

function validateManifestBase(manifest: BrainIndexGenerationManifest, kind: BrainIndexGenerationKind, generationId: string) {
  return manifest.kind === kind
    && manifest.generationId === generationId
    && Number.isFinite(Date.parse(manifest.createdAt))
    && (manifest.parentGenerationId === undefined || isValidGenerationId(manifest.parentGenerationId))
    && Array.isArray(manifest.sources)
    && !manifest.sources.some((source) => !isSafeReceiptPath(source?.path) || !isSha256(source.sha256))
    && new Set(manifest.sources.map((source) => source.path)).size === manifest.sources.length
    && manifest.sourceCount === manifest.sources.length
    && manifest.sourceSetHash === sha256(canonicalJson(manifest.sources))
    && Array.isArray(manifest.artifacts);
}

function validV2Receipt(receipt: BrainIndexArtifactReceipt, manifest: BrainIndexGenerationManifestV2) {
  const encoding = receipt.encoding;
  if (
    encoding !== "full"
    && encoding !== "gzip"
    && encoding !== "text-delta"
    && encoding !== "gzip-text-delta"
  ) return false;
  const delta = encoding === "text-delta" || encoding === "gzip-text-delta";
  return receipt.file === expectedBrainIndexArtifactFile(receipt.name, encoding)
    && isSha256(receipt.storageSha256)
    && Number.isInteger(receipt.storageBytes)
    && (receipt.storageBytes ?? -1) >= 0
    && (delta
      ? isValidGenerationId(receipt.baseGenerationId)
        && receipt.baseGenerationId === manifest.parentGenerationId
        && isSha256(receipt.baseSha256)
      : receipt.baseGenerationId === undefined && receipt.baseSha256 === undefined);
}

function validateArtifactReceipt(receipt: BrainIndexArtifactReceipt, manifest: BrainIndexGenerationManifest) {
  if (
    !ARTIFACT_NAME_PATTERN.test(receipt?.name ?? "")
    || !isSha256(receipt.sha256)
    || !Number.isInteger(receipt.bytes)
    || receipt.bytes < 0
    || !Number.isInteger(receipt.records)
    || receipt.records < 0
  ) return false;
  if (manifest.schema === LEGACY_BRAIN_INDEX_GENERATION_SCHEMA) {
    return receipt.file === `${receipt.name}.jsonl`
      && receipt.encoding === undefined
      && receipt.storageSha256 === undefined
      && receipt.storageBytes === undefined
      && receipt.baseGenerationId === undefined
      && receipt.baseSha256 === undefined;
  }
  return validV2Receipt(receipt, manifest);
}

async function parseManifest(
  root: string,
  kind: BrainIndexGenerationKind,
  generationId: string,
  expectedManifestHash?: string,
) {
  const folder = generationRoot(root, kind, generationId);
  const manifestPath = join(folder, "manifest.json");
  const rawManifest = await readFile(manifestPath, "utf8").catch(() => "");
  if (!rawManifest || (expectedManifestHash && sha256(rawManifest) !== expectedManifestHash)) return null;
  let manifest: BrainIndexGenerationManifest;
  try {
    manifest = JSON.parse(rawManifest) as BrainIndexGenerationManifest;
  } catch {
    return null;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  if (
    (manifest.schema !== LEGACY_BRAIN_INDEX_GENERATION_SCHEMA && manifest.schema !== BRAIN_INDEX_GENERATION_SCHEMA)
    || !validateManifestBase(manifest, kind, generationId)
    || (manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA && (
      typeof manifest.checkpoint !== "boolean"
      || !Number.isInteger(manifest.distanceFromCheckpoint)
      || manifest.distanceFromCheckpoint < 0
      || manifest.distanceFromCheckpoint > MAX_DELTA_CHAIN_DEPTH
      || manifest.checkpoint !== (manifest.distanceFromCheckpoint === 0)
      || !isRetentionPolicy(manifest.retentionPolicy)
    ))
  ) return null;
  return { manifest, manifestPath, folder, rawManifest };
}

async function readVerifiedGeneration(
  root: string,
  kind: BrainIndexGenerationKind,
  generationId: string,
  expectedManifestHash?: string,
  context: VerificationContext = { memo: new Map() },
  ancestry: ReadonlySet<string> = new Set(),
): Promise<VerifiedGeneration | null> {
  if (!isValidGenerationId(generationId)) throw new Error("Invalid brain index generation id.");
  if (ancestry.has(generationId) || ancestry.size > MAX_DELTA_CHAIN_DEPTH) return null;
  const parsed = await parseManifest(root, kind, generationId, expectedManifestHash);
  if (!parsed) return null;
  const cached = context.memo.get(generationId);
  if (cached) return cached;
  const verification = (async () => {
    const { manifest, manifestPath, folder } = parsed;
    const receiptNames = new Set<string>();
    if (manifest.artifacts.some((receipt) => {
      if (!validateArtifactReceipt(receipt, manifest) || receiptNames.has(receipt.name)) return true;
      receiptNames.add(receipt.name);
      return false;
    })) return null;

    const nextAncestry = new Set(ancestry).add(generationId);
    const needsParent = manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA
      && manifest.artifacts.some((receipt) => receipt.encoding === "text-delta" || receipt.encoding === "gzip-text-delta");
    const parent = needsParent && manifest.parentGenerationId
      ? await readVerifiedGeneration(root, kind, manifest.parentGenerationId, undefined, context, nextAncestry)
      : null;
    if (needsParent && !parent) return null;
    if (manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA && !manifest.checkpoint) {
      if (!parent || manifest.distanceFromCheckpoint !== (parent.manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA ? parent.manifest.distanceFromCheckpoint : 0) + 1) return null;
    }

    const artifacts = new Map<string, string>();
    for (const receipt of manifest.artifacts) {
      try {
        if (manifest.schema === LEGACY_BRAIN_INDEX_GENERATION_SCHEMA) {
          const contents = await readFile(join(folder, receipt.file), "utf8");
          if (Buffer.byteLength(contents, "utf8") !== receipt.bytes || sha256(contents) !== receipt.sha256) return null;
          artifacts.set(receipt.name, contents);
          continue;
        }
        const storage = await readFile(join(folder, receipt.file));
        const contents = restoreBrainIndexArtifact({
          storage: Uint8Array.from(storage),
          encoding: receipt.encoding!,
          expectedStorageSha256: receipt.storageSha256!,
          expectedStorageBytes: receipt.storageBytes!,
          expectedContentSha256: receipt.sha256,
          expectedContentBytes: receipt.bytes,
          parentContents: parent?.artifacts.get(receipt.name),
          expectedBaseGenerationId: receipt.baseGenerationId,
          actualBaseGenerationId: parent?.manifest.generationId,
          expectedBaseSha256: receipt.baseSha256,
        });
        artifacts.set(receipt.name, contents);
      } catch {
        return null;
      }
    }
    if (manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA && manifest.checkpoint) {
      if (manifest.artifacts.some((receipt) => receipt.encoding === "text-delta" || receipt.encoding === "gzip-text-delta")) return null;
    }
    return { manifest, artifacts, manifestPath, verified: true as const };
  })();
  context.memo.set(generationId, verification);
  return verification;
}

async function generationDirectoryNames(root: string, kind: BrainIndexGenerationKind) {
  const entries = await readdir(kindRoot(root, kind), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((item) => item.isDirectory() && isValidGenerationId(item.name) && !item.name.includes(".tmp-"))
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right));
}

async function missingGenerationParents(root: string, kind: BrainIndexGenerationKind, generationIds: string[]) {
  const retained = new Set(generationIds);
  const missing = new Set<string>();
  for (const generationId of generationIds) {
    const parsed = await parseManifest(root, kind, generationId);
    if (parsed?.manifest.parentGenerationId && !retained.has(parsed.manifest.parentGenerationId)) missing.add(parsed.manifest.parentGenerationId);
  }
  return [...missing].sort((left, right) => left.localeCompare(right));
}

async function newestVerifiedGeneration(root: string, kind: BrainIndexGenerationKind, excluded = new Set<string>()) {
  const context: VerificationContext = { memo: new Map() };
  const entries = (await generationDirectoryNames(root, kind)).reverse();
  for (const generationId of entries) {
    if (excluded.has(generationId)) continue;
    const recovered = await readVerifiedGeneration(root, kind, generationId, undefined, context);
    if (recovered) return recovered;
  }
  return null;
}

async function readCoverageState(root: string, kind: BrainIndexGenerationKind) {
  const raw = await readFile(coveragePath(root, kind), "utf8").catch(() => null);
  if (raw === null) return { receipt: "absent" as const, record: null };
  if (!raw) return { receipt: "invalid" as const, record: null };
  try {
    const coverage = JSON.parse(raw) as BrainIndexReplayCoverageRecord;
    if (
      coverage.schema !== BRAIN_INDEX_REPLAY_COVERAGE_SCHEMA
      || coverage.kind !== kind
      || !isRetentionPolicy(coverage.policy)
      || !Number.isInteger(coverage.prunedGenerationCount)
      || coverage.prunedGenerationCount < 0
      || (coverage.prunedThroughGenerationId !== undefined && !isValidGenerationId(coverage.prunedThroughGenerationId))
      || (coverage.prunedThroughCreatedAt !== undefined && !Number.isFinite(Date.parse(coverage.prunedThroughCreatedAt)))
      || !Number.isFinite(Date.parse(coverage.updatedAt))
    ) return { receipt: "invalid" as const, record: null };
    return { receipt: "valid" as const, record: coverage };
  } catch {
    return { receipt: "invalid" as const, record: null };
  }
}

async function pruneGenerations(root: string, kind: BrainIndexGenerationKind, policy: BrainIndexRetentionPolicy) {
  const coverageState = await readCoverageState(root, kind);
  if (coverageState.receipt === "invalid") {
    return { pruned: 0, warning: "Retention paused because replay coverage.json is invalid; restore its last valid copy before pruning more history." };
  }
  const previousCoverage = coverageState.record;
  const rootEntries = await readdir(kindRoot(root, kind), { withFileTypes: true }).catch(() => []);
  const staleTombstones = rootEntries.filter((entry) => entry.isDirectory() && entry.name.startsWith(".prune-") && entry.name.length < 160);
  for (const tombstone of staleTombstones) {
    const encoded = tombstone.name.slice(".prune-".length);
    const separator = encoded.lastIndexOf("-");
    const generationId = separator > 0 ? encoded.slice(0, separator) : "";
    const nonce = separator > 0 ? encoded.slice(separator + 1) : "";
    if (!isValidGenerationId(generationId) || !/^[a-f0-9]{8}$/.test(nonce)) return { pruned: 0, warning: `Retention found an unrecognized tombstone: ${tombstone.name}` };
    const tombstonePath = join(kindRoot(root, kind), tombstone.name);
    if (previousCoverage?.prunedThroughGenerationId && generationId <= previousCoverage.prunedThroughGenerationId) {
      try {
        await rm(tombstonePath, { recursive: true, force: true });
      } catch (error) {
        return { pruned: 0, warning: `Retention could not clean committed tombstone ${generationId}: ${error instanceof Error ? error.message : String(error)}` };
      }
      continue;
    }
    const original = generationRoot(root, kind, generationId);
    const originalExists = await stat(original).then((value) => value.isDirectory()).catch(() => false);
    if (originalExists) return { pruned: 0, warning: `Retention could not recover staged generation ${generationId} because its original path already exists.` };
    try {
      await rename(tombstonePath, original);
    } catch (error) {
      return { pruned: 0, warning: `Retention could not recover staged generation ${generationId}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const generationIds = await generationDirectoryNames(root, kind);
  const missingParents = await missingGenerationParents(root, kind, generationIds);
  if (coverageState.receipt === "absent" && missingParents.length) {
    return { pruned: 0, warning: "Retention paused because replay coverage.json is missing after earlier history was removed; restore its last valid copy before pruning more history." };
  }
  if (
    coverageState.record
    && missingParents.some((generationId) => !coverageState.record?.prunedThroughGenerationId || generationId > coverageState.record.prunedThroughGenerationId)
  ) {
    return { pruned: 0, warning: "Retention paused because a retained generation parent is unexpectedly missing; restore the missing generation before pruning more history." };
  }
  if (generationIds.length <= policy.maxGenerations) return { pruned: 0, warning: undefined };
  const context: VerificationContext = { memo: new Map() };
  const desiredStart = generationIds.length - policy.maxGenerations;
  let keepFrom = -1;
  for (let index = desiredStart; index < generationIds.length; index += 1) {
    const generation = await readVerifiedGeneration(root, kind, generationIds[index], undefined, context);
    if (generation && isManifestCheckpoint(generation.manifest)) {
      keepFrom = index;
      break;
    }
  }
  if (keepFrom <= 0) {
    return { pruned: 0, warning: `Retention could not find a verified checkpoint after generation ${generationIds[desiredStart]}.` };
  }
  const candidates = generationIds.slice(0, keepFrom);
  const lastCandidate = candidates.at(-1)!;
  const lastParsed = await parseManifest(root, kind, lastCandidate);
  const staged: Array<{ generationId: string; original: string; tombstone: string }> = [];
  try {
    for (const generationId of candidates) {
      const original = generationRoot(root, kind, generationId);
      const tombstone = join(kindRoot(root, kind), `.prune-${generationId}-${randomUUID().slice(0, 8)}`);
      await rename(original, tombstone);
      staged.push({ generationId, original, tombstone });
    }
  } catch (error) {
    for (const item of [...staged].reverse()) await rename(item.tombstone, item.original).catch(() => undefined);
    return { pruned: 0, warning: `Retention staging failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const coverage: BrainIndexReplayCoverageRecord = {
    schema: BRAIN_INDEX_REPLAY_COVERAGE_SCHEMA,
    kind,
    policy,
    prunedGenerationCount: (previousCoverage?.prunedGenerationCount ?? 0) + candidates.length,
    prunedThroughGenerationId: lastCandidate,
    prunedThroughCreatedAt: lastParsed?.manifest.createdAt,
    updatedAt: new Date().toISOString(),
  };
  try {
    await writeAtomic(coveragePath(root, kind), `${JSON.stringify(coverage, null, 2)}\n`);
  } catch (error) {
    for (const item of [...staged].reverse()) await rename(item.tombstone, item.original).catch(() => undefined);
    return { pruned: 0, warning: `Retention coverage commit failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  let cleanupWarning: string | undefined;
  for (const item of staged) {
    try {
      await rm(item.tombstone, { recursive: true, force: true });
    } catch (error) {
      cleanupWarning = `Retention committed, but tombstone cleanup is pending: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }
  }
  return { pruned: candidates.length, warning: cleanupWarning };
}

export async function publishBrainIndexGeneration(input: {
  root: string;
  kind: BrainIndexGenerationKind;
  artifacts: PublishArtifact[];
  sources?: BrainIndexSourceReceipt[];
  metadata?: Record<string, unknown>;
  retentionPolicy?: BrainIndexRetentionPolicy;
}) {
  const root = resolve(input.root);
  await access(root, constants.R_OK | constants.W_OK);
  if (!input.artifacts.length) throw new Error("A brain index generation requires at least one artifact.");
  const artifactNames = new Set<string>();
  for (const artifact of input.artifacts) {
    if (!ARTIFACT_NAME_PATTERN.test(artifact.name)) throw new Error(`Invalid brain index artifact name: ${artifact.name}`);
    if (artifactNames.has(artifact.name)) throw new Error(`Duplicate brain index artifact name: ${artifact.name}`);
    if (!Number.isFinite(artifact.records) || artifact.records < 0) throw new Error(`Invalid record count for brain index artifact: ${artifact.name}`);
    artifactNames.add(artifact.name);
  }
  const sourcePaths = new Set<string>();
  for (const source of input.sources ?? []) {
    if (!isSafeReceiptPath(source.path) || !isSha256(source.sha256)) throw new Error(`Invalid brain index source receipt: ${source.path || "<missing>"}`);
    if (sourcePaths.has(source.path)) throw new Error(`Duplicate brain index source receipt: ${source.path}`);
    sourcePaths.add(source.path);
  }
  const policy = retentionPolicy(input.retentionPolicy, input.kind);
  const parent = await readBrainIndexGeneration({ root, kind: input.kind });
  const parentCreatedAt = parent ? Date.parse(parent.manifest.createdAt) : 0;
  const createdAt = new Date(Math.max(Date.now(), parentCreatedAt + 1)).toISOString();
  const sources = [...(input.sources ?? [])].sort((left, right) => left.path.localeCompare(right.path));
  const contentIdentity = sha256(canonicalJson({
    kind: input.kind,
    sources,
    artifacts: input.artifacts.map((artifact) => ({ name: artifact.name, sha256: sha256(artifact.contents) })),
    metadata: input.metadata,
  })).slice("sha256:".length, "sha256:".length + 12);
  const generationId = `${createdAt.replace(/[^0-9]/g, "").slice(0, 17)}-${contentIdentity}-${randomUUID().slice(0, 8)}`;
  const destination = generationRoot(root, input.kind, generationId);
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  const parentDistance = parent?.manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA
    ? parent.manifest.distanceFromCheckpoint
    : 0;
  const forceCheckpoint = !parent || parentDistance >= policy.checkpointInterval - 1;
  await mkdir(temporary, { recursive: true });

  try {
    const artifactReceipts: BrainIndexArtifactReceipt[] = [];
    for (const artifact of input.artifacts) {
      const stored = storeBrainIndexArtifact({
        name: artifact.name,
        contents: artifact.contents,
        parentContents: parent?.artifacts.get(artifact.name),
        parentGenerationId: parent?.manifest.generationId,
        forceFull: forceCheckpoint,
      });
      await writeFile(join(temporary, stored.file), stored.storage, { mode: 0o600 });
      artifactReceipts.push({
        name: artifact.name,
        file: stored.file,
        sha256: stored.contentSha256,
        bytes: stored.contentBytes,
        records: Math.max(0, Math.trunc(artifact.records)),
        ...stored.storageReceipt,
      });
    }
    const checkpoint = artifactReceipts.every((receipt) => receipt.encoding === "full" || receipt.encoding === "gzip");
    const manifest: BrainIndexGenerationManifestV2 = {
      schema: BRAIN_INDEX_GENERATION_SCHEMA,
      kind: input.kind,
      generationId,
      createdAt,
      parentGenerationId: parent?.manifest.generationId,
      checkpoint,
      distanceFromCheckpoint: checkpoint ? 0 : parentDistance + 1,
      retentionPolicy: policy,
      sourceCount: sources.length,
      sourceSetHash: sha256(canonicalJson(sources)),
      sources,
      artifacts: artifactReceipts,
      metadata: input.metadata,
    };
    const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(temporary, "manifest.json"), manifestRaw, { encoding: "utf8", mode: 0o600 });
    await mkdir(dirname(destination), { recursive: true });
    await rename(temporary, destination);

    // Legacy paths remain complete current compatibility mirrors. The pointer
    // is committed last so generation readers cannot observe half publication.
    for (const artifact of input.artifacts) {
      if (artifact.legacyPath) await writeAtomic(join(root, artifact.legacyPath), artifact.contents);
    }
    const pointer: BrainIndexPointer = {
      schema: BRAIN_INDEX_POINTER_SCHEMA,
      kind: input.kind,
      generationId,
      previousGenerationId: parent?.manifest.generationId,
      manifestSha256: sha256(manifestRaw),
      updatedAt: createdAt,
    };
    await writeAtomic(pointerPath(root, input.kind), `${JSON.stringify(pointer, null, 2)}\n`);
    const retention = await pruneGenerations(root, input.kind, policy).catch((error) => ({
      pruned: 0,
      warning: `Generation committed, but retention failed: ${error instanceof Error ? error.message : String(error)}`,
    }));
    return {
      generationId,
      manifest,
      pointerPath: relative(root, pointerPath(root, input.kind)).split("\\").join("/"),
      retention,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readBrainIndexGeneration(input: {
  root: string;
  kind: BrainIndexGenerationKind;
  generationId?: string;
}) {
  const root = resolve(input.root);
  if (input.generationId) return readVerifiedGeneration(root, input.kind, input.generationId);
  const current = await readPointer(root, input.kind);
  if (!current) return newestVerifiedGeneration(root, input.kind);
  const context: VerificationContext = { memo: new Map() };
  const verified = await readVerifiedGeneration(root, input.kind, current.pointer.generationId, current.pointer.manifestSha256, context);
  if (verified) return verified;
  const excluded = new Set([current.pointer.generationId]);
  if (current.pointer.previousGenerationId) {
    excluded.add(current.pointer.previousGenerationId);
    const previous = await readVerifiedGeneration(root, input.kind, current.pointer.previousGenerationId, undefined, context);
    if (previous) return previous;
  }
  return newestVerifiedGeneration(root, input.kind, excluded);
}

export async function readBrainIndexArtifact(input: {
  root: string;
  kind: BrainIndexGenerationKind;
  artifact: string;
  generationId?: string;
  legacyPath?: string;
}) {
  const root = resolve(input.root);
  const generation = await readBrainIndexGeneration({ root, kind: input.kind, generationId: input.generationId });
  if (!input.generationId && input.legacyPath && generation) {
    const [legacyStat, pointerStat] = await Promise.all([
      stat(join(root, input.legacyPath)).catch(() => null),
      stat(pointerPath(root, input.kind)).catch(() => null),
    ]);
    // An older process or external tool may still append the compatibility
    // index. Preserve that established path by preferring a newer mirror.
    if (legacyStat?.isFile() && pointerStat?.isFile() && legacyStat.mtimeMs > pointerStat.mtimeMs) {
      return { contents: await readFile(join(root, input.legacyPath), "utf8"), source: "legacy-newer" as const, generation: null };
    }
  }
  const contents = generation?.artifacts.get(input.artifact);
  if (contents !== undefined) return { contents, source: "generation" as const, generation };
  if (!input.legacyPath) return null;
  const legacy = await readFile(join(root, input.legacyPath), "utf8").catch(() => null);
  return legacy === null ? null : { contents: legacy, source: "legacy" as const, generation: null };
}

export async function listBrainIndexGenerations(input: { root: string; kind: BrainIndexGenerationKind }) {
  const root = resolve(input.root);
  const current = await readPointer(root, input.kind);
  const generationIds = await generationDirectoryNames(root, input.kind);
  const context: VerificationContext = { memo: new Map() };
  const generations: Array<{
    generationId: string;
    createdAt: string;
    parentGenerationId?: string;
    current: boolean;
    verified: boolean;
    checkpoint?: boolean;
    distanceFromCheckpoint?: number;
    sourceCount: number;
    artifacts: BrainIndexArtifactReceipt[];
    metadata?: Record<string, unknown>;
  }> = [];
  let newestPolicy: BrainIndexRetentionPolicy | undefined;
  for (const generationId of generationIds) {
    const generation = await readVerifiedGeneration(root, input.kind, generationId, undefined, context);
    if (!generation) {
      generations.push({ generationId, createdAt: "", current: current?.pointer.generationId === generationId, verified: false, sourceCount: 0, artifacts: [] });
      continue;
    }
    if (generation.manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA) newestPolicy = generation.manifest.retentionPolicy;
    generations.push({
      generationId: generation.manifest.generationId,
      createdAt: generation.manifest.createdAt,
      parentGenerationId: generation.manifest.parentGenerationId,
      current: current?.pointer.generationId === generation.manifest.generationId,
      verified: true,
      checkpoint: isManifestCheckpoint(generation.manifest),
      distanceFromCheckpoint: generation.manifest.schema === BRAIN_INDEX_GENERATION_SCHEMA ? generation.manifest.distanceFromCheckpoint : 0,
      sourceCount: generation.manifest.sourceCount,
      artifacts: generation.manifest.artifacts,
      metadata: generation.manifest.metadata,
    });
  }
  generations.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.generationId.localeCompare(left.generationId));
  const coverageState = await readCoverageState(root, input.kind);
  const persistedCoverage = coverageState.record;
  const verified = generations.filter((generation) => generation.verified);
  const chronological = [...verified].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.generationId.localeCompare(right.generationId));
  const earliestCheckpoint = chronological.find((generation) => generation.checkpoint);
  const latest = chronological.at(-1);
  const allMissingParents = await missingGenerationParents(root, input.kind, generationIds);
  const missingHistoryReceipt = coverageState.receipt === "absent" && allMissingParents.length > 0;
  const effectiveCoverageReceipt = missingHistoryReceipt ? "missing" as const : coverageState.receipt;
  const unexpectedMissingParentCount = allMissingParents.filter((generationId) => (
    !persistedCoverage?.prunedThroughGenerationId || generationId > persistedCoverage.prunedThroughGenerationId
  )).length;
  const coverage: BrainIndexReplayCoverage = {
    coverageReceipt: effectiveCoverageReceipt,
    policy: newestPolicy ?? persistedCoverage?.policy ?? BRAIN_INDEX_RETENTION_POLICIES[input.kind],
    retainedGenerationCount: generations.length,
    verifiedGenerationCount: verified.length,
    invalidGenerationCount: generations.length - verified.length,
    checkpointCount: verified.filter((generation) => generation.checkpoint).length,
    unexpectedMissingParentCount,
    earliestRetainedGenerationId: chronological[0]?.generationId,
    earliestRetainedAt: chronological[0]?.createdAt,
    latestRetainedGenerationId: latest?.generationId,
    latestRetainedAt: latest?.createdAt,
    replayCompleteFromGenerationId: earliestCheckpoint?.generationId,
    replayCompleteFrom: earliestCheckpoint?.createdAt,
    prunedGenerationCount: persistedCoverage?.prunedGenerationCount ?? 0,
    prunedGenerationCountKnown: effectiveCoverageReceipt !== "invalid" && effectiveCoverageReceipt !== "missing",
    prunedThroughGenerationId: persistedCoverage?.prunedThroughGenerationId,
    prunedThrough: persistedCoverage?.prunedThroughCreatedAt,
    completeHistory: effectiveCoverageReceipt !== "invalid"
      && effectiveCoverageReceipt !== "missing"
      && !persistedCoverage?.prunedGenerationCount
      && unexpectedMissingParentCount === 0
      && generations.length === verified.length,
  };
  return { kind: input.kind, currentGenerationId: current?.pointer.generationId, coverage, generations };
}
