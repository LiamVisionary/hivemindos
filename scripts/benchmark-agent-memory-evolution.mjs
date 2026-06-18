import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const tmp = await mkdtemp(join(tmpdir(), "hivemindos-memory-evolution-"));
const vault = join(tmp, "vault");
const indexPath = join(vault, "Operations", "Brain Services", "Agent Memory Index.jsonl");

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

const oldRecord = {
  timestamp: "2026-06-14T10:00:00.000Z",
  action: "remember",
  id: "mem-old-release-notes",
  memoryType: "preference",
  title: "Release note style",
  content: "Liam used to accept long release notes with broad implementation detail.",
  status: "superseded",
  cognitiveStage: "system1",
  supersededBy: ["mem-new-release-notes"],
  notePath: "Memory/Distillations/Agent Memory/preference/2026-06-14-release-note-style-old.md",
  confidence: 0.82,
  tags: ["release-notes", "writing"],
  createdAt: "2026-06-14T10:00:00.000Z",
  updatedAt: "2026-06-14T10:05:00.000Z",
};

const newRecord = {
  timestamp: "2026-06-14T10:05:00.000Z",
  action: "remember",
  id: "mem-new-release-notes",
  memoryType: "preference",
  title: "Release note style",
  content: "Liam prefers concise release notes that keep user-facing behavior first and implementation detail secondary.",
  status: "active",
  cognitiveStage: "system2",
  supersedes: ["mem-old-release-notes"],
  evolutionRootId: "mem-old-release-notes",
  evolutionType: "override",
  evolutionReason: "User clarified that release notes should be concise and user-facing.",
  notePath: "Memory/Distillations/Agent Memory/preference/2026-06-14-release-note-style-new.md",
  confidence: 0.9,
  tags: ["release-notes", "writing", "evolved"],
  metaTags: ["recently_changed"],
  createdAt: "2026-06-14T10:05:00.000Z",
  updatedAt: "2026-06-14T10:05:00.000Z",
};

await write(indexPath, `${JSON.stringify(oldRecord)}\n${JSON.stringify(newRecord)}\n`);

const queries = [
  "release notes concise user-facing",
  "writing release notes implementation detail",
  "Liam release notes style",
];

const timings = [];
for (const query of queries) {
  const started = performance.now();
  const result = spawnSync("node", [
    "scripts/hive-brain",
    "answer",
    query,
    "--no-api",
    "--vault",
    vault,
    "--scope",
    "agent-memory",
    "--limit",
    "3",
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
  timings.push(performance.now() - started);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Release note style/);
  assert.match(result.stdout, /evolved 2 versions/);
  assert.match(result.stdout, /Latest: Release note style \(active; stage: system2; reason: User clarified/);
  assert.match(result.stdout, /Previous 1: Release note style \(superseded; stage: system1/);
  assert.match(result.stdout, /concise release notes/);
}

const sorted = [...timings].sort((left, right) => left - right);
const median = sorted[Math.floor(sorted.length / 2)];

for (const [path, tokens] of [
  ["src/lib/services/obsidian/agent-memory.ts", [
    "agent-memory/core",
  ]],
  ["src/lib/services/obsidian/agent-memory/core.ts", [
    "evolveAgentMemory",
    "supersedes",
    "supersededBy",
    "evolutionChain",
    "cognitiveStage",
    "traceEvolutionChain",
  ]],
  ["src/app/api/brain/memory/route.ts", ["\"remember-action\"", "\"record-usage\"", "\"evolve\""]],
  ["scripts/hive-brain", ["hive-brain evolve", "formatEvolutionChain"]],
  ["src/lib/services/context-index.ts", ["action: 'evolve'"]],
]) {
  const content = await import("node:fs/promises").then((fs) => fs.readFile(join(root, path), "utf8"));
  for (const token of tokens) assert.ok(content.includes(token), `${path} should contain ${token}`);
}

console.log(JSON.stringify({
  ok: true,
  fixture: "agent-memory-evolution",
  queries: queries.length,
  medianMs: Math.round(median * 100) / 100,
  vault,
}, null, 2));
