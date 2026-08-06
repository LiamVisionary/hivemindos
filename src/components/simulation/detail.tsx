"use client";

/* detail.tsx — composes a run into its native read-out:
     • SimLiveDetail — the market-making live theater (tape, console, swarm, knobs)
     • SimRunDetail  — prediction-market view, or header → verdict → native output
     • SimDetail     — routes by template
   Prediction markets render their own market card + verdict + ladder, so they get
   no generic chrome. Social/research/ops runs get header → verdict → output. */

import React from "react";
import { Button } from "./primitives";
import { Icon } from "./icons";
import { PredictionMarketView } from "./PredictionMarket";
import { XThreadView, RedditView, ResearchView, OpsView } from "./outputs";
import { Intelligence } from "./Intelligence";
import { SimProgressBar } from "./charts";
import {
  SimAgent, SimControls, SimDecisionLog, SimHeadlines, SimMetric, SimRunTable,
  SimStatus, SimTags, SimTape, SimTemplateTag,
} from "./theater";
import { frRunMetrics, type Run } from "./sim-data";
import { useSimData } from "./sim-context";
import { SimRunningDetail, SimRunViewSeg } from "./running";
import { SimPostExtras } from "./post";
import { simulationPublishBlocker } from "./publish-readiness";

export function SimPanel({ label, children, style }: { label?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px", ...style }}>
      {label && <div className="sv-eyebrow" style={{ marginBottom: 10 }}>{label}</div>}
      {children}
    </div>
  );
}

export function SimRunHeader({ run, big }: { run: Run; big?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
      <SimStatus run={run} />
      <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: big ? 19 : 16, letterSpacing: "-0.01em" }}>{run.title}</span>
      <SimTemplateTag template={run.template} />
      <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>nimbus · {run.started}</span>
      <div style={{ marginLeft: "auto" }}><SimControls run={run} /></div>
    </div>
  );
}

export function SimStatsRow({ run }: { run: Run }) {
  const items = ([["◇", run.agents, "agents"], ["⌁", run.trades, "trades"], ["✎", run.posts, "posts"], ["⊚", run.news, "sources"]] as [string, number, string][]).filter(([, n]) => n > 0);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {items.map(([g, n, l]) => <span key={l} className="sv-chip"><span style={{ color: "var(--fg-4)" }}>{g}</span> {n.toLocaleString()} {l}</span>)}
    </div>
  );
}

// ── the market-making live theater ─────────────────────────────────────────
export function SimLiveDetail({ run }: { run: Run }) {
  const { agents, decisions, roundTable, tape } = useSimData();
  const pct = run.rounds ? run.currentRound / run.rounds : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SimRunHeader run={run} big />
      <SimProgressBar pct={pct} left={`round ${run.currentRound.toLocaleString()} / ${run.rounds.toLocaleString()}`} right={`${(pct * 100).toFixed(1)}%`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {frRunMetrics(run).map((m) => <SimMetric key={m.k} {...m} />)}
      </div>
      {tape.ticks.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
          <SimPanel label="Market tape"><SimTape market={tape} /></SimPanel>
          <SimPanel label="Headlines"><SimHeadlines headlines={tape.headlines} /></SimPanel>
        </div>
      )}
      {agents.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.25fr", gap: 16 }}>
          <SimPanel label={`Swarm · ${agents.length} bees in arena`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{agents.map((a) => <SimAgent key={a.id} a={a} />)}</div>
          </SimPanel>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {decisions.length > 0 && <SimPanel label="Decision console · live"><SimDecisionLog decisions={decisions} height={208} /></SimPanel>}
            {roundTable.length > 0 && <SimPanel label="Last rounds"><SimRunTable rows={roundTable} /></SimPanel>}
          </div>
        </div>
      )}
      <Intelligence run={run} />
    </div>
  );
}

// ── native output per template ──────────────────────────────────────────────
export function SimArtifact({ run }: { run: Run }) {
  switch (run.template) {
    case "polymarket": return <PredictionMarketView run={run} />;
    case "x-thread": return <XThreadView run={run} />;
    case "reddit-narrative": return <RedditView run={run} />;
    case "research-swarm": return <ResearchView run={run} />;
    case "ops": return <OpsView run={run} />;
    default: return null;
  }
}

export function SimRunDetail({ run, onPublish }: { run: Run; onPublish?: (run: Run) => void }) {
  const data = useSimData();
  if (run.template === "polymarket") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <PredictionMarketView run={run} />
        <Intelligence run={run} />
        <SimPostExtras run={run} />
      </div>
    );
  }
  const sectionLabel = run.template === "x-thread" ? "Draft thread"
    : run.template === "reddit-narrative" ? "Narrative cascade"
    : run.template === "research-swarm" ? "Consensus brief" : "Storm console";
  const publishBlocker = run.template === "x-thread"
    ? simulationPublishBlocker(run, data.threadFor(run), typeof onPublish === "function")
    : null;
  const canPublish = run.template === "x-thread" && !publishBlocker;
  // The status (Done/Failed/Ready) already shows in the header badge, so skip the
  // verdict banner. Show the scenario summary unless the native artifact below
  // already repeats it (the Reddit post body / research brief use the scenario)
  // and it just duplicates the title (which is the scenario truncated to 90 chars).
  const summary = run.summary?.trim() ?? "";
  const artifactRepeatsScenario = run.template === "reddit-narrative" || run.template === "research-swarm";
  const dupOfTitle = summary.toLowerCase().slice(0, 60) === run.title.trim().toLowerCase().slice(0, 60);
  const showSummary = summary.length > 0 && !(artifactRepeatsScenario && dupOfTitle);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SimRunHeader run={run} big />
      {showSummary && <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6, maxWidth: "74ch", textWrap: "pretty" }}>{summary}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>{frRunMetrics(run).map((m) => <SimMetric key={m.k} {...m} />)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <span className="sv-eyebrow">{sectionLabel}</span>
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        {publishBlocker ? <span role="status" style={{ maxWidth: "34ch", color: "var(--danger)", fontSize: 11.5, lineHeight: 1.4, textAlign: "right" }}>Publishing unavailable · {publishBlocker}</span> : null}
        {canPublish && <Button variant="primary" sm onClick={() => onPublish!(run)}><Icon name="check" size={13} sw={2.2} /> Approve &amp; publish</Button>}
      </div>
      <SimArtifact run={run} />
      <Intelligence run={run} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <SimStatsRow run={run} />
        <SimTags tags={run.tags} />
      </div>
      <SimPostExtras run={run} />
    </div>
  );
}

// A genuinely-live run opens in its determinate "running" state; a finished run opens in
// its Result. "Live" is reliable now: swarmRunState treats a terminal MiroShark
// runner_status (completed/stopped) or an archived run as done, so a completed sim no
// longer animates as if it were still running. The Running ⇄ Result toggle is on every
// run; SimulationView keys the detail pane on run id, so the default re-applies per run.
// The market-making theater (SimLiveDetail) is retained but no stock run uses it.
export function SimDetail({ run, onPublish }: { run: Run; onPublish?: (run: Run) => void }) {
  const isLive = run.state === "live";
  const [view, setView] = React.useState<"running" | "result">(isLive ? "running" : "result");

  const result = run.template === "market-maker" ? <SimLiveDetail run={run} /> : <SimRunDetail run={run} onPublish={onPublish} />;
  // A live run resumes from its real progress; a finished run opens in its terminal
  // "done" snapshot (no re-animation), with an explicit Replay button if you want it.
  if (view === "running") return <SimRunningDetail run={run} finished={!isLive} onResult={() => setView("result")} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><SimRunViewSeg view="result" onChange={setView} /></div>
      {result}
    </div>
  );
}
