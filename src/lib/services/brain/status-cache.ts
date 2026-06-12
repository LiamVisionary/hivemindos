/**
 * Short-TTL, promise-coalescing cache for brain-service status checks.
 * Status loads shell out to service CLIs, so they're the most expensive
 * reads the dashboard serves — and the desktop tab, the phone's Services
 * pane and the aggregate `/api/brain/services/status` route often ask
 * within seconds of each other. One in-flight load serves every concurrent
 * caller, and the settled result stays warm briefly. Mutating actions
 * invalidate their service's entries so a post-action status is never
 * served stale.
 */

type Entry = { at: number; promise: Promise<unknown> };

const entries = new Map<string, Entry>();

export function cachedStatus<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && now - hit.at < ttlMs) return hit.promise as Promise<T>;
  const promise = load();
  entries.set(key, { at: now, promise });
  // A failed check must not pin its error for the whole TTL — drop it so
  // the next caller retries live.
  promise.catch(() => {
    if (entries.get(key)?.promise === promise) entries.delete(key);
  });
  return promise;
}

/** Drop every cached status whose key starts with `prefix` (service id). */
export function invalidateStatus(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}
