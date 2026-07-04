import { shellBaseFromCollectorUrl, shellSessionUrl } from "@/app/api/fleet/shell/shell-target";
import { discoverRawConnectedApps, type ConnectedHostedApp } from "@/lib/services/fleet/connected-apps";
import { hivemindLinkControlUrl } from "@/lib/services/hivemind-link-control";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import {
  APP_CACHE_MS,
  cachedApp,
  evictCachedApp,
  hydratePersistedApps,
  rememberAppById,
  touchCachedApp,
} from "@/lib/services/phone/local-tts-app-cache";
import {
  isCallerAbortError,
  recordLocalTtsFailure,
  recordLocalTtsSuccess,
} from "@/lib/services/phone/local-tts-health";

export const LOCAL_TTS_RUNTIME = "local-tts";
export const LOCAL_TTS_PROVIDER_PREFIX = "local-tts:";
const DEFAULT_LOCAL_TTS_MODEL = "chatterbox-turbo";
const DEFAULT_LOCAL_TTS_VOICE = "voice01";
const DEFAULT_SAMPLE_RATE = 24_000;
const DISCOVERY_TIMEOUT_MS = 12_000;
const RAW_TTS_DISCOVERY_TIMEOUT_MS = 2_500;
const DIRECT_HOST_DISCOVERY_TIMEOUT_MS = 4_000;
const PROBE_TIMEOUT_MS = 8_000;
const STREAM_TIMEOUT_MS = 120_000;
const LAUNCH_DISCOVERY_TIMEOUT_MS = 10_000;
const LAUNCH_PROBE_TIMEOUT_MS = 8_000;
const LAUNCH_MODEL_PROBE_TIMEOUT_MS = 4_000;
const LAUNCH_SHELL_TIMEOUT_MS = 15_000;
const LAUNCH_SHELL_SESSION = "local-tts-launcher";
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
  availableModels: string[];
  availableModelDetails: LocalTtsModelStatus[];
  /** Every voice the server advertises (/v1/voices), for the Calls voice picker. */
  availableVoices: string[];
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

export type LocalTtsModelStatus = {
  id: string;
  providerId: string;
  loadable: boolean;
  loaded: boolean;
  healthy: boolean;
  callReady: boolean;
  supportsTrueStreaming: boolean;
  streamingKind?: string;
  streamingImplementation?: string;
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

export type LocalTtsMachineSystem = {
  checkedAt?: number;
  cpuPct?: number;
  cpuCores?: number;
  cpuModel?: string;
  loadAvg1m?: number;
  ramPct?: number;
  ramUsedGb?: number;
  ramTotalGb?: number;
  diskPct?: number | null;
  diskUsedGb?: number | null;
  diskTotalGb?: number | null;
  platform?: string;
  arch?: string;
  osRelease?: string;
  uptimeSec?: number;
};

export type LocalTtsCapacity = "ready" | "tight" | "limited" | "unknown";
export type LocalTtsLaunchModelHintsSource = "service" | "running-candidate" | "fallback";

export type LocalTtsLaunchCandidate = {
  id: string;
  machineName: string;
  collectorUrl: string;
  collectorStatus: string;
  online: boolean;
  serviceLabels: string[];
  system?: LocalTtsMachineSystem;
  availableRamGb?: number;
  capacity: LocalTtsCapacity;
  capacityLabel: string;
  capacityDetail: string;
  canStart: boolean;
  modelHints: string[];
  modelHintsSource: LocalTtsLaunchModelHintsSource;
  preferredModel: string;
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

type FleetLaunchMachine = {
  device?: Record<string, unknown>;
  collector?: unknown;
  collectorHost?: unknown;
  system?: unknown;
};

const appsByOrigin = new Map<string, AppCacheEntry>();
const candidatesByOrigin = new Map<string, CandidateCacheEntry>();

function fresh<T extends { expiresAt: number }>(entry: T | undefined) {
  return entry && entry.expiresAt > Date.now() ? entry : null;
}

function rememberApps(origin: string, apps: HostedApp[]) {
  const expiresAt = Date.now() + APP_CACHE_MS;
  appsByOrigin.set(origin, { expiresAt, apps });
  for (const app of apps) rememberAppById(origin, app, expiresAt);
}

function rememberCandidates(origin: string, candidates: LocalTtsCandidate[]) {
  candidatesByOrigin.set(origin, { expiresAt: Date.now() + CANDIDATE_CACHE_MS, candidates });
}

// The one resolution path every synth/stream shares: persisted cache, then
// in-memory cache, then (targeted) discovery. Cache lifecycle (sliding TTL,
// failure eviction, cross-restart persistence) lives in local-tts-app-cache.
async function resolvedTtsApp(origin: string, appId: string) {
  await hydratePersistedApps(origin).catch(() => undefined);
  return cachedApp(origin, appId)
    ?? findMatchingApp(await discoveredApps(origin, { selectedAppId: appId }), appId)
    ?? null;
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

// A machine hostname rename (macOS conflict-renames, tsnet re-registration)
// rotates every hosted-app id on that machine, so a host-pinned selection can
// never re-match strictly. When no app matches the pinned host, fall back to
// the single TTS-capable app on the same port; with zero or several
// candidates the pin stays unresolved rather than guessing across machines.
function findMatchingApp(apps: HostedApp[], selectedAppId: string) {
  const strict = apps.find((app) => matchesAppId(app, selectedAppId) && app.apiBaseUrl);
  if (strict) return strict;
  const selected = appIdHint(selectedAppId);
  if (!selected) return undefined;
  const samePort = apps.filter((app) =>
    app.apiBaseUrl && appIdHint(app.id)?.port === selected.port && hasLocalTtsCapabilitySurface(app));
  return samePort.length === 1 ? samePort[0] : undefined;
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

function uniqueClean(values: unknown[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = clean(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
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

function boolValue(value: unknown) {
  return value === true;
}

function providerEntries(payload: unknown): Array<[string, Record<string, unknown>]> {
  const root = recordValue(payload);
  const providers = recordValue(root?.providers);
  if (!providers) return [];
  return Object.entries(providers).flatMap(([providerId, value]) => {
    const provider = recordValue(value);
    return provider ? [[providerId, provider]] : [];
  });
}

function localTtsModelStatuses(payload: unknown): LocalTtsModelStatus[] {
  return providerEntries(payload).flatMap(([providerId, provider]) => {
    const details = recordValue(provider.details);
    const body = recordValue(details?.body);
    const models = cleanList(provider.models);
    const loaded = (boolValue(provider.loaded) || boolValue(body?.loaded)) && body?.loaded !== false;
    const healthy = boolValue(provider.healthy) || boolValue(body?.healthy) || boolValue(body?.ok);
    const supportsTrueStreaming = boolValue(provider.supports_true_streaming) || boolValue(body?.supports_true_streaming);
    const supportsStreamingApi = provider.supports_streaming_api !== false && body?.supports_streaming_api !== false;
    const streamingKind = clean(body?.streaming_kind) || clean(provider.streaming_kind);
    const sampleFormat = clean(body?.sample_format) || clean(provider.sample_format);
    const streamingImplementation = clean(body?.streaming_implementation) || clean(provider.streaming_implementation);
    const placeholderHaystack = [
      provider.kind,
      body?.kind,
      body?.status,
      body?.streaming_mode,
      body?.implementation,
      body?.notes,
    ].map(clean).join(" ").toLowerCase();
    const placeholder = /catalog_stub|not-enabled|not-realtime|not-tts|voice_conversion|\basr\b|postprocess/.test(placeholderHaystack);
    const loadable = models.length > 0 && !placeholder;
    const callReady = loaded
      && healthy
      && supportsStreamingApi
      && supportsTrueStreaming
      && (streamingKind === "pcm16" || sampleFormat === "pcm16")
      && !placeholder;
    return models.map((id) => ({
      id,
      providerId: clean(provider.id) || providerId,
      loadable,
      loaded,
      healthy,
      callReady,
      supportsTrueStreaming,
      streamingKind: streamingKind || undefined,
      streamingImplementation: streamingImplementation || undefined,
    }));
  });
}

function loadableModels(statuses: LocalTtsModelStatus[]) {
  return uniqueClean(statuses.filter((status) => status.loadable).map((status) => status.id));
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalNullableNumber(value: unknown) {
  if (value === null) return null;
  return optionalNumber(value);
}

function optionalString(value: unknown) {
  const text = clean(value);
  return text || undefined;
}

function systemStats(value: unknown): LocalTtsMachineSystem | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const stats: LocalTtsMachineSystem = {
    checkedAt: optionalNumber(source.checkedAt),
    cpuPct: optionalNumber(source.cpuPct),
    cpuCores: optionalNumber(source.cpuCores),
    cpuModel: optionalString(source.cpuModel),
    loadAvg1m: optionalNumber(source.loadAvg1m),
    ramPct: optionalNumber(source.ramPct),
    ramUsedGb: optionalNumber(source.ramUsedGb),
    ramTotalGb: optionalNumber(source.ramTotalGb),
    diskPct: optionalNullableNumber(source.diskPct),
    diskUsedGb: optionalNullableNumber(source.diskUsedGb),
    diskTotalGb: optionalNullableNumber(source.diskTotalGb),
    platform: optionalString(source.platform),
    arch: optionalString(source.arch),
    osRelease: optionalString(source.osRelease),
    uptimeSec: optionalNumber(source.uptimeSec),
  };
  return Object.values(stats).some((entry) => entry !== undefined) ? stats : undefined;
}

function availableRamGb(system?: LocalTtsMachineSystem) {
  if (!system || typeof system.ramTotalGb !== "number" || typeof system.ramUsedGb !== "number") return undefined;
  return Math.max(0, system.ramTotalGb - system.ramUsedGb);
}

function capacityForSystem(system?: LocalTtsMachineSystem): {
  capacity: LocalTtsCapacity;
  capacityLabel: string;
  capacityDetail: string;
  availableRamGb?: number;
} {
  const freeRamGb = availableRamGb(system);
  const totalRamGb = system?.ramTotalGb;
  const diskPct = typeof system?.diskPct === "number" ? system.diskPct : undefined;
  if (typeof freeRamGb !== "number" || typeof totalRamGb !== "number") {
    return {
      capacity: "unknown",
      capacityLabel: "Resource telemetry unavailable",
      capacityDetail: "Hivemind Link can try to start the service, but RAM and disk fit are not confirmed yet.",
    };
  }
  if ((typeof diskPct === "number" && diskPct >= 96) || totalRamGb < 4 || freeRamGb < 1.25) {
    return {
      capacity: "limited",
      capacityLabel: "Likely too constrained",
      capacityDetail: "Local TTS may not load reliably with the current free memory or disk headroom.",
      availableRamGb: freeRamGb,
    };
  }
  if (totalRamGb >= 8 && freeRamGb >= 2 && (typeof diskPct !== "number" || diskPct < 92)) {
    return {
      capacity: "ready",
      capacityLabel: "Can load Local TTS",
      capacityDetail: "Current RAM and disk telemetry look healthy for starting Universal TTS.",
      availableRamGb: freeRamGb,
    };
  }
  return {
    capacity: "tight",
    capacityLabel: "Can try Local TTS",
    capacityDetail: "The machine has enough headroom to try, but loading may be slower or more fragile.",
    availableRamGb: freeRamGb,
  };
}

function launchMachineName(machine: FleetLaunchMachine) {
  const device = recordValue(machine.device);
  return clean(device?.name)
    || clean(device?.dnsName).replace(/\.$/, "").split(".")[0]
    || clean(machine.collectorHost)
    || clean(device?.ip)
    || "Hivemind machine";
}

function normalizedMachineName(value?: string) {
  return clean(value).toLowerCase().replace(/\.$/, "");
}

function collectorHostName(collectorUrl?: string) {
  try {
    return normalizedMachineName(new URL(clean(collectorUrl)).hostname.split(".")[0]);
  } catch {
    return "";
  }
}

function runningCandidateMatchesMachine(candidate: LocalTtsCandidate, machineName: string, collectorUrl: string) {
  const machineKey = normalizedMachineName(machineName);
  const candidateMachine = normalizedMachineName(candidate.machineName);
  const collectorHost = collectorHostName(collectorUrl);
  const appKey = normalizedMachineName(candidate.appId);
  return Boolean(
    (machineKey && candidateMachine && (candidateMachine === machineKey || candidateMachine.includes(machineKey) || machineKey.includes(candidateMachine)))
    || (machineKey && appKey.includes(machineKey))
    || (collectorHost && appKey.includes(collectorHost)),
  );
}

function runningCandidateModels(candidate: LocalTtsCandidate) {
  return uniqueClean([...(candidate.availableModels ?? []), ...(candidate.models ?? [])]);
}

function runningModelsForMachine(machineName: string, collectorUrl: string, runningCandidates: LocalTtsCandidate[]) {
  return uniqueClean(runningCandidates
    .filter((candidate) => runningCandidateMatchesMachine(candidate, machineName, collectorUrl))
    .flatMap((candidate) => runningCandidateModels(candidate)));
}

async function fleetLaunchMachines(origin: string): Promise<FleetLaunchMachine[]> {
  const response = await fetch(new URL("/api/fleet/discover?includeSnapshots=0&fresh=1", origin), {
    cache: "no-store",
    headers: internalApiAuthHeaders(),
    signal: AbortSignal.timeout(LAUNCH_DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Fleet discovery returned HTTP ${response.status}.`);
  const payload = recordValue(await response.json().catch(() => null));
  const machines = payload?.machines;
  return Array.isArray(machines)
    ? machines.flatMap((machine) => {
      const item = recordValue(machine);
      return item ? [item as FleetLaunchMachine] : [];
    })
    : [];
}

function ttsLaunchCommand() {
  const pattern = "universal.?tts";
  return [
    "U=$(id -u 2>/dev/null || echo); kicked=0",
    `if command -v launchctl >/dev/null 2>&1; then for L in $(launchctl list 2>/dev/null | awk 'NR>1 && tolower($3) ~ /${pattern}/ {print $3}'); do launchctl kickstart -k "gui/$U/$L" 2>/dev/null && kicked=$((kicked+1)); done; fi`,
    `if command -v systemctl >/dev/null 2>&1; then for S in $(systemctl --user list-units --type=service --no-legend 2>/dev/null | grep -iE '${pattern}' | awk '{print $1}'); do systemctl --user restart "$S" 2>/dev/null && kicked=$((kicked+1)); done; for S in $(systemctl list-units --type=service --no-legend 2>/dev/null | grep -iE '${pattern}' | awk '{print $1}'); do sudo -n systemctl restart "$S" 2>/dev/null && kicked=$((kicked+1)); done; fi`,
    "echo \"hivemindos started $kicked TTS service(s)\"",
  ].join("; ");
}

function ttsServiceProbeCommand() {
  const pattern = "universal.?tts";
  return [
    `if command -v launchctl >/dev/null 2>&1; then launchctl list 2>/dev/null | awk 'NR>1 && tolower($3) ~ /${pattern}/ {print "HMOS_TTS_SERVICE:" $3}' | head -20; fi`,
    `if command -v systemctl >/dev/null 2>&1; then { systemctl --user list-unit-files --type=service --no-legend 2>/dev/null; systemctl --user list-units --type=service --all --no-legend 2>/dev/null; systemctl list-unit-files --type=service --no-legend 2>/dev/null; systemctl list-units --type=service --all --no-legend 2>/dev/null; } | awk 'tolower($1) ~ /${pattern}/ {print "HMOS_TTS_SERVICE:" $1}' | sort -u | head -20; fi`,
    "echo HMOS_TTS_PROBE_DONE",
  ].join("; ");
}

function launchProbeSessionId(machineName: string) {
  const slug = normalizedMachineName(machineName).replace(/[^a-z0-9._-]/g, "-").slice(0, 42) || "machine";
  return `local-tts-probe-${slug}-${Date.now().toString(36)}`.slice(0, 120);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shellJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(LAUNCH_PROBE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Hivemind Link shell returned HTTP ${response.status}.`);
  return recordValue(await response.json().catch(() => null)) ?? {};
}

function shellOutputLines(payload: Record<string, unknown>) {
  const lines = payload.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter((line): line is string => typeof line === "string" && !line.startsWith("$ "));
}

function universalTtsServiceLabels(payload: Record<string, unknown>) {
  return shellOutputLines(payload).flatMap((line) => {
    const match = /^HMOS_TTS_SERVICE:(.+)$/.exec(line.trim());
    return match?.[1]?.trim() ? [match[1].trim()] : [];
  });
}

async function probeUniversalTtsService(collectorUrl: string, machineName: string): Promise<string[]> {
  const base = shellBaseFromCollectorUrl(collectorUrl);
  if (!base) return [];
  const session = launchProbeSessionId(machineName);
  await shellJson(shellSessionUrl(base, session, "command"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: ttsServiceProbeCommand() }),
  }).catch(() => ({}));
  const deadline = Date.now() + LAUNCH_PROBE_TIMEOUT_MS;
  let labels: string[] = [];
  while (Date.now() < deadline) {
    await delay(350);
    const payload = await shellJson(shellSessionUrl(base, session)).catch(() => ({}));
    labels = universalTtsServiceLabels(payload);
    if (labels.length || shellOutputLines(payload).some((line) => line.trim() === "HMOS_TTS_PROBE_DONE")) break;
  }
  return [...new Set(labels)];
}

function universalTtsApiBaseFromCollectorUrl(collectorUrl: string) {
  const base = shellBaseFromCollectorUrl(collectorUrl);
  if (!base) return "";
  const linkBase = base.replace(/\/app-proxy\/\d+(?:\/.*)?$/, "").replace(/\/+$/, "");
  return `${linkBase}/app-proxy/8799`;
}

async function probeUniversalTtsModels(collectorUrl: string) {
  const base = universalTtsApiBaseFromCollectorUrl(collectorUrl);
  if (!base) return [];
  const providers = await jsonAt<unknown>(`${base}/providers`, LAUNCH_MODEL_PROBE_TIMEOUT_MS)
    .catch(() => jsonAt<unknown>(`${base}/runtimes`, LAUNCH_MODEL_PROBE_TIMEOUT_MS).catch(() => null));
  return loadableModels(localTtsModelStatuses(providers));
}

async function launchModelHintsForCandidate(
  candidate: Pick<LocalTtsLaunchCandidate, "collectorUrl" | "machineName">,
  runningCandidates: LocalTtsCandidate[],
): Promise<{ modelHints: string[]; modelHintsSource: LocalTtsLaunchModelHintsSource }> {
  const serviceModels = await probeUniversalTtsModels(candidate.collectorUrl);
  if (serviceModels.length) return { modelHints: serviceModels, modelHintsSource: "service" };

  const runningModels = runningModelsForMachine(candidate.machineName, candidate.collectorUrl, runningCandidates);
  if (runningModels.length) return { modelHints: runningModels, modelHintsSource: "running-candidate" };

  return { modelHints: [...PREFERRED_LOCAL_TTS_MODELS], modelHintsSource: "fallback" };
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
  const providersPayload = await jsonAt<unknown>(`${app.apiBaseUrl}/providers`, 1_500)
    .catch(() => jsonAt<unknown>(`${app.apiBaseUrl}/runtimes`, 1_500).catch(() => null));
  const modelDetails = localTtsModelStatuses(providersPayload);
  const loadable = loadableModels(modelDetails);
  const models = loadable.length ? loadable : selectedCaps.models;
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
    availableModels: loadable,
    availableModelDetails: modelDetails.filter((status) => status.loadable),
    availableVoices: voices,
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

    // Fast path: the selected app id encodes its machine host — ask that
    // machine's collector directly (~1s) before paying a fleet-wide sweep
    // (measured ~10s), which used to land on the first spoken reply.
    const hint = appIdHint(options.selectedAppId);
    if (hint?.host && hint.host !== "local" && hint.host !== "localhost") {
      const direct = await discoverRawConnectedApps(origin, {
        timeoutMs: DIRECT_HOST_DISCOVERY_TIMEOUT_MS,
        directHost: hint.host,
        cachedAppsOnly: true,
      }).catch(() => []);
      const directApp = direct.find((item) => matchesAppId(item, options.selectedAppId!));
      if (directApp?.apiBaseUrl) {
        touchCachedApp(origin, options.selectedAppId, directApp);
        return [directApp];
      }
    }

    const raw = await discoverRawConnectedApps(origin, { timeoutMs: RAW_TTS_DISCOVERY_TIMEOUT_MS }).catch(() => []);
    const rawApp = findMatchingApp(raw, options.selectedAppId);
    if (rawApp) {
      rememberApps(origin, raw);
      // Re-pin under the selected id so the next resolve is a cache hit even
      // when the app's id rotated with its machine hostname.
      touchCachedApp(origin, options.selectedAppId, rawApp);
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
    headers: internalApiAuthHeaders(),
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
    const [capabilities, modelsPayload, providersPayload] = await Promise.all([
      appJson(app, "/v1/audio/capabilities"),
      appJson(app, "/v1/models").catch(() => null),
      appJson(app, "/providers").catch(() => appJson(app, "/runtimes").catch(() => null)),
    ]);
    const selectedCaps = selectedCapabilities(capabilities);
    const modelDetails = localTtsModelStatuses(providersPayload);
    const loadable = loadableModels(modelDetails);
    const models = loadable.length ? loadable : selectedCaps.models.length ? selectedCaps.models : modelIds(modelsPayload);
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
      availableModels: loadable,
      availableModelDetails: modelDetails.filter((status) => status.loadable),
      availableVoices: voices,
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
      availableModels: [],
      availableModelDetails: [],
      availableVoices: [],
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

export async function readLocalTtsLaunchCandidates(
  origin: string,
  runningCandidates: LocalTtsCandidate[] = [],
): Promise<LocalTtsLaunchCandidate[]> {
  const runningMachineNames = new Set(
    runningCandidates.map((candidate) => normalizedMachineName(candidate.machineName)).filter(Boolean),
  );
  const machines = await fleetLaunchMachines(origin);
  const unverifiedCandidates = machines.flatMap((machine): Omit<LocalTtsLaunchCandidate, "serviceLabels">[] => {
    const device = recordValue(machine.device);
    const collectorUrl = clean(device?.collectorUrl);
    if (!collectorUrl) return [];
    const machineName = launchMachineName(machine);
    if (runningMachineNames.has(normalizedMachineName(machineName))) return [];
    const collectorStatus = clean(machine.collector) || "unknown";
    const online = device?.online !== false;
    const system = systemStats(machine.system);
    const capacity = capacityForSystem(system);
    const collectorReady = collectorStatus === "ready";
    const canStart = online && collectorReady && capacity.capacity !== "limited";
    return [{
      id: `${normalizedMachineName(machineName) || "machine"}:${collectorUrl}`,
      machineName,
      collectorUrl,
      collectorStatus,
      online,
      system,
      availableRamGb: capacity.availableRamGb,
      capacity: capacity.capacity,
      capacityLabel: !online
        ? "Machine offline"
        : collectorReady
          ? capacity.capacityLabel
          : "Collector not ready",
      capacityDetail: !online
        ? "The machine is not reachable through Tailscale right now."
        : collectorReady
          ? capacity.capacityDetail
          : "Hivemind Link needs the remote collector before it can start Universal TTS there.",
      canStart,
      modelHints: [...PREFERRED_LOCAL_TTS_MODELS],
      modelHintsSource: "fallback",
      preferredModel: DEFAULT_LOCAL_TTS_MODEL,
    }];
  });
  const launchCandidates = (await Promise.all(unverifiedCandidates.map(async (candidate) => {
    if (!candidate.online || candidate.collectorStatus !== "ready") return null;
    const [serviceLabels, modelHints] = await Promise.all([
      probeUniversalTtsService(candidate.collectorUrl, candidate.machineName),
      launchModelHintsForCandidate(candidate, runningCandidates),
    ]);
    return serviceLabels.length
      ? {
        ...candidate,
        serviceLabels,
        modelHints: modelHints.modelHints,
        modelHintsSource: modelHints.modelHintsSource,
        preferredModel: preferredModel(modelHints.modelHints),
      }
      : null;
  }))).filter((candidate): candidate is LocalTtsLaunchCandidate => Boolean(candidate));
  const rank: Record<LocalTtsCapacity, number> = { ready: 4, tight: 3, unknown: 2, limited: 1 };
  return launchCandidates.sort((left, right) =>
    Number(right.canStart) - Number(left.canStart)
    || rank[right.capacity] - rank[left.capacity]
    || left.machineName.localeCompare(right.machineName),
  );
}

export async function startLocalTtsService(input: { collectorUrl: string }): Promise<{
  ok: boolean;
  message: string;
  output?: string;
}> {
  const base = shellBaseFromCollectorUrl(input.collectorUrl);
  if (!base) return { ok: false, message: "No Hivemind Link shell target was found for that machine." };
  let response: Response;
  try {
    response = await fetch(shellSessionUrl(base, LAUNCH_SHELL_SESSION, "command"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: ttsLaunchCommand() }),
      cache: "no-store",
      signal: AbortSignal.timeout(LAUNCH_SHELL_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Hivemind Link shell request failed.",
    };
  }
  const rawText = await response.text().catch(() => "");
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = recordValue(rawText ? JSON.parse(rawText) : null);
  } catch {
    parsed = null;
  }
  const output = clean(parsed?.output) || clean(parsed?.stdout) || clean(parsed?.message) || clean(rawText);
  if (!response.ok || parsed?.ok === false) {
    return {
      ok: false,
      message: output || `Hivemind Link shell returned HTTP ${response.status}.`,
      output: output || undefined,
    };
  }
  return {
    ok: true,
    message: "TTS start requested. Refreshing Local TTS discovery.",
    output: output || undefined,
  };
}

export async function manageLocalTtsModel(input: {
  origin: string;
  appId: string;
  action: "load-model" | "unload-model";
  model?: string;
  providerId?: string;
}): Promise<{
  ok: boolean;
  message: string;
  providerId?: string;
  model?: string;
  detail?: unknown;
}> {
  const app = cachedApp(input.origin, input.appId)
    ?? findMatchingApp(await discoveredApps(input.origin, { selectedAppId: input.appId }), input.appId);
  if (!app?.apiBaseUrl) return { ok: false, message: "No matching connected TTS app with an API base URL was found." };

  const providersPayload = await appJson(app, "/providers").catch(() => appJson(app, "/runtimes").catch(() => null));
  const statuses = localTtsModelStatuses(providersPayload);
  const status = input.providerId
    ? statuses.find((item) => item.providerId === input.providerId)
    : statuses.find((item) => item.id === input.model);
  const provider = input.providerId || status?.providerId || "";
  if (!provider) return { ok: false, message: "No Universal TTS provider was found for that model." };

  const path = input.action === "load-model"
    ? `/providers/${encodeURIComponent(provider)}/load`
    : `/providers/${encodeURIComponent(provider)}/unload`;
  const response = await fetch(`${app.apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: input.action === "load-model" ? { "content-type": "application/json" } : undefined,
    body: input.action === "load-model" ? JSON.stringify({ model: input.model || status?.id || provider }) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(LAUNCH_SHELL_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(error instanceof Error ? error.message : "Universal TTS model action failed.");
  });
  const detail = await response.json().catch(() => null);
  if (!response.ok) {
    const errorText = clean(recordValue(detail)?.error) || clean(recordValue(detail)?.detail) || `Universal TTS returned HTTP ${response.status}.`;
    return { ok: false, message: errorText, providerId: provider, model: input.model, detail };
  }
  candidatesByOrigin.delete(input.origin);
  return {
    ok: true,
    message: input.action === "load-model" ? "Local TTS model load requested." : "Local TTS model unloaded.",
    providerId: provider,
    model: input.model || status?.id,
    detail,
  };
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

// Wrap raw PCM16 (little-endian, signed) in a 44-byte RIFF/WAVE header so a
// Web Audio `decodeAudioData` consumer can play it. The in-app Queen voice
// overlay buffers the whole reply and decodes it (it does not stream frames),
// so it needs a real container — raw PCM would fail to decode and silently
// fall back to browser speech synthesis.
function pcm16ToWav(pcm: Uint8Array, sampleRate: number, channels: number): ArrayBuffer {
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out.buffer;
}

export type LocalTtsWavResult =
  | { ok: true; wav: ArrayBuffer; sampleRate: number; channels: number; bytes: number; appName: string }
  | { ok: false; error: string };

const WAV_SYNTH_TIMEOUT_MS = 60_000;

/**
 * Buffered (non-streaming) local TTS for callers that need a complete,
 * decodable audio clip rather than a paced PCM frame stream — chiefly the
 * in-app Queen Bee voice overlay, whose `decodeAudioData` playback cannot
 * consume raw frames. Generates with `realtime_pacing` OFF so the caller does
 * not wait the full utterance duration, buffers the PCM, and returns WAV.
 */
export async function synthesizeLocalTtsWav(input: {
  origin: string;
  appId: string;
  model: string;
  voice: string;
  text: string;
  signal?: AbortSignal;
  /** Optional per-stage timing sink (latency diagnosis in telemetry). */
  timings?: Record<string, number>;
}): Promise<LocalTtsWavResult> {
  const appResolveStartedAt = Date.now();
  const app = await resolvedTtsApp(input.origin, input.appId);
  if (input.timings) input.timings.appResolveMs = Date.now() - appResolveStartedAt;
  if (!app?.apiBaseUrl) {
    // Undiscoverable app (e.g. Hivemind Link down) fails every consumer the
    // same way; remember it so fallbacks stop re-paying discovery.
    recordLocalTtsFailure(input.appId, "No matching connected TTS app with an API base URL was found.");
    return { ok: false, error: "No matching connected TTS app with an API base URL was found." };
  }
  const body = {
    model: input.model || DEFAULT_LOCAL_TTS_MODEL,
    voice: input.voice || DEFAULT_LOCAL_TTS_VOICE,
    input: input.text,
    response_format: "pcm",
    sample_rate: DEFAULT_SAMPLE_RATE,
    // Buffered consumer: generate as fast as the app allows. Apps that ignore
    // this still work, just with their paced latency added before playback.
    realtime_pacing: false,
    language: "English",
    instruct: "Speak warmly and clearly.",
  };
  let response: Response;
  const upstreamStartedAt = Date.now();
  try {
    response = await fetch(`${app.apiBaseUrl.replace(/\/+$/, "")}/v1/audio/speech-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: input.signal ?? AbortSignal.timeout(WAV_SYNTH_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local TTS request failed.";
    if (!isCallerAbortError(error)) {
      recordLocalTtsFailure(input.appId, message);
      evictCachedApp(input.origin, input.appId, app);
    }
    return { ok: false, error: message };
  } finally {
    if (input.timings) input.timings.upstreamOpenMs = Date.now() - upstreamStartedAt;
  }
  if (!response.ok || !response.body) {
    recordLocalTtsFailure(input.appId, `Local TTS speech returned HTTP ${response.status}.`);
    evictCachedApp(input.origin, input.appId, app);
    return { ok: false, error: `Local TTS speech returned HTTP ${response.status}.` };
  }
  const pcm = new Uint8Array(await response.arrayBuffer());
  if (input.timings) input.timings.upstreamBodyMs = Date.now() - upstreamStartedAt;
  if (!pcm.byteLength) {
    recordLocalTtsFailure(input.appId, "Local TTS returned no audio.");
    return { ok: false, error: "Local TTS returned no audio." };
  }
  recordLocalTtsSuccess(input.appId);
  touchCachedApp(input.origin, input.appId, app);
  const sampleRate = Math.trunc(numberValue(response.headers.get("x-audio-sample-rate"), DEFAULT_SAMPLE_RATE));
  const channels = Math.max(1, Math.trunc(numberValue(response.headers.get("x-audio-channels"), 1)));
  return {
    ok: true,
    wav: pcm16ToWav(pcm, sampleRate, channels),
    sampleRate,
    channels,
    bytes: pcm.byteLength,
    appName: clean(app.name) || "Local TTS",
  };
}

export type LocalTtsPcmStream =
  | { ok: true; body: ReadableStream<Uint8Array>; sampleRate: number; channels: number }
  | { ok: false; error: string };

/**
 * Live PCM stream for the in-app overlay's streaming player: same fast, full-
 * fidelity params as `synthesizeLocalTtsWav` (no `lowpass_hz`, no realtime
 * pacing) but returns the response body unbuffered so the client can play
 * frames as they arrive (~sub-second to first audio) instead of waiting for the
 * whole clip. Distinct from `streamLocalTtsSpeech`, which is tuned for the
 * mobile player (realtime pacing + a 7kHz lowpass).
 */
export async function streamLocalTtsPcm(input: {
  origin: string;
  appId: string;
  model: string;
  voice: string;
  text: string;
  signal?: AbortSignal;
  /** Optional per-stage timing sink (latency diagnosis in telemetry). */
  timings?: Record<string, number>;
}): Promise<LocalTtsPcmStream> {
  const appResolveStartedAt = Date.now();
  const app = await resolvedTtsApp(input.origin, input.appId);
  if (input.timings) input.timings.appResolveMs = Date.now() - appResolveStartedAt;
  if (!app?.apiBaseUrl) {
    recordLocalTtsFailure(input.appId, "No matching connected TTS app with an API base URL was found.");
    return { ok: false, error: "No matching connected TTS app with an API base URL was found." };
  }
  const body = {
    model: input.model || DEFAULT_LOCAL_TTS_MODEL,
    voice: input.voice || DEFAULT_LOCAL_TTS_VOICE,
    input: input.text,
    response_format: "pcm",
    sample_rate: DEFAULT_SAMPLE_RATE,
    realtime_pacing: false,
    language: "English",
    instruct: "Speak warmly and clearly.",
  };
  let response: Response;
  const upstreamStartedAt = Date.now();
  try {
    response = await fetch(`${app.apiBaseUrl.replace(/\/+$/, "")}/v1/audio/speech-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: input.signal ?? AbortSignal.timeout(STREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local TTS stream request failed.";
    if (!isCallerAbortError(error)) {
      recordLocalTtsFailure(input.appId, message);
      evictCachedApp(input.origin, input.appId, app);
    }
    return { ok: false, error: message };
  } finally {
    if (input.timings) input.timings.upstreamOpenMs = Date.now() - upstreamStartedAt;
  }
  if (!response.ok || !response.body) {
    recordLocalTtsFailure(input.appId, `Local TTS stream returned HTTP ${response.status}.`);
    evictCachedApp(input.origin, input.appId, app);
    return { ok: false, error: `Local TTS stream returned HTTP ${response.status}.` };
  }
  recordLocalTtsSuccess(input.appId);
  touchCachedApp(input.origin, input.appId, app);
  return {
    ok: true,
    body: response.body,
    sampleRate: Math.trunc(numberValue(response.headers.get("x-audio-sample-rate"), DEFAULT_SAMPLE_RATE)),
    channels: Math.max(1, Math.trunc(numberValue(response.headers.get("x-audio-channels"), 1))),
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
  const app = await resolvedTtsApp(input.origin, input.appId);
  if (!app?.apiBaseUrl) {
    recordLocalTtsFailure(input.appId, "No matching connected TTS app with an API base URL was found.");
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
  let response: Response;
  try {
    response = await fetch(`${app.apiBaseUrl.replace(/\/+$/, "")}/v1/audio/speech-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: input.signal ?? AbortSignal.timeout(STREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (!isCallerAbortError(error)) {
      recordLocalTtsFailure(input.appId, error instanceof Error ? error.message : "Local TTS stream request failed.");
      evictCachedApp(input.origin, input.appId, app);
    }
    throw error;
  }
  if (!response.ok) {
    recordLocalTtsFailure(input.appId, `Local TTS stream returned HTTP ${response.status}.`);
    evictCachedApp(input.origin, input.appId, app);
  } else {
    recordLocalTtsSuccess(input.appId);
    touchCachedApp(input.origin, input.appId, app);
  }
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
