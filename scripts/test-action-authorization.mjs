#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  authorizeOperation,
  decisionAllowed,
} = await import("../src/lib/services/security/action-authorization.ts");
const { localAdminPrincipal } = await import("../src/lib/types/principal.ts");

const localAdmin = localAdminPrincipal("local-user", "session");
const highRisk = {
  id: "test.high-risk",
  sideEffects: ["network", "payment"],
  risk: "critical",
  requiredClaims: ["wallet:spend"],
};
assert.equal(authorizeOperation(highRisk, { principal: localAdmin }).status, "allow");

const reader = {
  principalId: "reader",
  displayName: "Reader",
  kind: "local-user",
  source: "session",
  workspaceId: "default",
  claims: ["connectors:read"],
};
const readDecision = authorizeOperation({
  id: "test.read",
  sideEffects: ["read"],
  risk: "low",
  readOnly: true,
  requiredClaims: ["connectors:read"],
}, { principal: reader });
assert.equal(readDecision.status, "allow");
assert.equal(decisionAllowed(readDecision), true);

const writeDecision = authorizeOperation({
  id: "test.write",
  sideEffects: ["write"],
  risk: "medium",
  requiredClaims: ["local:write"],
}, { principal: reader });
assert.equal(writeDecision.status, "deny");
assert.deepEqual(writeDecision.requiredClaims, ["local:write"]);

const publisher = { ...reader, claims: ["messages:publish", "network:invoke"] };
const needsApproval = authorizeOperation({
  id: "test.publish",
  sideEffects: ["network", "public-message"],
  risk: "high",
  requiredClaims: ["messages:publish"],
}, { principal: publisher });
assert.equal(needsApproval.status, "needs-approval");

// ---------------------------------------------------------------------------
// Catalog-wide reconciliation.
//
// The claim vocabulary that `requiredClaimsForSideEffects` DERIVES and the one
// the grant lists HAND OUT were written independently and drifted apart: six
// derivable claims appeared in no grant list, so a principal without
// `local:admin` was denied 98 of 102 registered actions — including web.search
// and inspecting a document. It stayed invisible because `local:admin`
// short-circuits every check, so the claim path had never run. These assertions
// pin the two vocabularies together against the real catalog.
// ---------------------------------------------------------------------------
const { listHiveActions } = await import("../src/lib/services/hive-actions/index.ts");
const { requiredClaimsForSideEffects } = await import("../src/lib/services/security/action-authorization.ts");
const {
  DEFAULT_LOCAL_ADMIN_CLAIMS,
  DEFAULT_RUNTIME_AGENT_CLAIMS,
  LOCAL_ADMIN_CLAIM,
} = await import("../src/lib/types/principal.ts");

const catalog = listHiveActions();
assert.ok(catalog.length > 50, "the hive action catalog should be populated");

const asOperation = (action) => ({
  id: action.id,
  title: action.title,
  sideEffects: action.sideEffects,
  risk: action.risk,
  readOnly: action.readOnly,
  confirmation: action.confirmation,
});

const tally = (claims) => {
  const principal = {
    principalId: "p",
    displayName: "p",
    kind: "runtime-agent",
    source: "runtime",
    workspaceId: "default",
    claims: [...claims],
  };
  const counts = {};
  for (const action of catalog) {
    const decision = authorizeOperation(asOperation(action), { principal });
    counts[decision.status] = (counts[decision.status] ?? 0) + 1;
  }
  return counts;
};

// Every claim the catalog can demand must be grantable. This is the assertion
// that would have caught the original drift.
const derivable = new Set(catalog.flatMap((action) => requiredClaimsForSideEffects(action.sideEffects)));
const ungrantable = [...derivable].filter((claim) => !DEFAULT_RUNTIME_AGENT_CLAIMS.includes(claim));
assert.deepEqual(ungrantable, [], `derivable claims missing from the agent grant list: ${ungrantable.join(", ")}`);

// Admin behavior must be untouched — this change reconciles vocabulary, it does
// not alter what the current single-operator setup can do.
assert.deepEqual(tally(DEFAULT_LOCAL_ADMIN_CLAIMS), { allow: catalog.length }, "admin must still allow every action");

// A default non-admin agent must never be hard-denied: a missing claim is a
// deny, so a coherent vocabulary means risky work reaches the approval rung
// instead of being refused outright.
const agentCounts = tally(DEFAULT_RUNTIME_AGENT_CLAIMS);
assert.equal(agentCounts.deny ?? 0, 0, `a default agent should have no hard denials, got ${agentCounts.deny}`);
assert.ok((agentCounts["needs-approval"] ?? 0) > 0, "risky actions must route to needs-approval for a non-admin agent");
assert.ok((agentCounts.allow ?? 0) > 0, "ordinary work must still be allowed outright for a non-admin agent");

// An agent must never hold the two authority claims.
assert.equal(DEFAULT_RUNTIME_AGENT_CLAIMS.includes(LOCAL_ADMIN_CLAIM), false, "agents must not hold local:admin");
assert.equal(DEFAULT_RUNTIME_AGENT_CLAIMS.includes("actions:approve"), false, "agents must not approve their own actions");

// A deliberately narrow role still gets targeted denials — reconciliation must
// not have turned the claim check into a rubber stamp.
const researcherCounts = tally(["connectors:read", "network:invoke", "brain:read"]);
assert.ok((researcherCounts.deny ?? 0) > 0, "a read-only researcher must still be denied privileged actions");

// Touching the filesystem read-only must not demand a write grant.
assert.deepEqual(requiredClaimsForSideEffects(["read", "filesystem"]), ["connectors:read", "filesystem:read"]);
assert.deepEqual(requiredClaimsForSideEffects(["write", "filesystem"]), ["local:write", "filesystem:write"]);

console.log("Action authorization policy tests passed.");
