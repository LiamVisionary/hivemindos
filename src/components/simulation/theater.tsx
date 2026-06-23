"use client";

/* theater.tsx — the market-making live-theater pieces plus shared status/tag
   atoms: status badge, template tag, faction chip, metric tile, agent row,
   decision console, market tape + order ladder, headlines, round table, run
   controls, and the live knobs (position cap + auto-stop). */

import React from "react";
import { Badge, Button, Dot, Toggle, frTone } from "./primitives";
import { Icon } from "./icons";
import {
  FR_FACTION, FR_STATE_TONE, FR_TEMPLATE_LABEL, SW_DECISIONS, SW_MARKET, SW_ROUND_TABLE,
  type Decision, type Agent, type Faction, type MetricTile, type Run, type TemplateId,
} from "./sim-data";

export function SimStatus({ run }: { run: Run }) {
  const tone = FR_STATE_TONE[run.state];
  const label = { live: "Running", ready: "Ready", done: "Done", failed: "Failed" }[run.state];
  if (run.state === "live") return <Badge tone="live"><span className="fr-dot live sv-livedot" style={{ color: "var(--live)", width: 5, height: 5 }} /> {label}</Badge>;
  return <Badge tone={tone === "neutral" ? undefined : tone}><span className="fr-dot" style={{ color: frTone(tone), width: 5, height: 5 }} /> {label}</Badge>;
}

export function SimTemplateTag({ template }: { template: TemplateId }) {
  return <span className="sv-tag">{FR_TEMPLATE_LABEL[template] || template}</span>;
}

export function SimFaction({ f, withName }: { f: Faction; withName?: boolean }) {
  const meta = FR_FACTION[f] || FR_FACTION.OPS;
  const col = frTone(meta.tone);
  return <span className="sv-fac" style={{ color: col, borderColor: `color-mix(in srgb, ${col} 40%, transparent)`, background: `color-mix(in srgb, ${col} 12%, transparent)` }}>{withName ? meta.name : meta.label}</span>;
}

export function SimMetric({ k, v, tone }: MetricTile) {
  return (<div className="sv-metric"><div className="v" style={{ color: tone ? frTone(tone) : "var(--fg)" }}>{v}</div><div className="k">{k}</div></div>);
}

export function SimChip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className="sv-chip" style={tone ? { borderColor: tone, color: tone } : undefined}>{children}</span>;
}

export function SimTags({ tags }: { tags: string[] }) {
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{tags.map((t) => <span key={t} className="sv-tag">#{t}</span>)}</div>;
}

export function SimAgent({ a }: { a: Agent }) {
  return (
    <div className="sv-agent">
      <Dot live={a.status === "live"} color={a.status === "live" ? "var(--live)" : "var(--fg-3)"} size={7} />
      <div style={{ minWidth: 0 }}><div className="nm">{a.name}</div><div className="ro">{a.role}</div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
        <span className="sv-mono" style={{ fontSize: 10.5, color: a.ledger.startsWith("-") ? "var(--danger)" : a.ledger === "\u2014" ? "var(--fg-4)" : "var(--live)" }}>{a.ledger}</span>
        <SimFaction f={a.faction} />
      </div>
    </div>
  );
}

export function SimDecisionLog({ decisions = SW_DECISIONS, height }: { decisions?: Decision[]; height?: number }) {
  return (
    <div className="sv-con fr-scroll" style={height ? { maxHeight: height, overflowY: "auto" } : undefined}>
      {decisions.map((d, i) => {
        const col = frTone((FR_FACTION[d.role] || FR_FACTION.OPS).tone);
        return (
          <div key={i} className="sv-conline">
            <span className="who">{d.who}</span>
            <span className="act" style={{ color: col }}>{d.action}</span>
            <span className="det">{d.detail}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SimTape({ market = SW_MARKET, height = 110 }: { market?: typeof SW_MARKET; height?: number }) {
  const t = market.ticks;
  if (!t.length) return <div className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)", padding: "16px 0", textAlign: "center" }}>No market tape for this run.</div>;
  const W = 460, H = height, min = Math.min(...t), max = Math.max(...t);
  const X = (i: number) => 6 + (i / (t.length - 1)) * (W - 12);
  const Y = (v: number) => H - 8 - ((v - min) / (max - min || 1)) * (H - 16);
  const last = t[t.length - 1], up = last >= t[0];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <span className="sv-eyebrow">{market.symbol}</span>
        <span className="sv-mono" style={{ fontSize: 12, color: up ? "var(--live)" : "var(--danger)" }}>{last.toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block" }}>
        <polyline points={t.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" stroke={up ? "var(--live)" : "var(--danger)"} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ marginTop: 10, display: "grid", gap: 1 }}>
        {market.ladder.slice(0, 5).map((l, i) => {
          const isBid = l.bid != null;
          const size = (isBid ? l.bid : l.ask) ?? 0;
          const w = Math.min(100, (size / 612) * 100);
          return (
            <div key={i} className="sv-ladrow">
              <span style={{ color: "var(--fg-3)" }}>{l.px.toFixed(2)}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ flex: 1, height: 9, borderRadius: 3, background: "var(--panel-2)", overflow: "hidden" }}>
                  <i style={{ display: "block", height: "100%", width: w + "%", background: isBid ? "color-mix(in srgb, var(--live) 55%, transparent)" : "color-mix(in srgb, var(--danger) 55%, transparent)" }} />
                </div>
                <span style={{ width: 34, textAlign: "right", color: "var(--fg-4)" }}>{size}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SimHeadlines({ headlines = SW_MARKET.headlines }: { headlines?: typeof SW_MARKET.headlines }) {
  const tone: Record<string, string> = { bull: "var(--live)", bear: "var(--danger)", neutral: "var(--fg-3)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {headlines.map((h, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 10, alignItems: "baseline" }}>
          <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>{h.t}</span>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: tone[h.tone], transform: "translateY(-1px)" }} />
          <span style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.4 }}>{h.body}</span>
        </div>
      ))}
    </div>
  );
}

export function SimRunTable({ rows = SW_ROUND_TABLE }: { rows?: typeof SW_ROUND_TABLE }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, padding: "0 2px 6px" }}>
        {["round", "pnl \u0394", "sharpe", "pos"].map((h) => <span key={h} className="sv-eyebrow">{h}</span>)}
      </div>
      <div style={{ display: "grid", gap: 1 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, padding: "6px 2px", borderTop: "1px solid var(--line)", fontFamily: "var(--f-mono)", fontSize: 11.5 }}>
            <span style={{ color: "var(--fg-3)" }}>{r.round}</span>
            <span style={{ color: r.pnl.startsWith("-") ? "var(--danger)" : "var(--live)" }}>{r.pnl}</span>
            <span style={{ color: "var(--fg-2)" }}>{r.sharpe}</span>
            <span style={{ color: "var(--fg-2)" }}>{r.pos}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimSpeed() {
  const [s, setS] = React.useState(1);
  const steps = [0.5, 1, 2, 4];
  const idx = steps.indexOf(s);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2, border: "1px solid var(--line-2)", borderRadius: 99, padding: 2, background: "var(--panel-2)" }}>
      <button type="button" onClick={() => setS(steps[Math.max(0, idx - 1)])} aria-label="Slower" style={{ width: 24, height: 24, borderRadius: 99, border: 0, background: "transparent", color: "var(--fg-3)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>−</button>
      <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-2)", minWidth: 26, textAlign: "center" }}>{s}×</span>
      <button type="button" onClick={() => setS(steps[Math.min(steps.length - 1, idx + 1)])} aria-label="Faster" style={{ width: 24, height: 24, borderRadius: 99, border: 0, background: "transparent", color: "var(--fg-3)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>+</button>
    </div>
  );
}

export function SimControls({ run }: { run: Run }) {
  if (run.state === "live") return (
    <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="ghost" sm><Icon name="alert" size={13} /> Pause</Button>
      <SimSpeed />
      <Button variant="ghost" sm><Icon name="warn" size={13} /> Stop</Button>
    </div>
  );
  if (run.state === "ready") return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {run.template === "x-thread"
        ? <Button variant="ghost" sm>Edit scenario</Button>
        : <><Button variant="primary" sm><Icon name="check" size={13} sw={2.2} /> Launch run</Button><Button variant="ghost" sm>Edit scenario</Button></>}
    </div>
  );
  if (run.state === "failed") return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      <Button variant="ghost" sm><Icon name="repeat" size={13} /> Retry</Button>
      <Button variant="ghost" sm><Icon name="doc" size={13} /> Logs</Button>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      <Button variant="ghost" sm><Icon name="repeat" size={13} /> Re-run</Button>
      <Button variant="ghost" sm><Icon name="download" size={13} /> Export</Button>
    </div>
  );
}

export function SimKnobs() {
  const [cap, setCap] = React.useState(1.4);
  const [autostop, setAutostop] = React.useState(true);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)" }}>
          <span>Position cap</span><span style={{ color: "var(--fg)" }}>{cap.toFixed(1)}M</span>
        </span>
        <input type="range" min={0} max={5} step={0.1} value={cap} onChange={(e) => setCap(+e.target.value)} style={{ accentColor: "var(--honey)", width: "100%" }} />
      </label>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12, color: "var(--fg-2)" }}>Auto-stop at sharpe 2.0</span>
        <Toggle on={autostop} onChange={() => setAutostop((v) => !v)} />
      </div>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.5, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        Fluid swarm v2 · 12,000 rounds · position cap enforced until sharpe &gt; 2.0. The crossing is surfaced automatically — no intervention needed.
      </div>
    </div>
  );
}
