export type RuntimeSessionRecoveryState = {
  endReason: string;
  outcome: "unknown" | "active" | "completed" | "failed";
};

export const UNKNOWN_RUNTIME_SESSION_RECOVERY: RuntimeSessionRecoveryState = {
  endReason: "",
  outcome: "unknown",
};

export function runtimeSessionRecoveryState(session: any): RuntimeSessionRecoveryState {
  const rawEndedAt = session?.endedAt;
  const endedAtNumber = Number(rawEndedAt ?? 0);
  const endedAtText = typeof rawEndedAt === "string" ? rawEndedAt.trim() : "";
  const ended = (Number.isFinite(endedAtNumber) && endedAtNumber > 0)
    || Boolean(endedAtText && !/^\d+$/.test(endedAtText) && Number.isFinite(Date.parse(endedAtText)));
  const endReason = String(session?.endReason ?? session?.end_reason ?? "").trim();
  if (!ended) return { endReason, outcome: "active" };
  const succeeded = !endReason || /^(?:complete|completed|done|finish|finished|success|succeeded)$/i.test(endReason);
  return { endReason, outcome: succeeded ? "completed" : "failed" };
}

export function interruptedRuntimeRecoveryResult(input: {
  assistantIssue: boolean;
  assistantText: string;
  interrupted: boolean;
  session: RuntimeSessionRecoveryState;
}) {
  if (!input.interrupted) return null;
  if (input.assistantText.trim() && (input.session.outcome === "completed" || input.session.outcome === "failed")) {
    return input.session.outcome === "failed" || input.assistantIssue ? "failed" as const : "completed" as const;
  }
  return input.session.outcome === "active" || input.session.outcome === "unknown" ? "active" as const : null;
}
