// Shared data shapes + parsers for the Calls settings panel (orchestrator +
// voice section). Kept separate so both files import one source of truth for
// the gateway/local-TTS discovery payloads.

export type VoiceOption = {
  id: string;
  provider: string;
  voice: string;
  model?: string;
  appName?: string;
  machineName?: string;
  source: string;
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

export type LocalTtsCandidate = {
  id: string;
  appId: string;
  name: string;
  machineName?: string;
  port?: number;
  ok: boolean;
  error?: string;
  model: string;
  availableModels: string[];
  availableModelDetails: LocalTtsModelStatus[];
  availableVoices: string[];
  voice: string;
  voiceCount?: number;
  streamingKind?: string;
  streamingImplementation?: string;
  sampleRate: number;
  sampleFormat: string;
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
  system?: {
    cpuPct?: number;
    cpuCores?: number;
    ramUsedGb?: number;
    ramTotalGb?: number;
    diskPct?: number | null;
    diskUsedGb?: number | null;
    diskTotalGb?: number | null;
    platform?: string;
    arch?: string;
  };
  availableRamGb?: number;
  capacity: LocalTtsCapacity;
  capacityLabel: string;
  capacityDetail: string;
  canStart: boolean;
  modelHints: string[];
  modelHintsSource: LocalTtsLaunchModelHintsSource;
  preferredModel: string;
};

export type PhoneStatus = {
  checked: boolean;
  connected: boolean;
  lastSeenAt?: string;
  apnsConfigured?: boolean;
  apnsMissing: string[];
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function runtimeDefaultVoiceOptions(provider: string): VoiceOption[] {
  return [{ id: `runtime-default:${provider}`, provider, voice: "Gateway default", source: "runtime-default" }];
}

export function readVoiceOptions(value: unknown): VoiceOption[] {
  const config = asRecord(asRecord(value)?.config);
  const options = Array.isArray(config?.voiceOptions) ? config.voiceOptions : config?.voiceProviders;
  if (!Array.isArray(options)) return runtimeDefaultVoiceOptions("openai-realtime");
  const configuredOptions = options.flatMap((provider) => {
    const item = asRecord(provider);
    const id = typeof item?.id === "string" ? item.id : "";
    const runtime = typeof item?.provider === "string" ? item.provider : "";
    const voice = typeof item?.voice === "string" ? item.voice : "";
    const model = typeof item?.model === "string" ? item.model : undefined;
    const appName = typeof item?.appName === "string" ? item.appName : undefined;
    const machineName = typeof item?.machineName === "string" ? item.machineName : undefined;
    const source = item?.source === "runtime-default" ? "runtime-default" : "configured";
    return id && runtime && voice ? [{ id, provider: runtime, voice, model, appName, machineName, source }] : [];
  });
  return configuredOptions.length ? configuredOptions : runtimeDefaultVoiceOptions("openai-realtime");
}

export function readLocalTtsCandidates(value: unknown): LocalTtsCandidate[] {
  const config = asRecord(asRecord(value)?.config);
  const candidates = Array.isArray(config?.localTtsCandidates) ? config.localTtsCandidates : [];
  return candidates.flatMap((candidate) => {
    const item = asRecord(candidate);
    const id = typeof item?.id === "string" ? item.id : "";
    const appId = typeof item?.appId === "string" ? item.appId : "";
    if (!id || !appId) return [];
    return [
      {
        id,
        appId,
        name: typeof item?.name === "string" ? item.name : "Local TTS",
        machineName: typeof item?.machineName === "string" ? item.machineName : undefined,
        port: typeof item?.port === "number" ? item.port : undefined,
        ok: item?.ok === true,
        error: typeof item?.error === "string" ? item.error : undefined,
        model: typeof item?.model === "string" ? item.model : "chatterbox-turbo",
        availableModels: Array.isArray(item?.availableModels)
          ? [...new Set(item.availableModels.filter((entry) => typeof entry === "string"))]
          : [],
        availableModelDetails: Array.isArray(item?.availableModelDetails)
          ? item.availableModelDetails.flatMap((entry) => {
              const model = asRecord(entry);
              if (!model) return [];
              const modelId = typeof model?.id === "string" ? model.id : "";
              const providerId = typeof model?.providerId === "string" ? model.providerId : "";
              return modelId && providerId
                ? [
                    {
                      id: modelId,
                      providerId,
                      loadable: model.loadable === true,
                      loaded: model.loaded === true,
                      healthy: model.healthy === true,
                      callReady: model.callReady === true,
                      supportsTrueStreaming: model.supportsTrueStreaming === true,
                      streamingKind: typeof model.streamingKind === "string" ? model.streamingKind : undefined,
                      streamingImplementation:
                        typeof model.streamingImplementation === "string" ? model.streamingImplementation : undefined,
                    },
                  ]
                : [];
            })
          : [],
        availableVoices: Array.isArray(item?.availableVoices)
          ? [...new Set(item.availableVoices.filter((entry) => typeof entry === "string"))]
          : [],
        voice: typeof item?.voice === "string" ? item.voice : "voice01",
        voiceCount: typeof item?.voiceCount === "number" ? item.voiceCount : undefined,
        streamingKind: typeof item?.streamingKind === "string" ? item.streamingKind : undefined,
        streamingImplementation:
          typeof item?.streamingImplementation === "string" ? item.streamingImplementation : undefined,
        sampleRate: typeof item?.sampleRate === "number" ? item.sampleRate : 24_000,
        sampleFormat: typeof item?.sampleFormat === "string" ? item.sampleFormat : "pcm16",
      },
    ];
  });
}

export function readLocalTtsLaunchCandidates(value: unknown): LocalTtsLaunchCandidate[] {
  const root = asRecord(value);
  const result = asRecord(root?.result) ?? root;
  const candidates = Array.isArray(result?.launchCandidates) ? result.launchCandidates : [];
  return candidates.flatMap((candidate) => {
    const item = asRecord(candidate);
    const id = typeof item?.id === "string" ? item.id : "";
    const collectorUrl = typeof item?.collectorUrl === "string" ? item.collectorUrl : "";
    if (!id || !collectorUrl) return [];
    const system = asRecord(item?.system);
    return [
      {
        id,
        machineName: typeof item?.machineName === "string" ? item.machineName : "Hivemind machine",
        collectorUrl,
        collectorStatus: typeof item?.collectorStatus === "string" ? item.collectorStatus : "unknown",
        online: item?.online !== false,
        serviceLabels: Array.isArray(item?.serviceLabels)
          ? [...new Set(item.serviceLabels.filter((entry) => typeof entry === "string"))]
          : [],
        system: system
          ? {
              cpuPct: typeof system.cpuPct === "number" ? system.cpuPct : undefined,
              cpuCores: typeof system.cpuCores === "number" ? system.cpuCores : undefined,
              ramUsedGb: typeof system.ramUsedGb === "number" ? system.ramUsedGb : undefined,
              ramTotalGb: typeof system.ramTotalGb === "number" ? system.ramTotalGb : undefined,
              diskPct: typeof system.diskPct === "number" || system.diskPct === null ? system.diskPct : undefined,
              diskUsedGb: typeof system.diskUsedGb === "number" || system.diskUsedGb === null ? system.diskUsedGb : undefined,
              diskTotalGb: typeof system.diskTotalGb === "number" || system.diskTotalGb === null ? system.diskTotalGb : undefined,
              platform: typeof system.platform === "string" ? system.platform : undefined,
              arch: typeof system.arch === "string" ? system.arch : undefined,
            }
          : undefined,
        availableRamGb: typeof item?.availableRamGb === "number" ? item.availableRamGb : undefined,
        capacity:
          item?.capacity === "ready" || item?.capacity === "tight" || item?.capacity === "limited" || item?.capacity === "unknown"
            ? item.capacity
            : "unknown",
        capacityLabel: typeof item?.capacityLabel === "string" ? item.capacityLabel : "Resource check pending",
        capacityDetail: typeof item?.capacityDetail === "string" ? item.capacityDetail : "Capacity has not been checked yet.",
        canStart: item?.canStart === true,
        modelHints: Array.isArray(item?.modelHints)
          ? [...new Set(item.modelHints.filter((entry) => typeof entry === "string"))]
          : [],
        modelHintsSource:
          item?.modelHintsSource === "service" || item?.modelHintsSource === "running-candidate" || item?.modelHintsSource === "fallback"
            ? item.modelHintsSource
            : "fallback",
        preferredModel: typeof item?.preferredModel === "string" ? item.preferredModel : "",
      },
    ];
  });
}

export function formatGb(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} GB`;
}

export function formatPct(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  return `${Math.round(value)}%`;
}

export function machineResourceSummary(candidate: LocalTtsLaunchCandidate) {
  const system = candidate.system;
  const cpu = system?.cpuCores
    ? `${Math.round(system.cpuCores)} cores${typeof system.cpuPct === "number" ? ` · ${formatPct(system.cpuPct)}` : ""}`
    : "Unknown";
  const ram =
    typeof system?.ramTotalGb === "number" ? `${formatGb(candidate.availableRamGb)} free / ${formatGb(system.ramTotalGb)}` : "Unknown";
  const disk = typeof system?.diskTotalGb === "number" ? `${formatPct(system.diskPct)} used / ${formatGb(system.diskTotalGb)}` : "Unknown";
  const platform = [system?.platform, system?.arch].filter(Boolean).join(" · ") || "Unknown";
  return { cpu, ram, disk, platform };
}

export function normalizeDisplayName(value?: string) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

export function fmt12(time: string) {
  const [rawHour, rawMinute] = String(time || "09:00").split(":").map(Number);
  const hour = Number.isFinite(rawHour) ? rawHour : 9;
  const minute = Number.isFinite(rawMinute) ? rawMinute : 0;
  const ap = hour >= 12 ? "PM" : "AM";
  return { h: ((hour + 11) % 12) + 1, m: String(minute).padStart(2, "0"), ap };
}
