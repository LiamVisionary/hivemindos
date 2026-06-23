"use client";

/* rail.tsx — the left-rail run rows, the card variant (used by grid layouts),
   and the launch-templates list. */

import React from "react";
import { Sparkline } from "./charts";
import { frTone } from "./primitives";
import { SimStatus } from "./theater";
import {
  FR_STATE_TONE, FR_TEMPLATE_LABEL, SW_TEMPLATES, frRunShort, frRunTrend, type Run, type TemplateId,
} from "./sim-data";

export function SimRunRow({ run, selected, onClick }: { run: Run; selected?: boolean; onClick?: () => void }) {
  const tone = FR_STATE_TONE[run.state];
  return (
    <button type="button" className="sv-runrow" data-sel={selected ? "" : undefined} onClick={onClick} style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}>
      {run.state === "live"
        ? <span className="fr-dot live sv-livedot" style={{ color: "var(--live)", width: 7, height: 7 }} />
        : <span className="fr-dot" style={{ color: frTone(tone), width: 7, height: 7 }} />}
      <div style={{ minWidth: 0 }}>
        <div className="nm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{frRunShort(run)}</div>
        <div className="meta">{FR_TEMPLATE_LABEL[run.template]} · {run.started}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        {run.template === "polymarket" && run.market
          ? <><div className="sv-num" style={{ fontSize: 15, color: run.market.lean.hit ? "var(--live)" : "var(--honey)" }}>{Math.round(run.market.outcomes[0].prob * 100)}%</div><div className="sv-mono" style={{ fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", marginTop: 2 }}>{run.market.lean.hit ? "called" : "lean"}</div></>
          : run.sharpe != null
          ? <><div className="sv-num" style={{ fontSize: 15, color: frTone(tone) }}>{run.sharpe.toFixed(2)}</div><div className="sv-mono" style={{ fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", marginTop: 2 }}>sharpe</div></>
          : <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>◇ {run.agents}</span>}
      </div>
    </button>
  );
}

export function SimRunCard({ run, selected, onClick }: { run: Run; selected?: boolean; onClick?: () => void }) {
  const tone = FR_STATE_TONE[run.state];
  const isPoly = run.template === "polymarket" && !!run.market;
  const spark = React.useMemo(() => isPoly ? run.market!.history.map((h) => h.p) : run.sharpe != null ? frRunTrend(run) : null, [run.id]);
  return (
    <button type="button" className="sv-runrow" data-sel={selected ? "" : undefined} onClick={onClick} style={{ display: "flex", flexDirection: "column", gap: 11, alignItems: "stretch", padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}><div className="nm">{frRunShort(run)}</div><div className="meta">{FR_TEMPLATE_LABEL[run.template]} · {run.started}</div></div>
        <SimStatus run={run} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        {isPoly
          ? <div style={{ minWidth: 0 }}><div className="sv-num" style={{ fontSize: 15, color: run.market!.lean.hit ? "var(--live)" : "var(--honey)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.market!.outcomes[0].label}</div><div className="sv-mono" style={{ fontSize: 9.5, color: "var(--fg-4)", marginTop: 2 }}>{Math.round(run.market!.outcomes[0].prob * 100)}% {run.market!.lean.hit ? "· called" : "lean"}</div></div>
          : run.sharpe != null
          ? <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span className="sv-num" style={{ fontSize: 22, color: frTone(tone) }}>{run.sharpe.toFixed(2)}</span><span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>sharpe</span></div>
          : <div className="sv-mono" style={{ fontSize: 11, color: "var(--fg-3)" }}>◇ {run.agents} · ✎ {run.posts}</div>}
        {spark && <Sparkline series={spark} w={96} h={28} tone={isPoly ? "honey" : tone === "neutral" ? "live" : tone} />}
      </div>
    </button>
  );
}

export function SimTemplatesRail({ compact, onPick }: { compact?: boolean; onPick?: (t: TemplateId) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {SW_TEMPLATES.map((t) => (
        <button key={t.id} type="button" onClick={() => onPick?.(t.id)}
          style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", textAlign: "left", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)", color: "var(--fg)", cursor: onPick ? "pointer" : "default", transition: "border-color .15s, background .15s" }}
          onMouseEnter={(e) => { if (onPick) e.currentTarget.style.borderColor = "var(--honey-line)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, letterSpacing: "-0.01em" }}>{t.label}</div>
            {!compact && <div className="sv-mono" style={{ fontSize: 9.5, color: "var(--fg-4)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.desc}</div>}
          </div>
          <span className="sv-mono" style={{ fontSize: 10, color: onPick ? "var(--honey)" : "var(--fg-4)", whiteSpace: "nowrap" }}>{onPick ? "+ launch" : "◇ " + t.agents}</span>
        </button>
      ))}
    </div>
  );
}
