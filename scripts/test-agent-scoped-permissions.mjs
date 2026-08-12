#!/usr/bin/env node
// Hermetic coverage for agent-scoped permissions: the signed per-agent token and
// the flag that gates it.
//
// Two properties carry the security weight:
//   1. With the flag OFF the agent header is ignored completely, so enabling the
//      feature is deliberate and disabling it is a total rollback.
//   2. With the flag ON, a caller presenting an agent token CANNOT fall through
//      to full operator authority by also holding the device token. Otherwise the
//      authority level is bypassable by anything that can read the device token —
//      which today is every agent on the machine.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// Must be set BEFORE importing: the module reads these at call time, but the
// dashboard-auth status gate refuses to run without them.
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "x".repeat(48);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "d".repeat(32);
delete process.env.HIVEMINDOS_AGENT_SCOPED_PERMISSIONS;

const auth = await import("../src/lib/utils/server-auth.ts");
const { LOCAL_ADMIN_CLAIM } = await import("../src/lib/types/principal.ts");

const NOW = 1_800_000_000_000;
const req = (headers) => new Request("https://local.test/api/thing", { headers });

// ------------------------------------------------------------- mint/verify
const token = await auth.mintAgentAuthToken("agent-ceo", "autonomous", NOW);
const verified = await auth.verifyAgentAuthToken(token, NOW);
assert.deepEqual(verified, { agentId: "agent-ceo", preset: "autonomous" });

// A token must not be self-upgradable: rewriting the preset breaks the signature.
const [v, id, , issued, sig] = token.split(".");
const forged = [v, id, "autonomous", issued, sig].join(".");
assert.ok(await auth.verifyAgentAuthToken(forged, NOW), "control: unmodified token verifies");
const standardToken = await auth.mintAgentAuthToken("agent-worker", "standard", NOW);
const [sv, sid, , sissued, ssig] = standardToken.split(".");
const upgraded = [sv, sid, "autonomous", sissued, ssig].join(".");
assert.equal(
  await auth.verifyAgentAuthToken(upgraded, NOW),
  null,
  "an agent must not be able to raise its own authority by editing the token",
);

// Nor may it impersonate another agent.
const impersonated = [sv, "agent-ceo", "standard", sissued, ssig].join(".");
assert.equal(await auth.verifyAgentAuthToken(impersonated, NOW), null, "agent id is signed");

// Expiry, and no future-dating around it.
assert.ok(await auth.verifyAgentAuthToken(token, NOW + 11 * 3_600_000), "still valid inside the TTL");
assert.equal(await auth.verifyAgentAuthToken(token, NOW + 13 * 3_600_000), null, "expires after the TTL");
const future = await auth.mintAgentAuthToken("agent-x", "standard", NOW + 86_400_000);
assert.equal(await auth.verifyAgentAuthToken(future, NOW), null, "future-dated tokens are rejected");

// Garbage in, null out — never a throw on the auth path.
for (const bad of ["", "nonsense", "a1.x.standard.notanumber.sig", "a1.x.wizard.1.sig", `${token}.extra`]) {
  assert.equal(await auth.verifyAgentAuthToken(bad, NOW), null, `rejected: ${bad}`);
}
await assert.rejects(() => auth.mintAgentAuthToken("has.dot", "standard", NOW), /must not contain a dot/);
await assert.rejects(() => auth.mintAgentAuthToken("   ", "standard", NOW), /Agent id is required/);

// verifyAuth reads the real clock, so the request-path tests need tokens minted
// at real time — the fixed NOW above is far enough ahead that the future-dating
// guard would (correctly) reject those tokens here.
const liveToken = await auth.mintAgentAuthToken("agent-ceo", "autonomous");
const liveStandardToken = await auth.mintAgentAuthToken("agent-worker", "standard");
const liveForged = (() => {
  const [fv, fid, , fissued, fsig] = liveStandardToken.split(".");
  return [fv, fid, "autonomous", fissued, fsig].join(".");
})();

// --------------------------------------------------------------- flag OFF
assert.equal(auth.agentScopedPermissionsEnabled(), false, "the flag defaults to off");
{
  const result = await auth.verifyAuth(req({
    [auth.AGENT_AUTH_HEADER]: liveToken,
    [auth.DASHBOARD_AUTH_HEADER]: "d".repeat(32),
  }));
  assert.equal(result.userId, "local-user", "with the flag off the agent header is ignored");
  assert.ok(
    result.principal.claims.includes(LOCAL_ADMIN_CLAIM),
    "with the flag off behavior is byte-for-byte the operator path",
  );
}

// ---------------------------------------------------------------- flag ON
process.env.HIVEMINDOS_AGENT_SCOPED_PERMISSIONS = "1";
assert.equal(auth.agentScopedPermissionsEnabled(), true);
{
  const result = await auth.verifyAuth(req({ [auth.AGENT_AUTH_HEADER]: liveToken }));
  assert.equal(result.userId, "agent:agent-ceo");
  assert.equal(result.principal.kind, "runtime-agent");
  assert.equal(result.principal.principalId, "agent:agent-ceo");
  assert.equal(
    result.principal.claims.includes(LOCAL_ADMIN_CLAIM),
    false,
    "an agent principal must never carry the operator short-circuit claim",
  );
  assert.ok(result.principal.claims.includes("actions:approve"), "autonomous agents self-approve");
}
{
  // A standard agent gets a narrower principal than an autonomous one.
  const standard = await auth.verifyAuth(req({ [auth.AGENT_AUTH_HEADER]: liveStandardToken }));
  assert.equal(standard.principal.claims.includes("actions:approve"), false);
}
{
  // THE bypass test. Holding the device token must not upgrade an agent.
  const result = await auth.verifyAuth(req({
    [auth.AGENT_AUTH_HEADER]: liveToken,
    [auth.DASHBOARD_AUTH_HEADER]: "d".repeat(32),
  }));
  assert.equal(result.principal.kind, "runtime-agent", "device token must not upgrade an agent to operator");
  assert.equal(result.principal.claims.includes(LOCAL_ADMIN_CLAIM), false);
}
{
  // An invalid agent token is a hard failure, not a fallthrough to operator.
  const result = await auth.verifyAuth(req({
    [auth.AGENT_AUTH_HEADER]: liveForged,
    [auth.DASHBOARD_AUTH_HEADER]: "d".repeat(32),
  }));
  assert.equal(result.userId, null, "a forged agent token must not fall through to operator auth");
  assert.match(result.reason ?? "", /invalid or expired/i);
}
{
  // No agent header at all still resolves the operator normally.
  const result = await auth.verifyAuth(req({ [auth.DASHBOARD_AUTH_HEADER]: "d".repeat(32) }));
  assert.equal(result.userId, "local-user");
  assert.ok(result.principal.claims.includes(LOCAL_ADMIN_CLAIM));
}

console.log("Agent-scoped permission tests passed.");
