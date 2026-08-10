const MACHINE_CACHE_VERSION = 1;
const MAX_FUTURE_CLOCK_SKEW_MS = 60_000;

export function createMachineCacheSnapshot(machines, cachedAt = Date.now()) {
  return {
    version: MACHINE_CACHE_VERSION,
    cachedAt,
    machines: Array.isArray(machines) ? machines : [],
  };
}

export function readFreshMachineCache(raw, {
  now = Date.now(),
  ttlMs,
} = {}) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { fresh: false, machines: [], reason: "invalid-cache" };
  }

  // Older watchdogs persisted a bare machine array with no observation time.
  // It cannot prove that any target is still online, so it is reference data,
  // never live monitoring authority.
  if (Array.isArray(parsed)) {
    return { fresh: false, machines: [], reason: "legacy-cache" };
  }

  const cachedAt = Number(parsed?.cachedAt);
  const effectiveNow = Number(now);
  const effectiveTtl = Number(ttlMs);
  if (
    parsed?.version !== MACHINE_CACHE_VERSION
    || !Array.isArray(parsed?.machines)
    || !Number.isFinite(cachedAt)
    || !Number.isFinite(effectiveNow)
    || !Number.isFinite(effectiveTtl)
    || effectiveTtl <= 0
  ) {
    return { fresh: false, machines: [], reason: "invalid-cache" };
  }

  const ageMs = effectiveNow - cachedAt;
  if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
    return { fresh: false, machines: [], reason: "future-cache" };
  }
  if (ageMs > effectiveTtl) {
    return { fresh: false, machines: [], reason: "stale-cache" };
  }
  return { fresh: true, machines: parsed.machines, ageMs: Math.max(0, ageMs) };
}

export function shouldAttemptRemediation(target, result) {
  return Boolean(target?.local || !result?.unreachable);
}
