import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.HIVEMINDOS_TEST_BASE_URL || process.argv.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length) || "http://127.0.0.1:5033";

// Dashboard /api routes 401 tokenless since the API auth gate moved to
// src/proxy.ts (same resolution order as scripts/fleet-health-watchdog.mjs).
function envFileValue(path, key) {
  if (!existsSync(path)) return "";
  const match = readFileSync(path, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+)\\s*$`, "m"));
  let value = match?.[1]?.trim() ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value.trim();
}

const deviceToken = (
  process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || envFileValue(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  || envFileValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
).trim();

function dashboardHeaders(extra = {}) {
  return deviceToken ? { ...extra, "x-hivemindos-device-token": deviceToken } : extra;
}

async function postMemory(body) {
  const response = await fetch(`${baseUrl}/api/brain/memory`, {
    method: "POST",
    headers: dashboardHeaders({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.ok, true, data?.error || `HTTP ${response.status}`);
  assert.equal(data?.ok, true, data?.error || "memory API returned ok=false");
  return data;
}

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-agent-memory-api-"));
const vaultPath = join(tmp, "vault");
const indexPath = join(vaultPath, "Operations", "Brain Services", "Agent Memory Index.jsonl");

await write(join(vaultPath, "Shared Context.md"), "# Shared Context\n");

const entityWrite = await postMemory({
  action: "remember",
  vaultPath,
  type: "context",
  title: "Coordinator identity",
  content: "The central coordinator for routing work owns leases, receipts, and dedupe.",
  entities: ["Queen Bee"],
  aliases: ["QB"],
  tags: ["routing"],
  confidence: 0.88,
});
assert.ok(entityWrite.record.entities.includes("Queen Bee"), "remember should persist explicit entities");
assert.ok(entityWrite.record.aliases.includes("QB"), "remember should persist explicit aliases");

const entityRecall = await postMemory({
  action: "recall",
  vaultPath,
  query: "what do we know about Queen Bee?",
  scope: "agent-memory",
  limit: 3,
});
assert.equal(entityRecall.hits[0]?.id, entityWrite.record.id, "entity recall should find the entity-linked record");
assert.ok((entityRecall.hits[0]?.scoreDetails?.entity ?? 0) > 0, "entity recall should expose an entity score detail");

const aliasWrite = await postMemory({
  action: "remember",
  vaultPath,
  type: "fact",
  title: "Code Proof ledger",
  content: "The proof ledger records code provenance receipts.",
  entities: ["Code Proof"],
  aliases: ["GitLawb"],
  tags: ["proof"],
});
const aliasRecall = await postMemory({
  action: "recall",
  vaultPath,
  query: "everything related to GitLawb",
  scope: "agent-memory",
  limit: 3,
});
assert.equal(aliasRecall.hits[0]?.id, aliasWrite.record.id, "alias recall should find the alias-linked record");
assert.ok(aliasRecall.hits[0]?.matched.some((match) => match.startsWith("entity:GitLawb")), "alias match should be reported");

const legacyActionRecord = {
  timestamp: "2026-01-20T00:00:00.000Z",
  action: "remember",
  id: "mem-legacy-handoff-receipt",
  memoryType: "action",
  title: "Handoff receipt",
  content: "Assistant handed task queen-123 to Hermes on the selected machine and recorded the transfer receipt.",
  status: "active",
  notePath: "Memory/Distillations/Agent Memory/action/legacy-handoff.md",
  confidence: 0.8,
  tags: ["action", "receipt"],
  createdAt: "2026-01-20T00:00:00.000Z",
  updatedAt: "2026-01-20T00:00:00.000Z",
};

const oldRecord = {
  timestamp: "2026-01-01T00:00:00.000Z",
  action: "remember",
  id: "mem-old-release-note-style",
  memoryType: "preference",
  title: "Release note style old",
  content: "Liam used to accept long release notes with detailed implementation narration.",
  status: "superseded",
  cognitiveStage: "system1",
  supersededBy: ["mem-new-release-note-style"],
  notePath: "Memory/Distillations/Agent Memory/preference/old.md",
  confidence: 0.82,
  tags: ["release-notes"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};
const newRecord = {
  timestamp: "2026-02-01T00:00:00.000Z",
  action: "remember",
  id: "mem-new-release-note-style",
  memoryType: "preference",
  title: "Release note style new",
  content: "Liam prefers concise release notes with user-facing behavior first.",
  status: "active",
  cognitiveStage: "system2",
  supersedes: ["mem-old-release-note-style"],
  evolutionRootId: "mem-old-release-note-style",
  notePath: "Memory/Distillations/Agent Memory/preference/new.md",
  confidence: 0.92,
  tags: ["release-notes", "evolved"],
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};
await write(indexPath, [
  JSON.stringify(oldRecord),
  JSON.stringify(newRecord),
  JSON.stringify({ ...entityWrite.record, action: "remember", memoryType: entityWrite.record.type }),
  JSON.stringify({ ...aliasWrite.record, action: "remember", memoryType: aliasWrite.record.type }),
  JSON.stringify(legacyActionRecord),
].join("\n") + "\n");

const defaultActionRecall = await postMemory({
  action: "recall",
  vaultPath,
  query: "handoff receipt Hermes",
  scope: "agent-memory",
  limit: 3,
});
assert.equal(defaultActionRecall.hits.some((hit) => hit.id === legacyActionRecord.id), false, "legacy operational receipts should stay out of default recall");

const actionRecall = await postMemory({
  action: "recall",
  vaultPath,
  type: "action",
  query: "handoff receipt Hermes",
  scope: "agent-memory",
  limit: 3,
});
assert.equal(actionRecall.hits[0]?.id, legacyActionRecord.id, "explicit action recall should preserve access to legacy receipts");

const currentRecall = await postMemory({
  action: "recall",
  vaultPath,
  query: "release notes style",
  scope: "agent-memory",
  limit: 3,
});
assert.equal(currentRecall.hits[0]?.id, "mem-new-release-note-style", "current recall should prefer the active chain head");
assert.equal(currentRecall.hits.some((hit) => hit.id === "mem-old-release-note-style"), false, "current recall should hide superseded records by default");

const historicalRecall = await postMemory({
  action: "recall",
  vaultPath,
  query: "what did release notes used to be like before?",
  scope: "agent-memory",
  temporalMode: "auto",
  limit: 5,
});
assert.ok(historicalRecall.hits.some((hit) => hit.id === "mem-old-release-note-style"), "historical recall should include superseded history");
assert.ok(historicalRecall.hits.find((hit) => hit.id === "mem-old-release-note-style")?.scoreDetails?.temporal, "historical hit should include temporal score details");

const asOfRecall = await postMemory({
  action: "recall",
  vaultPath,
  query: "release note style as of 2026-01-15",
  scope: "agent-memory",
  temporalMode: "as-of",
  asOf: "2026-01-15T12:00:00.000Z",
  limit: 5,
});
assert.ok(asOfRecall.hits.some((hit) => hit.id === "mem-old-release-note-style"), "as-of recall should include records visible at the date");
assert.equal(asOfRecall.hits.some((hit) => hit.id === "mem-new-release-note-style"), false, "as-of recall should exclude records created after the date");

await postMemory({
  action: "record-usage",
  vaultPath,
  memoryIds: [aliasWrite.record.id],
  usageType: "final-answer",
  query: "GitLawb",
  usageContext: "integration-test",
});
const usageRecall = await postMemory({
  action: "recall",
  vaultPath,
  query: "GitLawb",
  scope: "agent-memory",
  limit: 3,
});
const usageHit = usageRecall.hits.find((hit) => hit.id === aliasWrite.record.id);
assert.equal(usageHit?.usage?.finalAnswerCount, 1, "record-usage should surface final-answer count");
assert.ok((usageHit?.scoreDetails?.usage ?? 0) > 0, "usage should gently contribute to score details");
const generationList = await postMemory({ action: "list-generations", vaultPath });
assert.equal(generationList.coverage?.policy?.maxGenerations, 256, "generation API should expose the active retention bound");
assert.equal(generationList.coverage?.completeHistory, true, "a new vault should report complete replay history");
const health = await postMemory({ action: "health", vaultPath });
assert.equal(health.indexes?.generations?.replayCoverage?.policy?.checkpointInterval, 32, "health API should expose checkpoint cadence");

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  vaultPath,
  assertions: {
    rememberEntities: true,
    aliasRecall: true,
    operationalMemorySeparation: true,
    temporalCurrentHistoricalAsOf: true,
    usageTelemetry: true,
    scoreDetails: true,
    replayCoverage: true,
  },
}, null, 2));
