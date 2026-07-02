"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import QRCode from "qrcode";
import {
  Bell,
  Briefcase,
  ChevronDown,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  MessageSquareText,
  Phone,
  PlugZap,
  RefreshCcw,
  Send,
  Server,
  Shield,
  Volume2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { buildAgentCallPreferences } from "@/lib/types/agent-runtime";
import type { AgentCallMissedFallback, AgentCallPreferences, AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentCreateDraft } from "@/features/dashboard/agent-settings-types";
import { clawMobilePairingUrl, hubUrlForPairingHost } from "@/lib/phone/pairing-url";
import { Badge, Btn, Field, GroupLabel, PanelHead, Toggle } from "./AgentSettingsModalPrimitives";
import styles from "./AgentSettingsCallsPanel.module.css";

type AgentCallSourceKey = keyof AgentCallPreferences["sources"];

type VoiceOption = {
  id: string;
  provider: string;
  voice: string;
  model?: string;
  appName?: string;
  machineName?: string;
  source: string;
};

type LocalTtsCandidate = {
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

type LocalTtsModelStatus = {
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

type LocalTtsCapacity = "ready" | "tight" | "limited" | "unknown";
type LocalTtsLaunchModelHintsSource = "service" | "running-candidate" | "fallback";

type LocalTtsLaunchCandidate = {
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

type PhoneStatus = {
  checked: boolean;
  connected: boolean;
  lastSeenAt?: string;
  apnsConfigured?: boolean;
  apnsMissing: string[];
};

export type AgentSettingsCallsPanelProps = {
  agentCreateDraft: AgentCreateDraft;
  agentCreateMachine: { name?: string } | null;
  onQueenClapWakeEnabledChange?: (enabled: boolean) => unknown;
  queenClapWakeEnabled?: boolean;
  roleModalAgent: AgentProfile | null;
  setAgentCreateDraft: Dispatch<SetStateAction<AgentCreateDraft>>;
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => unknown;
};

const VOICE_RUNTIME_LABELS: Record<string, string> = {
  "openai-realtime": "OpenAI Realtime",
  "grok-voice": "Grok Voice",
  "gemini-live": "Gemini Live",
  "local-tts": "Local TTS",
};

const FALLBACK_OPTIONS = [
  { value: "none", label: "None" },
  { value: "in_app", label: "App" },
  { value: "obsidian_note", label: "Obsidian" },
  { value: "telegram", label: "Telegram" },
];

const CALL_SOURCES: Array<{ key: AgentCallSourceKey; label: string; sub: string; Icon: LucideIcon }> = [
  { key: "obsidianBriefing", label: "Obsidian briefing", sub: "Vault deltas and open loops.", Icon: MessageSquareText },
  { key: "codingJobCompletion", label: "Coding completion", sub: "Call when long work finishes.", Icon: Briefcase },
  { key: "blockedAgentDecision", label: "Blocked decision", sub: "Ring when a choice needs you.", Icon: Wand2 },
];

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function runtimeDefaultVoiceOptions(provider: string): VoiceOption[] {
  return [{ id: `runtime-default:${provider}`, provider, voice: "Gateway default", source: "runtime-default" }];
}

function readVoiceOptions(value: unknown): VoiceOption[] {
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

function readLocalTtsCandidates(value: unknown): LocalTtsCandidate[] {
  const config = asRecord(asRecord(value)?.config);
  const candidates = Array.isArray(config?.localTtsCandidates) ? config.localTtsCandidates : [];
  return candidates.flatMap((candidate) => {
    const item = asRecord(candidate);
    const id = typeof item?.id === "string" ? item.id : "";
    const appId = typeof item?.appId === "string" ? item.appId : "";
    if (!id || !appId) return [];
    return [{
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
          return modelId && providerId ? [{
            id: modelId,
            providerId,
            loadable: model.loadable === true,
            loaded: model.loaded === true,
            healthy: model.healthy === true,
            callReady: model.callReady === true,
            supportsTrueStreaming: model.supportsTrueStreaming === true,
            streamingKind: typeof model.streamingKind === "string" ? model.streamingKind : undefined,
            streamingImplementation: typeof model.streamingImplementation === "string" ? model.streamingImplementation : undefined,
          }] : [];
        })
        : [],
      availableVoices: Array.isArray(item?.availableVoices)
        ? [...new Set(item.availableVoices.filter((entry) => typeof entry === "string"))]
        : [],
      voice: typeof item?.voice === "string" ? item.voice : "voice01",
      voiceCount: typeof item?.voiceCount === "number" ? item.voiceCount : undefined,
      streamingKind: typeof item?.streamingKind === "string" ? item.streamingKind : undefined,
      streamingImplementation: typeof item?.streamingImplementation === "string" ? item.streamingImplementation : undefined,
      sampleRate: typeof item?.sampleRate === "number" ? item.sampleRate : 24_000,
      sampleFormat: typeof item?.sampleFormat === "string" ? item.sampleFormat : "pcm16",
    }];
  });
}

function readLocalTtsLaunchCandidates(value: unknown): LocalTtsLaunchCandidate[] {
  const root = asRecord(value);
  const result = asRecord(root?.result) ?? root;
  const candidates = Array.isArray(result?.launchCandidates) ? result.launchCandidates : [];
  return candidates.flatMap((candidate) => {
    const item = asRecord(candidate);
    const id = typeof item?.id === "string" ? item.id : "";
    const collectorUrl = typeof item?.collectorUrl === "string" ? item.collectorUrl : "";
    if (!id || !collectorUrl) return [];
    const system = asRecord(item?.system);
    return [{
      id,
      machineName: typeof item?.machineName === "string" ? item.machineName : "Hivemind machine",
      collectorUrl,
      collectorStatus: typeof item?.collectorStatus === "string" ? item.collectorStatus : "unknown",
      online: item?.online !== false,
      serviceLabels: Array.isArray(item?.serviceLabels)
        ? [...new Set(item.serviceLabels.filter((entry) => typeof entry === "string"))]
        : [],
      system: system ? {
        cpuPct: typeof system.cpuPct === "number" ? system.cpuPct : undefined,
        cpuCores: typeof system.cpuCores === "number" ? system.cpuCores : undefined,
        ramUsedGb: typeof system.ramUsedGb === "number" ? system.ramUsedGb : undefined,
        ramTotalGb: typeof system.ramTotalGb === "number" ? system.ramTotalGb : undefined,
        diskPct: typeof system.diskPct === "number" || system.diskPct === null ? system.diskPct : undefined,
        diskUsedGb: typeof system.diskUsedGb === "number" || system.diskUsedGb === null ? system.diskUsedGb : undefined,
        diskTotalGb: typeof system.diskTotalGb === "number" || system.diskTotalGb === null ? system.diskTotalGb : undefined,
        platform: typeof system.platform === "string" ? system.platform : undefined,
        arch: typeof system.arch === "string" ? system.arch : undefined,
      } : undefined,
      availableRamGb: typeof item?.availableRamGb === "number" ? item.availableRamGb : undefined,
      capacity: item?.capacity === "ready" || item?.capacity === "tight" || item?.capacity === "limited" || item?.capacity === "unknown" ? item.capacity : "unknown",
      capacityLabel: typeof item?.capacityLabel === "string" ? item.capacityLabel : "Resource check pending",
      capacityDetail: typeof item?.capacityDetail === "string" ? item.capacityDetail : "Capacity has not been checked yet.",
      canStart: item?.canStart === true,
      modelHints: Array.isArray(item?.modelHints)
        ? [...new Set(item.modelHints.filter((entry) => typeof entry === "string"))]
        : [],
      modelHintsSource: item?.modelHintsSource === "service" || item?.modelHintsSource === "running-candidate" || item?.modelHintsSource === "fallback"
        ? item.modelHintsSource
        : "fallback",
      preferredModel: typeof item?.preferredModel === "string" ? item.preferredModel : "",
    }];
  });
}

function formatGb(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} GB`;
}

function formatPct(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown";
  return `${Math.round(value)}%`;
}

function machineResourceSummary(candidate: LocalTtsLaunchCandidate) {
  const system = candidate.system;
  const cpu = system?.cpuCores
    ? `${Math.round(system.cpuCores)} cores${typeof system.cpuPct === "number" ? ` · ${formatPct(system.cpuPct)}` : ""}`
    : "Unknown";
  const ram = typeof system?.ramTotalGb === "number"
    ? `${formatGb(candidate.availableRamGb)} free / ${formatGb(system.ramTotalGb)}`
    : "Unknown";
  const disk = typeof system?.diskTotalGb === "number"
    ? `${formatPct(system.diskPct)} used / ${formatGb(system.diskTotalGb)}`
    : "Unknown";
  const platform = [system?.platform, system?.arch].filter(Boolean).join(" · ") || "Unknown";
  return { cpu, ram, disk, platform };
}

function normalizeDisplayName(value?: string) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

function fmt12(time: string) {
  const [rawHour, rawMinute] = String(time || "09:00").split(":").map(Number);
  const hour = Number.isFinite(rawHour) ? rawHour : 9;
  const minute = Number.isFinite(rawMinute) ? rawMinute : 0;
  const ap = hour >= 12 ? "PM" : "AM";
  return { h: ((hour + 11) % 12) + 1, m: String(minute).padStart(2, "0"), ap };
}

export function AgentSettingsCallsPanel(props: AgentSettingsCallsPanelProps) {
  const {
    agentCreateDraft,
    agentCreateMachine,
    onQueenClapWakeEnabledChange,
    queenClapWakeEnabled,
    roleModalAgent,
    setAgentCreateDraft,
    updateAgentProfile,
  } = props;
  const [phoneQr, setPhoneQr] = useState("");
  const [phoneHubUrl, setPhoneHubUrl] = useState("");
  const [phoneConnectError, setPhoneConnectError] = useState("");
  const [phoneStatus, setPhoneStatus] = useState<PhoneStatus>({ checked: false, connected: false, apnsMissing: [] });
  const [localTtsDiscoveryStatus, setLocalTtsDiscoveryStatus] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [localTtsDiscoveryError, setLocalTtsDiscoveryError] = useState("");
  const [voiceOptions, setVoiceOptions] = useState(() => runtimeDefaultVoiceOptions("openai-realtime"));
  const [localTtsCandidates, setLocalTtsCandidates] = useState<LocalTtsCandidate[]>([]);
  const [localTtsLaunchCandidates, setLocalTtsLaunchCandidates] = useState<LocalTtsLaunchCandidate[]>([]);
  const [ttsLaunchPickerId, setTtsLaunchPickerId] = useState("");
  const [ttsLaunchModelById, setTtsLaunchModelById] = useState<Record<string, string>>({});
  const [ttsLaunchBusyId, setTtsLaunchBusyId] = useState("");
  const [ttsLaunchMessage, setTtsLaunchMessage] = useState("");
  const [ttsLaunchTone, setTtsLaunchTone] = useState<"ok" | "error" | "muted">("muted");
  const [ttsModelBusyKey, setTtsModelBusyKey] = useState("");
  const [ttsModelMessage, setTtsModelMessage] = useState("");
  const [ttsModelTone, setTtsModelTone] = useState<"ok" | "error" | "muted">("muted");
  const [callTestBusy, setCallTestBusy] = useState(false);
  const [callTestMessage, setCallTestMessage] = useState("");
  const [callTestTone, setCallTestTone] = useState<"ok" | "error" | "muted">("muted");

  const agentCallSettings = buildAgentCallPreferences(agentCreateMachine ? agentCreateDraft.calls : roleModalAgent?.calls);
  const isQueenSettings = !agentCreateMachine && roleModalAgent?.beeRole === "queen";
  const callTimezone = agentCallSettings.timezone || "UTC";
  const selectedTime = fmt12(agentCallSettings.dailyCallTime);
  const voiceRuntimeOptions = ["openai-realtime", "local-tts", agentCallSettings.voiceRuntime, ...voiceOptions.map((provider) => provider.provider)]
    .filter((provider, index, list) => provider && list.indexOf(provider) === index);
  const selectedVoiceOptions = voiceOptions.filter((provider) => provider.provider === agentCallSettings.voiceRuntime);
  const selectedVoiceOption = voiceOptions.find((provider) => provider.id === agentCallSettings.voiceProviderId)
    ?? selectedVoiceOptions.find((provider) => provider.voice === agentCallSettings.voiceId)
    ?? selectedVoiceOptions[0]
    ?? runtimeDefaultVoiceOptions(agentCallSettings.voiceRuntime)[0];
  const hasConfiguredVoices = voiceOptions.some((provider) => provider.source === "configured");
  const localTtsDiscoveryLoading = localTtsDiscoveryStatus === "loading";

  const updateAgentCalls = (patch: Partial<AgentCallPreferences>) => {
    const next = buildAgentCallPreferences({ ...agentCallSettings, ...patch });
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, calls: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { calls: next });
  };

  const okLocalTtsCandidates = localTtsCandidates.filter((candidate) => candidate.ok);
  const selectedLocalTtsCandidate = localTtsCandidates.find(
    (candidate) => candidate.id === agentCallSettings.voiceProviderId,
  );
  const effectiveSelectedLocalTtsCandidate = selectedLocalTtsCandidate
    ?? (agentCallSettings.voiceRuntime === "local-tts" && okLocalTtsCandidates.length === 1 ? okLocalTtsCandidates[0] : undefined);
  const selectedLocalTtsModel = agentCallSettings.voiceModelId || effectiveSelectedLocalTtsCandidate?.model || "";
  const selectedLocalTtsVoice = agentCallSettings.voiceId || effectiveSelectedLocalTtsCandidate?.voice || "";
  const selectedLocalTtsVoiceOptions = [
    selectedLocalTtsVoice,
    ...(effectiveSelectedLocalTtsCandidate?.availableVoices ?? []),
  ].filter((voice, index, list): voice is string => Boolean(voice) && list.indexOf(voice) === index);

  const updateCallSource = (source: AgentCallSourceKey, enabled: boolean) => {
    updateAgentCalls({ sources: { ...agentCallSettings.sources, [source]: enabled } });
  };

  const updateVoiceRuntime = (voiceRuntime: string) => {
    if (voiceRuntime === "local-tts") {
      const candidate = effectiveSelectedLocalTtsCandidate ?? okLocalTtsCandidates[0];
      if (candidate) {
        const keepLocalSelection = agentCallSettings.voiceRuntime === "local-tts";
        updateAgentCalls({
          voiceRuntime,
          voiceProviderId: candidate.id,
          voiceModelId: keepLocalSelection ? agentCallSettings.voiceModelId || candidate.model : candidate.model,
          voiceId: keepLocalSelection ? agentCallSettings.voiceId || candidate.voice : candidate.voice,
        });
        return;
      }
    }
    const firstVoice = voiceOptions.find((provider) => provider.provider === voiceRuntime)
      ?? runtimeDefaultVoiceOptions(voiceRuntime)[0];
    updateAgentCalls({
      voiceRuntime,
      voiceProviderId: firstVoice.source === "configured" ? firstVoice.id : undefined,
      voiceModelId: firstVoice.source === "configured" ? firstVoice.model : undefined,
      voiceId: firstVoice.source === "configured" ? firstVoice.voice : undefined,
    });
  };

  const updateVoiceProvider = (voiceProviderId: string) => {
    const provider = voiceOptions.find((item) => item.id === voiceProviderId)
      ?? runtimeDefaultVoiceOptions(agentCallSettings.voiceRuntime)[0];
    updateAgentCalls({
      voiceProviderId: provider.source === "configured" ? provider.id : undefined,
      voiceRuntime: provider.provider,
      voiceModelId: provider.source === "configured" ? provider.model : undefined,
      voiceId: provider.source === "configured" ? provider.voice : undefined,
    });
  };

  const selectLocalTtsCandidate = (candidate: LocalTtsCandidate, overrides?: { model?: string; voice?: string }) => {
    if (!candidate.ok) return;
    updateAgentCalls({
      voiceRuntime: "local-tts",
      voiceProviderId: candidate.id,
      voiceModelId: overrides?.model || candidate.model,
      voiceId: overrides?.voice || candidate.voice,
    });
  };

  // Persist a model choice through the dashboard's own save path so it sticks
  // (an external edit to the stored profile gets clobbered by the running app).
  const updateLocalTtsModel = (model: string, candidate = effectiveSelectedLocalTtsCandidate) => updateAgentCalls({
    voiceRuntime: "local-tts",
    voiceProviderId: candidate?.id ?? agentCallSettings.voiceProviderId,
    voiceModelId: model,
    voiceId: agentCallSettings.voiceId || candidate?.voice,
  });
  const updateLocalTtsVoice = (voice: string, candidate = effectiveSelectedLocalTtsCandidate) => updateAgentCalls({
    voiceRuntime: "local-tts",
    voiceProviderId: candidate?.id ?? agentCallSettings.voiceProviderId,
    voiceModelId: agentCallSettings.voiceModelId || candidate?.model,
    voiceId: voice,
  });

  const refreshCallConnectionState = async () => {
    setLocalTtsDiscoveryStatus("loading");
    setLocalTtsDiscoveryError("");
    try {
      const [statusResponse, voiceResponse, localTtsResponse] = await Promise.all([
        fetch("/api/phone?action=device-status", { cache: "no-store" }).catch(() => null),
        fetch("/api/phone?action=voice-config", { cache: "no-store" }).catch(() => null),
        fetch("/api/phone/local-tts", { cache: "no-store" }).catch(() => null),
      ]);
      const statusData = asRecord(await statusResponse?.json().catch(() => null));
      const voiceData = asRecord(await voiceResponse?.json().catch(() => null));
      const localTtsData = asRecord(await localTtsResponse?.json().catch(() => null));
      const statusResult = asRecord(statusData?.result) ?? statusData;
      const device = asRecord(statusResult?.device);
      const apns = asRecord(statusResult?.apns);
      const missingApns = apns?.missing;
      setPhoneStatus({
        checked: true,
        connected: Boolean(statusResponse?.ok && statusData?.ok !== false && device),
        lastSeenAt: typeof device?.lastSeenAt === "string" ? device.lastSeenAt : undefined,
        apnsConfigured: typeof apns?.configured === "boolean" ? apns.configured : undefined,
        apnsMissing: Array.isArray(missingApns) ? missingApns.filter((item) => typeof item === "string") : [],
      });
      const voicePayload = voiceData?.result ?? voiceData;
      const nextVoiceOptions = readVoiceOptions(voicePayload);
      const nextLocalTtsCandidates = readLocalTtsCandidates(voicePayload);
      const nextLocalTtsLaunchCandidates = readLocalTtsLaunchCandidates(localTtsData);
      setVoiceOptions(nextVoiceOptions);
      setLocalTtsCandidates(nextLocalTtsCandidates);
      setLocalTtsLaunchCandidates(nextLocalTtsLaunchCandidates);
      setLocalTtsDiscoveryStatus("ready");
      return { localTtsCandidates: nextLocalTtsCandidates, localTtsLaunchCandidates: nextLocalTtsLaunchCandidates };
    } catch (error) {
      setLocalTtsDiscoveryStatus("error");
      setLocalTtsDiscoveryError(error instanceof Error ? error.message : "Local TTS discovery failed.");
      return { localTtsCandidates, localTtsLaunchCandidates };
    }
  };

  const updateLaunchModel = (candidateId: string, model: string) => {
    setTtsLaunchModelById((current) => ({ ...current, [candidateId]: model }));
  };

  const enableLocalTtsCandidate = async (candidate: LocalTtsLaunchCandidate) => {
    const model = ttsLaunchModelById[candidate.id] || candidate.preferredModel || candidate.modelHints[0] || "";
    setTtsLaunchBusyId(candidate.id);
    setTtsLaunchMessage("");
    setTtsLaunchTone("muted");
    try {
      const response = await fetch("/api/phone/local-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-service", collectorUrl: candidate.collectorUrl }),
      });
      const data = asRecord(await response.json().catch(() => null));
      if (!response.ok || data?.ok === false) throw new Error(typeof data?.error === "string" ? data.error : "Local TTS could not be started.");
      setTtsLaunchTone("ok");
      setTtsLaunchMessage(typeof data?.message === "string" ? data.message : "TTS start requested.");
      const refreshed = await refreshCallConnectionState();
      const machineName = normalizeDisplayName(candidate.machineName);
      const started = refreshed.localTtsCandidates.find((item) => item.ok && normalizeDisplayName(item.machineName) === machineName)
        ?? refreshed.localTtsCandidates.find((item) => item.ok);
      if (started) {
        const selectedModel = model && started.availableModels.includes(model) ? model : started.model;
        selectLocalTtsCandidate(started, { model: selectedModel, voice: started.voice });
        setTtsLaunchPickerId("");
        setTtsLaunchTone("ok");
        setTtsLaunchMessage(started.availableModels.length
          ? "Local TTS is running. Confirmed device models are available below."
          : "Local TTS is running. Refresh again if the model list is still warming up.");
      }
    } catch (error) {
      setTtsLaunchTone("error");
      setTtsLaunchMessage(error instanceof Error ? error.message : "Local TTS could not be started.");
    } finally {
      setTtsLaunchBusyId("");
    }
  };

  const localTtsModelStatus = (candidate: LocalTtsCandidate, model: string) =>
    candidate.availableModelDetails.find((item) => item.id === model);

  const runLocalTtsModelAction = async (
    candidate: LocalTtsCandidate,
    action: "load-model" | "unload-model",
    status: LocalTtsModelStatus,
  ) => {
    const busyKey = `${candidate.appId}:${status.providerId}:${action}`;
    setTtsModelBusyKey(busyKey);
    setTtsModelMessage(action === "load-model" ? `Loading ${status.id}...` : `Unloading ${status.providerId}...`);
    setTtsModelTone("muted");
    try {
      const response = await fetch("/api/phone/local-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          appId: candidate.appId,
          model: status.id,
          providerId: status.providerId,
        }),
      });
      const data = asRecord(await response.json().catch(() => null));
      if (!response.ok || data?.ok === false) throw new Error(typeof data?.error === "string" ? data.error : "Local TTS model action failed.");
      if (action === "load-model") {
        updateLocalTtsModel(status.id, candidate);
      }
      if (action === "unload-model" && status.id === selectedLocalTtsModel) {
        const fallback = candidate.availableModelDetails.find((item) => item.providerId !== status.providerId && item.callReady)?.id
          || candidate.availableModels.find((model) => model !== status.id)
          || candidate.model;
        updateLocalTtsModel(fallback, candidate);
      }
      setTtsModelTone("ok");
      setTtsModelMessage(action === "load-model" ? `${status.id} is loading on ${candidate.machineName || candidate.name}.` : `${status.providerId} unload requested.`);
      await refreshCallConnectionState();
    } catch (error) {
      setTtsModelTone("error");
      setTtsModelMessage(error instanceof Error ? error.message : "Local TTS model action failed.");
    } finally {
      setTtsModelBusyKey("");
    }
  };

  const changeLocalTtsModel = async (candidate: LocalTtsCandidate, model: string) => {
    updateLocalTtsModel(model, candidate);
    const status = localTtsModelStatus(candidate, model);
    if (!status || status.loaded) {
      setTtsModelTone("ok");
      setTtsModelMessage(status ? `${model} selected.` : `${model} selected. Load state is not reported by Universal TTS.`);
      return;
    }
    await runLocalTtsModelAction(candidate, "load-model", status);
  };

  const buildPairingQr = async () => {
    try {
      const response = await fetch("/api/tailscale/devices", { cache: "no-store" });
      const data = await response.json() as { devices?: Array<{ self?: boolean; ip?: string; dnsName?: string; machineId?: string }> };
      const self = (data.devices ?? []).find((device) => device?.self) ?? data.devices?.[0];
      const host = self?.ip || (self?.dnsName ? String(self.dnsName).replace(/\.$/, "") : "") || "";
      if (!host) {
        setPhoneConnectError("Couldn't determine this machine's tailnet address. Is Tailscale up?");
        return;
      }
      const hubUrl = hubUrlForPairingHost(host);
      const name = (self?.dnsName ? String(self.dnsName).split(".")[0] : "") || host;
      const pairUrl = clawMobilePairingUrl({ hubUrl, name, machineId: self?.machineId });
      setPhoneHubUrl(hubUrl);
      setPhoneQr(await QRCode.toDataURL(pairUrl, { width: 320, margin: 2 }));
      setPhoneConnectError("");
    } catch (error) {
      setPhoneConnectError(error instanceof Error ? error.message : "Failed to build the pairing code.");
    }
  };

  const requestAgentTestCall = async () => {
    const agent = roleModalAgent ?? {
      id: "draft-agent",
      name: agentCreateDraft.name || "New Hivemind Agent",
      runtime: agentCreateDraft.runtime,
      workerClass: agentCreateDraft.workerClass,
      skillProfilePrompt: agentCreateDraft.skillProfilePrompt,
      preferredSkillSlugs: agentCreateDraft.preferredSkillSlugs,
      aeonRepo: agentCreateDraft.aeonRepo,
      aeonBranch: agentCreateDraft.aeonBranch,
      aeonLocalPath: agentCreateDraft.aeonLocalPath,
      aeonMode: agentCreateDraft.aeonMode,
      a2aUrl: agentCreateDraft.a2aUrl,
    };
    setCallTestBusy(true);
    setCallTestMessage("");
    setCallTestTone("muted");
    try {
      const localTtsSelected = agentCallSettings.voiceRuntime === "local-tts";
      const voiceProviderId = localTtsSelected
        ? effectiveSelectedLocalTtsCandidate?.id ?? agentCallSettings.voiceProviderId
        : selectedVoiceOption.source === "configured" ? selectedVoiceOption.id : undefined;
      const voiceModelId = localTtsSelected
        ? selectedLocalTtsModel || effectiveSelectedLocalTtsCandidate?.model
        : selectedVoiceOption.source === "configured" ? selectedVoiceOption.model : undefined;
      const voiceId = localTtsSelected
        ? selectedLocalTtsVoice || effectiveSelectedLocalTtsCandidate?.voice
        : selectedVoiceOption.source === "configured" ? selectedVoiceOption.voice : undefined;
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ring-agent",
          agent: {
            id: agent.id,
            name: agent.name,
            runtime: agent.runtime,
            role: agent.workerClass,
            voiceProviderId,
            voiceRuntime: agentCallSettings.voiceRuntime,
            voiceModelId,
            voiceId,
            skillProfilePrompt: agent.skillProfilePrompt,
            preferredSkillSlugs: agent.preferredSkillSlugs,
            aeonRepo: agent.aeonRepo,
            aeonRepoName: "aeonRepoName" in agent ? agent.aeonRepoName : undefined,
            aeonBranch: agent.aeonBranch,
            aeonLocalPath: agent.aeonLocalPath,
            aeonMode: agent.aeonMode,
            a2aUrl: agent.a2aUrl,
            localDataDir: "localDataDir" in agent ? agent.localDataDir : undefined,
          },
          machine: { name: agentCreateMachine?.name ?? roleModalAgent?.machineName },
        }),
      });
      const data = asRecord(await response.json().catch(() => null));
      if (!response.ok || data?.ok === false) throw new Error(typeof data?.error === "string" ? data.error : "Test call failed.");
      setCallTestTone("ok");
      setCallTestMessage("Test call requested.");
    } catch (error) {
      setCallTestTone("error");
      setCallTestMessage(error instanceof Error ? error.message : "Test call failed.");
    } finally {
      setCallTestBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshCallConnectionState();
      void buildPairingQr();
    }, 0);
    return () => window.clearTimeout(timer);
    // Mount-only discovery; manual Refresh handles later availability checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.panel}>
      <PanelHead
        eyebrow="Calls"
        title="Scheduled phone calls"
        sub="Let this agent ring your phone with status briefings through the HivemindOS Mobile gateway."
        action={<Btn sm disabled={localTtsDiscoveryLoading} onClick={() => void refreshCallConnectionState()}>
          <RefreshCcw size={13} className={localTtsDiscoveryLoading ? "animate-spin" : undefined} aria-hidden="true" />
          {localTtsDiscoveryLoading ? "Refreshing" : "Refresh"}
        </Btn>}
      />

      {isQueenSettings && onQueenClapWakeEnabledChange ? (
        <article className={styles.eventRow} data-on={queenClapWakeEnabled ? "" : undefined}>
          <span className={styles.eventIcon}><Bell size={16} aria-hidden="true" /></span>
          <div className={styles.meta}>
            <div className={styles.eventTitle}>Clap wake</div>
            <div className={styles.eventSub}>Open Queen Bee voice chat when two quick claps are detected locally.</div>
          </div>
          <Toggle on={Boolean(queenClapWakeEnabled)} onChange={() => onQueenClapWakeEnabledChange(!queenClapWakeEnabled)} />
        </article>
      ) : null}

      <section className={styles.callLine} data-live={phoneStatus.connected ? "" : undefined} data-off={!agentCallSettings.enabled ? "" : undefined}>
        <span className={styles.tile}><Phone size={18} aria-hidden="true" /></span>
        <div className={styles.meta}>
          <div className={styles.title}>iPhone · HivemindOS Mobile</div>
          <div className={styles.status}>
            <span className={["fr-dot", phoneStatus.connected && agentCallSettings.enabled ? "live" : ""].filter(Boolean).join(" ")} />
            {phoneStatus.connected
              ? agentCallSettings.enabled
                ? `Connected${phoneStatus.lastSeenAt ? ` · last seen ${new Date(phoneStatus.lastSeenAt).toLocaleString()}` : ""}`
                : "Calls paused"
              : "Waiting for mobile pairing"}
          </div>
        </div>
        {phoneStatus.connected ? (
          <Btn sm disabled={callTestBusy} onClick={() => void requestAgentTestCall()}>
            {callTestBusy ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
            {callTestBusy ? "Requesting..." : "Test call"}
          </Btn>
        ) : null}
        <Toggle on={agentCallSettings.enabled} onChange={() => updateAgentCalls({ enabled: !agentCallSettings.enabled })} />
      </section>
      {callTestMessage ? <p className={["as-status", callTestTone === "ok" ? styles.messageOk : callTestTone === "error" ? styles.messageError : ""].filter(Boolean).join(" ")}>{callTestMessage}</p> : null}

      {!phoneStatus.connected ? (
        <section className={styles.setupCard}>
          <PanelHead eyebrow="Mobile pairing" title="Connect HivemindOS Mobile" sub="Your phone scans the same pairing code from /connect-phone, then the gateway can ring the device for scheduled agent calls." />
          <ol className={styles.setupSteps}>
            <li>
              <b className={styles.stepNumber}>1</b>
              <div><div className={styles.title}>Install HivemindOS Mobile</div><p>Use the phone you want agents to call.</p></div>
            </li>
            <li>
              <b className={styles.stepNumber}>2</b>
              <div>
                <div className={styles.title}>Open Settings, then scan this QR code</div>
                {phoneConnectError ? <p className={styles.messageError}>{phoneConnectError}</p> : phoneQr ? (
                  <div className={styles.qrWrap}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={phoneQr} alt="HivemindOS Mobile pairing QR" />
                    <code>{phoneHubUrl}</code>
                  </div>
                ) : <p>Generating pairing code...</p>}
              </div>
            </li>
          </ol>
        </section>
      ) : null}

      {agentCallSettings.enabled ? (
        <>
          <section className={styles.alarm} data-off={!agentCallSettings.dailyEnabled ? "" : undefined}>
            <div className={styles.alarmInfo}>
              <span className="fb-eyebrow">Daily briefing</span>
              <div className={styles.time}>{selectedTime.h}:{selectedTime.m}<span className={styles.ampm}>{selectedTime.ap}</span></div>
              <div className={styles.days}>{DAY_LABELS.map((day, index) => <span key={`${day}-${index}`} className={styles.day}>{day}</span>)}</div>
            </div>
            <div className={styles.alarmActions}>
              <Toggle on={agentCallSettings.dailyEnabled} onChange={() => updateAgentCalls({ dailyEnabled: !agentCallSettings.dailyEnabled })} />
              <label className={styles.timeChange}>
                <Clock size={12} aria-hidden="true" />Change time
                <input type="time" value={agentCallSettings.dailyCallTime} onChange={(event) => updateAgentCalls({ dailyCallTime: event.target.value })} />
              </label>
            </div>
            <div className={styles.next}>
              <Phone size={12} aria-hidden="true" />
              {agentCallSettings.dailyEnabled
                ? `Next call · tomorrow ${selectedTime.h}:${selectedTime.m} ${selectedTime.ap} · every day · ${callTimezone}`
                : "Daily call paused"}
            </div>
          </section>

          <div>
            <GroupLabel>Also ring me when</GroupLabel>
            <div className={styles.events}>
              {CALL_SOURCES.map(({ key, label, sub, Icon }) => (
                <article key={key} className={styles.eventRow} data-on={agentCallSettings.sources[key] ? "" : undefined}>
                  <span className={styles.eventIcon}><Icon size={16} aria-hidden="true" /></span>
                  <div className={styles.meta}>
                    <div className={styles.eventTitle}>{label}</div>
                    <div className={styles.eventSub}>{sub}</div>
                  </div>
                  <Toggle on={Boolean(agentCallSettings.sources[key])} onChange={() => updateCallSource(key, !agentCallSettings.sources[key])} />
                </article>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <div>
        <GroupLabel>Voice and limits</GroupLabel>
        <section className={styles.voiceBlock}>
          <div className={styles.voiceGrid}>
            <Field label="Runtime">
              <select className="fb-select" value={agentCallSettings.voiceRuntime} onChange={(event) => updateVoiceRuntime(event.target.value)}>
                {voiceRuntimeOptions.map((runtime) => <option value={runtime} key={runtime}>{VOICE_RUNTIME_LABELS[runtime] ?? runtime}</option>)}
              </select>
            </Field>
            {agentCallSettings.voiceRuntime === "local-tts" ? (
              <Field label="Voice">
                <select
                  className="fb-select"
                  value={selectedLocalTtsVoice}
                  disabled={!selectedLocalTtsVoiceOptions.length}
                  onChange={(event) => updateLocalTtsVoice(event.target.value)}
                >
                  {selectedLocalTtsVoiceOptions.length
                    ? selectedLocalTtsVoiceOptions.map((voice) => <option value={voice} key={voice}>{voice}</option>)
                    : <option value="">No Local TTS voices discovered</option>}
                </select>
              </Field>
            ) : (
              <Field label="Voice">
                <select className="fb-select" value={selectedVoiceOption.id} onChange={(event) => updateVoiceProvider(event.target.value)}>
                  {selectedVoiceOptions.map((provider) => (
                    <option value={provider.id} key={provider.id}>{VOICE_RUNTIME_LABELS[provider.provider] ?? provider.provider} · {provider.voice}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Missed-call fallback">
              {/* DOM boundary: the option values below are exactly the AgentCallMissedFallback union. */}
              <select className="fb-select" value={agentCallSettings.missedCallFallback} onChange={(event) => updateAgentCalls({ missedCallFallback: event.target.value as AgentCallMissedFallback })}>
                {FALLBACK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </Field>
          </div>

          {!hasConfiguredVoices && agentCallSettings.voiceRuntime !== "local-tts" ? (
            <div className="as-info">
              <PlugZap size={16} className="ic" aria-hidden="true" />
              <p>Using the gateway-resolved default voice. Sync custom voices from Hivemind Mobile Settings when you want an explicit provider voice.</p>
            </div>
          ) : null}

          {agentCallSettings.voiceRuntime === "local-tts" ? (
            <>
            {localTtsDiscoveryLoading ? (
              <div className={styles.localTtsLoading} role="status" aria-live="polite">
                <RefreshCcw size={16} className="animate-spin" aria-hidden="true" />
                <div>
                  <strong>Checking Local TTS availability</strong>
                  <span>Scanning Hivemind Link machines, Universal TTS services, voices, and model rosters.</span>
                </div>
              </div>
            ) : localTtsDiscoveryError ? (
              <div className={styles.localTtsLoading} data-tone="error" role="status">
                <Volume2 size={16} aria-hidden="true" />
                <div>
                  <strong>Local TTS discovery failed</strong>
                  <span>{localTtsDiscoveryError}</span>
                </div>
              </div>
            ) : null}
            {localTtsCandidates.length ? (
              <div className={styles.localTtsGrid}>
                {localTtsCandidates.map((candidate) => {
                  const selected = candidate.id === effectiveSelectedLocalTtsCandidate?.id;
                  const selectedModel = selected ? selectedLocalTtsModel || candidate.model : candidate.model;
                  const selectedVoice = selected ? selectedLocalTtsVoice || candidate.voice : candidate.voice;
                  const modelOptions = [selectedModel, ...candidate.availableModels]
                    .filter((model, index, list): model is string => Boolean(model) && list.indexOf(model) === index);
                  const selectedStatus = localTtsModelStatus(candidate, selectedModel);
                  const loadedProviders = [...new Map(candidate.availableModelDetails
                    .filter((status) => status.loaded && status.callReady)
                    .map((status) => [status.providerId, status])).values()];
                  return (
                    <article
                      key={candidate.id}
                      className={styles.localTtsCard}
                      data-selected={selected ? "" : undefined}
                      data-unavailable={!candidate.ok ? "" : undefined}
                    >
                      <Badge tone={candidate.ok ? "live" : "danger"}>{candidate.ok ? "Validated" : "Unavailable"}</Badge>
                      <strong>{candidate.name}</strong>
                      <small>{[candidate.machineName, candidate.port ? `port ${candidate.port}` : ""].filter(Boolean).join(" · ") || "Connected app"}</small>
                      <dl>
                        <div><dt>Model</dt><dd>{selectedModel}</dd></div>
                        <div><dt>Voice</dt><dd>{selectedVoice}</dd></div>
                        <div><dt>Stream</dt><dd>{candidate.sampleFormat} · {candidate.sampleRate} Hz</dd></div>
                        <div><dt>Engine</dt><dd>{candidate.streamingImplementation || candidate.streamingKind || "streaming"}</dd></div>
                      </dl>
                      {candidate.voiceCount ? <small>{candidate.voiceCount} voices</small> : null}
                      {!candidate.ok && candidate.error ? <p className={styles.messageError}>{candidate.error}</p> : null}
                      {!selected ? (
                        <Btn sm disabled={!candidate.ok} onClick={() => selectLocalTtsCandidate(candidate)}>Select host</Btn>
                      ) : candidate.ok ? (
                        <div className={styles.localTtsInlineControls}>
                          {modelOptions.length ? (
                            <Field label="Model">
                              <select
                                className="fb-select"
                                value={selectedModel}
                                disabled={Boolean(ttsModelBusyKey)}
                                onChange={(event) => void changeLocalTtsModel(candidate, event.target.value)}
                              >
                                {modelOptions.map((model) => (
                                  <option value={model} key={model}>{model}</option>
                                ))}
                              </select>
                            </Field>
                          ) : null}
                          <div className={styles.localTtsModelActions}>
                            <span>{selectedStatus ? `${selectedStatus.providerId} ${selectedStatus.loaded ? "loaded" : "not loaded"}` : "Load state unavailable"}</span>
                            {selectedStatus ? (
                              <Btn
                                sm
                                variant={selectedStatus.loaded ? "ghost" : "primary"}
                                disabled={Boolean(ttsModelBusyKey)}
                                onClick={() => void runLocalTtsModelAction(candidate, selectedStatus.loaded ? "unload-model" : "load-model", selectedStatus)}
                              >
                                {ttsModelBusyKey.includes(selectedStatus.providerId) ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
                                {selectedStatus.loaded ? "Unload selected" : "Load selected"}
                              </Btn>
                            ) : null}
                          </div>
                          {loadedProviders.filter((status) => status.providerId !== selectedStatus?.providerId).length ? (
                            <div className={styles.localTtsLoadedList}>
                              {loadedProviders.filter((status) => status.providerId !== selectedStatus?.providerId).map((status) => (
                                <Btn
                                  key={status.providerId}
                                  sm
                                  variant="ghost"
                                  disabled={Boolean(ttsModelBusyKey)}
                                  onClick={() => void runLocalTtsModelAction(candidate, "unload-model", status)}
                                >
                                  {ttsModelBusyKey.includes(status.providerId) ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : null}
                                  Unload {status.providerId}
                                </Btn>
                              ))}
                            </div>
                          ) : null}
                          {ttsModelMessage ? <p className={[styles.launchStatus, ttsModelTone === "ok" ? styles.messageOk : ttsModelTone === "error" ? styles.messageError : ""].filter(Boolean).join(" ")}>{ttsModelMessage}</p> : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : localTtsDiscoveryLoading ? null : (
              <div className={styles.localTtsEmpty}>
                <div className="as-info">
                  <Volume2 size={16} className="ic" aria-hidden="true" />
                  <p>No TTS candidates were discovered yet. Start Universal TTS, then refresh this panel.</p>
                </div>
                {localTtsLaunchCandidates.length ? (
                  <section className={styles.localTtsLaunchPanel}>
                    <div className={styles.launchHead}>
                      <div>
                        <strong>Machines that can start TTS</strong>
                        <span>Hivemind Link can request Universal TTS on these reachable hosts.</span>
                      </div>
                    </div>
                    <div className={styles.ttsMachineGrid}>
                      {localTtsLaunchCandidates.map((candidate) => {
                        const resources = machineResourceSummary(candidate);
                        const selectedModel = ttsLaunchModelById[candidate.id] || candidate.preferredModel || candidate.modelHints[0] || "";
                        const badgeTone = candidate.capacity === "ready" ? "live" : candidate.capacity === "limited" ? "danger" : "honey";
                        const modelHintText = candidate.modelHintsSource === "fallback"
                          ? "Default starter models are shown until Universal TTS answers /v1/models."
                          : `${candidate.modelHints.length} models loaded from this machine's /v1/models roster.`;
                        return (
                          <article key={candidate.id} className={styles.ttsMachineCard} data-capacity={candidate.capacity}>
                            <div className={styles.ttsMachineTop}>
                              <span className={styles.ttsMachineIcon}><Server size={16} aria-hidden="true" /></span>
                              <div>
                                <strong>{candidate.machineName}</strong>
                                <small>{candidate.collectorStatus === "ready" ? "Hivemind Link ready" : `Collector ${candidate.collectorStatus}`}</small>
                              </div>
                              <Badge tone={candidate.canStart ? badgeTone : "plain"}>{candidate.capacityLabel}</Badge>
                            </div>
                            <dl className={styles.resourceStrip}>
                              <div><dt><Cpu size={12} aria-hidden="true" />CPU</dt><dd>{resources.cpu}</dd></div>
                              <div><dt><MemoryStick size={12} aria-hidden="true" />RAM</dt><dd>{resources.ram}</dd></div>
                              <div><dt><HardDrive size={12} aria-hidden="true" />Disk</dt><dd>{resources.disk}</dd></div>
                              <div><dt><Server size={12} aria-hidden="true" />OS</dt><dd>{resources.platform}</dd></div>
                            </dl>
                            <p className={styles.capacityLine}>{candidate.capacityDetail}</p>
                            <div className={styles.ttsLaunchActions}>
                              <Btn
                                sm
                                disabled={!candidate.canStart || ttsLaunchBusyId === candidate.id}
                                onClick={() => setTtsLaunchPickerId(ttsLaunchPickerId === candidate.id ? "" : candidate.id)}
                              >
                                {ttsLaunchBusyId === candidate.id ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                                Enable
                              </Btn>
                              {ttsLaunchPickerId === candidate.id ? (
                                <div className={styles.ttsModelPopover} role="tooltip">
                                  {candidate.modelHints.length ? (
                                    <Field label="Model to load">
                                      <select className="fb-select" value={selectedModel} onChange={(event) => updateLaunchModel(candidate.id, event.target.value)}>
                                        {candidate.modelHints.map((model) => <option value={model} key={model}>{model}</option>)}
                                      </select>
                                    </Field>
                                  ) : (
                                    <p className={styles.ttsPopoverHint}>Model choices load after the service reports its device roster.</p>
                                  )}
                                  <p className={styles.ttsPopoverHint}>{modelHintText}</p>
                                  <Btn variant="primary" sm disabled={!candidate.canStart || ttsLaunchBusyId === candidate.id} onClick={() => void enableLocalTtsCandidate(candidate)}>
                                    {ttsLaunchBusyId === candidate.id ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
                                    Start TTS
                                  </Btn>
                                </div>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    {ttsLaunchMessage ? <p className={[styles.launchStatus, ttsLaunchTone === "ok" ? styles.messageOk : ttsLaunchTone === "error" ? styles.messageError : ""].filter(Boolean).join(" ")}>{ttsLaunchMessage}</p> : null}
                  </section>
                ) : null}
              </div>
            )}
            </>
          ) : null}

          <div className={styles.quietGrid}>
            <article className={styles.eventRow} data-on={agentCallSettings.quietHoursEnabled ? "" : undefined}>
              <span className={styles.eventIcon}><Shield size={16} aria-hidden="true" /></span>
              <div className={styles.meta}>
                <div className={styles.eventTitle}>Quiet hours</div>
                <div className={styles.eventSub}>Hold calls during the quiet window.</div>
              </div>
              <Toggle on={agentCallSettings.quietHoursEnabled} onChange={() => updateAgentCalls({ quietHoursEnabled: !agentCallSettings.quietHoursEnabled })} />
            </article>
            <Field label="From">
              <input type="time" className="fb-field fb-mono" value={agentCallSettings.quietHoursStart} disabled={!agentCallSettings.quietHoursEnabled} onChange={(event) => updateAgentCalls({ quietHoursStart: event.target.value })} />
            </Field>
            <Field label="To">
              <input type="time" className="fb-field fb-mono" value={agentCallSettings.quietHoursEnd} disabled={!agentCallSettings.quietHoursEnabled} onChange={(event) => updateAgentCalls({ quietHoursEnd: event.target.value })} />
            </Field>
            <Field label="Max calls / day">
              <input type="number" className="fb-field fb-mono" min="0" max="20" value={agentCallSettings.maxCallsPerDay} onChange={(event) => updateAgentCalls({ maxCallsPerDay: Number(event.target.value) || 0 })} />
            </Field>
          </div>
          {phoneStatus.apnsConfigured === false && phoneStatus.apnsMissing.length ? (
            <p className={styles.muted}>Gateway push needs {phoneStatus.apnsMissing.join(", ")} for closed-app ringing.</p>
          ) : (
            <p className={styles.muted}>No calls between <code>{agentCallSettings.quietHoursStart}</code> and <code>{agentCallSettings.quietHoursEnd}</code>; triggers queue until the window clears.</p>
          )}
        </section>
      </div>
    </div>
  );
}
