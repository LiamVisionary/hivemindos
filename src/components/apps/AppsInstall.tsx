"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppGlyph, BBtn, BIcon } from "./apps-ui";
import type { FoundryInstallJob, FoundryServiceActionResult } from "./apps-types";

type LineKind = "cmd" | "out" | "ok" | "warn" | "err" | "q" | "in" | "dim";
type ConsoleLine = { k: LineKind; t: string };
type ConsoleStatus = "booting" | "awaiting" | "working" | "done" | "error" | "cancelled";

type InstallPrompt = {
  q: string;
  hint?: string;
  yes: string;
  no: string;
};

type InstallModalProps = {
  job: FoundryInstallJob;
  busy?: boolean;
  onRun: (job: FoundryInstallJob) => Promise<FoundryServiceActionResult | null>;
  onClose: () => void;
};

const glyphByKind: Record<LineKind, string> = {
  cmd: "$",
  out: ">",
  ok: "+",
  warn: "!",
  err: "x",
  q: "?",
  in: ">",
  dim: "",
};

function actionVerb(action: FoundryInstallJob["action"]) {
  if (action === "start") return "start";
  if (action === "stop") return "stop";
  if (action === "status" || action === "agent-reach-doctor") return "refresh";
  if (action === "check-agent-reach-x-auth") return "check";
  if (action === "reset-agent-reach-x") return "reset";
  return "install";
}

function promptFor(job: FoundryInstallJob): InstallPrompt {
  const verb = actionVerb(job.action);
  return {
    q: `${job.actionLabel} for ${job.app.name} on ${job.host.label}?`,
    hint: verb === "install" ? "Runs the reviewed HivemindOS installer" : "Runs the existing HivemindOS service action",
    yes: job.actionLabel,
    no: "Cancel",
  };
}

function InstallConfirmPrompt({
  prompt,
  onAnswer,
}: {
  prompt: InstallPrompt;
  onAnswer: (confirmed: boolean, echo: string) => void;
}) {
  return (
    <div className="fai-prompt">
      <div className="fai-q">
        <span className="car">&gt;</span>
        <span style={{ flex: "1 1 auto" }}>{prompt.q}</span>
        {prompt.hint ? <span className="hint">{prompt.hint}</span> : null}
      </div>
      <div className="fai-opts">
        <button type="button" className="fai-opt" data-primary="" onClick={() => onAnswer(true, prompt.yes)}>
          {prompt.yes}
        </button>
        <button type="button" className="fai-opt" onClick={() => onAnswer(false, prompt.no)}>
          {prompt.no}
        </button>
      </div>
    </div>
  );
}

export function InstallModal({ job, busy, onRun, onClose }: InstallModalProps) {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [status, setStatus] = useState<ConsoleStatus>("booting");
  const [minimized, setMinimized] = useState(false);
  const [result, setResult] = useState<FoundryServiceActionResult | null>(null);
  const termRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const prompt = useMemo(() => promptFor(job), [job]);

  useEffect(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    const initial: Array<[number, ConsoleLine]> = [
      [80, { k: "cmd", t: `hive apps ${actionVerb(job.action)} ${job.app.id} --host ${job.host.id}` }],
      [260, { k: "out", t: `Preparing ${job.app.name} through the HivemindOS service catalog...` }],
      [450, { k: "ok", t: `Target resolved: ${job.host.label} (${job.host.kind})` }],
    ];
    for (const [delay, line] of initial) {
      timersRef.current.push(window.setTimeout(() => setLines((current) => [...current, line]), delay));
    }
    timersRef.current.push(window.setTimeout(() => setStatus("awaiting"), 620));
    return () => {
      timersRef.current.forEach(window.clearTimeout);
      timersRef.current = [];
    };
  }, [job]);

  useEffect(() => {
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, status, minimized]);

  const answer = async (confirmed: boolean, echo: string) => {
    setLines((current) => [...current, { k: "q", t: prompt.q }, { k: "in", t: echo }]);
    if (!confirmed) {
      setStatus("cancelled");
      setLines((current) => [...current, { k: "warn", t: "Action cancelled before any service changes were made." }]);
      return;
    }

    setStatus("working");
    setLines((current) => [
      ...current,
      { k: "out", t: "Calling /api/fleet/apps/installable-services..." },
      { k: "dim", t: "  this may take a moment for Docker, uv, pipx, or Cloudflare-backed setup" },
    ]);
    const actionResult = await onRun(job);
    setResult(actionResult);
    const service = actionResult?.service;
    if (!actionResult?.ok || !service) {
      setStatus("error");
      setLines((current) => [...current, { k: "err", t: actionResult?.error || "Service action failed." }]);
      return;
    }
    setStatus("done");
    setLines((current) => [
      ...current,
      { k: "ok", t: service.detail },
      { k: "ok", t: `${job.app.name} catalog state refreshed.` },
    ]);
  };

  const progress = status === "done" ? 100 : status === "error" || status === "cancelled" ? 100 : status === "working" ? 72 : status === "awaiting" ? 34 : 16;
  const waiting = status === "awaiting";
  const openUrl = result?.service?.openUrl || job.app.serviceOpenUrl;
  const statusText = status === "done"
    ? "Done"
    : status === "error"
      ? "Needs attention"
      : status === "cancelled"
        ? "Cancelled"
        : waiting
          ? "Waiting for you"
          : "Running...";

  if (minimized) {
    return (
      <div
        className="fai-dock"
        data-wait={waiting ? "" : undefined}
        data-done={status === "done" ? "" : undefined}
        onClick={() => setMinimized(false)}
        role="button"
        tabIndex={0}
        aria-label={`${job.app.name} action - ${statusText}, click to expand`}
      >
        <div className="row">
          <AppGlyph app={job.app} size={34} />
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div className="nm">{job.app.name}</div>
            <div className="st">{waiting ? "Waiting for you - tap to answer" : `${statusText} on ${job.host.label} - ${progress}%`}</div>
          </div>
          {status === "done" ? <BIcon name="check" size={16} color="var(--live)" /> : <span className="fr-dot live" style={{ color: waiting ? "var(--honey)" : "var(--live)", width: 8, height: 8 }} />}
        </div>
        <div className="pbar"><i style={{ width: `${progress}%` }} /></div>
      </div>
    );
  }

  return (
    <div className="fai-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setMinimized(true); }}>
      <div className="fai-modal" role="dialog" aria-modal="true" aria-label={`${job.actionLabel} ${job.app.name}`}>
        <div className="fai-head">
          <AppGlyph app={job.app} size={36} />
          <div className="meta">
            <div className="nm">{status === "done" ? `${job.app.name} updated` : `${job.actionLabel} ${job.app.name}`}</div>
            <div className="sub">{job.host.label} - {statusText}</div>
          </div>
          <button type="button" className="fai-winbtn" onClick={() => setMinimized(true)} aria-label="Minimize" title="Run in background">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 18h12" /></svg>
          </button>
          <button type="button" className="fai-winbtn danger" onClick={onClose} aria-label="Close" title={status === "done" ? "Close" : "Close console"}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="fai-prog" data-done={status === "done" ? "" : undefined} data-wait={waiting ? "" : undefined}>
          <i style={{ width: `${progress}%` }} />
        </div>

        <div className="fai-term fr-scroll" ref={termRef}>
          {lines.map((line, index) => (
            <div key={`${line.k}-${index}`} className="fai-line" data-k={line.k}>
              <span className="g">{glyphByKind[line.k]}</span>
              <span className="t">{line.t}</span>
            </div>
          ))}
          {status === "booting" || status === "working" || busy ? (
            <div className="fai-line">
              <span className="g" />
              <span className="t"><span className="fai-caret" /></span>
            </div>
          ) : null}
        </div>

        {waiting ? <InstallConfirmPrompt prompt={prompt} onAnswer={(confirmed, echo) => void answer(confirmed, echo)} /> : null}

        {status === "done" || status === "error" || status === "cancelled" ? (
          <div className="fai-foot">
            <span className="status">
              <BIcon name={status === "error" ? "alert" : "check"} size={15} color={status === "error" ? "var(--danger)" : "var(--live)"} />
              {statusText}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <BBtn onClick={onClose}>Close</BBtn>
              {openUrl && status === "done" ? (
                <BBtn variant="primary" onClick={() => window.open(openUrl, "_blank", "noopener,noreferrer")}>
                  <BIcon name="external" size={13} /> Open app
                </BBtn>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
