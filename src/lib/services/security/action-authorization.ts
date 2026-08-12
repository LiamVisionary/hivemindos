import {
  chatPermissionModeSkipsReadyCapabilityReview,
  normalizeChatPermissionMode,
  type ChatPermissionMode,
} from "@/lib/types/chat-permissions";
import type {
  HiveActionConfirmation,
  HiveActionDefinition,
  HiveActionRisk,
  HiveActionSideEffect,
} from "@/lib/services/hive-actions/types";

/**
 * Side effects that reach beyond this machine's own state. These — not local
 * mutation — are what make a medium-risk operation worth a human decision.
 */
const OUTWARD_SIDE_EFFECTS = new Set<HiveActionSideEffect>([
  "wallet",
  "payment",
  "credential",
  "public-message",
  "remote-machine",
]);
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
  // `filesystem` is not a mutating side effect (see MUTATING_SIDE_EFFECTS in
  // hive-actions/define.ts), so an action may touch the filesystem read-only.
  // Demanding filesystem:write for those made merely INSPECTING a document
  // require a write grant. The declared `write` side effect is what separates
  // them, and deriving from it keeps this single-argument for the
  // context-index caller.
  const mutatesFilesystem = sideEffects.includes("write");
  for (const sideEffect of sideEffects) {
    if (sideEffect === "read") claims.add("connectors:read");
    if (sideEffect === "write") claims.add("local:write");
    if (sideEffect === "filesystem") claims.add(mutatesFilesystem ? "filesystem:write" : "filesystem:read");
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

  // `auto` and `bypass` are an operator granting standing authority — the same
  // pair the capability-review helper already treats as "do not re-ask". Using
  // the shared predicate keeps one definition of "the human pre-approved this".
  const autoPolicy = chatPermissionModeSkipsReadyCapabilityReview(
    normalizeChatPermissionMode(input.permissionMode),
  );

  if (operation.confirmation) {
    // `when: "unless-auto-policy-allows"` is the action author explicitly opting
    // into being skippable. Anything else — including an unset `when` — is a
    // per-action product gate (money movement, publishing, computer control) and
    // no policy mode may skip it. An agent granted full authority can still run
    // the company; it cannot silently move money.
    const skippable = operation.confirmation.when === "unless-auto-policy-allows";
    if (!skippable || !autoPolicy) {
      return needsApproval(operation.confirmation.reason, operation, requiredClaims, operation.confirmation);
    }
  }
  if (!autoPolicy && (operation.risk === "high" || operation.risk === "critical")) {
    return needsApproval("High-risk operations need a human approval decision.", operation, requiredClaims);
  }
  // Medium-risk approval keys on OUTWARD reach, not on mutation as such. The
  // previous rule fired for any side effect other than read/network, which swept
  // in ordinary internal work — updating the Work Board, pinning a dashboard
  // card, indexing a repository — and would have flooded the Needs You lane with
  // items no operator wants to adjudicate. Local `write`/`filesystem` mutation
  // by a claim-holding agent is the job; money, credentials, publishing, and
  // other machines are what deserve a human.
  if (
    !autoPolicy
    && operation.risk === "medium"
    && operation.sideEffects.some((effect) => OUTWARD_SIDE_EFFECTS.has(effect))
  ) {
    return needsApproval("Medium-risk outward operations need approval for non-admin principals.", operation, requiredClaims);
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
