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
  return Boolean(!result?.remediationProof && (target?.local || !result?.unreachable));
}

export function collectorChatProbeDecision(health, runtime = "hermes") {
  const capabilities = health?.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    // Legacy collectors did not publish a capability contract. Preserve their
    // existing deep-probe behavior until they update.
    return { supported: true };
  }
  if (capabilities.chat === false) {
    return { supported: false, reason: "collector advertises chat=false" };
  }
  if (Array.isArray(capabilities.runtimes)) {
    const advertised = capabilities.runtimes.map((value) => String(value).trim().toLowerCase());
    if (!advertised.includes(String(runtime).trim().toLowerCase())) {
      return { supported: false, reason: `collector does not advertise the ${runtime} runtime` };
    }
  }
  return { supported: true };
}

export function collectorChatFailureResult(status, detail) {
  const summary = String(detail || "unknown error").replace(/\s+/g, " ").trim().slice(0, 80);
  const reason = `chat HTTP ${status} ${summary}`;
  if (/\bspawn\s+(?:[^\s]*[\\/])?hermes(?:\.exe)?\s+ENOENT\b/i.test(summary)) {
    return {
      healthy: false,
      remediationProof: true,
      reason: `${reason} — Hermes is missing from the collector service runtime; restarting the collector cannot fix it`,
    };
  }
  return { healthy: false, severe: true, reason };
}
