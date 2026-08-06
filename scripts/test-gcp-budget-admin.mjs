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
const budgetDomain = await import("../src/lib/services/company-api-budget.ts");

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

const editedBudget = budgetDomain.preserveCompanyApiBudgetProviderState(
  { ...SAMPLE_BUDGET, monthlyCeilingUsd: 300 },
  { ...SAMPLE_BUDGET, budgetResourceName: "billingAccounts/AAAA-BBBB-CCCC/budgets/budget-xyz" },
);
assert.equal(
  editedBudget.budgetResourceName,
  "billingAccounts/AAAA-BBBB-CCCC/budgets/budget-xyz",
  "a client-authored edit must retain the server-owned resource name for PATCH",
);
assert.equal(
  budgetDomain.sameCompanyApiBudgetScope(SAMPLE_BUDGET, { ...SAMPLE_BUDGET, projectId: "another-project" }),
  false,
  "the same API in another project is a distinct company budget",
);

// ── Record every fetch call so we can assert URLs + bodies + auth header ──
const calls = [];
let mintCount = 0;

function makeFetch() {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    // Both surfaces (Service Usage + Billing Budgets) return a JSON resource.
    const body =
      String(url).includes(":importConsumerOverrides")
        ? { name: "operations/quota-override-op-1", done: true }
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

const overrideCall = calls.find((c) => c.url.includes(":importConsumerOverrides"));
const budgetCall = calls.find((c) => c.url.includes("/budgets"));
assert.ok(overrideCall, "a consumerOverrides call must be made");
assert.ok(budgetCall, "a budgets call must be made");

// ── Override import: provider-documented atomic create-or-update path. ──
assert.equal(
  overrideCall.url,
  "https://serviceusage.googleapis.com/v1beta1/projects/maps-agency-42/services/places.googleapis.com" +
    "/consumerQuotaMetrics:importConsumerOverrides",
  "quota edits must use Google's atomic create-or-update import endpoint",
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
  {
    force: true,
    inlineSource: {
      overrides: [{
        metric: "places.googleapis.com/SearchTextRequest",
        unit: "1/d/{project}",
        overrideValue: "1000",
        dimensions: {},
      }],
    },
  },
  "override import must carry the metric, unit, int64 value, and global dimensions",
);

// ── Budget create URL + body. ──
assert.equal(
  budgetCall.url,
  "https://billingbudgets.googleapis.com/v1/billingAccounts/AAAA-BBBB-CCCC/budgets",
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
  { projects: ["projects/123456789"] },
  "budget filter must use the numeric project resource required by Cloud Billing",
);
assert.ok(Array.isArray(budgetBody.thresholdRules) && budgetBody.thresholdRules.length > 0, "threshold rules required");

// ── Re-apply with a budgetResourceName set must PATCH in place, not create. ──
const patchCalls = [];
const patchDeps = {
  mintToken: async () => "ya29.FAKE-ACCESS-TOKEN",
  fetchImpl: async (url, init) => {
    patchCalls.push({ url: String(url), init });
    if (String(url).includes(":importConsumerOverrides")) {
      return new Response(JSON.stringify({ name: "operations/quota-patch-op-1", done: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
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

// ── Quota apply waits for the provider's long-running operation instead
//    of marking a submitted-but-failed update as applied. ──
const operationCalls = [];
const operationResult = await admin.applyCompanyApiBudget(SAMPLE_BUDGET, {
  mintToken: async () => "ya29.FAKE-ACCESS-TOKEN",
  sleep: async () => {},
  fetchImpl: async (url) => {
    operationCalls.push(String(url));
    if (String(url).includes(":importConsumerOverrides")) {
      return new Response(JSON.stringify({ name: "operations/quota-wait-op-1", done: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).endsWith("/operations/quota-wait-op-1")) {
      return new Response(JSON.stringify({ name: "operations/quota-wait-op-1", done: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ name: "billingAccounts/AAAA-BBBB-CCCC/budgets/budget-xyz" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});
assert.deepEqual(operationResult.errors, [], "a completed quota operation is applied successfully");
assert.ok(
  operationCalls.some((url) => url.endsWith("/v1beta1/operations/quota-wait-op-1")),
  "the apply path polls the provider operation to completion",
);

// ── Structured UI discovery: enabled services and the project's linked billing
//    account are discoverable without asking the user to type identifiers. ──
const discoveryCalls = [];
const discoveryDeps = {
  mintToken: async () => "ya29.FAKE-ACCESS-TOKEN",
  fetchImpl: async (url) => {
    discoveryCalls.push(String(url));
    if (String(url).includes("/billingInfo")) {
      return new Response(JSON.stringify({
        projectId: "maps-agency-42",
        billingAccountName: "billingAccounts/AAAA-BBBB-CCCC",
        billingEnabled: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ services: [
      { config: { name: "places.googleapis.com", title: "Places API (New)" }, state: "ENABLED" },
      { config: { name: "serviceusage.googleapis.com", title: "Service Usage API" }, state: "ENABLED" },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
};
const services = await admin.listGcpEnabledServices("maps-agency-42", discoveryDeps);
assert.deepEqual(services, [
  { name: "places.googleapis.com", title: "Places API (New)" },
  { name: "serviceusage.googleapis.com", title: "Service Usage API" },
]);
const billingInfo = await admin.getGcpProjectBillingInfo("maps-agency-42", discoveryDeps);
assert.deepEqual(billingInfo, {
  projectId: "maps-agency-42",
  billingAccountName: "billingAccounts/AAAA-BBBB-CCCC",
  billingEnabled: true,
});
assert.ok(discoveryCalls.some((url) => url.includes("filter=state%3AENABLED")), "service discovery filters to enabled APIs");

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

// ── enableGcpService: strict allowlist — the discovery/guardrail APIs plus the
//    two Places surfaces, NEVER a free-form service enabler. ──
for (const allowed of [
  "cloudresourcemanager.googleapis.com",
  "cloudbilling.googleapis.com",
  "billingbudgets.googleapis.com",
  "serviceusage.googleapis.com",
  "places.googleapis.com",
  "places-backend.googleapis.com",
]) {
  assert.equal(admin.isEnableableGcpService(allowed), true, `${allowed} must be enableable`);
}
assert.equal(admin.isEnableableGcpService("compute.googleapis.com"), false, "never a free-form service enabler");
assert.equal(admin.isEnableableGcpService(""), false);
assert.equal(admin.ENABLEABLE_GCP_SERVICES.length, 6, "the allowlist is exactly the six known services");

// ── Single-shot enable: v1 services:enable, POST, bearer token, EMPTY body. ──
{
  const enableCalls = [];
  await admin.enableGcpService("maps-agency-42", "cloudresourcemanager.googleapis.com", {
    mintToken: async () => "ya29.FAKE-ACCESS-TOKEN",
    fetchImpl: async (url, init) => {
      enableCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ name: "operations/enable-op-1", done: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(enableCalls.length, 1, "a done operation needs no polling");
  assert.equal(
    enableCalls[0].url,
    "https://serviceusage.googleapis.com/v1/projects/maps-agency-42/services/cloudresourcemanager.googleapis.com:enable",
    "enable must POST the v1 services:enable resource",
  );
  assert.equal(enableCalls[0].init.method, "POST", "enable must be a POST");
  assert.equal(enableCalls[0].init.headers.Authorization, "Bearer ya29.FAKE-ACCESS-TOKEN");
  assert.equal(enableCalls[0].init.body, undefined, "docs: the enable request body must be empty");
}

// ── Not-done operation is short-polled on the v1 surface (not v1beta1). ──
{
  const urls = [];
  await admin.enableGcpService("123456789", "cloudbilling.googleapis.com", {
    mintToken: async () => "ya29.FAKE-ACCESS-TOKEN",
    fetchImpl: async (url) => {
      urls.push(String(url));
      const body = urls.length === 1
        ? { name: "operations/enable-op-2", done: false }
        : { name: "operations/enable-op-2", done: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    sleep: async () => {},
  });
  assert.equal(urls.length, 2, "a pending operation must be polled to done");
  assert.equal(
    urls[1],
    "https://serviceusage.googleapis.com/v1/operations/enable-op-2",
    "the enable operation must be polled on the v1 surface",
  );
}

// ── Provider refusal throws (the bootstrap case: Service Usage itself
//    disabled / permission denied) — the UI shows the console-link fallback. ──
await assert.rejects(
  admin.enableGcpService("maps-agency-42", "places.googleapis.com", {
    mintToken: async () => "ya29.FAKE-ACCESS-TOKEN",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ error: { message: "Service Usage API has not been used in project 123 before or it is disabled." } }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
  }),
  /Google API 403/,
);
await assert.rejects(admin.enableGcpService("", "places.googleapis.com"), /project/i);
await assert.rejects(admin.enableGcpService("maps-agency-42", ""), /service/i);

// ── The route must gate the enable action on the allowlist (text pin). ──
const { readFileSync } = await import("node:fs");
const budgetRoute = readFileSync(new URL("../src/app/api/companies/[id]/api-budget/route.ts", import.meta.url), "utf8");
assert.match(budgetRoute, /action === "enable-gcp-service"/);
assert.match(budgetRoute, /isEnableableGcpService\(service\)/, "the route must reject non-allowlisted services");
assert.match(budgetRoute, /enableGcpService\(projectRef, service\)/);

console.log("test-gcp-budget-admin: OK");
