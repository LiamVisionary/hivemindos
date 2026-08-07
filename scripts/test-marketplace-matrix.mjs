#!/usr/bin/env node
// Completeness contract for the marketplace provider matrix + adapter
// registry: every provider row self-identifies, every method declares a
// credential rail (env keys, OAuth start path, or a managed browser profile),
// every capability is declared, listing creation is always gated on an
// approved decision, adapters implement the full contract, and DTOs are
// copies. Also covers the facebook probe parsing internals (URL redirect
// logged-out detection) with no real browser, plus listing-state consumer
// completeness: every listing state has a catalog filter bucket besides
// "all", and the delete guard blocks every may-be-live state.
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { MARKETPLACE_PROVIDERS, MARKETPLACE_CAPABILITIES, MARKETPLACE_LISTING_STATES } = await import("../src/lib/services/marketplace/marketplace-types.ts");
const { MARKETPLACE_PROVIDER_MATRIX, MARKETPLACE_LISTING_APPROVAL_GATE, marketplaceProviderCapabilityDtos, isMarketplaceProvider } =
  await import("../src/lib/services/marketplace/marketplace-provider-matrix.ts");
const { MARKETPLACE_ADAPTERS } = await import("../src/lib/services/marketplace/adapters/index.ts");
const { __facebookAdapterInternals, facebookMarketplaceAdapter } = await import("../src/lib/services/marketplace/adapters/facebook.ts");

const SUPPORT_VALUES = new Set(["supported", "limited", "unsupported"]);

assert.deepEqual([...MARKETPLACE_PROVIDERS], ["facebook"], "v1 ships the facebook provider");
assert.ok(isMarketplaceProvider("facebook"));
assert.ok(!isMarketplaceProvider("ebay"), "unknown providers rejected until a row exists");

for (const provider of MARKETPLACE_PROVIDERS) {
  const row = MARKETPLACE_PROVIDER_MATRIX[provider];
  assert.ok(row, `matrix row exists: ${provider}`);
  assert.equal(row.provider, provider, `row self-identifies: ${provider}`);
  assert.ok(row.methods.length >= 1, `at least one connect method: ${provider}`);
  for (const method of row.methods) {
    assert.ok(
      method.envKeys.length > 0 || method.oauthStartPath || method.browserProfile,
      `${provider}/${method.method} declares a credential rail`,
    );
    if (method.method === "browser-profile") {
      assert.ok(method.browserProfile, `${provider} browser-profile method carries its profile spec`);
      assert.ok(method.browserProfile.namePrefix, `${provider} profile spec has a namePrefix`);
      assert.match(method.browserProfile.loginUrl, /^https:\/\//, `${provider} loginUrl is https`);
      assert.match(method.browserProfile.probeUrl, /^https:\/\//, `${provider} probeUrl is https`);
    }
  }
  for (const capability of MARKETPLACE_CAPABILITIES) {
    assert.ok(SUPPORT_VALUES.has(row.capabilities[capability]), `${provider} declares capability ${capability}`);
  }
  assert.ok(row.execution === "browser-agent" || row.execution === "api", `${provider} has a valid execution style`);
  if (row.capabilities.createListing !== "unsupported") {
    assert.ok(
      row.gatedOps.some((gated) => gated.op === "createListing" && gated.gate === MARKETPLACE_LISTING_APPROVAL_GATE),
      `${provider} gates listing creation on ${MARKETPLACE_LISTING_APPROVAL_GATE}`,
    );
  }
  const adapter = MARKETPLACE_ADAPTERS[provider];
  assert.ok(adapter, `adapter registered: ${provider}`);
  assert.equal(adapter.provider, provider, `adapter self-identifies: ${provider}`);
  for (const fn of ["connectStatus", "checkActivity", "syncCatalog", "createListing", "endListing", "workInbox", "capabilities"]) {
    assert.equal(typeof adapter[fn], "function", `${provider} adapter implements ${fn}`);
  }
}

// Facebook row specifics: browser-profile only (Graph API does not cover
// personal Marketplace), browser-agent execution, and the documented limits.
const facebook = MARKETPLACE_PROVIDER_MATRIX.facebook;
assert.equal(facebook.execution, "browser-agent");
assert.deepEqual(facebook.methods.map((method) => method.method), ["browser-profile"], "facebook ships browser-profile only");
assert.equal(facebook.methods[0].browserProfile.namePrefix, "marketplace-facebook");
assert.ok(facebook.limits.some((limit) => /no official api/i.test(limit)), "facebook row documents the no-API reality");

// Client projection copies, never shares.
const dtos = marketplaceProviderCapabilityDtos();
assert.equal(dtos.length, MARKETPLACE_PROVIDERS.length);
for (const dto of dtos) {
  assert.notEqual(dto.limits, MARKETPLACE_PROVIDER_MATRIX[dto.provider].limits, "DTO limit arrays are copies");
  assert.notEqual(dto.capabilities, MARKETPLACE_PROVIDER_MATRIX[dto.provider].capabilities, "DTO capability maps are copies");
}
const fbDtoProfile = dtos[0].methods[0].browserProfile;
assert.deepEqual(fbDtoProfile, facebook.methods[0].browserProfile, "DTO carries the profile spec");
assert.notEqual(fbDtoProfile, facebook.methods[0].browserProfile, "DTO profile spec is a copy");

// Adapter capabilities projection matches the matrix (and is a copy).
const dummyAccount = {
  id: "facebook:test",
  provider: "facebook",
  method: "browser-profile",
  status: "disconnected",
  machine: { machineKey: "test-machine", machineName: "Test", collectorUrl: "", profileName: "marketplace-facebook" },
  autonomy: "autonomous",
  negotiation: {},
  monitor: { baseIntervalMs: 3_600_000, ladder: [], ladderResetMs: 7_200_000 },
  locale: { description: "", globalComparison: false },
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};
assert.deepEqual(facebookMarketplaceAdapter.capabilities(dummyAccount), facebook.capabilities);
assert.notEqual(facebookMarketplaceAdapter.capabilities(dummyAccount), facebook.capabilities, "capabilities() returns a copy");

// Probe parsing: logged-out redirects are detected from URLs alone.
const { extractCurrentUrl, looksLoggedOut } = __facebookAdapterInternals;
assert.equal(extractCurrentUrl('some noise\n"https://www.facebook.com/marketplace/you/selling"\n'), "https://www.facebook.com/marketplace/you/selling");
assert.equal(extractCurrentUrl("no url here"), "");
assert.ok(looksLoggedOut("https://www.facebook.com/login/?next=..."), "login redirect = logged out");
assert.ok(looksLoggedOut("https://www.facebook.com/checkpoint/1234"), "checkpoint = logged out");
assert.ok(!looksLoggedOut("https://www.facebook.com/marketplace/you/selling"), "selling page = logged in");
assert.ok(!looksLoggedOut(""), "no URL is not treated as logged out (degrades to needs-attention elsewhere)");

// Mutating ops fail closed without a wired agent dispatch.
await assert.rejects(
  () => facebookMarketplaceAdapter.createListing(dummyAccount, { photos: [] }, "mdec_x", {}),
  /dispatch/i,
  "createListing without dispatch wiring throws",
);
await assert.rejects(
  () => facebookMarketplaceAdapter.createListing(dummyAccount, { photos: [] }, "", { dispatchAgentTaskImpl: async () => ({}) }),
  /approved decision/i,
  "createListing without an approved decision id throws (listing-approval-required)",
);

// createListing verifies the posted listing came back; a session that cannot
// prove the post throws instead of pretending success.
const account = { ...dummyAccount, machine: { ...dummyAccount.machine } };
const listing = {
  id: "mlst_1",
  accountId: account.id,
  origin: "drafted",
  state: "approved",
  title: "Test bike",
  description: "A bike",
  priceUsd: 100,
  photos: [],
  stateHistory: [],
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};
const okReport = {
  conversations: [],
  replies: [],
  escalations: [],
  postedListing: { externalId: "123456", url: "https://www.facebook.com/marketplace/item/123456" },
  sessionHealth: "ok",
};
const posted = await facebookMarketplaceAdapter.createListing(account, listing, "mdec_ok", {
  dispatchAgentTaskImpl: async (input) => {
    assert.equal(input.op, "create-listing");
    assert.ok(input.prompt.includes("Test bike"), "prompt carries the listing title");
    assert.ok(input.prompt.includes("MARKETPLACE_REPORT"), "prompt carries the report contract");
    return okReport;
  },
});
// This process is NOT on the profile-owning machine ("test-machine") and has
// no page reader — the claim is "deferred", never silently trusted: the
// caller records it posted-unverified and the owning machine's monitor
// promotes or refutes it.
assert.deepEqual(posted, { externalId: "123456", url: "https://www.facebook.com/marketplace/item/123456", verification: "deferred" });
// With an independent page reader the same claim verifies in-process (fast path).
const postedVerified = await facebookMarketplaceAdapter.createListing(account, listing, "mdec_ok", {
  dispatchAgentTaskImpl: async () => okReport,
  readBrowserTabImpl: async (profileName, url) => ({ url, text: "Marketplace · Test bike · $100 · A bike" }),
});
assert.equal(postedVerified.verification, "verified");
await assert.rejects(
  () =>
    facebookMarketplaceAdapter.createListing(account, listing, "mdec_ok", {
      dispatchAgentTaskImpl: async () => ({ conversations: [], replies: [], escalations: [], sessionHealth: "logged-out" }),
    }),
  /signed out/i,
  "logged-out session surfaces a reconnect error",
);

// ── per-op refutation spec: every dispatched op declares its check ──────────
const { MARKETPLACE_OP_VERIFICATION_SPEC, verifyMarketplaceOpClaim } = await import(
  "../src/lib/services/marketplace/marketplace-verification-matrix.ts"
);
const { MARKETPLACE_AGENT_OPS } = await import("../src/lib/services/marketplace/adapters/types.ts");
for (const op of MARKETPLACE_AGENT_OPS) {
  const row = MARKETPLACE_OP_VERIFICATION_SPEC[op];
  assert.ok(row, `verification spec row exists: ${op}`);
  assert.equal(row.op, op, `row self-identifies: ${op}`);
  assert.equal(typeof row.verify, "function", `row declares its refutation check: ${op}`);
  assert.ok(row.refutes, `row documents what it refutes: ${op}`);
}
// A null reader is ALWAYS "unobservable" — never a silent pass.
const unobservable = await verifyMarketplaceOpClaim(null, "marketplace-facebook", { op: "end-listing", url: "https://www.facebook.com/marketplace/item/1" });
assert.equal(unobservable.outcome, "unobservable");

// ── end-listing: a fabricated "ok" is refuted by the still-live page ────────
const endOk = { conversations: [], replies: [], escalations: [], sessionHealth: "ok" };
const deadPage = async (profileName, url) => ({ url, text: "This content isn't available right now" });
const livePage = async (profileName, url) => ({ url, text: "Marketplace · Test bike · $100 · Send seller a message" });
const ended = await facebookMarketplaceAdapter.endListing(account, "123456", {
  dispatchAgentTaskImpl: async (input) => {
    assert.equal(input.op, "end-listing");
    return endOk;
  },
  readBrowserTabImpl: deadPage,
});
assert.deepEqual(ended, { verification: "verified" }, "a dead listing page proves the end really happened");
await assert.rejects(
  () => facebookMarketplaceAdapter.endListing(account, "123456", { dispatchAgentTaskImpl: async () => endOk, readBrowserTabImpl: livePage }),
  /FAILED independent verification/i,
  "a still-live page refutes the claimed end — never accepted on trust",
);
const endedDeferred = await facebookMarketplaceAdapter.endListing(account, "123456", { dispatchAgentTaskImpl: async () => endOk });
assert.deepEqual(endedDeferred, { verification: "deferred" }, "an unobservable end defers to the owning machine's monitor");

// ── the base-cadence sweep is ONE dispatched session ────────────────────────
const sweepDispatches = [];
const sweepReport = { conversations: [], replies: [], escalations: [], catalog: [], sessionHealth: "ok" };
const sweep = await facebookMarketplaceAdapter.workInbox(
  account,
  { directives: [], listings: [], fullSweep: true },
  {
    dispatchAgentTaskImpl: async (input) => {
      sweepDispatches.push(input);
      return sweepReport;
    },
  },
);
assert.equal(sweep, sweepReport);
assert.equal(sweepDispatches.length, 1, "catalog + inbox ride ONE dispatch, not two queen round-trips");
assert.equal(sweepDispatches[0].op, "work-inbox");
assert.match(sweepDispatches[0].prompt, /catalogue EVERY listing/, "the single session catalogues the selling page");
assert.match(sweepDispatches[0].prompt, /Then open the Marketplace inbox/, "then works the inbox");
const plainInbox = [];
await facebookMarketplaceAdapter.workInbox(
  account,
  { directives: [], listings: [] },
  { dispatchAgentTaskImpl: async (input) => (plainInbox.push(input), sweepReport) },
);
assert.ok(!/catalogue EVERY listing/.test(plainInbox[0].prompt), "a hot-rung inbox session does not re-catalogue");

// ---------------------------------------------------------------------------
// Listing-state consumer completeness (source-text contracts — these files
// can't be imported hermetically: JSX / next/server).
// ---------------------------------------------------------------------------

// Every listing state must be surfaced by some catalog filter bucket besides
// "all" — a state missing from matchesFilter silently hides those listings
// (posted-unverified had this exact gap).
const catalogGrid = await readFile(new URL("../src/features/dashboard/views/marketplace/CatalogGrid.tsx", import.meta.url), "utf8");
const matchesFilterStart = catalogGrid.indexOf("function matchesFilter");
assert.ok(matchesFilterStart >= 0, "CatalogGrid declares matchesFilter");
const matchesFilterEnd = catalogGrid.indexOf("\nfunction ", matchesFilterStart + 1);
const matchesFilterBody = catalogGrid.slice(matchesFilterStart, matchesFilterEnd === -1 ? undefined : matchesFilterEnd);
for (const state of MARKETPLACE_LISTING_STATES) {
  assert.ok(matchesFilterBody.includes(`"${state}"`), `catalog filter buckets surface listing state "${state}" outside "all"`);
}

// The delete-draft guard must block every state in which the listing may
// already be live on the marketplace — deleting a posted-unverified record
// would orphan a possibly-live post from the monitor's verification sweep.
const listingsRoute = await readFile(new URL("../src/app/api/marketplace/listings/route.ts", import.meta.url), "utf8");
const deleteDraftStart = listingsRoute.indexOf('case "delete-draft"');
assert.ok(deleteDraftStart >= 0, "listings route handles delete-draft");
const deleteDraftEnd = listingsRoute.indexOf("case ", deleteDraftStart + 1);
const deleteDraftBlock = listingsRoute.slice(deleteDraftStart, deleteDraftEnd === -1 ? undefined : deleteDraftEnd);
for (const state of ["active", "posting", "posted-unverified"]) {
  assert.ok(deleteDraftBlock.includes(`"${state}"`), `delete-draft guard blocks may-be-live state "${state}"`);
}

console.log("marketplace matrix tests passed");
