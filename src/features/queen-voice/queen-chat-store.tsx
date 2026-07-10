"use client";

/* queen-chat-store.tsx — the single shared Queen conversation.
   Both the typed "Message the hive" pill and the voice overlay read/write this
   one turn history, so text and voice are one continuous chat. Shared typed
   messages start with the Queen voice conversation lane for the same concise
   answer style; the legacy text-chat route remains a closed-composer fallback.
   Bee Pilot is used only when Queen explicitly calls the drive_dashboard tool
   or when no chat brain is reachable for a simple dashboard navigation fallback. */

import * as React from "react";
import type { DashboardScreenContext } from "@/features/dashboard/screen-context";
import {
  findWorkBoardTasks,
  flattenKanbanColumns,
  formatWorkBoardTaskForPrompt,
  isPlainWorkBoardNavigationCommand,
  isWorkBoardPipelineQuestion,
  summarizeWorkBoardByStatus,
  summarizeWorkBoardForNavigation,
  summarizeWorkBoardPipeline,
} from "@/features/dashboard/work-board-lookup";
import { fetchAgentStatusAnswer } from "@/features/dashboard/agent-status-fetch";
import {
  isHivemindFastContextCommand,
  isWalletReadinessCommand,
  isTrivialConversationalTurn,
  userAuthorizedHiveTaskCreation,
} from "@/lib/services/queen-bee/queen-brain";
import { logClientTelemetry } from "@/lib/utils/client-telemetry";
import {
  actingWalletSourceFromContext,
  fetchHivemindFastContext,
  fetchWalletReadiness,
  withScreenContext,
} from "./queen-fast-context";
import {
  QUEEN_TEXT_CHAT_API_PATH,
  QUEEN_VOICE_CHAT_API_PATH,
  queenChatRouteForSend,
  queenVoiceHistoryBeforeTurn,
  type QueenVoiceHistoryTurn,
} from "./queen-chat-routing";
import {
  createNdjsonEventReader,
  type ConverseStreamEvent,
} from "./converse-stream";
import { playSpokenReply } from "./spoken-reply-playback";
import { transcriptCommandUrl } from "@/features/dashboard/hooks/status-chat-transcript";
import { looksLikeXPost } from "@/lib/services/x-transcript/x-url";
import type { XTranscriptResult } from "@/lib/services/x-transcript/x-transcript-service";

export type QueenChatTurn = {
  id: string;
  who: "you" | "queen";
  text: string;
  /** Streaming / not-yet-final. */
  live?: boolean;
  /** Awaiting the Queen's reply (typed path). */
  pending?: boolean;
  /** Live tool-phase status label (typed path) — drives the per-turn bee
   *  thinking loader while a tool runs, e.g. "Asking a hive agent…". */
  working?: string;
  /** Richer markdown findings, shown in a modal on demand. */
  detail?: string;
  /** Which brain actually answered this turn (e.g. "gpt-4o-mini · OpenAI"),
   *  reported by the chat-turn response — per-turn truth, unlike the overlay's
   *  static voice-brain tag. */
  brain?: string;
  /** Set when the Queen's CONFIGURED brain did NOT answer this turn and another
   *  lane replied instead: `label` names the skipped brain, `error` says why
   *  (e.g. "…free allowance is used up"). The typed chat has no degradation
   *  alert like voice, so without this the swap to `brain` is invisible — the
   *  user thinks their selected model answered when it didn't. */
  brainFallback?: { label: string; error: string };
  source: "text" | "voice";
};

type RunQueenCommand = (
  command: string,
  opts?: { onModalOpen?: () => void; screenContext?: DashboardScreenContext },
) => Promise<string>;

type QueenChatSendOptions = {
  screenContext?: DashboardScreenContext;
  suppressWalletIntents?: boolean;
};

type QueenChatContextValue = {
  turns: QueenChatTurn[];
  /** True when the chat history above the input is collapsed. Lifted here so
   *  the input's toggle tab and the transcript overlay share one source of
   *  truth for manual pin/collapse. Hover/focus/recent activity can still
   *  temporarily expand the transcript through transcriptExpanded. */
  historyMinimized: boolean;
  setHistoryMinimized: (minimized: boolean) => void;
  /** True while the app-wide chat pill is hovered or its input is focused. */
  composerActive: boolean;
  setComposerActive: (active: boolean) => void;
  /** True while the transcript bubble itself is hovered or text is being selected. */
  transcriptInteractionActive: boolean;
  setTranscriptInteractionActive: (active: boolean) => void;
  /** True while the Queen Bee voice chat overlay is open. */
  voiceChatActive: boolean;
  setVoiceChatActive: (active: boolean) => void;
  /** Effective visibility: manual pin, user interaction, active thinking, or recent message hold. */
  transcriptExpanded: boolean;
  /** Append a turn; returns its id. Pass an explicit id for the voice bridge. */
  appendTurn: (turn: Omit<QueenChatTurn, "id"> & { id?: string }) => string;
  updateTurn: (id: string, patch: Partial<QueenChatTurn>) => void;
  /** Insert if the id is new, otherwise patch in place (voice diff-sync). */
  upsertTurn: (turn: QueenChatTurn) => void;
  removeTurn: (id: string) => void;
  clear: () => void;
  /** Shared typed entry point: append the user turn, run the voice-quality Queen lane, fill the reply. */
  sendText: (text: string, opts?: QueenChatSendOptions) => Promise<void>;
};

const QueenChatContext = React.createContext<QueenChatContextValue | null>(null);
const QUEEN_CHAT_RECENT_MESSAGE_HOLD_MS = 7000;

function isAutoOpenAgentTurn(turn: QueenChatTurn): boolean {
  return turn.who === "queen" && Boolean(turn.live || turn.pending || turn.working);
}

function findAutoOpenDismissalTurnId(turns: QueenChatTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (isAutoOpenAgentTurn(turn)) return turn.id;
  }
  return turns.at(-1)?.id ?? null;
}

export function QueenChatProvider({
  runQueenCommand,
  children,
}: {
  runQueenCommand?: RunQueenCommand;
  children: React.ReactNode;
}) {
  const [turns, setTurns] = React.useState<QueenChatTurn[]>([]);
  const turnsRef = React.useRef<QueenChatTurn[]>([]);
  React.useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  // Whether the transcript history above the input is manually collapsed. It
  // starts collapsed; hover/focus/recent turns can expand it without pinning it.
  const [historyMinimized, setHistoryMinimizedState] = React.useState(true);
  const [composerActive, setComposerActive] = React.useState(false);
  const [transcriptInteractionActive, setTranscriptInteractionActive] = React.useState(false);
  const [voiceChatActive, setVoiceChatActiveState] = React.useState(false);
  const [recentMessageOpen, setRecentMessageOpen] = React.useState(false);
  const [dismissedAutoOpenTurnId, setDismissedAutoOpenTurnId] = React.useState<string | null>(null);
  const lastActivitySignatureRef = React.useRef("");
  const recentOpenTimerRef = React.useRef<number | null>(null);
  const recentCloseTimerRef = React.useRef<number | null>(null);
  const counterRef = React.useRef(0);
  const voiceChatActiveRef = React.useRef(false);
  const voiceTextAudioContextRef = React.useRef<AudioContext | null>(null);
  // Held in a ref so sendText's identity stays stable even though
  // beePilot.runVoiceCommand is recreated each render.
  const runRef = React.useRef<RunQueenCommand | undefined>(runQueenCommand);
  React.useEffect(() => {
    runRef.current = runQueenCommand;
  }, [runQueenCommand]);

  const setVoiceChatActive = React.useCallback((active: boolean) => {
    voiceChatActiveRef.current = active;
    setVoiceChatActiveState(active);
  }, []);

  const ensureVoiceTextAudioContext = React.useCallback(() => {
    if (typeof window === "undefined") return null;
    if (voiceTextAudioContextRef.current) {
      void voiceTextAudioContextRef.current.resume().catch(() => undefined);
      return voiceTextAudioContextRef.current;
    }
    const audioWindow = window as Window &
      typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioContextClass = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      const context = new AudioContextClass({ latencyHint: "interactive" });
      voiceTextAudioContextRef.current = context;
      void context.resume().catch(() => undefined);
      return context;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => () => {
    const context = voiceTextAudioContextRef.current;
    voiceTextAudioContextRef.current = null;
    void context?.close().catch(() => undefined);
  }, []);

  // OpenAI-format running history for the typed agentic loop (the system prompt
  // is added server-side). Kept in a ref so it persists without re-renders.
  const messagesRef = React.useRef<Array<Record<string, unknown>>>([]);
  // Serialise sends so concurrent tool loops never interleave the message log.
  const sendChainRef = React.useRef<Promise<void>>(Promise.resolve());

  const clearRecentMessageTimers = React.useCallback(() => {
    if (recentOpenTimerRef.current !== null) {
      window.clearTimeout(recentOpenTimerRef.current);
      recentOpenTimerRef.current = null;
    }
    if (recentCloseTimerRef.current !== null) {
      window.clearTimeout(recentCloseTimerRef.current);
      recentCloseTimerRef.current = null;
    }
  }, []);

  const clearRecentMessageHold = React.useCallback(() => {
    clearRecentMessageTimers();
    setRecentMessageOpen(false);
  }, [clearRecentMessageTimers]);

  const setHistoryMinimized = React.useCallback((minimized: boolean) => {
    if (minimized) {
      setDismissedAutoOpenTurnId(findAutoOpenDismissalTurnId(turnsRef.current));
      clearRecentMessageHold();
    } else {
      setDismissedAutoOpenTurnId(null);
    }
    setHistoryMinimizedState(minimized);
  }, [clearRecentMessageHold]);

  const appendTurn = React.useCallback(
    (turn: Omit<QueenChatTurn, "id"> & { id?: string }) => {
      const id = turn.id ?? `text-${(counterRef.current += 1)}`;
      setTurns((prev) => {
        // a new live turn supersedes any earlier still-live turn
        const base = turn.live ? prev.map((t) => (t.live ? { ...t, live: false } : t)) : prev;
        return [...base, { ...turn, id }];
      });
      return id;
    },
    [],
  );

  const updateTurn = React.useCallback((id: string, patch: Partial<QueenChatTurn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const upsertTurn = React.useCallback((turn: QueenChatTurn) => {
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === turn.id);
      if (idx === -1) return [...prev, turn];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...turn };
      return next;
    });
  }, []);

  const removeTurn = React.useCallback((id: string) => {
    setTurns((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = React.useCallback(() => {
    setTurns([]);
    setDismissedAutoOpenTurnId(null);
    clearRecentMessageHold();
  }, [clearRecentMessageHold]);

  const latestTurn = turns.at(-1);
  const recentActivitySignature = latestTurn
    ? [
        turns.length,
        latestTurn.id,
        latestTurn.who,
        latestTurn.text,
        latestTurn.live ? "live" : "",
        latestTurn.pending ? "pending" : "",
        latestTurn.working ?? "",
        latestTurn.detail ?? "",
      ].join("\u001f")
    : "";

  React.useEffect(() => {
    if (!latestTurn || !recentActivitySignature) {
      lastActivitySignatureRef.current = "";
      clearRecentMessageTimers();
      return undefined;
    }
    if (lastActivitySignatureRef.current === recentActivitySignature) return undefined;
    lastActivitySignatureRef.current = recentActivitySignature;
    if (dismissedAutoOpenTurnId === latestTurn.id) return undefined;

    clearRecentMessageTimers();
    const openTimer = window.setTimeout(() => {
      recentOpenTimerRef.current = null;
      setRecentMessageOpen(true);
    }, 0);
    const closeTimer = window.setTimeout(() => {
      recentCloseTimerRef.current = null;
      setRecentMessageOpen(false);
    }, QUEEN_CHAT_RECENT_MESSAGE_HOLD_MS);
    recentOpenTimerRef.current = openTimer;
    recentCloseTimerRef.current = closeTimer;
    return () => {
      if (recentOpenTimerRef.current === openTimer) {
        window.clearTimeout(openTimer);
        recentOpenTimerRef.current = null;
      }
      if (recentCloseTimerRef.current === closeTimer) {
        window.clearTimeout(closeTimer);
        recentCloseTimerRef.current = null;
      }
    };
  }, [latestTurn, recentActivitySignature, dismissedAutoOpenTurnId, clearRecentMessageTimers]);

  // Execute one tool the Queen decided to call. drive_dashboard runs the
  // client-side Bee Pilot planner; the rest hit the existing voice-route actions.
  const executeQueenTool = React.useCallback(async (
    name: string,
    args: Record<string, unknown>,
    screenContext?: DashboardScreenContext,
    suppressWalletIntents = false,
  ) => {
    const toolStartedAt = Date.now();
    const finishTool = (result: string, extra: Record<string, unknown> = {}) => {
      logClientTelemetry("queen_chat.tool", {
        toolName: name,
        ok: true,
        elapsedMs: Date.now() - toolStartedAt,
        resultChars: result.length,
        ...extra,
      });
      return result;
    };
    const failTool = (error: unknown) => {
      logClientTelemetry("queen_chat.tool", {
        toolName: name,
        ok: false,
        elapsedMs: Date.now() - toolStartedAt,
        error: error instanceof Error ? error.message : String(error || "unknown error"),
      });
      return "That tool call didn't complete.";
    };
    const post = async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return (await res.json().catch(() => null)) as Record<string, unknown> | null;
    };
    const readWorkBoardTasks = async () => {
      const res = await fetch("/api/kanban", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { columns?: unknown } | null;
      if (!res.ok || !data) return null;
      return flattenKanbanColumns(data.columns);
    };
    try {
      if (name === "drive_dashboard") {
        const run = runRef.current;
        const command = String(args.command ?? "").trim();
        if (!run || !command) return finishTool("The dashboard isn't available to drive right now.");
        const reply = (await run(command, { screenContext }))?.trim() || "Done.";
        if (isPlainWorkBoardNavigationCommand(command)) {
          const tasks = await readWorkBoardTasks();
          return finishTool(tasks ? summarizeWorkBoardForNavigation(tasks) : reply || "Opened Work.");
        }
        return finishTool(reply);
      }
      if (name === "read_hivemind_context") {
        const result = await fetchHivemindFastContext(String(args.query ?? ""), screenContext);
        return finishTool(result, { directRoute: "hivemind-fast-context" });
      }
      if (name === "read_wallet_readiness") {
        const result = await fetchWalletReadiness(screenContext);
        return finishTool(result, { directRoute: "wallet-readiness" });
      }
      if (name === "ask_hivemind_agent") {
        const message = String(args.message ?? "");
        if (isWalletReadinessCommand(message)) {
          const result = await fetchWalletReadiness(screenContext);
          return finishTool(result, { directRoute: "wallet-readiness" });
        }
        if (isHivemindFastContextCommand(message)) {
          const result = await fetchHivemindFastContext(message, screenContext);
          return finishTool(result, { directRoute: "hivemind-fast-context" });
        }
        const data = await post({
          action: "agent-turn",
          message: withScreenContext(message, screenContext),
          suppressWalletIntents,
          // Structured acting-wallet source so the executing agent defaults
          // sends/swaps/trades to the user's selected wallet (the prose context
          // only truncates the address; this carries the full identity).
          actingWallet: actingWalletSourceFromContext(screenContext),
        });
        // Prefer detail: for money-action cards the route now puts a short line in
        // `text` (read aloud in voice) and the full transaction card in `detail`,
        // which is what the typed brain needs to show the user what they're confirming.
        return finishTool(String(data?.detail || data?.text || "Done."));
      }
      if (name === "create_hive_task") {
        const data = await post({
          action: "submit-task",
          title: args.title,
          message: withScreenContext(String(args.message ?? ""), screenContext),
        });
        return finishTool(String(data?.summary || (data?.created ? `Created task "${String(data?.taskTitle ?? "")}".` : "Added it to the work board.")));
      }
      if (name === "remember_preference") {
        await post({ action: "remember-preference", preference: String(args.preference ?? "") });
        return finishTool("Saved that preference.");
      }
      if (name === "read_work_board") {
        // Direct board read — the Queen answers task questions from the actual
        // record instead of delegating a lookup to a fleet agent.
        const tasks = await readWorkBoardTasks();
        if (!tasks) return finishTool("The Work Board isn't reachable right now.");
        const taskId = String(args.taskId ?? "").trim();
        const query = String(args.query ?? "").trim();
        if (!taskId && !query) return finishTool(summarizeWorkBoardByStatus(tasks));
        if (!taskId && isWorkBoardPipelineQuestion(query)) return finishTool(summarizeWorkBoardPipeline(tasks));
        const hits = findWorkBoardTasks(tasks, { taskId, query });
        if (!hits.length) {
          return finishTool(`No Work Board task matched ${taskId || `"${query}"`}. ${summarizeWorkBoardByStatus(tasks)}`);
        }
        return finishTool(hits.slice(0, 3).map(formatWorkBoardTaskForPrompt).join("\n\n"));
      }
      if (name === "read_agent_status") {
        // Direct fleet read — the Queen answers "is HermesMain down / timing
        // out?" from live telemetry (and offers a fix when it's unhealthy)
        // instead of deflecting. Shared with the voice executor so both match.
        return finishTool(await fetchAgentStatusAnswer(String(args.agentName ?? "")));
      }
      return finishTool("Unknown tool.");
    } catch (error) {
      return failTool(error);
    }
  }, []);

  // One agentic turn: the SAME brain as voice. The Queen chats, or calls tools;
  // we run the tools client-side and loop until she gives a final reply. Falls
  // back to the heuristic Bee Pilot planner when no tool-capable model exists.
  const runQueenTurn = React.useCallback(async (
    trimmed: string,
    queenId: string,
    screenContext?: DashboardScreenContext,
    suppressWalletIntents = false,
  ) => {
    const messages = messagesRef.current;
    if (messages.length > 24) messages.splice(0, messages.length - 24);
    messages.push({ role: "user", content: trimmed });

    // A bare greeting / chit-chat ("hi", "thanks", "how are you") needs no
    // tools. Scout ignores that instruction and fires read_work_board on a
    // plain "hi", producing a greeting → tool-spin → second unsolicited
    // paragraph (2026-07-06). Force the FIRST round to answer without tools so
    // a greeting is one clean reply. Compound messages ("hey queen, is X
    // down?") are NOT trivial and still run tools normally.
    const trivialTurn = isTrivialConversationalTurn(trimmed);

    const heuristicFallback = async (serverError?: string) => {
      const run = runRef.current;
      if (!run) {
        updateTurn(queenId, { text: "The Queen isn't reachable right now.", live: false, pending: false });
        return;
      }
      const reply = (await run(trimmed, { screenContext }))?.trim() || "Done.";
      updateTurn(queenId, {
        text: reply,
        live: false,
        pending: false,
        // No chat model answered this turn — the configured brain failed AND
        // there was no working fallback lane (e.g. no OpenAI key at all, so not
        // even gpt-4o-mini is available). This reply is the built-in on-device
        // planner, not the selected model; declare it rather than passing it off.
        brainFallback: {
          label: "Your selected model",
          error: serverError?.trim() || "No chat model was reachable, so this reply came from the built-in planner.",
        },
      });
      messages.push({ role: "assistant", content: reply });
    };

    // Human-readable status shown in the live turn while a tool runs — the
    // silent 15-20s "thinking" gap was the tool phase, not the model.
    const toolStatus = (name: string) => ({
      drive_dashboard: "Driving the dashboard…",
      ask_hivemind_agent: "Asking a hive agent…",
      create_hive_task: "Creating the Work Board task…",
      remember_preference: "Saving that preference…",
      read_hivemind_context: "Reading app and brain context…",
      read_wallet_readiness: "Checking wallet readiness…",
      read_work_board: "Checking the Work Board…",
      read_agent_status: "Checking agent status…",
    } as Record<string, string>)[name] ?? "Working on it…";

    // Carry the server's "your configured brain was skipped, here's why" note
    // onto the turn so the swap is never silent. `{}` when the configured brain
    // answered normally (nothing to warn about).
    const asBrainFallback = (bf?: { label?: string; error?: string }) =>
      bf?.label ? { brainFallback: { label: bf.label, error: String(bf.error || "") } } : {};

    // Displayed text ACCUMULATES across tool-loop iterations. Brains that talk
    // and call tools in the same turn across several rounds (Scout does;
    // gpt-4o-mini rarely) previously had their shown words REPLACED by each
    // later round's — often empty — content: the reply flashed, vanished into
    // the thinking bee, then a "different" reply appeared (or a blank one at
    // the iteration cap). Nothing the user has read may disappear.
    let shownText = "";
    const appendShown = (next?: string) => {
      const trimmed = next?.trim() || "";
      if (trimmed) shownText = shownText ? `${shownText}\n\n${trimmed}` : trimmed;
      return shownText;
    };

    // Scout re-calls the SAME tool with the SAME args round after round (three
    // read_agent_status rounds on one "hi", 2026-07-06) — a repeat gets a
    // synthetic tool result instead of re-executing, and the next round forces
    // prose rather than burning the remaining budget on the spin.
    const executedToolCalls = new Set<string>();
    let answerNextRound = false;

    // One model turn over the streaming action: renders deltas into the live
    // turn as they arrive and resolves with the same shape the blocking
    // chat-turn returns. Resolves null when the server says to fall back.
    const streamOneTurn = async (forceAnswer: boolean): Promise<{
      ok?: boolean;
      fallback?: boolean;
      error?: string;
      content?: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      assistant?: Record<string, unknown>;
      brainLabel?: string;
      brainFallback?: { label?: string; error?: string };
    } | null> => {
      const res = await fetch(QUEEN_TEXT_CHAT_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "chat-turn-stream",
          messages,
          screenContext,
          suppressWalletIntents,
          // Budget spent: the server omits the tools so the brain must answer
          // in prose (tool-happy brains otherwise loop until the cap).
          ...(forceAnswer ? { toolChoice: "none" } : {}),
        }),
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || !type.includes("ndjson")) return null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      // Deltas render AFTER anything already shown from earlier tool rounds.
      const shownPrefix = shownText ? `${shownText}\n\n` : "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(raw); } catch { continue; }
          if (typeof event.delta === "string" && event.delta) {
            accumulated += event.delta;
            // Real text is streaming again — drop any lingering tool-phase bee.
            updateTurn(queenId, { text: shownPrefix + accumulated, live: true, pending: false, working: undefined });
            continue;
          }
          if (event.done) {
            return event as { content?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }>; assistant?: Record<string, unknown>; brainLabel?: string; brainFallback?: { label?: string; error?: string } };
          }
          if (event.ok === false || event.fallback) return null;
        }
      }
      return null; // stream ended without a terminal frame — retry blocking
    };

    const blockingTurn = async (forceAnswer: boolean) => {
      const res = await fetch(QUEEN_TEXT_CHAT_API_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "chat-turn",
          messages,
          screenContext,
          suppressWalletIntents,
          ...(forceAnswer ? { toolChoice: "none" } : {}),
        }),
      });
      return (await res.json().catch(() => null)) as {
        ok?: boolean;
        fallback?: boolean;
        error?: string;
        content?: string;
        toolCalls?: Array<{ id: string; name: string; arguments: string }>;
        assistant?: Record<string, unknown>;
        brainLabel?: string;
        brainFallback?: { label?: string; error?: string };
      } | null;
    };

    try {
      for (let i = 0; i < 4; i += 1) {
        // Last round: force a prose answer so the turn always ends with real
        // text instead of hitting the cap mid-tool-loop. Repeated tool calls
        // also trigger the forced answer early (see answerNextRound). A bare
        // greeting forces prose on the FIRST round — no tools at all.
        const forceAnswer = i === 3 || answerNextRound || (i === 0 && trivialTurn);
        const data = (await streamOneTurn(forceAnswer).catch(() => null)) ?? (await blockingTurn(forceAnswer));
        if (!data || data.fallback || data.ok === false) {
          await heuristicFallback(data && typeof data.error === "string" ? data.error : undefined);
          return;
        }
        const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : [];
        if (toolCalls.length) {
          if (data.assistant) messages.push(data.assistant);
          // Append this round's prose once (all this round's tool calls share
          // it) — earlier rounds' words stay on screen through the tool phase.
          const shown = appendShown(data.content);
          for (const tc of toolCalls) {
            // Propose-then-confirm is enforced MECHANICALLY here: Scout
            // ignored the instruction layer and queued a "Fix agent errors"
            // task off a bare "hi" (2026-07-06). Unless the user's current
            // message asks for work or affirms her pending offer, the call
            // becomes a proposal she must put to the user in prose.
            if (tc.name === "create_hive_task" && !userAuthorizedHiveTaskCreation(trimmed)) {
              answerNextRound = true;
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content:
                  "NOT created — the user has not asked for this work. Tell them what you found and ASK whether to queue this task; create it only after they explicitly say yes.",
              });
              continue;
            }
            const callKey = `${tc.name}:${(tc.arguments || "{}").trim()}`;
            if (executedToolCalls.has(callKey)) {
              answerNextRound = true;
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content:
                  "This exact tool call already ran this turn — its result is above. Answer the user in plain language now.",
              });
              continue;
            }
            executedToolCalls.add(callKey);
            let parsed: Record<string, unknown> = {};
            try { parsed = JSON.parse(tc.arguments || "{}"); } catch { parsed = {}; }
            // Narrate the tool phase in the live turn instead of dead air: the
            // status drives a per-turn bee loader (see QueenBeeVoiceOverlay), so
            // it must NOT be embedded in the markdown text — the chat renderer
            // has no underscore-italic rule and would print the `_` literally.
            updateTurn(queenId, {
              text: shown,
              working: toolStatus(tc.name),
              live: true,
              pending: false,
              ...(data.brainLabel ? { brain: data.brainLabel } : {}),
              ...asBrainFallback(data.brainFallback),
            });
            const result = await executeQueenTool(tc.name, parsed, screenContext, suppressWalletIntents);
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
            if (tc.name === "drive_dashboard" && isPlainWorkBoardNavigationCommand(String(parsed.command ?? trimmed))) {
              const reply = String(result || "").trim() || "Opened Work.";
              updateTurn(queenId, {
                text: reply,
                live: false,
                pending: false,
                working: undefined,
                ...(data.brainLabel ? { brain: data.brainLabel } : {}),
                ...asBrainFallback(data.brainFallback),
              });
              messages.push({ role: "assistant", content: reply });
              return;
            }
          }
          continue; // loop back so she can read the tool results
        }
        const replyText = appendShown(data.content);
        if (!replyText && !forceAnswer) {
          // No tool calls AND nothing shown all turn — usually a scrubbed
          // tool-call leak (server strips llama.cpp template markup). One
          // forced-prose retry beats ending the turn on a bare "Done.".
          answerNextRound = true;
          continue;
        }
        const reply = replyText || "Done.";
        updateTurn(queenId, {
          text: reply,
          live: false,
          pending: false,
          working: undefined,
          ...(data.brainLabel ? { brain: data.brainLabel } : {}),
          ...asBrainFallback(data.brainFallback),
        });
        // The conversation log keeps the model's OWN final words (not the
        // accumulated display text) so the next turn's history stays faithful.
        messages.push({ role: "assistant", content: data.content?.trim() || "Done." });
        return;
      }
      // Iteration cap reached — stop the spinner but never leave a blank
      // bubble: keep everything shown so far, or an honest minimal reply.
      updateTurn(queenId, { text: shownText || "Done.", live: false, pending: false, working: undefined });
    } catch {
      await heuristicFallback().catch(() => {
        updateTurn(queenId, { text: "I couldn't reach the Queen just now.", live: false, pending: false });
      });
    }
  }, [updateTurn, executeQueenTool]);

  const runQueenVoiceTextTurn = React.useCallback(async (
    trimmed: string,
    queenId: string,
    history: QueenVoiceHistoryTurn[],
    audioContext: AudioContext | null,
    options: { speak?: boolean } = {},
  ) => {
    const speakReply = async (reply: string) => {
      const text = reply.trim();
      if (!text) return;
      const abort = new AbortController();
      await playSpokenReply(text, abort.signal, audioContext, false).catch(() => "none");
    };
    const turnId = `text-voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const response = await fetch(QUEEN_VOICE_CHAT_API_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "converse-stream",
        transcript: trimmed,
        turnId,
        history,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(75_000),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !response.body || !contentType.includes("ndjson")) {
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        reply?: string;
        error?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.reply) {
        throw new Error(data?.error || `Queen Bee voice route returned HTTP ${response.status}.`);
      }
      updateTurn(queenId, {
        text: data.reply,
        live: false,
        pending: false,
        working: undefined,
      });
      if (options.speak !== false) await speakReply(data.reply);
      return;
    }

    const stream = createNdjsonEventReader<ConverseStreamEvent>(response.body);
    let liveSpeech = "";
    let finalReply = "";
    let error = "";
    const handleEvent = (event: ConverseStreamEvent) => {
      if (event.type === "speech" && event.text) {
        liveSpeech += event.text;
        updateTurn(queenId, {
          text: liveSpeech.trim(),
          live: true,
          pending: false,
          working: undefined,
        });
        return;
      }
      if (event.type === "reset") {
        liveSpeech = "";
        updateTurn(queenId, { text: "", live: true, pending: true, working: undefined });
        return;
      }
      if (event.type === "done") {
        finalReply = event.ok && event.reply ? event.reply : liveSpeech.trim();
        return;
      }
      if (event.type === "error") {
        error = event.error || "Queen Bee voice route failed.";
      }
    };
    while (await stream.pump()) {
      for (const event of stream.take()) handleEvent(event);
    }
    for (const event of stream.take()) handleEvent(event);
    if (error) throw new Error(error);
    const reply = finalReply || liveSpeech.trim();
    if (!reply) throw new Error("Queen Bee voice route returned no reply.");
    updateTurn(queenId, {
      text: reply,
      live: false,
      pending: false,
      working: undefined,
    });
    if (options.speak !== false) await speakReply(reply);
  }, [updateTurn]);

  // `/transcript <x-link>` from the hive pill. The main Chat view runs this in
  // its own controller; the pill routes straight to sendText, so it needs its
  // own handler. The Queen "says" the summary + follow-up (concise, in-bubble);
  // the full transcript rides in `detail` (the "Show what she found" modal).
  const runTranscriptCommand = React.useCallback(async (rawText: string, url: string) => {
    appendTurn({ who: "you", text: rawText, source: "text" });
    if (!url || !looksLikeXPost(url)) {
      appendTurn({
        who: "queen",
        text: "Add an X link after `/transcript`, for example `/transcript https://x.com/user/status/1780000000000000001`.",
        source: "text",
      });
      return;
    }
    const queenId = appendTurn({ who: "queen", text: "", live: true, pending: true, working: "Pulling the transcript…", source: "text" });
    try {
      const res = await fetch("/api/integrations/x-transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, summarize: true }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; result?: XTranscriptResult } | null;
      if (!res.ok || !data?.ok || !data.result) {
        throw new Error(data?.error || `Transcript request failed with HTTP ${res.status}.`);
      }
      const result = data.result;
      const meta = [
        result.author?.handle ? `@${result.author.handle}` : result.kind === "thread" ? "thread" : "post",
        result.durationSec ? `${Math.round(result.durationSec / 60)} min video` : typeof result.postCount === "number" && result.postCount > 1 ? `${result.postCount}-post thread` : "",
      ].filter(Boolean).join(" · ");
      const spoken = [result.summary, result.followUpQuestion].filter(Boolean).join("\n\n")
        || `Transcript ready${meta ? ` (${meta})` : ""}.`;
      const detail = `**Transcript${meta ? ` — ${meta}` : ""}**\n\n${result.transcript}`;
      updateTurn(queenId, { text: spoken, detail, live: false, pending: false, working: undefined });
    } catch (error) {
      updateTurn(queenId, {
        text: `I couldn't pull that transcript: ${error instanceof Error ? error.message : String(error)}`,
        live: false,
        pending: false,
        working: undefined,
      });
    }
  }, [appendTurn, updateTurn]);

  const sendText = React.useCallback(
    async (text: string, opts?: QueenChatSendOptions) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Intercept the /transcript slash command before the Queen agentic loop —
      // the pill has no other slash-command handler.
      const transcriptUrl = transcriptCommandUrl(trimmed);
      if (transcriptUrl !== null) return runTranscriptCommand(trimmed, transcriptUrl);
      const audioRoute = queenChatRouteForSend(voiceChatActiveRef.current);
      const shouldSpeakReply = audioRoute === "voice";
      const voiceTextAudioContext = shouldSpeakReply ? ensureVoiceTextAudioContext() : null;
      const userId = appendTurn({ who: "you", text: trimmed, source: "text" });
      const queenId = appendTurn({
        who: "queen",
        text: "",
        live: true,
        pending: true,
        source: "voice",
      });
      // Chain so overlapping sends don't interleave the OpenAI message log.
      const task = sendChainRef.current
        .catch(() => {})
        .then(() => {
          const history = queenVoiceHistoryBeforeTurn(turnsRef.current, userId);
          return runQueenVoiceTextTurn(trimmed, queenId, history, voiceTextAudioContext, {
            speak: shouldSpeakReply,
          }).catch((error) => {
            if (shouldSpeakReply) throw error;
            updateTurn(queenId, {
              text: "",
              live: true,
              pending: true,
              working: "Falling back to typed chat…",
              source: "text",
            });
            return runQueenTurn(trimmed, queenId, opts?.screenContext, opts?.suppressWalletIntents === true);
          });
        })
        .catch(() => {
          updateTurn(queenId, {
            text: shouldSpeakReply
              ? "I couldn't reach the Queen Bee voice route just now."
              : "I couldn't reach the Queen just now.",
            live: false,
            pending: false,
            working: undefined,
          });
        });
      sendChainRef.current = task;
      return task;
    },
    [appendTurn, ensureVoiceTextAudioContext, runQueenTurn, runQueenVoiceTextTurn, runTranscriptCommand, updateTurn],
  );

  const activeAgentTurn = React.useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (isAutoOpenAgentTurn(turn)) return turn;
    }
    return undefined;
  }, [turns]);
  const agentActivityOpen = Boolean(activeAgentTurn && dismissedAutoOpenTurnId !== activeAgentTurn.id);
  const transcriptExpanded =
    !historyMinimized
    || composerActive
    || transcriptInteractionActive
    || recentMessageOpen
    || agentActivityOpen;

  const value = React.useMemo<QueenChatContextValue>(
    () => ({
      turns,
      historyMinimized,
      setHistoryMinimized,
      composerActive,
      setComposerActive,
      transcriptInteractionActive,
      setTranscriptInteractionActive,
      voiceChatActive,
      setVoiceChatActive,
      transcriptExpanded,
      appendTurn,
      updateTurn,
      upsertTurn,
      removeTurn,
      clear,
      sendText,
    }),
    [
      turns,
      historyMinimized,
      setHistoryMinimized,
      composerActive,
      transcriptInteractionActive,
      voiceChatActive,
      setVoiceChatActive,
      transcriptExpanded,
      appendTurn,
      updateTurn,
      upsertTurn,
      removeTurn,
      clear,
      sendText,
    ],
  );

  return <QueenChatContext.Provider value={value}>{children}</QueenChatContext.Provider>;
}

export function useQueenChat(): QueenChatContextValue {
  const ctx = React.useContext(QueenChatContext);
  if (!ctx) throw new Error("useQueenChat must be used within a QueenChatProvider");
  return ctx;
}
