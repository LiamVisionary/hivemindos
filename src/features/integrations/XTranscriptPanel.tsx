"use client";

import * as React from "react";

import { openExternalUrl } from "@/lib/native/open-external-url";
import type { XTranscriptResult } from "@/lib/services/x-transcript/x-transcript-service";
import { BBtn } from "./integrations-primitives";

type PanelState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "error"; message: string }
  | { phase: "ready"; result: XTranscriptResult };

function kindLabel(kind: XTranscriptResult["kind"]): string {
  if (kind === "video") return "Video";
  if (kind === "thread") return "Thread";
  return "Post";
}

function durationLabel(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function XTranscriptPanel() {
  const [url, setUrl] = React.useState("");
  const [state, setState] = React.useState<PanelState>({ phase: "idle" });
  const [copied, setCopied] = React.useState(false);

  const busy = state.phase === "working";

  async function pull(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setState({ phase: "working" });
    setCopied(false);
    try {
      const response = await fetch("/api/integrations/x-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, summarize: true }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; result?: XTranscriptResult } | null;
      if (!response.ok || !data?.ok || !data.result) {
        throw new Error(data?.error || `Request failed with HTTP ${response.status}.`);
      }
      setState({ phase: "ready", result: data.result });
    } catch (error) {
      setState({ phase: "error", message: error instanceof Error ? error.message : "Could not pull the transcript." });
    }
  }

  async function copyTranscript(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <form onSubmit={pull} style={{ display: "grid", gap: 10 }}>
        <label htmlFor="x-transcript-url" style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
          Paste an X post link — a video is transcribed, a text thread is stitched together.
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id="x-transcript-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://x.com/user/status/1780000000000000001"
            disabled={busy}
            style={{
              flex: "1 1 320px",
              minWidth: 0,
              padding: "9px 12px",
              borderRadius: 10,
              border: "1px solid var(--line-2)",
              background: "var(--panel-2)",
              color: "var(--fg)",
              fontFamily: "var(--f-mono)",
              fontSize: 13,
            }}
          />
          <BBtn type="submit" disabled={busy || !url.trim()}>
            {busy ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="ni-spin" aria-hidden />
                Pulling
              </span>
            ) : "Pull transcript"}
          </BBtn>
        </div>
      </form>

      {state.phase === "working" ? (
        <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--fg-2)", fontSize: 13 }}>
          <span className="ni-tspin" aria-hidden />
          <span>Fetching the post… a long video downloads and transcribes in chunks, so this can take a minute.</span>
        </div>
      ) : null}

      {state.phase === "error" ? (
        <div role="alert" style={{ border: "1px solid var(--danger-line, #7a2a2a)", background: "var(--danger-soft, rgba(150,40,40,0.12))", color: "var(--fg)", borderRadius: 10, padding: "11px 14px", fontSize: 13, lineHeight: 1.6 }}>
          {state.message}
        </div>
      ) : null}

      {state.phase === "ready" ? <ResultView result={state.result} copied={copied} onCopy={copyTranscript} /> : null}
    </div>
  );
}

function ResultView({ result, copied, onCopy }: { result: XTranscriptResult; copied: boolean; onCopy: (text: string) => void }) {
  const duration = durationLabel(result.durationSec);
  return (
    <div style={{ display: "grid", gap: 12, border: "1px solid var(--line-2)", borderRadius: 12, background: "var(--panel)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 11 }}>
        <span style={{ border: "1px solid var(--honey-line)", color: "var(--honey)", borderRadius: 999, padding: "2px 9px" }}>{kindLabel(result.kind)}</span>
        {result.author?.handle ? (
          <button
            type="button"
            onClick={() => openExternalUrl(result.canonicalUrl)}
            style={{ background: "none", border: "none", color: "var(--fg-2)", cursor: "pointer", padding: 0, fontFamily: "var(--f-mono)", fontSize: 11 }}
          >
            @{result.author.handle}{result.author.name ? ` · ${result.author.name}` : ""}
          </button>
        ) : null}
        {duration ? <span style={{ color: "var(--fg-4)" }}>{duration}</span> : null}
        {typeof result.postCount === "number" && result.postCount > 1 ? <span style={{ color: "var(--fg-4)" }}>{result.postCount} posts</span> : null}
        <span style={{ color: "var(--fg-4)", marginLeft: "auto" }}>{result.source}</span>
      </div>

      {result.summary ? (
        <div style={{ display: "grid", gap: 6, borderLeft: "2px solid var(--honey)", paddingLeft: 12 }}>
          <div style={{ color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>Summary</div>
          <p style={{ margin: 0, color: "var(--fg)", fontSize: 14, lineHeight: 1.65 }}>{result.summary}</p>
          {result.followUpQuestion ? <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 13.5, lineHeight: 1.6, fontStyle: "italic" }}>{result.followUpQuestion}</p> : null}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>Transcript</div>
          <button
            type="button"
            onClick={() => onCopy(result.transcript)}
            style={{ background: "none", border: "1px solid var(--line-2)", borderRadius: 8, color: "var(--fg-2)", cursor: "pointer", padding: "3px 10px", fontSize: 11 }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto", whiteSpace: "pre-wrap", color: "var(--fg)", fontSize: 13.5, lineHeight: 1.7, background: "var(--panel-2)", borderRadius: 10, padding: 14 }}>
          {result.transcript}
        </div>
      </div>

      {result.warnings.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--fg-4)", fontSize: 12, lineHeight: 1.6 }}>
          {result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export default XTranscriptPanel;
