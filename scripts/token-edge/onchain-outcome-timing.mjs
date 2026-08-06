export const TOKEN_EDGE_MAX_EXACT_LIVE_LAG_MS = 5 * 60_000;
export const TOKEN_EDGE_MAX_EXACT_1H_LIVE_LAG_MS = TOKEN_EDGE_MAX_EXACT_LIVE_LAG_MS;

export function exactLiveOutcomeTimingReason(outcome) {
  if (outcome?.type !== "resolution" || outcome?.status !== "observed"
    || outcome?.observationMode !== "live-point-in-time") return null;
  const dueAt = Date.parse(outcome.dueAt ?? "");
  const observedAt = Date.parse(outcome.observedAt ?? "");
  if (![dueAt, observedAt].every(Number.isFinite) || observedAt < dueAt) {
    return "invalid-live-resolution-timing";
  }
  if (observedAt - dueAt > TOKEN_EDGE_MAX_EXACT_LIVE_LAG_MS) {
    return "live-resolution-horizon-drift";
  }
  return null;
}

export function liveOutcomeLagMs(outcome) {
  const dueAt = Date.parse(outcome?.dueAt ?? "");
  const observedAt = Date.parse(outcome?.observedAt ?? "");
  return [dueAt, observedAt].every(Number.isFinite) ? observedAt - dueAt : null;
}
