// Resolved-app cache for Local TTS: which connected-app id maps to which
// reachable API base URL. In-memory with a sliding TTL, plus cross-restart
// persistence — a cold server process used to pay connected-app discovery
// (measured 4-10s) before the FIRST spoken reply could start, even though the
// resolved proxy URL stays stable for days. A synth failure evicts the entry
// (stale URLs cost one fast failure, then rediscovery), and every successful
// synth re-arms the TTL and the persisted copy.

import { join } from "path";
import { homedir } from "@/lib/home-dir";
import type { ConnectedHostedApp } from "@/lib/services/fleet/connected-apps";

export const APP_CACHE_MS = 5 * 60_000;
const PERSISTED_APPS_VERSION = 2;
const PERSISTED_APPS_MAX_AGE_MS = 7 * 24 * 3_600_000;
const PERSIST_APPS_DEBOUNCE_MS = 1_500;

type CacheEntry = { expiresAt: number; app: ConnectedHostedApp };
export type PersistedLocalTtsValidation = {
  appId: string;
  appName: string;
  machineName?: string;
  model: string;
  voice: string;
  availableModels: string[];
  availableVoices: string[];
  sampleRate: number;
  channels: number;
  sampleFormat: string;
  streamingKind?: string;
  streamingImplementation?: string;
  validatedAt: number;
};
type PersistedAppEntry = {
  appId: string;
  app: ConnectedHostedApp;
  savedAt: number;
  validation?: PersistedLocalTtsValidation;
};

const appById = new Map<string, CacheEntry>();
const persistedApps = new Map<string, PersistedAppEntry>();
const hydratedOrigins = new Set<string>();
let persistedAppsLoad: Promise<void> | null = null;
let persistAppsTimer: ReturnType<typeof setTimeout> | null = null;

function cacheKey(origin: string, appId: string) {
  return `${origin.replace(/\/+$/, "")}::${appId}`;
}

function persistedAppsPath() {
  return process.env.HIVEMINDOS_LOCAL_TTS_APP_CACHE_FILE
    || join(homedir(), ".hivemindos", "cache", "local-tts-apps.json");
}

export function cachedApp(origin: string, appId: string): ConnectedHostedApp | null {
  const entry = appById.get(cacheKey(origin, appId));
  return entry && entry.expiresAt > Date.now() ? entry.app : null;
}

/** Index one discovered app under its own id (fresh discovery results). */
export function rememberAppById(origin: string, app: ConnectedHostedApp, expiresAt: number) {
  if (app.id && app.apiBaseUrl) appById.set(cacheKey(origin, app.id), { expiresAt, app });
}

// Sliding expiry for an app that just served audio successfully: warm voice
// sessions should never re-pay connected-app discovery mid-conversation.
// Registered under both the app's own id and the caller's selected id (they
// can differ across host aliases).
export function touchCachedApp(origin: string, selectedAppId: string, app: ConnectedHostedApp) {
  if (!app.id || !app.apiBaseUrl) return;
  const entry = { expiresAt: Date.now() + APP_CACHE_MS, app };
  appById.set(cacheKey(origin, app.id), entry);
  if (selectedAppId && selectedAppId !== app.id) {
    appById.set(cacheKey(origin, selectedAppId), entry);
  }
  persistedApps.set(selectedAppId || app.id, {
    appId: selectedAppId || app.id,
    app,
    savedAt: Date.now(),
    validation: persistedApps.get(selectedAppId || app.id)?.validation,
  });
  schedulePersistApps();
}

/** Last successfully advertised model/voice set for this selected server.
 * Session setup may trust this snapshot immediately and refresh it in the
 * background; that keeps cold answer latency independent of fleet probes. */
export function persistedAppValidation(selectedAppId: string): PersistedLocalTtsValidation | null {
  const validation = persistedApps.get(selectedAppId)?.validation;
  if (!validation || Date.now() - validation.validatedAt > PERSISTED_APPS_MAX_AGE_MS) return null;
  return validation;
}

export function rememberAppValidation(
  selectedAppId: string,
  validation: PersistedLocalTtsValidation,
) {
  const existing = persistedApps.get(selectedAppId);
  if (!existing) return;
  persistedApps.set(selectedAppId, {
    ...existing,
    savedAt: Date.now(),
    validation: { ...validation, validatedAt: Date.now() },
  });
  schedulePersistApps();
}

// A failed synth/stream against a resolved base URL means that URL may be
// stale (moved proxy, restarted linkd); drop the HOT in-memory entry so the
// next attempt re-resolves instead of re-failing from cache for the rest of
// the TTL. The DURABLE disk hint is deliberately KEPT: a transient TTS flap
// (NYC box briefly down) must not force the next cold start to pay a ~12s
// fleet sweep — the hint is revalidated with one fast health probe on reuse
// (see resolvedTtsApp), and a genuinely-moved URL is overwritten by the next
// successful discovery.
export function evictCachedApp(origin: string, selectedAppId: string, app?: ConnectedHostedApp | null) {
  appById.delete(cacheKey(origin, selectedAppId));
  if (app?.id && app.id !== selectedAppId) appById.delete(cacheKey(origin, app.id));
}

// The durable "last known good" app for a selected id, from the persisted
// hint set (survives restarts and transient failures). Unlike cachedApp this
// is NOT trusted blindly — the caller health-probes it before a synth.
export function persistedAppHint(selectedAppId: string): ConnectedHostedApp | null {
  return persistedApps.get(selectedAppId)?.app ?? null;
}

// One fast health check against a resolved app's proxy URL: decides whether a
// durable disk hint is still live before a synth commits to it. A live hint
// answers well under the timeout; a dead one costs at most this instead of a
// slow synth timeout, then the caller falls through to discovery.
const HINT_PROBE_TIMEOUT_MS = 1_500;
export async function probeAppHealthy(app: ConnectedHostedApp): Promise<boolean> {
  const base = app.apiBaseUrl?.replace(/\/+$/, "");
  if (!base) return false;
  try {
    const response = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(HINT_PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function hydratePersistedApps(origin: string) {
  if (!persistedAppsLoad) {
    persistedAppsLoad = (async () => {
      try {
        const { readFile } = await import("node:fs/promises");
        const raw = await readFile(persistedAppsPath(), "utf8");
        const data = JSON.parse(raw) as { version?: unknown; entries?: unknown };
        if ((data.version !== 1 && data.version !== PERSISTED_APPS_VERSION) || !Array.isArray(data.entries)) return;
        const now = Date.now();
        for (const item of data.entries) {
          const entry = item && typeof item === "object" ? item as Record<string, unknown> : null;
          const app = entry?.app && typeof entry.app === "object" ? entry.app as ConnectedHostedApp : null;
          const appId = typeof entry?.appId === "string" ? entry.appId.trim() : "";
          const savedAt = Number(entry?.savedAt) || 0;
          if (!appId || !app?.apiBaseUrl || !savedAt) continue;
          if (now - savedAt > PERSISTED_APPS_MAX_AGE_MS) continue;
          const rawValidation = entry?.validation && typeof entry.validation === "object"
            ? entry.validation as Record<string, unknown>
            : null;
          const validatedAt = Number(rawValidation?.validatedAt) || 0;
          const validation = rawValidation
            && typeof rawValidation.appId === "string"
            && typeof rawValidation.appName === "string"
            && typeof rawValidation.model === "string"
            && typeof rawValidation.voice === "string"
            && Array.isArray(rawValidation.availableModels)
            && Array.isArray(rawValidation.availableVoices)
            && validatedAt
            && now - validatedAt <= PERSISTED_APPS_MAX_AGE_MS
            ? {
                appId: rawValidation.appId,
                appName: rawValidation.appName,
                machineName: typeof rawValidation.machineName === "string" ? rawValidation.machineName : undefined,
                model: rawValidation.model,
                voice: rawValidation.voice,
                availableModels: rawValidation.availableModels.filter((item): item is string => typeof item === "string"),
                availableVoices: rawValidation.availableVoices.filter((item): item is string => typeof item === "string"),
                sampleRate: Number(rawValidation.sampleRate) || 24_000,
                channels: Number(rawValidation.channels) || 1,
                sampleFormat: typeof rawValidation.sampleFormat === "string" ? rawValidation.sampleFormat : "pcm16",
                streamingKind: typeof rawValidation.streamingKind === "string" ? rawValidation.streamingKind : undefined,
                streamingImplementation: typeof rawValidation.streamingImplementation === "string"
                  ? rawValidation.streamingImplementation
                  : undefined,
                validatedAt,
              }
            : undefined;
          persistedApps.set(appId, { appId, app, savedAt, validation });
        }
      } catch {
        // First run or unreadable cache; discovery rebuilds it.
      }
    })();
  }
  await persistedAppsLoad;
  if (hydratedOrigins.has(origin)) return;
  hydratedOrigins.add(origin);
  const now = Date.now();
  for (const entry of persistedApps.values()) {
    const key = cacheKey(origin, entry.appId);
    if (!appById.has(key)) appById.set(key, { expiresAt: now + APP_CACHE_MS, app: entry.app });
    if (entry.app.id && entry.app.id !== entry.appId) {
      const ownKey = cacheKey(origin, entry.app.id);
      if (!appById.has(ownKey)) appById.set(ownKey, { expiresAt: now + APP_CACHE_MS, app: entry.app });
    }
  }
}

function schedulePersistApps() {
  if (persistAppsTimer) return;
  persistAppsTimer = setTimeout(() => {
    persistAppsTimer = null;
    void (async () => {
      try {
        const { mkdir, rename, writeFile } = await import("node:fs/promises");
        const { dirname } = await import("node:path");
        const file = persistedAppsPath();
        await mkdir(dirname(file), { recursive: true });
        const payload = JSON.stringify({
          version: PERSISTED_APPS_VERSION,
          entries: [...persistedApps.values()],
        });
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, payload, "utf8");
        await rename(temporary, file);
      } catch {
        // Persistence is best-effort; the in-memory cache still applies.
      }
    })();
  }, PERSIST_APPS_DEBOUNCE_MS);
}
