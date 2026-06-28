#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  createAgentChallenge,
  distillAgentChallengePlaybook,
  getAgentChallenge,
  postAgentChallengeEntry,
  readAgentChallengesState,
  recordAgentChallengeResult,
  recordAgentChallengeRuling,
} = await import("../src/lib/services/agent-challenges.ts");
const { listHiveActions, listMcpHiveActions } = await import("../src/lib/services/hive-actions/index.ts");
const { searchContextIndex } = await import("../src/lib/services/context-index.ts");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-agent-challenges-"));
const options = { vaultPath };

try {
  const created = await createAgentChallenge({
    title: "Gemma-style inference sprint",
    objective: "Improve a bounded benchmark while keeping every claim public and verifiable.",
    metricName: "TPS",
    metricDirection: "increase",
    baselineScore: 100,
    significanceThreshold: 4,
    dailyRunCap: 1,
    workBoard: "inference",
    createdByName: "Queen Bee",
    createdAt: "2026-06-28T00:00:00.000Z",
  }, options);

  assert.equal(created.storage.kind, "vault", "writable vault fixture should be used");
  assert.match(created.storage.path, /Operations\/Work Board\/Agent Challenges\/challenges\.json$/);
  assert.equal(created.summary.frontier.length, 0, "new challenge starts without frontier");

  const privateAttempt = await postAgentChallengeEntry({
    challengeId: created.challenge.id,
    type: "candidate",
    authorName: "agent-a",
    body: "Move this run to a private chat.",
    visibility: "private",
    createdAt: "2026-06-28T00:01:00.000Z",
  }, options);
  assert.equal(privateAttempt.entry.type, "integrity-alert", "private side-channel request is converted into an integrity alert");
  assert.equal(privateAttempt.entry.visibility, "public", "all challenge board entries stay public inside the challenge");
  assert.equal(privateAttempt.summary.totals.integrityAlerts, 1);

  const first = await recordAgentChallengeResult({
    challengeId: created.challenge.id,
    title: "int4 candidate",
    score: 118,
    originatorName: "spec-agent",
    runnerName: "gpu-agent-a",
    verifierName: "qa-agent",
    evidence: ["benchmark run 1"],
    createdAt: "2026-06-28T01:00:00.000Z",
  }, options);
  assert.equal(first.summary.bestScore, 118);
  assert.equal(first.summary.frontier.length, 1);

  await assert.rejects(
    () => recordAgentChallengeResult({
      challengeId: created.challenge.id,
      title: "same runner second run",
      score: 119,
      originatorName: "spec-agent",
      runnerName: "gpu-agent-a",
      createdAt: "2026-06-28T02:00:00.000Z",
    }, options),
    /Daily run cap reached/,
    "daily run cap should force quota pooling",
  );

  const second = await recordAgentChallengeResult({
    challengeId: created.challenge.id,
    title: "speculative decoding candidate",
    score: 121,
    originatorName: "spec-agent",
    runnerName: "gpu-agent-b",
    verifierName: "qa-agent",
    evidence: ["benchmark run 2"],
    createdAt: "2026-06-28T02:05:00.000Z",
  }, options);
  assert.deepEqual(second.summary.frontier.map((item) => item.score).sort((a, b) => a - b), [118, 121], "deltas inside significance threshold are ties");
  assert.ok(second.summary.leaderboard.some((row) => row.agent.name === "spec-agent" && row.frontierResults === 2), "originator credit survives runner split");

  const ruling = await recordAgentChallengeRuling({
    challengeId: created.challenge.id,
    kind: "invalid",
    targetLineageId: first.result.id,
    decidedByName: "human organizer",
    summary: "Invalidated after verifier found a benchmark loophole.",
    createdAt: "2026-06-28T03:00:00.000Z",
  }, options);
  assert.equal(ruling.challenge.lineage.find((node) => node.id === first.result.id)?.status, "invalid");
  assert.deepEqual(ruling.summary.frontier.map((item) => item.id), [second.result.id], "invalidated nodes leave the frontier");

  const playbook = await distillAgentChallengePlaybook({
    challengeId: created.challenge.id,
    levers: ["Stage candidates for whoever has quota."],
    antiPatterns: ["Do not treat one-run frontier deltas under the significance threshold as wins."],
    triageTools: ["Shared benchmark checklist"],
    verifierNotes: ["PPL-only verification can miss decode divergence."],
    authorName: "scribe-agent",
    createdAt: "2026-06-28T04:00:00.000Z",
  }, options);
  assert.equal(playbook.playbook.levers.length, 1);
  assert.equal(playbook.summary.totals.antiPatterns, 1);

  const readBack = await getAgentChallenge(created.challenge.id, options);
  assert.equal(readBack.challenge.board.length, 5, "entries preserve integrity alert, two results, ruling, and playbook update");

  const state = await readAgentChallengesState(options);
  assert.equal(state.summaries.length, 1);

  const action = listHiveActions().find((item) => item.id === "agent-challenge.arena");
  assert.ok(action, "agent challenge Hive action should be registered");
  const mcpTools = new Map(listMcpHiveActions(listHiveActions()).map((tool) => [tool.name, tool]));
  assert.equal(mcpTools.get("agent_challenge")?.annotations.destructiveHint, true, "agent_challenge writes local state");

  const context = await searchContextIndex({
    query: "agent challenge public board quota lineage significance frontier",
    kinds: ["tool-schema"],
    limit: 40,
  });
  assert.ok(context.items.some((item) => item.id === "hive-action:agent-challenge.arena"), "context index should retrieve the challenge arena tool");

  console.log("agent challenge tests passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}
