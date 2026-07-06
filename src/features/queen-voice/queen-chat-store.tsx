"use client";

/* queen-chat-store.tsx — the single shared Queen conversation.
   Both the typed "Message the hive" pill and the voice overlay read/write this
   one turn history, so text and voice are one continuous chat. Typed messages
   run through `runQueenCommand` (= Bee Pilot's runVoiceCommand), which executes
   the same Cmd+B dashboard actions AND returns the Queen's spoken/text reply. */

import * as React from "react";
import {
  formatDashboardScreenContextForPrompt,
  type DashboardScreenContext,
} from "@/features/dashboard/screen-context";
import {
  findWorkBoardTasks,
  flattenKanbanColumns,
  formatWorkBoardTaskForPrompt,
  summarizeWorkBoardByStatus,
} from "@/features/dashboard/work-board-lookup";
import { fetchAgentStatusAnswer } from "@/features/dashboard/agent-status-fetch";
import { userAuthorizedHiveTaskCreation } from "@/lib/services/queen-bee/queen-brain";

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

type QueenChatContextValue = {
  turns: QueenChatTurn[];
  /** True when the chat history above the input is collapsed. Lifted here so
   *  the input's toggle tab and the transcript overlay share one source of
   *  truth — a typed send re-opens it; the tab and the bee's modals flip it. */
  historyMinimized: boolean;
  setHistoryMinimized: React.Dispatch<React.SetStateAction<boolean>>;
  /** Append a turn; returns its id. Pass an explicit id for the voice bridge. */
  appendTurn: (turn: Omit<QueenChatTurn, "id"> & { id?: string }) => string;
  updateTurn: (id: string, patch: Partial<QueenChatTurn>) => void;
  /** Insert if the id is new, otherwise patch in place (voice diff-sync). */
  upsertTurn: (turn: QueenChatTurn) => void;
  removeTurn: (id: string) => void;
  clear: () => void;
  /** Typed entry point: append the user turn, run the Queen, fill the reply. */
  sendText: (text: string, opts?: { screenContext?: DashboardScreenContext }) => Promise<void>;
};

const QueenChatContext = React.createContext<QueenChatContextValue | null>(null);

export function QueenChatProvider({
  runQueenCommand,
  children,
}: {
  runQueenCommand?: RunQueenCommand;
  children: React.ReactNode;
}) {
  const [turns, setTurns] = React.useState<QueenChatTurn[]>([]);
  // Whether the transcript history above the input is collapsed. Toggled by the
  // tab on the input pill; forced open on a typed send; forced closed when the
  // bee opens a modal (the overlay would otherwise cover it).
  const [historyMinimized, setHistoryMinimized] = React.useState(false);
  const counterRef = React.useRef(0);
  // Held in a ref so sendText's identity stays stable even though
  // beePilot.runVoiceCommand is recreated each render.
  const runRef = React.useRef<RunQueenCommand | undefined>(runQueenCommand);
  React.useEffect(() => {
    runRef.current = runQueenCommand;
  }, [runQueenCommand]);

  // OpenAI-format running history for the typed agentic loop (the system prompt
  // is added server-side). Kept in a ref so it persists without re-renders.
  const messagesRef = React.useRef<Array<Record<string, unknown>>>([]);
  // Serialise sends so concurrent tool loops never interleave the message log.
  const sendChainRef = React.useRef<Promise<void>>(Promise.resolve());

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

  const clear = React.useCallback(() => setTurns([]), []);

  // Execute one tool the Queen decided to call. drive_dashboard runs the
  // client-side Bee Pilot planner; the rest hit the existing voice-route actions.
  const executeQueenTool = React.useCallback(async (
    name: string,
    args: Record<string, unknown>,
    screenContext?: DashboardScreenContext,
  ) => {
    const post = async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return (await res.json().catch(() => null)) as Record<string, unknown> | null;
    };
    try {
      if (name === "drive_dashboard") {
        const run = runRef.current;
        const command = String(args.command ?? "").trim();
        if (!run || !command) return "The dashboard isn't available to drive right now.";
        return (await run(command, { screenContext }))?.trim() || "Done.";
      }
      if (name === "ask_hivemind_agent") {
        const data = await post({
          action: "agent-turn",
          message: withScreenContext(String(args.message ?? ""), screenContext),
          // Structured acting-wallet source so the executing agent defaults
          // sends/swaps/trades to the user's selected wallet (the prose context
          // only truncates the address; this carries the full identity).
          actingWallet: actingWalletSourceFromContext(screenContext),
        });
        // Prefer detail: for money-action cards the route now puts a short line in
        // `text` (read aloud in voice) and the full transaction card in `detail`,
        // which is what the typed brain needs to show the user what they're confirming.
        return String(data?.detail || data?.text || "Done.");
      }
      if (name === "create_hive_task") {
        const data = await post({
          action: "submit-task",
          title: args.title,
          message: withScreenContext(String(args.message ?? ""), screenContext),
        });
        return String(data?.summary || (data?.created ? `Created task "${String(data?.taskTitle ?? "")}".` : "Added it to the work board."));
      }
      if (name === "remember_preference") {
        await post({ action: "remember-preference", preference: String(args.preference ?? "") });
        return "Saved that preference.";
      }
      if (name === "read_work_board") {
        // Direct board read — the Queen answers task questions from the actual
        // record instead of delegating a lookup to a fleet agent.
        const res = await fetch("/api/kanban", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { columns?: unknown } | null;
        if (!res.ok || !data) return "The Work Board isn't reachable right now.";
        const tasks = flattenKanbanColumns(data.columns);
        const taskId = String(args.taskId ?? "").trim();
        const query = String(args.query ?? "").trim();
        if (!taskId && !query) return summarizeWorkBoardByStatus(tasks);
        const hits = findWorkBoardTasks(tasks, { taskId, query });
        if (!hits.length) {
          return `No Work Board task matched ${taskId || `"${query}"`}. ${summarizeWorkBoardByStatus(tasks)}`;
        }
        return hits.slice(0, 3).map(formatWorkBoardTaskForPrompt).join("\n\n");
      }
      if (name === "read_agent_status") {
        // Direct fleet read — the Queen answers "is HermesMain down / timing
        // out?" from live telemetry (and offers a fix when it's unhealthy)
        // instead of deflecting. Shared with the voice executor so both match.
        return fetchAgentStatusAnswer(String(args.agentName ?? ""));
      }
      return "Unknown tool.";
    } catch {
      return "That tool call didn't complete.";
    }
  }, []);

  // One agentic turn: the SAME brain as voice. The Queen chats, or calls tools;
  // we run the tools client-side and loop until she gives a final reply. Falls
  // back to the heuristic Bee Pilot planner when no tool-capable model exists.
  const runQueenTurn = React.useCallback(async (
    trimmed: string,
    queenId: string,
    screenContext?: DashboardScreenContext,
  ) => {
    const messages = messagesRef.current;
    if (messages.length > 24) messages.splice(0, messages.length - 24);
    messages.push({ role: "user", content: trimmed });

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
      const res = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "chat-turn-stream",
          messages,
          screenContext,
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
      const res = await fetch("/api/queen-bee/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "chat-turn",
          messages,
          screenContext,
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
        // also trigger the forced answer early (see answerNextRound).
        const forceAnswer = i === 3 || answerNextRound;
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
            const result = await executeQueenTool(tc.name, parsed, screenContext);
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
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

  const sendText = React.useCallback(
    async (text: string, opts?: { screenContext?: DashboardScreenContext }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // A fresh typed send always re-opens the history above the input.
      setHistoryMinimized(false);
      appendTurn({ who: "you", text: trimmed, source: "text" });
      const queenId = appendTurn({ who: "queen", text: "", live: true, pending: true, source: "text" });
      // Chain so overlapping sends don't interleave the OpenAI message log.
      const task = sendChainRef.current
        .catch(() => {})
        .then(() => runQueenTurn(trimmed, queenId, opts?.screenContext));
      sendChainRef.current = task;
      return task;
    },
    [appendTurn, runQueenTurn],
  );

  const value = React.useMemo<QueenChatContextValue>(
    () => ({ turns, historyMinimized, setHistoryMinimized, appendTurn, updateTurn, upsertTurn, removeTurn, clear, sendText }),
    [turns, historyMinimized, appendTurn, updateTurn, upsertTurn, removeTurn, clear, sendText],
  );

  return <QueenChatContext.Provider value={value}>{children}</QueenChatContext.Provider>;
}

export function useQueenChat(): QueenChatContextValue {
  const ctx = React.useContext(QueenChatContext);
  if (!ctx) throw new Error("useQueenChat must be used within a QueenChatProvider");
  return ctx;
}

function withScreenContext(message: string, screenContext?: DashboardScreenContext) {
  const context = formatDashboardScreenContextForPrompt(screenContext);
  const trimmed = message.trim();
  if (!context) return trimmed;
  return `${context}\n\nUser request: ${trimmed}`;
}

/** The acting wallet as a structured source hint for the executing agent's
 *  send/swap resolver — full address included (it is not regex-parsed here). */
function actingWalletSourceFromContext(screenContext?: DashboardScreenContext) {
  const wallet = screenContext?.actingWallet;
  if (!wallet?.id) return undefined;
  return {
    agentId: wallet.id,
    address: wallet.address || "",
    network: wallet.network || "",
    kind: wallet.kind || "",
  };
}
