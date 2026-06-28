import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await mkdtemp(join(tmpdir(), "hivemindos-recall-quality-"));
const vault = join(tmp, "vault");
const args = parseArgs();

function parseArgs() {
  const parsed = { minScore: null };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--min-score") parsed.minScore = Number(argv[++index]);
  }
  return parsed;
}

async function writeNote(path, body) {
  const file = join(vault, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, "utf8");
}

function runHiveBrain(query, limit = 5) {
  const result = spawnSync("node", [
    "scripts/hive-brain",
    "recall",
    query,
    "--no-api",
    "--vault",
    vault,
    "--scope",
    "full-vault",
    "--limit",
    String(limit),
    "--json",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function logTask(taskId, score, summary, extras = {}) {
  const tracesDir = process.env.EVO_TRACES_DIR;
  if (!tracesDir) return;
  await mkdir(tracesDir, { recursive: true });
  await writeFile(join(tracesDir, `task_${taskId}.json`), JSON.stringify({
    experiment_id: process.env.EVO_EXPERIMENT_ID || "unknown",
    task_id: taskId,
    score,
    status: score >= 1 ? "passed" : "failed",
    summary,
    ended_at: new Date().toISOString(),
    ...extras,
  }, null, 2), "utf8");
}

async function writeResult(result) {
  const payload = JSON.stringify(result, null, 2);
  const resultPath = process.env.EVO_RESULT_PATH;
  if (!resultPath) {
    console.log("Hive brain recall quality checks passed.");
    return;
  }
  await mkdir(dirname(resultPath), { recursive: true });
  const handle = await open(resultPath, "wx");
  await handle.close();
  await writeFile(`${resultPath}.tmp`, payload, "utf8");
  await rename(`${resultPath}.tmp`, resultPath);
}

const largeBody = `${"Bankr Platform Documentation wallet API token trading transfers portfolio balances. ".repeat(20)}

${"generic imported platform api token notes with no Bankr wallet trading source. ".repeat(5000)}
`;

await writeNote("Memory/Imported Sources/Bankr Platform Documentation.md", `# Bankr Platform Documentation

${largeBody}`);

await writeNote("Projects/Agent Calls - BYOK vs HivemindOS Cloud.md", `# Agent Calls - BYOK vs HivemindOS Cloud

BYOK agent calls compare local user provider keys with a HivemindOS Cloud relay for native AI coding app calls.`);

await writeNote("Memory/Imported Agent Memory/hermes/hermes-agent-AGENTS.md", `# Hermes Agent - Development Guide

${"platform api token development guide tools agents runtime configuration. ".repeat(800)}`);

await writeNote("Skills/bankr/SKILL.md", `# Bankr

Bankr wallet API token trading skill instructions for agents.`);

await writeNote("Skills/hive-brain-compiled-wiki/SKILL.md", `# Hive Brain Compiled Wiki

Use brain_search_knowledge, brain_get_node, brain_get_backlinks, and brain_graph_overview before broad full-vault recall for compiled wiki topics.`);

await writeNote("Operations/Brain Services/Queen Bee/Routing Policy.md", `# Queen Bee Routing Policy

Queen Bee chooses the best available routing policy from Fleet, Work Board, and safety state.`);

await writeNote("Operations/Brain Services/Obsidian Native Brain Pack.md", `# Obsidian Native Brain Pack

Seeds obsidian-markdown, obsidian-bases, json-canvas, and Bases/Canvas views for human-readable vault work.`);

await writeNote("Operations/Secure/Secure Hermes Env Sync.md", `# Secure Hermes Env Sync

Tracks encrypted backup references for Hermes env sync and credential status names without plaintext secrets.`);

await writeNote("Intake/Crypto token watchlist ideas.md", `# Crypto token watchlist ideas

Token watchlist candidates, alerts, market narratives, and trading ideas for later review.`);

const cases = [
  {
    id: "project-decision",
    query: "collection:projects BYOK Agent Calls HivemindOS Cloud",
    expectedPath: "Projects/Agent Calls - BYOK vs HivemindOS Cloud.md",
    limit: 5,
  },
  {
    id: "large-imported-source",
    query: "path:Memory/Imported Bankr platform documentation wallet API token trading",
    expectedPath: "Memory/Imported Sources/Bankr Platform Documentation.md",
    limit: 5,
  },
  {
    id: "operations-policy",
    query: "collection:operations Queen Bee control plane routing policy best available",
    expectedPath: "Operations/Brain Services/Queen Bee/Routing Policy.md",
    limit: 3,
  },
  {
    id: "shared-skill",
    query: "path:Skills/ hive-brain compiled wiki backlinks graph overview",
    expectedPath: "Skills/hive-brain-compiled-wiki/SKILL.md",
    limit: 5,
  },
  {
    id: "brain-service-note",
    query: "collection:operations Obsidian Native Brain Pack bases canvas",
    expectedPath: "Operations/Brain Services/Obsidian Native Brain Pack.md",
    limit: 5,
  },
  {
    id: "secure-reference",
    query: "collection:operations secure hermes env sync encrypted backup references",
    expectedPath: "Operations/Secure/Secure Hermes Env Sync.md",
    limit: 5,
  },
  {
    id: "crypto-intake",
    query: "collection:intake crypto token watchlist ideas",
    expectedPath: "Intake/Crypto token watchlist ideas.md",
    limit: 5,
  },
];

const tasks = {};
const details = [];
for (const test of cases) {
  const result = runHiveBrain(test.query, test.limit);
  const rank = result.hits.findIndex((hit) => hit.notePath === test.expectedPath) + 1;
  const score = rank === 1 ? 1 : rank > 0 && rank <= 3 ? 0.5 : 0;
  tasks[test.id] = score;
  details.push({
    id: test.id,
    query: test.query,
    expectedPath: test.expectedPath,
    rank: rank || null,
    topPath: result.hits[0]?.notePath ?? null,
  });
  await logTask(test.id, score, rank === 1 ? `Top-1: ${test.expectedPath}` : `Expected ${test.expectedPath}, top was ${result.hits[0]?.notePath ?? "none"}`, {
    expectedPath: test.expectedPath,
    topPath: result.hits[0]?.notePath ?? null,
    rank: rank || null,
  });
}

const score = Object.values(tasks).reduce((sum, value) => sum + value, 0) / cases.length;
if (args.minScore !== null && score < args.minScore) {
  console.error(`Hive brain recall quality score ${score.toFixed(4)} below minimum ${args.minScore}.`);
  console.error(JSON.stringify(details, null, 2));
  process.exit(1);
}
if (!process.env.EVO_RESULT_PATH) {
  for (const detail of details) assert.equal(detail.rank, 1, `${detail.id} should return ${detail.expectedPath} as Top-1.`);
}
await writeResult({
  score,
  tasks,
  details,
  started_at: new Date().toISOString(),
  ended_at: new Date().toISOString(),
});
