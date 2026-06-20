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

export type QueenChatTurn = {
  id: string;
  who: "you" | "queen";
  text: string;
  /** Streaming / not-yet-final. */
  live?: boolean;
  /** Awaiting the Queen's reply (typed path). */
  pending?: boolean;
  /** Richer markdown findings, shown in a modal on demand. */
  detail?: string;
  source: "text" | "voice";
};

type RunQueenCommand = (
  command: string,
  opts?: { onModalOpen?: () => void; screenContext?: DashboardScreenContext },
) => Promise<string>;

type QueenChatContextValue = {
  turns: QueenChatTurn[];
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
        });
        return String(data?.text || data?.detail || "Done.");
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

    const heuristicFallback = async () => {
      const run = runRef.current;
      if (!run) {
        updateTurn(queenId, { text: "The Queen isn't reachable right now.", live: false, pending: false });
        return;
      }
      const reply = (await run(trimmed, { screenContext }))?.trim() || "Done.";
      updateTurn(queenId, { text: reply, live: false, pending: false });
      messages.push({ role: "assistant", content: reply });
    };

    try {
      for (let i = 0; i < 4; i += 1) {
        const res = await fetch("/api/queen-bee/voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "chat-turn", messages, screenContext }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          fallback?: boolean;
          content?: string;
          toolCalls?: Array<{ id: string; name: string; arguments: string }>;
          assistant?: Record<string, unknown>;
        } | null;
        if (!data || data.fallback || data.ok === false) {
          await heuristicFallback();
          return;
        }
        const toolCalls = Array.isArray(data.toolCalls) ? data.toolCalls : [];
        if (toolCalls.length) {
          if (data.content) updateTurn(queenId, { text: data.content, live: true, pending: false });
          if (data.assistant) messages.push(data.assistant);
          for (const tc of toolCalls) {
            let parsed: Record<string, unknown> = {};
            try { parsed = JSON.parse(tc.arguments || "{}"); } catch { parsed = {}; }
            const result = await executeQueenTool(tc.name, parsed, screenContext);
            messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          }
          continue; // loop back so she can read the tool results
        }
        const reply = data.content?.trim() || "Done.";
        updateTurn(queenId, { text: reply, live: false, pending: false });
        messages.push({ role: "assistant", content: reply });
        return;
      }
      // iteration cap reached — leave whatever she last said, stop the spinner
      updateTurn(queenId, { live: false, pending: false });
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
    () => ({ turns, appendTurn, updateTurn, upsertTurn, removeTurn, clear, sendText }),
    [turns, appendTurn, updateTurn, upsertTurn, removeTurn, clear, sendText],
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
