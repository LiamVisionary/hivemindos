import { NextResponse } from "next/server";

/**
 * Canonical API response envelope. Routes should return `{ ok: true, ...data }`
 * on success and `{ ok: false, error }` on failure instead of hand-rolling
 * shapes (4+ variants existed across the 262 routes). Status-code semantics:
 * 400 invalid input, 401/403 auth (middleware usually owns this), 404 missing,
 * 409 conflict, 502 upstream failure, 500 unexpected.
 */
export function okJson<T extends Record<string, unknown>>(data?: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, ...(data ?? {}) }, init);
}

export function errorJson(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

/** 502 wrapper for upstream/proxy failures with a consistent message shape. */
export function upstreamErrorJson(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return errorJson(`${context}: ${message}`, 502);
}
