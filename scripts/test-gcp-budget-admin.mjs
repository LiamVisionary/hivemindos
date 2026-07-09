#!/usr/bin/env node
// Hermetic mocked-fetch test for the Google Cloud cost-guardrail apply backend
// (src/lib/services/gcp-budget-admin.ts). Native TS type-stripping + `@/` alias
// + `server-only` stub via the shared TS-relative loader; global fetch and the
// OAuth token minter are stubbed, so no network and no real Google account.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const admin = await import("../src/lib/services/gcp-budget-admin.ts");

const SAMPLE_BUDGET = {
  provider: "gcp",
  service: "places.googleapis.com",
  projectId: "maps-agency-42",
  projectNumber: "123456789",
  billingAccount: "billingAccounts/AAAA-BBBB-CCCC",
  monthlyCeilingUsd: 250,
  dailyCaps: [
    { metric: "places.googleapis.com/SearchTextRequest", value: 1000, unit: "1/d/{project}" },
  ],
};

// ── Record every fetch call so we can assert URLs + bodies + auth header ──
const calls = [];
let mintCount = 0;

function makeFetch() {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    // Both surfaces (Service Usage + Billing Budgets) return a JSON resource.
    const body =
      String(url).includes("/consumerOverrides")
        ? { name: "operations/quota-override-op-1" }
        : { name: "billingAccounts/AAAA-BBBB-CCCC/budgets/budget-xyz" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const deps = {
  mintToken: async () => {
    mintCount += 1;
    return "ya29.FAKE-ACCESS-TOKEN";
  },
  fetchImpl: makeFetch(),
  now: () => new Date("2026-07-09T00:00:00.000Z"),
};

const result = await admin.applyCompanyApiBudget(SAMPLE_BUDGET, deps);

// ── Token is fetched via the mint helper exactly once, and the returned apply
//    result is clean (no errors) with the created budget resource name. ──
assert.equal(mintCount, 1, "the OAuth access token must be minted via the mint helper");
assert.deepEqual(result.errors, [], `apply should have no errors, got: ${JSON.stringify(result.errors)}`);
assert.equal(result.appliedAt, "2026-07-09T00:00:00.000Z", "appliedAt should come from the injected clock");
assert.equal(
  result.budgetResourceName,
  "billingAccounts/AAAA-BBBB-CCCC/budgets/budget-xyz",
  "budget resource name should be returned for in-place re-applies",
);

// ── Exactly two calls: one quota override, one budget create. ──
assert.equal(calls.length, 2, `expected 2 fetch calls (1 override + 1 budget), got ${calls.length}`);

const overrideCall = calls.find((c) => c.url.includes("/consumerOverrides"));
const budgetCall = calls.find((c) => c.url.includes("/budgets"));
assert.ok(overrideCall, "a consumerOverrides call must be made");
assert.ok(budgetCall, "a budgets call must be made");

// ── Override URL: exact parent path with URL-encoded metric + limit id, force=true. ──
assert.equal(
  overrideCall.url,
  "https://serviceusage.googleapis.com/v1beta1/projects/maps-agency-42/services/places.googleapis.com" +
    "/consumerQuotaMetrics/places.googleapis.com%2FSearchTextRequest/limits/%2Fd%2F%7Bproject%7D" +
    "/consumerOverrides?force=true",
  "override URL must encode the metric + limit id and set force=true",
);
assert.equal(overrideCall.init.method, "POST", "override must be a POST");
assert.equal(
  overrideCall.init.headers.Authorization,
  "Bearer ya29.FAKE-ACCESS-TOKEN",
  "override must send the minted bearer token",
);
const overrideBody = JSON.parse(overrideCall.init.body);
assert.deepEqual(
  overrideBody,
  { overrideValue: "1000", dimensions: {} },
  "override body must be { overrideValue: '<int64 string>', dimensions: {} }",
);

// ── Budget create URL + body. ──
assert.equal(
  budgetCall.url,
  "https://billingbudgets.googleapis.com/v1/billingAccounts/billingAccounts%2FAAAA-BBBB-CCCC/budgets",
  "budget create URL must post under the billing account's budgets collection",
);
assert.equal(budgetCall.init.method, "POST", "budget create must be a POST");
assert.equal(
  budgetCall.init.headers.Authorization,
  "Bearer ya29.FAKE-ACCESS-TOKEN",
  "budget create must send the minted bearer token",
);
const budgetBody = JSON.parse(budgetCall.init.body);
assert.equal(budgetBody.amount.specifiedAmount.currencyCode, "USD");
assert.equal(budgetBody.amount.specifiedAmount.units, "250", "monthly ceiling must be a whole-unit int64 string");
assert.deepEqual(
  budgetBody.budgetFilter,
  { projects: ["projects/maps-agency-42"] },
  "budget filter must scope to the project",
);
assert.ok(Array.isArray(budgetBody.thresholdRules) && budgetBody.thresholdRules.length > 0, "threshold rules required");

// ── Re-apply with a budgetResourceName set must PATCH in place, not create. ──
const patchCalls = [];
const patchDeps = {
  mintToken: async () => "ya29.FAKE-ACCESS-TOKEN",
  fetchImpl: async (url, init) => {
    patchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ name: "billingAccounts/AAAA-BBBB-CCCC/budgets/budget-xyz" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
  now: () => new Date("2026-07-09T00:00:00.000Z"),
};
const reapply = await admin.applyCompanyApiBudget(
  { ...SAMPLE_BUDGET, budgetResourceName: "billingAccounts/AAAA-BBBB-CCCC/budgets/budget-xyz" },
  patchDeps,
);
assert.deepEqual(reapply.errors, [], "re-apply should have no errors");
const patchBudgetCall = patchCalls.find((c) => c.url.includes("/budgets/budget-xyz"));
assert.ok(patchBudgetCall, "re-apply must target the existing budget resource name");
assert.equal(patchBudgetCall.init.method, "PATCH", "an existing budget must be PATCHed, not re-created");
assert.match(patchBudgetCall.url, /updateMask=/, "budget PATCH must send an updateMask");

// ── A minter failure must surface as a sanitized error, not throw, and must
//    not leak the token. ──
const failResult = await admin.applyCompanyApiBudget(SAMPLE_BUDGET, {
  mintToken: async () => {
    throw new Error("No Google Cloud account is connected.");
  },
  fetchImpl: async () => {
    throw new Error("fetch should not be called when the token cannot be minted");
  },
  now: () => new Date("2026-07-09T00:00:00.000Z"),
});
assert.equal(failResult.errors.length, 1, "a mint failure should be collected as one error");
assert.match(failResult.errors[0], /no google cloud account is connected/i, "mint failure should be surfaced");

// ── A fetch error must be sanitized to strip any bearer token substring. ──
const leakResult = await admin.applyCompanyApiBudget(SAMPLE_BUDGET, {
  mintToken: async () => "ya29.SECRET-TOKEN-XYZ",
  fetchImpl: async () => {
    throw new Error("upstream said Bearer ya29.SECRET-TOKEN-XYZ was rejected");
  },
  now: () => new Date("2026-07-09T00:00:00.000Z"),
});
const joined = JSON.stringify(leakResult.errors);
assert.doesNotMatch(joined, /ya29\.SECRET-TOKEN-XYZ/, "the access token must never leak into error output");

console.log("test-gcp-budget-admin: OK");
