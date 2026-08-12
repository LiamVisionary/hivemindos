import type { HiveActionConfirmation, HiveActionRisk, HiveActionSideEffect } from "@/lib/services/hive-actions/types";

export type PrincipalKind =
  | "local-user"
  | "dashboard-device"
  | "internal-service"
  | "runtime-agent";

export type PrincipalSource =
  | "session"
  | "device-token"
  | "internal"
  | "runtime"
  | "fallback";

export type PrincipalContext = {
  principalId: string;
  displayName: string;
  kind: PrincipalKind;
  source: PrincipalSource;
  workspaceId: string;
  claims: string[];
};

export type ScopeVisibility = "private" | "workspace" | "team" | "public";

export type ScopePolicy = {
  visibility: ScopeVisibility;
  ownerPrincipalId?: string;
  allowedPrincipalIds?: string[];
  requiredClaims?: string[];
  tags?: string[];
};

export type AuthorizationDecisionStatus = "allow" | "deny" | "needs-approval";

export type AuthorizationDecision = {
  status: AuthorizationDecisionStatus;
  reason: string;
  requiredClaims?: string[];
  sideEffects?: HiveActionSideEffect[];
  risk?: HiveActionRisk;
  approval?: HiveActionConfirmation;
};

export type AuthorizationMetadata = {
  sideEffects: HiveActionSideEffect[];
  risk: HiveActionRisk;
  readOnly?: boolean;
  requiredClaims?: string[];
  confirmation?: HiveActionConfirmation;
};

/**
 * How much authority a runtime agent carries. The claim sets and permission
 * modes behind each preset live in src/lib/services/security/agent-authority.ts;
 * the union lives here so the agent record can reference it without a types →
 * services dependency.
 */
export const AGENT_AUTHORITY_PRESETS = ["restricted", "standard", "autonomous"] as const;

export type AgentAuthorityPreset = typeof AGENT_AUTHORITY_PRESETS[number];

export const DEFAULT_AGENT_AUTHORITY: AgentAuthorityPreset = "standard";

export const LOCAL_ADMIN_CLAIM = "local:admin";

/**
 * Claims that `requiredClaimsForSideEffects` can demand.
 *
 * This list and the grant lists below were originally written independently and
 * drifted: six of these appeared in no grant list at all, so any principal
 * without `local:admin` was denied 98 of the 102 registered hive actions —
 * including `web.search` and reading a document. Nothing surfaced it because
 * `principalHasClaim` short-circuits on `local:admin`, so the claim system had
 * never actually executed. Keep this list and the grants reconciled; the
 * action-authorization suite asserts every derivable claim is grantable.
 */
export const SIDE_EFFECT_CLAIMS = [
  "connectors:read",
  "credentials:write",
  "filesystem:read",
  "filesystem:write",
  "local:write",
  "machines:write",
  "messages:publish",
  "network:invoke",
  "wallet:spend",
] as const;

/**
 * What a non-admin runtime agent gets by default.
 *
 * Deliberately broad on capability and narrow on authority. An agent may
 * attempt wallet, credential, publish, and remote-machine work — those are
 * gated by the risk/confirmation rungs of `authorizeOperation`, which route
 * them to needs-approval and into the Needs You lane. Missing a claim is a hard
 * deny, so withholding these would make the approval rail unreachable rather
 * than making the agent safer.
 *
 * The two it must never hold:
 *   - `local:admin`   — short-circuits every check; granting it defeats the point
 *   - `actions:approve` — an agent must not approve its own pending actions
 */
export const DEFAULT_RUNTIME_AGENT_CLAIMS = [
  "brain:read",
  "brain:write",
  "apps:read",
  "apps:invoke",
  "connectors:read",
  "connectors:invoke",
  "mcp:connect",
  "mcp:invoke",
  "wallet:approve",
  "wallet:spend",
  "telemetry:read",
  "artifacts:read",
  "artifacts:write",
  ...SIDE_EFFECT_CLAIMS,
] as const;

export const DEFAULT_LOCAL_ADMIN_CLAIMS = [
  LOCAL_ADMIN_CLAIM,
  "actions:approve",
  ...DEFAULT_RUNTIME_AGENT_CLAIMS,
] as const;

export function localAdminPrincipal(
  userId = "local-user",
  source: PrincipalSource = "fallback",
): PrincipalContext {
  return {
    principalId: userId,
    displayName: userId,
    kind: source === "device-token" ? "dashboard-device" : "local-user",
    source,
    workspaceId: "default",
    claims: [...DEFAULT_LOCAL_ADMIN_CLAIMS],
  };
}

export function publicScope(tags: string[] = []): ScopePolicy {
  return { visibility: "public", tags };
}

export function workspaceScope(requiredClaims: string[] = [], tags: string[] = []): ScopePolicy {
  return { visibility: "workspace", requiredClaims, tags };
}

export function principalHasClaim(principal: PrincipalContext | null | undefined, claim: string) {
  if (!principal) return false;
  return principal.claims.includes(LOCAL_ADMIN_CLAIM) || principal.claims.includes(claim);
}

export function missingPrincipalClaims(
  principal: PrincipalContext | null | undefined,
  claims: string[] | undefined,
) {
  const required = [...new Set((claims ?? []).filter(Boolean))];
  return required.filter((claim) => !principalHasClaim(principal, claim));
}

export function principalCanReadScope(
  principal: PrincipalContext | null | undefined,
  scope: ScopePolicy | undefined,
) {
  if (!scope || scope.visibility === "public") return true;
  if (!principal) return false;
  if (principalHasClaim(principal, LOCAL_ADMIN_CLAIM)) return true;
  if (scope.ownerPrincipalId && scope.ownerPrincipalId === principal.principalId) return true;
  if (scope.allowedPrincipalIds?.includes(principal.principalId)) return true;
  return missingPrincipalClaims(principal, scope.requiredClaims).length === 0
    && scope.visibility !== "private";
}

export function principalCanInvokeScope(
  principal: PrincipalContext | null | undefined,
  scope: ScopePolicy | undefined,
) {
  return principalCanReadScope(principal, scope);
}
