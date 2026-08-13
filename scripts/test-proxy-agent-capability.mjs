#!/usr/bin/env node
// Hermetic coverage for capability enforcement in the API proxy.
//
// This is the piece that makes an authority level bite: without it an agent's
// level is recorded but every /api route still executes whatever it asks for.
//
// Scope is deliberately partial and asserted as such. The generated policy covers
// routes served by exactly ONE hive action; routes serving several actions at
// differing risk are skipped because the action is chosen by the request body,
// which middleware cannot read. The tests below pin both the enforcement AND the
// gap, so the gap cannot quietly become an assumption that everything is covered.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "p".repeat(48);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "d".repeat(32);
process.env.HIVEMINDOS_AGENT_SCOPED_PERMISSIONS = "1";

const { proxy } = await import("../src/proxy.ts");
const auth = await import("../src/lib/utils/server-auth.ts");
const policy = await import("../src/lib/services/security/hive-action-route-policy.generated.ts");
const { NextRequest } = await import("next/server");

const DEVICE = "d".repeat(32);

function request(pathname, headers) {
  return new NextRequest(new URL(`http://local.test${pathname}`), { headers });
}

async function callAs(pathname, headers) {
  const response = await proxy(request(pathname, headers));
  return { status: response.status, body: response.status === 403 ? await response.clone().json() : null };
}

// Pick real routes out of the generated policy rather than hardcoding ids, so
// this suite keeps testing something real as the catalog changes.
const readOnlyLow = policy.HIVE_ACTION_ROUTE_POLICIES.find(
  (entry) => entry.readOnly && entry.risk === "low" && entry.requiredClaims.length > 0,
);
const gated = policy.HIVE_ACTION_ROUTE_POLICIES.find(
  (entry) => entry.confirmation && entry.confirmation.when !== "unless-auto-policy-allows",
);
assert.ok(readOnlyLow, "expected at least one read-only low-risk route in the policy");
assert.ok(gated, "expected at least one confirmation-gated route in the policy");

const standardToken = await auth.mintAgentAuthToken("worker-1", "standard");
const autonomousToken = await auth.mintAgentAuthToken("ceo-1", "autonomous");
const restrictedToken = await auth.mintAgentAuthToken("reader-1", "restricted");

// ------------------------------------------------------------- the operator
{
  // The local operator is untouched by any of this — local:admin short-circuits.
  const result = await callAs(gated.route, { [auth.DASHBOARD_AUTH_HEADER]: DEVICE });
  assert.notEqual(result.status, 403, "the operator must never be blocked by agent capability enforcement");
}

// -------------------------------------------------------- a standard agent
{
  const allowed = await callAs(readOnlyLow.route, { [auth.AGENT_AUTH_HEADER]: standardToken });
  assert.notEqual(allowed.status, 403, `${readOnlyLow.route} is ordinary work and must pass`);

  const blocked = await callAs(gated.route, { [auth.AGENT_AUTH_HEADER]: standardToken });
  assert.equal(blocked.status, 403, `${gated.route} carries a confirmation contract and must be gated`);
  assert.equal(blocked.body.status, "needs-approval");
  assert.equal(blocked.body.action, gated.actionId, "the response names the action, not just the route");
  // 403 and not 401: the caller authenticated fine. A 401 would invite an
  // endless credential retry that can never succeed.
  assert.match(blocked.body.error, /needs human approval/i);
}

// ------------------------------------------------------ an autonomous agent
{
  // Full authority still cannot clear an always-confirmation — the money gate.
  const blocked = await callAs(gated.route, { [auth.AGENT_AUTH_HEADER]: autonomousToken });
  assert.equal(blocked.status, 403, "an always-confirmation holds even for an autonomous agent");
}

// ------------------------------------------------------ a restricted agent
{
  // A read-only agent is denied outright, and the denial names what it lacks.
  const writeRoute = policy.HIVE_ACTION_ROUTE_POLICIES.find(
    (entry) => entry.requiredClaims.includes("local:write") && !entry.confirmation,
  );
  if (writeRoute) {
    const blocked = await callAs(writeRoute.route, { [auth.AGENT_AUTH_HEADER]: restrictedToken });
    assert.equal(blocked.status, 403, `${writeRoute.route} writes and must be denied to a read-only agent`);
    assert.equal(blocked.body.status, "deny");
    assert.ok(blocked.body.requiredClaims.length > 0, "the denial reports which claims were missing");
  }
}

// ------------------------------------------------------------ unknown routes
{
  // A route with no policy entry must pass through rather than fail closed:
  // most of /api is not a hive action, and blocking it would break the app.
  const result = await callAs("/api/definitely-not-a-hive-action", {
    [auth.AGENT_AUTH_HEADER]: standardToken,
  });
  assert.notEqual(result.status, 403, "non-action routes are not gated by this mechanism");
}

// ------------------------------------------------------------- the gap
{
  // Ambiguous routes are NOT enforced here. Pinning this stops the partial
  // coverage from being mistaken for full coverage later.
  assert.ok(policy.AMBIGUOUS_HIVE_ACTION_ROUTES.length > 0, "there are known ambiguous routes");
  for (const entry of policy.AMBIGUOUS_HIVE_ACTION_ROUTES) {
    assert.equal(
      policy.hiveActionRoutePolicy(entry.route),
      null,
      `${entry.route} serves ${entry.actionIds.length} actions and must not be enforced from the route alone`,
    );
    assert.ok(entry.actionIds.length > 1, "an ambiguous route serves more than one action by definition");
  }
}

// ---------------------------------------------------------------- flag off
{
  process.env.HIVEMINDOS_AGENT_SCOPED_PERMISSIONS = "0";
  // With the flag off the agent token is ignored, so the request resolves as the
  // operator and enforcement cannot apply.
  const result = await callAs(gated.route, {
    [auth.AGENT_AUTH_HEADER]: standardToken,
    [auth.DASHBOARD_AUTH_HEADER]: DEVICE,
  });
  assert.notEqual(result.status, 403, "with the flag off nothing is enforced");
  process.env.HIVEMINDOS_AGENT_SCOPED_PERMISSIONS = "1";
}

console.log(
  `Proxy agent capability tests passed (${policy.HIVE_ACTION_ROUTE_POLICIES.length} enforced routes, `
  + `${policy.AMBIGUOUS_HIVE_ACTION_ROUTES.length} ambiguous and intentionally unenforced).`,
);
