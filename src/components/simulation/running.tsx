"use client";

/* running.tsx — the "Sim running" state, mirroring the real MiroShark pipeline
   (Graph build → Agent setup → Simulation → Report). A determinate compute view:
   a Result-style card (top bar with status + controls + Running/Result toggle,
   title, progress ring + phase stepper), the belief-drift river forming live, a
   live consensus + confidence + AMM-price read, the "$1" cost meter ticking up,
   three platforms streaming, and Director-mode / counterfactual controls. On
   completion it converts the live sections to their terminal form and, after a
   beat, hands off to the full Result read-out. */

/* The run-derived memos key on run.id (not the run object, which is a fresh
   reference on each metadata poll) — intentional, matching the repo convention. */
/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import { Badge, Button, frTone } from "./primitives";
import { Icon } from "./icons";
import { SimProgressRing, SimProgressBar } from "./charts";
import { SimStatus, SimTemplateTag } from "./theater";
import { SimPanel } from "./detail";
import { FR_FACTION, type Run, type Faction } from "./sim-data";
import {
  BeliefRiver, CostMeter, TriPlatformFeed, DirectorBar, FR_STANCE,
  frBeliefSeries, frBeliefSignal, frCostModel, frPlatformPools, type PlatformFeed,
} from "./signal";

const frSmooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const frLerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frClampN = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const frFmtClock = (s: number) => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60), ss = s % 60; return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`; };
const frFmtETA = (s: number) => { if (!isFinite(s) || s <= 0) return "—"; const m = Math.floor(s / 60), ss = Math.round(s % 60); return m ? `~${m}m ${String(ss).padStart(2, "0")}s` : `~${ss}s`; };

export const FR_PIPELINE = [
  { label: "Graph build", hint: "NER → Neo4j graph", to: 0.12 },
  { label: "Agent setup", hint: "5-layer grounding", to: 0.26 },
  { label: "Simulation", hint: "Twitter · Reddit · market", to: 0.92 },
  { label: "Report", hint: "ReACT write-up", to: 1.00 },
];
const frPipelineIdx = (pct: number) => { for (let i = 0; i < FR_PIPELINE.length; i++) if (pct < FR_PIPELINE[i].to) return i; return FR_PIPELINE.length - 1; };
const frFacCol = (f: Faction) => frTone((FR_FACTION[f] || FR_FACTION.OPS).tone);

function buildRoster(run: Run) {
  const facs: Faction[] = ["MM", "TKR", "INFO", "OPS"];
  const n = Math.min(64, run.agents || 24);
  return Array.from({ length: n }, (_, i) => ({ id: i, faction: facs[(i * 7 + 1) % 4] }));
}

export function SimRunViewSeg({ view, onChange }: { view: "running" | "result"; onChange: (v: "running" | "result") => void }) {
  return (
    <div className="fr-seg" role="tablist">
      <button data-on={view === "running" ? "" : undefined} onClick={() => onChange("running")}>Running</button>
      <button data-on={view === "result" ? "" : undefined} onClick={() => onChange("result")}>Result</button>
    </div>
  );
}

export function SimRunningDetail({ run, onResult, finished }: { run: Run; onResult?: () => void; finished?: boolean }) {
  const simRounds = run.template === "polymarket" && run.market ? (run.rounds || 32) : (run.rounds && run.rounds < 200 ? run.rounds : 28);
  const roster = React.useMemo(() => buildRoster(run), [run.id]);
  const fullSeries = React.useMemo(() => frBeliefSeries(run), [run.id]);
  const pools = React.useMemo(() => frPlatformPools(run), [run.id]);
  const costModel = React.useMemo(() => frCostModel(run, 1), [run.id]);

  // A FINISHED run opens the running view in its terminal "done" snapshot (100%, no
  // animation) — toggling Result→Running must not look like the sim is running again.
  // A live run resumes its animation from its real progress. Either way the "↺ Replay"
  // button re-runs the animation on demand.
  const startPct = finished ? 1 : (run.currentRound && run.rounds ? frClampN((run.currentRound / run.rounds) * 0.66 + 0.26, 0.26, 0.98) : 0.62);
  const [pct, setPct] = React.useState(startPct);
  const [elapsed, setElapsed] = React.useState(run.template === "polymarket" ? 280 : 360);
  const [paused, setPaused] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const seq = React.useRef(0);
  const switched = React.useRef(false);
  const [feed, setFeed] = React.useState<PlatformFeed>(() => ({ twitter: pools.twitter.slice(0, 3), reddit: pools.reddit.slice(0, 3), poly: pools.poly.slice(0, 3) }));

  const done = pct >= 1;
  const pIdx = frPipelineIdx(pct);
  const intervalMs = 700;

  React.useEffect(() => {
    if (paused || done) return;
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(() => {
      setPct((p) => Math.min(1, p + (reduce ? 0.012 : 0.02) * speed * (0.7 + Math.random() * 0.6)));
      setElapsed((e) => e + (intervalMs / 1000) * speed);
      seq.current += 1;
      setFeed((prev) => {
        const adv = (key: keyof PlatformFeed) => { const pool = pools[key]; return [{ ...pool[seq.current % pool.length], key: `${key}${seq.current}` }, ...prev[key]].slice(0, 4); };
        return { twitter: adv("twitter"), reddit: adv("reddit"), poly: adv("poly") };
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [paused, done, speed, pools]);

  // When a LIVE run's animation completes, hold on the "complete" moment briefly, then
  // hand off to Result. A finished run opened in its terminal state never auto-advances
  // (the user toggled in deliberately) — and a user-triggered Replay on it stays put too.
  React.useEffect(() => {
    if (finished || !done || switched.current || !onResult) return;
    switched.current = true;
    const t = setTimeout(() => onResult(), 1500);
    return () => clearTimeout(t);
  }, [finished, done, onResult]);

  const simProg = frClampN((pct - 0.26) / (0.92 - 0.26), 0, 1);
  const shown = Math.max(2, Math.round(simProg * fullSeries.length));
  const series = fullSeries.slice(0, shown);
  const signal = frBeliefSignal(run, series);
  const stability = frSmooth(simProg);
  const onlineN = pct >= 0.26 ? roster.length : Math.round(frClampN(4 + (roster.length - 4) * frSmooth(pct / 0.26), 0, roster.length));
  const simRound = Math.round(simProg * simRounds);
  const eta = ((1 - pct) / ((0.02 * speed) / (intervalMs / 1000))) * (intervalMs / 1000);
  const cost = frCostModel(run, pct);
  const ammYes = run.template === "polymarket" && run.market ? Math.round(run.market.outcomes[0].prob * 100) : null;
  const st = FR_STANCE[signal.stance];

  const resetReplay = () => { setPct(0); setElapsed(0); setPaused(false); seq.current = 0; switched.current = false; };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* run card — mirrors the Result view: top bar (status · controls), title, then progress */}
      <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--radius)", background: "var(--panel-2)", padding: "14px 18px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap", paddingBottom: 13, borderBottom: "1px solid var(--line)" }}>
          {done
            ? <Badge tone="neutral"><span className="fr-dot" style={{ color: "var(--live)", width: 5, height: 5 }} /> Complete</Badge>
            : <SimStatus run={run} />}
          <SimTemplateTag template={run.template} />
          <span className="sv-mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>nimbus · {run.started}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 7, alignItems: "center" }}>
            {!done && <Button variant="ghost" sm onClick={() => setPaused((p) => !p)}>{paused ? "▶ Resume" : "❚❚ Pause"}</Button>}
            {!done && <Button variant="ghost" sm onClick={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))}>{speed}× speed</Button>}
            <Button variant="ghost" sm onClick={resetReplay}>↺ Replay</Button>
            <SimRunViewSeg view="running" onChange={(v) => v === "result" && onResult && onResult()} />
          </div>
        </div>

        <h3 style={{ margin: "14px 0 16px", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 20, letterSpacing: "-0.02em", lineHeight: 1.2, color: "var(--fg)" }}>{run.title}</h3>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "center" }}>
          <SimProgressRing pct={pct} value={`${Math.round(pct * 100)}%`} sub={done ? "complete" : "running"} size={120} />
          <div style={{ display: "grid", gap: 13, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div className="fr-run-big">{pIdx >= 2 ? <>{simRound}<span className="of"> / {simRounds} rounds</span></> : <>{Math.round(pct * 100)}<span className="of">% built</span></>}</div>
                <div className="sv-mono" style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-4)", marginTop: 6 }}>{FR_PIPELINE[pIdx].label} · {FR_PIPELINE[pIdx].hint}</div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 20 }}>
                <div className="fr-run-hstat"><div className="v" style={{ color: "var(--fg)" }}>{frFmtClock(elapsed)}</div><div className="k">elapsed</div></div>
                <div className="fr-run-hstat"><div className="v" style={{ color: "var(--live)" }}>{done ? "done" : frFmtETA(eta)}</div><div className="k">eta</div></div>
                <div className="fr-run-hstat"><div className="v" style={{ color: "var(--honey)" }}>${cost.cost.toFixed(2)}</div><div className="k">spent</div></div>
              </div>
            </div>
            <SimProgressBar pct={pct} left={`${FR_PIPELINE[pIdx].label}${done ? "" : " · in progress"}`} right={`${(pct * 100).toFixed(0)}%`} />
            <div className="fr-phases">
              {FR_PIPELINE.map((p, i) => {
                const stt = done ? "done" : i < pIdx ? "done" : i === pIdx ? "active" : "todo";
                return (<div key={p.label} className={`fr-phase ${stt}`}><span className="pd">{stt === "done" ? "✓" : i + 1}</span><span className="pt"><b>{p.label}</b><em>{p.hint}</em></span></div>);
              })}
            </div>
          </div>
        </div>
      </div>

      {/* belief river — the signature output forming live */}
      <SimPanel label={`Belief drift · ${pIdx < 2 ? "awaiting simulation" : stability > 0.85 ? "converged" : `forming ${Math.round(stability * 100)}%`}`}>
        {pIdx < 2
          ? <div style={{ display: "grid", placeItems: "center", height: 132 }}><div className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>agents not seeded yet — belief drift begins in the Simulation phase</div></div>
          : <BeliefRiver series={series} />}
      </SimPanel>

      {/* signal + cost */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        <SimPanel label={`Signal · ${pIdx < 2 ? "pending" : signal.tier}`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
            <div className="fr-rmetric"><div className="v" style={{ color: st.col }}>{pIdx < 2 ? "—" : `${st.label} ${signal.pct}%`}</div><div className="b">dominant stance</div><div className="k">consensus</div></div>
            <div className="fr-rmetric"><div className="v" style={{ color: "var(--honey)" }}>{pIdx < 2 ? "—" : `${signal.confidence_pct}%`}</div><div className="b">{pIdx < 2 ? "—" : signal.tier}</div><div className="k">confidence</div></div>
            <div className="fr-rmetric"><div className="v">{ammYes != null ? `${ammYes}¢` : "—"}</div><div className="b">{ammYes != null ? "AMM · YES" : "no market"}</div><div className="k">market price</div></div>
            <div className="fr-rmetric"><div className="v">{pIdx < 2 ? "—" : `${Math.round(frLerp(64, 22, stability))}`}</div><div className="b">{stability > 0.7 ? "converging" : "contested"}</div><div className="k">volatility idx</div></div>
          </div>
        </SimPanel>
        <SimPanel label="Run cost · $1 budget"><CostMeter cost={cost.cost} model={costModel} /></SimPanel>
      </div>

      {/* terminal-aware live sections */}
      <SimPanel label={done ? `Agents participated · ${roster.length}` : `Population online · ${onlineN} / ${roster.length} agents`}>
        <div className="fr-hex">
          {roster.map((a, i) => (<i key={a.id} className={done || i < onlineN ? "on" : "spawn"} style={{ ["--fc" as string]: frFacCol(a.faction), animationDelay: done ? undefined : `${(i % 16) * 0.08}s` } as React.CSSProperties} title={a.faction} />))}
        </div>
      </SimPanel>

      <SimPanel label={done ? "Activity · final round captured" : "Live activity · three platforms, every round"}>
        <TriPlatformFeed feed={feed} live={!done} />
      </SimPanel>

      <SimPanel label={done ? "Counterfactual · fork this run from any round" : "Director mode · steer the live timeline"}>
        <DirectorBar round={Math.max(1, simRound)} done={done} />
      </SimPanel>

      {/* locked / complete */}
      {done ? (
        <div className="fr-done">
          <div style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: "color-mix(in srgb,var(--live) 16%,transparent)", border: "1px solid color-mix(in srgb,var(--live) 45%,transparent)", flex: "0 0 auto" }}><Icon name="check" size={18} color="var(--live)" sw={2.2} /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>Run complete · {st.label} {signal.pct}%</div>
            <div className="sv-mono" style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>report written · {signal.confidence_pct}% confidence · ${cost.cost.toFixed(2)} spent · switch to <b style={{ color: "var(--live)" }}>Result</b> for the full read-out</div>
          </div>
        </div>
      ) : (
        <div className="fr-locked">
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ color: "var(--honey)", display: "grid", placeItems: "center" }}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg></span>
            <span className="sv-eyebrow" style={{ color: "var(--honey)" }}>Report locked</span>
            <span className="sv-mono" style={{ fontSize: 10.5, color: "var(--fg-4)" }}>the ReACT report agent runs once the Simulation phase closes · {frFmtETA(eta)} out</span>
          </div>
          <div style={{ display: "grid", gap: 7 }}><div className="fr-skel" style={{ width: "64%" }} /><div className="fr-skel" style={{ width: "88%" }} /><div className="fr-skel" style={{ width: "73%" }} /></div>
        </div>
      )}
    </div>
  );
}
