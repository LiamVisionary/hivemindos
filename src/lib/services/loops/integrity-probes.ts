// Server-only probe factory for the live-URL integrity gate, shared by the
// in-process autonomous worker and the UNTRUSTED HTTP/MCP completion path
// (POST /api/kanban "complete" → completeTask). Lives here — not in
// queen-bee/autonomous-worker.ts — because the kanban store must not import
// the worker (the worker dynamically imports the store). Server-only
// (`fetch`): do NOT import client-side.
import { numberEnv, optionalEnv } from "@/lib/config/env";
import type { LoopUrlProber, LoopUrlProbeResult } from "@/lib/services/loops/loop-runner";

/**
 * Real network prober for the live-URL integrity gate. Reads only the response STATUS
 * (HEAD, falling back to GET when a host rejects HEAD) with a short per-URL timeout, so a
 * slow host never stalls completion. Distinguishes a definitive DNS NXDOMAIN from transient
 * failures so the runner blocks only on real fabrication. Disable with QUEEN_BEE_LIVE_URL_PROBE=0
 * (the same kill-switch the in-process gate honors). The runner already rejects
 * reserved/mock/non-public hosts WITHOUT this, and never probes them.
 */
export function makeLiveUrlProber(): LoopUrlProber | undefined {
  if (optionalEnv("QUEEN_BEE_LIVE_URL_PROBE") === "0") return undefined;
  const timeoutMs = numberEnv("QUEEN_BEE_LIVE_URL_PROBE_TIMEOUT_MS", 5_000);
  return async ({ url }) => {
    for (const method of ["HEAD", "GET"] as const) {
      try {
        const response = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
        if (method === "HEAD" && (response.status === 405 || response.status === 501)) continue; // host dislikes HEAD → GET
        return { status: response.status } satisfies LoopUrlProbeResult;
      } catch (error) {
        if (errorCode(error) === "ENOTFOUND") return { dnsFailed: true }; // definitive: host does not resolve
        if (method === "GET") return { error: error instanceof Error ? error.message : String(error) };
        // HEAD threw for another reason (some servers hang up on HEAD) → fall through to GET.
      }
    }
    return { error: "no response" };
  };
}

/** Undici surfaces DNS/connection errors on `error.cause.code`; some paths use `error.code`. */
function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) return String((cause as { code?: unknown }).code);
    if ("code" in error) return String((error as { code?: unknown }).code);
  }
  return undefined;
}
