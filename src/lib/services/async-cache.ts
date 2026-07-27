// Short-lived in-flight + result cache for expensive async reads (gh CLI calls,
// shell scripts, vault scans). It caches the *Promise*, so concurrent callers
// within the TTL window share a single underlying call instead of each spawning
// their own — this both de-dupes simultaneous requests and serves rapid repeat
// reads from memory. Failed calls are evicted immediately so errors are never
// cached.

type CacheEntry = { at: number; value: Promise<unknown> };

const cache = new Map<string, CacheEntry>();

// Entries are only ever dropped on read (TTL miss) or explicit invalidation,
// so one-off keys would otherwise pin their promised results (vault scans, CLI
// output) for the life of the server process. Bound the map: when full, first
// sweep out entries older than the oldest plausible TTL, then fall back to
// dropping the oldest insertions.
const CACHE_MAX_ENTRIES = 512;
const CACHE_SWEEP_MAX_AGE_MS = 10 * 60_000;

function evictForInsert(now: number) {
  if (cache.size < CACHE_MAX_ENTRIES) return;
  for (const [key, entry] of cache) {
    if (now - entry.at > CACHE_SWEEP_MAX_AGE_MS) cache.delete(key);
  }
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function cachedCall<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  evictForInsert(now);
  cache.set(key, { at: now, value });
  // Never cache a rejection: drop the entry once it settles to an error so the
  // next caller retries instead of replaying a stale failure.
  value.catch(() => {
    const current = cache.get(key);
    if (current && current.value === value) cache.delete(key);
  });
  return value;
}

// Drop every cached entry whose key starts with `prefix`. Call this from
// mutating code paths so the next read reflects the write immediately rather
// than waiting out the TTL.
export function invalidateCachedCall(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
