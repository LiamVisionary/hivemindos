#!/usr/bin/env node
// Hermetic coverage for the Local TTS failure breaker + prewarm path:
// - breaker trips on a recorded failure, closes on success, and expires
// - synthesizeLocalTtsWav records failures/successes into the breaker
// - prewarm runs one warm synthesis, dedupes concurrent calls, and skips when
//   the server was healthy moments ago
// No live app/fleet/TTS server: fetch is fully mocked.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// Keep the link-control helper off the real collector.env / linkd.
process.env.HIVE_LINK_CONTROL_URL = "http://link.test";
// Keep the persisted-app cache inside a scratch dir (hermetic: no writes to
// the real ~/.hivemindos).
process.env.HIVEMINDOS_LOCAL_TTS_APP_CACHE_FILE = `${(await import("node:os")).tmpdir()}/hivemindos-test-local-tts-apps-${process.pid}.json`;
// Point HOME at a scratch dir BEFORE any project import: the dashboard-state
// path is derived from homedir() at module load, and the call-prefs coverage
// below writes its own dashboard-state.json — it must never touch the real
// ~/.hivemindos.
const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
const { join: joinPath } = await import("node:path");
const SCRATCH_HOME = await mkdtemp(
  joinPath((await import("node:os")).tmpdir(), "hivemindos-test-voice-home-"),
);
process.env.HOME = SCRATCH_HOME;
process.env.USERPROFILE = SCRATCH_HOME;

const {
  localTtsBreakerState,
  localTtsRecentlyHealthy,
  prewarmLocalTts,
  recordLocalTtsFailure,
  recordLocalTtsSuccess,
  resetLocalTtsHealth,
} = await import("../src/lib/services/phone/local-tts-health.ts");
const { synthesizeLocalTtsWav } = await import("../src/lib/services/phone/local-tts.ts");

const ORIGIN = "http://dashboard.test";
const APP_ID = "local:8799:universal-tts";
const PROVIDER_ID = `local-tts:${APP_ID}`;

// --- fetch mock -------------------------------------------------------------
let speechMode = "ok"; // "ok" | "http-500" | "network" | "slow-ok"
let speechCalls = 0;

function pcmBytes(sampleCount) {
  const bytes = new Uint8Array(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    bytes[i * 2] = i % 251;
    bytes[i * 2 + 1] = 1;
  }
  return bytes;
}

function speechResponse() {
  return new Response(pcmBytes(240), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "x-audio-sample-rate": "24000",
      "x-audio-channels": "1",
    },
  });
}

globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://link.test/status")) {
    return Response.json({ ok: true, peer: {} });
  }
  if (url.includes("/api/fleet/discover")) {
    return Response.json({ machines: [] });
  }
  if (url.includes("/api/fleet/apps")) {
    return Response.json({ apps: [] });
  }
  if (url.startsWith("http://127.0.0.1:8787/apps")) {
    return Response.json({
      apps: [
        {
          id: "universal-tts",
          name: "universal-tts",
          description: "Universal TTS",
          port: 8799,
          apiBaseUrl: "http://tts.test",
          serviceKind: "tts",
          apiRoutes: [
            { method: "GET", path: "/v1/audio/capabilities", summary: "caps" },
            { method: "POST", path: "/v1/audio/speech-stream", summary: "speech" },
          ],
        },
      ],
    });
  }
  if (url === "http://tts.test/health") {
    return Response.json({ ok: true });
  }
  if (url.startsWith("http://tts.test/v1/audio/speech-stream")) {
    speechCalls += 1;
    if (speechMode === "network") throw new TypeError("fetch failed");
    if (speechMode === "http-500") return new Response("boom", { status: 500 });
    if (speechMode === "slow-ok") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return speechResponse();
    }
    return speechResponse();
  }
  throw new Error(`Unexpected fetch in hermetic test: ${url}`);
};

// --- breaker unit behavior ---------------------------------------------------
{
  resetLocalTtsHealth();
  const t0 = 1_000_000;
  assert.equal(localTtsBreakerState(APP_ID, t0).open, false, "breaker starts closed");
  recordLocalTtsFailure(APP_ID, "HTTP 502", t0);
  const open = localTtsBreakerState(APP_ID, t0 + 1);
  assert.equal(open.open, true, "breaker opens on failure");
  assert.equal(open.lastError, "HTTP 502");
  assert.ok(open.retryInMs > 0 && open.retryInMs <= 45_000, "retry window is bounded");
  assert.equal(localTtsBreakerState(APP_ID, t0 + 46_000).open, false, "breaker expires");
  recordLocalTtsFailure(APP_ID, "HTTP 502", t0);
  recordLocalTtsSuccess(APP_ID, t0 + 2);
  assert.equal(localTtsBreakerState(APP_ID, t0 + 3).open, false, "success closes the breaker");
  assert.equal(localTtsRecentlyHealthy(APP_ID, t0 + 3), true, "success marks recently healthy");
  assert.equal(localTtsRecentlyHealthy(APP_ID, t0 + 300_000), false, "recent health expires");
  console.log("breaker unit behavior ok");
}

// --- synthesizeLocalTtsWav wires the breaker ---------------------------------
{
  resetLocalTtsHealth();
  speechMode = "http-500";
  const failed = await synthesizeLocalTtsWav({
    origin: ORIGIN,
    appId: APP_ID,
    model: "qwen3-tts-0.6b-custom",
    voice: "voice01",
    text: "Hello",
  });
  assert.equal(failed.ok, false, "HTTP 500 synth reports failure");
  assert.equal(localTtsBreakerState(APP_ID).open, true, "HTTP failure trips the breaker");

  speechMode = "ok";
  const succeeded = await synthesizeLocalTtsWav({
    origin: ORIGIN,
    appId: APP_ID,
    model: "qwen3-tts-0.6b-custom",
    voice: "voice01",
    text: "Hello",
  });
  assert.equal(succeeded.ok, true, "synth succeeds against the mock server");
  assert.equal(succeeded.bytes, 480, "PCM bytes preserved");
  assert.equal(succeeded.wav.byteLength, 44 + 480, "WAV = RIFF header + PCM");
  assert.equal(localTtsBreakerState(APP_ID).open, false, "success closes the breaker");

  speechMode = "network";
  const network = await synthesizeLocalTtsWav({
    origin: ORIGIN,
    appId: APP_ID,
    model: "qwen3-tts-0.6b-custom",
    voice: "voice01",
    text: "Hello",
  });
  assert.equal(network.ok, false, "network error reports failure");
  assert.equal(localTtsBreakerState(APP_ID).open, true, "network failure trips the breaker");
  console.log("synthesizeLocalTtsWav breaker wiring ok");
}

// --- prewarm: warm run, in-flight dedupe, recently-healthy skip --------------
{
  resetLocalTtsHealth();
  speechMode = "slow-ok";
  speechCalls = 0;
  const input = {
    origin: ORIGIN,
    voiceProviderId: PROVIDER_ID,
    voiceModelId: "qwen3-tts-0.6b-custom",
    voiceId: "voice01",
  };
  const [first, second] = await Promise.all([prewarmLocalTts(input), prewarmLocalTts(input)]);
  assert.equal(first.ok, true, "prewarm succeeds");
  assert.equal(first.warmed, true, "prewarm ran a warm synthesis");
  assert.equal(second.ok, true, "concurrent prewarm succeeds");
  assert.equal(speechCalls, 1, "concurrent prewarms dedupe to one synthesis");

  speechMode = "ok";
  const third = await prewarmLocalTts(input);
  assert.equal(third.ok, true);
  assert.equal(third.warmed, false, "recently-healthy prewarm skips the synthesis");
  assert.equal(third.skipped, "recently-healthy");
  assert.equal(speechCalls, 1, "no extra synthesis for a warm server");
  console.log("prewarm dedupe + skip ok");
}

// --- prewarm failure reporting ------------------------------------------------
{
  resetLocalTtsHealth();
  speechMode = "http-500";
  const failed = await prewarmLocalTts({
    origin: ORIGIN,
    voiceProviderId: PROVIDER_ID,
    voiceModelId: "qwen3-tts-0.6b-custom",
    voiceId: "voice01",
  });
  assert.equal(failed.ok, false, "failed prewarm reports ok:false");
  assert.equal(failed.warmed, false);
  assert.ok(failed.error, "failed prewarm carries the error");
  assert.equal(localTtsBreakerState(APP_ID).open, true, "failed prewarm trips the breaker");
  console.log("prewarm failure reporting ok");
}

// --- call prefs: a store outage is never "cloud voice selected" --------------
// Voice continuity (2026-07-02): a transient failure reading the agent-profile
// store used to read as calls=null → "local TTS not selected" → the route
// spoke in a substitute OpenAI voice. An outage must instead surface as
// unavailable (route: 503 voiceUnavailable → overlay mutes) or serve the
// last-known-good prefs.
{
  const {
    QueenCallPreferencesUnavailableError,
    readQueenBeeCallPreferences,
    resetQueenBeeCallPreferencesCache,
  } = await import("../src/lib/services/queen-bee/voice-settings.ts");

  const stateDir = joinPath(SCRATCH_HOME, ".hivemindos");
  const stateFile = joinPath(stateDir, "dashboard-state.json");
  await mkdir(stateDir, { recursive: true });
  const stateWithProfiles = (profilesJson) =>
    JSON.stringify({
      version: 1,
      values: { "hivemindos.agentProfiles.v1": profilesJson },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  const t0 = 1_000_000;

  // Cold start against a corrupt store: outage, not "no local voice selected".
  resetQueenBeeCallPreferencesCache();
  await writeFile(stateFile, "{ definitely not json", "utf8");
  await assert.rejects(
    () => readQueenBeeCallPreferences(t0),
    QueenCallPreferencesUnavailableError,
    "corrupt store with no known-good prefs surfaces an outage",
  );

  // A healthy read resolves the queen's local voice and seeds last-known-good.
  await writeFile(
    stateFile,
    stateWithProfiles(
      JSON.stringify([
        {
          id: "queen-1",
          name: "Queen Bee",
          beeRole: "queen",
          calls: { voiceRuntime: "local-tts", voiceProviderId: PROVIDER_ID, voiceId: "voice01" },
        },
      ]),
    ),
    "utf8",
  );
  resetQueenBeeCallPreferencesCache();
  const healthy = await readQueenBeeCallPreferences(t0);
  assert.equal(healthy?.voiceRuntime, "local-tts", "healthy read resolves the queen's local voice");

  // Store breaks after the 15s TTL: serve last-known-good, not null/throw.
  await writeFile(stateFile, "{ definitely not json", "utf8");
  const stale = await readQueenBeeCallPreferences(t0 + 20_000);
  assert.equal(stale?.voiceRuntime, "local-tts", "outage after a good read serves last-known-good prefs");
  assert.equal(stale?.voiceProviderId, PROVIDER_ID, "stale prefs keep the provider id");

  // A corrupt profiles VALUE (state file itself fine) is also an outage.
  await writeFile(stateFile, stateWithProfiles("[ not json"), "utf8");
  resetQueenBeeCallPreferencesCache();
  await assert.rejects(
    () => readQueenBeeCallPreferences(t0 + 40_000),
    QueenCallPreferencesUnavailableError,
    "corrupt profiles value surfaces an outage, not an empty profile list",
  );

  // A missing store file is a legitimate fresh install: cloud default (null).
  await rm(stateFile, { force: true });
  resetQueenBeeCallPreferencesCache();
  assert.equal(
    await readQueenBeeCallPreferences(t0 + 60_000),
    null,
    "missing store reads as no prefs (fresh install), not an outage",
  );
  console.log("call-prefs outage continuity ok");
}

// --- persisted app hint survives eviction (the cold-open fix, 2026-07-05) ----
// A transient TTS flap (NYC box briefly unreachable) evicts the HOT cache, but
// must NOT discard the DURABLE disk hint — otherwise the next cold open pays a
// full ~12s fleet sweep. The hint is instead revalidated with a fast health
// probe on reuse; a genuinely-moved URL is overwritten by the next discovery.
{
  const cache = await import("../src/lib/services/phone/local-tts-app-cache.ts");
  const HINT_ORIGIN = "http://hint.test";
  // Selected id encodes the OLD host; the resolved app's own id the NEW host
  // (a machine rename rotates the id) — mirrors the real hostname-rename case.
  const SELECTED_ID = "hivemindos-old-host.tail.ts.net:8799:aaaa";
  const app = {
    id: "hivemindos-new-host.tail.ts.net:8799:bbbb",
    name: "universal-tts",
    apiBaseUrl: "http://tts.test",
    port: 8799,
  };

  cache.touchCachedApp(HINT_ORIGIN, SELECTED_ID, app);
  assert.equal(
    cache.cachedApp(HINT_ORIGIN, SELECTED_ID)?.id,
    app.id,
    "a successful synth caches the app under the selected id",
  );
  assert.equal(
    cache.persistedAppHint(SELECTED_ID)?.id,
    app.id,
    "and records a durable disk hint under the selected id",
  );

  cache.evictCachedApp(HINT_ORIGIN, SELECTED_ID, app);
  assert.equal(
    cache.cachedApp(HINT_ORIGIN, SELECTED_ID),
    null,
    "a transient failure evicts the HOT cache entry",
  );
  assert.equal(
    cache.persistedAppHint(SELECTED_ID)?.id,
    app.id,
    "but KEEPS the durable hint — the next cold open revalidates it instead of a fleet sweep",
  );
  console.log("persisted app hint survives eviction ok");
}

console.log("test-local-tts-robustness: all assertions passed");
