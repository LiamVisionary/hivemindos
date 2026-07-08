/** Client mirror of FreeModelAllowanceSnapshot (the service module is
 *  server-only — it reads the snapshot file). */
export type FreeAllowanceSnapshot = {
  remainingRequests: number | null;
  remainingTokens: number | null;
  resetAt: string | null;
  observedAt: string;
  highWaterRequests: number | null;
  highWaterTokens: number | null;
};

export type FreeMeterState = { fraction: number; label: string; exhausted: boolean };

function compactTokenCount(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/** Meter shape from the last-seen allowance snapshot. The gateway reports only
 *  "remaining", so the denominator is the highest value seen this reset
 *  window; a past reset marker means the window rolled over and the allowance
 *  is full again. Derived at fetch time (not render) so it stays pure. */
export function deriveFreeMeter(allowance: FreeAllowanceSnapshot | null, nowMs: number): FreeMeterState | null {
  if (!allowance) return null;
  const resetMs = allowance.resetAt ? Date.parse(allowance.resetAt) : NaN;
  if (Number.isFinite(resetMs) && resetMs <= nowMs) {
    return { fraction: 1, label: "Full daily allowance available", exhausted: false };
  }
  const remaining = allowance.remainingRequests;
  const tokens = allowance.remainingTokens;
  // Exhaustion still needs to render when the first observed snapshot is 0/0
  // and therefore has no positive high-water denominator yet.
  if ((remaining !== null && remaining <= 0) || tokens === 0) {
    const resetLabel = Number.isFinite(resetMs)
      ? ` — resets ${new Date(resetMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : " — resets daily";
    return { fraction: 0, label: `Daily allowance used up${resetLabel}`, exhausted: true };
  }
  const ceiling = allowance.highWaterRequests;
  if (remaining === null || ceiling === null || ceiling <= 0) return null;
  return {
    fraction: Math.max(0, Math.min(1, remaining / ceiling)),
    label: `${remaining} ${remaining === 1 ? "request" : "requests"}${tokens !== null ? ` · ${compactTokenCount(tokens)} tokens` : ""} left today`,
    exhausted: false,
  };
}
