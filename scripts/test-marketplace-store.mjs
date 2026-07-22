#!/usr/bin/env node
// Contract coverage for the marketplace stores: vault-primary definitions,
// normalizers that drop malformed records (and degrade unknown autonomy to
// review-all), fail-closed corruption, rotated backups, directive near-dup
// replacement, listing dup-prevention, photo path pinning + caps, bounded
// conversation history with idempotent ingestion, and the decision → directive
// capture flow. Runs against an isolated HOME + vault.
import { register } from "node:module";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-marketplace-store-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;

const {
  createMarketplaceAccount,
  getMarketplaceAccount,
  readMarketplaceAccounts,
  updateMarketplaceAccount,
  deleteMarketplaceAccount,
  normalizeMarketplaceAccountRecord,
  addMarketplaceDirective,
  listMarketplaceDirectives,
  readMarketplaceDirectives,
  removeMarketplaceDirective,
  marketplaceAccountId,
} = await import("../src/lib/services/marketplace/marketplace-store.ts");
const { MarketplaceFileCorruptError } = await import("../src/lib/services/marketplace/marketplace-store-io.ts");
const {
  createMarketplaceListingDraft,
  findDuplicateListing,
  readMarketplaceListings,
  saveListingPhotos,
  resolveMarketplacePhotoAbsolutePath,
  setMarketplaceListingState,
  updateMarketplaceListing,
  upsertSyncedListings,
  MARKETPLACE_MAX_PHOTOS_PER_LISTING,
} = await import("../src/lib/services/marketplace/marketplace-listings-store.ts");
const { ingestConversationSnapshot, readMarketplaceConversations, attachConversationEscalation } = await import(
  "../src/lib/services/marketplace/marketplace-conversations-store.ts"
);
const { enqueueMarketplaceDecision, decideMarketplaceDecision, listMarketplaceDecisions, marketplaceDecisionAnswer } = await import(
  "../src/lib/services/marketplace/marketplace-decisions-store.ts"
);
const { MARKETPLACE_CONVERSATION_MESSAGE_CAP } = await import("../src/lib/services/marketplace/marketplace-types.ts");

const ACCOUNTS_FILE = join(tempVault, "Operations", "Marketplace", "marketplace.json");
const machine = { machineKey: "this-mac", machineName: "This Mac", collectorUrl: "http://127.0.0.1:8787", profileName: "marketplace-facebook" };

// ── accounts: create + defaults ─────────────────────────────────────────────
const account = await createMarketplaceAccount({ provider: "facebook", slug: "Liam Test", method: "browser-profile", machine });
assert.equal(account.id, "facebook:liam-test");
assert.equal(marketplaceAccountId("facebook", "Liam Test"), "facebook:liam-test");
assert.equal(account.autonomy, "autonomous", "new accounts default to autonomous chat (explicit product decision)");
assert.equal(account.status, "disconnected");
assert.equal(account.monitor.baseIntervalMs, 3_600_000, "hourly base by default");
assert.equal(account.monitor.ladder.length, 3, "default 3-rung ladder");
assert.equal(account.locale.globalComparison, false, "local price research by default");
await access(ACCOUNTS_FILE);
await assert.rejects(
  () => createMarketplaceAccount({ provider: "facebook", slug: "liam-test", method: "browser-profile", machine }),
  /already exists/,
);

// ── normalizer: degrade + drop rules ────────────────────────────────────────
assert.equal(normalizeMarketplaceAccountRecord(null), null);
assert.equal(normalizeMarketplaceAccountRecord({ id: "facebook:x", provider: "facebook" }), null, "no machine binding → dropped");
assert.equal(
  normalizeMarketplaceAccountRecord({ id: "facebook:x", provider: "facebook", machine, preferredAgentName: "Solara" })?.preferredAgentName,
  "Solara",
  "preferredAgentName survives the projection normalizer (it pins every dispatched session)",
);
const weird = normalizeMarketplaceAccountRecord({ id: "facebook:x", provider: "facebook", machine, autonomy: "yolo" });
assert.equal(weird.autonomy, "review-all", "unknown autonomy degrades to review-all (more human review, never less)");
assert.equal(normalizeMarketplaceAccountRecord({ id: "ebay:x", provider: "ebay", machine }), null, "unknown provider dropped");

// ── update + backups ────────────────────────────────────────────────────────
await updateMarketplaceAccount(account.id, { autonomy: "escalate-decisions", negotiation: { globalMinOfferPct: 70 } });
const updated = await getMarketplaceAccount(account.id);
assert.equal(updated.autonomy, "escalate-decisions");
assert.equal(updated.negotiation.globalMinOfferPct, 70);
await access(`${ACCOUNTS_FILE}.bak.0`, undefined, "definitions writes rotate backups");

// ── corruption fails closed ─────────────────────────────────────────────────
const good = await readFile(ACCOUNTS_FILE, "utf8");
await writeFile(ACCOUNTS_FILE, "{ not json !!");
await assert.rejects(() => readMarketplaceAccounts(), MarketplaceFileCorruptError, "corrupt file throws, never overwrites");
await writeFile(ACCOUNTS_FILE, good);

// ── directives: near-dup replacement at 0.75 ────────────────────────────────
const d1 = await addMarketplaceDirective({ text: "Ignore lowball offers under 50 percent of asking", scope: "account", accountId: account.id, source: "decision-note" });
const d2 = await addMarketplaceDirective({ text: "Never share my phone number", scope: "global", source: "inject" });
const d3 = await addMarketplaceDirective({ text: "Ignore lowball offers under 60 percent of asking", scope: "account", accountId: account.id, source: "decision-note" });
const directives = await readMarketplaceDirectives();
assert.equal(directives.length, 2, "near-duplicate replaced its older sibling in place");
assert.ok(directives.some((directive) => directive.id === d3.id), "newest wording wins");
assert.ok(!directives.some((directive) => directive.id === d1.id), "older near-dup gone");
const scoped = await listMarketplaceDirectives(account.id);
assert.equal(scoped.length, 2, "account scope sees its own + globals");
assert.equal((await listMarketplaceDirectives("facebook:other")).length, 1, "other accounts see only globals");
await removeMarketplaceDirective(d2.id);
assert.equal((await readMarketplaceDirectives()).length, 1);

// ── listings: drafts, dup-check, sync merge ─────────────────────────────────
const draft = await createMarketplaceListingDraft({
  accountId: account.id,
  title: "2018 Toyota Camry SE",
  description: "Clean title, 60k miles",
  priceUsd: 14_500,
});
assert.equal(draft.state, "draft");
assert.equal(draft.minOfferUsd, undefined, "minimum offer unset by default");
await updateMarketplaceListing(draft.id, { minOfferUsd: 13_000 });
const dup = await findDuplicateListing(account.id, { title: "2018 Toyota Camry SE clean", priceUsd: 14_000 });
assert.ok(dup && dup.id === draft.id, "near-identical title within ±15% price = duplicate");
assert.equal(await findDuplicateListing(account.id, { title: "2018 Toyota Camry SE clean", priceUsd: 9_000 }), null, "price far outside ±15% is not a duplicate");
assert.equal(await findDuplicateListing(account.id, { title: "Vintage record player", priceUsd: 14_500 }), null);
assert.equal(await findDuplicateListing(account.id, { id: draft.id, title: draft.title, priceUsd: draft.priceUsd }), null, "a listing never duplicates itself");

const sync1 = await upsertSyncedListings(account.id, [
  { externalId: "111", title: "Old couch", priceUsd: 80, state: "active", url: "https://facebook.com/marketplace/item/111" },
  { externalId: "222", title: "Bike", state: "sold" },
]);
assert.deepEqual(sync1, { added: 2, updated: 0 });
const sync2 = await upsertSyncedListings(account.id, [{ externalId: "111", title: "Old couch (updated)", priceUsd: 70, state: "active" }]);
assert.deepEqual(sync2, { added: 0, updated: 1 });
const listings = await readMarketplaceListings(account.id);
assert.equal(listings.length, 3);
const couch = listings.find((listing) => listing.external?.externalId === "111");
assert.equal(couch.title, "Old couch (updated)");
assert.equal(couch.priceUsd, 70);
assert.equal(couch.origin, "synced");
const bike = listings.find((listing) => listing.external?.externalId === "222");
assert.equal(bike.state, "ended", "sold catalog items land as ended");

await setMarketplaceListingState(draft.id, "pending-approval", "human");
assert.equal((await readMarketplaceListings(account.id)).find((listing) => listing.id === draft.id).stateHistory.length, 2);

// ── photos: caps + traversal pinning ────────────────────────────────────────
const tinyPng = `data:image/png;base64,${Buffer.from("fakepngbytes").toString("base64")}`;
const photos = await saveListingPhotos(draft.id, [{ dataUrl: tinyPng, alt: "front" }, { dataUrl: tinyPng }]);
assert.equal(photos.length, 2);
assert.match(photos[0].vaultPath, /^Operations\/Marketplace\/Photos\/mlst_[a-f0-9-]+\/1\.png$/);
const absolute = resolveMarketplacePhotoAbsolutePath(photos[0].vaultPath);
assert.ok(absolute.startsWith(join(tempVault, "Operations", "Marketplace", "Photos")), "photos resolve under the vault photos root");
await access(absolute);
assert.throws(() => resolveMarketplacePhotoAbsolutePath("Operations/Marketplace/Photos/../../../etc/passwd"), /outside|Not a marketplace/i);
assert.throws(() => resolveMarketplacePhotoAbsolutePath("/etc/passwd"), /Not a marketplace photo path/);
await assert.rejects(() => saveListingPhotos(draft.id, [{ dataUrl: "data:text/plain;base64,aGk=" }]), /unsupported type/);
await assert.rejects(
  () => saveListingPhotos(draft.id, Array.from({ length: MARKETPLACE_MAX_PHOTOS_PER_LISTING + 1 }, () => ({ dataUrl: tinyPng }))),
  /Too many photos/,
);

// ── conversations: idempotent ingestion + bounded history ───────────────────
const snapshot = [{
  id: "conv-1",
  listingExternalId: "111",
  listingTitle: "Old couch",
  buyerName: "Sam",
  messages: [
    { from: "buyer", text: "Is this available?", at: "2026-07-18T10:00:00.000Z" },
    { from: "buyer", text: "Would you take 60?", at: "2026-07-18T10:01:00.000Z" },
  ],
}];
const replies = [{ conversationId: "conv-1", text: "Yes, it's available!", at: "2026-07-18T10:02:00.000Z" }];
const first = await ingestConversationSnapshot(account.id, snapshot, replies);
assert.equal(first.conversationsTouched, 1);
assert.equal(first.newBuyerMessages, 2);
const second = await ingestConversationSnapshot(account.id, snapshot, replies);
assert.equal(second.newBuyerMessages, 0, "replaying the same report adds nothing");
let conversations = await readMarketplaceConversations(account.id);
assert.equal(conversations.length, 1);
assert.equal(conversations[0].messages.length, 3);
assert.equal(conversations[0].state, "awaiting-buyer", "agent replied last");
assert.equal(conversations[0].lastAgentReplyAt, "2026-07-18T10:02:00.000Z");

const flood = [{
  id: "conv-1",
  listingTitle: "Old couch",
  buyerName: "Sam",
  messages: Array.from({ length: MARKETPLACE_CONVERSATION_MESSAGE_CAP + 40 }, (_, i) => ({
    from: "buyer",
    text: `msg ${i}`,
    at: `2026-07-18T11:${String(i % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`,
  })),
}];
await ingestConversationSnapshot(account.id, flood, []);
conversations = await readMarketplaceConversations(account.id);
assert.equal(conversations[0].messages.length, MARKETPLACE_CONVERSATION_MESSAGE_CAP, "history bounded to the cap");

// ── decisions: lifecycle + directive capture ────────────────────────────────
const decision = await enqueueMarketplaceDecision({
  kind: "buyer-escalation",
  accountId: account.id,
  conversationId: conversations[0].id,
  title: "Buyer offered $60 for 'Old couch' — asking $70",
  summary: "Sam offered $60.",
  explanation: { headline: "Offer below floor", summary: "Sam offered $60 against a $70 ask.", whyNow: "Offer arrived", evidence: ["Offer: $60"] },
});
assert.equal(decision.status, "pending");
await attachConversationEscalation(conversations[0].id, decision.id, "Offer below floor");
assert.equal((await readMarketplaceConversations(account.id))[0].state, "needs-human");

const decided = await decideMarketplaceDecision(decision.id, "denied", "Too low. Ignore offers under $65 from now on.", true);
assert.equal(decided.decision.status, "denied");
assert.ok(decided.directiveId, "note captured as a standing directive");
assert.equal(decided.decision.capturedDirectiveId, decided.directiveId);
const captured = (await listMarketplaceDirectives(account.id)).find((directive) => directive.id === decided.directiveId);
assert.ok(captured && captured.source === "decision-note" && captured.decisionRef === decision.id);
const answer = marketplaceDecisionAnswer(decided.decision, "denied", "Too low. Ignore offers under $65 from now on.");
assert.match(answer, /REJECTED/);
assert.match(answer, /Human note: Too low/);
await assert.rejects(
  () => decideMarketplaceDecision(decision.id, "approved", "changed my mind", true),
  /already denied/,
  "decided decisions cannot be re-decided into a directive",
);
assert.equal((await listMarketplaceDecisions({ status: "pending" })).length, 0);

// ── delete account ──────────────────────────────────────────────────────────
assert.equal(await deleteMarketplaceAccount(account.id), true);
assert.equal((await readMarketplaceAccounts()).length, 0);

console.log("marketplace store tests passed");
