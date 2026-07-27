// Node-safe (no next/server imports): service modules that the hermetic node
// suites load directly import from here; server-auth.ts re-exports the header
// constant so there is one source of truth.
export const DASHBOARD_AUTH_HEADER = "x-hivemindos-device-token";

/**
 * Auth headers for internal server->server self-fetches — a route handler or
 * service calling a sibling /api route on its own origin. Since the API auth
 * gate moved to src/proxy.ts (2026-07-03) these calls 401 without a
 * credential; browser callers authenticate with a session cookie the server
 * cannot mint for itself, so internal calls ride the server's own device
 * token. Returns {} when no token is configured (the gate is in its
 * setup-required mode then, and the headerless behavior is unchanged).
 */
export function internalApiAuthHeaders(): Record<string, string> {
  const token = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN?.trim() ?? "";
  return token ? { [DASHBOARD_AUTH_HEADER]: token } : {};
}
