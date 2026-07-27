#!/usr/bin/env node
// Fenced-JSON agent contracts: MARKETPLACE_REPORT and RESEARCH_RESULT parsing
// (last block wins, malformed ⇒ null so callers treat the session as "told us
// nothing"), prompt builders carry the load-bearing blocks (autonomy contract,
// standing directives, report contract), and conversation ingestion of a
// parsed report is idempotent with escalations creating decisions.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-marketplace-report-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;

const { parseMarketplaceAgentReport, parseResearchResultBlock } = await import("../src/lib/services/marketplace/marketplace-agent-report.ts");
const { buildInboxWorkPrompt, buildCreateListingPrompt, buildFullSweepPrompt, buildSyncCatalogPrompt, buildPriceResearchPrompt, directivesBlock } = await import(
  "../src/lib/services/marketplace/marketplace-agent-context.ts"
);

const account = {
  id: "facebook:primary",
  provider: "facebook",
  method: "browser-profile",
  status: "connected",
  displayName: "Liam",
  machine: { machineKey: "this-mac", machineName: "This Mac", collectorUrl: "http://127.0.0.1:8787", profileName: "marketplace-facebook" },
  autonomy: "autonomous",
  negotiation: { globalMinOfferPct: 70 },
  monitor: { baseIntervalMs: 3_600_000, ladder: [], ladderResetMs: 7_200_000 },
  locale: { description: "Sarasota, FL", globalComparison: false },
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};
const listing = {
  id: "mlst_1",
  accountId: account.id,
  origin: "drafted",
  state: "approved",
  title: "2018 Toyota Camry SE",
  description: "Clean title, 60k miles",
  priceUsd: 14_500,
  minOfferUsd: 13_000,
  photos: [{ vaultPath: "Operations/Marketplace/Photos/mlst_1/1.jpg" }],
  stateHistory: [],
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

// ── report parsing ──────────────────────────────────────────────────────────
const reportText = [
  "Worked the inbox. Contract restated below for clarity:",
  "```json MARKETPLACE_REPORT",
  '{ "conversations": [], "replies": [], "escalations": [], "sessionHealth": "ok", "note": "template" }',
  "```",
  "And the real one:",
  "```json MARKETPLACE_REPORT",
  JSON.stringify({
    conversations: [
      {
        id: "conv-9",
        listingExternalId: "999",
        listingTitle: "2018 Toyota Camry SE",
        buyerName: "Pat",
        messages: [
          { from: "buyer", text: "Would you take 10k?", at: "2026-07-18T10:00:00.000Z" },
          { from: "agent", text: "The minimum we can do is $13k.", at: "2026-07-18T10:01:00.000Z" },
          { from: "robot", text: "ignored — bad role" },
        ],
      },
      { listingTitle: "no id — dropped", buyerName: "X", messages: [] },
    ],
    replies: [{ conversationId: "conv-9", text: "The minimum we can do is $13k." }, { text: "no conversation — dropped" }],
    escalations: [
      { conversationId: "conv-9", reason: "Offer below floor", question: "Pat offered $10k against $14.5k. Decline permanently?", offerUsd: 10_000 },
      { question: "no conversation — dropped" },
    ],
    catalog: [
      { externalId: "999", title: "2018 Toyota Camry SE", priceUsd: 14_500, state: "active", url: "https://facebook.com/marketplace/item/999" },
      { title: "no external id — dropped", state: "active" },
    ],
    sessionHealth: "ok",
  }),
  "```",
].join("\n");
const report = parseMarketplaceAgentReport(reportText);
assert.ok(report, "report parsed");
assert.equal(report.note, undefined, "LAST fenced block wins");
assert.equal(report.conversations.length, 1, "conversation without id dropped");
assert.equal(report.conversations[0].messages.length, 2, "bad-role message dropped");
assert.equal(report.replies.length, 1);
assert.equal(report.escalations.length, 1);
assert.equal(report.escalations[0].offerUsd, 10_000);
assert.equal(report.catalog.length, 1);
assert.equal(parseMarketplaceAgentReport("no fenced block here"), null, "absent block ⇒ null (session told us nothing)");
assert.equal(parseMarketplaceAgentReport("```json MARKETPLACE_REPORT\n{ not json\n```"), null, "malformed JSON ⇒ null");
assert.equal(parseMarketplaceAgentReport("```json MARKETPLACE_REPORT\n{ \"sessionHealth\": \"weird\" }\n```").sessionHealth, "error", "unknown health degrades to error");

// ── research result parsing ─────────────────────────────────────────────────
const researchText = [
  "Found comps.",
  "```json RESEARCH_RESULT",
  JSON.stringify({
    suggestedPriceUsd: 14_200,
    priceRangeUsd: [12_900, 15_400],
    comps: [
      { title: "2018 Camry SE 55k", priceUsd: 14_800, source: "facebook", url: "https://example.com/1" },
      { title: "bad comp", priceUsd: -5, source: "x" },
    ],
    confidence: "high",
    rationale: "Local comps cluster 13-15k.",
  }),
  "```",
].join("\n");
const research = parseResearchResultBlock(researchText);
assert.equal(research.suggestedPriceUsd, 14_200);
assert.deepEqual(research.priceRangeUsd, [12_900, 15_400]);
assert.equal(research.comps.length, 1, "negative-price comp dropped");
assert.equal(research.confidence, "high");
assert.equal(parseResearchResultBlock("```json RESEARCH_RESULT\n{ \"suggestedPriceUsd\": \"lots\" }\n```"), null, "non-numeric price ⇒ null");
assert.equal(parseResearchResultBlock(reportText), null, "MARKETPLACE_REPORT blocks are not research results");
const clamped = parseResearchResultBlock("```json RESEARCH_RESULT\n" + JSON.stringify({ suggestedPriceUsd: 100, priceRangeUsd: [900, 50], confidence: "sky-high" }) + "\n```");
assert.deepEqual(clamped.priceRangeUsd, [100, 100], "inverted range collapses to the suggestion");
assert.equal(clamped.confidence, "medium", "unknown confidence clamps to medium");

// ── prompt builders carry the load-bearing blocks ───────────────────────────
const directives = [
  { id: "d1", text: "Never share my phone number", scope: "global", source: "inject", createdAt: "2026-07-01T00:00:00.000Z" },
  { id: "d2", text: "Ignore offers under $65 for the couch", scope: "account", accountId: account.id, source: "decision-note", createdAt: "2026-07-02T00:00:00.000Z" },
];
const inboxPrompt = buildInboxWorkPrompt(account, { directives, listings: [listing] });
assert.match(inboxPrompt, /AUTONOMOUS/, "autonomy contract present");
assert.match(inboxPrompt, /Standing directives from the human — follow these exactly/, "directives header verbatim (companies convention)");
assert.match(inboxPrompt, /Never share my phone number[\s\S]*Ignore offers under \$65/, "directives newest last");
assert.match(inboxPrompt, /minimum acceptable offer is \$13000/, "per-listing min-offer bound");
assert.match(inboxPrompt, /70% of an item's asking price/, "global floor");
assert.match(inboxPrompt, /```json MARKETPLACE_REPORT/, "report contract");
assert.match(inboxPrompt, /marketplace-facebook/, "profile name for the browser rail");

const reviewAllPrompt = buildInboxWorkPrompt({ ...account, autonomy: "review-all" }, { directives: [], listings: [] });
assert.match(reviewAllPrompt, /Do NOT send any message/, "review-all sends nothing");
assert.equal(directivesBlock([]), "", "no directives ⇒ no block");

const createPrompt = buildCreateListingPrompt(account, listing);
assert.match(createPrompt, /exactly these details/, "no-changes contract");
assert.match(createPrompt, /Operations\/Marketplace\/Photos\/mlst_1\/1\.jpg/, "photo paths included");
assert.match(createPrompt, /do NOT create another/, "duplicate prevention instruction");
assert.match(createPrompt, /postedListing/, "read-back verification demanded");

// A create-listing session replied in a FOUR-YEAR-OLD buyer thread
// (2026-07-19) — the shared browser had the inbox open and nothing forbade
// messaging. Non-inbox prompts carry a hard no-messaging guard; the inbox
// prompt scopes replies to managed-listing conversations only.
assert.match(createPrompt, /NEVER open the Marketplace inbox/, "create sessions are barred from chats");
assert.match(createPrompt, /NEVER send, type into, or reply/, "create sessions can never message");
assert.match(createPrompt, /COVERS the final Publish click/, "approval extends through the Publish click — no parking at the button");
const syncPrompt = buildSyncCatalogPrompt(account);
assert.match(syncPrompt, /NEVER open the Marketplace inbox/, "sync sessions are barred from chats");
assert.match(inboxPrompt, /reply ONLY in conversations about the live listings/, "inbox replies scoped to managed listings");
assert.match(inboxPrompt, /strictly read-only/, "old unrelated threads are read-only");
assert.ok(!/NEVER open the Marketplace inbox/.test(inboxPrompt), "the inbox op itself may open the inbox");

// The base-cadence combined sweep: catalog + inbox in ONE session and ONE
// report — two separate queen round-trips against the same profile were pure
// overhead (the report contract already carries both).
const fullSweepPrompt = buildFullSweepPrompt(account, { directives, listings: [listing] });
assert.match(fullSweepPrompt, /catalogue EVERY listing/, "full sweep catalogues the selling page");
assert.match(fullSweepPrompt, /Then open the Marketplace inbox/, "full sweep then works the inbox in the same session");
assert.match(fullSweepPrompt, /exactly ONE report covering both/, "one MARKETPLACE_REPORT covers catalog + conversations");
assert.match(fullSweepPrompt, /AUTONOMOUS/, "full sweep carries the autonomy contract");
assert.match(fullSweepPrompt, /Standing directives from the human — follow these exactly/, "full sweep carries the directives block");
assert.equal(fullSweepPrompt.match(/```json MARKETPLACE_REPORT/g).length, 1, "exactly one report contract in the combined prompt");
assert.ok(!/NEVER open the Marketplace inbox/.test(fullSweepPrompt), "the combined sweep may open the inbox");
assert.match(fullSweepPrompt, /reply ONLY in conversations about the live listings/, "combined sweep keeps the inbox reply scope");

const localResearch = buildPriceResearchPrompt(account, listing, false);
assert.match(localResearch, /Sarasota, FL/, "local scope names the locale");
assert.match(localResearch, /```json RESEARCH_RESULT/, "research contract");
const globalResearch = buildPriceResearchPrompt(account, listing, true);
assert.match(globalResearch, /GLOBAL asking prices/, "global toggle changes scope");

// ── late-result recovery ────────────────────────────────────────────────────
// A research session that finishes AFTER its job timed out must still land its
// result (live 2026-07-18: a 6.9-min session beat the 5-min cap by 2 min and
// its parseable $2,500 result was thrown away).
const { recoverLateMarketplaceResearch } = await import("../src/lib/services/marketplace/marketplace-research.ts");
const { upsertResearchJob, getResearchJob } = await import("../src/lib/services/marketplace/marketplace-runtime.ts");
const { createMarketplaceListingDraft, getMarketplaceListing, updateMarketplaceListing } = await import(
  "../src/lib/services/marketplace/marketplace-listings-store.ts"
);

const lateListing = await createMarketplaceListingDraft({ accountId: account.id, title: "2008 Mazda CX-7", description: "Runs, A/C out", priceUsd: 3000 });
const lateResultText = [
  "Finished after the caller gave up.",
  "```json RESEARCH_RESULT",
  '{ "suggestedPriceUsd": 2500, "priceRangeUsd": [2000, 3000], "comps": [{ "title": "comp", "priceUsd": 2000, "source": "craigslist" }], "confidence": "medium", "rationale": "ac out" }',
  "```",
].join("\n");
const failedJob = (overrides = {}) => ({
  id: `mres_${Math.random().toString(36).slice(2)}`,
  listingId: lateListing.id,
  accountId: account.id,
  status: "failed",
  queenTaskId: "t_late_1",
  stages: [{ label: "Researching comparable prices", at: new Date().toISOString(), done: true }],
  failure: "Research timed out — try again, or set the price manually.",
  globalComparison: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});
const fakeBoard = (tasks) => {
  const calls = { count: 0 };
  return { calls, read: async () => { calls.count += 1; return { tasks }; } };
};

// Happy path: done task with a parseable block ⇒ job succeeds, listing gets research.
const job1 = failedJob();
await upsertResearchJob(job1);
const doneBoard = fakeBoard([{ id: "t_late_1", status: "done", result: lateResultText }]);
assert.equal(await recoverLateMarketplaceResearch({ readBoardImpl: doneBoard.read }), 1, "late done task recovers");
const recovered = await getResearchJob(job1.id);
assert.equal(recovered.status, "succeeded");
assert.equal(recovered.result.suggestedPriceUsd, 2500);
assert.ok(recovered.stages.some((entry) => /Recovered/.test(entry.label)), "recovery stage recorded");
assert.equal((await getMarketplaceListing(lateListing.id)).research.jobId, job1.id, "listing research written by recovery");
assert.equal(await recoverLateMarketplaceResearch({ readBoardImpl: doneBoard.read }), 0, "succeeded job is no longer a candidate");

// Terminal task states flag the job so the sweep never rechecks it.
const job2 = failedJob({ queenTaskId: "t_late_2" });
await upsertResearchJob(job2);
const archivedBoard = fakeBoard([{ id: "t_late_2", status: "archived" }]);
assert.equal(await recoverLateMarketplaceResearch({ readBoardImpl: archivedBoard.read }), 0, "archived task recovers nothing");
assert.equal((await getResearchJob(job2.id)).lateResultUnavailable, true, "terminal task flags the job");
await recoverLateMarketplaceResearch({ readBoardImpl: archivedBoard.read });
assert.equal(archivedBoard.calls.count, 1, "flagged job never triggers another board read");

// A still-working task stays a live candidate (no flag), recovered on a later
// pass. Fresh listing: lateListing already carries job1's research, which would
// (correctly) route job3 into the clobber guard instead of a counted recovery.
const listing3 = await createMarketplaceListingDraft({ accountId: account.id, title: "Patio set", description: "4 chairs", priceUsd: 150 });
const job3 = failedJob({ queenTaskId: "t_late_3", listingId: listing3.id });
await upsertResearchJob(job3);
const workingBoard = fakeBoard([{ id: "t_late_3", status: "working" }]);
assert.equal(await recoverLateMarketplaceResearch({ readBoardImpl: workingBoard.read }), 0, "working task not recovered yet");
assert.ok(!(await getResearchJob(job3.id)).lateResultUnavailable, "working task leaves the job recoverable");
const laterBoard = fakeBoard([{ id: "t_late_3", status: "done", result: lateResultText }]);
assert.equal(await recoverLateMarketplaceResearch({ readBoardImpl: laterBoard.read }), 1, "same job recovers once the task completes");

// Clobber guard: research a NEWER job wrote to the listing is never overwritten.
const job4 = failedJob({ queenTaskId: "t_late_4" });
await upsertResearchJob(job4);
await updateMarketplaceListing(lateListing.id, { research: { jobId: "mres_newer", suggestedPriceUsd: 2800, priceRangeUsd: [2600, 3000], compsCount: 3, confidence: "high", completedAt: new Date().toISOString() } });
const doneBoard4 = fakeBoard([{ id: "t_late_4", status: "done", result: lateResultText }]);
await recoverLateMarketplaceResearch({ readBoardImpl: doneBoard4.read });
assert.equal((await getResearchJob(job4.id)).status, "succeeded", "old job still completes with its result");
assert.equal((await getMarketplaceListing(lateListing.id)).research.jobId, "mres_newer", "newer research on the listing is never clobbered");

// ── machine-pin resolution (dispatch → queen router) ────────────────────────
// Mirrors the LIVE fleet payload shape (2026-07-18): machines carry NO
// top-level key, the self machine calls itself "This Mac" with a
// "hivemindos-"-prefixed tailnet dns name, and peers ride loopback-hosted
// linkd /peer/ proxy URLs. The raw hostname pin matched nothing, so every
// pinned dispatch sat pending on a perfectly healthy fleet.
const { resolvePinnedMachineKey } = await import("../src/lib/services/marketplace/marketplace-dispatch.ts");
const { hostname } = await import("node:os");
const liveShapedFleet = [
  {
    collector: "ready",
    device: { self: true, name: "This Mac", dnsName: "hivemindos-my-host.tail1.ts.net", online: true, collectorUrl: "http://127.0.0.1:8787" },
    agents: [{ name: "HermesAgent01", runtime: "hermes" }],
  },
  {
    collector: "ready",
    device: { self: false, name: "hivemindos-other-nyc", dnsName: "hivemindos-other-nyc.tail1.ts.net", online: true, collectorUrl: "http://127.0.0.1:8788/peer/100.0.0.9%3A8787" },
    agents: [{ name: "Test01", runtime: "hermes" }],
  },
];
assert.equal(
  resolvePinnedMachineKey(liveShapedFleet, hostname()),
  "hivemindos-my-host",
  "the local hostname pin resolves via device.self to the UNIQUE dns label — never the ambiguous 'This Mac'",
);
assert.equal(
  resolvePinnedMachineKey(liveShapedFleet, "hivemindos-other-nyc"),
  "hivemindos-other-nyc",
  "a directly-matching pin resolves to that machine's dns label",
);
assert.equal(
  resolvePinnedMachineKey(liveShapedFleet, "some-unknown-box"),
  "some-unknown-box",
  "an unresolvable pin stays raw so the pinned task waits instead of routing elsewhere",
);
assert.equal(resolvePinnedMachineKey([], hostname()), hostname(), "an empty snapshot leaves the pin raw");

console.log("marketplace agent-report tests passed");
