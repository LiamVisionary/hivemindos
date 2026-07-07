"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  AudioLines,
  Check,
  Crown,
  FileText,
  Mic,
  MicOff,
  Settings2,
  X,
} from "lucide-react";
import { ChatMarkdown } from "@/features/dashboard/ChatMarkdown";
import { AgentResponseLoader } from "@/features/chat/chat-composer";
import type { DashboardScreenContext } from "@/features/dashboard/screen-context";
import { emitQueenVoiceState, listenForQueenVoiceToggle } from "@/lib/native/queen-voice-events";
import { QueenVoiceGlow } from "./QueenVoiceGlow";
import { VoiceWaveform } from "./VoiceWaveform";
import { HIVE_CHAT_TRANSCRIPT_BOTTOM_OFFSET } from "./hive-chat-layout";
import { useQueenClapActivation } from "./use-queen-clap-activation";
import { useQueenBeeGeminiLive } from "./use-queen-bee-gemini-live";
import { useQueenBeeRealtime } from "./use-queen-bee-realtime";
import {
  useQueenBeeVoice,
  type QueenVoicePhase,
  type QueenVoiceWorkingStage,
} from "./use-queen-bee-voice";
import { useQueenChat, type QueenChatTurn } from "./queen-chat-store";
import styles from "./queen-voice.module.css";

const QUEEN_VOICE_ACTIVATION_SOUND_SRC = "/audio/sfx/scifi-ping.wav";
const QUEEN_VOICE_OPENING_LINE =
  "Hey Liam, I'm here. What should we work on first?";

// Thinking pauses render the chat route's animated loader (bee + rotating
// phrases — AgentResponseLoader) instead of a held filler line.

function playQueenVoiceActivationSound() {
  if (typeof Audio === "undefined") return;
  const audio = new Audio(QUEEN_VOICE_ACTIVATION_SOUND_SRC);
  audio.volume = 0.72;
  void audio.play().catch(() => undefined);
}

function statusLabel(
  phase: QueenVoicePhase,
  muted: boolean,
  speechDetected: boolean,
) {
  if (muted) return "Mic muted";
  if (phase === "starting") return "Connecting...";
  if (phase === "listening")
    return speechDetected ? "Listening..." : "Your turn - speak to Queen Bee";
  if (phase === "thinking") return "Queen Bee is thinking...";
  if (phase === "speaking") return "Queen Bee is speaking";
  return "Voice chat hit a snag";
}

function statusDotClass(phase: QueenVoicePhase) {
  if (phase === "listening") return styles.statusDotListening;
  if (phase === "thinking") return styles.statusDotThinking;
  if (phase === "speaking") return styles.statusDotSpeaking;
  if (phase === "error") return styles.statusDotError;
  return "";
}

function clapWakeTitle(status: string, error: string) {
  if (status === "listening") return "Clap wake is listening";
  if (status === "paused") return "Clap wake resumes after this chat";
  if (status === "starting") return "Clap wake is starting";
  if (status === "error") return error || "Clap wake is unavailable";
  return "Enable clap wake";
}

// A card with a "Reply `confirm`" / "Reply `CONFIRM_SWAP`" line needs a yes/no
// decision: we auto-open its modal and give it Confirm/Deny buttons.
function needsConfirmation(detail?: string | null): boolean {
  return !!detail && /\breply\s+`?(?:confirm|CONFIRM_|SEND_|APPROVE_)/i.test(detail);
}
// Transaction-related (a pending confirmation, a Bankr/swap/trade card, or an
// on-chain tx) gets a transaction label instead of the generic "what she found".
function isTransactionDetail(detail?: string | null): boolean {
  return (
    !!detail
    && (needsConfirmation(detail)
      || /\*\*(?:bankr action|swap\b|trade\b|transaction)/i.test(detail)
      || /\b0x[a-fA-F0-9]{16,}\b/.test(detail))
  );
}
function detailBadgeLabel(detail?: string | null): string {
  return isTransactionDetail(detail) ? "Show transaction info" : "Show what she found";
}
function detailModalTitle(detail: string): string {
  return isTransactionDetail(detail) ? "Transaction" : "What Queen Bee found";
}

function TranscriptTurns({
  turns,
  minimized,
  thinking,
  brainLabel,
  working,
  onShowDetail,
  onCollapse,
}: {
  turns: QueenChatTurn[];
  minimized: boolean;
  thinking: boolean;
  /** Subtle "which brain answers" tag next to Queen Bee's name, e.g. "gpt-5.5 · ChatGPT". */
  brainLabel: string;
  /** Live stages of the in-flight voice turn (tool calls, fleet scan, ...). */
  working: QueenVoiceWorkingStage[];
  onShowDetail: (detail: string) => void;
  onCollapse: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Spring open/close: keep the bubble mounted through its exit animation.
  // `wantOpen` is the desired state; `closing` holds the bubble one beat longer
  // so transcriptCollapse can finish; `rendered` (derived) is DOM presence.
  const wantOpen = !minimized && (turns.length > 0 || thinking);
  const [closing, setClosing] = React.useState(false);
  const [prevWantOpen, setPrevWantOpen] = React.useState(wantOpen);

  // Adjust derived state during render when the desired open-state flips — the
  // React-sanctioned alternative to a cascading setState-in-effect. Turning off
  // begins the exit; turning back on cancels any in-flight close.
  if (prevWantOpen !== wantOpen) {
    setPrevWantOpen(wantOpen);
    setClosing(!wantOpen);
  }
  const rendered = wantOpen || closing;

  React.useEffect(() => {
    if (!closing) return;
    // Slightly longer than the transcriptCollapse duration (200ms). The setState
    // lives in the timer callback (not the effect body), so no cascading render,
    // and it still fires under reduced-motion (no reliance on animationend).
    const timer = setTimeout(() => setClosing(false), 230);
    return () => clearTimeout(timer);
  }, [closing]);

  React.useEffect(() => {
    if (closing) return;
    const panel = panelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [turns, thinking, working, closing, rendered]);

  // Collapsed (and exit finished): the history is gone; the triangle tab on the
  // input pill is the only control (see the .fr-chat-tab in PersistentHiveChat).
  if (!rendered) return null;
  return (
    <div
      className={`${styles.transcriptPanel} ${closing ? styles.transcriptPanelClosing : styles.transcriptPanelOpen}`}
    >
      <div ref={panelRef} className={styles.transcriptScroll} aria-live="polite">
        {turns.slice(-3).map((turn) => (
          <div key={turn.id} className={styles.turn}>
            <span
              className={`${styles.turnWho} ${turn.who === "queen" ? styles.turnWhoQueen : styles.turnWhoYou}`}
            >
              {turn.who === "queen" ? "Queen Bee" : "You"}
              {/* Per-turn truth first: typed turns are tagged with the brain
                  the chat-turn response says actually answered; the static
                  voice-plan tag only applies to voice-sourced turns. */}
              {turn.who === "queen" && (turn.brain || (turn.source === "voice" && brainLabel)) ? (
                <span className={styles.brainTag}>{turn.brain || brainLabel}</span>
              ) : null}
            </span>
            <div
              className={`${styles.turnText} ${turn.live ? styles.turnTextLive : ""} ${turn.pending && !turn.text ? styles.turnTextThinking : ""}`}
            >
              {turn.pending && !turn.text ? (
                // steady label keeps the bubble height stable while the dots
                // animation cycles through its empty frame
                <>Thinking<span className={styles.thinkingDots} aria-hidden="true" /></>
              ) : turn.who === "queen" ? (
                // Queen replies are markdown (code spans like `CONFIRM_SWAP`, bold,
                // lists, links); the user's own echo stays plain text.
                <>
                  {turn.text ? <ChatMarkdown text={turn.text} /> : null}
                  {turn.live && turn.working ? (
                    // Typed tool phase: the same bee thinking-loader as the chat
                    // route, with the specific tool status as a working chip —
                    // one thinking language across voice and text.
                    <div className={styles.turnWorking}>
                      <AgentResponseLoader />
                      <div className={styles.workingChips} aria-live="polite">
                        <span className={styles.workingChip}>
                          <span
                            className={`${styles.workingChipDot} ${styles.workingChipDotActive}`}
                            aria-hidden="true"
                          />
                          {turn.working}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {turn.text}
                  {/* Live captions keep transcribing for a beat after the user
                      stops (the model's trailing words land late); animated
                      dots say "still finalizing" so the pause reads as work,
                      not a dropped word. */}
                  {turn.live && turn.text && !turn.text.endsWith("...") ? (
                    <span className={styles.thinkingDots} aria-hidden="true" />
                  ) : null}
                </>
              )}
            </div>
            {/* The configured brain was skipped this turn — say which one and
                why, so a silent swap to a fallback model (or the on-device
                planner) never reads as "your selected model answered". */}
            {turn.who === "queen" && turn.brainFallback ? (
              <div className={styles.brainFallbackNote} role="status">
                <AlertTriangle size={12} aria-hidden="true" />
                <span>
                  {turn.brainFallback.label} didn’t answer — {turn.brainFallback.error}
                  {turn.brain ? ` Replied with ${turn.brain}.` : ""}
                </span>
              </div>
            ) : null}
            {turn.detail ? (
              <button
                type="button"
                className={styles.detailButton}
                onClick={() => onShowDetail(turn.detail ?? "")}
              >
                <FileText size={12} aria-hidden="true" />
                {detailBadgeLabel(turn.detail)}
              </button>
            ) : null}
          </div>
        ))}
        {thinking ? (
          <div className={styles.turn}>
            <span className={`${styles.turnWho} ${styles.turnWhoQueen}`}>
              Queen Bee
              {brainLabel ? <span className={styles.brainTag}>{brainLabel}</span> : null}
            </span>
            {/* The chat route's thinking loader (bee lottie + rotating
                animated phrases) — one thinking language across the app. */}
            <AgentResponseLoader />
            {working.length ? (
              // Compact live activity: what she is actually doing right now
              // (thinking with which agent, tool calls, fleet scan, routing).
              <div className={styles.workingChips} aria-live="polite">
                {working.slice(-4).map((stage, index) => (
                  <span
                    key={`${stage.label}-${index}`}
                    className={`${styles.workingChip} ${stage.done ? styles.workingChipDone : ""}`}
                  >
                    <span
                      className={`${styles.workingChipDot} ${stage.done ? "" : styles.workingChipDotActive}`}
                      aria-hidden="true"
                    />
                    {stage.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Down-tail on the bubble's bottom edge — points toward the input and
          collapses the history. Outlined so it reads against the page. */}
      <button
        type="button"
        className={styles.bubbleTail}
        onClick={onCollapse}
        aria-label="Hide chat history"
        title="Hide chat history"
      >
        <svg width="30" height="13" viewBox="0 0 30 13" fill="none" aria-hidden="true">
          <path d="M2.5 1.5 L15 10.5 L27.5 1.5" />
        </svg>
      </button>
    </div>
  );
}

function VoicePicker({ onVoiceChanged }: { onVoiceChanged: () => void }) {
  const [voices, setVoices] = React.useState<string[]>([]);
  const [voice, setVoice] = React.useState("");
  const [saving, setSaving] = React.useState("");

  React.useEffect(() => {
    let disposed = false;
    void fetch("/api/queen-bee/voice", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { voice?: string; voices?: string[] }) => {
        if (disposed) return;
        if (Array.isArray(data.voices)) setVoices(data.voices);
        if (typeof data.voice === "string") setVoice(data.voice);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, []);

  const selectVoice = async (nextVoice: string) => {
    if (nextVoice === voice || saving) return;
    setSaving(nextVoice);
    try {
      const response = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-voice", voice: nextVoice }),
        cache: "no-store",
      });
      if (response.ok) {
        setVoice(nextVoice);
        onVoiceChanged();
      }
    } finally {
      setSaving("");
    }
  };

  return (
    <div
      className={styles.voicePicker}
      role="listbox"
      aria-label="Queen Bee voice"
    >
      <span className={styles.voicePickerTitle}>Queen Bee voice</span>
      {voices.map((option) => (
        <button
          key={option}
          type="button"
          role="option"
          aria-selected={option === voice}
          className={`${styles.voiceOption} ${option === voice ? styles.voiceOptionActive : ""}`}
          onClick={() => void selectVoice(option)}
          disabled={Boolean(saving)}
        >
          {option === voice ? <Check size={12} aria-hidden="true" /> : null}
          {option}
          {saving === option ? "..." : ""}
        </button>
      ))}
      {!voices.length ? (
        <span className={styles.voicePickerEmpty}>Loading voices...</span>
      ) : null}
    </div>
  );
}

/**
 * Full-window Queen Bee voice chat: the Apple Intelligence-style perimeter
 * glow plus live transcription captions for both sides of the conversation.
 * Defaults to OpenAI Realtime speech-to-speech; falls back to the realtime
 * STT + conversational turn + TTS pipeline when a realtime session cannot be
 * established. Toggled from the menu bar tray icon or Cmd+Shift+V.
 */
export function QueenBeeVoiceOverlay({
  clapWakeEnabled = false,
  onClapWakeEnabledChange,
  onDriveDashboard,
  openSpaceRightInset = 0,
  screenContext,
}: {
  clapWakeEnabled?: boolean;
  onClapWakeEnabledChange?: (enabled: boolean) => void;
  onDriveDashboard?: (
    command: string,
    opts?: { onModalOpen?: () => void; screenContext?: DashboardScreenContext },
  ) => Promise<string>;
  openSpaceRightInset?: number;
  screenContext?: DashboardScreenContext;
} = {}) {
  const [open, setOpen] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = React.useState(false);
  // The shared Queen conversation (typed + voice live here together). The
  // history-collapsed flag lives in the store so the input's toggle tab and
  // this transcript overlay share one source of truth.
  const chat = useQueenChat();
  const { setHistoryMinimized } = chat;
  // Bumping the nonce restarts the realtime session (e.g. new voice).
  const [sessionNonce, setSessionNonce] = React.useState(0);
  const [realtimeFailedNonce, setRealtimeFailedNonce] = React.useState(-1);
  // The resolved voice engine for a given session nonce. Local/cloud TTS run the
  // non-realtime pipeline, Gemini Live runs its bidi socket, and the default is
  // OpenAI Realtime speech-to-speech. Tagged with the nonce it was resolved for
  // so a new open reads `null` until ITS fetch lands, gating every voice hook.
  const [resolvedVoiceMode, setResolvedVoiceMode] = React.useState<
    { nonce: number; mode: "realtime" | "pipeline" | "gemini-live" } | null
  >(null);
  const sessionNonceRef = React.useRef(sessionNonce);
  React.useEffect(() => {
    sessionNonceRef.current = sessionNonce;
  }, [sessionNonce]);
  // Which brain answers spoken turns — shown as a subtle tag by her name.
  const [brainLabel, setBrainLabel] = React.useState("");
  // Re-resolved on each open and session restart so a freshly-changed Calls
  // setting takes effect without restarting the app.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const nonce = sessionNonce;
    void fetch("/api/queen-bee/voice", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { localTtsSelected?: boolean; pipelineSelected?: boolean; voiceMode?: "realtime" | "pipeline" | "gemini-live"; brainLabel?: string | null } | null) => {
        if (!cancelled) {
          setBrainLabel(typeof data?.brainLabel === "string" ? data.brainLabel : "");
          setResolvedVoiceMode({
            nonce,
            // voiceMode carries Gemini Live explicitly; pipelineSelected covers
            // older servers that only knew local/cloud TTS pipeline routing.
            mode: data?.voiceMode ?? ((data?.pipelineSelected ?? data?.localTtsSelected) ? "pipeline" : "realtime"),
          });
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedVoiceMode({ nonce, mode: "realtime" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionNonce]);
  const voiceModeForOpen =
    resolvedVoiceMode?.nonce === sessionNonce ? resolvedVoiceMode.mode : null;
  const realtimeMode =
    voiceModeForOpen === "realtime" && realtimeFailedNonce !== sessionNonce;
  const geminiLiveMode = voiceModeForOpen === "gemini-live";

  const resetVoiceSessionUi = React.useCallback(() => {
    setMuted(false);
    setVoicePickerOpen(false);
    setHistoryMinimized(false);
    setSessionNonce((current) => current + 1);
  }, [setHistoryMinimized]);

  const openQueenVoiceChat = React.useCallback(() => {
    setOpen((current) => {
      if (!current) playQueenVoiceActivationSound();
      return true;
    });
    resetVoiceSessionUi();
  }, [resetVoiceSessionUi]);

  const toggleQueenVoiceChat = React.useCallback(() => {
    setOpen((current) => {
      const next = !current;
      if (next) playQueenVoiceActivationSound();
      return next;
    });
    resetVoiceSessionUi();
  }, [resetVoiceSessionUi]);

  const toggleClapWake = React.useCallback(() => {
    onClapWakeEnabledChange?.(!clapWakeEnabled);
  }, [clapWakeEnabled, onClapWakeEnabledChange]);

  const clapActivation = useQueenClapActivation({
    enabled: clapWakeEnabled,
    paused: open,
    onActivation: openQueenVoiceChat,
  });

  const handleRealtimeFailed = React.useCallback(() => {
    // Remember which session failed so this nonce falls back to the pipeline.
    setRealtimeFailedNonce(sessionNonceRef.current);
  }, []);
  // Drive the dashboard; collapse the chat out of the way ONLY when the bee
  // opens a modal (it would otherwise cover it). Plain navigation keeps the
  // chat history visible.
  const driveDashboard = React.useCallback(
    async (command: string) => {
      if (!onDriveDashboard) return "The dashboard isn't available to drive right now.";
      return onDriveDashboard(command, {
        onModalOpen: () => setHistoryMinimized(true),
        screenContext,
      });
    },
    [onDriveDashboard, screenContext, setHistoryMinimized],
  );
  const realtime = useQueenBeeRealtime(
    open && realtimeMode,
    muted,
    handleRealtimeFailed,
    onDriveDashboard ? driveDashboard : undefined,
    QUEEN_VOICE_OPENING_LINE,
    screenContext,
  );
  const geminiLive = useQueenBeeGeminiLive(
    open && geminiLiveMode,
    muted,
    QUEEN_VOICE_OPENING_LINE,
    onDriveDashboard ? driveDashboard : undefined,
    screenContext,
  );
  const pipeline = useQueenBeeVoice(
    open && voiceModeForOpen !== null && !realtimeMode && !geminiLiveMode,
    muted,
    QUEEN_VOICE_OPENING_LINE,
    voiceModeForOpen === "pipeline",
  );
  const voiceState = geminiLiveMode ? geminiLive : realtimeMode ? realtime : pipeline;

  const { upsertTurn: chatUpsertTurn, removeTurn: chatRemoveTurn } = chat;

  // Bridge voice turns into the shared store (append-only diff). Namespace ids
  // per voice session so turns from different sessions never collide, and mirror
  // the hooks' echo-drops by removing ids that vanished since the last tick.
  const voiceSeenRef = React.useRef<Set<string>>(new Set());
  // RANDOM namespace, re-minted per session. It must be unique across overlay
  // remounts AND hook restarts: with a resettable numeric counter, a session
  // restarted mid-conversation (dev Fast Refresh, error recovery) re-issued
  // turn ids from 1 under the SAME namespace — its rows then patched an
  // earlier session's history rows in place and the diff removed/re-appended
  // others, scrambling who/text/order in the shared chat.
  const voiceSessionKeyRef = React.useRef("");
  const prevSessionNonceRef = React.useRef(sessionNonce);
  const prevVoiceModeRef = React.useRef(voiceModeForOpen);
  const prevVoiceSerialRef = React.useRef(-1);
  React.useEffect(() => {
    // A NEW namespace is minted only while a session is genuinely (re)starting
    // — overlay open and the voice mode resolved. Re-minting while closed (the
    // toggle-close nonce bump) or before the mode resolves would re-mirror the
    // previous session's stale rows under fresh ids, duplicating history.
    if (
      open &&
      voiceModeForOpen !== null &&
      (!voiceSessionKeyRef.current ||
        sessionNonce !== prevSessionNonceRef.current ||
        voiceModeForOpen !== prevVoiceModeRef.current ||
        voiceState.sessionSerial !== prevVoiceSerialRef.current)
    ) {
      prevSessionNonceRef.current = sessionNonce;
      prevVoiceModeRef.current = voiceModeForOpen;
      prevVoiceSerialRef.current = voiceState.sessionSerial;
      voiceSessionKeyRef.current = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      voiceSeenRef.current = new Set();
    }
    // Nothing mirrored yet this overlay instance (e.g. remounted while
    // closed): stay hands-off so finished history is never rewritten.
    if (!voiceSessionKeyRef.current) return;
    const sid = voiceSessionKeyRef.current;
    const currentIds = new Set<string>();
    for (const turn of voiceState.turns) {
      const storeId = `voice-${sid}-${turn.id}`;
      currentIds.add(storeId);
      chatUpsertTurn({
        id: storeId,
        who: turn.who,
        text: turn.text,
        live: turn.live,
        detail: turn.detail,
        source: "voice",
      });
    }
    for (const prevId of voiceSeenRef.current) {
      if (!currentIds.has(prevId)) chatRemoveTurn(prevId);
    }
    voiceSeenRef.current = currentIds;
  }, [voiceState.turns, voiceState.sessionSerial, sessionNonce, open, voiceModeForOpen, chatUpsertTurn, chatRemoveTurn]);

  const [detailContent, setDetailContent] = React.useState<string | null>(null);
  // Auto-open the transaction modal when a card needing a decision arrives, then
  // auto-close it once the user responds (by voice, typed, or a modal button).
  // `autoShownRef` tracks the last card we auto-opened so dismissing it doesn't
  // immediately re-open it; `detailForTurnRef` is the turn the modal is showing.
  const autoShownRef = React.useRef<string | null>(null);
  const detailForTurnRef = React.useRef<string | null>(null);
  const closeDetail = React.useCallback(() => {
    detailForTurnRef.current = null;
    setDetailContent(null);
  }, []);
  const handleDetailAction = React.useCallback(
    (say: string) => {
      detailForTurnRef.current = null;
      setDetailContent(null);
      // Same path as speaking/typing it: the route's confirm rails finalize the
      // pending draft. Speaking still works; this just gives an on-screen option.
      void chat.sendText(say);
    },
    [chat],
  );
  React.useEffect(() => {
    const turns = chat.turns;
    // Auto-close once the user has FINISHED responding to the shown transaction.
    // The interim caption row is a live "you" turn added the instant speech
    // starts; only a finalized (committed) user turn should dismiss the modal,
    // otherwise it closes mid-utterance. Symmetric with the auto-open guard below.
    if (detailForTurnRef.current) {
      const shownIdx = turns.findIndex((t) => t.id === detailForTurnRef.current);
      if (shownIdx >= 0 && turns.slice(shownIdx + 1).some((t) => t.who === "you" && !t.live && !t.pending)) {
        detailForTurnRef.current = null;
        setDetailContent(null);
        return;
      }
    }
    // Auto-open the newest finalized transaction card that still needs a decision.
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (turn.who !== "queen" || turn.live || turn.pending) continue;
      if (!needsConfirmation(turn.detail)) continue;
      if (autoShownRef.current === turn.id) break; // already shown or dismissed
      autoShownRef.current = turn.id;
      detailForTurnRef.current = turn.id;
      setDetailContent(turn.detail ?? null);
      break;
    }
  }, [chat.turns]);
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let lastToggleAt = 0;
    void listenForQueenVoiceToggle(() => {
      // The desktop shell can deliver one menu click as two events.
      const now = Date.now();
      if (now - lastToggleAt < 300) return;
      lastToggleAt = now;
      toggleQueenVoiceChat();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [toggleQueenVoiceChat]);

  // Mirror the open/closed state out to peripheral controls (the "Message the
  // hive" pill's voice toggle) so they reflect whether voice mode is active —
  // including closes via Escape, the overlay's own controls, or clap-wake.
  React.useEffect(() => {
    emitQueenVoiceState(open);
  }, [open]);

  React.useEffect(() => {
    if (!open && detailContent === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The details modal closes first; a second Escape ends a live voice chat.
      if (detailContent !== null) closeDetail();
      else if (open) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, detailContent, closeDetail]);

  if (typeof document === "undefined") return null;
  // Always-mounted: the transcript shows for typed turns too, not just voice.
  if (!open && chat.turns.length === 0) return null;

  return createPortal(
    <>
      {open ? <QueenVoiceGlow active={open} /> : null}
      <div
        className={styles.overlayShell}
        // The transcript stack shares the same open-space inset as the app-wide
        // chat dock so its minimized FAB stays aligned across route layouts.
        style={{
          paddingBottom: HIVE_CHAT_TRANSCRIPT_BOTTOM_OFFSET,
          right: openSpaceRightInset,
        }}
        role="dialog"
        aria-label="Queen Bee voice chat"
      >
        <TranscriptTurns
          turns={chat.turns}
          minimized={!chat.transcriptExpanded}
          thinking={open && voiceState.phase === "thinking"}
          brainLabel={brainLabel}
          // Live stages only exist on the pipeline hook; the realtime session
          // streams its own tool audio cues.
          working={voiceModeForOpen === "pipeline" ? pipeline.working : []}
          onShowDetail={setDetailContent}
          onCollapse={() => setHistoryMinimized(true)}
        />
        {detailContent !== null ? (
          <div
            className={styles.detailBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="Queen Bee details"
            onClick={closeDetail}
          >
            <div
              className={styles.detailModal}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.detailModalHeader}>
                <span className={styles.detailModalTitle}>
                  <Crown size={14} aria-hidden="true" />
                  {detailModalTitle(detailContent)}
                </span>
                <button
                  type="button"
                  className={styles.detailModalClose}
                  onClick={closeDetail}
                  aria-label="Close details"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.detailModalBody}>
                <ChatMarkdown text={detailContent} />
              </div>
              {needsConfirmation(detailContent) ? (
                <div className={styles.detailModalActions}>
                  <button
                    type="button"
                    className={`${styles.detailAction} ${styles.detailActionConfirm}`}
                    onClick={() => handleDetailAction("confirm")}
                  >
                    <Check size={15} aria-hidden="true" />
                    Confirm
                  </button>
                  <button
                    type="button"
                    className={`${styles.detailAction} ${styles.detailActionDeny}`}
                    onClick={() => handleDetailAction("cancel")}
                  >
                    <X size={15} aria-hidden="true" />
                    Deny
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {voicePickerOpen && voiceModeForOpen === "realtime" ? (
          <VoicePicker
            onVoiceChanged={() => {
              // Restart the session so the new voice takes effect now.
              setVoicePickerOpen(false);
              setSessionNonce((current) => current + 1);
            }}
          />
        ) : null}
        {open ? (
          <div className={styles.controlBar}>
            <span className={styles.statusBadge}>
              <Crown size={14} aria-hidden="true" />
              <span
                className={`${styles.statusDot} ${statusDotClass(voiceState.phase)}`}
              />
              {statusLabel(voiceState.phase, muted, voiceState.speechDetected)}
            </span>
            <VoiceWaveform
              analyserRef={voiceState.micAnalyserRef}
              muted={muted}
            />

            {voiceState.phase === "error" && voiceState.error ? (
              <p className={styles.errorText}>{voiceState.error}</p>
            ) : null}
            {voiceModeForOpen === "pipeline" && pipeline.voiceNotice ? (
              // Voice continuity: her selected local voice is down, replies
              // are text-only until it recovers - keep that visible.
              <p className={styles.voiceNotice}>{pipeline.voiceNotice}</p>
            ) : null}
            {voiceModeForOpen === "realtime" ? (
              <button
                type="button"
                className={`${styles.controlButton} ${voicePickerOpen ? styles.controlButtonActive : ""}`}
                onClick={() => setVoicePickerOpen((current) => !current)}
                aria-label="Queen Bee voice settings"
              >
                <Settings2 size={14} aria-hidden="true" />
                Voice
              </button>
            ) : null}
            <button
              type="button"
              className={`${styles.controlButton} ${clapWakeEnabled ? styles.controlButtonWakeActive : ""}`}
              onClick={toggleClapWake}
              aria-label={clapWakeEnabled ? "Disable clap wake" : "Enable clap wake"}
              aria-pressed={clapWakeEnabled}
              title={clapWakeTitle(clapActivation.status, clapActivation.error)}
            >
              <AudioLines size={14} aria-hidden="true" />
              Clap
            </button>
            <button
              type="button"
              className={`${styles.controlButton} ${muted ? styles.controlButtonActive : ""}`}
              onClick={() => setMuted((current) => !current)}
            >
              {muted ? (
                <MicOff size={14} aria-hidden="true" />
              ) : (
                <Mic size={14} aria-hidden="true" />
              )}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              className={`${styles.controlButton} ${styles.controlButtonEnd}`}
              onClick={() => setOpen(false)}
            >
              <X size={14} aria-hidden="true" />
              End
            </button>
          </div>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
