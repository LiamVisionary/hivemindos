"use client";

/* signal.tsx — building blocks grounded in the real MiroShark engine
   (github.com/aaronjmars/MiroShark). The engine's output is a Bull/Neutral/Bear
   consensus + confidence, per-agent belief drift, a single AMM prediction market,
   three platforms (Twitter/Reddit/Polymarket) each round, and a "$1 to simulate
   anything" cost model. Reused by the running state (running.tsx) and the
   post-run extras (post.tsx). */

import React from "react";
import { Button } from "./primitives";
import { Icon } from "./icons";
import { frRng, frHash, frClamp, type Run } from "./sim-data";

// ── stance + tiers ───────────────────────────────────────────────────────────
export type Stance = "bullish" | "neutral" | "bearish";
export const FR_STANCE: Record<Stance, { label: string; col: string }> = {
  bullish: { label: "Bullish", col: "var(--live)" },
  neutral: { label: "Neutral", col: "var(--fg-3)" },
  bearish: { label: "Bearish", col: "var(--danger)" },
};
const FR_TIERS: { t: string; to: number }[] = [
  { t: "speculative", to: 40 }, { t: "moderate", to: 55 }, { t: "confident", to: 70 }, { t: "high-conviction", to: 101 },
];
export const frTier = (pct: number) => (FR_TIERS.find((x) => pct < x.to) || FR_TIERS[3]).t;

export interface BeliefPoint { round: number; bullish: number; neutral: number; bearish: number; }
export interface Signal { stance: Stance; pct: number; confidence_pct: number; tier: string; series: BeliefPoint[]; }
export interface CostModel {
  cost: number; costTotal: number; calls: number; callsTotal: number; tokens: number; tokTotal: number;
  byPhase: { k: string; w: number }[]; budget: number; p50: number; p90: number;
}

// per-round belief trajectory, seeded + deterministic, converging to a per-run target.
export function frBeliefSeries(run: Run): BeliefPoint[] {
  const n = Math.max(6, Math.min(28, run.template === "market-maker" ? 24 : (run.rounds || 28)));
  const r = frRng(frHash(run.id + "belief"));
  let tb: number;
  if (run.template === "polymarket" && run.market) {
    tb = frClamp(0.32 + run.market.outcomes[0].prob * 0.5, 0.28, 0.7);
  } else { tb = 0.3 + r() * 0.4; }
  const tbear = frClamp((1 - tb) * (0.35 + r() * 0.4), 0.08, 0.5);
  const out: BeliefPoint[] = [];
  let b = 0.34, ne = 0.34, be = 0.32;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const e = 1 - Math.pow(1 - f, 1.6);
    b = Math.max(0.04, b + (tb - b) * e * 0.5 + (r() - 0.5) * 0.12 * (1 - f));
    be = Math.max(0.04, be + (tbear - be) * e * 0.5 + (r() - 0.5) * 0.1 * (1 - f));
    ne = Math.max(0.04, 1 - b - be);
    const s = b + ne + be;
    out.push({ round: i, bullish: b / s, neutral: ne / s, bearish: be / s });
  }
  const last = out[out.length - 1];
  last.bullish = tb; last.bearish = tbear; last.neutral = Math.max(0.04, 1 - tb - tbear);
  return out;
}

export function frBeliefSignal(run: Run, seriesArg?: BeliefPoint[]): Signal {
  const series = seriesArg || frBeliefSeries(run);
  const f = series[series.length - 1];
  const entries: [Stance, number][] = ([["bullish", f.bullish], ["neutral", f.neutral], ["bearish", f.bearish]] as [Stance, number][]).sort((a, b) => b[1] - a[1]);
  const [stance, top] = entries[0];
  const second = entries[1][1];
  const confidence_pct = Math.round(frClamp((top * 0.6 + (top - second) * 0.8) * 100 + 12, 8, 96));
  return { stance, pct: Math.round(top * 100), confidence_pct, tier: frTier(confidence_pct), series };
}

// cost model — the "$1 to simulate anything" claim as structured data.
export function frCostModel(run: Run, progress = 1): CostModel {
  const r = frRng(frHash(run.id + "cost"));
  const callsTotal = Math.round((run.agents || 24) * Math.min(run.rounds || 28, 32) * (1.6 + r() * 0.5) + 380);
  const tokTotal = Math.round(callsTotal * (1500 + r() * 700));
  const costTotal = +frClamp(0.42 + (callsTotal / 3200) * 0.34 + r() * 0.08, 0.36, 0.94).toFixed(2);
  return {
    cost: +(costTotal * progress).toFixed(2), costTotal,
    calls: Math.round(callsTotal * progress), callsTotal,
    tokens: Math.round(tokTotal * progress), tokTotal,
    byPhase: [{ k: "Graph build", w: 0.16 }, { k: "Agent setup", w: 0.27 }, { k: "Simulation", w: 0.46 }, { k: "Report", w: 0.11 }],
    budget: 1.0, p50: 820 + Math.round(r() * 300), p90: 2100 + Math.round(r() * 700),
  };
}

export interface FeedItem { who: string; text: string; m: string; key?: string; }
export interface PlatformFeed { twitter: FeedItem[]; reddit: FeedItem[]; poly: FeedItem[]; }
export function frPlatformPools(run: Run): PlatformFeed {
  if (run.template === "polymarket" && run.market) {
    return {
      twitter: [
        { who: "@devwatch", text: "anthropic careers page just added 3 'launch eng' roles 👀", m: "↑ 412" },
        { who: "@aileaks", text: "dev-day teaser says 'something Fable this way comes'", m: "↑ 1.2k" },
        { who: "@quantbridget", text: "if it ships late July the eval suite must already be frozen", m: "↑ 88" },
        { who: "@modelpilled", text: "changelog cadence = ~6wk. last point release was Jun 18.", m: "↑ 233" },
      ],
      reddit: [
        { who: "u/r_singularity", text: "Claude 5 Fable release megathread — place your bets", m: "1.4k" },
        { who: "u/localllama", text: "betting Aug, they never hit the early date", m: "612" },
        { who: "u/eval_pilled", text: "RC tag would leak on HF first — watch the repos", m: "284" },
      ],
      poly: [
        { who: "Apis-α", text: "BUY YES · Jul 30–Aug 5 @ 0.39 → 0.41", m: "+1.2k" },
        { who: "Forager-2", text: "FADE Aug 20+ · trim to 3 agents", m: "−800" },
        { who: "Pollen-9", text: "UPDATE price 0.39 → 0.41 on teaser", m: "▲" },
        { who: "Worker-12", text: "BUY YES · Aug 3 @ 0.24", m: "+800" },
      ],
    };
  }
  return {
    twitter: [
      { who: "@tapereader", text: "CPI hot, Treasuries selling off, Fed stays high", m: "↑ 204" },
      { who: "@macrobee", text: "no rush on cuts — WSJ framing is doing work", m: "↑ 96" },
    ],
    reddit: [
      { who: "u/wsb", text: "everyone long the wrong leg into the print", m: "4.1k" },
      { who: "u/bonds", text: "2s10s steepens through July imo", m: "188" },
    ],
    poly: [
      { who: "Apis-α", text: "BUY NO · Fed cut ≥25bp @ 0.36", m: "+900" },
      { who: "Drone-7", text: "READ Reuters · CSP capex on track", m: "▲" },
    ],
  };
}

// ── belief-drift river (full-bleed stacked area) ─────────────────────────────
export function BeliefRiver({ series, height = 150 }: { series: BeliefPoint[]; height?: number }) {
  const W = 720, H = 200, P = { L: 0, R: W, T: 6, B: H - 6 };
  const n = series.length;
  const X = (i: number) => P.L + (i / Math.max(1, n - 1)) * (P.R - P.L);
  const Y = (v: number) => P.T + (1 - v) * (P.B - P.T);
  const band = (lowFn: (d: BeliefPoint) => number, hiFn: (d: BeliefPoint) => number) => {
    const top = series.map((d, i) => `${X(i).toFixed(1)},${Y(hiFn(d)).toFixed(1)}`);
    const bot = series.map((d, i) => `${X(i).toFixed(1)},${Y(lowFn(d)).toFixed(1)}`).reverse();
    return `${top.join(" ")} ${bot.join(" ")}`;
  };
  const cumBear = (d: BeliefPoint) => d.bearish;
  const cumNeu = (d: BeliefPoint) => d.bearish + d.neutral;
  const f = series[n - 1];
  const legend: [string, number, string][] = [["Bullish", f.bullish, "var(--live)"], ["Neutral", f.neutral, "var(--fg-3)"], ["Bearish", f.bearish, "var(--danger)"]];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block", borderRadius: 8 }}>
        <polygon points={band(() => 0, cumBear)} fill="var(--danger)" opacity="0.5" />
        <polygon points={band(cumBear, cumNeu)} fill="var(--fg-3)" opacity="0.3" />
        <polygon points={band(cumNeu, () => 1)} fill="var(--live)" opacity="0.5" />
        <polyline points={series.map((d, i) => `${X(i).toFixed(1)},${Y(cumBear(d)).toFixed(1)}`).join(" ")} fill="none" stroke="var(--danger)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.55" />
        <polyline points={series.map((d, i) => `${X(i).toFixed(1)},${Y(cumNeu(d)).toFixed(1)}`).join(" ")} fill="none" stroke="var(--live)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: "flex", gap: 18, marginTop: 11, flexWrap: "wrap" }}>
        {legend.map(([l, v, c]) => (
          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)" }}>
            <i style={{ width: 9, height: 9, borderRadius: 2, background: c }} /><b style={{ color: "var(--fg)", fontWeight: 600 }}>{Math.round(v * 100)}%</b> {l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── cost meter ───────────────────────────────────────────────────────────────
export function CostMeter({ cost, model }: { cost: number; model: CostModel }) {
  const pct = frClamp(cost / model.budget, 0, 1);
  return (
    <div style={{ display: "grid", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="sv-num" style={{ fontSize: 23, color: "var(--honey)", letterSpacing: "-0.02em" }}>${cost.toFixed(2)}</span>
        <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>/ ~${model.budget.toFixed(2)} budget</span>
        <span className="sv-mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--fg-3)" }}>{model.calls.toLocaleString()} LLM calls · {(model.tokens / 1e6).toFixed(1)}M tok</span>
      </div>
      <div style={{ position: "relative", height: 7, borderRadius: 99, background: "var(--panel-2)", border: "1px solid var(--line-2)", overflow: "hidden" }}>
        <i style={{ position: "absolute", inset: "0 auto 0 0", width: (pct * 100).toFixed(1) + "%", borderRadius: 99, background: "linear-gradient(90deg, var(--honey), color-mix(in srgb, var(--honey) 55%, #fff))" }} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {model.byPhase.map((p) => (
          <div key={p.k} style={{ flex: p.w, minWidth: 0 }} title={`${p.k} · ${Math.round(p.w * 100)}%`}>
            <div style={{ height: 4, borderRadius: 2, background: "color-mix(in srgb, var(--honey) 40%, transparent)" }} />
            <div className="sv-mono" style={{ fontSize: 8.5, color: "var(--fg-4)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── tri-platform live feed ───────────────────────────────────────────────────
export function TriPlatformFeed({ feed, live = true }: { feed: PlatformFeed; live?: boolean }) {
  const cols = [
    { key: "twitter" as const, label: "Twitter", col: "#1d9bf0", g: "↗" },
    { key: "reddit" as const, label: "Reddit", col: "#ff4500", g: "▲" },
    { key: "poly" as const, label: "Polymarket", col: "var(--honey)", g: "◈" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
      {cols.map((c) => (
        <div key={c.key} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "color-mix(in srgb, var(--bg) 45%, var(--panel))", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", borderBottom: "1px solid var(--line)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: c.col }} />
            <span className="sv-mono" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)" }}>{c.label}</span>
            {live
              ? <span className="fr-dot live sv-livedot" style={{ marginLeft: "auto", color: "var(--live)", width: 5, height: 5 }} />
              : <span className="sv-mono" style={{ marginLeft: "auto", fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)" }}>final</span>}
          </div>
          <div style={{ display: "grid", gap: 1, padding: 5 }}>
            {(feed[c.key] || []).map((p, i) => (
              <div key={p.key || i} className="fr-streamline" style={{ gridTemplateColumns: "1fr", gap: 3, opacity: i === 0 ? 1 : Math.max(0.4, 1 - i * 0.14) }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: c.col, fontWeight: 600, fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.who}</span>
                  <span className="sv-mono" style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{c.g} {p.m}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-2)", lineHeight: 1.35 }}>{p.text}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── director / counterfactual control bar ────────────────────────────────────
export function DirectorBar({ round, done }: { round: number; done?: boolean }) {
  const [injected, setInjected] = React.useState<{ t: string; r: number }[]>([]);
  const [val, setVal] = React.useState("");
  const inject = () => { if (val.trim()) { setInjected((x) => [{ t: val.trim(), r: round }, ...x].slice(0, 3)); setVal(""); } };
  if (done) return (
    <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
      <Icon name="repeat" size={14} color="var(--honey)" />
      <span style={{ fontSize: 12, color: "var(--fg-2)" }}>Re-run this scenario from any round with an injected event — the branch sits side-by-side for comparison.</span>
      <Button variant="ghost" sm style={{ marginLeft: "auto" }}><Icon name="repeat" size={13} /> Fork a counterfactual</Button>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 9 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Icon name="alert" size={14} color="var(--honey)" />
        <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && inject()}
          placeholder={`Inject breaking news into round ${round}…`}
          style={{ flex: 1, minWidth: 180, padding: "9px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 12.5, outline: "none" }} />
        <Button variant="ghost" sm onClick={inject}><Icon name="plus" size={13} sw={2} /> Inject</Button>
        <Button variant="ghost" sm><Icon name="repeat" size={13} /> Fork at r{round}</Button>
      </div>
      {injected.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {injected.map((e, i) => (
            <span key={i} className="sv-chip" style={{ borderColor: "var(--honey-line)", color: "var(--honey)" }}>◆ r{e.r}: {e.t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── consensus signal card ────────────────────────────────────────────────────
export function ConsensusCard({ run, signal }: { run: Run; signal?: Signal }) {
  const sig = signal || frBeliefSignal(run);
  const st = FR_STANCE[sig.stance];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "15px 18px", borderRadius: "var(--radius)", border: `1px solid ${st.col}`, background: `color-mix(in srgb, ${st.col} 9%, var(--panel))` }}>
      <div style={{ position: "relative", width: 60, height: 60, flex: "0 0 auto" }}>
        <svg width="60" height="60" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="30" cy="30" r="25" fill="none" stroke="var(--line-2)" strokeWidth="5" />
          <circle cx="30" cy="30" r="25" fill="none" stroke={st.col} strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 25} strokeDashoffset={2 * Math.PI * 25 * (1 - sig.confidence_pct / 100)} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}><span className="sv-num" style={{ fontSize: 15 }}>{sig.confidence_pct}%</span></div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="sv-eyebrow" style={{ color: st.col }}>Swarm consensus · {sig.tier}</div>
        <div style={{ fontFamily: "var(--f-display)", fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 3 }}>
          {st.label} <span style={{ color: "var(--fg-3)", fontWeight: 500, fontSize: 16 }}>· {sig.pct}% of agents</span>
        </div>
        <div className="sv-mono" style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 5 }}>{sig.confidence_pct}% confidence · {sig.tier} tier · ±0.2 stance threshold</div>
      </div>
    </div>
  );
}
