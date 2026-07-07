/**
 * Pure mutations over a Hermes cron store document (`~/.hermes/cron/jobs.json`).
 *
 * The remote/local cron-write primitive reads a machine's jobs.json, applies one
 * of these mutations here (single-sourced, hermetically tested), and writes the
 * result back — so the JSON-shaping logic never lives in a shell one-liner where
 * quoting bugs could corrupt a production cron file.
 */

export type HermesCronJob = Record<string, unknown> & {
  id?: string;
  name?: string;
  enabled?: boolean;
  state?: string;
};

export type HermesCronDoc = Record<string, unknown> & {
  jobs?: HermesCronJob[];
  updated_at?: string;
};

export type CronMutation =
  | { action: "upsert"; job: HermesCronJob }
  | { action: "remove"; jobId: string }
  | { action: "set-enabled"; jobId: string; enabled: boolean };

export type CronMutationResult = { doc: HermesCronDoc; changed: number };

/** Parse a jobs.json string into a doc; tolerant of empty/whitespace. */
export function parseHermesCronDoc(raw: string): HermesCronDoc {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { jobs: [] };
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object") return { jobs: [] };
  const doc = parsed as HermesCronDoc;
  if (!Array.isArray(doc.jobs)) doc.jobs = [];
  return doc;
}

/**
 * Apply one mutation, returning a new doc and how many jobs changed.
 * - upsert: replace the job with the same id (shallow-merged) or append it.
 * - remove: drop every job with that id.
 * - set-enabled: flip `enabled` (and `state` to scheduled/paused) for that id.
 * `changed` is 0 when the target id is absent, so callers can detect no-ops.
 */
export function applyCronMutation(
  doc: HermesCronDoc,
  mutation: CronMutation,
  nowIso: string,
): CronMutationResult {
  const jobs: HermesCronJob[] = Array.isArray(doc.jobs) ? doc.jobs.map((job) => ({ ...job })) : [];
  let changed = 0;

  if (mutation.action === "upsert") {
    const id = mutation.job.id;
    const index = id ? jobs.findIndex((job) => job.id === id) : -1;
    if (index >= 0) jobs[index] = { ...jobs[index], ...mutation.job };
    else jobs.push({ ...mutation.job });
    changed = 1;
  } else if (mutation.action === "remove") {
    const before = jobs.length;
    const kept = jobs.filter((job) => job.id !== mutation.jobId);
    changed = before - kept.length;
    return { doc: { ...doc, jobs: kept, updated_at: nowIso }, changed };
  } else if (mutation.action === "set-enabled") {
    for (const job of jobs) {
      if (job.id === mutation.jobId) {
        job.enabled = mutation.enabled;
        job.state = mutation.enabled ? "scheduled" : "paused";
        changed += 1;
      }
    }
  }

  return { doc: { ...doc, jobs, updated_at: nowIso }, changed };
}

/** Serialize a doc back to the 2-space-indented shape Hermes writes. */
export function serializeHermesCronDoc(doc: HermesCronDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
