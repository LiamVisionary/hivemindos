import { discoverRawConnectedApps, type ConnectedHostedApp } from "@/lib/services/fleet/connected-apps";
import { hivemindLinkControlUrl } from "@/lib/services/hivemind-link-control";

export const LOCAL_TTS_RUNTIME = "local-tts";
export const LOCAL_TTS_PROVIDER_PREFIX = "local-tts:";
const DEFAULT_LOCAL_TTS_MODEL = "chatterbox-turbo";
const DEFAULT_LOCAL_TTS_VOICE = "voice01";
const DEFAULT_SAMPLE_RATE = 24_000;
const DISCOVERY_TIMEOUT_MS = 12_000;
const RAW_TTS_DISCOVERY_TIMEOUT_MS = 2_500;
const PROBE_TIMEOUT_MS = 8_000;
const STREAM_TIMEOUT_MS = 120_000;
const APP_CACHE_MS = 5 * 60_000;
const CANDIDATE_CACHE_MS = 60_000;
const PREFERRED_LOCAL_TTS_MODELS = [
  "chatterbox-turbo",
  "ResembleAI/chatterbox-turbo",
  "vibevoice-coreml",
  "vibevoice-coreml-0.5b",
  "vibevoice-realtime-0.5b",
  "vibevoice-realtime-0.5B",
  "vibevoice",
];
const PREFERRED_LOCAL_TTS_VOICES = ["voice01", "liam-default"];

export type LocalTtsCandidate = {
  id: string;
  appId: string;
  name: string;
  machineName?: string;
  port?: number;
  score: number;
  ok: boolean;
  error?: string;
  model: string;
  voice: string;
  models: string[];
  voiceCount?: number;
  supportsStreamingApi: boolean;
  supportsTrueStreaming: boolean;
  streamingKind?: string;
  streamingImplementation?: string;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
  routeHints: string[];
};

export type LocalTtsCallConfig = {
  provider: typeof LOCAL_TTS_RUNTIME;
  appId: string;
  appName: string;
  machineName?: string;
  model: string;
  voice: string;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
  streamingKind?: string;
  streamingImplementation?: string;
  openingLine: string;
};

type HostedApp = ConnectedHostedApp;

type AppCacheEntry = {
  expiresAt: number;
  apps: HostedApp[];
};

type CandidateCacheEntry = {
  expiresAt: number;
  candidates: LocalTtsCandidate[];
};

type UniversalFallbackApp = {
  app: HostedApp;
  capabilities: unknown;
};

type CapabilitiesPayload = {
  supports_streaming_api?: unknown;
  supports_true_streaming?: unknown;
  loaded?: unknown;
  streaming_kind?: unknown;
  streaming_implementation?: unknown;
  sample_rate?: unknown;
  channels?: unknown;
  sample_format?: unknown;
  models?: unknown;
  voices_endpoint?: unknown;
};

type SelectedCapabilities = CapabilitiesPayload & {
  providerId?: string;
  models: string[];
};

type LinkPeer = {
  HostName?: string;
  DNSName?: string;
  OS?: string;
  Online?: boolean;
  TailscaleIPs?: string[];
};

type LinkStatus = {
  peer?: Record<string, LinkPeer>;
};

const appsByOrigin = new Map<string, AppCacheEntry>();
const appById = new Map<string, { expiresAt: number; app: HostedApp }>();
const candidatesByOrigin = new Map<string, CandidateCacheEntry>();

function cacheKey(origin: string, appId: string) {
  return `${origin.replace(/\/+$/, "")}::${appId}`;
}

function fresh<T extends { expiresAt: number }>(entry: T | undefined) {
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

function rememberApps(origin: string, apps: HostedApp[]) {
  const expiresAt = Date.now() + APP_CACHE_MS;
  appsByOrigin.set(origin, { expiresAt, apps });
  for (const app of apps) {
    if (app.id && app.apiBaseUrl) appById.set(cacheKey(origin, app.id), { expiresAt, app });
  }
}

function rememberCandidates(origin: string, candidates: LocalTtsCandidate[]) {
  candidatesByOrigin.set(origin, { expiresAt: Date.now() + CANDIDATE_CACHE_MS, candidates });
}

function cachedApp(origin: string, appId: string) {
  return fresh(appById.get(cacheKey(origin, appId)))?.app ?? null;
}

function cachedCandidates(origin: string) {
  return fresh(candidatesByOrigin.get(origin))?.candidates ?? null;
}

function providerId(appId: string) {
  return `${LOCAL_TTS_PROVIDER_PREFIX}${appId}`;
}

function appIdHint(value?: string) {
  const text = value?.trim() || "";
  const match = /^(.+):(\d+):(.+)$/.exec(text);
  if (!match) return null;
  return { host: match[1], port: Number(match[2]) };
}

function matchesAppId(app: HostedApp, selectedAppId: string) {
  if (app.id === selectedAppId) return true;
  const selected = appIdHint(selectedAppId);
  const candidate = appIdHint(app.id);
  if (!selected || !candidate || selected.host !== candidate.host) return false;
  return selected.port === candidate.port;
}

export function isLocalTtsProviderId(value?: string): value is string {
  return typeof value === "string" && value.startsWith(LOCAL_TTS_PROVIDER_PREFIX);
}

export function appIdFromLocalTtsProviderId(value?: string) {
  return isLocalTtsProviderId(value) ? value.slice(LOCAL_TTS_PROVIDER_PREFIX.length) : "";
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (value && typeof value === "object") {
    const data = value as { data?: unknown };
    if (Array.isArray(data.data)) return cleanList(data.data);
  }
  return [];
}

function modelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { data?: unknown; models?: unknown };
  const values = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return values.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const id = clean((item as { id?: unknown; model?: unknown; name?: unknown }).id)
        || clean((item as { model?: unknown }).model)
        || clean((item as { name?: unknown }).name);
      return id ? [id] : [];
    }
    return [];
  });
}

function voiceIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { voices?: unknown; data?: unknown };
  const values = Array.isArray(record.voices) ? record.voices : Array.isArray(record.data) ? record.data : [];
  return values.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const id = clean((item as { id?: unknown; voice?: unknown; name?: unknown }).id)
        || clean((item as { voice?: unknown }).voice)
        || clean((item as { name?: unknown }).name);
      return id ? [id] : [];
    }
    return [];
  });
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ipv4(value?: string) {
  const text = value?.trim() || "";
  return /^\d+\.\d+\.\d+\.\d+$/.test(text) ? text : "";
}

async function jsonAt<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function linkPeerName(peer: LinkPeer | undefined) {
  return clean(peer?.DNSName).replace(/\.$/, "").split(".")[0]
    || clean(peer?.HostName)
    || "Hivenet app host";
}

async function discoverUniversalTtsFallbackApps(): Promise<UniversalFallbackApp[]> {
  const linkBase = hivemindLinkControlUrl();
  const status = await jsonAt<LinkStatus>(`${linkBase}/status`, RAW_TTS_DISCOVERY_TIMEOUT_MS).catch(() => null);
  const macPeers = Object.values(status?.peer ?? {}).filter((peer) => peer?.Online && clean(peer.OS).toLowerCase() === "macos");
  const hivemindMacPeers = macPeers.filter((peer) => {
    const name = `${clean(peer.HostName)} ${clean(peer.DNSName)}`.toLowerCase();
    return name.includes("hivemindos");
  });
  const peers = hivemindMacPeers.length ? hivemindMacPeers : macPeers.slice(0, 1);
  const apps = await Promise.all(peers.map(async (peer): Promise<UniversalFallbackApp | null> => {
    const ip = (peer.TailscaleIPs ?? []).map(ipv4).find(Boolean);
    if (!ip) return null;
    const peerPath = encodeURIComponent(`${ip}:8789`);
    const apiBaseUrl = `${linkBase}/peer/${peerPath}/app-proxy/8799`;
    const capabilities = await jsonAt<unknown>(`${apiBaseUrl}/v1/audio/capabilities`, 1_500).catch(() => null);
    if (!capabilities) return null;
    const app: HostedApp = {
      id: `${clean(peer.DNSName).replace(/\.$/, "") || clean(peer.HostName) || "hivenet"}:8799:universal-tts`,
      name: "universal-tts",
      description: "Universal TTS via Hivemind Link",
      machineName: linkPeerName(peer),
      port: 8799,
      apiBaseUrl,
      serviceKind: "tts",
      apiRoutes: [
        { method: "GET", path: "/v1/audio/capabilities", summary: "Universal TTS capabilities" },
        { method: "GET", path: "/v1/voices", summary: "Universal TTS voices" },
        { method: "POST", path: "/v1/audio/speech-stream", summary: "Universal TTS streaming speech" },
      ],
    };
    return { app, capabilities };
  }));
  return apps.filter((entry): entry is UniversalFallbackApp => Boolean(entry));
}

async function candidateFromUniversalTtsFallback(entry: UniversalFallbackApp): Promise<LocalTtsCandidate | null> {
  const { app, capabilities } = entry;
  if (!app.id || !app.apiBaseUrl) return null;
  const selectedCaps = selectedCapabilities(capabilities);
  const models = selectedCaps.models;
  const voicesEndpoint = clean(selectedCaps.voices_endpoint) || "/v1/voices";
  const voicesPayload = await jsonAt<unknown>(`${app.apiBaseUrl}${voicesEndpoint}`, 1_500)
    .catch(() => jsonAt<unknown>(`${app.apiBaseUrl}/v1/voices`, 1_500).catch(() => null));
  const voices = voiceIds(voicesPayload);
  const streamingKind = clean(selectedCaps.streaming_kind);
  const sampleFormat = clean(selectedCaps.sample_format) || (streamingKind === "pcm16" ? "pcm16" : "pcm16");
  const supportsStreamingApi = selectedCaps.supports_streaming_api !== false;
  const ok = supportsStreamingApi && selectedCaps.supports_true_streaming === true && (streamingKind === "pcm16" || sampleFormat === "pcm16");
  return {
    id: providerId(app.id),
    appId: app.id,
    name: clean(app.name) || "universal-tts",
    machineName: clean(app.machineName) || undefined,
    port: Number.isFinite(Number(app.port)) ? Number(app.port) : undefined,
    score: candidateScore(app) + (ok ? 100 : 0),
    ok,
    error: ok ? undefined : "Universal TTS did not advertise true PCM streaming.",
    model: preferredModel(models),
    voice: preferredVoice(voices),
    models,
    voiceCount: voices.length,
    supportsStreamingApi,
    supportsTrueStreaming: selectedCaps.supports_true_streaming === true,
    streamingKind,
    streamingImplementation: clean(selectedCaps.streaming_implementation) || undefined,
    sampleRate: numberValue(selectedCaps.sample_rate, DEFAULT_SAMPLE_RATE),
    channels: Math.max(1, Math.trunc(numberValue(selectedCaps.channels, 1))),
    sampleFormat,
    routeHints: routePaths(app),
  };
}

function preferredModel(models: string[]) {
  return PREFERRED_LOCAL_TTS_MODELS.find((model) => models.includes(model))
    || models[0]
    || DEFAULT_LOCAL_TTS_MODEL;
}

function preferredVoice(voices: string[]) {
  return PREFERRED_LOCAL_TTS_VOICES.find((voice) => voices.includes(voice))
    || voices[0]
    || DEFAULT_LOCAL_TTS_VOICE;
}

function selectedCapabilities(payload: unknown): SelectedCapabilities {
  if (!payload || typeof payload !== "object") return { models: [] };
  const root = payload as CapabilitiesPayload & { providers?: unknown };
  const providers = root.providers && typeof root.providers === "object"
    ? Object.entries(root.providers as Record<string, unknown>).flatMap(([providerId, value]) => {
      if (!value || typeof value !== "object") return [];
      const caps = value as CapabilitiesPayload;
      const models = cleanList(caps.models);
      const preferredRank = PREFERRED_LOCAL_TTS_MODELS.findIndex((model) => models.includes(model));
      const streamingKind = clean(caps.streaming_kind);
      const sampleFormat = clean(caps.sample_format);
      const streamingOk = caps.supports_streaming_api !== false
        && caps.supports_true_streaming === true
        && (streamingKind === "pcm16" || sampleFormat === "pcm16");
      return [{
        ...caps,
        providerId,
        models,
        score: (caps.loaded === false ? -200 : 0)
          + (streamingOk ? 100 : 0)
          + (preferredRank >= 0 ? 80 - preferredRank : 0),
      }];
    })
    : [];
  const selected = providers.sort((left, right) => right.score - left.score)[0];
  if (selected) return selected;
  return { ...root, models: cleanList(root.models) };
}

function routePaths(app: HostedApp) {
  return (app.apiRoutes ?? []).map((route) => clean(route.path)).filter(Boolean);
}

function candidateScore(app: HostedApp) {
  const haystack = [
    app.name,
    app.description,
    app.serviceKind,
    app.machineName,
    String(app.port ?? ""),
    ...routePaths(app),
    ...(app.apiRoutes ?? []).map((route) => route.summary),
  ].join(" ").toLowerCase();
  let score = 0;
  if (/\btts\b|text.?to.?speech|speech|voice|audio|universal/.test(haystack)) score += 30;
  if (app.serviceKind && /tts|voice|speech|audio/.test(app.serviceKind)) score += 40;
  if (routePaths(app).some((path) => path === "/v1/audio/speech-stream")) score += 55;
  if (routePaths(app).some((path) => path === "/v1/audio/capabilities")) score += 45;
  if (routePaths(app).some((path) => path === "/v1/voices" || path === "/voices")) score += 20;
  if (Number(app.port) === 8799) score += 35;
  return score;
}

function hasLocalTtsCapabilitySurface(app: HostedApp) {
  const paths = routePaths(app);
  const name = clean(app.name).toLowerCase();
  return Number(app.port) === 8799
    || name.includes("universal")
    || paths.some((path) => path === "/v1/audio/capabilities" || path === "/capabilities");
}

async function discoveredApps(origin: string, options?: { force?: boolean; selectedAppId?: string }): Promise<HostedApp[]> {
  if (!options?.force && options?.selectedAppId) {
    const app = cachedApp(origin, options.selectedAppId);
    if (app) return [app];

    const raw = await discoverRawConnectedApps(origin, { timeoutMs: RAW_TTS_DISCOVERY_TIMEOUT_MS }).catch(() => []);
    const rawApp = raw.find((item) => matchesAppId(item, options.selectedAppId!));
    if (rawApp) {
      rememberApps(origin, raw);
      return [rawApp];
    }
  }
  if (!options?.force) {
    const cached = fresh(appsByOrigin.get(origin));
    if (cached) return cached.apps;
  }
  const raw = await discoverRawConnectedApps(origin, { timeoutMs: RAW_TTS_DISCOVERY_TIMEOUT_MS }).catch(() => []);
  if (raw.some((app) => hasLocalTtsCapabilitySurface(app))) {
    rememberApps(origin, raw);
    return raw;
  }
  const normalizedPromise = fetch(new URL("/api/fleet/apps?refresh=1&fast=1", origin), {
    cache: "no-store",
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Connected app discovery returned HTTP ${response.status}.`);
      const payload = await response.json().catch(() => null) as { apps?: HostedApp[] } | null;
      return Array.isArray(payload?.apps) ? payload.apps : [];
    })
    .catch(() => []);
  const normalized = await normalizedPromise;
  const byId = new Map<string, HostedApp>();
  for (const app of [...normalized, ...raw]) {
    if (app.id && app.apiBaseUrl && !byId.has(app.id)) byId.set(app.id, app);
  }
  const apps = [...byId.values()];
  rememberApps(origin, apps);
  return apps;
}

async function appJson(app: HostedApp, path: string) {
  const baseUrl = app.apiBaseUrl?.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("Connected app does not expose an API base URL.");
  const requestPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${baseUrl}${requestPath}`, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json")) throw new Error(`${path} did not return JSON`);
  return response.json() as Promise<unknown>;
}

async function validateCandidate(app: HostedApp): Promise<LocalTtsCandidate> {
  const routeHints = routePaths(app);
  try {
    const [capabilities, modelsPayload] = await Promise.all([
      appJson(app, "/v1/audio/capabilities"),
      appJson(app, "/v1/models").catch(() => null),
    ]);
    const selectedCaps = selectedCapabilities(capabilities);
    const models = selectedCaps.models.length ? selectedCaps.models : modelIds(modelsPayload);
    const voicesEndpoint = clean(selectedCaps.voices_endpoint);
    const voicesPayload = voicesEndpoint
      ? await appJson(app, voicesEndpoint).catch(() => appJson(app, "/v1/voices").catch(() => appJson(app, "/voices").catch(() => null)))
      : await appJson(app, "/v1/voices").catch(() => appJson(app, "/voices").catch(() => null));
    const voices = voiceIds(voicesPayload);
    const model = preferredModel(models);
    const voice = preferredVoice(voices);
    const supportsStreamingApi = selectedCaps.supports_streaming_api !== false;
    const streamingKind = clean(selectedCaps.streaming_kind);
    const sampleFormat = clean(selectedCaps.sample_format) || (streamingKind === "pcm16" ? "pcm16" : "pcm16");
    const ok = supportsStreamingApi && (streamingKind === "pcm16" || sampleFormat === "pcm16" || selectedCaps.models.length > 0 || models.length > 0);
    return {
      id: providerId(app.id!),
      appId: app.id!,
      name: clean(app.name) || "Local TTS",
      machineName: clean(app.machineName) || undefined,
      port: Number.isFinite(Number(app.port)) ? Number(app.port) : undefined,
      score: candidateScore(app) + (ok ? 100 : 0),
      ok,
      error: ok ? undefined : "Streaming PCM capability was not proven.",
      model,
      voice,
      models,
      voiceCount: voices.length,
      supportsStreamingApi,
      supportsTrueStreaming: selectedCaps.supports_true_streaming === true,
      streamingKind,
      streamingImplementation: clean(selectedCaps.streaming_implementation) || undefined,
      sampleRate: numberValue(selectedCaps.sample_rate, DEFAULT_SAMPLE_RATE),
      channels: Math.max(1, Math.trunc(numberValue(selectedCaps.channels, 1))),
      sampleFormat,
      routeHints,
    };
  } catch (error) {
    return {
      id: providerId(app.id!),
      appId: app.id!,
      name: clean(app.name) || "Local TTS",
      machineName: clean(app.machineName) || undefined,
      port: Number.isFinite(Number(app.port)) ? Number(app.port) : undefined,
      score: candidateScore(app),
      ok: false,
      error: error instanceof Error ? error.message : "TTS validation failed.",
      model: DEFAULT_LOCAL_TTS_MODEL,
      voice: DEFAULT_LOCAL_TTS_VOICE,
      models: [],
      supportsStreamingApi: false,
      supportsTrueStreaming: false,
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: 1,
      sampleFormat: "pcm16",
      routeHints,
    };
  }
}

export async function discoverLocalTtsCandidates(origin: string): Promise<LocalTtsCandidate[]> {
  const cached = cachedCandidates(origin);
  if (cached) return cached;
  const universalApps = await discoverUniversalTtsFallbackApps();
  if (universalApps.length) rememberApps(origin, universalApps.map((entry) => entry.app));
  const universalFallback = await Promise.all(universalApps.map((app) => candidateFromUniversalTtsFallback(app)));
  const universalCandidates = universalFallback
    .filter((candidate): candidate is LocalTtsCandidate => Boolean(candidate))
    .filter((candidate) => candidate.ok || candidate.score > 0)
    .sort((left, right) => Number(right.ok) - Number(left.ok) || right.score - left.score);
  if (universalCandidates.some((candidate) => candidate.ok)) {
    rememberCandidates(origin, universalCandidates);
    return universalCandidates;
  }
  const apps = await discoveredApps(origin).catch(() => []);
  const scored = apps
    .map((app) => ({ app, score: candidateScore(app) }))
    .filter((item) => hasLocalTtsCapabilitySurface(item.app))
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  const validated = await Promise.all(scored.map(({ app }) => validateCandidate(app)));
  let candidates = validated
    .filter((candidate) => candidate.ok || candidate.score > 0)
    .sort((left, right) => Number(right.ok) - Number(left.ok) || right.score - left.score);
  if (!candidates.some((candidate) => candidate.ok)) {
    const fallbackValidated = await Promise.all((await discoverUniversalTtsFallbackApps()).map(({ app }) => validateCandidate(app)));
    candidates = fallbackValidated
      .filter((candidate) => candidate.ok || candidate.score > 0)
      .sort((left, right) => Number(right.ok) - Number(left.ok) || right.score - left.score);
  }
  rememberCandidates(origin, candidates);
  return candidates;
}

export async function resolveLocalTtsCallConfig(input: {
  origin: string;
  voiceProviderId?: string;
  voiceModelId?: string;
  voiceId?: string;
  openingLine: string;
}): Promise<LocalTtsCallConfig | null> {
  const selectedAppId = appIdFromLocalTtsProviderId(input.voiceProviderId);
  if (selectedAppId && input.voiceModelId?.trim() && input.voiceId?.trim()) {
    const candidate = cachedCandidates(input.origin)?.find((item) => item.appId === selectedAppId && item.ok);
    return {
      provider: LOCAL_TTS_RUNTIME,
      appId: selectedAppId,
      appName: candidate?.name || "Local TTS",
      machineName: candidate?.machineName,
      model: input.voiceModelId.trim(),
      voice: input.voiceId.trim(),
      sampleRate: candidate?.sampleRate || DEFAULT_SAMPLE_RATE,
      channels: candidate?.channels || 1,
      sampleFormat: candidate?.sampleFormat || "pcm16",
      streamingKind: candidate?.streamingKind,
      streamingImplementation: candidate?.streamingImplementation,
      openingLine: input.openingLine,
    };
  }
  const cached = cachedCandidates(input.origin);
  const candidates = cached ?? await discoverLocalTtsCandidates(input.origin);
  const candidate = (selectedAppId ? candidates.find((item) => item.appId === selectedAppId) : null)
    ?? candidates.find((item) => item.ok)
    ?? null;
  if (!candidate?.ok) return null;
  const model = input.voiceModelId?.trim() || candidate.model || DEFAULT_LOCAL_TTS_MODEL;
  const voice = input.voiceId?.trim() || candidate.voice || DEFAULT_LOCAL_TTS_VOICE;
  return {
    provider: LOCAL_TTS_RUNTIME,
    appId: candidate.appId,
    appName: candidate.name,
    machineName: candidate.machineName,
    model,
    voice,
    sampleRate: candidate.sampleRate,
    channels: candidate.channels,
    sampleFormat: candidate.sampleFormat,
    streamingKind: candidate.streamingKind,
    streamingImplementation: candidate.streamingImplementation,
    openingLine: input.openingLine,
  };
}

export async function streamLocalTtsSpeech(input: {
  origin: string;
  appId: string;
  model: string;
  voice: string;
  text: string;
  utteranceId?: string;
  signal?: AbortSignal;
}) {
  const app = cachedApp(input.origin, input.appId)
    ?? (await discoveredApps(input.origin, { selectedAppId: input.appId })).find((item) => matchesAppId(item, input.appId) && item.apiBaseUrl);
  if (!app?.apiBaseUrl) {
    return Response.json({ ok: false, error: "No matching connected TTS app with an API base URL was found." }, { status: 404 });
  }
  const body = {
    model: input.model || DEFAULT_LOCAL_TTS_MODEL,
    voice: input.voice || DEFAULT_LOCAL_TTS_VOICE,
    input: input.text,
    response_format: "pcm",
    sample_rate: DEFAULT_SAMPLE_RATE,
    stream_frame_ms: 40,
    realtime_pacing: true,
    smooth_join_ms: 8,
    lowpass_hz: 7000,
    language: "English",
    instruct: "Speak warmly and clearly.",
    utterance_id: input.utteranceId,
  };
  const response = await fetch(`${app.apiBaseUrl.replace(/\/+$/, "")}/v1/audio/speech-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: input.signal ?? AbortSignal.timeout(STREAM_TIMEOUT_MS),
  });
  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  for (const key of [
    "x-audio-sample-rate",
    "x-audio-channels",
    "x-audio-sample-format",
    "x-universal-tts-streaming-implementation",
  ]) {
    const value = response.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
