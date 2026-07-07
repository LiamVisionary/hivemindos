"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, HardDrive, PlugZap, RefreshCcw, Volume2 } from "lucide-react";
import { playRealtimePcmStream } from "@/lib/audio/realtime-pcm-stream-player";
import type {
  AgentCallPreferences,
  AgentProfile,
  VoiceChatBrainPreference,
  VoiceChatBrainSource,
  VoiceProviderAuthMode,
} from "@/lib/types/agent-runtime";
import {
  CALL_VOICE_PROVIDER_MATRIX,
  resolveVoiceRuntime,
  transportForKind,
  voiceProviderById,
  voiceProvidersForKind,
  VOICE_RUNTIME_KIND_LABEL,
  VOICE_RUNTIME_KIND_SUBTITLE,
  type VoiceProviderCapability,
  type VoiceRuntimeKind,
} from "@/lib/config/voice-call-providers";
import { Badge, Btn, Field, GroupLabel, iconMark } from "./AgentSettingsModalPrimitives";
import {
  autoAuthMode,
  useVoiceProviderCredentials,
  type ProviderCredentialStatus,
} from "./use-voice-provider-credentials";
import type { LocalTtsCandidate, LocalTtsLaunchCandidate, LocalTtsModelStatus } from "./agent-settings-calls-data";
import { machineResourceSummary, normalizeDisplayName } from "./agent-settings-calls-data";
import styles from "./AgentSettingsCallsPanel.module.css";

// Providers the pipeline voice brain can call directly. Grok/xAI is a brain-only
// provider (no realtime/TTS API); openai-oauth = the ChatGPT subscription.
const BRAIN_PROVIDER_OPTIONS = [
  { slug: "openai-oauth", name: "OpenAI (ChatGPT)" },
  { slug: "openai-api", name: "OpenAI (API key)" },
  { slug: "xai", name: "Grok (xAI)" },
  { slug: "gemini", name: "Gemini" },
  { slug: "groq", name: "Groq" },
  { slug: "venice", name: "Venice" },
];

const RUNTIME_KINDS: VoiceRuntimeKind[] = ["realtime-hybrid", "cloud-tts", "local-tts"];

// Pipeline kinds split hearing/thinking/speaking, so the chat brain is
// configurable; the realtime hybrid bundles the brain into the voice model.
const PIPELINE_KINDS = new Set<VoiceRuntimeKind>(["cloud-tts", "local-tts"]);

export type AgentSettingsCallsVoiceSectionProps = {
  agentCallSettings: AgentCallPreferences;
  updateAgentCalls: (patch: Partial<AgentCallPreferences>) => void;
  roleModalAgent: AgentProfile | null;
  localTtsCandidates: LocalTtsCandidate[];
  localTtsLaunchCandidates: LocalTtsLaunchCandidate[];
  localTtsDiscoveryStatus: "idle" | "loading" | "ready" | "error";
  localTtsDiscoveryError: string;
  refreshCallConnectionState: () => Promise<{
    localTtsCandidates: LocalTtsCandidate[];
    localTtsLaunchCandidates: LocalTtsLaunchCandidate[];
  }>;
};

export function AgentSettingsCallsVoiceSection(props: AgentSettingsCallsVoiceSectionProps) {
  const {
    agentCallSettings,
    updateAgentCalls,
    roleModalAgent,
    localTtsCandidates,
    localTtsLaunchCandidates,
    localTtsDiscoveryStatus,
    localTtsDiscoveryError,
    refreshCallConnectionState,
  } = props;

  const resolved = resolveVoiceRuntime(agentCallSettings.voiceRuntime);
  const kind = resolved.kind;
  const selectedProvider = resolved.provider;
  const selectedTransport = resolved.transport;
  const isPipeline = PIPELINE_KINDS.has(kind);
  const isLocalTts = kind === "local-tts";

  const credentialsState = useVoiceProviderCredentials(true);
  const { credentials, oauthBusyProvider, oauthAuthorizeUrl, saveKey, connectOauth, error: credentialError } = credentialsState;

  const [advanced, setAdvanced] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [localTtsBusyKey, setLocalTtsBusyKey] = useState("");
  const [localTtsMessage, setLocalTtsMessage] = useState("");
  const [localTtsTone, setLocalTtsTone] = useState<"ok" | "error" | "muted">("muted");
  const [launchBusyId, setLaunchBusyId] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewAbortRef = useRef<AbortController | null>(null);

  const localTtsDiscoveryLoading = localTtsDiscoveryStatus === "loading";

  // ---- Runtime + provider selection -------------------------------------
  const setKindProvider = (nextKind: VoiceRuntimeKind, provider: VoiceProviderCapability | undefined) => {
    if (nextKind === "local-tts") {
      selectFirstLocalTts();
      return;
    }
    const transport = provider ? transportForKind(provider, nextKind) : undefined;
    if (!provider || !transport) return;
    updateAgentCalls({
      voiceRuntime: transport.runtimeId,
      voiceProviderId: provider.id,
      voiceModelId: transport.defaultModel,
      voiceId: transport.voices[0]?.id ?? "",
      // Re-derive the auth mode + key choice for the freshly selected provider.
      voiceAuthMode: undefined,
      voiceKeyEnv: undefined,
    });
  };

  const pickKind = (nextKind: VoiceRuntimeKind) => {
    if (nextKind === kind) return;
    if (nextKind === "local-tts") {
      selectFirstLocalTts();
      return;
    }
    // Keep the current provider if it offers a transport for the new kind.
    const keep = selectedProvider && transportForKind(selectedProvider, nextKind) ? selectedProvider : undefined;
    setKindProvider(nextKind, keep ?? voiceProvidersForKind(nextKind)[0]);
  };

  const pickProvider = (provider: VoiceProviderCapability) => setKindProvider(kind, provider);

  // ---- Auth mode (OAuth vs API key) -------------------------------------
  const status: ProviderCredentialStatus | undefined = selectedProvider ? credentials[selectedProvider.id] : undefined;
  const effectiveAuthMode: VoiceProviderAuthMode = agentCallSettings.voiceAuthMode ?? autoAuthMode(status);
  const setAuthMode = (mode: VoiceProviderAuthMode) => updateAgentCalls({ voiceAuthMode: mode });

  const onSaveKey = async () => {
    if (!selectedProvider || !keyDraft.trim()) return;
    setKeySaving(true);
    const result = await saveKey(selectedProvider.id, keyDraft.trim());
    setKeySaving(false);
    if (result.ok) setKeyDraft("");
  };

  // ---- Chat brain (pipeline runtimes) -----------------------------------
  const voiceBrainPref = agentCallSettings.voiceChatBrain;
  const brainSource: VoiceChatBrainSource = voiceBrainPref?.source ?? "agent";
  const brainProvider = voiceBrainPref?.provider || "openai-api";
  const brainModel = voiceBrainPref?.model || "";
  const agentBrainModelLabel = [roleModalAgent?.provider, roleModalAgent?.model].filter(Boolean).join(" / ");
  const updateVoiceChatBrain = (patch: Partial<VoiceChatBrainPreference>) => {
    const next: VoiceChatBrainPreference = { source: brainSource, provider: brainProvider, model: brainModel, ...patch };
    updateAgentCalls({ voiceChatBrain: next.source === "agent" ? { source: "agent" } : next });
  };
  const [brainModelOptions, setBrainModelOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!isPipeline || brainSource !== "custom") return;
    let cancelled = false;
    void fetch(`/api/providers/models?provider=${encodeURIComponent(brainProvider)}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { models?: Array<{ id: string }> } | null) => {
        if (!cancelled) setBrainModelOptions((data?.models ?? []).map((model) => model.id).filter(Boolean));
      })
      .catch(() => {
        if (!cancelled) setBrainModelOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isPipeline, brainSource, brainProvider]);

  // ---- Local TTS --------------------------------------------------------
  const okLocalTtsCandidates = localTtsCandidates.filter((candidate) => candidate.ok);
  const selectedLocalTtsCandidate =
    localTtsCandidates.find((candidate) => candidate.id === agentCallSettings.voiceProviderId) ??
    (isLocalTts && okLocalTtsCandidates.length === 1 ? okLocalTtsCandidates[0] : undefined);
  const selectedLocalTtsModel = agentCallSettings.voiceModelId || selectedLocalTtsCandidate?.model || "";
  const selectedLocalTtsVoice = agentCallSettings.voiceId || selectedLocalTtsCandidate?.voice || "";

  function selectFirstLocalTts() {
    const candidate = selectedLocalTtsCandidate ?? okLocalTtsCandidates[0];
    if (candidate) {
      updateAgentCalls({
        voiceRuntime: "local-tts",
        voiceProviderId: candidate.id,
        voiceModelId: agentCallSettings.voiceModelId || candidate.model,
        voiceId: agentCallSettings.voiceId || candidate.voice,
        voiceAuthMode: undefined,
      });
    } else {
      updateAgentCalls({ voiceRuntime: "local-tts", voiceAuthMode: undefined });
    }
  }

  const selectLocalTtsCandidate = (candidate: LocalTtsCandidate, overrides?: { model?: string; voice?: string }) => {
    if (!candidate.ok) return;
    updateAgentCalls({
      voiceRuntime: "local-tts",
      voiceProviderId: candidate.id,
      voiceModelId: overrides?.model || candidate.model,
      voiceId: overrides?.voice || candidate.voice,
    });
  };
  const updateLocalTtsModel = (model: string, candidate = selectedLocalTtsCandidate) =>
    updateAgentCalls({
      voiceRuntime: "local-tts",
      voiceProviderId: candidate?.id ?? agentCallSettings.voiceProviderId,
      voiceModelId: model,
      voiceId: agentCallSettings.voiceId || candidate?.voice,
    });
  const updateLocalTtsVoice = (voice: string, candidate = selectedLocalTtsCandidate) =>
    updateAgentCalls({
      voiceRuntime: "local-tts",
      voiceProviderId: candidate?.id ?? agentCallSettings.voiceProviderId,
      voiceModelId: agentCallSettings.voiceModelId || candidate?.model,
      voiceId: voice,
    });

  const localTtsModelStatus = (candidate: LocalTtsCandidate, model: string) =>
    candidate.availableModelDetails.find((item) => item.id === model);

  const runLocalTtsModelAction = async (candidate: LocalTtsCandidate, action: "load-model" | "unload-model", modelStatus: LocalTtsModelStatus) => {
    const busyKey = `${candidate.appId}:${modelStatus.providerId}:${action}`;
    setLocalTtsBusyKey(busyKey);
    setLocalTtsMessage(action === "load-model" ? `Loading ${modelStatus.id}...` : `Unloading ${modelStatus.providerId}...`);
    setLocalTtsTone("muted");
    try {
      const response = await fetch("/api/phone/local-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, appId: candidate.appId, model: modelStatus.id, providerId: modelStatus.providerId }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Local TTS model action failed.");
      if (action === "load-model") updateLocalTtsModel(modelStatus.id, candidate);
      setLocalTtsTone("ok");
      setLocalTtsMessage(
        action === "load-model"
          ? `${modelStatus.id} is loading on ${candidate.machineName || candidate.name}.`
          : `${modelStatus.providerId} unload requested.`,
      );
      await refreshCallConnectionState();
    } catch (actionError) {
      setLocalTtsTone("error");
      setLocalTtsMessage(actionError instanceof Error ? actionError.message : "Local TTS model action failed.");
    } finally {
      setLocalTtsBusyKey("");
    }
  };

  const changeLocalTtsModel = async (candidate: LocalTtsCandidate, model: string) => {
    updateLocalTtsModel(model, candidate);
    const modelStatus = localTtsModelStatus(candidate, model);
    if (!modelStatus || modelStatus.loaded) {
      setLocalTtsTone("ok");
      setLocalTtsMessage(modelStatus ? `${model} selected.` : `${model} selected.`);
      return;
    }
    await runLocalTtsModelAction(candidate, "load-model", modelStatus);
  };

  const enableLocalTtsCandidate = async (candidate: LocalTtsLaunchCandidate) => {
    setLaunchBusyId(candidate.id);
    setLocalTtsMessage("");
    setLocalTtsTone("muted");
    try {
      const response = await fetch("/api/phone/local-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-service", collectorUrl: candidate.collectorUrl }),
      });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Local TTS could not be started.");
      const refreshed = await refreshCallConnectionState();
      const machineName = normalizeDisplayName(candidate.machineName);
      const started =
        refreshed.localTtsCandidates.find((item) => item.ok && normalizeDisplayName(item.machineName) === machineName) ??
        refreshed.localTtsCandidates.find((item) => item.ok);
      if (started) selectLocalTtsCandidate(started, { model: started.model, voice: started.voice });
      setLocalTtsTone("ok");
      setLocalTtsMessage(started ? "Local TTS is running." : "TTS start requested. Refresh if the model list is still warming up.");
    } catch (launchError) {
      setLocalTtsTone("error");
      setLocalTtsMessage(launchError instanceof Error ? launchError.message : "Local TTS could not be started.");
    } finally {
      setLaunchBusyId("");
    }
  };

  // ---- Voice options ----------------------------------------------------
  const voiceOptions = isLocalTts
    ? [selectedLocalTtsVoice, ...(selectedLocalTtsCandidate?.availableVoices ?? [])]
        .filter((voice, index, list): voice is string => Boolean(voice) && list.indexOf(voice) === index)
        .map((voice) => ({ id: voice, label: voice }))
    : selectedTransport?.voices ?? [];
  const selectedVoiceId = isLocalTts ? selectedLocalTtsVoice : agentCallSettings.voiceId || voiceOptions[0]?.id || "";
  const voiceChipLabel = `${VOICE_RUNTIME_KIND_LABEL[kind]} · ${selectedVoiceId || "default"}`;

  // Play a short spoken sample of the selected voice. Cloud providers synth via
  // /api/phone/cloud-voice; local TTS reuses the existing speech-stream action.
  const previewVoice = async () => {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewBusy(true);
    setPreviewError("");
    const sampleText = "Hi, this is a quick preview of how I sound on your HivemindOS calls.";
    try {
      let response: Response;
      let sampleRate = 24_000;
      if (isLocalTts) {
        const candidate = selectedLocalTtsCandidate;
        if (!candidate?.ok) throw new Error("Select a validated Local TTS host first.");
        response = await fetch("/api/phone", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "local-tts-speech-stream",
            localTts: {
              provider: "local-tts",
              appId: candidate.appId,
              appName: candidate.name,
              machineName: candidate.machineName,
              model: selectedLocalTtsModel || candidate.model,
              voice: selectedLocalTtsVoice || candidate.voice,
              sampleRate: candidate.sampleRate,
              channels: 1,
              sampleFormat: candidate.sampleFormat,
              streamingKind: candidate.streamingKind,
              streamingImplementation: candidate.streamingImplementation,
              openingLine: "",
            },
            input: sampleText,
            utteranceId: `preview_${Date.now()}`,
          }),
          signal: controller.signal,
        });
        sampleRate = candidate.sampleRate || 24_000;
      } else {
        if (!selectedProvider) throw new Error("Select a provider first.");
        response = await fetch("/api/phone/cloud-voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "voice-preview",
            provider: selectedProvider.id,
            voice: selectedVoiceId,
            model: selectedTransport?.defaultModel,
            keyEnv: agentCallSettings.voiceKeyEnv,
            text: sampleText,
          }),
          signal: controller.signal,
        });
        sampleRate = Number(response.headers.get("x-pcm-sample-rate")) || 24_000;
      }
      if (!response.ok || !response.body) {
        throw new Error((await response.text().catch(() => "")) || `Voice preview returned HTTP ${response.status}.`);
      }
      await playRealtimePcmStream(response, { channels: 1, sampleRate, signal: controller.signal, startedAt: Date.now() });
    } catch (error) {
      if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : "Voice preview failed.");
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
      setPreviewBusy(false);
    }
  };

  return (
    <section className={styles.voiceBlock}>
      <div className={styles.voiceHead}>
        <span className="fb-eyebrow">Voice</span>
        <span className={styles.voiceChip}>
          <Volume2 size={11} aria-hidden="true" />
          {voiceChipLabel}
        </span>
      </div>

      {/* Runtime kind */}
      <div className={styles.pickerGroup}>
        <span className={styles.pickerLabel}>Runtime</span>
        <div className={styles.segmented}>
          {RUNTIME_KINDS.map((runtimeKind) => (
            <button
              key={runtimeKind}
              type="button"
              className={styles.segTab}
              data-on={runtimeKind === kind ? "" : undefined}
              onClick={() => pickKind(runtimeKind)}
            >
              {VOICE_RUNTIME_KIND_LABEL[runtimeKind]}
            </button>
          ))}
        </div>
        <span className={styles.pickerHint}>{VOICE_RUNTIME_KIND_SUBTITLE[kind]}</span>
      </div>

      {/* Provider cards + auth (realtime hybrid / cloud TTS) */}
      {kind !== "local-tts" ? (
        <div className={styles.pickerGroup}>
          <span className={styles.pickerLabel}>{kind === "cloud-tts" ? "TTS provider" : "Voice provider"}</span>
          <div className={styles.providerGrid}>
            {voiceProvidersForKind(kind).map((provider) => {
              const transport = transportForKind(provider, kind);
              const selected = provider.id === selectedProvider?.id;
              return (
                <button
                  key={provider.id}
                  type="button"
                  className={styles.providerCard}
                  data-selected={selected ? "" : undefined}
                  onClick={() => pickProvider(provider)}
                >
                  <span className={styles.providerCardHead}>
                    {iconMark({ label: provider.name, iconPath: provider.iconPath, iconMode: provider.iconMode, fallback: provider.fallback })}
                    <strong>{provider.name}</strong>
                    {transport?.status === "preview" ? <Badge tone="honey">Preview</Badge> : null}
                  </span>
                  <span className={styles.providerCardSub}>{transport?.subtitle}</span>
                </button>
              );
            })}
          </div>
          {selectedProvider ? renderAuthBlock(selectedProvider) : null}
          {selectedTransport?.status === "preview" ? (
            <div className="as-info">
              <PlugZap size={16} className="ic" aria-hidden="true" />
              <p>
                {selectedProvider?.name} voice is in preview — save the key and it is selected, but the live call transport is
                still being verified. OpenAI realtime is the fully working path today.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Voice + chat brain */}
      <div className={styles.voiceGrid}>
        <Field label="Voice">
          <div className={styles.voiceRow}>
            <select
              className="fb-select"
              value={selectedVoiceId}
              disabled={!voiceOptions.length}
              onChange={(event) => (isLocalTts ? updateLocalTtsVoice(event.target.value) : updateAgentCalls({ voiceId: event.target.value }))}
            >
              {voiceOptions.length ? (
                voiceOptions.map((voice) => (
                  <option value={voice.id} key={voice.id || "default"}>
                    {voice.label}
                  </option>
                ))
              ) : (
                <option value="">No voices discovered</option>
              )}
            </select>
            <Btn sm disabled={previewBusy || (isLocalTts && !selectedLocalTtsCandidate?.ok)} onClick={() => void previewVoice()}>
              {previewBusy ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
              {previewBusy ? "Playing" : "Preview"}
            </Btn>
          </div>
          {previewError ? <small className={styles.messageError}>{previewError}</small> : null}
        </Field>
        {isPipeline ? (
          <Field label="Chat brain">
            {/* DOM boundary: option values are exactly the VoiceChatBrainSource union. */}
            <select
              className="fb-select"
              value={brainSource}
              onChange={(event) => updateVoiceChatBrain({ source: event.target.value as VoiceChatBrainSource })}
            >
              <option value="agent">{agentBrainModelLabel ? `Agent's model (${agentBrainModelLabel})` : "Agent's model"}</option>
              <option value="custom">Custom model…</option>
              <option value="fleet-agent">Fleet agent (auto)</option>
            </select>
          </Field>
        ) : null}
      </div>

      {/* Local TTS host list */}
      {isLocalTts ? (
        <div className={styles.localTtsHosts}>
          <div className={styles.localTtsHostsHead}>
            <span>Local TTS host</span>
            {okLocalTtsCandidates.length ? <Badge tone="live">{okLocalTtsCandidates.length} validated</Badge> : null}
          </div>
          {localTtsDiscoveryLoading ? (
            <div className={styles.localTtsLoading} role="status" aria-live="polite">
              <RefreshCcw size={16} className="animate-spin" aria-hidden="true" />
              <div>
                <strong>Checking Local TTS availability</strong>
                <span>Scanning Hivemind Link machines, Universal TTS services, and voices.</span>
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
          {localTtsCandidates.map((candidate) => {
            const selected = candidate.id === selectedLocalTtsCandidate?.id;
            const modelOptions = [selected ? selectedLocalTtsModel : candidate.model, ...candidate.availableModels].filter(
              (model, index, list): model is string => Boolean(model) && list.indexOf(model) === index,
            );
            const modelStatus = localTtsModelStatus(candidate, selected ? selectedLocalTtsModel : candidate.model);
            return (
              <div key={candidate.id} className={styles.localTtsHostRow} data-selected={selected ? "" : undefined} data-off={!candidate.ok ? "" : undefined}>
                <button type="button" className={styles.localTtsHostPick} disabled={!candidate.ok} onClick={() => selectLocalTtsCandidate(candidate)}>
                  <span className={styles.localTtsHostIcon}>
                    <HardDrive size={15} aria-hidden="true" />
                  </span>
                  <span className={styles.localTtsHostMeta}>
                    <strong>{candidate.name}</strong>
                    <small>
                      {[candidate.machineName, candidate.port ? `port ${candidate.port}` : "", candidate.ok ? "" : "unavailable"]
                        .filter(Boolean)
                        .join(" · ") || "Connected app"}
                    </small>
                  </span>
                  {selected ? <span className={styles.localTtsCheck} aria-hidden="true">✓</span> : null}
                </button>
                {selected && candidate.ok ? (
                  <div className={styles.localTtsHostControls}>
                    <Field label="Model">
                      <select className="fb-select" value={selectedLocalTtsModel} disabled={Boolean(localTtsBusyKey)} onChange={(event) => void changeLocalTtsModel(candidate, event.target.value)}>
                        {modelOptions.map((model) => (
                          <option value={model} key={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className={styles.localTtsHostState}>
                      <span>{modelStatus ? `${modelStatus.providerId} ${modelStatus.loaded ? "loaded" : "not loaded"}` : "Load state unavailable"}</span>
                      {modelStatus ? (
                        <Btn
                          sm
                          variant={modelStatus.loaded ? "ghost" : "primary"}
                          disabled={Boolean(localTtsBusyKey)}
                          onClick={() => void runLocalTtsModelAction(candidate, modelStatus.loaded ? "unload-model" : "load-model", modelStatus)}
                        >
                          {localTtsBusyKey.includes(modelStatus.providerId) ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
                          {modelStatus.loaded ? "Unload" : "Load"}
                        </Btn>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!localTtsCandidates.length && !localTtsDiscoveryLoading ? (
            <div className="as-info">
              <Volume2 size={16} className="ic" aria-hidden="true" />
              <p>No TTS candidates discovered yet. Start Universal TTS on a fleet machine, then refresh.</p>
            </div>
          ) : null}
          {localTtsLaunchCandidates.length && !okLocalTtsCandidates.length ? (
            <div className={styles.localTtsLaunchRows}>
              {localTtsLaunchCandidates.map((candidate) => {
                const resources = machineResourceSummary(candidate);
                return (
                  <div key={candidate.id} className={styles.localTtsHostRow}>
                    <span className={styles.localTtsHostMeta}>
                      <strong>{candidate.machineName}</strong>
                      <small>
                        {candidate.capacityLabel} · {resources.ram}
                      </small>
                    </span>
                    <Btn sm variant="primary" disabled={!candidate.canStart || launchBusyId === candidate.id} onClick={() => void enableLocalTtsCandidate(candidate)}>
                      {launchBusyId === candidate.id ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
                      Start TTS
                    </Btn>
                  </div>
                );
              })}
            </div>
          ) : null}
          {localTtsMessage ? (
            <p className={["as-status", localTtsTone === "ok" ? styles.messageOk : localTtsTone === "error" ? styles.messageError : ""].filter(Boolean).join(" ")}>{localTtsMessage}</p>
          ) : null}
        </div>
      ) : null}

      {/* Advanced brain settings */}
      <div className={styles.advanced}>
        <button type="button" className={styles.advancedToggle} onClick={() => setAdvanced((current) => !current)}>
          <ChevronDown size={14} className={styles.advancedChevron} data-open={advanced ? "" : undefined} aria-hidden="true" />
          <span>Advanced brain settings</span>
          <span className={styles.advancedSummary}>{isPipeline ? "brain override" : "realtime hybrid"}</span>
        </button>
        {advanced ? (
          isPipeline && brainSource === "custom" ? (
            <div className={styles.voiceGrid}>
              <Field label="Brain provider">
                <select className="fb-select" value={brainProvider} onChange={(event) => updateVoiceChatBrain({ provider: event.target.value, model: "" })}>
                  {BRAIN_PROVIDER_OPTIONS.map((option) => (
                    <option value={option.slug} key={option.slug}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Brain model">
                {brainModelOptions.length ? (
                  <select className="fb-select" value={brainModel} onChange={(event) => updateVoiceChatBrain({ model: event.target.value })}>
                    {!brainModel ? <option value="">Pick a model…</option> : null}
                    {[brainModel, ...brainModelOptions]
                      .filter((model, index, list) => model && list.indexOf(model) === index)
                      .map((model) => (
                        <option value={model} key={model}>
                          {model}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input className="fb-field fb-mono" value={brainModel} placeholder="model id (e.g. gpt-5.5)" onChange={(event) => updateVoiceChatBrain({ model: event.target.value })} />
                )}
              </Field>
            </div>
          ) : (
            <div className="as-info">
              <PlugZap size={16} className="ic" aria-hidden="true" />
              <p>
                {isPipeline
                  ? "The chat brain answers spoken turns; pick “Custom model…” above to pin a specific provider/model."
                  : "The realtime hybrid bundles the brain into the voice model, so there is no separate chat brain to configure."}
              </p>
            </div>
          )
        ) : null}
      </div>
    </section>
  );

  // ---- Auth block renderer ----------------------------------------------
  function renderAuthBlock(provider: VoiceProviderCapability) {
    const authStatus = credentials[provider.id];
    const oauthCapable = Boolean(provider.oauth);
    const oauthConnected = Boolean(authStatus?.oauthConnected);
    const keyPresent = Boolean(authStatus?.keyPresent);
    const oauthBusy = oauthBusyProvider === provider.id;
    return (
      <div className={styles.authBlock}>
        <div className={styles.authHead}>
          <span className="fb-eyebrow">{provider.name} authentication</span>
          {oauthCapable ? (
            <div className={styles.authTabs}>
              <button type="button" className={styles.authTab} data-on={effectiveAuthMode === "oauth" ? "" : undefined} onClick={() => setAuthMode("oauth")}>
                OAuth
              </button>
              <button type="button" className={styles.authTab} data-on={effectiveAuthMode === "apikey" ? "" : undefined} onClick={() => setAuthMode("apikey")}>
                API key
              </button>
            </div>
          ) : null}
        </div>

        {effectiveAuthMode === "oauth" && oauthConnected ? (
          <div className={styles.authLine} data-tone="live">
            <span className="fr-dot live" />
            Signed in with {provider.name}
            {authStatus?.preferApiKey ? " — overridden to the API key by OPENAI_PREFER_API_KEY." : " — using your account from the hive env."}
          </div>
        ) : null}

        {effectiveAuthMode === "oauth" && !oauthConnected ? (
          <div className={styles.authSignin}>
            <p>Not signed in. Spoken turns fall back to the API key or runtime until you connect {provider.name}.</p>
            <Btn variant="primary" sm disabled={oauthBusy} onClick={() => void connectOauth(provider.id)}>
              {oauthBusy ? "Opening sign-in…" : oauthAuthorizeUrl ? `Retry ${provider.name} sign-in` : `Connect ${provider.name}`}
            </Btn>
            {oauthAuthorizeUrl ? (
              <p>
                Sign-in opened in your browser — finish there; this panel updates by itself.{" "}
                <a href={oauthAuthorizeUrl} target="_blank" rel="noopener noreferrer">
                  Open the sign-in page
                </a>{" "}
                if nothing appeared.
              </p>
            ) : null}
          </div>
        ) : null}

        {effectiveAuthMode === "apikey" && keyPresent ? (
          (() => {
            const presentKeys = authStatus?.presentKeys ?? [];
            const chosenKey = agentCallSettings.voiceKeyEnv && presentKeys.includes(agentCallSettings.voiceKeyEnv)
              ? agentCallSettings.voiceKeyEnv
              : presentKeys[0] ?? provider.apiKeyEnvVars[0];
            return (
              <div className={styles.authKeyChoice}>
                <div className={styles.authLine} data-tone="honey">
                  <span className="fr-dot" />
                  Using the {provider.name} key (<code>{chosenKey}</code>) from your hive env.
                </div>
                {presentKeys.length > 1 ? (
                  <Field label={`${presentKeys.length} ${provider.name} keys found — use`}>
                    <select className="fb-select" value={chosenKey} onChange={(event) => updateAgentCalls({ voiceKeyEnv: event.target.value })}>
                      {presentKeys.map((env) => (
                        <option key={env} value={env}>{env}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>
            );
          })()
        ) : null}

        {effectiveAuthMode === "apikey" && !keyPresent ? (
          <div className={styles.authKeyInput}>
            <span>No {provider.name} key in your hive env — add one to save it fleet-wide.</span>
            <div className={styles.authKeyRow}>
              <input
                className="fb-field fb-mono"
                type="password"
                value={keyDraft}
                placeholder={provider.apiKeyPlaceholder}
                onChange={(event) => setKeyDraft(event.target.value)}
              />
              <Btn variant="primary" sm disabled={keySaving || keyDraft.trim().length < 8} onClick={() => void onSaveKey()}>
                {keySaving ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : null}
                Save
              </Btn>
            </div>
          </div>
        ) : null}
        {credentialError ? <p className="as-error">{credentialError}</p> : null}
      </div>
    );
  }
}
