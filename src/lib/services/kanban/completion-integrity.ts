// Server-side integrity gating for UNTRUSTED task completions (worker lanes, MCP,
// external runtimes over POST /api/kanban "complete" — everything that is NOT the
// trusted in-process runner). The autonomous worker runs runLoopGates before
// completing; an HTTP completion used to skip those evaluators entirely, so a
// fabricated "site is live at <url>" moved the card to done whenever no required
// server-authoritative gates existed — a documented live incident class.
// completeTask AND patchTask (an agent PATCHing status:"done" is a completion
// too) call this for every untrusted completion BEFORE the board-mutation queue,
// so network probes (bounded, short-timeout) never hold the board lock; the
// resulting hardFail receipts route the task to needs-human exactly like the
// in-process path (loopCompletionBlock treats them identically). Status-only
// moveTask stays the gate-free human override.
import { runIntegrityGates, type LoopUrlProber } from "@/lib/services/loops/loop-runner";
import { makeLiveUrlProber } from "@/lib/services/loops/integrity-probes";
import { makeDeliverableContentFetcher } from "@/lib/services/deliverables/content-fetcher";
import type { DeliverableContentFetcher } from "@/lib/services/deliverables/deliverable-acceptance";
import type { KanbanLoopReceipt } from "@/lib/types/kanban";

/**
 * Probe overrides for hermetic tests. When set it is used WHOLESALE — an absent
 * field disables that probe — so suites never touch the network. Unset → the real
 * server probes, honoring the same env kill-switches as the in-process gates
 * (QUEEN_BEE_LIVE_URL_PROBE=0, QUEEN_BEE_DELIVERABLE_ACCEPTANCE=0).
 */
export type KanbanIntegrityProbes = {
  probeUrl?: LoopUrlProber;
  fetchContent?: DeliverableContentFetcher;
};

// Agents and remote collectors sometimes POST structured (object) completion
// results, and synced boards from other machines can carry them too; stored
// verbatim, ONE such task crashes deliverable extraction and 400s every
// subsequent board read. Coerce anything non-string to readable text.
export function coerceKanbanText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Verifies the text an untrusted completion will actually store as the result.
 * Falls back to the task's stored result when the request submits none —
 * otherwise a pre-patched fabricated claim would complete unverified. The stored
 * read happens OUTSIDE the board mutation queue: worst case a concurrent write
 * changes the result between the read and the completion write and this run
 * verifies slightly-stale text — acceptable for a gate; never hold the board
 * lock through network probes. Returns [] when there is nothing to verify (no
 * output, or the evaluators found no live-URL/deliverable claims).
 */
export async function untrustedCompletionIntegrityReceipts(input: {
  submittedText: string;
  readStoredResult: () => Promise<string>;
  probes?: KanbanIntegrityProbes;
}): Promise<KanbanLoopReceipt[]> {
  let output = input.submittedText;
  if (!output.trim()) output = await input.readStoredResult().catch(() => "");
  if (!output.trim()) return [];
  const probes = input.probes ?? {
    probeUrl: makeLiveUrlProber(),
    fetchContent: makeDeliverableContentFetcher(),
  };
  return runIntegrityGates({ output, probeUrl: probes.probeUrl, fetchContent: probes.fetchContent });
}
