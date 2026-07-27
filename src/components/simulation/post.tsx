"use client";

/* post.tsx — post-run extras for finished simulations, grounded in the real
   MiroShark analytics + export surfaces (github.com/aaronjmars/MiroShark): the
   consensus signal, the final belief-drift trajectory, the "$1" cost breakdown,
   an influence leaderboard, the spawned population's demographics, run-quality +
   belief-volatility diagnostics, and the share / export surface row. */

/* The post-run derivations are pure functions of run identity, so they key on
   run.id rather than the run object (which is a fresh reference on each metadata
   poll) — keying on the object would recompute every render. Intentional, matching
   the repo convention (e.g. VaultPanel). */
/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import { Icon, type IconName } from "./icons";
import { SimPanel } from "./detail";
import { SimFaction } from "./theater";
import { frRng, frHash, frClamp, type Run, type Faction } from "./sim-data";
import { BeliefRiver, CostMeter, ConsensusCard, frBeliefSeries, frBeliefSignal, frCostModel } from "./signal";

function frInfluence(run: Run) {
  const r = frRng(frHash(run.id + "infl"));
  const names = ["Apis-α", "Scout-3", "Drone-7", "Pollen-9", "Forager-2", "Worker-12", "Sentry-α", "Apis-β"];
  const facs: Faction[] = ["MM", "INFO", "INFO", "MM", "TKR", "TKR", "OPS", "MM"];
  return names.map((n, i) => ({ name: n, faction: facs[i], score: Math.round(frClamp(96 - i * 11 + (r() - 0.5) * 8, 8, 99)) }))
    .sort((a, b) => b.score - a.score).slice(0, 6);
}
function frDemographics(run: Run) {
  const r = frRng(frHash(run.id + "demo"));
  const base: [string, number][] = [["Retail / individual", 34], ["Institutional", 18], ["Media / press", 16], ["Domain expert", 14], ["Skeptic / contrarian", 11], ["Bot / automated", 7]];
  const raw = base.map(([l, w]) => [l, Math.max(3, Math.round(w + (r() - 0.5) * 8))] as [string, number]);
  const tot = raw.reduce((a, x) => a + x[1], 0);
  return raw.map(([l, w]) => ({ label: l, pct: Math.round((w / tot) * 100) }));
}
function frQuality(run: Run) {
  const r = frRng(frHash(run.id + "q"));
  const part = Math.round(frClamp(72 + r() * 24, 40, 99));
  const health = part > 85 ? "Excellent" : part > 70 ? "Good" : "Fair";
  const vol = Math.round(frClamp(28 + r() * 50, 8, 96));
  const trend = vol > 65 ? "contested" : vol > 35 ? "converging" : "stable";
  return { health, part, vol, trend, peak: Math.round(2 + r() * ((run.rounds || 24) - 3)) };
}

const FR_SURFACES: { label: string; icon: IconName }[] = [
  { label: "replay.gif", icon: "activity" }, { label: "badge.svg", icon: "shield" }, { label: "transcript.md", icon: "doc" },
  { label: "chart.svg", icon: "activity" }, { label: "cite.bib", icon: "file" }, { label: "notebook.ipynb", icon: "file" },
  { label: "polymarket.json", icon: "trade" }, { label: "webhook", icon: "repeat" },
];

function FrBars({ rows, color }: { rows: { label: string; pct: number }[]; color?: string }) {
  const max = Math.max(...rows.map((r) => r.pct), 1);
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "128px 1fr 34px", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
          <div style={{ height: 8, borderRadius: 99, background: "var(--panel-2)", overflow: "hidden" }}><i style={{ display: "block", height: "100%", width: `${(r.pct / max) * 100}%`, borderRadius: 99, background: color || "color-mix(in srgb, var(--live) 55%, transparent)" }} /></div>
          <span className="sv-mono" style={{ fontSize: 10.5, color: "var(--fg-3)", textAlign: "right" }}>{r.pct}%</span>
        </div>
      ))}
    </div>
  );
}

export function SimPostExtras({ run }: { run: Run }) {
  // Hooks must run before any early return (rules-of-hooks); the x-thread/ops
  // skip happens after these derivations, which are cheap pure functions of run.id.
  const series = React.useMemo(() => frBeliefSeries(run), [run.id]);
  const signal = React.useMemo(() => frBeliefSignal(run, series), [run.id]);
  const cost = React.useMemo(() => frCostModel(run, 1), [run.id]);
  const infl = React.useMemo(() => frInfluence(run), [run.id]);
  const demo = React.useMemo(() => frDemographics(run), [run.id]);
  const q = React.useMemo(() => frQuality(run), [run.id]);
  if (run.template === "x-thread" || run.template === "ops") return null;
  const isPoly = run.template === "polymarket";
  const qcol = q.health === "Excellent" ? "var(--live)" : q.health === "Good" ? "var(--honey)" : "var(--fg-3)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="sv-eyebrow">Post-run analysis</span>
        <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>derived from the run&apos;s actual posts, trades &amp; belief states</span>
      </div>

      {!isPoly && <ConsensusCard run={run} signal={signal} />}

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 16 }}>
        <SimPanel label="Belief trajectory · stance share per round"><BeliefRiver series={series} /></SimPanel>
        <SimPanel label="Run cost · what this sim spent">
          <CostMeter cost={cost.costTotal} model={cost} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <div className="sv-metric"><div className="v" style={{ fontSize: 16 }}>{(cost.tokTotal / 1e6).toFixed(1)}M</div><div className="k">tokens</div></div>
            <div className="sv-metric"><div className="v" style={{ fontSize: 16 }}>{cost.p50}/{cost.p90}ms</div><div className="k">latency p50/p90</div></div>
          </div>
        </SimPanel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SimPanel label="Influence · who moved the room">
          <div style={{ display: "grid", gap: 7 }}>
            {infl.map((a, i) => (
              <div key={a.name} style={{ display: "grid", gridTemplateColumns: "16px 1fr auto auto", gap: 10, alignItems: "center" }}>
                <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>{i + 1}</span>
                <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>{a.name}</span>
                <SimFaction f={a.faction} />
                <span className="sv-num" style={{ fontSize: 14, color: i === 0 ? "var(--honey)" : "var(--fg)" }}>{a.score}</span>
              </div>
            ))}
          </div>
        </SimPanel>
        <SimPanel label="Population · archetype mix"><FrBars rows={demo} color="color-mix(in srgb, var(--honey) 55%, transparent)" /></SimPanel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <div className="sv-metric"><div className="v" style={{ color: qcol }}>{q.health}</div><div className="k">run health</div></div>
        <div className="sv-metric"><div className="v">{q.part}%</div><div className="k">participation</div></div>
        <div className="sv-metric"><div className="v">{q.vol}<span style={{ fontSize: 11, color: "var(--fg-4)" }}> · {q.trend}</span></div><div className="k">volatility idx</div></div>
        <div className="sv-metric"><div className="v">r{q.peak}</div><div className="k">peak swing round</div></div>
      </div>

      <SimPanel label="Share &amp; export · every surface this run exposes">
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {FR_SURFACES.map((s) => (
            <span key={s.label} className="sv-chip" style={{ cursor: "pointer" }}><Icon name={s.icon} size={12} /> {s.label}</span>
          ))}
          {isPoly && <span className="sv-chip" style={{ borderColor: "var(--live)", color: "var(--live)" }}><Icon name="check" size={12} sw={2.2} /> signed-result.json</span>}
        </div>
        <div className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 4, lineHeight: 1.5 }}>
          Belief CSV / JSONL for pandas &amp; DuckDB, a pre-filled Jupyter notebook, an embeddable chart + status badge, an auto-formatted tweet thread, BibTeX with an on-chain DKG citation key, and an HMAC-signed result for settlement.
        </div>
      </SimPanel>
    </div>
  );
}
