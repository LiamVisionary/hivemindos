import "server-only";

import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import { appendAuditRecord } from "@/lib/services/security/audit-log";
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
  // Two sinks with different jobs. Telemetry keeps audit events visible
  // alongside the rest of the local event stream, but it is chatty, rotates
  // fast, and a thread purge rewrites it whole. The audit log is the durable
  // answer to "which agent did this and was it permitted", and nothing purges
  // it. Both are best-effort: an audit write must never fail the operation it
  // is describing, or a full disk becomes an outage.
  await Promise.all([
    recordTelemetryBatch([
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
    ]).catch(() => 0),
    appendAuditRecord({
      type: input.type,
      principal: input.principal,
      decision: input.decision,
      target: input.target,
      runId: input.runId,
      payload: input.payload,
    }).catch(() => null),
  ]);
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
