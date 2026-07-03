// Short-lived shared cache for the collector's hosted-app discovery sweep.
// The full port-probe sweep measured 3-5s on busy machines and used to run on
// EVERY /apps request — including remote voice turns that only needed to
// re-resolve an app they already knew. Plain /apps now shares one sweep per
// window (and one in-flight promise); ?refresh=1 still forces a live rescan.
export function createHostedAppsCache(discover, cacheMs = 60_000) {
  let cache = { at: 0, promise: null };
  return function discoverHostedAppsCached(refresh) {
    const now = Date.now();
    if (!refresh && cache.promise && now - cache.at < cacheMs) {
      return cache.promise;
    }
    const promise = discover().catch((error) => {
      // Never cache a failed sweep.
      if (cache.promise === promise) cache = { at: 0, promise: null };
      throw error;
    });
    cache = { at: now, promise };
    return promise;
  };
}
