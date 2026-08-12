#!/usr/bin/env node
// Hermetic coverage for per-agent authority presets and the tuned approval rungs.
//
// Measured against the REAL hive action catalog, so a new action that changes the
// operator's approval load shows up here as a failing count rather than as a
// surprise flood in the Needs You lane.
//
// The load-bearing safety property: no preset, and no permission mode, may skip a
// per-action `confirmation` gate unless that action opted in via
// `when: "unless-auto-policy-allows"`. An agent granted full authority can run the
// company; it must not be able to silently move money.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { authorizeOperation } = await import("../src/lib/services/security/action-authorization.ts");
const {
  agentAuthorityProfile,
  normalizeAgentAuthorityPreset,
  runtimeAgentPrincipal,
  AGENT_AUTHORITY_PRESETS,
  DEFAULT_AGENT_AUTHORITY,
} = await import("../src/lib/services/security/agent-authority.ts");
const { listHiveActions } = await import("../src/lib/services/hive-actions/index.ts");
const { localAdminPrincipal, LOCAL_ADMIN_CLAIM } = await import("../src/lib/types/principal.ts");

const catalog = listHiveActions();
const asOperation = (a) => ({
  id: a.id,
  title: a.title,
  sideEffects: a.sideEffects,
  risk: a.risk,
  readOnly: a.readOnly,
  confirmation: a.confirmation,
});

function tally(principal, permissionMode) {
  const counts = { allow: 0, deny: 0, "needs-approval": 0 };
  const gated = [];
  for (const action of catalog) {
    const decision = authorizeOperation(asOperation(action), { principal, permissionMode });
    counts[decision.status] += 1;
    if (decision.status === "needs-approval") gated.push(action);
  }
  return { counts, gated };
}

const forPreset = (preset) => {
  const profile = agentAuthorityProfile(preset);
  const principal = runtimeAgentPrincipal({ agentId: "a1", displayName: "A", preset });
  return { profile, ...tally(principal, profile.permissionMode) };
};

// ---------------------------------------------------------------- presets
assert.deepEqual([...AGENT_AUTHORITY_PRESETS], ["restricted", "standard", "autonomous"]);
assert.equal(DEFAULT_AGENT_AUTHORITY, "standard");
assert.equal(normalizeAgentAuthorityPreset("nonsense"), "standard", "unknown presets fall back to standard");
assert.equal(normalizeAgentAuthorityPreset("autonomous"), "autonomous");

// No preset may grant local:admin — that claim short-circuits every check and
// would silently disable the authority system entirely.
for (const preset of AGENT_AUTHORITY_PRESETS) {
  const principal = runtimeAgentPrincipal({ agentId: "a1", preset });
  assert.equal(principal.claims.includes(LOCAL_ADMIN_CLAIM), false, `${preset} must not grant local:admin`);
  assert.equal(principal.kind, "runtime-agent");
  assert.equal(principal.principalId, "agent:a1", "principal id is server-derived from the agent record");
}

// Only the autonomous preset is its own approver.
assert.equal(agentAuthorityProfile("restricted").selfApproves, false);
assert.equal(agentAuthorityProfile("standard").selfApproves, false);
assert.equal(agentAuthorityProfile("autonomous").selfApproves, true);
assert.equal(agentAuthorityProfile("standard").claims.includes("actions:approve"), false);
assert.ok(agentAuthorityProfile("autonomous").claims.includes("actions:approve"));

// ------------------------------------------------------------ restricted
const restricted = forPreset("restricted");
assert.equal(restricted.counts["needs-approval"], 0, "a read-only agent is denied outright, never queued for approval");
assert.ok(restricted.counts.deny > 0, "a read-only agent must be denied privileged actions");
assert.ok(restricted.counts.allow > 0, "a read-only agent must still be able to read");

// -------------------------------------------------------------- standard
const standard = forPreset("standard");
assert.equal(standard.counts.deny, 0, "a standard agent must have no hard denials");
assert.ok(standard.counts.allow > standard.counts["needs-approval"], "ordinary work should outnumber approvals");

// The tuning that matters: purely local mutation is the job, not an approval.
// Before this, medium-risk fired on any non-read/network side effect, sweeping in
// Work Board updates and dashboard pins.
const localMutation = {
  id: "test.local-mutation",
  sideEffects: ["write", "filesystem"],
  risk: "medium",
};
assert.equal(
  authorizeOperation(localMutation, { principal: runtimeAgentPrincipal({ agentId: "a1" }) }).status,
  "allow",
  "local write+filesystem at medium risk must not need approval",
);
const outwardMutation = {
  id: "test.outward-mutation",
  sideEffects: ["write", "public-message"],
  risk: "medium",
};
assert.equal(
  authorizeOperation(outwardMutation, { principal: runtimeAgentPrincipal({ agentId: "a1" }) }).status,
  "needs-approval",
  "medium-risk outward reach must still need approval",
);

// ------------------------------------------------------------ autonomous
const autonomous = forPreset("autonomous");
assert.equal(autonomous.counts.deny, 0);
assert.ok(
  autonomous.counts["needs-approval"] < standard.counts["needs-approval"],
  "bypass authority must reduce the approval load versus standard",
);
assert.ok(
  autonomous.counts.allow > standard.counts.allow,
  "bypass authority must allow strictly more than standard",
);

// THE safety property. Everything still gated for a full-authority agent must be
// an explicit per-action product gate, not a policy default.
for (const action of autonomous.gated) {
  assert.ok(
    action.confirmation,
    `${action.id} gates an autonomous agent but carries no confirmation contract`,
  );
  assert.notEqual(
    action.confirmation.when,
    "unless-auto-policy-allows",
    `${action.id} opted into auto-policy skipping but was still gated`,
  );
}
// Money movement specifically must survive full authority.
const gatedIds = new Set(autonomous.gated.map((a) => a.id));
for (const mustGate of ["wallet.send-usdc", "wallet.dex-swap", "clawbank.money-transfer"]) {
  if (catalog.some((a) => a.id === mustGate)) {
    assert.ok(gatedIds.has(mustGate), `${mustGate} must stay gated even for an autonomous agent`);
  }
}

// An action that opted into auto-policy skipping is skipped under bypass but not
// under manual.
const optedIn = {
  id: "test.opted-in",
  sideEffects: ["network"],
  risk: "critical",
  confirmation: { reason: "spends budget", when: "unless-auto-policy-allows" },
};
const agent = runtimeAgentPrincipal({ agentId: "a1" });
assert.equal(authorizeOperation(optedIn, { principal: agent, permissionMode: "manual" }).status, "needs-approval");
assert.equal(authorizeOperation(optedIn, { principal: agent, permissionMode: "bypass" }).status, "allow");
assert.equal(authorizeOperation(optedIn, { principal: agent, permissionMode: "auto" }).status, "allow",
  "auto mode skips the same rungs as bypass, matching chatPermissionModeSkipsReadyCapabilityReview");

// An always-confirmation is never skippable by any mode.
const alwaysGated = {
  id: "test.always",
  sideEffects: ["wallet"],
  risk: "critical",
  confirmation: { reason: "moves funds", when: "always" },
};
for (const mode of ["manual", "accept-edits", "plan", "auto", "bypass"]) {
  assert.equal(
    authorizeOperation(alwaysGated, { principal: agent, permissionMode: mode }).status,
    "needs-approval",
    `${mode} must not skip an always-confirmation`,
  );
}

// ------------------------------------------------------------------ admin
assert.deepEqual(
  tally(localAdminPrincipal(), "manual").counts,
  { allow: catalog.length, deny: 0, "needs-approval": 0 },
  "the local operator is unaffected by any of this",
);

console.log(
  `Agent authority tests passed (restricted ${restricted.counts.allow}a/${restricted.counts.deny}d, `
  + `standard ${standard.counts.allow}a/${standard.counts["needs-approval"]}n, `
  + `autonomous ${autonomous.counts.allow}a/${autonomous.counts["needs-approval"]}n).`,
);
