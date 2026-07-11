"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Bell,
  Briefcase,
  ChevronUp,
  MessageSquareText,
  Phone,
  QrCode,
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
import type { AgentVoiceFailureDetail } from "@/features/dashboard/hooks/use-agent-voice-failure-notifications";
import { usePairingQr } from "@/lib/phone/usePairingQr";
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
  onVoiceFailure?: (detail: AgentVoiceFailureDetail) => void;
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

const DAY_OPTIONS = [
  { value: 1, label: "M", short: "Mon", name: "Monday" },
  { value: 2, label: "T", short: "Tue", name: "Tuesday" },
  { value: 3, label: "W", short: "Wed", name: "Wednesday" },
  { value: 4, label: "T", short: "Thu", name: "Thursday" },
  { value: 5, label: "F", short: "Fri", name: "Friday" },
  { value: 6, label: "S", short: "Sat", name: "Saturday" },
  { value: 0, label: "S", short: "Sun", name: "Sunday" },
];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function summarizeCallDays(days: number[]) {
  const selected = new Set(days);
  const hasAll = (values: number[]) => values.every((day) => selected.has(day));
  if (DAY_OPTIONS.every((day) => selected.has(day.value))) return "every day";
  if (selected.size === 5 && hasAll([1, 2, 3, 4, 5])) return "weekdays";
  if (selected.size === 2 && hasAll([6, 0])) return "weekends";
  return DAY_OPTIONS.filter((day) => selected.has(day.value)).map((day) => day.short).join(", ");
}

export function AgentSettingsCallsPanel(props: AgentSettingsCallsPanelProps) {
  const {
    agentCreateDraft,
    agentCreateMachine,
    onQueenClapWakeEnabledChange,
    onVoiceFailure,
    queenClapWakeEnabled,
    roleModalAgent,
    setAgentCreateDraft,
    updateAgentProfile,
  } = props;

  const [section, setSection] = useState<"calls" | "voice">("voice");
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
  // Reveal the pairing QR even when the phone reads "connected": tailnet presence
  // (lastSeenAt) says nothing about whether the phone's stored hub device token
  // still matches. When the phone reports "hub rejected your device token", the
  // fix is to re-scan — so surface a re-pair QR from the connected row too.
  const [showRepairQr, setShowRepairQr] = useState(false);

  const agentCallSettings = buildAgentCallPreferences(agentCreateMachine ? agentCreateDraft.calls : roleModalAgent?.calls);
  const isQueenSettings = !agentCreateMachine && roleModalAgent?.beeRole === "queen";
  const callTimezone = agentCallSettings.timezone || "UTC";
  const selectedTime = fmt12(agentCallSettings.dailyCallTime);
  const selectedDailyCallDays = new Set(agentCallSettings.dailyCallDays);
  const dailyCallDaysSummary = summarizeCallDays(agentCallSettings.dailyCallDays);
  const localTtsDiscoveryLoading = localTtsDiscoveryStatus === "loading";
  const { qr: phoneQr, hubUrl: phoneHubUrl, error: phoneConnectError } = usePairingQr(true);

  const updateAgentCalls = (patch: Partial<AgentCallPreferences>) => {
    const next = buildAgentCallPreferences({ ...agentCallSettings, ...patch });
    if (agentCreateMachine) setAgentCreateDraft((current) => ({ ...current, calls: next }));
    else if (roleModalAgent) updateAgentProfile(roleModalAgent.id, { calls: next });
  };

  const updateCallSource = (source: AgentCallSourceKey, enabled: boolean) => {
    updateAgentCalls({ sources: { ...agentCallSettings.sources, [source]: enabled } });
  };

  const updatePhoneStatusFromResponse = async (statusResponse: Response | null) => {
    const statusData = asRecord(await statusResponse?.json().catch(() => null));
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
  const toggleDailyCallDay = (day: number) => {
    const nextDays = new Set(agentCallSettings.dailyCallDays);
    if (nextDays.has(day)) nextDays.delete(day);
    else nextDays.add(day);
    const orderedDays = DAY_OPTIONS.map((option) => option.value).filter((value) => nextDays.has(value));
    if (orderedDays.length) updateAgentCalls({ dailyCallDays: orderedDays });
  };

  // ---- Discovery + pairing ----------------------------------------------
  const refreshCallConnectionState = async () => {
    setLocalTtsDiscoveryStatus("loading");
    setLocalTtsDiscoveryError("");
    try {
      const statusRequest = fetch("/api/phone?action=device-status", { cache: "no-store" }).catch(() => null);
      const voiceRequest = fetch("/api/phone?action=voice-config", { cache: "no-store" }).catch(() => null);
      const localTtsRequest = fetch("/api/phone/local-tts", { cache: "no-store" }).catch(() => null);
      const statusResponse = await statusRequest;
      await updatePhoneStatusFromResponse(statusResponse);
      const [voiceResponse, localTtsResponse] = await Promise.all([voiceRequest, localTtsRequest]);
      const voiceData = asRecord(await voiceResponse?.json().catch(() => null));
      const localTtsData = asRecord(await localTtsResponse?.json().catch(() => null));
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
            voiceLanguage: agentCallSettings.voiceLanguage,
            voiceTextLanguage: agentCallSettings.voiceTextLanguage,
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
    }, 0);
    return () => window.clearTimeout(timer);
    // Mount-only discovery; manual Refresh handles later availability checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCalls = section === "calls";
  const phoneChecking = !phoneStatus.checked;
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
                {phoneChecking ? (
                  <RefreshCcw size={11} className="animate-spin" aria-hidden="true" />
                ) : (
                  <span className={["fr-dot", phoneStatus.connected && agentCallSettings.enabled ? "live" : ""].filter(Boolean).join(" ")} />
                )}
                {phoneChecking
                  ? "Checking mobile pairing"
                  : phoneStatus.connected
                  ? agentCallSettings.enabled
                    ? `Connected${phoneStatus.lastSeenAt ? ` · last seen ${new Date(phoneStatus.lastSeenAt).toLocaleString()}` : ""}`
                    : "Calls paused"
                  : "Waiting for mobile pairing"}
              </div>
            </div>
            {phoneStatus.connected ? (
              <>
                <Btn
                  sm
                  title="Re-pair this phone — refresh its hub device token (no data lost)"
                  aria-pressed={showRepairQr}
                  onClick={() => setShowRepairQr((current) => !current)}
                >
                  <QrCode size={13} aria-hidden="true" />
                  {showRepairQr ? "Hide QR" : "Re-pair"}
                </Btn>
                <Btn sm disabled={callTestBusy} onClick={() => void requestAgentTestCall()}>
                  {callTestBusy ? <RefreshCcw size={13} className="animate-spin" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}
                  {callTestBusy ? "Requesting..." : "Test call"}
                </Btn>
              </>
            ) : null}
            <Toggle on={agentCallSettings.enabled} onChange={() => updateAgentCalls({ enabled: !agentCallSettings.enabled })} />
          </section>
          {callTestMessage ? (
            <p className={["as-status", callTestTone === "ok" ? styles.messageOk : callTestTone === "error" ? styles.messageError : ""].filter(Boolean).join(" ")}>{callTestMessage}</p>
          ) : null}

          {(phoneStatus.checked && !phoneStatus.connected) || showRepairQr ? (
            <section className={styles.setupCard}>
              <PanelHead
                eyebrow="Mobile pairing"
                title={phoneStatus.connected ? "Re-pair HivemindOS Mobile" : "Connect HivemindOS Mobile"}
                sub={
                  phoneStatus.connected
                    ? "Connected, but the phone says the hub rejected its device token? Re-scan this code to refresh the token — nothing is lost, it re-uses the existing pairing."
                    : "Your phone scans the same pairing code from /connect-phone, then the gateway can ring the device for scheduled agent calls."
                }
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
                      <p className={styles.inlineLoading} role="status" aria-label="Generating phone pairing code">
                        <RefreshCcw size={12} className="animate-spin" aria-hidden="true" />
                        Generating pairing code
                      </p>
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
                  <div className={styles.days} aria-label="Call days">
                    {DAY_OPTIONS.map((day) => (
                      <button
                        key={day.value}
                        type="button"
                        className={styles.day}
                        data-on={selectedDailyCallDays.has(day.value) ? "" : undefined}
                        aria-pressed={selectedDailyCallDays.has(day.value)}
                        aria-label={`${selectedDailyCallDays.has(day.value) ? "Disable" : "Enable"} calls on ${day.name}`}
                        title={day.name}
                        onClick={() => toggleDailyCallDay(day.value)}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.alarmActions}>
                  <Toggle on={agentCallSettings.dailyEnabled} onChange={() => updateAgentCalls({ dailyEnabled: !agentCallSettings.dailyEnabled })} />
                </div>
                <div className={styles.next}>
                  <Phone size={12} aria-hidden="true" />
                  {agentCallSettings.dailyEnabled
                    ? `Schedule · ${dailyCallDaysSummary} · ${selectedTime.h}:${selectedTime.m} ${selectedTime.ap} · ${callTimezone}`
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
          ) : isCalls && phoneChecking ? (
            <div className="as-info" role="status" aria-label="Checking mobile pairing">
              <RefreshCcw size={16} className="ic animate-spin" aria-hidden="true" />
              <p>Checking mobile pairing before showing call setup.</p>
            </div>
          ) : isCalls && phoneStatus.checked && !phoneStatus.connected ? (
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
          onVoiceFailure={onVoiceFailure}
          refreshCallConnectionState={refreshCallConnectionState}
        />
      )}
    </div>
  );
}
