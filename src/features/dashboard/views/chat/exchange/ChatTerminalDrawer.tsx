"use client";

/* Terminal drawer for the chat route.
 *
 * Not a simulation: it drives the same real shell session API the Fleet view's
 * MachineTerminalModal uses — SSE from `/api/fleet/shell/stream` for output,
 * `POST /api/fleet/shell` with action `command` | `stdin` | `interrupt` for
 * input. The session id is derived from the machine key so re-opening the
 * drawer re-attaches to the same live shell.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ICON_PATHS, Ico } from "./composer-primitives";

const MAX_BUFFER_CHARS = 120_000;

type TerminalEventPayload = {
  chunk?: string;
};

type ShellHistoryPayload = {
  ok?: boolean;
  lines?: unknown;
  error?: string;
};

type ShellActionPayload = {
  ok?: boolean;
  error?: string;
};

function shellSessionIdForMachineKey(machineKey: string) {
  const cleaned = machineKey.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `chat-${cleaned || "machine"}`.slice(0, 128);
}

export type ChatTerminalDrawerProps = {
  machineName: string;
  machineKey: string;
  collectorUrl: string;
  workingDirectory: string;
  onClose: () => void;
};

export function ChatTerminalDrawer({ machineName, machineKey, collectorUrl, workingDirectory, onClose }: ChatTerminalDrawerProps) {
  const [buffer, setBuffer] = useState("");
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const bufferRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const session = shellSessionIdForMachineKey(machineKey);
  const query = `collectorUrl=${encodeURIComponent(collectorUrl)}&session=${encodeURIComponent(session)}`;
  const displayedError = error || (!collectorUrl ? "This chat is not routed to a machine with a reachable collector." : "");

  const appendChunk = useCallback((chunk: string) => {
    if (!chunk) return;
    setBuffer((current) => {
      const next = current + chunk;
      return next.length > MAX_BUFFER_CHARS ? next.slice(next.length - MAX_BUFFER_CHARS) : next;
    });
  }, []);

  useEffect(() => {
    if (!collectorUrl) return undefined;
    let closed = false;
    const source = new EventSource(`/api/fleet/shell/stream?${query}`);
    source.addEventListener("terminal", (event) => {
      if (closed) return;
      try {
        const payload = JSON.parse((event as MessageEvent).data) as TerminalEventPayload;
        if (payload.chunk) appendChunk(payload.chunk);
      } catch {
        // A malformed terminal frame cannot be rendered; ignore it.
      }
    });
    source.onopen = () => {
      if (closed) return;
      setConnected(true);
      setError("");
      // Replay prior output so a reopened drawer shows the session's history.
      void fetch(`/api/fleet/shell?${query}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as ShellHistoryPayload;
          if (!response.ok || payload.ok === false) {
            throw new Error(payload.error || `Shell history failed (${response.status}).`);
          }
          return payload;
        })
        .then((payload) => {
          if (closed) return;
          if (Array.isArray(payload.lines)) {
            setBuffer(payload.lines.filter((line): line is string => typeof line === "string").join("\n"));
          }
        })
        .catch((cause) => {
          if (!closed) setError(cause instanceof Error ? cause.message : "Could not load shell history.");
        });
    };
    source.onerror = () => {
      if (closed) return;
      setConnected(false);
      setError("Lost the shell stream. The collector may be offline.");
    };
    return () => {
      closed = true;
      source.close();
    };
  }, [collectorUrl, query, appendChunk]);

  useEffect(() => {
    const node = bufferRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [buffer]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = useCallback(async (action: "command" | "interrupt", extra: Record<string, string> = {}) => {
    if (!collectorUrl) return;
    try {
      const response = await fetch("/api/fleet/shell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectorUrl, session, action, ...extra }),
      });
      const payload = await response.json() as ShellActionPayload;
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `The shell command failed (${response.status}).`);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The shell command failed.");
    }
  }, [collectorUrl, session]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const command = input.trim();
      if (!command) return;
      setInput("");
      void send("command", { command });
      return;
    }
    if (event.key === "c" && event.ctrlKey) {
      event.preventDefault();
      void send("interrupt");
      return;
    }
    if (event.key === "l" && event.ctrlKey) {
      event.preventDefault();
      setBuffer("");
    }
  }

  return (
    <div className="cx-pop" style={{ position: "absolute", left: 16, right: 16, bottom: 16, zIndex: 60, display: "flex", flexDirection: "column", height: "min(340px, 60%)", border: "1px solid rgba(148,163,184,0.22)", borderRadius: 16, background: "#0b0b0d", boxShadow: "0 40px 90px -20px rgba(0,0,0,0.7)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(148,163,184,0.16)", background: "rgba(15,23,42,0.4)" }}>
        <Ico d={ICON_PATHS.terminal} size={14} sw={1.9} stroke="#6ed88f">
          <rect x="3" y="4" width="18" height="16" rx="2" />
        </Ico>
        <span style={{ fontFamily: "var(--f-body)", fontSize: 11.5, fontWeight: 700, color: "#e4e6eb" }}>{machineName || "machine"}</span>
        <span style={{ flex: 1, fontFamily: "var(--f-body)", fontSize: 10.5, color: "#8e8e93", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{workingDirectory}</span>
        <span title={connected ? "Shell stream connected" : "Shell stream disconnected"} className={connected ? "cx-dot-live" : undefined} style={{ width: 7, height: 7, borderRadius: 99, background: "currentColor", color: connected ? "#6ed88f" : "#8e8e93" }} />
        <button type="button" onClick={() => setBuffer("")} style={termBtn}>Clear</button>
        <button type="button" onClick={onClose} aria-label="Close shell" style={{ ...termBtn, display: "grid", placeItems: "center", width: 26, height: 26, padding: 0 }}>
          <Ico d="M6 6l12 12M18 6L6 18" size={13} sw={2} />
        </button>
      </div>

      <div ref={bufferRef} className="cx-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 14px", fontFamily: "var(--f-mono)", fontSize: 11.5, lineHeight: 1.5, color: "#e4e6eb" }}>
        {displayedError ? <div className="cx-termline" style={{ color: "#e58e85" }}>{displayedError}</div> : null}
        {buffer ? <div className="cx-termline">{buffer}</div> : null}
        <div style={{ display: "flex", alignItems: "baseline", marginTop: 2 }}>
          <span style={{ color: "#79b8ff", whiteSpace: "nowrap" }}>{workingDirectory || "~"}</span>
          <span style={{ color: "#6ed88f", whiteSpace: "pre" }}> $ </span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            aria-label="Shell command"
            disabled={!collectorUrl}
            style={{ flex: 1, minWidth: 60, border: 0, outline: 0, background: "transparent", color: "#e4e6eb", fontFamily: "var(--f-mono)", fontSize: 11.5, lineHeight: 1.5, caretColor: "#79b8ff" }}
          />
        </div>
      </div>

      <div style={{ padding: "6px 14px", borderTop: "1px solid rgba(148,163,184,0.16)", color: "#8e8e93", fontFamily: "var(--f-body)", fontSize: 10 }}>
        Shell runs inside hivemind-linkd on {machineName || "this machine"} · Ctrl+C interrupts · Ctrl+L clears
      </div>
    </div>
  );
}

const termBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 9px",
  border: "1px solid rgba(148,163,184,0.22)",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  color: "#e4e6eb",
  fontFamily: "var(--f-body)",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
};
