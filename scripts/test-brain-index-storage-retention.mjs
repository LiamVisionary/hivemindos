import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const storage = await import("../src/lib/services/obsidian/brain-index-artifact-storage.ts");
const generations = await import("../src/lib/services/obsidian/brain-index-generations.ts");

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-brain-index-retention-"));
let passed = 0;

function ok(label) {
  passed += 1;
  console.log(`ok ${passed} - ${label}`);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function pseudoRandomText(length, seed = 17) {
  let state = seed >>> 0;
  let output = "";
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    output += alphabet[(state >>> 24) % alphabet.length];
  }
  return output;
}

function restoreStored(stored, input = {}) {
  return storage.restoreBrainIndexArtifact({
    storage: stored.storage,
    encoding: stored.storageReceipt.encoding,
    expectedStorageSha256: stored.storageReceipt.storageSha256,
    expectedStorageBytes: stored.storageReceipt.storageBytes,
    expectedContentSha256: stored.contentSha256,
    expectedContentBytes: stored.contentBytes,
    expectedBaseGenerationId: stored.storageReceipt.baseGenerationId,
    expectedBaseSha256: stored.storageReceipt.baseSha256,
    ...input,
  });
}

const small = storage.storeBrainIndexArtifact({ name: "memories", contents: "tiny\n", forceFull: true });
assert.equal(small.storageReceipt.encoding, "full");
assert.equal(small.file, "memories.jsonl");
assert.equal(restoreStored(small), "tiny\n");
const compressible = "same record and metadata\n".repeat(8_000);
const compressed = storage.storeBrainIndexArtifact({ name: "memories", contents: compressible, forceFull: true });
assert.equal(compressed.storageReceipt.encoding, "gzip");
assert.ok(compressed.storageReceipt.storageBytes < compressed.contentBytes * 0.1);
assert.equal(restoreStored(compressed), compressible);
ok("full artifacts stay plain when small and checkpoints gzip only when materially smaller");

const deltaBase = `${pseudoRandomText(20_000)}\n`;
const deltaResult = `${deltaBase}東京 café 🐝\n`;
const delta = storage.storeBrainIndexArtifact({
  name: "memories",
  contents: deltaResult,
  parentContents: deltaBase,
  parentGenerationId: "generation-base-0001",
});
assert.ok(["text-delta", "gzip-text-delta"].includes(delta.storageReceipt.encoding));
assert.equal(restoreStored(delta, { parentContents: deltaBase, actualBaseGenerationId: "generation-base-0001" }), deltaResult);
assert.equal(delta.storageReceipt.baseSha256, sha256(deltaBase));
assert.equal(delta.contentSha256, sha256(deltaResult));
ok("content-addressed Unicode deltas reconstruct exactly and bind both base and result hashes");

assert.throws(() => restoreStored(delta, {
  parentContents: deltaBase,
  actualBaseGenerationId: "generation-wrong-0002",
}), /delta base verification/i);
assert.throws(() => restoreStored(delta, {
  parentContents: `${deltaBase}changed`,
  actualBaseGenerationId: "generation-base-0001",
}), /delta base verification/i);
const tamperedStorage = Uint8Array.from(delta.storage);
tamperedStorage[Math.floor(tamperedStorage.length / 2)] ^= 1;
assert.throws(() => restoreStored(delta, {
  storage: tamperedStorage,
  parentContents: deltaBase,
  actualBaseGenerationId: "generation-base-0001",
}), /storage checksum/i);
assert.throws(() => restoreStored(delta, {
  parentContents: deltaBase,
  actualBaseGenerationId: "generation-base-0001",
  expectedContentSha256: sha256("forged"),
}), /(malformed|content checksum)/i);
const malformedDelta = Uint8Array.from(Buffer.from('{"schema":"wrong"}', "utf8"));
assert.throws(() => storage.restoreBrainIndexArtifact({
  storage: malformedDelta,
  encoding: "text-delta",
  expectedStorageSha256: sha256(malformedDelta),
  expectedStorageBytes: malformedDelta.byteLength,
  expectedContentSha256: sha256(deltaResult),
  expectedContentBytes: Buffer.byteLength(deltaResult),
  parentContents: deltaBase,
  expectedBaseGenerationId: "generation-base-0001",
  actualBaseGenerationId: "generation-base-0001",
  expectedBaseSha256: sha256(deltaBase),
}), /delta is malformed/i);
ok("storage tampering, wrong bases, and forged reconstructed identities fail closed");

const unrelated = pseudoRandomText(20_000, 999);
const fullInsteadOfDelta = storage.storeBrainIndexArtifact({
  name: "memories",
  contents: unrelated,
  parentContents: deltaBase,
  parentGenerationId: "generation-base-0001",
});
assert.ok(["full", "gzip"].includes(fullInsteadOfDelta.storageReceipt.encoding));
assert.equal(restoreStored(fullInsteadOfDelta), unrelated);
ok("a delta is rejected when it does not beat the best complete representation");

async function freshVault(name) {
  const root = join(tmp, name);
  await mkdir(root, { recursive: true });
  return root;
}

function artifact(contents, name = "memories") {
  return { name, contents, records: contents.split("\n").filter(Boolean).length };
}

const cadenceVault = await freshVault("cadence");
const cadencePolicy = { maxGenerations: 20, checkpointInterval: 3 };
const cadenceIds = [];
for (let index = 1; index <= 7; index += 1) {
  const result = await generations.publishBrainIndexGeneration({
    root: cadenceVault,
    kind: "agent-memory",
    artifacts: [artifact(`${deltaBase}${Array.from({ length: index }, (_, row) => `row-${row}\n`).join("")}`)],
    retentionPolicy: cadencePolicy,
  });
  cadenceIds.push(result.generationId);
  assert.equal(result.manifest.checkpoint, [1, 4, 7].includes(index));
  assert.equal(result.manifest.distanceFromCheckpoint, (index - 1) % 3);
}
const cadenceList = await generations.listBrainIndexGenerations({ root: cadenceVault, kind: "agent-memory" });
assert.equal(cadenceList.coverage.completeHistory, true);
assert.deepEqual(cadenceList.coverage.policy, cadencePolicy);
assert.equal(cadenceList.coverage.checkpointCount, 3);
for (let index = 0; index < cadenceIds.length; index += 1) {
  const replay = await generations.readBrainIndexGeneration({ root: cadenceVault, kind: "agent-memory", generationId: cadenceIds[index] });
  assert.ok(replay);
  assert.match(replay.artifacts.get("memories"), new RegExp(`row-${index}\\n$`));
}
ok("checkpoint cadence is deterministic and every unpruned generation replays exactly");

const mixed = await generations.publishBrainIndexGeneration({
  root: cadenceVault,
  kind: "agent-memory",
  artifacts: [
    artifact(`${deltaBase}row-a\n`, "memories"),
    artifact(`${pseudoRandomText(12_000, 1)}\n`, "entities"),
  ],
  retentionPolicy: cadencePolicy,
});
const mixedNext = await generations.publishBrainIndexGeneration({
  root: cadenceVault,
  kind: "agent-memory",
  artifacts: [
    artifact(`${deltaBase}row-a\nrow-b\n`, "memories"),
    artifact(`${pseudoRandomText(12_000, 700)}\n`, "entities"),
  ],
  retentionPolicy: cadencePolicy,
});
assert.equal(mixed.manifest.checkpoint, false);
assert.equal(mixedNext.manifest.checkpoint, false);
assert.ok(mixedNext.manifest.artifacts.some((receipt) => receipt.encoding?.includes("delta")));
assert.ok(mixedNext.manifest.artifacts.some((receipt) => !receipt.encoding?.includes("delta")));
const mixedReplay = await generations.readBrainIndexGeneration({ root: cadenceVault, kind: "agent-memory", generationId: mixedNext.generationId });
assert.equal(mixedReplay.artifacts.get("memories"), `${deltaBase}row-a\nrow-b\n`);
assert.equal(mixedReplay.artifacts.get("entities"), `${pseudoRandomText(12_000, 700)}\n`);
ok("mixed generations can delta one artifact and store another in full without losing replay fidelity");

const corruptVault = await freshVault("corrupt-delta");
const corruptOne = await generations.publishBrainIndexGeneration({
  root: corruptVault,
  kind: "agent-memory",
  artifacts: [artifact(deltaBase)],
  retentionPolicy: cadencePolicy,
});
const corruptTwo = await generations.publishBrainIndexGeneration({
  root: corruptVault,
  kind: "agent-memory",
  artifacts: [artifact(deltaResult)],
  retentionPolicy: cadencePolicy,
});
const corruptReceipt = corruptTwo.manifest.artifacts[0];
assert.ok(corruptReceipt.encoding.includes("delta"));
await writeFile(join(corruptVault, "Operations", "Brain Services", "Index Generations", "agent-memory", corruptTwo.generationId, corruptReceipt.file), "tampered");
assert.equal(await generations.readBrainIndexGeneration({ root: corruptVault, kind: "agent-memory", generationId: corruptTwo.generationId }), null);
assert.equal((await generations.readBrainIndexGeneration({ root: corruptVault, kind: "agent-memory" })).manifest.generationId, corruptOne.generationId);
ok("a corrupt current delta is rejected and current reads recover to the verified checkpoint");

const legacyVault = await freshVault("legacy-upgrade");
const legacyKindRoot = join(legacyVault, "Operations", "Brain Services", "Index Generations", "agent-memory");
const legacyId = "legacy-generation-0001";
const legacyFolder = join(legacyKindRoot, legacyId);
await mkdir(legacyFolder, { recursive: true });
const legacyContents = `${deltaBase}legacy\n`;
const legacyManifest = {
  schema: generations.LEGACY_BRAIN_INDEX_GENERATION_SCHEMA,
  kind: "agent-memory",
  generationId: legacyId,
  createdAt: "2026-07-16T12:00:00.000Z",
  sourceCount: 0,
  sourceSetHash: sha256("[]"),
  sources: [],
  artifacts: [{ name: "memories", file: "memories.jsonl", sha256: sha256(legacyContents), bytes: Buffer.byteLength(legacyContents), records: 1 }],
};
const legacyManifestRaw = `${JSON.stringify(legacyManifest, null, 2)}\n`;
await writeFile(join(legacyFolder, "memories.jsonl"), legacyContents);
await writeFile(join(legacyFolder, "manifest.json"), legacyManifestRaw);
await writeFile(join(legacyKindRoot, "current.json"), `${JSON.stringify({
  schema: generations.BRAIN_INDEX_POINTER_SCHEMA,
  kind: "agent-memory",
  generationId: legacyId,
  manifestSha256: sha256(legacyManifestRaw),
  updatedAt: "2026-07-16T12:00:00.000Z",
}, null, 2)}\n`);
assert.equal((await generations.readBrainIndexGeneration({ root: legacyVault, kind: "agent-memory" })).artifacts.get("memories"), legacyContents);
const upgraded = await generations.publishBrainIndexGeneration({
  root: legacyVault,
  kind: "agent-memory",
  artifacts: [artifact(`${legacyContents}v2\n`)],
  retentionPolicy: cadencePolicy,
});
assert.equal(upgraded.manifest.schema, generations.BRAIN_INDEX_GENERATION_SCHEMA);
assert.equal(upgraded.manifest.parentGenerationId, legacyId);
assert.equal((await generations.readBrainIndexGeneration({ root: legacyVault, kind: "agent-memory", generationId: upgraded.generationId })).artifacts.get("memories"), `${legacyContents}v2\n`);
ok("legacy v1 full snapshots remain readable and can become a verified v2 delta base");

const retainedVault = await freshVault("retained");
const retainedPolicy = { maxGenerations: 5, checkpointInterval: 3 };
const retainedIds = [];
for (let index = 1; index <= 9; index += 1) {
  const result = await generations.publishBrainIndexGeneration({
    root: retainedVault,
    kind: "agent-memory",
    artifacts: [artifact(`${deltaBase}${Array.from({ length: index }, (_, row) => `retained-${row}\n`).join("")}`)],
    retentionPolicy: retainedPolicy,
  });
  retainedIds.push(result.generationId);
}
const retainedList = await generations.listBrainIndexGenerations({ root: retainedVault, kind: "agent-memory" });
assert.ok(retainedList.generations.length <= retainedPolicy.maxGenerations);
assert.equal(retainedList.coverage.completeHistory, false);
assert.equal(retainedList.coverage.prunedGenerationCount, 6);
assert.equal(retainedList.coverage.invalidGenerationCount, 0);
assert.equal(retainedList.coverage.replayCompleteFromGenerationId, retainedIds[6]);
assert.equal(await generations.readBrainIndexGeneration({ root: retainedVault, kind: "agent-memory", generationId: retainedIds[0] }), null);
for (const generation of retainedList.generations) {
  assert.ok(await generations.readBrainIndexGeneration({ root: retainedVault, kind: "agent-memory", generationId: generation.generationId }));
}
const retainedDirectories = (await readdir(join(retainedVault, "Operations", "Brain Services", "Index Generations", "agent-memory"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory());
assert.equal(retainedDirectories.some((entry) => entry.name.startsWith(".prune-")), false);
const coverageMode = (await stat(join(retainedVault, "Operations", "Brain Services", "Index Generations", "agent-memory", "coverage.json"))).mode & 0o777;
assert.equal(coverageMode, 0o600);
ok("retention prunes only through checkpoint boundaries and exposes the exact replay horizon");

const tombstoneVault = await freshVault("tombstone-recovery");
const tombstonePolicy = { maxGenerations: 20, checkpointInterval: 3 };
const tombstoneIds = [];
for (let index = 1; index <= 4; index += 1) {
  const result = await generations.publishBrainIndexGeneration({
    root: tombstoneVault,
    kind: "agent-memory",
    artifacts: [artifact(`${deltaBase}tombstone-${index}\n`)],
    retentionPolicy: tombstonePolicy,
  });
  tombstoneIds.push(result.generationId);
}
const tombstoneKindRoot = join(tombstoneVault, "Operations", "Brain Services", "Index Generations", "agent-memory");
const uncommittedTombstone = join(tombstoneKindRoot, `.prune-${tombstoneIds[0]}-deadbeef`);
await rename(join(tombstoneKindRoot, tombstoneIds[0]), uncommittedTombstone);
await generations.publishBrainIndexGeneration({
  root: tombstoneVault,
  kind: "agent-memory",
  artifacts: [artifact(`${deltaBase}tombstone-5\n`)],
  retentionPolicy: tombstonePolicy,
});
assert.ok(await generations.readBrainIndexGeneration({ root: tombstoneVault, kind: "agent-memory", generationId: tombstoneIds[0] }));
await assert.rejects(() => stat(uncommittedTombstone), /ENOENT/);
const committedTombstone = join(retainedVault, "Operations", "Brain Services", "Index Generations", "agent-memory", `.prune-${retainedIds[0]}-deadbeef`);
await mkdir(committedTombstone);
await generations.publishBrainIndexGeneration({
  root: retainedVault,
  kind: "agent-memory",
  artifacts: [artifact(`${deltaBase}${Array.from({ length: 10 }, (_, row) => `retained-${row}\n`).join("")}`)],
  retentionPolicy: retainedPolicy,
});
await assert.rejects(() => stat(committedTombstone), /ENOENT/);
ok("interrupted retention restores uncommitted tombstones and cleans committed tombstones on the next write");

const retainedCoveragePath = join(retainedVault, "Operations", "Brain Services", "Index Generations", "agent-memory", "coverage.json");
const validCoverageRaw = await readFile(retainedCoveragePath, "utf8");
await writeFile(retainedCoveragePath, "{broken coverage");
const invalidCoverageList = await generations.listBrainIndexGenerations({ root: retainedVault, kind: "agent-memory" });
assert.equal(invalidCoverageList.coverage.coverageReceipt, "invalid");
assert.equal(invalidCoverageList.coverage.prunedGenerationCountKnown, false);
assert.equal(invalidCoverageList.coverage.completeHistory, false);
const pausedRetention = await generations.publishBrainIndexGeneration({
  root: retainedVault,
  kind: "agent-memory",
  artifacts: [artifact(`${deltaBase}${Array.from({ length: 11 }, (_, row) => `retained-${row}\n`).join("")}`)],
  retentionPolicy: retainedPolicy,
});
assert.match(pausedRetention.retention.warning, /coverage\.json is invalid/i);
assert.equal(await readFile(retainedCoveragePath, "utf8"), "{broken coverage");
await writeFile(retainedCoveragePath, validCoverageRaw);
ok("invalid coverage receipts are visible and pause further destructive retention");

await rm(retainedCoveragePath);
const missingCoverageList = await generations.listBrainIndexGenerations({ root: retainedVault, kind: "agent-memory" });
assert.equal(missingCoverageList.coverage.coverageReceipt, "missing");
assert.equal(missingCoverageList.coverage.prunedGenerationCountKnown, false);
assert.equal(missingCoverageList.coverage.completeHistory, false);
const missingCoveragePublish = await generations.publishBrainIndexGeneration({
  root: retainedVault,
  kind: "agent-memory",
  artifacts: [artifact(`${deltaBase}${Array.from({ length: 12 }, (_, row) => `retained-${row}\n`).join("")}`)],
  retentionPolicy: retainedPolicy,
});
assert.match(missingCoveragePublish.retention.warning, /coverage\.json is missing/i);
await assert.rejects(() => stat(retainedCoveragePath), /ENOENT/);
await writeFile(retainedCoveragePath, validCoverageRaw);
ok("a deleted coverage receipt cannot silently reset prior replay loss or resume pruning");

await rm(join(retainedVault, "Operations", "Brain Services", "Index Generations", "agent-memory", retainedIds[7]), { recursive: true });
const missingParentList = await generations.listBrainIndexGenerations({ root: retainedVault, kind: "agent-memory" });
assert.equal(missingParentList.coverage.coverageReceipt, "valid");
assert.equal(missingParentList.coverage.unexpectedMissingParentCount, 1);
const missingParentPublish = await generations.publishBrainIndexGeneration({
  root: retainedVault,
  kind: "agent-memory",
  artifacts: [artifact(`${deltaBase}${Array.from({ length: 13 }, (_, row) => `retained-${row}\n`).join("")}`)],
  retentionPolicy: retainedPolicy,
});
assert.match(missingParentPublish.retention.warning, /parent is unexpectedly missing/i);
ok("unexpected gaps inside retained lineage are visible and pause retention even with a valid coverage receipt");

assert.deepEqual(generations.BRAIN_INDEX_RETENTION_POLICIES["agent-memory"], { maxGenerations: 256, checkpointInterval: 32 });
assert.deepEqual(generations.BRAIN_INDEX_RETENTION_POLICIES["full-vault"], { maxGenerations: 32, checkpointInterval: 4 });
const fullVault = await freshVault("full-vault-default-policy");
for (let index = 1; index <= 33; index += 1) {
  await generations.publishBrainIndexGeneration({
    root: fullVault,
    kind: "full-vault",
    artifacts: [artifact(`${deltaBase}${Array.from({ length: index }, (_, row) => `note-${row}\n`).join("")}`, "search")],
  });
}
const fullVaultList = await generations.listBrainIndexGenerations({ root: fullVault, kind: "full-vault" });
assert.equal(fullVaultList.generations.length, 29);
assert.equal(fullVaultList.coverage.prunedGenerationCount, 4);
assert.equal(fullVaultList.coverage.replayCompleteFromGenerationId, fullVaultList.generations.at(-1).generationId);
assert.equal(fullVaultList.generations.at(-1).checkpoint, true);
ok("the shipped Agent Memory and full-vault policies are explicit and the full-vault default prunes at a safe checkpoint");

async function directoryBytes(path) {
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? await directoryBytes(child) : (await stat(child)).size;
  }
  return total;
}

const amplificationVault = await freshVault("amplification");
let logicalFullSnapshotBytes = 0;
for (let index = 1; index <= 40; index += 1) {
  const contents = `${pseudoRandomText(32_000, 42)}${pseudoRandomText(index * 800, 100 + index)}\n`;
  logicalFullSnapshotBytes += Buffer.byteLength(contents);
  await generations.publishBrainIndexGeneration({
    root: amplificationVault,
    kind: "agent-memory",
    artifacts: [artifact(contents)],
  });
}
const generationStorageBytes = await directoryBytes(join(amplificationVault, "Operations", "Brain Services", "Index Generations", "agent-memory"));
assert.ok(generationStorageBytes < logicalFullSnapshotBytes * 0.35, `${generationStorageBytes} should be materially below ${logicalFullSnapshotBytes}`);
assert.equal((await generations.listBrainIndexGenerations({ root: amplificationVault, kind: "agent-memory" })).generations.length, 40);
ok(`forty growing writes use ${generationStorageBytes} bytes versus ${logicalFullSnapshotBytes} bytes of complete snapshots (${((generationStorageBytes / logicalFullSnapshotBytes) * 100).toFixed(1)}%)`);

const badPolicyVault = await freshVault("bad-policy");
await assert.rejects(() => generations.publishBrainIndexGeneration({
  root: badPolicyVault,
  kind: "agent-memory",
  artifacts: [artifact("x\n")],
  retentionPolicy: { maxGenerations: 1, checkpointInterval: 2 },
}), /retention policy/i);
ok("invalid retention policies fail before publication");

console.log(`\nBrain index storage and retention checks passed (${passed} groups).`);
