"use client";

/* PredictionMarket.tsx — the prediction-market read-out (MiroShark's
   centerpiece): the market question card, the swarm's leaning answer with
   confidence, the outcome ladder (swarm price vs crowd marker), where every
   agent placed its bet, and how the odds moved as news dropped. */

import React from "react";
import { Icon } from "./icons";
import { SimStatus, SimTemplateTag, SimControls } from "./theater";
import type { Bet, Market, OddsPoint, Outcome, Run } from "./sim-data";

function PolyOutcomeRow({ o }: { o: Outcome }) {
  const col = o.lead ? "var(--honey)" : "var(--fg-2)";
  const crowdPct = Math.round(o.crowd * 100), swarmPct = Math.round(o.prob * 100);
  const delta = swarmPct - crowdPct;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1.1fr) 1fr auto", gap: 14, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {o.won && <Icon name="check" size={13} sw={2.4} color="var(--live)" />}
        <span style={{ fontSize: 13.5, fontWeight: o.lead ? 600 : 500, letterSpacing: "-0.01em", color: o.lead ? "var(--fg)" : "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
      </div>
      <div style={{ position: "relative", height: 22, display: "flex", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, height: 9, borderRadius: 99, background: "var(--panel-2)" }}>
          <i style={{ position: "absolute", inset: "0 auto 0 0", height: "100%", width: swarmPct + "%", borderRadius: 99, background: o.lead ? "linear-gradient(90deg, var(--honey), var(--honey-2))" : "color-mix(in srgb, var(--fg-2) 45%, transparent)" }} />
          <span title={`crowd ${crowdPct}%`} style={{ position: "absolute", top: -3, left: `calc(${crowdPct}% - 1px)`, width: 2, height: 15, background: "var(--fg)", opacity: 0.5, borderRadius: 2 }} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end", whiteSpace: "nowrap" }}>
        <span className="sv-num" style={{ fontSize: 16, color: col }}>{swarmPct}%</span>
        <span className="sv-mono" style={{ fontSize: 10, color: delta >= 0 ? "var(--live)" : "var(--danger)", minWidth: 34, textAlign: "right" }}>{delta >= 0 ? "+" : ""}{delta} vs crowd</span>
      </div>
    </div>
  );
}

function PolyBetDist({ bets, height = 132 }: { bets: Bet[]; height?: number }) {
  if (!bets.length) return <div className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)", padding: "20px 0", textAlign: "center" }}>No agent bet distribution returned for this run.</div>;
  const max = Math.max(...bets.map((b) => b.n), 1);
  const total = bets.reduce((a, b) => a + b.n, 0);
  const modal = bets.reduce((a, b) => (b.n > a.n ? b : a), bets[0]);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height }}>
        {bets.map((b, i) => {
          const h = (b.n / max) * (height - 22);
          const isMode = b === modal;
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 5, minWidth: 0 }}>
              <span className="sv-mono" style={{ fontSize: 9, color: isMode ? "var(--honey)" : "var(--fg-4)" }}>{b.n}</span>
              <div title={`${b.bucket}: ${b.n} agents`} style={{ width: "100%", maxWidth: 30, height: Math.max(3, h), borderRadius: "4px 4px 0 0", background: isMode ? "linear-gradient(180deg, var(--honey), var(--honey-soft))" : "color-mix(in srgb, var(--live) 38%, transparent)" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
        {bets.map((b, i) => <span key={i} className="sv-mono" style={{ flex: 1, textAlign: "center", fontSize: 8, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.bucket}</span>)}
      </div>
      <div className="sv-mono" style={{ fontSize: 10, color: "var(--fg-3)", marginTop: 9, textAlign: "center" }}>{total} agents placed · mode at {modal.bucket}</div>
    </div>
  );
}

function PolyOddsChart({ history, height = 150 }: { history: OddsPoint[]; height?: number }) {
  if (history.length < 2) return <div className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)", padding: "26px 0", textAlign: "center" }}>Not enough rounds to chart odds movement yet.</div>;
  const W = 720, H = 230, P = { L: 38, R: W - 14, T: 30, B: H - 24 };
  const ps = history.map((h) => h.p);
  const max = Math.min(1, Math.max(...ps) + 0.12), min = Math.max(0, Math.min(...ps) - 0.12);
  const X = (i: number) => P.L + (i / (history.length - 1)) * (P.R - P.L);
  const Y = (v: number) => P.B - ((v - min) / (max - min || 1)) * (P.B - P.T);
  const line = history.map((h, i) => `${X(i).toFixed(1)},${Y(h.p).toFixed(1)}`).join(" ");
  const area = `${X(0)},${P.B} ${line} ${X(history.length - 1)},${P.B}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
      {[0, 0.5, 1].map((g) => { const v = min + g * (max - min); return (
        <g key={g}><line x1={P.L} y1={Y(v)} x2={P.R} y2={Y(v)} stroke="var(--line)" strokeWidth={1} /><text x={P.L - 7} y={Y(v) + 3.5} textAnchor="end" fontFamily="var(--f-mono)" fontSize={9} fill="var(--fg-4)">{Math.round(v * 100)}%</text></g>
      ); })}
      <defs><linearGradient id="polyArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--honey)" stopOpacity={0.2} /><stop offset="1" stopColor="var(--honey)" stopOpacity={0} /></linearGradient></defs>
      <polygon points={area} fill="url(#polyArea)" />
      <polyline points={line} fill="none" stroke="var(--honey)" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      {history.map((h, i) => h.event ? (
        <g key={i}>
          <line x1={X(i)} y1={Y(h.p)} x2={X(i)} y2={P.T - 6} stroke="var(--line-3)" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={X(i)} cy={Y(h.p)} r={3.5} fill="var(--live)" stroke="var(--bg)" strokeWidth={1.5} />
          <foreignObject x={Math.min(X(i) - 8, W - 168)} y={P.T - 24} width={170} height={20}>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: "8.5px", color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>◆ {h.event}</div>
          </foreignObject>
        </g>
      ) : null)}
      <circle cx={X(history.length - 1)} cy={Y(ps[ps.length - 1])} r={4} fill="var(--honey)" />
    </svg>
  );
}

export function PredictionMarketView({ run }: { run: Run }) {
  const m = run.market as Market | undefined;
  if (!m || !m.outcomes.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
          <SimStatus run={run} /><SimTemplateTag template={run.template} />
          <span className="sv-mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>nimbus · {run.started}</span>
          <div style={{ marginLeft: "auto" }}><SimControls run={run} /></div>
        </div>
        <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "20px 22px", background: "var(--panel-2)" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18 }}>{run.title}</h3>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{run.summary || "This prediction-market run hasn't returned priced outcomes yet."}</p>
        </div>
      </div>
    );
  }
  const lead = m.outcomes[0];
  const resolved = run.state === "done";
  const accent = m.lean.hit ? "var(--live)" : "var(--honey)";
  const typeLabel = { date: "Dated", scalar: "Bucketed", binary: "Binary" }[m.kind];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* market card — also the run header (status + controls live here) */}
      <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--panel-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap", padding: "12px 18px", borderBottom: "1px solid var(--line)" }}>
          <SimStatus run={run} />
          <SimTemplateTag template={run.template} />
          <span className="sv-mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>nimbus · {run.started}</span>
          <div style={{ marginLeft: "auto" }}><SimControls run={run} /></div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 18px" }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, flex: "0 0 auto", display: "grid", placeItems: "center", background: "var(--honey-soft)", border: "1px solid var(--honey-line)", marginTop: 2 }}>
            <Icon name="trade" size={20} color="var(--honey)" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sv-mono" style={{ fontSize: 10.5, color: resolved ? "var(--fg-4)" : "var(--live)", marginBottom: 5 }}>● {m.resolves}</div>
            <h3 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 20, letterSpacing: "-0.02em", lineHeight: 1.22, color: "var(--fg)", textWrap: "balance" }}>{m.question}</h3>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45 }}>{m.subtitle}</p>
          </div>
        </div>
        <div style={{ display: "flex", borderTop: "1px solid var(--line)" }}>
          {([["Volume", m.volume], ["Agents", String(m.traders)], ["Outcomes", String(m.outcomes.length)], ["Type", typeLabel]] as [string, string][]).map(([k, v], i) => (
            <div key={k} style={{ flex: 1, padding: "10px 16px", borderLeft: i ? "1px solid var(--line)" : "none" }}>
              <div className="sv-num" style={{ fontSize: 15, color: "var(--fg)" }}>{v}</div>
              <div className="sv-mono" style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", marginTop: 3 }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* the swarm's answer */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderRadius: "var(--radius)", border: `1px solid ${accent}`, background: `color-mix(in srgb, ${accent} 9%, var(--panel))` }}>
        <div style={{ position: "relative", width: 64, height: 64, flex: "0 0 auto" }}>
          <svg width={64} height={64} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={32} cy={32} r={27} fill="none" stroke="var(--line-2)" strokeWidth={5} />
            <circle cx={32} cy={32} r={27} fill="none" stroke={accent} strokeWidth={5} strokeLinecap="round" strokeDasharray={2 * Math.PI * 27} strokeDashoffset={2 * Math.PI * 27 * (1 - lead.prob)} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <span className="sv-num" style={{ fontSize: 16, color: "var(--fg)" }}>{Math.round(lead.prob * 100)}%</span>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="sv-eyebrow" style={{ color: accent }}>{m.lean.hit ? "Called it" : run.state === "live" ? "Leaning" : "Swarm verdict"}</span>
            {m.lean.hit && <Icon name="check" size={13} sw={2.4} color="var(--live)" />}
          </div>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: 3 }}>{m.lean.headline}</div>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5, maxWidth: "72ch", textWrap: "pretty" }}>{m.lean.blurb}</p>
        </div>
      </div>

      {/* outcome ladder */}
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <span className="sv-eyebrow">Outcomes · swarm price</span>
          <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)", display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 2, height: 11, background: "var(--fg)", opacity: 0.5, borderRadius: 2, display: "inline-block" }} /> crowd</span>
        </div>
        {m.outcomes.map((o, i) => <PolyOutcomeRow key={i} o={o} />)}
      </div>

      {/* distribution + odds over time */}
      <div style={{ display: "grid", gridTemplateColumns: "0.85fr 1.15fr", gap: 16 }}>
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
          <div className="sv-eyebrow" style={{ marginBottom: 12 }}>Where the agents bet</div>
          <PolyBetDist bets={m.bets} />
        </div>
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius)", padding: "14px 16px" }}>
          <div className="sv-eyebrow" style={{ marginBottom: 4 }}>Odds over rounds · {lead.label}</div>
          <PolyOddsChart history={m.history} />
        </div>
      </div>

      {/* edge */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="sv-chip" style={{ borderColor: "var(--honey-line)", color: "var(--honey)" }}><Icon name="trade" size={12} /> {m.edge}</span>
        {run.tags.map((t) => <span key={t} className="sv-tag">#{t}</span>)}
      </div>
    </div>
  );
}
