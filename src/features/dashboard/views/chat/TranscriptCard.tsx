"use client";

import * as React from "react";
import { Brain, Check } from "lucide-react";

import type { ChatTranscriptCard } from "@/features/dashboard/chat-transcript-card";
import { sendTranscriptToBrain } from "@/features/dashboard/transcript-brain-capture";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { openExternalUrl } from "@/lib/native/open-external-url";
import { readXTranscriptJob, X_TRANSCRIPT_POLL_INTERVAL_MS } from "@/lib/services/x-transcript/x-transcript-client";

function InlineSpinner({ size = 14 }: { size?: number }) {
  // SMIL rotate keeps spinning under WKWebView's rAF starvation (unlike a
  // JS/Lottie loop) and needs no global CSS class, so it animates anywhere.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flex: "none" }}>
      <circle cx="12" cy="12" r="9" stroke="var(--line-2)" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="var(--honey)" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function kindLabel(kind?: ChatTranscriptCard["kind"]): string {
  if (kind === "video") return "Video";
  if (kind === "thread") return "Thread";
  if (kind === "single") return "Post";
  return "Transcript";
}

function durationLabel(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const CARD_STYLE: React.CSSProperties = {
  display: "grid",
  gap: 10,
  border: "1px solid var(--line-2)",
  borderRadius: 12,
  background: "var(--panel-2, rgba(255,255,255,0.02))",
  padding: 13,
};

const LABEL_STYLE: React.CSSProperties = {
  color: "var(--fg-4)",
  fontFamily: "var(--f-mono)",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export function TranscriptCard({
  brainEnabled = true,
  card: sourceCard,
  vaultPath,
}: {
  brainEnabled?: boolean;
  card: ChatTranscriptCard;
  vaultPath?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [brainStatus, setBrainStatus] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [brainError, setBrainError] = React.useState("");
  const [recoveredCard, setRecoveredCard] = React.useState<ChatTranscriptCard | null>(null);
  const matchingRecovery = recoveredCard?.id === sourceCard.id ? recoveredCard : null;
  const card: ChatTranscriptCard = sourceCard.status !== "running"
    ? sourceCard
    : sourceCard.jobId
      ? matchingRecovery ?? sourceCard
      : {
          ...sourceCard,
          status: "error",
          error: "This transcript run lost its connection before it received a job ID. Run `/transcript` again.",
        };
  const duration = durationLabel(card.durationSec);
  const target = card.canonicalUrl || card.url;

  React.useEffect(() => {
    if (sourceCard.status !== "running" || !sourceCard.jobId) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    let transientFailures = 0;
    const schedule = () => {
      timer = window.setTimeout(() => void poll(), X_TRANSCRIPT_POLL_INTERVAL_MS);
    };
    const poll = async () => {
      try {
        const job = await readXTranscriptJob(sourceCard.jobId as string);
        if (cancelled) return;
        transientFailures = 0;
        if (job.status === "running") return schedule();
        if (job.status === "failed" || !job.result) {
          setRecoveredCard({ ...sourceCard, status: "error", error: job.error || "Could not pull the transcript." });
          return;
        }
        setRecoveredCard({
          ...sourceCard,
          status: "ready",
          canonicalUrl: job.result.canonicalUrl,
          kind: job.result.kind,
          author: job.result.author,
          title: job.result.title,
          transcript: job.result.transcript,
          durationSec: job.result.durationSec,
          postCount: job.result.postCount,
          source: job.result.source,
          warnings: job.result.warnings?.length ? job.result.warnings : undefined,
        });
      } catch (error) {
        if (cancelled) return;
        transientFailures += 1;
        if (transientFailures < 3) return schedule();
        setRecoveredCard({
          ...sourceCard,
          status: "error",
          error: error instanceof Error ? error.message : "Could not reconnect to the transcript job.",
        });
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sourceCard]);

  async function copyTranscript() {
    if (!card.transcript) return;
    try {
      await navigator.clipboard.writeText(card.transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function sendToBrain() {
    if (!brainEnabled || brainStatus === "sending" || !card.transcript) return;
    setBrainStatus("sending");
    setBrainError("");
    try {
      const result = await sendTranscriptToBrain({ card, vaultPath });
      if (!result?.ok || !result.note) {
        throw new Error(result?.error || "The brain intake did not return a saved note.");
      }
      setBrainStatus("sent");
      window.setTimeout(() => setBrainStatus((current) => current === "sent" ? "idle" : current), 2200);
    } catch (error) {
      setBrainStatus("error");
      setBrainError(error instanceof Error ? error.message : "Could not send this transcript to the brain.");
    }
  }

  const brainTooltip = !brainEnabled
    ? "Enable the shared brain to save this transcript"
    : brainStatus === "sending"
      ? "Sending to brain"
      : brainStatus === "sent"
        ? "Sent to brain"
        : brainStatus === "error"
          ? "Try sending to brain again"
          : "Send to brain";

  return (
    <div style={CARD_STYLE}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 11 }}>
        <span style={{ border: "1px solid var(--honey-line)", color: "var(--honey)", borderRadius: 999, padding: "2px 9px" }}>{kindLabel(card.kind)}</span>
        {card.author?.handle ? (
          <button type="button" onClick={() => target && openExternalUrl(target)} style={{ background: "none", border: "none", color: "var(--fg-2)", cursor: "pointer", padding: 0, fontFamily: "var(--f-mono)", fontSize: 11 }}>
            @{card.author.handle}
          </button>
        ) : null}
        {duration ? <span style={{ color: "var(--fg-4)" }}>{duration}</span> : null}
        {typeof card.postCount === "number" && card.postCount > 1 ? <span style={{ color: "var(--fg-4)" }}>{card.postCount} posts</span> : null}
        {card.source && card.status === "ready" ? <span style={{ color: "var(--fg-4)", marginLeft: "auto" }}>{card.source}</span> : null}
      </div>

      {card.status === "running" ? (
        <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--fg-2)", fontSize: 13 }}>
          <InlineSpinner />
          <span>Pulling the transcript{card.title ? ` — ${card.title}` : ""}… long videos transcribe in chunks.</span>
        </div>
      ) : null}

      {card.status === "error" ? (
        <div role="alert" style={{ color: "var(--fg)", fontSize: 13, lineHeight: 1.6 }}>
          {card.error || "Could not pull the transcript."}
        </div>
      ) : null}

      {card.status === "ready" && card.transcript ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={LABEL_STYLE}>Transcript</span>
            <TooltipProvider>
              <span style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={copyTranscript} style={miniButton}>{copied ? "Copied" : "Copy"}</button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={brainTooltip}
                      disabled={!brainEnabled || brainStatus === "sending"}
                      onClick={() => void sendToBrain()}
                      style={{
                        ...miniButton,
                        alignItems: "center",
                        display: "inline-flex",
                        justifyContent: "center",
                        minWidth: 27,
                        padding: "2px 6px",
                        ...(brainStatus === "sent" ? { color: "var(--live)" } : {}),
                        ...(brainStatus === "error" ? { color: "var(--danger, #ef6a6a)" } : {}),
                        ...(!brainEnabled ? { cursor: "not-allowed", opacity: 0.5 } : {}),
                      }}
                    >
                      {brainStatus === "sending"
                        ? <InlineSpinner size={13} />
                        : brainStatus === "sent"
                          ? <Check width={14} height={14} strokeWidth={1.8} aria-hidden="true" />
                          : <Brain width={14} height={14} strokeWidth={1.7} aria-hidden="true" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{brainTooltip}</TooltipContent>
                </Tooltip>
                <button type="button" onClick={() => setExpanded((value) => !value)} style={miniButton}>{expanded ? "Collapse" : "Show full"}</button>
              </span>
            </TooltipProvider>
          </div>
          {brainError ? <div role="alert" style={{ color: "var(--danger, #ef6a6a)", fontSize: 11.5 }}>{brainError}</div> : null}
          <div
            style={{
              maxHeight: expanded ? 460 : 132,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              color: "var(--fg)",
              fontSize: 13.5,
              lineHeight: 1.7,
              background: "var(--panel, rgba(0,0,0,0.14))",
              borderRadius: 10,
              padding: 12,
              transition: "max-height 0.16s ease",
            }}
          >
            {card.transcript}
          </div>
        </div>
      ) : null}

      {card.warnings?.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--fg-4)", fontSize: 11.5, lineHeight: 1.55 }}>
          {card.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

const miniButton: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  color: "var(--fg-2)",
  cursor: "pointer",
  padding: "2px 9px",
  fontSize: 11,
};

export default TranscriptCard;
