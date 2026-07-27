import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, truncate, unlink, utimes, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-shared-brain-boundaries-"));
process.env.HOME = join(tmp, "home");
process.env.HIVEMINDOS_MEMORY_PROOFS = "off";
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;

const generations = await import("../src/lib/services/obsidian/brain-index-generations.ts");
const transactions = await import("../src/lib/services/obsidian/agent-memory/write-transactions.ts");
const memory = await import("../src/lib/services/obsidian/agent-memory.ts");
const capsules = await import("../src/lib/services/obsidian/brain-capsules.ts");
const contentAddresses = await import("../src/lib/services/obsidian/content-address.ts");
const { compileKnowledgeToWiki } = await import("../src/lib/services/obsidian/compiled-knowledge.ts");

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`ok ${passed} - ${label}`);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

async function freshVault(name) {
  const vaultPath = join(tmp, name);
  await mkdir(vaultPath, { recursive: true });
  await writeFile(join(vaultPath, "Shared Context.md"), `# ${name}\n`);
  return vaultPath;
}

function brainServices(vaultPath) {
  return join(vaultPath, "Operations", "Brain Services");
}

async function writeCapsuleFixture(sourcePath, name, mutate, options = {}) {
  const parsed = JSON.parse(await readFile(sourcePath, "utf8"));
  mutate(parsed);
  if (options.rehashPayload) parsed.manifest.payloadSha256 = sha256(JSON.stringify(parsed.payload));
  const output = join(dirname(sourcePath), `${name}.hivebrain`);
  await writeFile(output, `${JSON.stringify(parsed)}\n`);
  return output;
}

assert.equal(contentAddresses.normalizeContentAddressText("Café  \r\nline\t\n\n"), "Café\nline");
assert.notEqual(contentAddresses.contentAddressForParts(["ab", "c"]), contentAddresses.contentAddressForParts(["a", "bc"]));
assert.equal(contentAddresses.contentAddressMatches("Cafe\u0301\nline", contentAddresses.contentAddressForText("Café\r\nline")), true);
assert.equal(contentAddresses.contentAddressMatches("different", contentAddresses.contentAddressForText("Café\nline")), false);
ok("content addresses normalize safely without part-boundary collisions");

const generationVault = await freshVault("generation-boundaries");
const validArtifact = { name: "memories", contents: "{\"id\":1}\n", records: 1 };
const validSource = { path: "Memory/fact.md", sha256: sha256("source") };
await assert.rejects(() => generations.publishBrainIndexGeneration({ root: generationVault, kind: "agent-memory", artifacts: [] }), /at least one artifact/i);
await assert.rejects(() => generations.publishBrainIndexGeneration({ root: generationVault, kind: "agent-memory", artifacts: [{ ...validArtifact, name: "../escape" }] }), /invalid.*artifact/i);
await assert.rejects(() => generations.publishBrainIndexGeneration({ root: generationVault, kind: "agent-memory", artifacts: [validArtifact, validArtifact] }), /duplicate.*artifact/i);
await assert.rejects(() => generations.publishBrainIndexGeneration({ root: generationVault, kind: "agent-memory", artifacts: [{ ...validArtifact, records: -1 }] }), /record count/i);
await assert.rejects(() => generations.publishBrainIndexGeneration({ root: generationVault, kind: "agent-memory", artifacts: [validArtifact], sources: [{ ...validSource, path: "../outside.md" }] }), /source receipt/i);
await assert.rejects(() => generations.publishBrainIndexGeneration({ root: generationVault, kind: "agent-memory", artifacts: [validArtifact], sources: [{ ...validSource, sha256: "sha256:nope" }] }), /source receipt/i);
await assert.rejects(() => generations.publishBrainIndexGeneration({ root: generationVault, kind: "agent-memory", artifacts: [validArtifact], sources: [validSource, validSource] }), /duplicate.*source/i);
const generationOne = await generations.publishBrainIndexGeneration({
  root: generationVault,
  kind: "agent-memory",
  artifacts: [{ ...validArtifact, legacyPath: "Operations/Brain Services/Agent Memory Index.jsonl" }],
  sources: [{ path: "Memory/z.md", sha256: sha256("z") }, { path: "Memory/a.md", sha256: sha256("a") }],
});
assert.deepEqual(generationOne.manifest.sources.map((source) => source.path), ["Memory/a.md", "Memory/z.md"]);
ok("generation publication rejects ambiguous artifacts and invalid provenance receipts");

const generationTwo = await generations.publishBrainIndexGeneration({
  root: generationVault,
  kind: "agent-memory",
  artifacts: [{ name: "memories", contents: "{\"id\":2}\n", records: 1, legacyPath: "Operations/Brain Services/Agent Memory Index.jsonl" }],
  sources: [{ path: "Memory/b.md", sha256: sha256("b") }],
});
const generationKindRoot = join(brainServices(generationVault), "Index Generations", "agent-memory");
const pointerFile = join(generationKindRoot, "current.json");
const pointerRaw = await readFile(pointerFile, "utf8");
await mkdir(join(generationKindRoot, "bad!"), { recursive: true });
await writeFile(pointerFile, JSON.stringify({ schema: generations.BRAIN_INDEX_POINTER_SCHEMA, kind: "agent-memory", generationId: "../../escape", manifestSha256: sha256("bad"), updatedAt: new Date().toISOString() }));
assert.equal((await generations.readBrainIndexGeneration({ root: generationVault, kind: "agent-memory" })).manifest.generationId, generationTwo.generationId);
assert.equal((await generations.listBrainIndexGenerations({ root: generationVault, kind: "agent-memory" })).generations.some((item) => item.generationId === "bad!"), false);
await writeFile(pointerFile, pointerRaw);
const generationTwoManifestPath = join(generationKindRoot, generationTwo.generationId, "manifest.json");
const malformedManifest = JSON.parse(await readFile(generationTwoManifestPath, "utf8"));
malformedManifest.artifacts[0].file = "nested/memories.jsonl";
await writeFile(generationTwoManifestPath, JSON.stringify(malformedManifest));
assert.equal(await generations.readBrainIndexGeneration({ root: generationVault, kind: "agent-memory", generationId: generationTwo.generationId }), null);
assert.equal((await generations.readBrainIndexGeneration({ root: generationVault, kind: "agent-memory" })).manifest.generationId, generationOne.generationId);
await assert.rejects(() => generations.readBrainIndexGeneration({ root: generationVault, kind: "agent-memory", generationId: "../bad" }), /invalid.*generation id/i);
assert.equal(await generations.readBrainIndexGeneration({ root: generationVault, kind: "agent-memory", generationId: "missing-generation" }), null);
const nullManifestId = "generation-null-manifest";
await mkdir(join(generationKindRoot, nullManifestId), { recursive: true });
await writeFile(join(generationKindRoot, nullManifestId, "manifest.json"), "null\n");
assert.equal(await generations.readBrainIndexGeneration({ root: generationVault, kind: "agent-memory", generationId: nullManifestId }), null);
ok("malformed pointers, invalid directories, and forged artifact paths fall back safely");

await writeFile(pointerFile, pointerRaw);
const legacyPath = join(brainServices(generationVault), "Agent Memory Index.jsonl");
const future = new Date(Date.now() + 5_000);
await utimes(legacyPath, future, future);
const compatibilityRead = await generations.readBrainIndexArtifact({
  root: generationVault,
  kind: "agent-memory",
  artifact: "memories",
  legacyPath: "Operations/Brain Services/Agent Memory Index.jsonl",
});
assert.equal(compatibilityRead.source, "legacy-newer");
const legacyOnlyVault = await freshVault("legacy-only");
await mkdir(brainServices(legacyOnlyVault), { recursive: true });
await writeFile(join(brainServices(legacyOnlyVault), "Agent Memory Index.jsonl"), "legacy\n");
assert.equal((await generations.readBrainIndexArtifact({ root: legacyOnlyVault, kind: "agent-memory", artifact: "memories", legacyPath: "Operations/Brain Services/Agent Memory Index.jsonl" })).source, "legacy");
ok("legacy-only and newer-legacy compatibility paths remain readable");

const transactionVault = await freshVault("transaction-boundaries");
await assert.rejects(() => transactions.commitAgentMemoryFileTransaction({ root: transactionVault, operation: "", files: [{ path: "Memory/a.md", contents: "a" }] }), /operation name/i);
await assert.rejects(() => transactions.commitAgentMemoryFileTransaction({ root: transactionVault, operation: "empty", files: [] }), /at least one source/i);
await assert.rejects(() => transactions.commitAgentMemoryFileTransaction({ root: transactionVault, operation: "escape", files: [{ path: "../outside.md", contents: "a" }] }), /relative/i);
await assert.rejects(() => transactions.commitAgentMemoryFileTransaction({ root: transactionVault, operation: "duplicate", files: [{ path: "Memory/a.md", contents: "a" }, { path: "Memory/a.md", contents: "b" }] }), /duplicate destination/i);
await assert.rejects(() => transactions.withAgentMemoryWriteLock(transactionVault, async () => { throw new Error("intentional task failure"); }), /intentional task failure/);
let lockReacquired = false;
await transactions.withAgentMemoryWriteLock(transactionVault, async () => { lockReacquired = true; });
assert.equal(lockReacquired, true);
ok("transaction inputs fail early and write locks release after task exceptions");

const lockKey = createHash("sha256").update(resolve(transactionVault)).digest("hex").slice(0, 24);
const staleLock = join(tmpdir(), "hivemindos-agent-memory-locks", `${lockKey}.lock`);
await mkdir(dirname(staleLock), { recursive: true });
await writeFile(staleLock, JSON.stringify({ pid: 999_999_999, host: hostname() }));
const staleTime = new Date(Date.now() - 3 * 60_000);
await utimes(staleLock, staleTime, staleTime);
await transactions.withAgentMemoryWriteLock(transactionVault, async () => undefined);
await assert.rejects(() => stat(staleLock), /ENOENT/);
ok("dead stale locks are reclaimed without waiting for the timeout");

const journal = join(brainServices(transactionVault), "Agent Memory Transactions.jsonl");
await mkdir(dirname(journal), { recursive: true });
const incompleteId = "memtxn-boundary-incomplete";
const firstStagedPath = "Memory/first.md.memtxn-boundary-incomplete.tmp";
await mkdir(join(transactionVault, "Memory"), { recursive: true });
await writeFile(join(transactionVault, firstStagedPath), "first staged");
await writeFile(journal, [
  "{malformed trailing data",
  JSON.stringify({
    schema: "hivemindos.agent-memory-transaction.v1",
    transactionId: incompleteId,
    operation: "boundary-incomplete",
    state: "prepared",
    timestamp: new Date().toISOString(),
    writes: [
      { path: "Memory/first.md", temporaryPath: firstStagedPath, sha256: sha256("first staged"), bytes: 12, mode: 0o600 },
      { path: "Memory/second.md", temporaryPath: "Memory/missing.tmp", sha256: sha256("second staged"), bytes: 13, mode: 0o600 },
    ],
  }),
  "",
].join("\n"));
assert.deepEqual((await transactions.recoverAgentMemoryFileTransactions(transactionVault)).recoveredTransactionIds, []);
await assert.rejects(() => stat(join(transactionVault, "Memory", "first.md")), /ENOENT/);
await assert.rejects(() => stat(join(transactionVault, firstStagedPath)), /ENOENT/);
assert.match(await readFile(journal, "utf8"), /"state":"aborted"/);
ok("recovery preflights the entire source set and does not widen an incomplete transaction");

await writeFile(journal, `{"partial":"${"x".repeat(4 * 1024 * 1024 + 256)}`);
const compactedTransaction = await transactions.commitAgentMemoryFileTransaction({
  root: transactionVault,
  operation: "journal-compaction",
  files: [{ path: "Memory/compacted.md", contents: "compacted journal source" }],
});
await transactions.completeAgentMemoryFileTransaction(transactionVault, compactedTransaction.transactionId, "journal-compaction");
assert.equal((await stat(journal)).size < 1024 * 1024, true);
assert.equal(await readFile(join(transactionVault, "Memory", "compacted.md"), "utf8"), "compacted journal source");
ok("journal compaction preserves a new receipt after a large partial trailing row");

const capsuleVault = await freshVault("capsule-boundaries");
const original = await memory.rememberAgentMemory({
  vaultPath: capsuleVault,
  type: "fact",
  title: "東京 launch plan",
  content: "東京 計画 uses a cobalt rendezvous and a multilingual portable search index.",
  project: "CapsuleLab",
  proof: false,
});
const beforeEvolutionGeneration = original.generation.generationId;
const second = await memory.rememberAgentMemory({
  vaultPath: capsuleVault,
  type: "learning",
  title: "Secondary capsule evidence",
  content: "Secondary capsule evidence uses an amber verification marker.",
  project: "CapsuleLab",
  proof: false,
});
const evolved = await memory.evolveAgentMemory({
  vaultPath: capsuleVault,
  memoryId: original.record.id,
  type: "fact",
  title: "東京 launch plan revised",
  content: "東京 計画 now uses a cobalt rendezvous plus a verified indigo fallback.",
  project: "CapsuleLab",
  proof: false,
});
await assert.rejects(() => capsules.createBrainCapsule({ vaultPath: capsuleVault }), /explicit project or memoryIds/i);
await assert.rejects(() => capsules.createBrainCapsule({ vaultPath: capsuleVault, project: "missing-project" }), /matched no portable/i);
await assert.rejects(() => capsules.createBrainCapsule({ vaultPath: capsuleVault, memoryIds: [original.record.id] }), /matched no portable/i);
await assert.rejects(() => capsules.createBrainCapsule({ vaultPath: capsuleVault, memoryIds: [second.record.id], expiresAt: "2020-01-01T00:00:00.000Z" }), /future timestamp/i);
await assert.rejects(() => capsules.createBrainCapsule({ vaultPath: capsuleVault, memoryIds: [second.record.id], passphrase: "too-short" }), /at least 12 characters/i);
const activeCapsule = await capsules.createBrainCapsule({ vaultPath: capsuleVault, project: "capsulelab" });
const activeOpened = await capsules.openBrainCapsule({ capsulePath: activeCapsule.capsulePath });
assert.equal(activeOpened.capsule.payload.memories.some((item) => item.id === original.record.id), false);
assert.equal(activeOpened.capsule.payload.memories.some((item) => item.id === evolved.record.id), true);
const historyCapsule = await capsules.createBrainCapsule({ vaultPath: capsuleVault, project: "CapsuleLab", includeSuperseded: true });
const historyOpened = await capsules.openBrainCapsule({ capsulePath: historyCapsule.capsulePath });
assert.equal(historyOpened.capsule.payload.memories.some((item) => item.id === original.record.id), true);
ok("capsule scopes reject empty exports and include superseded history only when requested");

await compileKnowledgeToWiki({
  vaultPath: capsuleVault,
  domain: "sensitive-export",
  title: "Sensitive export probe",
  content: `This fixture contains sk-${"A".repeat(24)} and must never leave the vault in a capsule.`,
  entities: [],
  concepts: [],
  collaborationMode: "personal",
});
await assert.rejects(() => capsules.createBrainCapsule({ vaultPath: capsuleVault, memoryIds: [second.record.id], compiledDomains: ["sensitive-export"] }), /export blocked.*API key/i);
ok("capsule export blocks secret-bearing compiled knowledge as well as memories");

const unicodeSearch = await capsules.searchBrainCapsule({ capsulePath: activeCapsule.capsulePath, query: "東京", limit: Number.NaN });
assert.equal(unicodeSearch.hits.some((hit) => hit.title.includes("東京")), true);
assert.equal((await capsules.searchBrainCapsule({ capsulePath: activeCapsule.capsulePath, query: "capsule evidence", limit: 0 })).hits.length, 1);
await assert.rejects(() => capsules.searchBrainCapsule({ capsulePath: activeCapsule.capsulePath, query: "a" }), /query is required/i);
ok("portable search supports non-ASCII terms and clamps invalid limits deterministically");

const invalidExtension = join(tmp, "invalid.txt");
await writeFile(invalidExtension, "{}");
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: invalidExtension }), /must end in/i);
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: join(tmp, "missing.hivebrain") }), /missing or exceeds/i);
const invalidJson = join(tmp, "invalid-json.hivebrain");
await writeFile(invalidJson, "not json");
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: invalidJson }), /not valid JSON/i);
const oversized = join(tmp, "oversized.hivebrain");
await writeFile(oversized, "x");
await truncate(oversized, 64 * 1024 * 1024 + 1);
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: oversized }), /64 MiB/i);
ok("capsule file extension, existence, JSON, and size boundaries fail closed");

const badMemoryHash = await writeCapsuleFixture(activeCapsule.capsulePath, "bad-memory-hash", (fixture) => {
  fixture.payload.memories[0].content += " tampered";
}, { rehashPayload: true });
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: badMemoryHash }), /memory content-address/i);
const badMemoryShape = await writeCapsuleFixture(activeCapsule.capsulePath, "bad-memory-shape", (fixture) => {
  fixture.payload.memories[0].tags = "not-an-array";
}, { rehashPayload: true });
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: badMemoryShape }), /memory content-address/i);
const badSearch = await writeCapsuleFixture(activeCapsule.capsulePath, "bad-search", (fixture) => {
  fixture.payload.searchIndex[0].terms.injected = 99;
}, { rehashPayload: true });
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: badSearch }), /embedded search index/i);
const badCounts = await writeCapsuleFixture(activeCapsule.capsulePath, "bad-counts", (fixture) => {
  fixture.manifest.counts.memories += 1;
});
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: badCounts }), /counts do not match/i);
const badProvenance = await writeCapsuleFixture(activeCapsule.capsulePath, "bad-provenance", (fixture) => {
  fixture.manifest.sourceHashesSha256 = sha256("different provenance");
});
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: badProvenance }), /provenance checksum/i);
const badExpiry = await writeCapsuleFixture(activeCapsule.capsulePath, "bad-expiry", (fixture) => {
  fixture.manifest.expiresAt = "not-a-date";
});
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: badExpiry }), /expiry is malformed/i);
const duplicateMemoryIds = await writeCapsuleFixture(historyCapsule.capsulePath, "duplicate-memory-ids", (fixture) => {
  fixture.payload.memories[1].id = fixture.payload.memories[0].id;
}, { rehashPayload: true });
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: duplicateMemoryIds }), /duplicate memory ids/i);
ok("capsule structure validates content addresses, shapes, search, counts, provenance, expiry, and ids independently");

const expiredCapsule = await writeCapsuleFixture(activeCapsule.capsulePath, "expired-allow-read", (fixture) => {
  fixture.manifest.expiresAt = "2020-01-01T00:00:00.000Z";
});
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: expiredCapsule }), /expired/i);
assert.equal((await capsules.openBrainCapsule({ capsulePath: expiredCapsule, allowExpired: true })).capsule.manifest.expiresAt, "2020-01-01T00:00:00.000Z");
const encryptedCapsule = await capsules.createBrainCapsule({ vaultPath: capsuleVault, memoryIds: [second.record.id], passphrase: "boundary passphrase value" });
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: encryptedCapsule.capsulePath }), /provide its passphrase/i);
const envelopeMismatch = JSON.parse(await readFile(encryptedCapsule.capsulePath, "utf8"));
envelopeMismatch.capsuleId = "capsule-valid-but-not-inner-123456";
const envelopeMismatchPath = join(dirname(encryptedCapsule.capsulePath), "envelope-mismatch.hivebrain.enc");
await writeFile(envelopeMismatchPath, JSON.stringify(envelopeMismatch));
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: envelopeMismatchPath, passphrase: "boundary passphrase value" }), /metadata does not match/i);
const ciphertextTamper = JSON.parse(await readFile(encryptedCapsule.capsulePath, "utf8"));
ciphertextTamper.ciphertext = `${ciphertextTamper.ciphertext.slice(0, -4)}AAAA`;
const ciphertextTamperPath = join(dirname(encryptedCapsule.capsulePath), "ciphertext-tamper.hivebrain.enc");
await writeFile(ciphertextTamperPath, JSON.stringify(ciphertextTamper));
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: ciphertextTamperPath, passphrase: "boundary passphrase value" }), /authentication tag/i);
ok("expiry override is explicit and encrypted envelopes authenticate payload and metadata");

const bulkVault = await freshVault("bulk-capsule");
await mkdir(brainServices(bulkVault), { recursive: true });
const bulkRows = Array.from({ length: 251 }, (_, index) => ({
  timestamp: "2026-07-16T00:00:00.000Z",
  action: "remember",
  id: `mem-bulk-${String(index).padStart(4, "0")}`,
  memoryType: "fact",
  title: `Bulk portable memory ${index}`,
  content: `Unique bulk portable content ${index} with marker bulk-${index}.`,
  contentHash: contentAddresses.contentAddressForText(`Unique bulk portable content ${index} with marker bulk-${index}.`),
  status: "active",
  confidence: 0.8,
  tags: ["bulk"],
  project: "bulk",
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  notePath: `Memory/Distillations/Agent Memory/fact/bulk-${index}.md`,
}));
await writeFile(join(brainServices(bulkVault), "Agent Memory Index.jsonl"), `${bulkRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
const bulkCapsule = await capsules.createBrainCapsule({ vaultPath: bulkVault, project: "bulk" });
const bulkTarget = await freshVault("bulk-target");
const bulkPreview = await capsules.previewBrainCapsuleImport({ vaultPath: bulkTarget, capsulePath: bulkCapsule.capsulePath });
assert.equal(bulkPreview.candidates.length, 250);
assert.equal(bulkPreview.duplicateCount, 0);
assert.equal(bulkPreview.truncatedCount, 1);
ok("the review cap reports overflow separately from true content duplicates");

const latestCapsuleGeneration = (await memory.listAgentMemoryGenerations({ vaultPath: capsuleVault })).currentGenerationId;
const replayOne = await memory.compareAgentMemoryGenerations({
  vaultPath: capsuleVault,
  query: "東京 cobalt rendezvous verified indigo fallback",
  fromGenerationId: beforeEvolutionGeneration,
  toGenerationId: latestCapsuleGeneration,
});
const replayTwo = await memory.compareAgentMemoryGenerations({
  vaultPath: capsuleVault,
  query: "東京 cobalt rendezvous verified indigo fallback",
  fromGenerationId: beforeEvolutionGeneration,
  toGenerationId: latestCapsuleGeneration,
});
assert.deepEqual(replayOne, replayTwo);
assert.equal(replayOne.changes.some((change) => change.id === original.record.id && change.change === "removed"), true);
assert.equal(replayOne.changes.some((change) => change.id === evolved.record.id && change.change === "added"), true);
await assert.rejects(() => memory.compareAgentMemoryGenerations({ vaultPath: capsuleVault, query: "test", fromGenerationId: "" }), /fromGenerationId is required/i);
ok("generation comparison is repeatable and distinguishes evolved removal from addition");

const memoryRoute = await import("../src/app/api/brain/memory/route.ts");
const { NextRequest } = await import("next/server");
async function postMemoryApi(body) {
  const response = await memoryRoute.POST(new NextRequest("http://127.0.0.1/api/brain/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() };
}
const rawPassphraseExport = await postMemoryApi({ action: "export-capsule", vaultPath: capsuleVault, memoryIds: [second.record.id], passphrase: "must be ignored by the route" });
assert.equal(rawPassphraseExport.response.status, 200);
assert.equal(rawPassphraseExport.body.encrypted, false);
process.env.BOUNDARY_CAPSULE_PASSPHRASE = "boundary API passphrase";
const encryptedApiExport = await postMemoryApi({ action: "export-capsule", vaultPath: capsuleVault, memoryIds: [second.record.id], passphraseEnv: "BOUNDARY_CAPSULE_PASSPHRASE" });
assert.equal(encryptedApiExport.body.encrypted, true);
const encryptedApiOpen = await postMemoryApi({ action: "open-capsule", capsulePath: encryptedApiExport.body.capsulePath, passphraseEnv: "BOUNDARY_CAPSULE_PASSPHRASE" });
assert.equal(encryptedApiOpen.body.readOnly, true);
assert.equal("payload" in encryptedApiOpen.body, false);
const apiPreview = await postMemoryApi({ action: "preview-capsule-import", vaultPath: bulkTarget, capsulePath: activeCapsule.capsulePath });
assert.equal(apiPreview.body.reviewRequired, true);
const apiPropose = await postMemoryApi({ action: "propose-capsule-import", vaultPath: bulkTarget, capsulePath: activeCapsule.capsulePath });
assert.equal(Array.isArray(apiPropose.body.proposals), true);
const apiCompare = await postMemoryApi({ action: "compare-generations", vaultPath: capsuleVault, query: "東京 cobalt", fromGenerationId: beforeEvolutionGeneration, toGenerationId: latestCapsuleGeneration });
assert.equal(apiCompare.response.status, 200);
assert.equal(Array.isArray(apiCompare.body.changes), true);
assert.equal((await postMemoryApi({ action: "open-capsule" })).response.status, 400);
assert.equal((await postMemoryApi({ action: "recall", query: "test", passphraseEnv: "lowercase" })).response.status, 400);
delete process.env.MISSING_BOUNDARY_CAPSULE_PASSPHRASE;
assert.equal((await postMemoryApi({ action: "recall", query: "test", passphraseEnv: "MISSING_BOUNDARY_CAPSULE_PASSPHRASE" })).response.status, 400);
delete process.env.BOUNDARY_CAPSULE_PASSPHRASE;
ok("API export, encryption, preview, proposal, comparison, and passphrase boundaries behave as contracted");

function runInvalidCli(args) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ["scripts/hive-brain", ...args], { cwd: process.cwd(), env: { ...process.env, HOME: process.env.HOME } });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveResult({ code, stderr }));
  });
}
const invalidCliCases = await Promise.all([
  runInvalidCli(["capsule-export"]),
  runInvalidCli(["capsule-open"]),
  runInvalidCli(["replay", "query"]),
  runInvalidCli(["compare", "query"]),
]);
assert.equal(invalidCliCases.every((result) => result.code !== 0), true);
assert.match(invalidCliCases[0].stderr, /project or --memory-ids/i);
assert.match(invalidCliCases[1].stderr, /requires --capsule/i);
assert.match(invalidCliCases[2].stderr, /requires --generation/i);
assert.match(invalidCliCases[3].stderr, /requires --from-generation/i);
ok("CLI rejects incomplete capsule and replay commands before any API call");

console.log(`\nShared Brain boundary checks passed (${passed} groups).`);
await unlink(staleLock).catch(() => undefined);
await rm(tmp, { recursive: true, force: true });
