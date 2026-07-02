import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const has = (path, token, label = token) => {
  assert.ok(read(path).includes(token), `${path} should contain ${label}`);
};
const hasCollapsed = (path, token, label = token) => {
  assert.ok(read(path).replace(/\s+/g, " ").includes(token.replace(/\s+/g, " ")), `${path} should contain ${label}`);
};

for (const path of [
  "src/lib/services/obsidian/agent-memory.ts",
  "src/lib/services/obsidian/agent-memory/core.ts",
  "src/lib/services/obsidian/agent-memory/types.ts",
  "src/lib/services/obsidian/agent-memory/entities.ts",
  "src/lib/services/obsidian/agent-memory/scoring.ts",
  "src/lib/services/obsidian/agent-memory/usage.ts",
  "src/lib/services/search/bm25-lite.ts",
]) {
  assert.ok(existsSync(join(root, path)), `missing agent memory upgrade file: ${path}`);
}

has("src/lib/services/obsidian/agent-memory.ts", "agent-memory/core", "public facade should re-export the split implementation");

for (const token of ["\"action\"", "entities?: string[]", "aliases?: string[]", "actorRole?:", "memoryOrigin?:", "usage?: AgentMemoryUsageSummary", "scoreDetails?: AgentMemoryScoreDetails", "temporalMode?:", "trackUsage?:", "usageContext?:"]) {
  has("src/lib/services/obsidian/agent-memory/types.ts", token);
}

for (const token of [
  "AGENT_MEMORY_ENTITY_INDEX_PATH",
  "Agent Memory Entity Index.jsonl",
  "wikilinkEntities",
  "quotedEntities",
  "acronymEntities",
  "properSequenceEntities",
  "knownHiveEntities",
  "Queen Bee",
  "GitLawb",
  "Neo4j",
  "extractAgentMemoryEntities",
  "entityMatchesForQuery",
  "appendAgentMemoryEntityIndex",
]) {
  has("src/lib/services/obsidian/agent-memory/entities.ts", token);
}

for (const token of [
  "appendAgentMemoryEntityIndex(root, record)",
  "await rewriteAgentMemoryEntityIndex(root, records)",
  "entities: record.entities",
  "aliases: record.aliases",
  "actorRole: record.actorRole",
  "memoryOrigin: record.memoryOrigin",
  "rememberActionAgentMemory",
  "type: \"action\"",
  "actorRole: input.actorRole ?? \"assistant\"",
  "memoryOrigin: input.memoryOrigin ?? \"assistant-action\"",
]) {
  has("src/lib/services/obsidian/agent-memory/core.ts", token);
}

for (const token of [
  "temporalRecallMode",
  "recordVisibleForRecall",
  "bm25ScoresForRecords",
  "scoreAgentMemory",
  "before|used to|previously|formerly|at the time|back then",
  "last week",
  "last month",
  "last year",
  "input.asOf",
  "record.status === \"active\"",
  "record.status === \"superseded\"",
  "entityMatchesForQuery",
  "scoreDetails.lexical",
  "scoreDetails.entity",
  "scoreDetails.temporal",
  "scoreDetails.usage",
  "scoreDetails.confidence",
  "scoreDetails.recency",
]) {
  has("src/lib/services/obsidian/agent-memory/scoring.ts", token);
}

for (const token of ["bm25Tokens", "bm25TermCounts", "scoreBm25Terms", "normalizeBm25Score", "BM25_LITE_K1", "BM25_LITE_B"]) {
  has("src/lib/services/search/bm25-lite.ts", token);
}

for (const token of [
  "AGENT_MEMORY_RETRIEVALS_PATH",
  "Agent Memory Retrievals.jsonl",
  "retrievalCount",
  "finalAnswerCount",
  "lastRetrievedAt",
  "lastUsedAt",
  "appendAgentMemoryUsage",
]) {
  has("src/lib/services/obsidian/agent-memory/usage.ts", token);
}

for (const token of [
  "withAgentMemoryUsage(root, await readMemoryRecords(root))",
  "recordAgentMemoryUsage",
  "recordRetrievedHits",
  "if (!input.trackUsage) return",
  "usageType: \"retrieved\"",
]) {
  has("src/lib/services/obsidian/agent-memory/core.ts", token);
}

for (const token of [
  "remember-action",
  "record-usage",
  "temporalMode",
  "asOf",
  "trackUsage",
  "usageContext",
]) {
  has("src/app/api/brain/memory/route.ts", token);
}

for (const token of [
  "Operations/Brain Services/Agent Memory Entity Index.jsonl",
  "Operations/Brain Services/Agent Memory Retrievals.jsonl",
]) {
  has("src/lib/services/obsidian/full-vault-search-index.ts", token);
}

hasCollapsed(
  "src/lib/services/chat/shared-brain-memory-context.ts",
  "trackUsage: true",
  "managed chat preflight should record retrieval usage",
);
has("src/app/api/queen-bee/route.ts", "rememberActionAgentMemory", "Queen Bee receipts should write action memories");
has("src/app/api/handoff/route.ts", "rememberActionAgentMemory", "handoff receipts should write action memories");

console.log("Agent Memory upgrade contract checks passed.");
