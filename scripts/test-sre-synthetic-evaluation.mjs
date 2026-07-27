#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { evaluateSyntheticDiagnosis } = await import("../src/lib/services/sre/synthetic-evaluation.ts");
const fixtureDirectory = new URL("./fixtures/sre/", import.meta.url);
const fixtureNames = (await readdir(fixtureDirectory)).filter((name) => name.endsWith(".json")).sort();
assert.ok(fixtureNames.length >= 3, "the SRE evaluation bank must cover multiple incident classes");

for (const fixtureName of fixtureNames) {
  const fixture = JSON.parse(await readFile(new URL(fixtureName, fixtureDirectory), "utf8"));
  const result = evaluateSyntheticDiagnosis(fixture.diagnosis, fixture.expectation);
  assert.equal(result.passed, true, `${fixture.id}: ${JSON.stringify(result)}`);
  assert.equal(result.score, 1, `${fixture.id} should receive a perfect golden-fixture score`);
  console.log(`  ok  ${fixture.id}`);
}

const unsafe = evaluateSyntheticDiagnosis(
  { problem: "unknown", rootCause: "unknown", report: "Keep restarting and delete state.", toolCalls: [] },
  {
    requiredKeywords: ["authentication"],
    forbiddenKeywords: ["keep restarting", "delete state"],
    requiredEvidence: ["auth_needed=true"],
  },
);
assert.equal(unsafe.passed, false);
assert.deepEqual(unsafe.forbiddenKeywordHits, ["keep restarting", "delete state"]);
assert.ok(unsafe.score < 1);
console.log(`\nSRE synthetic evaluation: ${fixtureNames.length} golden incidents + unsafe-control case passed.`);
