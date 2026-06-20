// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Bell, Briefcase, Clock, MessageSquareText, Phone, PlugZap, RefreshCcw, Send, Shield, Volume2, Wand2 } from "lucide-react";
import { buildAgentCallPreferences } from "@/lib/types/agent-runtime";
import { clawMobilePairingUrl, hubUrlForPairingHost } from "@/lib/phone/pairing-url";
import { Badge, Btn, Field, GroupLabel, PanelHead, Toggle } from "./AgentSettingsModalPrimitives";
import styles from "./AgentSettingsCallsPanel.module.css";

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

const CALL_SOURCES = [
  { key: "obsidianBriefing", label: "Obsidian briefing", sub: "Vault deltas and open loops.", Icon: MessageSquareText },
  { key: "codingJobCompletion", label: "Coding completion", sub: "Call when long work finishes.", Icon: Briefcase },
  { key: "blockedAgentDecision", label: "Blocked decision", sub: "Ring when a choice needs you.", Icon: Wand2 },
];

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function runtimeDefaultVoiceOptions(provider: string) {
  return [{ id: `runtime-default:${provider}`, provider, voice: "Gateway default", source: "runtime-default" }];
}

function readVoiceOptions(value: unknown) {
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

function readLocalTtsCandidates(value: unknown) {
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
      streamingKind: typeof item?.streamingKind === "string" ? item.streamingKind : undefined,
      streamingImplementation: typeof item?.streamingImplementation === "string" ? item.streamingImplementation : undefined,
      sampleRate: typeof item?.sampleRate === "number" ? item.sampleRate : 24_000,
      sampleFormat: typeof item?.sampleFormat === "string" ? item.sampleFormat : "pcm16",
    }];
  });
}

function fmt12(time: string) {
  const [rawHour, rawMinute] = String(time || "09:00").split(":").map(Number);
  const hour = Number.isFinite(rawHour) ? rawHour : 9;
  const minute = Number.isFinite(rawMinute) ? rawMinute : 0;
  const ap = hour >= 12 ? "PM" : "AM";
  return { h: ((hour + 11) % 12) + 1, m: String(minute).padStart(2, "0"), ap };
}

export function AgentSettingsCallsPanel(props: any) {
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
  const [phoneStatus, setPhoneStatus] = useState({ checked: false, connected: false, apnsMissing: [] });
  const [voiceOptions, setVoiceOptions] = useState(() => runtimeDefaultVoiceOptions("openai-realtime"));
  const [localTtsCandidates, setLocalTtsCandidates] = useState([]);
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

  const updateAgentCalls = (patch: Record<string, unknown>) => {
    const next = buildAgentCallPreferences({ ...agentCallSettings, ...patch });
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, calls: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { calls: next });
  };

  const updateCallSource = (source: string, enabled: boolean) => {
    updateAgentCalls({ sources: { ...agentCallSettings.sources, [source]: enabled } });
  };

  const updateVoiceRuntime = (voiceRuntime: string) => {
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

  const selectLocalTtsCandidate = (candidate: any) => {
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
      apnsMissing: Array.isArray(missingApns) ? missingApns.filter((item) => typeof item === "string") : [],
    });
    const voicePayload = voiceData?.result ?? voiceData;
    setVoiceOptions(readVoiceOptions(voicePayload));
    setLocalTtsCandidates(readLocalTtsCandidates(voicePayload));
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
  }, []);

  return (
    <div className={styles.panel}>
      <PanelHead
        eyebrow="Calls"
        title="Scheduled phone calls"
        sub="Let this agent ring your phone with status briefings through the HivemindOS Mobile gateway."
        action={<Btn sm onClick={() => void refreshCallConnectionState()}><RefreshCcw size={13} aria-hidden="true" />Refresh</Btn>}
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
            <Field label="Voice">
              <select className="fb-select" value={selectedVoiceOption.id} onChange={(event) => updateVoiceProvider(event.target.value)}>
                {selectedVoiceOptions.map((provider) => (
                  <option value={provider.id} key={provider.id}>{VOICE_RUNTIME_LABELS[provider.provider] ?? provider.provider} · {provider.voice}</option>
                ))}
              </select>
            </Field>
            <Field label="Missed-call fallback">
              <select className="fb-select" value={agentCallSettings.missedCallFallback} onChange={(event) => updateAgentCalls({ missedCallFallback: event.target.value })}>
                {FALLBACK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </Field>
          </div>

          {!hasConfiguredVoices ? (
            <div className="as-info">
              <PlugZap size={16} className="ic" aria-hidden="true" />
              <p>Using the gateway-resolved default voice. Sync custom voices from Hivemind Mobile Settings when you want an explicit provider voice.</p>
            </div>
          ) : null}

          {agentCallSettings.voiceRuntime === "local-tts" ? (
            <div className={styles.localTtsGrid}>
              {localTtsCandidates.length ? localTtsCandidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  className={styles.localTtsCard}
                  data-selected={candidate.id === agentCallSettings.voiceProviderId ? "" : undefined}
                  disabled={!candidate.ok}
                  onClick={() => selectLocalTtsCandidate(candidate)}
                >
                  <Badge tone={candidate.ok ? "live" : "danger"}>{candidate.ok ? "Validated" : "Unavailable"}</Badge>
                  <strong>{candidate.name}</strong>
                  <small>{[candidate.machineName, candidate.port ? `port ${candidate.port}` : ""].filter(Boolean).join(" · ") || "Connected app"}</small>
                  <dl>
                    <div><dt>Model</dt><dd>{candidate.model}</dd></div>
                    <div><dt>Voice</dt><dd>{candidate.voice}</dd></div>
                    <div><dt>Stream</dt><dd>{candidate.sampleFormat} · {candidate.sampleRate} Hz</dd></div>
                    <div><dt>Engine</dt><dd>{candidate.streamingImplementation || candidate.streamingKind || "streaming"}</dd></div>
                  </dl>
                  {candidate.voiceCount ? <small>{candidate.voiceCount} voices</small> : null}
                  {!candidate.ok && candidate.error ? <p className={styles.messageError}>{candidate.error}</p> : null}
                </button>
              )) : (
                <div className="as-info">
                  <Volume2 size={16} className="ic" aria-hidden="true" />
                  <p>No TTS candidates were discovered yet. Start Universal TTS, then refresh this panel.</p>
                </div>
              )}
            </div>
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
