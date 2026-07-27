"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, SquareTerminal } from "lucide-react";

import { CloseIconButton } from "@/components/ui/close-icon-button";

import type { FleetMachine } from "./fleet-data";
import { parseAnsi } from "./terminal-ansi";
import styles from "./machine-terminal-modal.module.css";

// Ported from claw-code's terminal sheet: a line-based remote shell over
// REST + SSE. The shell itself runs inside the machine's hivemind-linkd, so
// any machine reachable through the link peer proxy gets a terminal without
// system Tailscale SSH.

const MAX_BUFFER_LINES = 600;

type MachineTerminalModalProps = {
  machine: FleetMachine;
  onClose: () => void;
};

type TerminalEventPayload = {
  chunk?: string;
  cwd?: string;
  busy?: boolean;
};

function shellSessionIdForMachine(machine: FleetMachine) {
  const cleaned = machine.id.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `fleet-${cleaned || "machine"}`.slice(0, 128);
}

function shortenCwd(cwd: string): string {
  if (!cwd) return "";
  // Split on both separators so Windows paths (C:\Users\foo\bar) shorten too.
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return cwd;
  return ".../" + parts.slice(-2).join("/");
}

function AnsiLine({ line }: { line: string }) {
  const segments = React.useMemo(() => parseAnsi(line), [line]);
  if (segments.length === 0) {
    return <div className={styles.bufferLine}> </div>;
  }
  return (
    <div className={styles.bufferLine}>
      {segments.map((seg, i) => (
        <span
          key={i}
          style={{
            color: seg.style.color,
            backgroundColor: seg.style.backgroundColor,
            fontWeight: seg.style.fontWeight,
            fontStyle: seg.style.fontStyle,
            textDecoration: seg.style.textDecoration,
            opacity: seg.style.opacity,
          }}
        >
          {seg.text}
        </span>
      ))}
    </div>
  );
}

export function MachineTerminalModal({ machine, onClose }: MachineTerminalModalProps) {
  const session = React.useMemo(() => shellSessionIdForMachine(machine), [machine]);
  const collectorUrl = machine.collectorUrl ?? "";
  // The machine's hivemind-linkd has no shell service (Windows builds compile
  // it out) — render an explanatory state instead of wiring up a dead shell.
  const shellUnavailable = machine.remoteShell === false;

  const [lines, setLines] = React.useState<string[]>([]);
  const [cwd, setCwd] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [command, setCommand] = React.useState("");
  const [connection, setConnection] = React.useState<"connecting" | "open" | "error">("connecting");
  const [errorDetail, setErrorDetail] = React.useState("");

  const bufferRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Command history (local to this modal instance — not persisted).
  // historyIdx points at the entry currently surfaced; when equal to
  // history.length the input is a fresh draft.
  const historyRef = React.useRef<string[]>([]);
  const historyIdxRef = React.useRef(0);
  const draftRef = React.useRef("");

  const appendChunk = React.useCallback((payload: TerminalEventPayload) => {
    const raw = typeof payload.chunk === "string" ? payload.chunk : "";
    if (raw.length > 0) {
      const newLines = raw.split("\n").slice(0, raw.endsWith("\n") ? -1 : undefined);
      setLines((current) => [...current, ...newLines].slice(-MAX_BUFFER_LINES));
    }
    if (typeof payload.cwd === "string") setCwd(payload.cwd);
    if (typeof payload.busy === "boolean") setBusy(payload.busy);
  }, []);

  React.useEffect(() => {
    if (shellUnavailable) return;
    let closed = false;
    const query = `collectorUrl=${encodeURIComponent(collectorUrl)}&session=${encodeURIComponent(session)}`;
    const source = new EventSource(`/api/fleet/shell/stream?${query}`);

    source.addEventListener("terminal", (event) => {
      if (closed) return;
      try {
        appendChunk(JSON.parse((event as MessageEvent).data) as TerminalEventPayload);
      } catch {
        /* malformed event — skip */
      }
    });
    source.onopen = () => {
      if (closed) return;
      setConnection("open");
      setErrorDetail("");
      // Replace the buffer with server-side history once per (re)connect so
      // a reopened modal shows the session's prior output.
      fetch(`/api/fleet/shell?${query}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data: { ok?: boolean; lines?: string[]; cwd?: string; busy?: boolean; error?: string }) => {
          if (closed) return;
          if (data.ok === false) {
            setConnection("error");
            setErrorDetail(data.error ?? "shell unavailable");
            return;
          }
          if (Array.isArray(data.lines)) setLines(data.lines.slice(-MAX_BUFFER_LINES));
          if (typeof data.cwd === "string") setCwd(data.cwd);
          if (typeof data.busy === "boolean") setBusy(data.busy);
        })
        .catch(() => {});
    };
    source.onerror = () => {
      if (closed) return;
      setConnection("error");
    };

    return () => {
      closed = true;
      source.close();
    };
  }, [collectorUrl, session, appendChunk, shellUnavailable]);

  // Auto-stick to bottom when new lines arrive.
  React.useEffect(() => {
    const node = bufferRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length, busy]);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const shellAction = React.useCallback(
    (action: "command" | "stdin" | "interrupt" | "kill", extra?: { command?: string; data?: string }) =>
      fetch("/api/fleet/shell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collectorUrl, session, action, ...extra }),
      })
        .then((res) => res.json())
        .then((data: { ok?: boolean; error?: string }) => {
          if (data.ok === false && data.error) {
            setErrorDetail(data.error);
          }
        })
        .catch(() => {}),
    [collectorUrl, session],
  );

  const send = React.useCallback(() => {
    const trimmed = command.trim();
    if (!trimmed) return;
    // Push to history, but dedupe consecutive duplicates the way bash does.
    const h = historyRef.current;
    if (h[h.length - 1] !== trimmed) h.push(trimmed);
    historyIdxRef.current = h.length;
    draftRef.current = "";
    setCommand("");
    if (trimmed === "clear") {
      setLines([]);
      return;
    }
    void shellAction("command", { command: trimmed });
  }, [command, shellAction]);

  const interrupt = React.useCallback(() => {
    void shellAction("interrupt");
  }, [shellAction]);

  const historyUp = React.useCallback(() => {
    const h = historyRef.current;
    if (h.length === 0) return;
    // First ↑ stashes the current draft so ↓ back to "now" can restore it.
    if (historyIdxRef.current === h.length) {
      draftRef.current = command;
    }
    const next = Math.max(0, historyIdxRef.current - 1);
    historyIdxRef.current = next;
    setCommand(h[next] ?? "");
  }, [command]);

  const historyDown = React.useCallback(() => {
    const h = historyRef.current;
    if (h.length === 0) return;
    const next = historyIdxRef.current + 1;
    if (next >= h.length) {
      historyIdxRef.current = h.length;
      setCommand(draftRef.current);
    } else {
      historyIdxRef.current = next;
      setCommand(h[next] ?? "");
    }
  }, []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        send();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        historyUp();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        historyDown();
      } else if (event.key === "c" && event.ctrlKey && !window.getSelection()?.toString()) {
        // Ctrl+C with no text selected = interrupt, like a real terminal.
        // With a selection, fall through to the browser's copy.
        event.preventDefault();
        interrupt();
      } else if ((event.key === "l" && event.ctrlKey) || (event.key === "k" && event.metaKey)) {
        event.preventDefault();
        setLines([]);
      }
    },
    [send, historyUp, historyDown, interrupt],
  );

  const cwdLabel = shortenCwd(cwd);

  return createPortal(
    <div role="presentation" className={styles.backdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Shell on ${machine.name}`}
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            <SquareTerminal size={14} aria-hidden="true" style={{ color: "var(--term-prompt)" }} />
            {machine.name}
          </span>
          <span className={styles.headerCwd}>{cwdLabel}</span>
          {busy ? (
            <button type="button" className={`${styles.headerButton} ${styles.stopButton}`} onClick={interrupt}>
              <LoaderCircle size={11} className="animate-spin" aria-hidden="true" /> ⌃C
            </button>
          ) : null}
          <button type="button" className={styles.headerButton} onClick={() => setLines([])}>
            Clear
          </button>
          <CloseIconButton
            type="button"
            aria-label="Close shell"
            onClick={onClose}
            style={{ width: 26, height: 26 }}
          />
        </div>

        {shellUnavailable ? (
          <>
            <div ref={bufferRef} className={styles.buffer}>
              <div className={styles.bufferEmpty}>
                {`Remote shell isn't available on ${machine.name} yet.\nIts hivemind-linkd doesn't include the shell service — Windows machines don't support it yet.`}
              </div>
            </div>
            <div className={styles.statusNote}>
              The rest of the fleet panel still works for this machine — only the shell is unavailable.
            </div>
          </>
        ) : (
          <>
            <div
              ref={bufferRef}
              className={styles.buffer}
              onClick={() => {
                if (!window.getSelection()?.toString()) inputRef.current?.focus();
              }}
            >
              {lines.length === 0 ? (
                <div className={styles.bufferEmpty}>
                  {connection === "connecting"
                    ? "Connecting to shell…"
                    : `Interactive shell at ${cwdLabel || "the working directory"}.\nType a command and press Enter.`}
                </div>
              ) : null}
              {lines.map((line, i) => (
                <AnsiLine key={i} line={line} />
              ))}
              <div className={styles.promptLine}>
                <span className={styles.promptCwd}>{cwdLabel}</span>
                <span className={styles.promptSigil}>{busy ? " … " : " $ "}</span>
                <input
                  ref={inputRef}
                  className={styles.promptInput}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={busy ? "running…" : ""}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>

            {connection === "error" || errorDetail ? (
              <div className={`${styles.statusNote} ${styles.statusNoteError}`}>
                {errorDetail || "Shell connection lost — retrying. The machine's link daemon may need an update or restart."}
              </div>
            ) : (
              <div className={styles.statusNote}>
                Shell runs inside hivemind-linkd on {machine.name} · Ctrl+C interrupts · Ctrl+L clears
              </div>
            )}
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
