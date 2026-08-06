#!/usr/bin/env node
// Listing approval pipeline + decision rail: request-approval runs the
// duplicate gate and parks a pending decision; postApprovedListing fails
// closed on anything but an approved decision and verifies the agent's
// read-back; denial keeps the listing off the marketplace; the decision→view
// mapping renders through the shared approval card shape. Fake dispatch
// throughout — no queen, no browser.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-marketplace-decisions-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;

const { createMarketplaceAccount } = await import("../src/lib/services/marketplace/marketplace-store.ts");
const { createMarketplaceListingDraft, getMarketplaceListing, upsertSyncedListings } = await import(
  "../src/lib/services/marketplace/marketplace-listings-store.ts"
);
const { requestListingApproval, DuplicateListingError } = await import("../src/lib/services/marketplace/marketplace-listing-pipeline.ts");
const { decideMarketplaceDecision, listMarketplaceDecisions } = await import("../src/lib/services/marketplace/marketplace-decisions-store.ts");
const { facebookMarketplaceAdapter } = await import("../src/lib/services/marketplace/adapters/facebook.ts");
const { marketplaceDecisionToView } = await import("../src/features/dashboard/views/marketplace/marketplace-approval-model.ts");

const fakeEnsureBrowser = async () => ({ cdpUrl: "http://127.0.0.1:9333", pid: 4242, headed: false, launched: false });

const account = await createMarketplaceAccount({
  provider: "facebook",
  slug: "primary",
  method: "browser-profile",
  machine: { machineKey: hostname(), machineName: "This Mac", collectorUrl: "http://127.0.0.1:8787", profileName: "marketplace-facebook" },
});

// ── request-approval: validation + duplicate gate ───────────────────────────
const noPrice = await createMarketplaceListingDraft({ accountId: account.id, title: "Free item", description: "x", priceUsd: 0 });
await assert.rejects(() => requestListingApproval(noPrice.id), /price above \$0/);

await upsertSyncedListings(account.id, [{ externalId: "555", title: "2018 Toyota Camry SE", priceUsd: 14_000, state: "active" }]);
const draft = await createMarketplaceListingDraft({
  accountId: account.id,
  title: "2018 Toyota Camry SE clean title",
  description: "60k miles",
  priceUsd: 14_500,
});
await assert.rejects(() => requestListingApproval(draft.id), DuplicateListingError, "near-dup of a synced active listing blocks");
assert.equal((await getMarketplaceListing(draft.id)).state, "draft", "blocked submit leaves the draft untouched");

const submitted = await requestListingApproval(draft.id, { overrideDuplicate: true });
assert.equal(submitted.listing.state, "pending-approval");
assert.equal(submitted.decision.kind, "new-listing");
assert.equal(submitted.decision.status, "pending");
assert.ok(submitted.decision.explanation.evidence.some((line) => /Duplicate check: overridden/.test(line)), "override recorded in the trail");
await assert.rejects(() => requestListingApproval(draft.id), /pending-approval/, "no double-submit");

// ── decision → shared approval-card view ────────────────────────────────────
const view = marketplaceDecisionToView(submitted.decision);
assert.equal(view.id, submitted.decision.id);
assert.equal(view.risk, "high", "marketplace decisions always demand full attention");
assert.equal(view.kind, "new listing");
assert.ok(view.explanation, "reasoning trail rides into the card");

// ── fail-closed posting gate ────────────────────────────────────────────────
const listing = await getMarketplaceListing(draft.id);
const okReport = {
  conversations: [], replies: [], escalations: [],
  postedListing: { externalId: "777", url: "https://www.facebook.com/marketplace/item/777" },
  sessionHealth: "ok",
};
// Pipeline-level: postApprovedListing refuses a still-pending decision.
const { postApprovedListing } = await import("../src/lib/services/marketplace/marketplace-listing-pipeline.ts");
await assert.rejects(() => postApprovedListing(submitted.decision.id), /not approved|is pending/i, "pending decision cannot fire a post");
// Adapter-level: even a hand-rolled call cannot post without an approved decision id.
await assert.rejects(
  () => facebookMarketplaceAdapter.createListing(account, listing, "", { env: {}, ensureBrowserImpl: fakeEnsureBrowser, dispatchAgentTaskImpl: async () => okReport }),
  /approved decision/i,
);

// ── denial path: nothing posts, note becomes a directive ────────────────────
const denied = await decideMarketplaceDecision(submitted.decision.id, "denied", "Price it at 13900 and ignore lowballs under 13k from now on.", true);
assert.equal(denied.decision.status, "denied");
assert.ok(denied.directiveId, "standing rule captured from the note");
assert.equal((await listMarketplaceDecisions({ status: "pending" })).length, 0);

// A denied decision can never fire the post afterwards (fail closed at fire time).
await assert.rejects(() => postApprovedListing(submitted.decision.id), /denied/, "denied decision cannot fire");
assert.notEqual((await getMarketplaceListing(draft.id)).state, "active", "nothing posted");

// ── approval path with verified read-back + INDEPENDENT page proof ─────────
// The dispatcher must load the claimed URL itself and see a real listing page
// carrying the title — read-back alone is the agent's own claim, and a live
// session fabricated externalId "1234567890" + URL and got marked active
// (2026-07-18, VeniceAgent).
const draft2 = await createMarketplaceListingDraft({ accountId: account.id, title: "Vintage record player", description: "Works great", priceUsd: 120 });
const submitted2 = await requestListingApproval(draft2.id);
const approved = await decideMarketplaceDecision(submitted2.decision.id, "approved");
assert.equal(approved.decision.status, "approved");
const realPage = async (profileName, url) => ({ url, text: "Marketplace · Vintage record player · $120 · Works great" });
const posted = await facebookMarketplaceAdapter.createListing(
  account,
  await getMarketplaceListing(draft2.id),
  approved.decision.id,
  { env: {}, ensureBrowserImpl: fakeEnsureBrowser, dispatchAgentTaskImpl: async () => okReport, readBrowserTabImpl: realPage },
);
// The independent page read succeeded on this machine, so the claim comes back "verified".
assert.deepEqual(posted, { externalId: "777", url: "https://www.facebook.com/marketplace/item/777", verification: "verified" });

// Fabricated claim: the page behind the reported URL does not exist.
await assert.rejects(
  () => facebookMarketplaceAdapter.createListing(account, listing, approved.decision.id, {
    env: {}, ensureBrowserImpl: fakeEnsureBrowser,
    dispatchAgentTaskImpl: async () => okReport,
    readBrowserTabImpl: async (profileName, url) => ({ url, text: "This content isn't available right now" }),
  }),
  /FAILED independent verification/i,
  "a dead listing URL rejects the agent's claim",
);
// Wrong-item page: real page, but it does not mention the listing.
await assert.rejects(
  () => facebookMarketplaceAdapter.createListing(account, listing, approved.decision.id, {
    env: {}, ensureBrowserImpl: fakeEnsureBrowser,
    dispatchAgentTaskImpl: async () => okReport,
    readBrowserTabImpl: async (profileName, url) => ({ url, text: "Marketplace · Patio chairs · $60" }),
  }),
  /does not mention the item/i,
  "a page for a different item rejects the claim",
);
// Non-Marketplace URL shape rejects before any browser work.
await assert.rejects(
  () => facebookMarketplaceAdapter.createListing(account, listing, approved.decision.id, {
    env: {}, ensureBrowserImpl: fakeEnsureBrowser,
    dispatchAgentTaskImpl: async () => ({ ...okReport, postedListing: { externalId: "x", url: "https://evil.example/item/1" } }),
    readBrowserTabImpl: async () => { throw new Error("should not be reached"); },
  }),
  /not a Marketplace item URL/i,
  "a non-marketplace URL is rejected on shape alone",
);

// ── human-authored submit auto-approves (their submit IS the approval) ──────
// Account homed on a DIFFERENT machine so the adapter never touches the real
// browser bootstrap in this hermetic run (no ensureBrowserImpl injected here).
const remoteAccount = await createMarketplaceAccount({
  provider: "facebook",
  slug: "human-desk",
  method: "browser-profile",
  machine: { machineKey: "remote-mac", machineName: "Remote Mac", collectorUrl: "http://127.0.0.1:8787", profileName: "marketplace-facebook-human-desk" },
});
const humanDraft = await createMarketplaceListingDraft({ accountId: remoteAccount.id, title: "Standing desk", description: "Solid wood", priceUsd: 220 });
const humanSubmit = await requestListingApproval(humanDraft.id, { submittedBy: "human", dispatchImpl: async () => okReport });
assert.equal(humanSubmit.decision.status, "approved", "human submit needs no second approval card");
assert.match(humanSubmit.decision.decisionNote ?? "", /listing editor/i, "auto-approval provenance recorded");
assert.equal(humanSubmit.listing.state, "posting", "submit response already reads POSTING (state flips before the response)");
assert.equal(
  (await listMarketplaceDecisions({ status: "pending" })).some((decision) => decision.id === humanSubmit.decision.id),
  false,
  "no pending card parked for a human submit",
);
// The detached dispatch completes with the fake report, but the account is
// homed on ANOTHER machine — no independent page read is possible from this
// process, so the claim lands posted-unverified (with the read-back external
// id recorded); the owning machine's monitor promotes or refutes it later.
for (let i = 0; i < 100 && (await getMarketplaceListing(humanDraft.id)).state === "posting"; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const humanPosted = await getMarketplaceListing(humanDraft.id);
assert.equal(humanPosted.state, "posted-unverified", "off-machine post claim is recorded, never live on trust");
assert.equal(humanPosted.external?.externalId, "777");
// The agent-submitted path (default) still parks a pending card — the gate
// stays for anything the human did not author.
const agentDraft = await createMarketplaceListingDraft({ accountId: remoteAccount.id, title: "Office chair", description: "Mesh", priceUsd: 90 });
const agentSubmit = await requestListingApproval(agentDraft.id);
assert.equal(agentSubmit.decision.status, "pending", "agent-proposed listings still require the approval card");

console.log("marketplace decisions tests passed");
