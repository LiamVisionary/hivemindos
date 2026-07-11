import { randomBytes } from "node:crypto";

export function createCollectorMaintenance(options = {}) {
  const reservationTtlMs = Number(options.reservationTtlMs || 10 * 60_000);
  const activeChatRuns = new Set();
  let updateReservation = null;

  function beginChatRun() {
    const token = randomBytes(12).toString("hex");
    activeChatRuns.add(token);
    let released = false;
    return function releaseCollectorChatRun() {
      if (released) return;
      released = true;
      activeChatRuns.delete(token);
    };
  }

  function activeUpdateReservation() {
    if (updateReservation && updateReservation.expiresAt <= Date.now()) {
      updateReservation = null;
    }
    return updateReservation;
  }

  function state() {
    const reservation = activeUpdateReservation();
    return {
      ready: activeChatRuns.size === 0 && !reservation,
      activeChatRunCount: activeChatRuns.size,
      updateStarting: Boolean(reservation),
    };
  }

  function reserveUpdate() {
    const current = state();
    if (!current.ready) {
      return {
        ok: false,
        status: 409,
        error: current.activeChatRunCount
          ? `Maintenance was not started because ${current.activeChatRunCount} active chat run${current.activeChatRunCount === 1 ? " is" : "s are"} still using this agent bridge.`
          : "Maintenance is already starting on this agent bridge.",
        ...current,
      };
    }
    const reservationToken = randomBytes(18).toString("hex");
    updateReservation = {
      token: reservationToken,
      expiresAt: Date.now() + reservationTtlMs,
    };
    return {
      ok: true,
      status: 201,
      reservationToken,
      ...state(),
    };
  }

  function releaseUpdate(token) {
    const reservation = activeUpdateReservation();
    if (!reservation || reservation.token !== token) return false;
    updateReservation = null;
    return true;
  }

  return {
    activeChatRuns,
    activeUpdateReservation,
    beginChatRun,
    releaseUpdate,
    reserveUpdate,
    state,
  };
}
