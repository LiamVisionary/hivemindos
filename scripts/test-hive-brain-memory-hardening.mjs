// End-to-end checks for the shared-brain memory hardening pass: recall
// precision floors, duplicate gate, sensitive-content gate, compacting
// rebuilds, telemetry hygiene, sync-conflict exclusion, full-vault TTL,
// optional embeddings, consolidation, and health.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { appendFileSync, readFileSync, statSync, utimesSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

process.env.HIVEMINDOS_MEMORY_PROOFS = "off";
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;

const {
  answerFromAgentMemory,
  consolidateAgentMemory,
  evolveAgentMemory,
  healthAgentMemory,
  listAgentMemoryRecords,
  recallAgentMemory,
  recordAgentMemoryUsage,
  rememberAgentMemory,
  rebuildAgentMemoryIndex,
} = await import("../src/lib/services/obsidian/agent-memory/core.ts");
const { normalizeAgentMemorySourceType } = await import("../src/lib/services/obsidian/agent-memory/types.ts");
const { searchFullVaultSearchIndex, rebuildFullVaultSearchIndex } = await import("../src/lib/services/obsidian/full-vault-search-index.ts");

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await mkdtemp(join(tmpdir(), "hivemindos-brain-hardening-"));
const vaultPath = join(tmp, "vault");
const INDEX = join(vaultPath, "Operations", "Brain Services", "Agent Memory Index.jsonl");
const ENTITY_INDEX = join(vaultPath, "Operations", "Brain Services", "Agent Memory Entity Index.jsonl");
const RETRIEVALS = join(vaultPath, "Operations", "Brain Services", "Agent Memory Retrievals.jsonl");
const EMBEDDINGS = join(vaultPath, "Operations", "Brain Services", "Agent Memory Embeddings.jsonl");

await mkdir(vaultPath, { recursive: true });
await writeFile(join(vaultPath, "Shared Context.md"), "# Shared Context\n\nTest vault.\n");

function lineCount(path) {
  try {
    return readFileSync(path, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`ok ${passed} - ${label}`);
}

// Async CLI runner: mock HTTP servers live in this process, so the CLI must
// run detached from the event loop (spawnSync would deadlock the mock).
function runCli(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn("node", [join(repoRoot, "scripts", "hive-brain"), ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });
}

// --- seed memories ------------------------------------------------------------

const seedA = await rememberAgentMemory({
  vaultPath,
  type: "instruction",
  title: "Never write the Hermes gateway default model",
  content: "Model selection is agent-scoped: write model.default into the agent profile config, never into the gateway-level config file.",
  tags: ["hermes", "models"],
});
assert.ok(seedA.record, "seed A should write");
const seedB = await rememberAgentMemory({
  vaultPath,
  type: "preference",
  title: "Liam likes pineapples",
  content: "Liam mentioned liking pineapples. Treat pineapple as a remembered fruit preference.",
});
assert.ok(seedB.record, "seed B should write");
const seedC = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Vultr provisioning needs the API key allowlist",
  content: "Provisioning Vultr instances fails with 403 until the API key IP allowlist includes the caller network.",
});
assert.ok(seedC.record, "seed C should write");
ok("seed memories written");

const legacyConversationSource = await rememberAgentMemory({
  vaultPath,
  type: "decision",
  title: "Legacy conversation provenance",
  content: "A direct conversation supplied this reviewed decision.",
  sourceType: "conversation",
});
const legacyWorkBoardSource = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Legacy Work Board provenance",
  content: "A Work Board result supplied this derived learning.",
  sourceType: "reviewed-work-board-result",
});
assert.equal(legacyConversationSource.record?.sourceType, "explicit", "conversation provenance should normalize to explicit");
assert.equal(legacyWorkBoardSource.record?.sourceType, "inferred", "Work Board provenance should normalize to inferred");
for (const alias of [
  "analysis",
  "observed",
  "reviewed-artifact",
  "reviewed-work-board-result",
  "work-board",
  "work-board-artifact",
  "work-board-research",
  "work-board-result",
  "work-board-task",
]) {
  assert.equal(normalizeAgentMemorySourceType(alias), "inferred", `${alias} should normalize to inferred`);
}
assert.throws(() => normalizeAgentMemorySourceType("unsupported-source"), /Unsupported memory source type/);
ok("legacy source provenance aliases normalize to the canonical schema");

// --- precision floors ----------------------------------------------------------

const junk = await answerFromAgentMemory({ vaultPath, query: "hi" });
assert.equal(junk.hits.length, 0, `short junk query should return 0 hits, got ${junk.hits.length}`);
ok("short junk query returns no hits");

const noisy = await answerFromAgentMemory({
  vaultPath,
  query: "Help me identify gaps in our overall system structure and architecture, improvements that can be made across storage and process handling.",
});
assert.equal(noisy.hits.length, 0, `noisy informational prompt should return 0 hits, got ${noisy.hits.length}: ${noisy.hits.map((hit) => hit.title).join(", ")}`);
ok("noisy informational prompt returns no hits");

await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Framing control uses object anchors instead of visibility rules",
  content: "Keep character heads inside the framing anchors; this is unrelated to memory architecture.",
  confidence: 1,
});
const compoundUnsupported = await answerFromAgentMemory({
  vaultPath,
  query: "What are the current shared-brain rules for operational events, canonical heads, and pattern mining?",
});
assert.equal(
  compoundUnsupported.hits.length,
  0,
  `compound unsupported query should abstain, got ${compoundUnsupported.hits.map((hit) => hit.title).join(", ")}`,
);
ok("compound unsupported query abstains instead of joining unrelated topic fragments");

const known = await answerFromAgentMemory({ vaultPath, query: "hermes gateway default model rule" });
assert.equal(known.hits[0]?.title, "Never write the Hermes gateway default model", "known-item should rank first");
ok("known-item query ranks the right memory first");

const longPrompt = `You are receiving an automated Kanban assignment from the Queen Bee orchestrator.\n\nTask: investigate\n\n## Request\nWhy does Vultr provisioning fail with 403 errors?\n\n## Routing contract\nUse Shared Brain Memory for durable context, Fleet discovery for live capability, Handoff for cross-machine work, and receipts for dedupe/audit.\n\n## Queen Bee delegation\nNo chat-capable online fleet agent is available yet; the task was queued on the Work Board for later pickup. Target machine: any machine. Suggested worker class: research. ${"Filler sentence about routing and delegation policies. ".repeat(12)}`;
const derived = await answerFromAgentMemory({ vaultPath, query: longPrompt });
assert.ok(derived.queryDerived, "long prompts should use a derived query");
assert.equal(derived.hits[0]?.title, "Vultr provisioning needs the API key allowlist", `derived query should find the Vultr memory, got: ${derived.hits.map((hit) => hit.title).join(", ") || "none"}`);
ok("long orchestrator prompt derives a query and finds the right memory");

// --- natural-language intent ranking ------------------------------------------

await rememberAgentMemory({
  vaultPath,
  type: "decision",
  title: "Use dedicated Atlas builder wallet for revenue",
  content: "The dedicated Atlas wallet receives builder revenue. The builder fee was set during launch.",
  confidence: 1,
  entities: ["Atlas Revenue"],
});
await rememberAgentMemory({
  vaultPath,
  type: "decision",
  title: "Set Atlas builder fee to 0.5 bps",
  content: "The selected Atlas builder fee is 0.5 basis points.",
  confidence: 0.7,
});
const feeIntent = await recallAgentMemory({ vaultPath, query: "what builder fee did we set for Atlas" });
assert.equal(feeIntent.hits[0]?.title, "Set Atlas builder fee to 0.5 bps", "complete title coverage should beat a related high-confidence entity hit");
ok("natural fee question ranks the specific decision first");

await rememberAgentMemory({
  vaultPath,
  type: "decision",
  title: "Use dedicated Orion wallet for builder revenue",
  content: "The Orion wallet is the canonical revenue recipient.",
  confidence: 1,
  entities: ["Orion Revenue"],
});
await rememberAgentMemory({
  vaultPath,
  type: "artifact",
  title: "Orion builder revenue live verification",
  content: "This verification artifact proved the builder revenue path live.",
  confidence: 0.7,
});
const artifactIntent = await recallAgentMemory({ vaultPath, query: "what artifact proved Orion builder revenue live" });
assert.equal(artifactIntent.hits[0]?.type, "artifact", "artifact wording should prefer an artifact over a related decision");
ok("artifact question ranks an artifact first");

await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Windows fleet bug fixed after three filters",
  content: "A concrete bug was fixed after finding three visibility filters.",
  confidence: 0.9,
  entities: ["FIXED"],
});
await rememberAgentMemory({
  vaultPath,
  type: "instruction",
  title: "Require full E2E before saying fixed",
  content: "Run the real user path end to end before declaring any bug fixed.",
  confidence: 0.7,
});
const instructionIntent = await recallAgentMemory({ vaultPath, query: "what must we do before declaring a bug fixed" });
assert.equal(instructionIntent.hits[0]?.type, "instruction", "normative wording should prefer an instruction over an incident learning");
ok("normative question ranks an instruction first");

// --- duplicate gate -------------------------------------------------------------

const dup = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Vultr provisioning needs the API key allowlist configured",
  content: "Provisioning Vultr instances fails with 403 until the API key IP allowlist includes the caller network.",
});
assert.equal(dup.blocked, true, "near-identical write should be blocked");
assert.ok(dup.blockReason?.includes("evolve"), "block reason should point at evolve");
assert.ok(dup.possibleConflicts?.length >= 1, "conflicts should be returned");
const dupForced = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Vultr provisioning needs the API key allowlist configured",
  content: "Provisioning Vultr instances fails with 403 until the API key IP allowlist includes the caller network.",
  allowDuplicate: true,
});
assert.ok(dupForced.record, "allowDuplicate should override the gate");
ok("duplicate gate blocks near-identical writes and allowDuplicate overrides");

// Coverage rule: sharing operational vocabulary with an existing memory must
// NOT block a genuinely different topic (regression: a write-contract memory
// was blocked against an env-sync memory purely on tailnet/queue/api words).
const adjacent = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "CDN edge config rollout tracking",
  content: "The staging network gateway rejects API calls until the allowlist change propagates to every region; unrelated to instance provisioning, this note tracks the CDN edge config rollout sequence and its verification checklist across deploy windows.",
});
assert.ok(adjacent.record, `topic-adjacent vocabulary must not be blocked: ${adjacent.blockReason ?? ""}`);
ok("duplicate gate ignores topic-adjacent vocabulary overlap");

// --- sensitive-content gate -----------------------------------------------------

await assert.rejects(
  () => rememberAgentMemory({ vaultPath, type: "fact", title: "api key", content: "the key is sk-abcdefghijklmnopqrstuvwxyz123456" }),
  /provider API key/,
  "high-confidence secrets should block the write",
);
await assert.rejects(
  () => rememberAgentMemory({ vaultPath, type: "fact", title: "tailnet", content: "reach it at 100.101.102.103 directly" }),
  /Tailnet IP/,
  "raw tailnet IPs should block the write",
);
const warned = await rememberAgentMemory({
  vaultPath,
  type: "fact",
  title: "credential status",
  content: "OPENAI_API_KEY is set on the NYC machine; password=redactedvalue1 was rotated.",
  allowSensitiveContent: true,
});
assert.ok(warned.record, "allowSensitiveContent should override");
ok("sensitive-content gate blocks secrets and tailnet IPs");

// --- evolve + chains ------------------------------------------------------------

const evolved = await evolveAgentMemory({
  vaultPath,
  memoryId: seedC.record.id,
  content: "Provisioning Vultr instances fails with 403 until the API key IP allowlist includes the caller network. UPDATE: verification cleared; allowlist is the only remaining gate.",
  evolutionReason: "verification cleared",
});
assert.ok(evolved.record, "evolve should write");
const afterEvolve = await recallAgentMemory({ vaultPath, query: "vultr provisioning 403 allowlist" });
const topEvolve = afterEvolve.hits.find((hit) => hit.evolutionChain);
assert.ok(topEvolve, "evolved memory should carry its chain");
assert.equal(topEvolve.evolutionChain[0].status, "active");
ok("evolve supersedes and recall attaches the chain");

// --- rebuild compaction ---------------------------------------------------------

const linesBefore = lineCount(INDEX);
await rebuildAgentMemoryIndex({ vaultPath, includeFullVault: false });
const linesAfterFirst = lineCount(INDEX);
await rebuildAgentMemoryIndex({ vaultPath, includeFullVault: false });
const linesAfterSecond = lineCount(INDEX);
const { records: allRecords } = await listAgentMemoryRecords({ vaultPath });
assert.equal(linesAfterFirst, linesAfterSecond, "repeated rebuilds must not grow the index");
assert.equal(linesAfterFirst, allRecords.length, `compacted index should have one line per memory (${linesAfterFirst} lines vs ${allRecords.length} records)`);
assert.ok(linesAfterFirst <= linesBefore + 2, "rebuild should compact, not append");
const entityLines = readFileSync(ENTITY_INDEX, "utf8").split("\n").filter(Boolean);
const entityKeys = entityLines.map((line) => { const row = JSON.parse(line); return `${row.memoryId}::${row.entityKey}`; });
assert.equal(new Set(entityKeys).size, entityKeys.length, "entity index rebuild should be deduped");
ok("rebuild compacts the memory and entity indexes");

// --- telemetry hygiene ----------------------------------------------------------

await recordAgentMemoryUsage({
  vaultPath,
  memoryIds: [seedA.record.id],
  usageType: "retrieved",
  query: `find the secret sk-abcdefghijklmnopqrstuvwxyz123456 ${"pad ".repeat(200)}`,
});
const lastRow = JSON.parse(readFileSync(RETRIEVALS, "utf8").trim().split("\n").at(-1));
assert.ok(lastRow.query.length <= 200, "logged query must be truncated");
assert.ok(lastRow.query.includes("[REDACTED_API_KEY]"), "logged query must be redacted");
// Rotation: inflate beyond 4MB then append.
const filler = `${JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", schema: "hivemindos.agent-memory-retrieval.v1", memoryId: "mem-filler", usageType: "retrieved" })}\n`;
appendFileSync(RETRIEVALS, filler.repeat(Math.ceil((4.2 * 1024 * 1024) / filler.length)));
await recordAgentMemoryUsage({ vaultPath, memoryIds: [seedA.record.id], usageType: "final-answer" });
assert.ok(statSync(RETRIEVALS).size < 4 * 1024 * 1024, "retrievals log should rotate when oversized");
ok("telemetry truncates+redacts queries and rotates the log");

// --- final-answer usage boosts ranking -------------------------------------------

for (let index = 0; index < 3; index += 1) {
  await recordAgentMemoryUsage({ vaultPath, memoryIds: [seedB.record.id], usageType: "final-answer" });
}
const { records: usageRecords } = await listAgentMemoryRecords({ vaultPath });
const pineapple = usageRecords.find((record) => record.id === seedB.record.id);
assert.ok((pineapple?.usage?.finalAnswerCount ?? 0) >= 3, "final-answer usage should aggregate");
ok("final-answer usage aggregates onto records");

// --- sync-conflict exclusion + full-vault TTL -------------------------------------

await writeFile(join(vaultPath, "Projects.md"), "# Projects\n\nProject index note for search.\n");
await writeFile(join(vaultPath, "Projects.sync-conflict-20260701-XYZ.md"), "# Projects\n\nProject index note for search.\n");
await rebuildFullVaultSearchIndex({ root: vaultPath });
const conflictSearch = await searchFullVaultSearchIndex({ root: vaultPath, query: "project index note search" });
assert.ok(conflictSearch.hits.length >= 1, "real note should be indexed");
assert.ok(!conflictSearch.hits.some((hit) => hit.path.includes(".sync-conflict-")), "sync-conflict copies must not be indexed");

process.env.HIVEMINDOS_FULL_VAULT_INDEX_TTL_MS = "50";
const fullVaultIndexFile = join(vaultPath, "Operations", "Brain Services", "Full Vault Search Index.jsonl");
const staleTime = (Date.now() - 60_000) / 1000;
utimesSync(fullVaultIndexFile, staleTime, staleTime);
await writeFile(join(vaultPath, "Ideas Fresh Note.md"), "# Ideas Fresh Note\n\nZanzibar spice inventory tracking prototype.\n");
const ttlSearch = await searchFullVaultSearchIndex({ root: vaultPath, query: "zanzibar spice inventory" });
assert.ok(ttlSearch.hits.some((hit) => hit.path === "Ideas Fresh Note.md"), "stale index should rebuild via TTL and see fresh notes");
process.env.HIVEMINDOS_FULL_VAULT_INDEX_TTL_MS = "0";
ok("sync-conflict copies excluded and stale full-vault index rebuilds via TTL");

// --- optional embeddings layer ----------------------------------------------------

// Deterministic fake embedder: character-trigram bag, so related words
// ("deploy"/"deployment") land near each other.
function fakeVector(text) {
  const vector = new Array(64).fill(0);
  const lower = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  for (let index = 0; index + 3 <= lower.length; index += 1) {
    const tri = lower.slice(index, index + 3);
    let hash = 0;
    for (const char of tri) hash = (hash * 31 + char.charCodeAt(0)) % 64;
    vector[hash] += 1;
  }
  return vector;
}
const embedServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const inputs = Array.isArray(payload.input) ? payload.input : [payload.input];
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: inputs.map((text, index) => ({ index, embedding: fakeVector(String(text)) })) }));
  });
});
await new Promise((resolveListen) => embedServer.listen(0, "127.0.0.1", resolveListen));
process.env.HIVEMINDOS_EMBEDDINGS_URL = `http://127.0.0.1:${embedServer.address().port}/v1`;

const semantic = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Deployment target for the collector",
  content: "The collector deployment target machine is the Hetzner Ubuntu box in Helsinki.",
});
assert.ok(semantic.record, "semantic seed should write");
assert.equal(semantic.embedding?.embedded, true, "write path should embed when enabled");
assert.ok(lineCount(EMBEDDINGS) >= 1, "embeddings store should have rows");
const paraphrase = await answerFromAgentMemory({ vaultPath, query: "where do we deploy the collector service" });
assert.ok(
  paraphrase.hits.some((hit) => hit.id === semantic.record.id),
  `paraphrase query should reach the memory via hybrid recall, got: ${paraphrase.hits.map((hit) => hit.title).join(", ") || "none"}`,
);
ok("optional embeddings enable paraphrase recall (hybrid)");

// --- consolidation -----------------------------------------------------------------

const staleSsh = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "SSH fallback unavailable on Atlas server",
  content: "Atlas server access has no key-based SSH fallback; use the provider console for recovery.",
  memoryKey: "learning/atlas/ssh-fallback-unavailable",
});
const correctedSsh = await rememberAgentMemory({
  vaultPath,
  type: "learning",
  title: "Direct SSH access works on Atlas server",
  content: "Correction to the older Atlas SSH note: direct key-based SSH now works with the managed identity. This replaces the provider-console-only guidance.",
  memoryKey: "learning/atlas/direct-ssh-access",
  allowDuplicate: true,
});
assert.ok(staleSsh.record && correctedSsh.record, "correction fixture should write two differently titled active memories");

// Plant a stale, never-retrieved context memory by writing the note + index row
// with an old createdAt, then rebuilding from markdown.
const staleId = "mem-20250101000000-stale00001";
const staleNotePath = "Memory/Distillations/Agent Memory/context/2025-01-01-old-scratch-context-stale00001.md";
await mkdir(join(vaultPath, dirname(staleNotePath)), { recursive: true });
await writeFile(join(vaultPath, staleNotePath), `---
type: "agent-memory"
id: "${staleId}"
memoryType: "context"
title: "Old scratch context from January"
status: "active"
confidence: 0.7
tags: []
createdAt: "2025-01-01T00:00:00.000Z"
updatedAt: "2025-01-01T00:00:00.000Z"
---

# Old scratch context from January

Ephemeral working context about a long-finished experiment nobody recalls.

## Metadata

- Type: context
`, "utf8");
await rebuildAgentMemoryIndex({ vaultPath, includeFullVault: false });

const report = await consolidateAgentMemory({ vaultPath });
assert.ok(report.duplicateGroups.length >= 1, "consolidation should find the planted near-duplicate group");
assert.ok(report.duplicateGroups[0].evolveHint.includes("hive-brain evolve"), "duplicate groups should carry an evolve hint");
assert.ok(
  report.correctionCandidates.some((candidate) => candidate.newerId === correctedSsh.record.id && candidate.olderId === staleSsh.record.id),
  "explicit correction language should propose linking the newer and older canonical heads",
);
assert.ok(report.correctionCandidates[0].evolveHint.includes("--supersedes"), "correction candidates should be review-gated evolve proposals");
assert.ok(report.archiveCandidates.some((candidate) => candidate.id === staleId), "stale context memory should be an archive candidate");
assert.equal(report.archivedCount, 0, "report-only run must not archive");
const applied = await consolidateAgentMemory({ vaultPath, applyArchives: true });
assert.ok(applied.archivedIds.includes(staleId), "applyArchives should archive the stale candidate");
const afterArchive = await recallAgentMemory({ vaultPath, query: "old scratch context january experiment" });
assert.ok(!afterArchive.hits.some((hit) => hit.id === staleId), "archived memories must not surface in current recall");
ok("consolidation reports duplicates, archives stale context on apply");

// --- health ------------------------------------------------------------------------

const health = await healthAgentMemory({ vaultPath });
assert.ok(health.memories.total >= 6, "health should count memories");
assert.ok(health.indexes.memoryIndex.bloatFactor <= 1.5, `index bloat should stay near 1 after compaction, got ${health.indexes.memoryIndex.bloatFactor}`);
assert.ok(health.usage.finalAnswerTotal >= 3, "health should aggregate final-answer usage");
assert.ok(health.duplicatePressure.groups >= 1, "health should report duplicate pressure");
assert.equal(health.proofs.mode, "off", "proofs kill-switch should be visible in health");
ok("health reports counts, bloat, usage, duplicate pressure");

// --- CLI: pending queue + blocked handling ------------------------------------------

embedServer.close();
delete process.env.HIVEMINDOS_EMBEDDINGS_URL;
const fakeHome = join(tmp, "home");
await mkdir(fakeHome, { recursive: true });
const cliEnv = {
  ...process.env,
  HOME: fakeHome,
  HIVE_BRAIN_NO_API: "1",
  NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vaultPath,
};
const queued = spawnSync("node", [join(repoRoot, "scripts", "hive-brain"), "remember", "--type", "learning", "--title", "Queued while offline", "--content", "Offline queue durability test memory.", "--vault", vaultPath], { encoding: "utf8", env: cliEnv });
assert.equal(queued.status, 0, queued.stderr || queued.stdout);
assert.ok(queued.stdout.includes("queued"), `offline write should queue, got: ${queued.stdout}`);
const pendingFile = join(fakeHome, ".hivemindos", "brain-write-pending.jsonl");
const pendingRows = readFileSync(pendingFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
assert.equal(pendingRows.length, 1, "one pending write should be queued");
assert.ok(pendingRows[0].payload.machineName, "queued payload should carry autofilled provenance");

// Mock API accepts the flush and serves a blocked 409 for the next remember.
const received = [];
const mockApi = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const payload = body ? JSON.parse(body) : {};
    received.push(payload);
    res.setHeader("content-type", "application/json");
    if (payload.title === "Blocked duplicate probe" && payload.allowDuplicate !== true) {
      res.statusCode = 409;
      res.end(JSON.stringify({ ok: false, blocked: true, blockReason: "A very similar active memory already exists (mem-x). Evolve it instead.", possibleConflicts: [{ id: "mem-x", title: "Existing memory", score: 80, content: "existing" }] }));
      return;
    }
    res.end(JSON.stringify({ ok: true, action: payload.action ?? "recall", record: { id: "mem-mock", title: payload.title, notePath: "Memory/x.md" }, hits: [] }));
  });
});
await new Promise((resolveListen) => mockApi.listen(0, "127.0.0.1", resolveListen));
const apiEnv = { ...cliEnv, HIVE_BRAIN_NO_API: "", HIVEMINDOS_BRAIN_URL: `http://127.0.0.1:${mockApi.address().port}` };
const flushed = await runCli(["flush-pending"], apiEnv);
assert.equal(flushed.status, 0, flushed.stderr || flushed.stdout);
assert.ok(flushed.stdout.includes("flushed: 1"), `flush should deliver the queued write, got: ${flushed.stdout}`);
assert.ok(received.some((payload) => payload.title === "Queued while offline"), "mock API should receive the queued write");
assert.equal(readFileSync(pendingFile, "utf8").trim(), "", "pending file should be drained");

const blocked = await runCli(["remember", "--type", "learning", "--title", "Blocked duplicate probe", "--content", "duplicate content", "--vault", vaultPath], apiEnv);
assert.equal(blocked.status, 3, `blocked write should exit 3, got ${blocked.status}: ${blocked.stdout} ${blocked.stderr}`);
assert.ok(blocked.stderr.includes("suspected duplicate"), "blocked write should explain itself");
assert.ok(blocked.stderr.includes("Existing memory"), "blocked write should list conflicts");

// A queued write the app rejects must be kept marked blocked (never silently
// dropped), and --retry-blocked re-delivers it with allowDuplicate.
const queuedBlocked = await runCli(["remember", "--type", "learning", "--title", "Blocked duplicate probe", "--content", "queued duplicate content", "--vault", vaultPath], cliEnv);
assert.equal(queuedBlocked.status, 0, queuedBlocked.stderr || queuedBlocked.stdout);
const blockedFlush = await runCli(["flush-pending"], apiEnv);
assert.ok(blockedFlush.stdout.includes("(1 blocked)"), `blocked flush should report, got: ${blockedFlush.stdout}`);
const blockedRow = readFileSync(pendingFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((entry) => entry.blockedAt);
assert.ok(blockedRow, "blocked queued write must remain in the pending file");
assert.ok(blockedRow.blockedReason?.includes("similar active memory"), "blocked entry should carry the reason");
const retryFlush = await runCli(["flush-pending", "--retry-blocked"], apiEnv);
assert.ok(retryFlush.stdout.includes("flushed: 1"), `retry-blocked should deliver, got: ${retryFlush.stdout}`);
assert.ok(received.some((payload) => payload.title === "Blocked duplicate probe" && payload.allowDuplicate === true), "retry should send allowDuplicate");
assert.equal(readFileSync(pendingFile, "utf8").trim(), "", "pending file should drain after retry");
mockApi.close();
ok("CLI queues offline writes, flushes them, surfaces blocks, and keeps blocked entries reviewable");

console.log(`\nHive brain memory hardening checks passed (${passed} groups).`);
