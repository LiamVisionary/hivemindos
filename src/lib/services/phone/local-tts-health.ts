// Shared health/circuit-breaker state for connected Local TTS (Universal TTS)
// servers, keyed by connected-app id.
//
// Why: telemetry showed the worst "voice never played" turns were fallback
// cascades — the streaming path spent seconds failing against a down TTS
// server, then the buffered path retried the SAME server for up to 30s, and
// only then did OpenAI (or browser synthesis) speak. The breaker remembers a
// very recent failure for a short window so every consumer (overlay stream,
// buffered speak, phone calls) skips the doomed attempt and falls back fast.
// Any success — including a prewarm probe — closes the breaker immediately.

const BREAKER_TRIP_MS = 45_000;
// A synthesis/stream completed this recently means the server (and the model
// it just used) is warm; prewarm becomes a no-op instead of burning GPU time.
const RECENTLY_HEALTHY_MS = 120_000;

type LocalTtsAppHealth = {
  trippedAt: number;
  trippedUntil: number;
  lastError: string;
  failures: number;
  lastHealthyAt: number;
};

export type LocalTtsBreakerState = {
  open: boolean;
  lastError?: string;
  retryInMs: number;
  failures: number;
};

const healthByApp = new Map<string, LocalTtsAppHealth>();

function entryFor(appId: string): LocalTtsAppHealth {
  const existing = healthByApp.get(appId);
  if (existing) return existing;
  const created: LocalTtsAppHealth = {
    trippedAt: 0,
    trippedUntil: 0,
    lastError: "",
    failures: 0,
    lastHealthyAt: 0,
  };
  healthByApp.set(appId, created);
  return created;
}

/** An aborted caller (client went away) is not evidence the server is broken. */
export function isCallerAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function recordLocalTtsFailure(appId: string, error: string, now = Date.now()) {
  const id = appId.trim();
  if (!id) return;
  const entry = entryFor(id);
  entry.failures += 1;
  entry.lastError = error.slice(0, 300);
  entry.trippedAt = now;
  entry.trippedUntil = now + BREAKER_TRIP_MS;
  entry.lastHealthyAt = 0;
}

export function recordLocalTtsSuccess(appId: string, now = Date.now()) {
  const id = appId.trim();
  if (!id) return;
  const entry = entryFor(id);
  entry.failures = 0;
  entry.lastError = "";
  entry.trippedAt = 0;
  entry.trippedUntil = 0;
  entry.lastHealthyAt = now;
}

export function localTtsBreakerState(appId: string, now = Date.now()): LocalTtsBreakerState {
  const entry = healthByApp.get(appId.trim());
  if (!entry || entry.trippedUntil <= now) {
    return { open: false, retryInMs: 0, failures: entry?.failures ?? 0 };
  }
  return {
    open: true,
    lastError: entry.lastError || undefined,
    retryInMs: entry.trippedUntil - now,
    failures: entry.failures,
  };
}

export function localTtsRecentlyHealthy(appId: string, now = Date.now()) {
  const entry = healthByApp.get(appId.trim());
  return Boolean(entry && entry.lastHealthyAt && now - entry.lastHealthyAt < RECENTLY_HEALTHY_MS);
}

export function resetLocalTtsHealth() {
  healthByApp.clear();
}

export type LocalTtsPrewarmResult = {
  ok: boolean;
  appId?: string;
  appName?: string;
  model?: string;
  voice?: string;
  /** True when a warm synthesis actually ran (vs. skipped as already warm). */
  warmed: boolean;
  skipped?: string;
  ms: number;
  error?: string;
};

const prewarmInFlight = new Map<string, Promise<LocalTtsPrewarmResult>>();

/**
 * Warm the selected Local TTS server before the first spoken reply needs it.
 *
 * Cold model loads measured 5-30s at speak time — long enough to trip the
 * buffered timeout and bounce the reply to the OpenAI voice. Running a tiny
 * throwaway synthesis while the overlay is opening (and again while the LLM is
 * composing each reply) moves that cost off the audible path. Also doubles as
 * the breaker's recovery probe: a success re-closes it.
 */
export async function prewarmLocalTts(input: {
  origin: string;
  voiceProviderId?: string;
  voiceModelId?: string;
  voiceId?: string;
}): Promise<LocalTtsPrewarmResult> {
  const startedAt = Date.now();
  // Lazy import avoids a static local-tts <-> local-tts-health cycle.
  const { resolveLocalTtsCallConfig, synthesizeLocalTtsWav } = await import("./local-tts");
  const config = await resolveLocalTtsCallConfig({
    origin: input.origin,
    voiceProviderId: input.voiceProviderId,
    voiceModelId: input.voiceModelId,
    voiceId: input.voiceId,
    openingLine: "",
    // Prewarm is off the audible path, so pay discovery here: stored ids get
    // validated against the server's advertised voices before the first
    // spoken turn (a stale id would otherwise 404 and trip the breaker).
    awaitDiscoveryForValidation: true,
  }).catch(() => null);
  if (!config) {
    return {
      ok: false,
      warmed: false,
      ms: Date.now() - startedAt,
      error: "no validated local TTS server",
    };
  }
  if (localTtsRecentlyHealthy(config.appId)) {
    return {
      ok: true,
      appId: config.appId,
      appName: config.appName,
      model: config.model,
      voice: config.voice,
      warmed: false,
      skipped: "recently-healthy",
      ms: Date.now() - startedAt,
    };
  }
  const key = `${config.appId}::${config.model}::${config.voice}`;
  const inFlight = prewarmInFlight.get(key);
  if (inFlight) return inFlight;
  const run = (async (): Promise<LocalTtsPrewarmResult> => {
    try {
      const result = await synthesizeLocalTtsWav({
        origin: input.origin,
        appId: config.appId,
        model: config.model,
        voice: config.voice,
        text: "Ready.",
      });
      if (!result.ok) {
        return {
          ok: false,
          appId: config.appId,
          appName: config.appName,
          model: config.model,
          voice: config.voice,
          warmed: false,
          ms: Date.now() - startedAt,
          error: result.error,
        };
      }
      return {
        ok: true,
        appId: config.appId,
        appName: result.appName || config.appName,
        model: config.model,
        voice: config.voice,
        warmed: true,
        ms: Date.now() - startedAt,
      };
    } finally {
      prewarmInFlight.delete(key);
    }
  })();
  prewarmInFlight.set(key, run);
  return run;
}
