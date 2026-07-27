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

export const LOCAL_ADMIN_CLAIM = "local:admin";

export const DEFAULT_LOCAL_ADMIN_CLAIMS = [
  LOCAL_ADMIN_CLAIM,
  "brain:read",
  "brain:write",
  "apps:read",
  "apps:invoke",
  "connectors:read",
  "connectors:invoke",
  "mcp:connect",
  "mcp:invoke",
  "actions:approve",
  "wallet:approve",
  "wallet:spend",
  "telemetry:read",
  "artifacts:read",
  "artifacts:write",
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
