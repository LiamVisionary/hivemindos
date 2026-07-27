// Server-only bounded content fetcher for the deliverable-acceptance gate. This is
// the ONE place that turns a claimed deliverable URL into fetched bytes the pure
// acceptance contracts judge — used by BOTH enforcement points (the loop-runner
// completion gate via queen-bee/autonomous-worker, and the company email-QA scan).
//
// It follows redirects and caps body size + time so a slow or huge host can never
// stall a pickup or blow memory. It returns null on any failure or non-2xx (dead
// links are the live-URL gate's job) so the acceptance gate ABSTAINS rather than
// blocks. Server-only (`fetch` + AbortSignal.timeout): do NOT import client-side.
import type { DeliverableContentFetcher } from "./deliverable-acceptance";

const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_BYTES = 512 * 1024;

/**
 * Build the injected fetcher. Disabled (returns undefined → gate is a no-op) when
 * `QUEEN_BEE_DELIVERABLE_ACCEPTANCE=0`, mirroring the live-URL probe kill-switch.
 */
export function makeDeliverableContentFetcher(): DeliverableContentFetcher | undefined {
  if (process.env.QUEEN_BEE_DELIVERABLE_ACCEPTANCE === "0") return undefined;
  const timeoutMs = Number(process.env.QUEEN_BEE_DELIVERABLE_ACCEPTANCE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return async ({ url }) => {
    try {
      const response = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return null; // non-2xx → the live-URL gate owns dead links; don't double-judge.
      const contentType = response.headers.get("content-type") ?? undefined;
      const reader = response.body?.getReader();
      if (!reader) {
        const body = await response.text();
        return { body: body.slice(0, MAX_BYTES), contentType, status: response.status };
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) { chunks.push(value); total += value.length; }
      }
      try { await reader.cancel(); } catch { /* best effort: stop the stream once we have enough */ }
      const length = Math.min(total, MAX_BYTES);
      const buffer = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        if (offset >= length) break;
        const take = Math.min(chunk.length, length - offset);
        buffer.set(chunk.subarray(0, take), offset);
        offset += take;
      }
      return { body: new TextDecoder().decode(buffer), contentType, status: response.status };
    } catch {
      return null; // unreachable / timeout / abort → abstain.
    }
  };
}
