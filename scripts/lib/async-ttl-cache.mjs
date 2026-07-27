export function createAsyncTtlCache(options) {
  const ttlMs = Number(options.ttlMs);
  const load = options.load;
  let cached = null;
  let inFlight = null;

  async function get(input = {}) {
    const force = input.force === true;
    const now = Date.now();
    if (!force && cached && now - cached.loadedAt < ttlMs) {
      return cached.value;
    }
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(load)
      .then((value) => {
        cached = { value, loadedAt: Date.now() };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function invalidate() {
    cached = null;
  }

  return { get, invalidate };
}
