import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
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
const label = process.argv.find((arg) => arg.startsWith("--label="))?.slice("--label=".length) || "agent-memory-api";
const iterations = Number(process.argv.find((arg) => arg.startsWith("--iterations="))?.slice("--iterations=".length) || 12);

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

async function recall(vaultPath, query, options = {}) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/brain/memory`, {
    method: "POST",
    headers: dashboardHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      action: "recall",
      vaultPath,
      query,
      scope: "agent-memory",
      limit: 5,
      ...options,
    }),
  });
  const elapsedMs = performance.now() - started;
  const data = await response.json().catch(() => null);
  return {
    ok: response.ok && data?.ok === true,
    elapsedMs,
    status: response.status,
    error: data?.error,
    hits: data?.hits || [],
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
}

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-agent-memory-api-behavior-"));
const vaultPath = join(tmp, "vault");
const indexPath = join(vaultPath, "Operations", "Brain Services", "Agent Memory Index.jsonl");
const retrievalsPath = join(vaultPath, "Operations", "Brain Services", "Agent Memory Retrievals.jsonl");

const records = [
  {
    id: "mem-entity-queen",
    memoryType: "context",
    title: "Coordinator identity",
    content: "The central coordinator owns leases, receipts, dedupe, and work routing.",
    status: "active",
    notePath: "Memory/Distillations/Agent Memory/context/queen.md",
    confidence: 0.9,
    tags: ["routing"],
    entities: ["Queen Bee"],
    aliases: ["QB"],
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
  {
    id: "mem-alias-gitlawb",
    memoryType: "fact",
    title: "Code Proof ledger",
    content: "The proof ledger records code provenance receipts.",
    status: "active",
    notePath: "Memory/Distillations/Agent Memory/fact/code-proof.md",
    confidence: 0.9,
    tags: ["proof"],
    entities: ["Code Proof"],
    aliases: ["GitLawb"],
    createdAt: "2026-03-02T00:00:00.000Z",
    updatedAt: "2026-03-02T00:00:00.000Z",
  },
  {
    id: "mem-old-release",
    memoryType: "preference",
    title: "Release note style old",
    content: "Liam used to accept long release notes with detailed implementation narration.",
    status: "superseded",
    notePath: "Memory/Distillations/Agent Memory/preference/release-old.md",
    confidence: 0.82,
    tags: ["release-notes"],
    supersededBy: ["mem-new-release"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "mem-new-release",
    memoryType: "preference",
    title: "Release note style new",
    content: "Liam prefers concise release notes with user-facing behavior first.",
    status: "active",
    notePath: "Memory/Distillations/Agent Memory/preference/release-new.md",
    confidence: 0.92,
    tags: ["release-notes", "evolved"],
    supersedes: ["mem-old-release"],
    evolutionRootId: "mem-old-release",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "mem-usage-preferred",
    memoryType: "fact",
    title: "Proof ledger canonical path",
    content: "Proof ledger notes should be treated as the canonical receipt path for recurring provenance questions.",
    status: "active",
    notePath: "Memory/Distillations/Agent Memory/fact/proof-ledger-canonical.md",
    confidence: 0.86,
    tags: ["ledger"],
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-03T00:00:00.000Z",
  },
  {
    id: "mem-usage-decoy",
    memoryType: "fact",
    title: "Proof ledger alternate path",
    content: "Proof ledger notes may mention an alternate path for older migrations.",
    status: "active",
    notePath: "Memory/Distillations/Agent Memory/fact/proof-ledger-decoy.md",
    confidence: 0.86,
    tags: ["ledger"],
    createdAt: "2026-03-04T00:00:00.000Z",
    updatedAt: "2026-03-04T00:00:00.000Z",
  },
  {
    id: "mem-action-handoff",
    memoryType: "action",
    title: "Handoff receipt",
    content: "Assistant handed task queen-123 to Hermes and verified the transfer receipt.",
    status: "active",
    notePath: "Memory/Distillations/Agent Memory/action/handoff.md",
    confidence: 0.9,
    tags: ["action", "handoff"],
    actorRole: "assistant",
    memoryOrigin: "assistant-action",
    entities: ["Hermes", "Queen Bee"],
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
  },
];

await write(indexPath, records.map((record) => JSON.stringify({ action: "remember", timestamp: record.updatedAt, ...record })).join("\n") + "\n");
await write(retrievalsPath, [
  ...Array.from({ length: 6 }, (_, index) => JSON.stringify({
    timestamp: `2026-03-06T00:00:0${index}.000Z`,
    schema: "hivemindos.agent-memory-retrieval.v1",
    memoryId: "mem-usage-preferred",
    usageType: "retrieved",
    query: "proof ledger",
    usageContext: "benchmark",
  })),
  JSON.stringify({
    timestamp: "2026-03-06T00:01:00.000Z",
    schema: "hivemindos.agent-memory-retrieval.v1",
    memoryId: "mem-usage-preferred",
    usageType: "final-answer",
    query: "proof ledger",
    usageContext: "benchmark",
  }),
].join("\n") + "\n");

const cases = [
  { name: "entity-alias", query: "QB", expected: "mem-entity-queen" },
  { name: "alias", query: "GitLawb", expected: "mem-alias-gitlawb" },
  { name: "temporal-history", query: "what did release notes used to be like before?", expected: "mem-old-release", options: { temporalMode: "historical" } },
  { name: "current-chain-head", query: "release notes style", expected: "mem-new-release" },
  { name: "usage-boost", query: "proof ledger", expected: "mem-usage-preferred" },
  { name: "action", query: "handoff receipt Hermes", expected: "mem-action-handoff" },
];

const times = [];
const results = [];
for (let iteration = 0; iteration < iterations; iteration += 1) {
  for (const testCase of cases) {
    const result = await recall(vaultPath, testCase.query, testCase.options);
    times.push(result.elapsedMs);
    if (iteration === 0) {
      results.push({
        name: testCase.name,
        expected: testCase.expected,
        ok: result.ok,
        status: result.status,
        error: result.error,
        top: result.hits[0]?.id || null,
        correct: result.hits[0]?.id === testCase.expected,
        scoreDetails: result.hits[0]?.scoreDetails || null,
      });
    }
  }
}

assert.ok(times.length > 0, "benchmark should record timings");
const correct = results.filter((result) => result.correct).length;

console.log(JSON.stringify({
  ok: true,
  label,
  baseUrl,
  iterations,
  cases: cases.length,
  top1: `${correct}/${cases.length}`,
  p50Ms: Math.round(percentile(times, 0.5) * 100) / 100,
  p95Ms: Math.round(percentile(times, 0.95) * 100) / 100,
  results,
  vaultPath,
}, null, 2));
