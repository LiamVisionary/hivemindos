"use client";

import { useEffect, useState } from "react";
import type { ComponentType, Dispatch, ReactNode, SetStateAction } from "react";
import QRCode from "qrcode";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentCreateDraft } from "@/features/dashboard/agent-settings-types";
import type { MachineGroup } from "@/features/dashboard/dashboard-types";
import { buildAgentCallPreferences } from "@/lib/types/agent-runtime";
import { clawMobilePairingUrl, hubUrlForPairingHost } from "@/lib/phone/pairing-url";
import styles from "./AgentCallsSettingsPanel.module.css";

const VOICE_RUNTIME_LABELS: Record<string, string> = {
  "openai-realtime": "OpenAI Realtime",
  "grok-voice": "Grok Voice",
  "gemini-live": "Gemini Live",
  "local-tts": "Local TTS",
};

const CALL_FALLBACK_OPTIONS = [
  { value: "none", label: "None" },
  { value: "in_app", label: "App" },
  { value: "obsidian_note", label: "Obsidian" },
  { value: "telegram", label: "Telegram" },
];

type IconComponent = ComponentType<{ "aria-hidden"?: boolean | "true"; className?: string }>;

type ButtonComponent = ComponentType<{
  type?: "button";
  variant?: "secondary";
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}>;

type VoiceOption = {
  id: string;
  provider: string;
  voice: string;
  model?: string;
  appName?: string;
  machineName?: string;
  source: "configured" | "runtime-default";
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
  voice: string;
  voiceCount?: number;
  supportsTrueStreaming: boolean;
  streamingKind?: string;
  streamingImplementation?: string;
  sampleRate: number;
  channels: number;
  sampleFormat: string;
};

type PhoneStatus = {
  checked: boolean;
  connected: boolean;
  lastSeenAt?: string;
  apnsConfigured?: boolean;
  apnsMissing: string[];
};

type PairingDevice = {
  self?: boolean;
  ip?: string;
  dnsName?: string;
  machineId?: string;
};

type AgentCallsSettingsPanelProps = {
  Button: ButtonComponent;
  LoaderCircle: IconComponent;
  PlugZap: IconComponent;
  RefreshCcw: IconComponent;
  Send: IconComponent;
  agentCreateDraft: AgentCreateDraft;
  agentCreateMachine: MachineGroup | null;
  fleetClass: (...classNames: string[]) => string;
  onQueenClapWakeEnabledChange?: (enabled: boolean) => void;
  queenClapWakeEnabled?: boolean;
  roleModalAgent?: AgentProfile | null;
  setAgentCreateDraft: Dispatch<SetStateAction<AgentCreateDraft>>;
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readVoiceOptions(value: unknown): VoiceOption[] {
  const config = asRecord(asRecord(value)?.config);
  const options = Array.isArray(config?.voiceOptions) ? config.voiceOptions : config?.voiceProviders;
  if (!Array.isArray(options)) return runtimeDefaultVoiceOptions("openai-realtime");
  const configuredOptions: VoiceOption[] = options.flatMap((provider) => {
    const item = asRecord(provider);
    const id = typeof item?.id === "string" ? item.id : "";
    const runtime = typeof item?.provider === "string" ? item.provider : "";
    const voice = typeof item?.voice === "string" ? item.voice : "";
    const model = typeof item?.model === "string" ? item.model : undefined;
    const appName = typeof item?.appName === "string" ? item.appName : undefined;
    const machineName = typeof item?.machineName === "string" ? item.machineName : undefined;
    const source: VoiceOption["source"] = item?.source === "runtime-default" ? "runtime-default" : "configured";
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
      voice: typeof item?.voice === "string" ? item.voice : "voice01",
      voiceCount: typeof item?.voiceCount === "number" ? item.voiceCount : undefined,
      supportsTrueStreaming: item?.supportsTrueStreaming === true,
      streamingKind: typeof item?.streamingKind === "string" ? item.streamingKind : undefined,
      streamingImplementation: typeof item?.streamingImplementation === "string" ? item.streamingImplementation : undefined,
      sampleRate: typeof item?.sampleRate === "number" ? item.sampleRate : 24_000,
      channels: typeof item?.channels === "number" ? item.channels : 1,
      sampleFormat: typeof item?.sampleFormat === "string" ? item.sampleFormat : "pcm16",
    }];
  });
}

function runtimeDefaultVoiceOptions(provider: string): VoiceOption[] {
  return [{
    id: `runtime-default:${provider}`,
    provider,
    voice: "Gateway default",
    source: "runtime-default",
  }];
}

export function AgentCallsSettingsPanel(props: AgentCallsSettingsPanelProps) {
  const {
    Button,
    LoaderCircle,
    PlugZap,
    RefreshCcw,
    Send,
    agentCreateDraft,
    agentCreateMachine,
    fleetClass,
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
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>(() => runtimeDefaultVoiceOptions("openai-realtime"));
  const [localTtsCandidates, setLocalTtsCandidates] = useState<LocalTtsCandidate[]>([]);
  const [callTestBusy, setCallTestBusy] = useState(false);
  const [callTestMessage, setCallTestMessage] = useState("");
  const [callTestTone, setCallTestTone] = useState<"ok" | "error" | "muted">("muted");

  const agentCallSettings = buildAgentCallPreferences(agentCreateMachine ? agentCreateDraft.calls : roleModalAgent?.calls);
  const isQueenSettings = !agentCreateMachine && roleModalAgent?.beeRole === "queen";
  const voiceRuntimeOptions = ["openai-realtime", "local-tts", agentCallSettings.voiceRuntime, ...voiceOptions.map((provider) => provider.provider)]
    .filter((provider, index, list) => provider && list.indexOf(provider) === index);
  const selectedVoiceOptions = voiceOptions.filter((provider) => provider.provider === agentCallSettings.voiceRuntime);
  const selectedVoiceOption = voiceOptions.find((provider) => provider.id === agentCallSettings.voiceProviderId)
    ?? selectedVoiceOptions.find((provider) => provider.voice === agentCallSettings.voiceId)
    ?? selectedVoiceOptions[0]
    ?? runtimeDefaultVoiceOptions(agentCallSettings.voiceRuntime)[0];
  const hasConfiguredVoices = voiceOptions.some((provider) => provider.source === "configured");
  const callTimezone = agentCallSettings.timezone || (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  })();

  const updateAgentCalls = (patch: Record<string, unknown>) => {
    const next = buildAgentCallPreferences({ ...agentCallSettings, ...patch });
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, calls: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { calls: next });
  };

  const updateAgentCallSources = (patch: Record<string, boolean>) => {
    updateAgentCalls({ sources: { ...agentCallSettings.sources, ...patch } });
  };

  const updateAgentVoiceRuntime = (voiceRuntime: string) => {
    const firstVoice = voiceOptions.find((provider) => provider.provider === voiceRuntime)
      ?? runtimeDefaultVoiceOptions(voiceRuntime)[0];
    updateAgentCalls({
      voiceRuntime,
      voiceProviderId: firstVoice.source === "configured" ? firstVoice.id : undefined,
      voiceModelId: firstVoice.source === "configured" ? firstVoice.model : undefined,
      voiceId: firstVoice.source === "configured" ? firstVoice.voice : undefined,
    });
  };

  const updateAgentVoiceProvider = (voiceProviderId: string) => {
    const provider = voiceOptions.find((item) => item.id === voiceProviderId)
      ?? runtimeDefaultVoiceOptions(agentCallSettings.voiceRuntime)[0];
    updateAgentCalls({
      voiceProviderId: provider.source === "configured" ? provider.id : undefined,
      voiceRuntime: provider.provider,
      voiceModelId: provider.source === "configured" ? provider.model : undefined,
      voiceId: provider.source === "configured" ? provider.voice : undefined,
    });
  };

  const selectLocalTtsCandidate = (candidate: LocalTtsCandidate) => {
    if (!candidate.ok) return;
    updateAgentCalls({
      voiceRuntime: "local-tts",
      voiceProviderId: candidate.id,
      voiceModelId: candidate.model,
      voiceId: candidate.voice,
    });
  };

  const refreshCallConnectionState = async () => {
    const [statusResponse, voiceResponse] = await Promise.all([
      fetch("/api/phone?action=device-status", { cache: "no-store" }).catch(() => null),
      fetch("/api/phone?action=voice-config", { cache: "no-store" }).catch(() => null),
    ]);
    const statusData = asRecord(await statusResponse?.json().catch(() => null));
    const voiceData = asRecord(await voiceResponse?.json().catch(() => null));
    const statusResult = asRecord(statusData?.result) ?? statusData;
    const device = asRecord(statusResult?.device);
    const apns = asRecord(statusResult?.apns);
    const missingApns = apns?.missing;
    setPhoneStatus({
      checked: true,
      connected: Boolean(statusResponse?.ok && statusData?.ok !== false && device),
      lastSeenAt: typeof device?.lastSeenAt === "string" ? device.lastSeenAt : undefined,
      apnsConfigured: typeof apns?.configured === "boolean" ? apns.configured : undefined,
      apnsMissing: Array.isArray(missingApns) ? missingApns.filter((item): item is string => typeof item === "string") : [],
    });
    const voicePayload = voiceData?.result ?? voiceData;
    setVoiceOptions(readVoiceOptions(voicePayload));
    setLocalTtsCandidates(readLocalTtsCandidates(voicePayload));
  };

  const buildPairingQr = async () => {
    try {
      const res = await fetch("/api/tailscale/devices", { cache: "no-store" });
      const data = await res.json() as { devices?: PairingDevice[] };
      const devices = data.devices ?? [];
      const self = devices.find((device) => device?.self) ?? devices[0];
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
            voiceProviderId: selectedVoiceOption.source === "configured" ? selectedVoiceOption.id : undefined,
            voiceRuntime: agentCallSettings.voiceRuntime,
            voiceModelId: selectedVoiceOption.source === "configured" ? selectedVoiceOption.model : undefined,
            voiceId: selectedVoiceOption.source === "configured" ? selectedVoiceOption.voice : undefined,
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
      const message = typeof data?.error === "string" ? data.error : "Test call failed.";
      if (!response.ok || data?.ok === false) throw new Error(message);
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
  }, []);

  return (
    <div className={styles.agentCallsPanel}>
      <div className={styles.agentCallsHeader}>
        <div>
          <strong>Voice runtime</strong>
          <p>Calls use the phone gateway's realtime voice layer. The default route is resolved by the gateway; custom voice IDs come from mobile/gateway sync.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void refreshCallConnectionState()}>
          <RefreshCcw aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {isQueenSettings && onQueenClapWakeEnabledChange ? (
        <label className={styles.agentCallToggleRow}>
          <input
            type="checkbox"
            checked={Boolean(queenClapWakeEnabled)}
            onChange={(event) => onQueenClapWakeEnabledChange(event.target.checked)}
          />
          <span>
            <strong>Clap wake</strong>
            <small>Open Queen Bee voice chat when two quick claps are detected locally.</small>
          </span>
        </label>
      ) : null}

      <div className={styles.agentCallVoiceGrid}>
        <label className={fleetClass("agentSettingsField")}>
          <span>Runtime</span>
          <select
            value={agentCallSettings.voiceRuntime}
            onChange={(event) => updateAgentVoiceRuntime(event.target.value)}
          >
            {voiceRuntimeOptions.map((runtime) => (
              <option value={runtime} key={runtime}>{VOICE_RUNTIME_LABELS[runtime] ?? runtime}</option>
            ))}
          </select>
        </label>
        <label className={fleetClass("agentSettingsField")}>
          <span>Voice</span>
          <select
            value={selectedVoiceOption.id}
            onChange={(event) => updateAgentVoiceProvider(event.target.value)}
          >
            {selectedVoiceOptions.map((provider) => (
              <option value={provider.id} key={provider.id}>
                {(VOICE_RUNTIME_LABELS[provider.provider] ?? provider.provider)} · {provider.voice}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!hasConfiguredVoices ? (
        <div className={fleetClass("agentSettingsInfo")}>
          <PlugZap aria-hidden="true" />
          <p>Using the gateway-resolved default voice. Add or sync custom voices in Hivemind Mobile Settings → Calls when you want an explicit provider voice.</p>
        </div>
      ) : null}

      {agentCallSettings.voiceRuntime === "local-tts" ? (
        <section className={styles.localTtsSection}>
          <div className={styles.localTtsSectionHeader}>
            <strong>TTS server candidates</strong>
            <span>{localTtsCandidates.filter((candidate) => candidate.ok).length} validated</span>
          </div>
          {localTtsCandidates.length ? (
            <div className={styles.localTtsGrid}>
              {localTtsCandidates.map((candidate) => {
                const selected = candidate.id === agentCallSettings.voiceProviderId;
                return (
                  <button
                    type="button"
                    key={candidate.id}
                    className={`${styles.localTtsCard} ${selected ? styles.localTtsCardSelected : ""}`}
                    disabled={!candidate.ok}
                    onClick={() => selectLocalTtsCandidate(candidate)}
                  >
                    <span className={candidate.ok ? styles.localTtsStatusOk : styles.localTtsStatusError}>
                      {candidate.ok ? "Validated" : "Unavailable"}
                    </span>
                    <strong>{candidate.name}</strong>
                    <small>{[candidate.machineName, candidate.port ? `port ${candidate.port}` : ""].filter(Boolean).join(" · ") || "Connected app"}</small>
                    <dl>
                      <div><dt>Model</dt><dd>{candidate.model}</dd></div>
                      <div><dt>Voice</dt><dd>{candidate.voice}</dd></div>
                      <div><dt>Stream</dt><dd>{candidate.sampleFormat} · {candidate.sampleRate} Hz</dd></div>
                      <div><dt>Engine</dt><dd>{candidate.streamingImplementation || candidate.streamingKind || "streaming"}</dd></div>
                    </dl>
                    {candidate.voiceCount ? <em>{candidate.voiceCount} voices</em> : null}
                    {!candidate.ok && candidate.error ? <p>{candidate.error}</p> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={fleetClass("agentSettingsInfo")}>
              <PlugZap aria-hidden="true" />
              <p>No TTS candidates were discovered yet. Start Universal TTS, then refresh this panel.</p>
            </div>
          )}
        </section>
      ) : null}

      {!phoneStatus.connected ? (
        <section className={styles.agentPhoneSetupCard}>
          <div className={styles.agentPhoneSetupCopy}>
            <span>Schedule agent calls directly to your phone</span>
            <strong>Connect Claw Code Mobile</strong>
            <p>Your phone scans the same pairing code from <code>/connect-phone</code>, then the gateway can ring the device for scheduled agent calls.</p>
          </div>
          <ol className={styles.agentPhoneSteps}>
            <li>
              <b>1</b>
              <div>
                <strong>Download Claw Code Mobile</strong>
                <p>Install the mobile app on the device you want agents to call.</p>
              </div>
            </li>
            <li>
              <b>2</b>
              <div>
                <strong>Open Settings → Connection → Scan this QR Code</strong>
                {phoneConnectError ? <p className={styles.agentPhoneError}>{phoneConnectError}</p> : phoneQr ? (
                  <div className={styles.agentPhoneQrWrap}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={phoneQr} alt="Claw Code Mobile pairing QR" />
                    <code>{phoneHubUrl}</code>
                  </div>
                ) : <p>Generating pairing code...</p>}
              </div>
            </li>
          </ol>
        </section>
      ) : (
        <section className={styles.agentCallScheduleCard}>
          <div className={styles.agentCallScheduleTop}>
            <div>
              <span>{phoneStatus.apnsConfigured === false ? "Phone connected · push setup pending" : "Phone connected"}</span>
              <strong>{phoneStatus.lastSeenAt ? `Last seen ${new Date(phoneStatus.lastSeenAt).toLocaleString()}` : "Ready for scheduled calls"}</strong>
            </div>
            <label className={styles.agentCallSwitch}>
              <input
                type="checkbox"
                checked={agentCallSettings.enabled}
                onChange={(event) => updateAgentCalls({ enabled: event.target.checked })}
              />
              <span>{agentCallSettings.enabled ? "On" : "Off"}</span>
            </label>
          </div>
          {phoneStatus.apnsConfigured === false && phoneStatus.apnsMissing.length ? (
            <p className={styles.agentCallMuted}>Gateway push needs {phoneStatus.apnsMissing.join(", ")} for closed-app ringing.</p>
          ) : null}
          <div className={styles.agentCallScheduleControls}>
            <label className={styles.agentCallToggleRow}>
              <input
                type="checkbox"
                checked={agentCallSettings.dailyEnabled}
                onChange={(event) => updateAgentCalls({ dailyEnabled: event.target.checked })}
              />
              <span>
                <strong>Daily check-in</strong>
                <small>Ring once per day with this agent's status.</small>
              </span>
            </label>
            <label className={fleetClass("agentSettingsField")}>
              <span>Call time</span>
              <input
                type="time"
                value={agentCallSettings.dailyCallTime}
                disabled={!agentCallSettings.dailyEnabled}
                onChange={(event) => updateAgentCalls({ dailyCallTime: event.target.value })}
              />
            </label>
          </div>
          <p className={styles.agentCallMuted}>Times use {callTimezone}.</p>
          <div className={styles.agentCallTestRow}>
            <Button type="button" variant="secondary" disabled={callTestBusy} onClick={() => void requestAgentTestCall()}>
              {callTestBusy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
              {callTestBusy ? "Requesting..." : "Test call"}
            </Button>
            {callTestMessage ? <span className={`${styles.agentCallTestMessage} ${styles[callTestTone] ?? ""}`}>{callTestMessage}</span> : null}
          </div>
        </section>
      )}

      <details className={`${fleetClass("adaptiveAdvanced")} ${styles.agentCallAdvanced}`}>
        <summary>
          <span>Advanced</span>
          <small>{agentCallSettings.maxCallsPerDay} / day</small>
        </summary>
        <div className={styles.agentCallAdvancedGrid}>
          <label className={styles.agentCallToggleRow}>
            <input
              type="checkbox"
              checked={agentCallSettings.quietHoursEnabled}
              onChange={(event) => updateAgentCalls({ quietHoursEnabled: event.target.checked })}
            />
            <span>
              <strong>Quiet hours</strong>
              <small>Hold calls during the quiet window.</small>
            </span>
          </label>
          <label className={fleetClass("agentSettingsField")}>
            <span>From</span>
            <input
              type="time"
              value={agentCallSettings.quietHoursStart}
              disabled={!agentCallSettings.quietHoursEnabled}
              onChange={(event) => updateAgentCalls({ quietHoursStart: event.target.value })}
            />
          </label>
          <label className={fleetClass("agentSettingsField")}>
            <span>To</span>
            <input
              type="time"
              value={agentCallSettings.quietHoursEnd}
              disabled={!agentCallSettings.quietHoursEnabled}
              onChange={(event) => updateAgentCalls({ quietHoursEnd: event.target.value })}
            />
          </label>
          <label className={fleetClass("agentSettingsField")}>
            <span>Max calls / day</span>
            <input
              type="number"
              min="0"
              max="20"
              value={agentCallSettings.maxCallsPerDay}
              onChange={(event) => updateAgentCalls({ maxCallsPerDay: Number(event.target.value) || 0 })}
            />
          </label>
          <label className={fleetClass("agentSettingsField")}>
            <span>Missed-call fallback</span>
            <select
              value={agentCallSettings.missedCallFallback}
              onChange={(event) => updateAgentCalls({ missedCallFallback: event.target.value })}
            >
              {CALL_FALLBACK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className={styles.agentCallReasonGrid}>
            <label className={styles.agentCallToggleRow}>
              <input
                type="checkbox"
                checked={agentCallSettings.sources.obsidianBriefing}
                onChange={(event) => updateAgentCallSources({ obsidianBriefing: event.target.checked })}
              />
              <span><strong>Obsidian briefing</strong><small>Vault deltas and open loops.</small></span>
            </label>
            <label className={styles.agentCallToggleRow}>
              <input
                type="checkbox"
                checked={agentCallSettings.sources.codingJobCompletion}
                onChange={(event) => updateAgentCallSources({ codingJobCompletion: event.target.checked })}
              />
              <span><strong>Coding completion</strong><small>Call when long work finishes.</small></span>
            </label>
            <label className={styles.agentCallToggleRow}>
              <input
                type="checkbox"
                checked={agentCallSettings.sources.blockedAgentDecision}
                onChange={(event) => updateAgentCallSources({ blockedAgentDecision: event.target.checked })}
              />
              <span><strong>Blocked decision</strong><small>Call when a choice is needed.</small></span>
            </label>
          </div>
        </div>
      </details>
    </div>
  );
}
