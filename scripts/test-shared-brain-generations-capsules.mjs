import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-generations-capsules-"));
process.env.HOME = join(tmp, "home");
process.env.HIVEMINDOS_MEMORY_PROOFS = "off";
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;

const memory = await import("../src/lib/services/obsidian/agent-memory.ts");
const embeddings = await import("../src/lib/services/obsidian/agent-memory/embeddings.ts");
const capsules = await import("../src/lib/services/obsidian/brain-capsules.ts");
const { compileKnowledgeToWiki } = await import("../src/lib/services/obsidian/compiled-knowledge.ts");
const { contentAddressForText } = await import("../src/lib/services/obsidian/content-address.ts");
const transactions = await import("../src/lib/services/obsidian/agent-memory/write-transactions.ts");
const { readBrainReviewQueue } = await import("../src/lib/services/brain-review-queue.ts");

const vaultPath = join(tmp, "vault");
await mkdir(vaultPath, { recursive: true });
await writeFile(join(vaultPath, "Shared Context.md"), "# Shared Context\n\nTemporary test vault.\n");

let passed = 0;
function ok(label) {
  passed += 1;
  console.log("ok " + passed + " - " + label);
}

const seed = await memory.rememberAgentMemory({
  vaultPath,
  type: "preference",
  title: "Atlas fruit preference",
  content: "The Atlas project prefers pineapple in its launch-day snack order.",
  project: "atlas",
});
assert.ok(seed.record.contentHash.startsWith("sha256:"));
assert.ok(seed.transactionId);
const firstGenerationId = seed.generation.generationId;
const firstManifestPath = join(vaultPath, "Operations", "Brain Services", "Index Generations", "agent-memory", firstGenerationId, "manifest.json");
const firstManifest = JSON.parse(await readFile(firstManifestPath, "utf8"));
assert.equal(firstManifest.sourceCount, 1);
assert.equal(firstManifest.schema, "hivemindos.brain-index-generation.v2");
assert.equal(firstManifest.checkpoint, true);
assert.match(firstManifest.sourceSetHash, /^sha256:[a-f0-9]{64}$/);
assert.equal(firstManifest.artifacts.every((artifact) => /^sha256:[a-f0-9]{64}$/.test(artifact.sha256)), true);
assert.equal(firstManifest.artifacts.every((artifact) => /^sha256:[a-f0-9]{64}$/.test(artifact.storageSha256)), true);
ok("writes commit a checksummed checkpoint generation with source and storage receipts");

const exactDuplicate = await memory.rememberAgentMemory({
  vaultPath,
  type: "fact",
  title: "Same body under a different key",
  content: seed.record.content,
  project: "atlas",
});
assert.equal(exactDuplicate.blocked, true);
assert.equal(exactDuplicate.exactContentDuplicate.id, seed.record.id);
assert.match(exactDuplicate.blockReason, /content hash/);
assert.equal(contentAddressForText("Caf\u00e9  \r\nlaunch\t"), contentAddressForText("Cafe\u0301\nlaunch"));
ok("content-addressed dedupe blocks exact bodies across different titles and keys");

function runConcurrentWriter(index) {
  return new Promise((resolveWriter, rejectWriter) => {
    const child = spawn(process.execPath, ["scripts/fixtures/agent-memory-concurrent-writer.mjs", vaultPath, String(index)], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: process.env.HOME },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => code === 0 ? resolveWriter(JSON.parse(stdout)) : rejectWriter(new Error(stderr || "writer exited " + code)));
  });
}
const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => runConcurrentWriter(index)));
assert.equal(concurrent.length, 8);
const afterConcurrent = await memory.listAgentMemoryRecords({ vaultPath });
assert.equal(afterConcurrent.records.length, 9);
assert.equal(new Set(afterConcurrent.records.map((record) => record.id)).size, 9);
const compatibilityLines = readFileSync(join(vaultPath, "Operations", "Brain Services", "Agent Memory Index.jsonl"), "utf8").trim().split("\n");
assert.equal(compatibilityLines.length, 9);
const generationStateAfterConcurrent = await memory.listAgentMemoryGenerations({ vaultPath });
assert.equal(generationStateAfterConcurrent.generations.some((generation) => generation.artifacts.some((artifact) => artifact.encoding?.includes("delta"))), true);
assert.equal(JSON.parse(compatibilityLines[0]).timestamp, seed.record.updatedAt, "existing index rows must not churn their timestamp on later writes");
ok("cross-process lock serialization preserves every write while stable rows enable incremental generations");

const latestBeforeReplay = generationStateAfterConcurrent.currentGenerationId;
const replay = await memory.recallAgentMemory({
  vaultPath,
  query: "quartz 7 nebula",
  generationId: firstGenerationId,
  scope: "full-vault",
});
assert.equal(replay.recallScope, "agent-memory");
assert.equal(replay.hits.some((hit) => hit.title === "Concurrent Atlas fact 7"), false);
await memory.recordAgentMemoryUsage({ vaultPath, memoryIds: [seed.record.id], usageType: "final-answer", query: "atlas fruit" });
const currentSeedRecall = await memory.recallAgentMemory({ vaultPath, query: "atlas pineapple preference", scope: "agent-memory" });
assert.ok(currentSeedRecall.hits.find((hit) => hit.id === seed.record.id).scoreDetails.usage > 0);
const replaySeedRecall = await memory.recallAgentMemory({ vaultPath, query: "atlas pineapple preference", generationId: firstGenerationId });
const replaySeedHit = replaySeedRecall.hits.find((hit) => hit.id === seed.record.id);
assert.equal(replaySeedHit.scoreDetails.usage, 0, "current usage telemetry must not change historical replay");
assert.equal(replaySeedHit.scoreDetails.semantic, undefined, "current embeddings must not change historical replay");
assert.equal(replaySeedHit.scoreDetails.recency, 10, "historical recency must use the generation timestamp");
const comparison = await memory.compareAgentMemoryGenerations({
  vaultPath,
  query: "quartz 7 nebula",
  fromGenerationId: firstGenerationId,
  toGenerationId: latestBeforeReplay,
});
assert.equal(comparison.changes.some((change) => change.title === "Concurrent Atlas fact 7" && change.change === "added"), true);
ok("historical replay isolates prior knowledge and comparison explains added evidence");

const beforeCorruption = await memory.listAgentMemoryGenerations({ vaultPath });
assert.equal(beforeCorruption.generations.every((generation) => generation.verified), true);
const corruptId = beforeCorruption.currentGenerationId;
const corruptGeneration = beforeCorruption.generations.find((generation) => generation.generationId === corruptId);
const corruptArtifact = corruptGeneration.artifacts.find((artifact) => artifact.name === "memories");
await writeFile(join(vaultPath, "Operations", "Brain Services", "Index Generations", "agent-memory", corruptId, corruptArtifact.file), "tampered\n");
const fallbackRecall = await memory.recallAgentMemory({ vaultPath, query: "quartz 7 nebula", scope: "agent-memory" });
assert.ok(Array.isArray(fallbackRecall.hits));
const fallbackRecords = await memory.listAgentMemoryRecords({ vaultPath });
assert.equal(fallbackRecords.records.length, 8, "verified parent should contain the snapshot before the ninth write");
const previousId = beforeCorruption.generations.find((generation) => generation.generationId === corruptId).parentGenerationId;
const previousGeneration = beforeCorruption.generations.find((generation) => generation.generationId === previousId);
const previousArtifact = previousGeneration.artifacts.find((artifact) => artifact.name === "memories");
await writeFile(join(vaultPath, "Operations", "Brain Services", "Index Generations", "agent-memory", previousId, previousArtifact.file), "also tampered\n");
const deeperFallbackRecords = await memory.listAgentMemoryRecords({ vaultPath });
assert.equal(deeperFallbackRecords.records.length, 7, "reader should scan back to the newest remaining verified generation");
const afterCorruption = await memory.listAgentMemoryGenerations({ vaultPath });
assert.equal(afterCorruption.generations.find((generation) => generation.generationId === corruptId).verified, false);
assert.equal(afterCorruption.generations.find((generation) => generation.generationId === previousId).verified, false);
await memory.rebuildAgentMemoryIndex({ vaultPath, includeFullVault: false });
ok("artifact tampering fails verification and readers recover past multiple damaged generations");

const recoveredId = "mem-20260716150000-recovery";
const recoveredContent = "Recovered transaction content proves staged source completion before index repair.";
const recoveredPath = "Memory/Distillations/Agent Memory/fact/2026-07-16-recovered-transaction.md";
const recoveredMarkdown = [
  "---",
  'type: "agent-memory"',
  'id: "' + recoveredId + '"',
  'memoryType: "fact"',
  'title: "Recovered staged transaction"',
  'contentHash: "' + contentAddressForText(recoveredContent) + '"',
  'status: "active"',
  "confidence: 0.9",
  'tags: ["recovery"]',
  'project: "atlas"',
  'createdAt: "2026-07-16T15:00:00.000Z"',
  'updatedAt: "2026-07-16T15:00:00.000Z"',
  "---",
  "",
  "# Recovered staged transaction",
  "",
  recoveredContent,
  "",
  "## Metadata",
  "",
  "- Type: fact",
  "",
].join("\n");
await transactions.withAgentMemoryWriteLock(vaultPath, () => transactions.commitAgentMemoryFileTransaction({
  root: vaultPath,
  operation: "test-interruption",
  files: [{ path: recoveredPath, contents: recoveredMarkdown }],
}));
const partialTransactionId = "memtxn-test-partial-rename";
const partialSources = [
  {
    id: "mem-20260716150100-partial-a",
    path: "Memory/Distillations/Agent Memory/fact/2026-07-16-partial-a.md",
    temporaryPath: "Memory/Distillations/Agent Memory/fact/2026-07-16-partial-a.md.memtxn-test-partial-rename.tmp",
    contents: recoveredMarkdown.replaceAll(recoveredId, "mem-20260716150100-partial-a").replaceAll("Recovered staged transaction", "Partially promoted source A"),
  },
  {
    id: "mem-20260716150200-partial-b",
    path: "Memory/Distillations/Agent Memory/fact/2026-07-16-partial-b.md",
    temporaryPath: "Memory/Distillations/Agent Memory/fact/2026-07-16-partial-b.md.memtxn-test-partial-rename.tmp",
    contents: recoveredMarkdown.replaceAll(recoveredId, "mem-20260716150200-partial-b").replaceAll("Recovered staged transaction", "Staged source B"),
  },
];
await writeFile(join(vaultPath, partialSources[0].path), partialSources[0].contents);
await writeFile(join(vaultPath, partialSources[1].temporaryPath), partialSources[1].contents);
await appendFile(join(vaultPath, "Operations", "Brain Services", "Agent Memory Transactions.jsonl"), JSON.stringify({
  schema: "hivemindos.agent-memory-transaction.v1",
  transactionId: partialTransactionId,
  operation: "test-partial-rename",
  state: "prepared",
  timestamp: new Date().toISOString(),
  writes: partialSources.map((source) => ({
    path: source.path,
    temporaryPath: source.temporaryPath,
    sha256: "sha256:" + createHash("sha256").update(source.contents, "utf8").digest("hex"),
    bytes: Buffer.byteLength(source.contents, "utf8"),
    mode: 0o600,
  })),
}) + "\n");
await memory.rememberAgentMemory({
  vaultPath,
  type: "fact",
  title: "Write after interrupted transaction",
  content: "The next normal writer repairs any source-committed transaction before advancing the generation.",
  project: "atlas",
});
const recoveredRecords = await memory.listAgentMemoryRecords({ vaultPath });
assert.ok(recoveredRecords.records.some((record) => record.id === recoveredId));
assert.equal(partialSources.every((source) => recoveredRecords.records.some((record) => record.id === source.id)), true);
const transactionRows = readFileSync(join(vaultPath, "Operations", "Brain Services", "Agent Memory Transactions.jsonl"), "utf8")
  .trim().split("\n").map((line) => JSON.parse(line));
assert.ok(transactionRows.some((row) => row.operation === "transaction-recovery" && row.state === "committed" && row.recovered));
assert.ok(transactionRows.some((row) => row.transactionId === partialTransactionId && row.state === "committed" && row.recovered));
ok("source-committed and partially renamed transactions repair before the next generation advances");

function vectorFor(text) {
  const vector = new Array(16).fill(0);
  for (let index = 0; index < text.length; index += 1) vector[index % vector.length] += text.charCodeAt(index) % 17;
  return vector;
}
const embedServer = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: inputs.map((text, index) => ({ index, embedding: vectorFor(String(text)) })) }));
  });
});
await new Promise((resolveListen) => embedServer.listen(0, "127.0.0.1", resolveListen));
process.env.HIVEMINDOS_EMBEDDINGS_URL = "http://127.0.0.1:" + embedServer.address().port + "/v1";
process.env.HIVEMINDOS_EMBEDDINGS_DIMENSIONS = "16";
process.env.HIVEMINDOS_EMBEDDINGS_MODEL = "model-a";
const embedded = await memory.rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Embedding identity probe",
  content: "Vector recall must reject rows produced by a different model configuration.",
  project: "atlas",
});
assert.equal(embedded.embedding.embedded, true);
process.env.HIVEMINDOS_EMBEDDINGS_MODEL = "model-b";
const mismatchedScores = await embeddings.semanticScoresForRecords(vaultPath, "different model vector", [embedded.record]);
assert.equal(mismatchedScores.size, 0);
const coverage = await embeddings.agentMemoryEmbeddingsCoverage(vaultPath, [embedded.record]);
assert.equal(coverage.covered, 0);
assert.equal(coverage.mismatched, 1);
await new Promise((resolveClose) => embedServer.close(resolveClose));
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;
delete process.env.HIVEMINDOS_EMBEDDINGS_MODEL;
delete process.env.HIVEMINDOS_EMBEDDINGS_DIMENSIONS;
ok("embedding rows bind endpoint, model, dimensions, and source hash");

const intentionalDuplicate = await memory.rememberAgentMemory({
  vaultPath,
  type: "fact",
  title: "Intentional portable duplicate",
  content: seed.record.content,
  project: "atlas",
  allowDuplicate: true,
});
assert.equal(intentionalDuplicate.record.contentHash, seed.record.contentHash);

await compileKnowledgeToWiki({
  vaultPath,
  domain: "atlas",
  title: "Atlas launch knowledge",
  content: "Atlas launch planning connects the Pineapple Ritual entity to the Quartz Verification concept.",
  entities: [{ name: "Pineapple Ritual" }],
  concepts: [{ name: "Quartz Verification" }],
  collaborationMode: "personal",
});
const capsule = await capsules.createBrainCapsule({ vaultPath, project: "atlas", compiledDomains: ["atlas"] });
const opened = await capsules.openBrainCapsule({ capsulePath: capsule.capsulePath });
assert.equal(opened.capsule.manifest.readOnlyDefault, true);
assert.equal(opened.capsule.manifest.importPolicy, "brain-review-only");
assert.ok(opened.capsule.manifest.counts.memories >= 10);
assert.ok(opened.capsule.manifest.counts.knowledge >= 3);
const capsuleSearch = await capsules.searchBrainCapsule({ capsulePath: capsule.capsulePath, query: "pineapple ritual" });
assert.ok(capsuleSearch.hits.length >= 1);
ok("scoped capsules package memories, compiled knowledge, provenance, and a read-only index");

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
const apiGenerations = await postMemoryApi({ action: "list-generations", vaultPath });
assert.equal(apiGenerations.response.status, 200);
assert.equal(apiGenerations.body.currentGenerationId, (await memory.listAgentMemoryGenerations({ vaultPath })).currentGenerationId);
const apiOpen = await postMemoryApi({ action: "open-capsule", capsulePath: capsule.capsulePath });
assert.equal(apiOpen.response.status, 200);
assert.equal(apiOpen.body.readOnly, true);
assert.equal("payload" in apiOpen.body, false, "open API must not expose the capsule body by default");
const apiSearch = await postMemoryApi({ action: "search-capsule", capsulePath: capsule.capsulePath, query: "pineapple ritual" });
assert.equal(apiSearch.response.status, 200);
assert.ok(apiSearch.body.hits.length >= 1);
ok("memory API exposes verified generations and read-only capsule open/search without leaking payloads");

const cliRequests = [];
const cliServer = http.createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    const url = new URL(request.url, "http://127.0.0.1");
    const body = raw ? JSON.parse(raw) : undefined;
    cliRequests.push({ method: request.method, body, query: Object.fromEntries(url.searchParams) });
    const action = body?.action;
    const result = action === "list-generations"
      ? {
          ok: true,
          currentGenerationId: "generation-current",
          coverage: {
            completeHistory: false,
            replayCompleteFrom: "2026-07-01T00:00:00.000Z",
            retainedGenerationCount: 32,
            prunedGenerationCount: 8,
            invalidGenerationCount: 0,
            policy: { maxGenerations: 256, checkpointInterval: 32 },
          },
          generations: [],
        }
      : action === "compare-generations"
        ? { ok: true, query: body.query, fromGenerationId: body.fromGenerationId, toGenerationId: body.toGenerationId, changes: [] }
        : action === "export-capsule"
          ? { ok: true, capsulePath: "/tmp/mock.hivebrain.enc", encrypted: true, manifest: { counts: { memories: 1, knowledge: 1 } } }
          : action === "open-capsule"
            ? { ok: true, capsulePath: body.capsulePath, manifest: { capsuleId: "mock", counts: { memories: 1, knowledge: 0 } }, readOnly: true }
            : action === "search-capsule"
              ? { ok: true, query: body.query, hits: [] }
              : action === "propose-capsule-import"
                ? { ok: true, proposals: [{ id: "review-mock" }] }
                : { ok: true, query: url.searchParams.get("q"), generationId: url.searchParams.get("generationId"), hits: [] };
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(result));
  });
});
await new Promise((resolveListen) => cliServer.listen(0, "127.0.0.1", resolveListen));
const cliBase = "http://127.0.0.1:" + cliServer.address().port;
async function runHiveBrainCli(args, json = true) {
  return new Promise((resolveCli, rejectCli) => {
    const child = spawn(process.execPath, ["scripts/hive-brain", ...args, ...(json ? ["--json"] : [])], {
      cwd: process.cwd(),
      env: { ...process.env, HOME: process.env.HOME, HIVEMINDOS_BRAIN_URL: cliBase, TEST_CAPSULE_PASSPHRASE: "correct horse battery staple" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => code === 0 ? resolveCli(json ? JSON.parse(stdout) : stdout) : rejectCli(new Error(stderr || `hive-brain exited ${code}`)));
  });
}
await runHiveBrainCli(["generations"]);
const generationText = await runHiveBrainCli(["generations"], false);
assert.match(generationText, /Replay coverage: complete from 2026-07-01/);
assert.match(generationText, /at most 256 generations; checkpoint every 32/);
await runHiveBrainCli(["replay", "pineapple", "--generation", "generation-old"]);
await runHiveBrainCli(["compare", "pineapple", "--from-generation", "generation-old", "--to-generation", "generation-current"]);
await runHiveBrainCli(["capsule-export", "--project", "atlas", "--memory-ids", seed.record.id, "--compiled-domain", "atlas", "--passphrase-env", "TEST_CAPSULE_PASSPHRASE"]);
await runHiveBrainCli(["capsule-open", "--capsule", "/tmp/mock.hivebrain.enc", "--passphrase-env", "TEST_CAPSULE_PASSPHRASE"]);
await runHiveBrainCli(["capsule-search", "pineapple", "--capsule", "/tmp/mock.hivebrain.enc", "--passphrase-env", "TEST_CAPSULE_PASSPHRASE"]);
await runHiveBrainCli(["capsule-import", "--capsule", "/tmp/mock.hivebrain.enc", "--passphrase-env", "TEST_CAPSULE_PASSPHRASE", "--enqueue"]);
await new Promise((resolveClose) => cliServer.close(resolveClose));
assert.equal(cliRequests.some((request) => request.method === "GET" && request.query.generationId === "generation-old"), true);
assert.equal(cliRequests.some((request) => request.body?.action === "compare-generations" && request.body.fromGenerationId === "generation-old"), true);
const exportRequest = cliRequests.find((request) => request.body?.action === "export-capsule");
assert.deepEqual(exportRequest.body.compiledDomains, ["atlas"]);
assert.equal(exportRequest.body.passphraseEnv, "TEST_CAPSULE_PASSPHRASE");
assert.equal(JSON.stringify(exportRequest).includes("correct horse battery staple"), false, "CLI must send only the passphrase variable name");
assert.equal(cliRequests.some((request) => request.body?.action === "propose-capsule-import"), true);
ok("hive-brain CLI maps replay and capsule commands onto the API without exposing passphrases");

const passphrase = "correct horse battery staple";
const encrypted = await capsules.createBrainCapsule({ vaultPath, memoryIds: [seed.record.id], passphrase });
const malformedEnvelopePath = join(dirname(encrypted.capsulePath), "malformed-envelope.hivebrain.enc");
const malformedEnvelope = JSON.parse(await readFile(encrypted.capsulePath, "utf8"));
malformedEnvelope.kdf.keyBytes = 1024 * 1024;
await writeFile(malformedEnvelopePath, JSON.stringify(malformedEnvelope));
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: malformedEnvelopePath, passphrase }), /malformed encrypted.*envelope/i);
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: encrypted.capsulePath, passphrase: "wrong passphrase value" }), /decrypt|authentication tag/);
const decrypted = await capsules.openBrainCapsule({ capsulePath: encrypted.capsulePath, passphrase });
assert.equal(decrypted.capsule.manifest.counts.memories, 1);
const tamperedPath = join(dirname(capsule.capsulePath), "tampered.hivebrain");
const tampered = JSON.parse(await readFile(capsule.capsulePath, "utf8"));
tampered.payload.memories[0].content = "tampered content";
await writeFile(tamperedPath, JSON.stringify(tampered));
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: tamperedPath }), /checksum/);
const expiredPath = join(dirname(capsule.capsulePath), "expired.hivebrain");
const expired = JSON.parse(await readFile(capsule.capsulePath, "utf8"));
expired.manifest.expiresAt = "2020-01-01T00:00:00.000Z";
await writeFile(expiredPath, JSON.stringify(expired));
await assert.rejects(() => capsules.openBrainCapsule({ capsulePath: expiredPath }), /expired/);
ok("capsule KDF bounds, AES-GCM keys, checksums, and expiry fail closed");

const targetVault = join(tmp, "target-vault");
await mkdir(targetVault, { recursive: true });
await writeFile(join(targetVault, "Shared Context.md"), "# Target\n");
const preview = await capsules.previewBrainCapsuleImport({ vaultPath: targetVault, capsulePath: capsule.capsulePath });
assert.equal(preview.reviewRequired, true);
assert.equal(preview.directImportAllowed, false);
assert.ok(preview.candidates.length >= 1);
assert.ok(preview.duplicateCount >= 1, "same-content memories inside a capsule should collapse before review");
assert.equal(new Set(preview.candidates.map((candidate) => candidate.contentHash)).size, preview.candidates.length);
const proposed = await capsules.proposeBrainCapsuleImport({ vaultPath: targetVault, capsulePath: capsule.capsulePath });
assert.equal(proposed.proposals.length, preview.candidates.length);
const firstQueue = await readBrainReviewQueue();
const targetBeforeApproval = await memory.listAgentMemoryRecords({ vaultPath: targetVault });
assert.equal(targetBeforeApproval.records.length, 0);
const brainReview = await import("../src/lib/services/brain-review-queue.ts");
await brainReview.approveBrainReviewProposal(proposed.proposals[0].id);
const appliedImport = await brainReview.applyBrainReviewProposal(proposed.proposals[0].id);
assert.equal(appliedImport.applied, true);
assert.equal(appliedImport.memory.record.title, preview.candidates[0].title);
assert.equal(appliedImport.memory.record.project, preview.candidates[0].project);
const targetAfterApproval = await memory.listAgentMemoryRecords({ vaultPath: targetVault });
assert.equal(targetAfterApproval.records.length, 1);
await capsules.proposeBrainCapsuleImport({ vaultPath: targetVault, capsulePath: capsule.capsulePath });
const secondQueue = await readBrainReviewQueue();
assert.equal(secondQueue.proposals.length, firstQueue.proposals.length);
const otherTargetVault = join(tmp, "other-target-vault");
await mkdir(otherTargetVault, { recursive: true });
await writeFile(join(otherTargetVault, "Shared Context.md"), "# Other target\n");
const otherTargetProposals = await capsules.proposeBrainCapsuleImport({ vaultPath: otherTargetVault, capsulePath: capsule.capsulePath });
const crossScopeQueue = await readBrainReviewQueue();
assert.equal(crossScopeQueue.proposals.length, secondQueue.proposals.length + otherTargetProposals.proposals.length);
assert.equal((await memory.listAgentMemoryRecords({ vaultPath: otherTargetVault })).records.length, 0);
ok("capsule imports stay read-only until approval, preserve scope, and dedupe without crossing vaults");

console.log("\nShared Brain generations and capsules checks passed (" + passed + " groups).");
await rm(tmp, { recursive: true, force: true });
