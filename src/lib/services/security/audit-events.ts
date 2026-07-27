import "server-only";

import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import type { AuthorizationDecision, PrincipalContext } from "@/lib/types/principal";

export type AuditEventInput = {
  type: string;
  principal?: PrincipalContext | null;
  decision?: AuthorizationDecision;
  target?: string;
  runId?: string | null;
  threadId?: string | null;
  payload?: Record<string, unknown>;
};

export async function recordAuditEvent(input: AuditEventInput) {
  await recordTelemetryBatch([
    {
      source: "route",
      type: `audit.${input.type}`,
      runId: input.runId ?? null,
      threadId: input.threadId ?? null,
      payload: {
        target: input.target ?? null,
        principal: input.principal ? sanitizePrincipal(input.principal) : null,
        decision: input.decision ? sanitizeDecision(input.decision) : null,
        ...(input.payload ?? {}),
      },
    },
  ]).catch(() => 0);
}

export function sanitizePrincipal(principal: PrincipalContext) {
  return {
    principalId: principal.principalId,
    kind: principal.kind,
    source: principal.source,
    workspaceId: principal.workspaceId,
    claims: principal.claims,
  };
}

function sanitizeDecision(decision: AuthorizationDecision) {
  return {
    status: decision.status,
    reason: decision.reason,
    requiredClaims: decision.requiredClaims,
    sideEffects: decision.sideEffects,
    risk: decision.risk,
  };
}
