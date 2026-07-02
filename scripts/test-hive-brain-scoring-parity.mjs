// Parity contract between the app scorer (src/lib/services/obsidian/
// agent-memory/scoring.ts) and the CLI local-fallback scorer
// (scripts/lib/hive-brain-scoring.mjs). The CLI mirrors the app so recall
// quality does not silently degrade when the app API is down — this test
// fails when the two drift.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const app = await import("../src/lib/services/obsidian/agent-memory/scoring.ts");
const appQuery = await import("../src/lib/services/obsidian/agent-memory/query.ts");
const cli = await import("./lib/hive-brain-scoring.mjs");

const now = Date.now();
const day = 86_400_000;

const records = [
  {
    id: "mem-a",
    type: "instruction",
    title: "Never write the Hermes gateway default model",
    content: "Model selection is agent-scoped: write model.default into the agent profile config, never into the gateway-level config file.",
    confidence: 0.7,
    status: "active",
    tags: ["hermes", "models"],
    metaTags: [],
    entities: ["Hermes", "Model Selection"],
    aliases: [],
    source: "hive-brain cli",
    project: "hivemind-os",
    createdAt: new Date(now - 2 * day).toISOString(),
    updatedAt: new Date(now - 2 * day).toISOString(),
    notePath: "Memory/Distillations/Agent Memory/instruction/never-write.md",
  },
  {
    id: "mem-b",
    type: "preference",
    title: "Liam likes pineapples",
    content: "Liam mentioned liking pineapples. Treat pineapple as a remembered fruit preference.",
    confidence: 0.9,
    status: "active",
    tags: ["preference", "fruit"],
    metaTags: [],
    entities: [],
    aliases: [],
    source: "Shared Context.md agent note",
    createdAt: new Date(now - 40 * day).toISOString(),
    updatedAt: new Date(now - 40 * day).toISOString(),
    notePath: "Memory/Distillations/Agent Memory/preference/pineapples.md",
    usage: { retrievalCount: 4, finalAnswerCount: 2 },
  },
  {
    id: "mem-c",
    type: "learning",
    title: "Vultr provisioning needs the API key allowlist",
    content: "Provisioning Vultr instances fails with 403 until the API key IP allowlist includes the caller network.",
    confidence: 0.7,
    status: "superseded",
    tags: [],
    metaTags: [],
    entities: ["Vultr"],
    aliases: [],
    createdAt: new Date(now - 200 * day).toISOString(),
    updatedAt: new Date(now - 200 * day).toISOString(),
    notePath: "Memory/Distillations/Agent Memory/learning/vultr.md",
  },
];

const queries = [
  { query: "hermes gateway default model rule" },
  { query: "what fruit does liam like" },
  { query: "hi" },
  { query: "vultr provisioning 403 allowlist", type: "learning" },
  { query: "previously how did we handle the vultr allowlist" },
  { query: "" },
  { query: `Long prompt requiring derivation. ${"Investigate the hermes gateway default model rules for agent profiles. ".repeat(8)}` },
];

let checked = 0;
for (const rawInput of queries) {
  const appDerived = appQuery.extractRecallQuery(rawInput.query);
  const cliDerived = cli.extractRecallQuery(rawInput.query);
  assert.equal(cliDerived.query, appDerived.query, `derived query drift for "${rawInput.query.slice(0, 40)}..."`);
  assert.equal(cliDerived.derived, appDerived.derived, "derived flag drift");

  const input = { ...rawInput, query: appDerived.query };
  // Fresh record copies per side: both scorers cache computed search text on
  // the record object.
  const appRecords = records.map((record) => ({ ...record }));
  const cliRecords = records.map((record) => ({ ...record }));
  const appLexical = app.bm25ScoresForRecords(appRecords, input);
  const cliLexical = cli.bm25ScoresForRecords(cliRecords, input);
  for (const record of records) {
    const appLex = appLexical.get(record.id);
    const cliLex = cliLexical.get(record.id);
    assert.equal(Boolean(appLex), Boolean(cliLex), `bm25 presence drift for ${record.id}`);
    if (appLex && cliLex) {
      assert.ok(Math.abs(appLex.score - cliLex.score) < 1e-9, `bm25 score drift for ${record.id}: ${appLex.score} vs ${cliLex.score}`);
      assert.deepEqual([...cliLex.matched].sort(), [...appLex.matched].sort(), `bm25 matched drift for ${record.id}`);
    }
  }
  for (const [index, record] of records.entries()) {
    const appScore = app.scoreAgentMemory(appRecords[index], input, appLexical.get(record.id), 0.72);
    const cliScore = cli.scoreAgentMemory(cliRecords[index], input, cliLexical.get(record.id), 0.72);
    assert.equal(cliScore.score, appScore.score, `score drift for ${record.id} on "${input.query.slice(0, 40)}": app=${appScore.score} cli=${cliScore.score}\napp=${JSON.stringify(appScore.scoreDetails)}\ncli=${JSON.stringify(cliScore.scoreDetails)}`);
    assert.deepEqual([...cliScore.matched].sort(), [...appScore.matched].sort(), `matched drift for ${record.id}`);
    assert.deepEqual(cliScore.scoreDetails, appScore.scoreDetails, `scoreDetails drift for ${record.id}`);
    checked += 1;
  }
}

// Tiering + floor constants must match too.
assert.equal(cli.AGENT_MEMORY_ANSWER_MIN_SCORE, app.AGENT_MEMORY_ANSWER_MIN_SCORE, "answer floor drift");
assert.equal(cli.SEMANTIC_MATCH_GATE, app.SEMANTIC_MATCH_GATE, "semantic gate drift");
assert.equal(cli.SEMANTIC_SCORE_WEIGHT, app.SEMANTIC_SCORE_WEIGHT, "semantic weight drift");

console.log(`Hive brain scoring parity checks passed (${checked} record/query pairs).`);
