"use client";

/* charts.tsx — small theme-aware SVG charts: Sparkline, line/area trend, the
   PnL/Sharpe/Position metric toggle, linear progress bar and progress ring. */

import React from "react";
import { frTone } from "./primitives";
import { frBuildTrend, frHash, frRunTrend, type Run, type Tone } from "./sim-data";

export function Sparkline({ series, w = 92, h = 26, tone = "live" }: { series: number[]; w?: number; h?: number; tone?: Tone }) {
  const max = Math.max(...series), min = Math.min(...series);
  const X = (i: number) => (i / (series.length - 1)) * w;
  const Y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <polyline points={series.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" stroke={frTone(tone)} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(series.length - 1)} cy={Y(series[series.length - 1])} r={2} fill={frTone(tone)} />
    </svg>
  );
}

export function SimTrendChart({ series, height = 150, tone = "live", threshold = null, fmt }: {
  series: number[]; height?: number; tone?: Tone; threshold?: number | null; fmt?: (v: number) => string;
}) {
  const W = 760, H = 220, P = { L: 44, R: W - 16, T: 14, B: H - 22 };
  const max = Math.max(...series, threshold ?? -Infinity) * 1.12;
  const min = Math.min(0, ...series);
  const X = (i: number) => P.L + (i / (series.length - 1)) * (P.R - P.L);
  const Y = (v: number) => P.B - ((v - min) / (max - min || 1)) * (P.B - P.T);
  const line = series.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const area = `${X(0)},${P.B} ${line} ${X(series.length - 1)},${P.B}`;
  const col = frTone(tone), f = fmt || ((v: number) => v.toFixed(1));
  const cross = threshold != null ? series.findIndex((v) => v >= threshold) : -1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
      {[0, 0.5, 1].map((g) => { const v = min + g * (max - min); return (
        <g key={g}><line x1={P.L} y1={Y(v)} x2={P.R} y2={Y(v)} stroke="var(--line)" strokeWidth={1} /><text x={P.L - 8} y={Y(v) + 3.5} textAnchor="end" fontFamily="var(--f-mono)" fontSize={9} fill="var(--fg-4)">{f(v)}</text></g>
      ); })}
      {threshold != null && (<g><line x1={P.L} y1={Y(threshold)} x2={P.R} y2={Y(threshold)} stroke="var(--honey)" strokeWidth={1.3} strokeDasharray="4 5" opacity={0.8} /><text x={P.R} y={Y(threshold) - 6} textAnchor="end" fontFamily="var(--f-mono)" fontSize={9.5} fill="var(--honey)">auto-stop {f(threshold)}</text></g>)}
      <defs><linearGradient id={`svArea-${tone}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity={0.22} /><stop offset="1" stopColor={col} stopOpacity={0} /></linearGradient></defs>
      <polygon points={area} fill={`url(#svArea-${tone})`} />
      <polyline points={line} fill="none" stroke={col} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(series.length - 1)} cy={Y(series[series.length - 1])} r={3.6} fill={col} />
      {cross > 0 && <circle cx={X(cross)} cy={Y(series[cross])} r={3} fill="none" stroke="var(--honey)" strokeWidth={1.6} />}
    </svg>
  );
}

export function SimMetricChart({ run, height = 168 }: { run: Run; height?: number }) {
  const [view, setView] = React.useState<"pnl" | "sharpe" | "position">("sharpe");
  const series = React.useMemo(() => {
    if (view === "sharpe") return { s: frRunTrend(run), tone: "live" as Tone, threshold: 2.0, fmt: (v: number) => v.toFixed(1) };
    if (view === "pnl") return { s: frBuildTrend({ seed: frHash(run.id + "pnl"), n: 56, start: -0.1, end: 0.42, wobble: 0.2, dip: 0.18 }), tone: "honey" as Tone, threshold: null, fmt: (v: number) => v.toFixed(2) + "%" };
    return { s: frBuildTrend({ seed: frHash(run.id + "pos"), n: 56, start: 0.6, end: 1.3, wobble: 0.12 }), tone: "neutral" as Tone, threshold: 1.4, fmt: (v: number) => v.toFixed(1) + "M" };
  }, [view, run.id]);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="sv-eyebrow">{view} · over rounds</span>
        <div className="fb-seg sub" style={{ padding: 3 }}>
          {(["pnl", "sharpe", "position"] as const).map((v) => (
            <button key={v} type="button" data-active={view === v ? "" : undefined} onClick={() => setView(v)} style={{ padding: "5px 11px", fontSize: 11, textTransform: "capitalize" }}>{v}</button>
          ))}
        </div>
      </div>
      <SimTrendChart series={series.s} height={height} tone={series.tone} threshold={series.threshold} fmt={series.fmt} />
    </div>
  );
}

export function SimProgressBar({ pct, left, right, tone = "live" }: { pct: number; left: string; right: string; tone?: Tone }) {
  return (
    <div>
      <div style={{ position: "relative", height: 7, borderRadius: 99, background: "var(--panel-2)", border: "1px solid var(--line-2)", overflow: "hidden" }}>
        <i style={{ position: "absolute", inset: "0 auto 0 0", width: (pct * 100).toFixed(1) + "%", borderRadius: 99, background: tone === "danger" ? "var(--danger)" : `linear-gradient(90deg, ${frTone(tone)}, color-mix(in srgb, ${frTone(tone)} 55%, #fff))` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}><span>{left}</span><span>{right}</span></div>
    </div>
  );
}

export function SimProgressRing({ pct, value, sub, label, size = 128 }: { pct: number; value: React.ReactNode; sub?: string; label?: string; size?: number }) {
  const r = size / 2 - 9, c = 2 * Math.PI * r;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line-2)" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--live)" strokeWidth={6} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.7,.3,1)", filter: "drop-shadow(0 0 4px var(--live-soft))" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", lineHeight: 1.15 }}>
        <div><div className="sv-num" style={{ fontSize: 20, color: "var(--fg)" }}>{value}</div>{sub && <div className="sv-mono" style={{ fontSize: 9, color: "var(--fg-4)", marginTop: 4 }}>{sub}</div>}</div>
      </div>
      {label && <div className="sv-mono" style={{ position: "absolute", bottom: -2, left: 0, right: 0, textAlign: "center", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)" }}>{label}</div>}
    </div>
  );
}
