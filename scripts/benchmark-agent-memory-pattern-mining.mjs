import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { mineOperationalPatterns } = await import(
  "../src/lib/services/obsidian/agent-memory/pattern-mining.ts"
);

const DAY = 86_400_000;
const start = Date.parse("2026-01-01T09:00:00.000Z");
let sequence = 0;

function event(overrides = {}) {
  sequence += 1;
  return {
    id: `evt-${sequence}`,
    title: `Unique operation ${sequence}`,
    summary: `Completed unique operation ${sequence}.`,
    operationKey: `unique/${sequence}`,
    occurredAt: new Date(start + sequence * 31_337_000).toISOString(),
    outcome: "success",
    taskId: `task-${sequence}`,
    source: "benchmark",
    ...overrides,
  };
}

const events = [];

// Positive 1: recurring provider failure across distinct tasks.
for (let index = 0; index < 5; index += 1) {
  events.push(event({
    title: `Provider request ${index + 1} failed`,
    summary: `Provider returned HTTP 429 rate limit for request req-${index + 100}.`,
    operationKey: "provider/image-generation",
    failureKey: "provider/rate-limit",
    outcome: "failure",
    taskId: `provider-task-${index}`,
    occurredAt: new Date(start + index * 2.3 * DAY).toISOString(),
  }));
}

// Positive 2: useful repeated workflow without a stable cadence.
for (let index = 0; index < 4; index += 1) {
  events.push(event({
    title: "Publish Base ecosystem brief",
    summary: `Published brief edition ${index + 1}.`,
    operationKey: "content/base-ecosystem-brief",
    taskId: `brief-task-${index}`,
    occurredAt: new Date(start + [0, 2, 9, 21][index] * DAY).toISOString(),
  }));
}

// Positive 3: stable weekly routine; should become a job proposal rather than
// a duplicate repeated-operation proposal.
for (let index = 0; index < 5; index += 1) {
  events.push(event({
    title: "Prepare weekly customer success report",
    summary: `Prepared weekly report ${index + 1}.`,
    operationKey: "reporting/customer-success-weekly",
    taskId: `report-task-${index}`,
    occurredAt: new Date(start + index * 7 * DAY).toISOString(),
  }));
}

// Negative: five retries of the same task do not establish a cross-task pattern.
for (let index = 0; index < 5; index += 1) {
  events.push(event({
    title: "Retry one flaky task",
    summary: "Connection reset by peer.",
    operationKey: "retry/flaky-task",
    failureKey: "network/connection-reset",
    outcome: "failure",
    taskId: "one-flaky-task",
  }));
}

// Negative: repeated test and E2E activity is operational noise, not learning.
for (let index = 0; index < 6; index += 1) {
  events.push(event({
    title: "Queen Bee E2E loop evaluation",
    summary: `E2E fixture run ${index + 1}.`,
    operationKey: "test/queen-bee-e2e",
    taskId: `e2e-${index}`,
    tags: ["test", "e2e"],
  }));
}

// Negative: below the minimum support threshold.
for (let index = 0; index < 2; index += 1) {
  events.push(event({
    title: "Occasional legal review",
    operationKey: "legal/occasional-review",
    taskId: `legal-${index}`,
  }));
}

// Negative: repeated attempts with no confirmed outcome are not reusable
// success evidence.
for (let index = 0; index < 4; index += 1) {
  events.push(event({
    title: "Attempt pending data export",
    operationKey: "export/pending-data",
    outcome: "unknown",
    taskId: `pending-export-${index}`,
  }));
}

for (let index = 0; index < 16; index += 1) events.push(event());

const expected = new Set([
  "recurring-failure:provider/rate-limit",
  "repeated-operation:content/base-ecosystem-brief",
  "temporal-routine:reporting/customer-success-weekly",
]);

const result = mineOperationalPatterns(events, {
  minDistinctTasks: 3,
  minRoutineOccurrences: 4,
});
const actual = new Set(result.candidates.map((candidate) => candidate.key));
const truePositive = [...actual].filter((key) => expected.has(key)).length;
const precision = actual.size ? truePositive / actual.size : 0;
const recall = expected.size ? truePositive / expected.size : 0;

console.log(JSON.stringify({
  corpusEvents: events.length,
  expected: [...expected],
  actual: [...actual],
  precision,
  recall,
  candidates: result.candidates,
}, null, 2));

assert.ok(precision >= 0.9, `precision ${precision.toFixed(3)} is below the 0.900 enablement gate`);
assert.ok(recall >= 0.8, `recall ${recall.toFixed(3)} is below the 0.800 enablement gate`);
assert.deepEqual(actual, expected, "the benchmark corpus should produce only the labeled useful patterns");

console.log("Agent Memory pattern-mining benchmark passed its enablement gate.");
