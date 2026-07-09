import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import type {
  HiveActionConfirmation,
  HiveActionDefinition,
  HiveActionRisk,
  HiveActionSideEffect,
} from "@/lib/services/hive-actions/types";
import {
  LOCAL_ADMIN_CLAIM,
  missingPrincipalClaims,
  principalCanInvokeScope,
  principalHasClaim,
  type AuthorizationDecision,
  type PrincipalContext,
  type ScopePolicy,
} from "@/lib/types/principal";

export type AuthorizableOperation = {
  id: string;
  title?: string;
  sideEffects: HiveActionSideEffect[];
  risk: HiveActionRisk;
  readOnly?: boolean;
  requiredClaims?: string[];
  confirmation?: HiveActionConfirmation;
  scope?: ScopePolicy;
};

export type AuthorizationInput = {
  principal?: PrincipalContext | null;
  caller?: string;
  permissionMode?: ChatPermissionMode;
};

export function requiredClaimsForSideEffects(sideEffects: HiveActionSideEffect[]) {
  const claims = new Set<string>();
  for (const sideEffect of sideEffects) {
    if (sideEffect === "read") claims.add("connectors:read");
    if (sideEffect === "write") claims.add("local:write");
    if (sideEffect === "filesystem") claims.add("filesystem:write");
    if (sideEffect === "network") claims.add("network:invoke");
    if (sideEffect === "remote-machine") claims.add("machines:write");
    if (sideEffect === "wallet" || sideEffect === "payment") claims.add("wallet:spend");
    if (sideEffect === "credential") claims.add("credentials:write");
    if (sideEffect === "public-message") claims.add("messages:publish");
  }
  return [...claims];
}

export function authorizeHiveAction(
  action: HiveActionDefinition,
  input: AuthorizationInput,
): AuthorizationDecision {
  return authorizeOperation({
    id: action.id,
    title: action.title,
    sideEffects: action.sideEffects,
    risk: action.risk,
    readOnly: action.readOnly,
    confirmation: action.confirmation,
  }, input);
}

export function authorizeOperation(
  operation: AuthorizableOperation,
  input: AuthorizationInput,
): AuthorizationDecision {
  const principal = input.principal ?? null;
  if (!principal) {
    return deny("No authenticated principal was available.", operation);
  }
  if (!principalCanInvokeScope(principal, operation.scope)) {
    return deny("The principal is outside this capability scope.", operation, operation.scope?.requiredClaims);
  }
  if (principalHasClaim(principal, LOCAL_ADMIN_CLAIM)) {
    return allow("Local admin principal is allowed.", operation);
  }

  const requiredClaims = [
    ...(operation.requiredClaims ?? []),
    ...requiredClaimsForSideEffects(operation.sideEffects),
  ];
  const missing = missingPrincipalClaims(principal, requiredClaims);
  if (missing.length) {
    return deny("The principal is missing required claims.", operation, missing);
  }

  const isReadOnly = operation.readOnly || operation.sideEffects.every((effect) => effect === "read");
  if (isReadOnly && operation.risk === "low") {
    return allow("Read-only low-risk operation is allowed.", operation);
  }

  if (operation.confirmation) {
    return needsApproval(operation.confirmation.reason, operation, requiredClaims, operation.confirmation);
  }
  if (operation.risk === "high" || operation.risk === "critical") {
    return needsApproval("High-risk operations need a human approval decision.", operation, requiredClaims);
  }
  if (input.permissionMode === "bypass") {
    return allow("Permission mode allows this medium-risk operation.", operation);
  }
  if (operation.risk === "medium" && operation.sideEffects.some((effect) => effect !== "read" && effect !== "network")) {
    return needsApproval("Medium-risk mutating operations need approval for non-admin principals.", operation, requiredClaims);
  }
  return allow("Required claims are present.", operation);
}

export function decisionAllowed(decision: AuthorizationDecision) {
  return decision.status === "allow";
}

function allow(reason: string, operation: AuthorizableOperation): AuthorizationDecision {
  return {
    status: "allow",
    reason,
    sideEffects: operation.sideEffects,
    risk: operation.risk,
  };
}

function deny(
  reason: string,
  operation: AuthorizableOperation,
  requiredClaims?: string[],
): AuthorizationDecision {
  return {
    status: "deny",
    reason,
    requiredClaims,
    sideEffects: operation.sideEffects,
    risk: operation.risk,
  };
}

function needsApproval(
  reason: string,
  operation: AuthorizableOperation,
  requiredClaims?: string[],
  approval?: HiveActionConfirmation,
): AuthorizationDecision {
  return {
    status: "needs-approval",
    reason,
    requiredClaims,
    sideEffects: operation.sideEffects,
    risk: operation.risk,
    approval,
  };
}
