// Escalation tracking for the fleet health watchdog.
//
// The watchdog's restart remediation quietly loops forever when a failure is
// beyond a restart's power (the 2026-07-03 NYC machine-wide MLX synth deadlock:
// health endpoints green, every deep synth probe dead, kickstart after kickstart
// changing nothing — for hours, with no human told). This module holds the
// escalation decision: after a target's DEEP functional probe keeps failing
// across consecutive checks despite at least one remediation attempt, the
// watchdog must stop silently retrying and raise a human-visible alert.
//
// Pure and deterministic on purpose (callers pass `now`), so the policy is
// hermetically testable without timers, network, or the watchdog's main loop.

/**
 * Tracks per-target deep-failure streaks and decides when to escalate.
 *
 * - `threshold`: consecutive confirmed severe (deep-probe) failures before the
 *   first escalation. Remediation attempts do NOT reset the streak — only a
 *   passing deep probe proves the wedge actually cleared.
 * - `repeatMs`: minimum gap between repeat escalations while the target stays
 *   wedged, so a persistent outage re-alerts instead of alerting once and
 *   going quiet again.
 */
export function createEscalationTracker({ threshold = 3, repeatMs = 30 * 60_000 } = {}) {
  const entries = new Map();

  function entry(key) {
    let state = entries.get(key);
    if (!state) {
      state = { streak: 0, remediations: 0, lastReason: "", lastEscalatedAt: 0, escalated: false };
      entries.set(key, state);
    }
    return state;
  }

  return {
    /** A confirmed severe (deep-probe) failure for this target. Returns the streak. */
    recordSevereFailure(key, reason) {
      const state = entry(key);
      state.streak += 1;
      state.lastReason = String(reason || "unknown");
      return state.streak;
    },

    /** The watchdog tried a restart (whether or not the send succeeded — a
     * failed remediation send is MORE reason to escalate, not less). */
    recordRemediationAttempt(key) {
      entry(key).remediations += 1;
    },

    /**
     * Call after recording the failure (and any remediation attempt) for this
     * cycle. Returns escalation details when one is due — and stamps it sent —
     * or null. Escalation requires the full streak AND at least one remediation
     * attempt during it: "still failing DESPITE remediation".
     */
    escalationDue(key, now) {
      const state = entries.get(key);
      if (!state) return null;
      if (state.streak < threshold || state.remediations < 1) return null;
      if (state.escalated && now - state.lastEscalatedAt < repeatMs) return null;
      state.lastEscalatedAt = now;
      state.escalated = true;
      return { streak: state.streak, remediations: state.remediations, reason: state.lastReason };
    },

    /**
     * A deep probe passed for this target — the only proof the wedge cleared
     * (cheap probes stay green through a wedged backend; that is the whole
     * incident). Clears the streak and reports whether an escalation had been
     * raised, so the caller can announce the recovery.
     */
    recordDeepRecovery(key) {
      const state = entries.get(key);
      if (!state || state.streak === 0) return { wasEscalated: false, streak: 0 };
      entries.delete(key);
      return { wasEscalated: state.escalated, streak: state.streak };
    },
  };
}

/** Human-facing escalation line: machine, service, streak, attempts, last probe error. */
export function formatEscalationAlert({ name, kind, streak, remediations, reason }) {
  const attempts = `${remediations} restart attempt${remediations === 1 ? "" : "s"}`;
  return (
    `ESCALATION — ${name}: ${kind} deep probe has failed ${streak} consecutive checks despite ${attempts}. ` +
    `Restarts are not fixing it; a human needs to look. Last error: ${reason}`
  );
}
