#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  normalizeHostedMediaAction,
  normalizeHostedMediaGenerateInput,
  normalizeHostedMediaJobId,
  normalizeHostedMediaQuoteInput,
} from "../src/lib/services/hosted-media-generation-domain.ts";

assert.equal(normalizeHostedMediaAction({ action: "generate" }), "generate");
assert.equal(normalizeHostedMediaAction({ action: "job" }), "job");
assert.throws(() => normalizeHostedMediaAction({ action: "delete" }), /action/i);

assert.deepEqual(normalizeHostedMediaQuoteInput({
  model: "veo3-fast",
  input: { prompt: "A product rotates against a clean background.", duration: 8 },
}), {
  model: "veo3-fast",
  input: { prompt: "A product rotates against a clean background.", duration: 8 },
});
assert.throws(() => normalizeHostedMediaQuoteInput({ model: "../account/balance", input: { prompt: "x" } }), /model/i);
assert.throws(() => normalizeHostedMediaQuoteInput({ model: "veo3-fast", input: [] }), /input/i);

assert.deepEqual(normalizeHostedMediaGenerateInput({
  model: "veo3-fast",
  input: { prompt: "A product rotates." },
  agentId: "company-media-agent",
  maximumDebitUsd: 0.5,
  idempotencyKey: "campaign-42-scene-1",
  approvalToken: "approval-1",
  confirmation: "CONFIRM_HOSTED_MEDIA_GENERATION",
}), {
  model: "veo3-fast",
  input: { prompt: "A product rotates." },
  agentId: "company-media-agent",
  maximumDebitUsd: 0.5,
  idempotencyKey: "campaign-42-scene-1",
  approvalToken: "approval-1",
  confirmation: "CONFIRM_HOSTED_MEDIA_GENERATION",
});
assert.throws(() => normalizeHostedMediaGenerateInput({ model: "veo3-fast", input: { prompt: "x" }, agentId: "a", maximumDebitUsd: 26, idempotencyKey: "job" }), /maximum debit/i);
assert.throws(() => normalizeHostedMediaGenerateInput({ model: "veo3-fast", input: { prompt: "x" }, agentId: "", maximumDebitUsd: 1, idempotencyKey: "job" }), /agent/i);
assert.equal(normalizeHostedMediaJobId("media_12345678"), "media_12345678");
assert.throws(() => normalizeHostedMediaJobId("../../secret"), /job/i);

console.log("Hosted media generation domain checks passed.");
