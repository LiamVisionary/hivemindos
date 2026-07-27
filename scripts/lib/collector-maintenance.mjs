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
      updateQueued: Boolean(reservation && activeChatRuns.size > 0),
    };
  }

  function reserveUpdate(requestId = "") {
    const normalizedRequestId = String(requestId || "").trim();
    const existingReservation = activeUpdateReservation();
    if (existingReservation) {
      if (
        normalizedRequestId &&
        existingReservation.requestId === normalizedRequestId
      ) {
        return {
          ok: true,
          status: 200,
          reservationToken: existingReservation.token,
          ...state(),
        };
      }
      const current = state();
      return {
        ok: false,
        status: 409,
        error: "Maintenance is already starting on this agent bridge.",
        ...current,
      };
    }
    const current = state();
    if (current.activeChatRunCount > 0 && !normalizedRequestId) {
      return {
        ok: false,
        status: 409,
        error: `Maintenance was not started because ${current.activeChatRunCount} active chat run${current.activeChatRunCount === 1 ? " is" : "s are"} still using this agent bridge.`,
        ...current,
      };
    }
    const reservationToken = randomBytes(18).toString("hex");
    updateReservation = {
      token: reservationToken,
      requestId: normalizedRequestId,
      expiresAt: Date.now() + reservationTtlMs,
    };
    const queued = current.activeChatRunCount > 0;
    return {
      ok: true,
      status: queued ? 202 : 201,
      reservationToken,
      ...(queued
        ? {
            message: `Maintenance is queued behind ${current.activeChatRunCount} active chat run${current.activeChatRunCount === 1 ? "" : "s"}. New chat work will wait until the update starts.`,
          }
        : {}),
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
