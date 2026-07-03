#!/usr/bin/env node
// Hermetic coverage for company task dedup — the fix that stops the autonomy
// driver from re-dispatching the SAME work every 30-min cycle (the churn that
// produced ~80 deliverables from one goal). Near-identical planner titles get
// dropped against recent + in-flight work; genuinely different tasks survive
// (dedup is biased to precision so it never stalls a company by dropping new work).
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { normalizeTaskTitle, titlesSimilar, dedupeDrafts } = await import(
  "../src/lib/services/company-task-dedup.ts"
);

// ── normalization: dates + task-hash tails + punctuation drop out ────────────
assert.equal(normalizeTaskTitle("Audit demo sites 2026-07-02"), "audit demo sites");
assert.equal(normalizeTaskTitle("Follow-up  with   non-responders"), "follow up with non responders");

// ── similarity: near-duplicates match, distinct work does not ────────────────
assert.equal(titlesSimilar("Research Sarasota leads", "Research Sarasota business leads"), true, "adding one word is still the same task");
assert.equal(titlesSimilar("Audit demo sites 2026-07-02", "Audit demo sites"), true, "a trailing date doesn't make it a new task");
assert.equal(titlesSimilar("Research Sarasota leads", "Update Sarasota leads tracker"), false, "different verb + object = different work");
assert.equal(titlesSimilar("Deploy Stripe payment rail", "Research Sarasota leads"), false);

// ── dedupe against recent/in-flight titles ───────────────────────────────────
{
  const drafts = [
    { title: "Research Sarasota business leads" }, // ~ existing "Research Sarasota leads"
    { title: "Deploy Stripe payment rail" },       // new
    { title: "QA the demo sites" },                // new
  ];
  const existing = ["Research Sarasota leads", "Publish Ginza preview"];
  const { fresh, dropped } = dedupeDrafts(drafts, existing);
  assert.equal(fresh.length, 2, "only the two genuinely-new tasks survive");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].matched, "Research Sarasota leads");
  assert.deepEqual(fresh.map((d) => d.title), ["Deploy Stripe payment rail", "QA the demo sites"]);
}

// ── dedupe drafts against EACH OTHER within one batch ────────────────────────
{
  const drafts = [
    { title: "Research Sarasota leads" },
    { title: "Research Sarasota leads again" }, // ~ the first draft
    { title: "Book kickoff calls with responders" },
  ];
  const { fresh, dropped } = dedupeDrafts(drafts, []);
  assert.equal(fresh.length, 2, "the near-duplicate second draft is dropped even with no prior board work");
  assert.equal(dropped.length, 1);
}

// ── nothing to compare against → everything is fresh ─────────────────────────
{
  const drafts = [{ title: "A" }, { title: "B" }, { title: "C" }];
  const { fresh, dropped } = dedupeDrafts(drafts, []);
  assert.equal(fresh.length, 3);
  assert.equal(dropped.length, 0);
}

console.log("company task dedup suite passed");
process.exit(0);
