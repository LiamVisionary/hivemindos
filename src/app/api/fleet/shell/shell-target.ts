import { hivemindLinkControlUrl } from "@/lib/services/hivemind-link-control";
import { isFleetCollectorUrl } from "@/lib/services/local-collector-url";

export const SHELL_SESSION_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

// Resolves where a machine's link shell API lives from the collector URL the
// fleet already uses to reach that machine:
// - local collector (127.0.0.1) -> this machine's linkd control API
// - link peer proxy URL -> same peer prefix; linkd serves /_hivemind/shell/
//   on the same tailnet listener it proxies the collector on
// - direct tailnet URL -> same host/port, served by the remote linkd
export function shellBaseFromCollectorUrl(collectorUrl: string | undefined): string | null {
  const control = hivemindLinkControlUrl();
  const trimmed = (collectorUrl ?? "").trim().replace(/\/+$/, "");
  // No implicit fallback: an empty collector URL must not silently open a
  // shell on the dashboard machine itself.
  if (!trimmed) return null;
  const base = resolveShellBase(control, trimmed);
  // SSRF guard: never open a link shell (or send a file) against a host outside
  // the fleet surface — loopback / this machine / a Tailscale node / *.local.
  // A `/peer/<host>` URL passes as loopback here and is further gated by linkd's
  // owner/tailnet ACL; a direct URL must resolve to a fleet host itself.
  return base && isFleetCollectorUrl(base) ? base : null;
}

function resolveShellBase(control: string, trimmed: string): string | null {
  if (trimmed.startsWith(`${control}/peer/`)) return trimmed;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return control;
  return `${parsed.protocol}//${parsed.host}`;
}

export function shellSessionUrl(base: string, session: string, action?: string) {
  return `${base}/_hivemind/shell/sessions/${encodeURIComponent(session)}${action ? `/${action}` : ""}`;
}

/**
 * linkd answers shell requests with JSON, but several failure paths speak
 * plain text: the Go reverse proxy's "hivemind-linkd proxy error: dial tcp
 * ..." 502 (e.g. a Windows linkd without the shell service falling through to
 * a dead collector), and 404 pages from stale builds. Forward JSON bodies
 * verbatim; wrap anything else in the { ok, error } envelope so the terminal
 * UI shows a readable error line instead of a JSON parse crash.
 */
export function shellEnvelopeFromUpstream(body: string, status: number): { payload: unknown; status: number } {
  try {
    return { payload: JSON.parse(body), status };
  } catch {
    const detail = body.trim().replace(/\s+/g, " ").slice(0, 400);
    return {
      payload: {
        ok: false,
        error: detail || `shell endpoint returned an empty non-JSON response (HTTP ${status})`,
      },
      // A non-JSON body is an upstream failure even when the status says 2xx.
      status: status >= 400 ? status : 502,
    };
  }
}
