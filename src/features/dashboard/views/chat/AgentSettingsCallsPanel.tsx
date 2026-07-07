"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import QRCode from "qrcode";
import {
  Bell,
  Briefcase,
  ChevronUp,
  MessageSquareText,
  Phone,
  RefreshCcw,
  Send,
  Shield,
  Volume2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { buildAgentCallPreferences } from "@/lib/types/agent-runtime";
import type { AgentCallMissedFallback, AgentCallPreferences, AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentCreateDraft } from "@/features/dashboard/agent-settings-types";
import { clawMobilePairingUrl, hubUrlForPairingHost } from "@/lib/phone/pairing-url";
import { Btn, Field, GroupLabel, PanelHead, Toggle } from "./AgentSettingsModalPrimitives";
import { AgentSettingsCallsVoiceSection } from "./AgentSettingsCallsVoiceSection";
import {
  asRecord,
  fmt12,
  readLocalTtsCandidates,
  readLocalTtsLaunchCandidates,
  readVoiceOptions,
  type LocalTtsCandidate,
  type LocalTtsLaunchCandidate,
  type PhoneStatus,
} from "./agent-settings-calls-data";
import styles from "./AgentSettingsCallsPanel.module.css";

type AgentCallSourceKey = keyof AgentCallPreferences["sources"];

export type AgentSettingsCallsPanelProps = {
  agentCreateDraft: AgentCreateDraft;
  agentCreateMachine: { name?: string } | null;
  onQueenClapWakeEnabledChange?: (enabled: boolean) => unknown;
  queenClapWakeEnabled?: boolean;
  roleModalAgent: AgentProfile | null;
  setAgentCreateDraft: Dispatch<SetStateAction<AgentCreateDraft>>;
  updateAgentProfile: (agentId: string, patch: Partial<AgentProfile>) => unknown;
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

function pad2(value: number) {
  return String(value).padStart(2, "0");
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

  const [section, setSection] = useState<"calls" | "voice">("voice");
  const [phoneQr, setPhoneQr] = useState("");
  const [phoneHubUrl, setPhoneHubUrl] = useState("");
  const [phoneConnectError, setPhoneConnectError] = useState("");
  const [phoneStatus, setPhoneStatus] = useState<PhoneStatus>({ checked: false, connected: false, apnsMissing: [] });
  const [localTtsDiscoveryStatus, setLocalTtsDiscoveryStatus] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [localTtsDiscoveryError, setLocalTtsDiscoveryError] = useState("");
  const [localTtsCandidates, setLocalTtsCandidates] = useState<LocalTtsCandidate[]>([]);
  const [localTtsLaunchCandidates, setLocalTtsLaunchCandidates] = useState<LocalTtsLaunchCandidate[]>([]);
  const [callTestBusy, setCallTestBusy] = useState(false);
  const [callTestMessage, setCallTestMessage] = useState("");
  const [callTestTone, setCallTestTone] = useState<"ok" | "error" | "muted">("muted");
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeRect, setTimeRect] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  const agentCallSettings = buildAgentCallPreferences(agentCreateMachine ? agentCreateDraft.calls : roleModalAgent?.calls);
  const isQueenSettings = !agentCreateMachine && roleModalAgent?.beeRole === "queen";
  const callTimezone = agentCallSettings.timezone || "UTC";
  const selectedTime = fmt12(agentCallSettings.dailyCallTime);
  const localTtsDiscoveryLoading = localTtsDiscoveryStatus === "loading";

  const updateAgentCalls = (patch: Partial<AgentCallPreferences>) => {
    const next = buildAgentCallPreferences({ ...agentCallSettings, ...patch });
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, calls: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { calls: next });
  };

  const updateCallSource = (source: AgentCallSourceKey, enabled: boolean) => {
    updateAgentCalls({ sources: { ...agentCallSettings.sources, [source]: enabled } });
  };

  // ---- Time popover -----------------------------------------------------
  const adjustHour = (delta: number) => {
    const [h, m] = agentCallSettings.dailyCallTime.split(":").map(Number);
    updateAgentCalls({ dailyCallTime: `${pad2(((h || 0) + delta + 24) % 24)}:${pad2(m || 0)}` });
  };
  const adjustMinute = (delta: number) => {
    const [h, m] = agentCallSettings.dailyCallTime.split(":").map(Number);
    updateAgentCalls({ dailyCallTime: `${pad2(h || 0)}:${pad2(((m || 0) + delta + 60) % 60)}` });
  };
  const setAmPm = (ap: "AM" | "PM") => {
    const [rawHour, m] = agentCallSettings.dailyCallTime.split(":").map(Number);
    let h = rawHour || 0;
    const isPm = h >= 12;
    if (ap === "PM" && !isPm) h += 12;
    if (ap === "AM" && isPm) h -= 12;
    updateAgentCalls({ dailyCallTime: `${pad2(h)}:${pad2(m || 0)}` });
  };

  // ---- Discovery + pairing ----------------------------------------------
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
      // voiceOptions are still parsed to keep the gateway discovery contract warm.
      readVoiceOptions(voicePayload);
      const nextLocalTtsCandidates = readLocalTtsCandidates(voicePayload);
      const nextLocalTtsLaunchCandidates = readLocalTtsLaunchCandidates(localTtsData);
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

  const buildPairingQr = async () => {
    try {
      const response = await fetch("/api/tailscale/devices", { cache: "no-store" });
      const data = (await response.json()) as { devices?: Array<{ self?: boolean; ip?: string; dnsName?: string; machineId?: string }> };
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
            voiceProviderId: agentCallSettings.voiceProviderId,
            voiceRuntime: agentCallSettings.voiceRuntime,
            voiceModelId: agentCallSettings.voiceModelId,
            voiceId: agentCallSettings.voiceId,
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

  const isCalls = section === "calls";
  const showSchedule = isCalls && phoneStatus.connected && agentCallSettings.enabled;

  return (
    <div className={styles.panel}>
      <PanelHead
        eyebrow="Calls"
        title={isCalls ? "Scheduled phone calls" : "Agent voice"}
        sub={
          isCalls
            ? "Let this agent ring your phone with status briefings through the HivemindOS Mobile gateway."
            : "Choose the voice and chat brain this agent speaks with — used for calls and Queen Bee voice chat."
        }
        action={
          <Btn sm disabled={localTtsDiscoveryLoading} onClick={() => void refreshCallConnectionState()}>
            <RefreshCcw size={13} className={localTtsDiscoveryLoading ? "animate-spin" : undefined} aria-hidden="true" />
            {localTtsDiscoveryLoading ? "Refreshing" : "Refresh"}
          </Btn>
        }
      />

      <div className={styles.sectionTabs} role="tablist" aria-label="Calls settings section">
        <button type="button" role="tab" aria-selected={!isCalls} className={styles.sectionTab} data-on={!isCalls ? "" : undefined} onClick={() => setSection("voice")}>
          <Volume2 size={14} aria-hidden="true" />
          Voice
        </button>
        <button type="button" role="tab" aria-selected={isCalls} className={styles.sectionTab} data-on={isCalls ? "" : undefined} onClick={() => setSection("calls")}>
          <Phone size={14} aria-hidden="true" />
          Phone calls
        </button>
      </div>

      {isCalls ? (
        <>
          <section className={styles.callLine} data-live={phoneStatus.connected ? "" : undefined} data-off={!agentCallSettings.enabled ? "" : undefined}>
            <span className={styles.tile}>
              <Phone size={18} aria-hidden="true" />
            </span>
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
          {callTestMessage ? (
            <p className={["as-status", callTestTone === "ok" ? styles.messageOk : callTestTone === "error" ? styles.messageError : ""].filter(Boolean).join(" ")}>{callTestMessage}</p>
          ) : null}

          {!phoneStatus.connected ? (
            <section className={styles.setupCard}>
              <PanelHead
                eyebrow="Mobile pairing"
                title="Connect HivemindOS Mobile"
                sub="Your phone scans the same pairing code from /connect-phone, then the gateway can ring the device for scheduled agent calls."
              />
              <ol className={styles.setupSteps}>
                <li>
                  <b className={styles.stepNumber}>1</b>
                  <div>
                    <div className={styles.title}>Install HivemindOS Mobile</div>
                    <p>Use the phone you want agents to call.</p>
                  </div>
                </li>
                <li>
                  <b className={styles.stepNumber}>2</b>
                  <div>
                    <div className={styles.title}>Open Settings, then scan this QR code</div>
                    {phoneConnectError ? (
                      <p className={styles.messageError}>{phoneConnectError}</p>
                    ) : phoneQr ? (
                      <div className={styles.qrWrap}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={phoneQr} alt="HivemindOS Mobile pairing QR" />
                        <code>{phoneHubUrl}</code>
                      </div>
                    ) : (
                      <p>Generating pairing code...</p>
                    )}
                  </div>
                </li>
              </ol>
            </section>
          ) : null}

          {showSchedule ? (
            <>
              <section className={styles.alarm} data-off={!agentCallSettings.dailyEnabled ? "" : undefined}>
                <div className={styles.alarmInfo}>
                  <span className="fb-eyebrow">Daily briefing call</span>
                  <div className={styles.timePickerWrap}>
                    <button
                      type="button"
                      className={styles.time}
                      title="Change the call time"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setTimeRect({ left: rect.left, top: rect.bottom });
                        setTimeOpen((current) => !current);
                      }}
                    >
                      {selectedTime.h}:{selectedTime.m}
                      <span className={styles.ampm}>{selectedTime.ap}</span>
                    </button>
                    {timeOpen ? (
                      <>
                        <button type="button" aria-label="Close time picker" className={styles.timeScrim} onClick={() => setTimeOpen(false)} />
                        <div role="dialog" aria-label="Set call time" className={styles.timePop} style={{ left: timeRect.left, top: timeRect.top + 10 }}>
                          <div className={styles.timeSteppers}>
                            <div className={styles.timeStepCol}>
                              <button type="button" aria-label="Hour up" onClick={() => adjustHour(1)}>
                                <ChevronUp size={15} aria-hidden="true" />
                              </button>
                              <span>{selectedTime.h}</span>
                              <button type="button" aria-label="Hour down" onClick={() => adjustHour(-1)}>
                                <ChevronUp size={15} style={{ transform: "rotate(180deg)" }} aria-hidden="true" />
                              </button>
                            </div>
                            <span className={styles.timeColon}>:</span>
                            <div className={styles.timeStepCol}>
                              <button type="button" aria-label="Minute up" onClick={() => adjustMinute(5)}>
                                <ChevronUp size={15} aria-hidden="true" />
                              </button>
                              <span>{selectedTime.m}</span>
                              <button type="button" aria-label="Minute down" onClick={() => adjustMinute(-5)}>
                                <ChevronUp size={15} style={{ transform: "rotate(180deg)" }} aria-hidden="true" />
                              </button>
                            </div>
                            <div className={styles.timeAmpm}>
                              <button type="button" className={styles.ampmBtn} data-on={selectedTime.ap === "AM" ? "" : undefined} onClick={() => setAmPm("AM")}>
                                AM
                              </button>
                              <button type="button" className={styles.ampmBtn} data-on={selectedTime.ap === "PM" ? "" : undefined} onClick={() => setAmPm("PM")}>
                                PM
                              </button>
                            </div>
                          </div>
                          <Btn variant="primary" sm onClick={() => setTimeOpen(false)}>
                            Done
                          </Btn>
                        </div>
                      </>
                    ) : null}
                  </div>
                  <div className={styles.days} aria-label="Runs every day">
                    {DAY_LABELS.map((day, index) => (
                      <span key={`${day}-${index}`} className={styles.day}>
                        {day}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.alarmActions}>
                  <Toggle on={agentCallSettings.dailyEnabled} onChange={() => updateAgentCalls({ dailyEnabled: !agentCallSettings.dailyEnabled })} />
                </div>
                <div className={styles.next}>
                  <Phone size={12} aria-hidden="true" />
                  {agentCallSettings.dailyEnabled
                    ? `Next call · tomorrow ${selectedTime.h}:${selectedTime.m} ${selectedTime.ap} · every day · ${callTimezone}`
                    : "Daily call paused"}
                </div>
              </section>

              <div>
                <GroupLabel>When to call</GroupLabel>
                <div className={styles.events}>
                  {isQueenSettings && onQueenClapWakeEnabledChange ? (
                    <article className={styles.eventRow} data-on={queenClapWakeEnabled ? "" : undefined}>
                      <span className={styles.eventIcon}>
                        <Bell size={16} aria-hidden="true" />
                      </span>
                      <div className={styles.meta}>
                        <div className={styles.eventTitle}>Clap wake</div>
                        <div className={styles.eventSub}>Open Queen Bee voice chat on two quick claps detected locally.</div>
                      </div>
                      <Toggle on={Boolean(queenClapWakeEnabled)} onChange={() => onQueenClapWakeEnabledChange(!queenClapWakeEnabled)} />
                    </article>
                  ) : null}
                  {CALL_SOURCES.map(({ key, label, sub, Icon }) => (
                    <article key={key} className={styles.eventRow} data-on={agentCallSettings.sources[key] ? "" : undefined}>
                      <span className={styles.eventIcon}>
                        <Icon size={16} aria-hidden="true" />
                      </span>
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
          ) : isCalls && !phoneStatus.connected ? (
            <div className="as-info">
              <Phone size={16} className="ic" aria-hidden="true" />
              <p>Finish pairing your phone to schedule a daily briefing and event triggers.</p>
            </div>
          ) : null}

          <section className={styles.voiceBlock}>
            <span className="fb-eyebrow">Guardrails</span>
            <div className={styles.quietGrid}>
              <article className={styles.eventRow} data-on={agentCallSettings.quietHoursEnabled ? "" : undefined}>
                <span className={styles.eventIcon}>
                  <Shield size={16} aria-hidden="true" />
                </span>
                <div className={styles.meta}>
                  <div className={styles.eventTitle}>Quiet hours</div>
                  <div className={styles.eventSub}>Hold calls during the window.</div>
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
              <Field label="Missed-call fallback">
                {/* DOM boundary: the option values below are exactly the AgentCallMissedFallback union. */}
                <select className="fb-select" value={agentCallSettings.missedCallFallback} onChange={(event) => updateAgentCalls({ missedCallFallback: event.target.value as AgentCallMissedFallback })}>
                  {FALLBACK_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {phoneStatus.apnsConfigured === false && phoneStatus.apnsMissing.length ? (
              <p className={styles.muted}>Gateway push needs {phoneStatus.apnsMissing.join(", ")} for closed-app ringing.</p>
            ) : (
              <p className={styles.muted}>
                No calls between <code>{agentCallSettings.quietHoursStart}</code> and <code>{agentCallSettings.quietHoursEnd}</code>; triggers queue until the window clears.
              </p>
            )}
          </section>
        </>
      ) : (
        <AgentSettingsCallsVoiceSection
          agentCallSettings={agentCallSettings}
          updateAgentCalls={updateAgentCalls}
          roleModalAgent={roleModalAgent}
          localTtsCandidates={localTtsCandidates}
          localTtsLaunchCandidates={localTtsLaunchCandidates}
          localTtsDiscoveryStatus={localTtsDiscoveryStatus}
          localTtsDiscoveryError={localTtsDiscoveryError}
          refreshCallConnectionState={refreshCallConnectionState}
        />
      )}
    </div>
  );
}
