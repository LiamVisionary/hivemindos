"use client";

/**
 * PageAgentPanel — the reusable in-page agent surface (alibaba/page-agent).
 *
 * Constructs a headless Page Agent (its built-in vanilla-DOM Panel is disposed
 * right after construction — `agent.panel.dispose()` only removes its own DOM),
 * drives it through its events, and renders our own Queen-styled chat surface
 * (transcript bubbles + a purple-glow pill) plus a soft purple perimeter glow
 * while it runs.
 *
 * Used by the dev lab (`PageAgentLab`) and, once the "Page Agent" app is enabled,
 * mounted in the dashboard. Page Agent touches `window`/`document` at module
 * load, so the library is imported lazily inside the effect — the consuming
 * page must be client-only.
 *
 * SAFETY: `execute_javascript` is removed; callers pass an `interactiveBlacklist`
 * (CSS selectors the agent must never see/click) to keep money-moving controls
 * out of reach, and the dashboard mount additionally hides the panel on
 * transactional views.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Type-only import: erased at compile time, so it never runs page-agent's module
// code. The runtime import stays dynamic and client-only in the effect.
import type { PageAgent } from "page-agent";

import styles from "./page-agent-lab.module.css";

// Default tool-capable model routed through our proxy. (`openai/gpt-4o-mini` is
// blocked by this OpenRouter account's data policy; this open model is verified
// to work and follows page-agent's action schema reliably.)
export const DEFAULT_PAGE_AGENT_MODEL = "qwen/qwen3-235b-a22b-2507";

type AgentStatus = "idle" | "running" | "completed" | "error" | "stopped";

/** One rendered line in a run's transcript. */
type StepLine = { kind: "goal" | "result" | "error"; text: string };

/** One instruction the user gave + the agent's transcript for it. */
type ChatRun = { id: number; task: string; lines: StepLine[]; done: boolean };

export type PageAgentPanelProps = {
  /** Model id sent to the proxy. Defaults to a verified tool-capable model. */
  model?: string;
  /** Dock placement. "center" (lab) or "right" (dashboard, avoids the hive pill). */
  placement?: "center" | "right";
  /** When set, the input is disabled and this reason is shown (e.g. on a money view). */
  disabledReason?: string;
};

/** Collapse a page-agent history array into readable transcript lines. */
function linesFromHistory(history: readonly unknown[]): StepLine[] {
  const lines: StepLine[] = [];
  for (const raw of history) {
    const ev = raw as {
      type?: string;
      reflection?: { next_goal?: string };
      action?: { output?: string; name?: string };
      message?: string;
    };
    if (ev.type === "step") {
      const goal = ev.reflection?.next_goal?.trim();
      const output = ev.action?.output?.trim();
      if (goal) lines.push({ kind: "goal", text: goal });
      if (output) lines.push({ kind: "result", text: output });
    } else if (ev.type === "error") {
      if (ev.message) lines.push({ kind: "error", text: ev.message });
    }
  }
  return lines;
}

function activityLabel(activity: { type?: string; tool?: string } | null): string | null {
  if (!activity) return null;
  switch (activity.type) {
    case "thinking":
      return "Thinking…";
    case "executing":
      return activity.tool === "click_element_by_index"
        ? "Clicking…"
        : activity.tool === "input_text"
          ? "Typing…"
          : activity.tool === "select_dropdown_option"
            ? "Choosing…"
            : "Working…";
    case "retrying":
      return "Retrying…";
    default:
      return null;
  }
}

export function PageAgentPanel({
  model = DEFAULT_PAGE_AGENT_MODEL,
  placement = "center",
  disabledReason,
}: PageAgentPanelProps) {
  const agentRef = useRef<PageAgent | null>(null);
  const listenerCleanupRef = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);
  const [agentState, setAgentState] = useState<"loading" | "ready" | "error">("loading");
  const [agentError, setAgentError] = useState<string>("");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [runs, setRuns] = useState<ChatRun[]>([]);
  const [activity, setActivity] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const mod = await import("page-agent");
        if (disposed) return;

        const agent = new mod.PageAgent({
          baseURL: "/api/page-agent",
          model,
          apiKey: "hivemindos-proxy",
          language: "en-US",
          customFetch: (input: RequestInfo | URL, init?: RequestInit) =>
            fetch(input, { ...init, credentials: "include" }),
          // Our own purple perimeter glow (see .runFrame) replaces page-agent's
          // built-in multi-colour mask frame + cursor. Does not affect the
          // agent's ability to read/click — that runs off DOM analysis.
          enableMask: false,
          // --- Safety rails ---
          customTools: { execute_javascript: null },
          maxSteps: 20,
        });

        // Drop page-agent's built-in vanilla-DOM Panel — we render our own.
        agent.panel.dispose();

        const onHistory = () => {
          const lines = linesFromHistory(agent.history);
          setRuns((prev) => {
            if (prev.length === 0) return prev;
            const next = prev.slice();
            const last = { ...next[next.length - 1] };
            if (last.done) return prev;
            last.lines = lines;
            next[next.length - 1] = last;
            return next;
          });
        };
        const onStatus = () => {
          const s = agent.status as AgentStatus;
          setStatus(s);
          if (s === "completed" || s === "error" || s === "stopped") {
            setActivity(null);
            setRuns((prev) => {
              if (prev.length === 0) return prev;
              const next = prev.slice();
              next[next.length - 1] = { ...next[next.length - 1], done: true };
              return next;
            });
          }
        };
        const onActivity = (e: Event) => {
          setActivity(activityLabel((e as CustomEvent).detail ?? null));
        };

        agent.addEventListener("historychange", onHistory);
        agent.addEventListener("statuschange", onStatus);
        agent.addEventListener("activity", onActivity);

        listenerCleanupRef.current = () => {
          agent.removeEventListener("historychange", onHistory);
          agent.removeEventListener("statuschange", onStatus);
          agent.removeEventListener("activity", onActivity);
        };
        agentRef.current = agent;
        setAgentState("ready");
      } catch (error) {
        if (disposed) return;
        setAgentError(error instanceof Error ? error.message : "Failed to load Page Agent.");
        setAgentState("error");
      }
    })();

    return () => {
      disposed = true;
      listenerCleanupRef.current?.();
      listenerCleanupRef.current = null;
      agentRef.current?.dispose();
      agentRef.current = null;
    };
  }, [model]);

  // Keep the transcript pinned to the newest line as the agent works.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [runs, activity]);

  const runTask = useCallback((task: string) => {
    const agent = agentRef.current;
    const trimmed = task.trim();
    if (!agent || !trimmed || agent.status === "running") return;
    setRuns((prev) => [...prev, { id: ++runIdRef.current, task: trimmed, lines: [], done: false }]);
    setDraft("");
    void agent.execute(trimmed).catch(() => {
      /* terminal errors surface via the statuschange/historychange handlers */
    });
  }, []);

  const onChatSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runTask(draft);
  };

  const running = status === "running";
  const hasTranscript = runs.length > 0;
  const inputDisabled = agentState !== "ready" || Boolean(disabledReason);
  const placeholder =
    disabledReason ||
    (agentState === "error"
      ? `Page Agent failed to load: ${agentError}`
      : "Tell the agent what to do…");

  return (
    <>
      {/* Soft purple glow hugging the viewport edges while the agent works. */}
      <div
        className={`${styles.runFrame}${running ? " " + styles.runFrameActive : ""}`}
        aria-hidden="true"
      />
      <div className={`${styles.dock}${placement === "right" ? " " + styles.dockRight : ""}`}>
        {hasTranscript ? (
          <div className={styles.transcript}>
            <div className={styles.transcriptScroll} ref={scrollRef} aria-live="polite">
              {runs.map((run) => (
                <div key={run.id} className={styles.turnGroup}>
                  <div className={styles.turn}>
                    <span className={`${styles.who} ${styles.whoYou}`}>You</span>
                    <p className={styles.turnText}>{run.task}</p>
                  </div>
                  {run.lines.map((line, i) => (
                    <div className={styles.turn} key={i}>
                      <span className={`${styles.who} ${styles.whoAgent}`}>Page Agent</span>
                      <p
                        className={`${styles.turnText} ${
                          line.kind === "error" ? styles.turnTextError : ""
                        }`}
                      >
                        {line.text}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
              {running && activity ? (
                <div className={styles.turn}>
                  <span className={`${styles.who} ${styles.whoAgent}`}>Page Agent</span>
                  <p className={`${styles.turnText} ${styles.turnTextThinking}`}>{activity}</p>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <form
          className={`${styles.chat}${running ? " " + styles.chatBusy : ""}`}
          onSubmit={onChatSubmit}
        >
          <span className={styles.chatGlow} aria-hidden="true" />
          <span className={styles.chatSkin} aria-hidden="true" />
          <span className={styles.orb} aria-hidden="true">
            <span className={styles.orbRing} />
            <span className={styles.orbCore} />
          </span>
          <span className={styles.chatLabel}>Instruct the agent</span>
          <span className={styles.chatField}>
            <input
              className={styles.chatInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={placeholder}
              aria-label="Instruct the agent"
              disabled={inputDisabled}
            />
            {running ? (
              <button
                type="button"
                className={styles.chatStop}
                aria-label="Stop"
                title="Stop"
                onClick={() => void agentRef.current?.stop()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="submit"
                className={styles.chatSend}
                aria-label="Send"
                disabled={inputDisabled || !draft.trim()}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            )}
          </span>
        </form>
      </div>
    </>
  );
}
