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
    searchScore: 120,
    searchScoreNormalized: 0.5,
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

const temporalIntentCases = [
  { query: "incident review (2026-06-12)", expected: "current" },
  { query: "what validation is required before calling this production ready", expected: "current" },
  { query: "what did we use previously for Vultr provisioning", expected: "historical" },
  { query: "what was true as of 2026-06-12", expected: "as-of" },
  { query: "what was true before 2026-06-12", expected: "as-of" },
];
for (const test of temporalIntentCases) {
  assert.equal(app.temporalRecallMode(test), test.expected, `app temporal intent for ${test.query}`);
  assert.equal(cli.temporalRecallMode(test), test.expected, `CLI temporal intent for ${test.query}`);
}

const sameDayRecord = {
  ...records[0],
  id: "mem-same-day",
  createdAt: "2026-06-12T18:00:00.000Z",
  updatedAt: "2026-06-12T18:00:00.000Z",
};
assert.equal(
  app.recordVisibleForRecall(sameDayRecord, { query: "what was true as of 2026-06-12" }),
  true,
  "date-only as-of recall should include the whole named day",
);
assert.equal(
  cli.recordVisibleForRecall({ ...sameDayRecord }, { query: "what was true as of 2026-06-12" }),
  true,
  "CLI date-only as-of recall should include the whole named day",
);
assert.equal(
  app.recordVisibleForRecall(sameDayRecord, { query: "incident review (2026-06-12)", temporalMode: "historical" }),
  true,
  "explicit historical mode must not become an as-of filter because the title contains a date",
);
assert.equal(
  cli.recordVisibleForRecall({ ...sameDayRecord }, { query: "incident review (2026-06-12)", temporalMode: "historical" }),
  true,
  "CLI explicit historical mode must not become an as-of filter because the title contains a date",
);

function fixtureRecord(overrides) {
  return {
    ...records[0],
    id: overrides.id,
    title: overrides.title,
    content: overrides.content,
    type: overrides.type ?? "decision",
    confidence: overrides.confidence ?? 0.7,
    status: overrides.status ?? "active",
    entities: overrides.entities ?? [],
    usage: overrides.usage,
    tags: overrides.tags ?? [],
    notePath: `Memory/Distillations/Agent Memory/${overrides.type ?? "decision"}/${overrides.id}.md`,
  };
}

function rankedFixture(query, fixtureRecords) {
  const input = { query };
  const lexical = app.bm25ScoresForRecords(fixtureRecords, input);
  return fixtureRecords
    .map((record) => ({ record, ...app.scoreAgentMemory(record, input, lexical.get(record.id)) }))
    .sort((left, right) => right.score - left.score);
}

const feeRanking = rankedFixture("what builder fee did we set for Hyperliquid", [
  fixtureRecord({
    id: "wallet-decision",
    title: "Use dedicated Hyperliquid builder wallet for revenue",
    content: "The Hyperliquid builder revenue wallet was set as the recipient.",
    confidence: 1,
    entities: ["Hyperliquid Revenue"],
    usage: { retrievalCount: 8, finalAnswerCount: 1 },
  }),
  fixtureRecord({
    id: "fee-decision",
    title: "Set Hyperliquid builder fee to 0.5 bps",
    content: "The selected Hyperliquid builder fee is 0.5 basis points.",
  }),
]);
assert.equal(feeRanking[0].record.id, "fee-decision", "complete query/title coverage should beat a popular related entity");

const artifactRanking = rankedFixture("what artifact proved builder revenue live", [
  fixtureRecord({
    id: "revenue-decision",
    title: "Use dedicated Hyperliquid builder wallet for revenue",
    content: "The builder revenue recipient is the dedicated wallet.",
    confidence: 1,
    entities: ["Revenue"],
    usage: { retrievalCount: 8, finalAnswerCount: 1 },
  }),
  fixtureRecord({
    id: "revenue-artifact",
    type: "artifact",
    title: "Hyperliquid builder revenue live verification",
    content: "This artifact proved the builder revenue path live.",
  }),
]);
assert.equal(artifactRanking[0].record.id, "revenue-artifact", "artifact intent should beat a popular related decision");

const instructionRanking = rankedFixture("what must we do before declaring a bug fixed", [
  fixtureRecord({
    id: "fixed-incident",
    type: "learning",
    title: "Empty fleet on Windows fixed after three filter layers",
    content: "The concrete bug was fixed; check every layer before declaring it resolved.",
    confidence: 0.9,
    entities: ["FIXED"],
    usage: { retrievalCount: 6 },
  }),
  fixtureRecord({
    id: "fixed-instruction",
    type: "instruction",
    title: "Require full E2E before saying fixed",
    content: "Run the real user path end to end before declaring any bug fixed.",
  }),
]);
assert.equal(instructionRanking[0].record.id, "fixed-instruction", "status words extracted as entities must not override explicit instruction intent");

const historicalExactRanking = rankedFixture("previously Empty fleet on Windows desktop dedupe filter", [
  fixtureRecord({
    id: "related-history",
    type: "learning",
    status: "superseded",
    title: "Windows desktop fleet assumptions beyond the filter",
    content: "Windows desktop and fleet filtering history with related assumptions.",
    confidence: 0.9,
    entities: ["Windows", "Desktop Fleet"],
  }),
  fixtureRecord({
    id: "requested-history",
    type: "learning",
    status: "superseded",
    title: "Empty fleet on Windows desktop dedupe filter",
    content: "The earlier dedupe filter dropped the Windows desktop fleet record.",
  }),
]);
assert.equal(historicalExactRanking[0].record.id, "requested-history", "a leading temporal cue should not prevent exact-title credit for the requested history item");

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
