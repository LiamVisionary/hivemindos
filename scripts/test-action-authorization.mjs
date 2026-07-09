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

console.log("Action authorization policy tests passed.");
