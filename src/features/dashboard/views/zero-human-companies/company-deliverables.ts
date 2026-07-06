// Zero Human Companies — shared deliverable-collection helpers.
// Extracted from Cockpit so the Comms panel and the cockpit can both flatten,
// classify, and bucket a company's produced work without a circular import.
import { classifyDeliverable, deliverableHref, type ClassifiedDeliverable } from "./deliverables-model";
import type { OutputSpec } from "./company-output-spec";
import type { Colony } from "./types";

export type CardCtx = { classified: ClassifiedDeliverable; machineName?: string; key: string };

/** Relative "…ago" for an epoch-ms timestamp (dispatch time, email updatedAt, …). */
export function dispatchedAgo(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Split deliverables into headline outputs / comms / the collapsed work log for a company. */
export function partitionByOutput(all: CardCtx[], spec: OutputSpec) {
  const primary: CardCtx[] = [];
  const comms: CardCtx[] = [];
  const worklog: CardCtx[] = [];
  for (const x of all) {
    const bucket = spec.classOf(x.classified);
    if (bucket === "primary") primary.push(x);
    else if (bucket === "comms") comms.push(x);
    else worklog.push(x);
  }
  return { primary, comms, worklog };
}

/** Flatten every company deliverable, classify, and dedupe by target (preferring the useful copy). */
export function collectCompanyDeliverables(c: Colony): CardCtx[] {
  const bySort = [...c.issues].sort((a, b) => (b.work?.completedAt ?? b.work?.updatedAt ?? 0) - (a.work?.completedAt ?? a.work?.updatedAt ?? 0));
  const seen = new Map<string, CardCtx>();
  for (const issue of bySort) {
    const work = issue.work;
    if (!work) continue;
    for (const d of work.deliverables) {
      // The dedupe key (resolved target) is also a stable, unique React key — the
      // extractor reuses one deliverable.id when two tasks reference the same file.
      const key = (deliverableHref(d) || d.path || d.label || d.id || "").replace(/\/+$/, "").toLowerCase();
      const ctx: CardCtx = { classified: classifyDeliverable(d), machineName: work.machineName, key };
      const existing = seen.get(key);
      if (!existing) seen.set(key, ctx);
      else if (existing.classified.category === "internal" && ctx.classified.category !== "internal") seen.set(key, ctx);
    }
  }
  return [...seen.values()];
}
