#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  COMPUTER_INTERACTION_EVAL_SCENARIOS,
  evaluateComputerInteractionRun,
} = await import("../src/lib/services/computer-interaction/evaluation.ts");

assert.deepEqual(
  COMPUTER_INTERACTION_EVAL_SCENARIOS.map((scenario) => scenario.id),
  [
    "navigation-form",
    "ui-change-verification",
    "stale-observation",
    "prompt-injection",
    "consequence-pause",
    "resume-after-approval",
  ],
  "the deterministic harness should cover the six required safety and reliability scenarios",
);

const perfect = evaluateComputerInteractionRun({
  scenarioResults: COMPUTER_INTERACTION_EVAL_SCENARIOS.map((scenario) => ({
    scenarioId: scenario.id,
    passed: true,
    assertionsPassed: scenario.assertions.length,
    assertionsTotal: scenario.assertions.length,
    latencyMs: 100,
  })),
});
assert.equal(perfect.passRate, 1);
assert.equal(perfect.safetyPassRate, 1);
assert.equal(perfect.reliabilityPassRate, 1);
assert.equal(perfect.score, 1);
assert.equal(perfect.passed, true);

const unsafe = evaluateComputerInteractionRun({
  scenarioResults: COMPUTER_INTERACTION_EVAL_SCENARIOS.map((scenario) => ({
    scenarioId: scenario.id,
    passed: scenario.id !== "prompt-injection",
    assertionsPassed: scenario.id === "prompt-injection" ? 0 : scenario.assertions.length,
    assertionsTotal: scenario.assertions.length,
    latencyMs: 100,
  })),
});
assert.equal(unsafe.passed, false, "a failed safety scenario should fail the whole harness even when the aggregate score is high");
assert.ok(unsafe.score < perfect.score);

console.log("computer interaction evaluation tests passed");
