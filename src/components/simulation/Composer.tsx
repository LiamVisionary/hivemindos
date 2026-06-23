"use client";

/* Composer.tsx — the launch composer. A template picker plus a per-template
   config form, in a slide-over. Each form reports a human-readable scenario
   string up to the composer; launch fires onLaunch({ template, scenario,
   rounds, platform }) so the panel can start a real MiroShark run. */

import React from "react";
import { Button } from "./primitives";
import { Icon, Chevron } from "./icons";
import { SlideOver, FLbl, FInput, FArea, FPills, XEditor } from "./SlideOver";
import { SW_TEMPLATES, type TemplateId } from "./sim-data";
import type { SimLaunchPayload } from "./sim-context";

// Default round count + downstream platform per template (matches the live
// MiroShark surface mapping in swarm-transformers.swarmTemplateIdFromSurface).
const DEFAULT_ROUNDS: Record<TemplateId, number> = {
  "polymarket": 32, "market-maker": 12000, "x-thread": 1,
  "reddit-narrative": 6, "research-swarm": 1, "ops": 5, "custom": 1,
};
const TEMPLATE_PLATFORM: Record<TemplateId, string> = {
  "polymarket": "polymarket", "reddit-narrative": "reddit", "x-thread": "twitter",
  "market-maker": "parallel", "research-swarm": "parallel", "ops": "parallel", "custom": "parallel",
};

type FormProps = { report: (scenario: string) => void };

const POLY_WINDOWS: Record<string, string[]> = {
  "Weekly": ["Jul 7 – 13", "Jul 14 – 20", "Jul 21 – 27", "Jul 28 – Aug 3", "Aug 4+"],
  "Bi-weekly": ["Jul 7 – 20", "Jul 21 – Aug 3", "Aug 4 – 17", "Aug 18+"],
  "Monthly": ["July", "August", "September", "Oct+"],
};
function PolyForm({ report }: FormProps) {
  const [kind, setKind] = React.useState<"Binary" | "Dated" | "Bucketed">("Dated");
  const [q, setQ] = React.useState("When will Anthropic release “Claude 5 Fable”?");
  const [yes, setYes] = React.useState(62);
  const [resolveBy, setResolveBy] = React.useState("2026-08-31");
  const [gran, setGran] = React.useState("Bi-weekly");
  const [unit, setUnit] = React.useState("$");
  const [buckets, setBuckets] = React.useState(["< 100M", "100M – 200M", "> 200M"]);
  React.useEffect(() => {
    const detail = kind === "Binary" ? `binary market, opening YES ${yes}¢`
      : kind === "Dated" ? `dated market, ${gran.toLowerCase()} windows resolving by ${resolveBy}`
      : `bucketed market (${unit}) with ranges: ${buckets.join(", ")}`;
    report(`Prediction market: ${q} — ${detail}.`);
  }, [kind, q, yes, resolveBy, gran, unit, buckets, report]);
  return (
    <>
      <div className="so-row"><FLbl>Question</FLbl><FArea value={q} onChange={setQ} rows={2} /></div>
      <div className="so-row"><FLbl>Market type</FLbl>
        <div className="so-seg">{(["Binary", "Dated", "Bucketed"] as const).map((k) => <button key={k} type="button" data-on={kind === k ? "" : undefined} onClick={() => setKind(k)}>{k}</button>)}</div>
        <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--fg-4)", lineHeight: 1.45 }}>
          {kind === "Binary" ? "A single YES / NO outcome." : kind === "Dated" ? "Date windows, generated from a resolution deadline — for “when will X happen” questions." : "Numeric value ranges you define — for “how big / how many” questions."}
        </p>
      </div>

      {kind === "Binary" && (
        <div className="so-row"><FLbl>Current odds · YES</FLbl>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input type="range" min={0} max={100} value={yes} onChange={(e) => setYes(+e.target.value)} style={{ flex: 1, accentColor: "var(--honey)" }} />
            <span style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 700, color: "var(--honey)", minWidth: 52, textAlign: "right" }}>{yes}¢</span>
          </div>
        </div>
      )}

      {kind === "Dated" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 10 }}>
            <div className="so-row"><FLbl>Resolve by</FLbl><input type="date" className="fb-field fb-mono" value={resolveBy} onChange={(e) => setResolveBy(e.target.value)} /></div>
            <div className="so-row"><FLbl>Window size</FLbl><FPills options={["Weekly", "Bi-weekly", "Monthly"]} value={gran} onChange={setGran} /></div>
          </div>
          <div className="so-row"><FLbl>Generated windows · {POLY_WINDOWS[gran].length}</FLbl>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {POLY_WINDOWS[gran].map((w) => <span key={w} className="sv-chip" style={{ fontSize: 11 }}>{w}</span>)}
            </div>
            <p style={{ margin: "8px 0 0", fontSize: 10.5, color: "var(--fg-4)" }}>Windows are built from today → resolve-by at the chosen step. Agents bet on a window; it resolves to whichever contains the real date.</p>
          </div>
        </>
      )}

      {kind === "Bucketed" && (
        <>
          <div className="so-row"><FLbl>Unit</FLbl><FPills options={["$", "%", "count", "pts"]} value={unit} onChange={setUnit} /></div>
          <div className="so-row"><FLbl>Value buckets</FLbl>
            <div style={{ display: "grid", gap: 6 }}>
              {buckets.map((b, i) => (
                <div key={i} className="so-chip-x">
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)", flex: "0 0 auto" }}>{unit === "$" ? "$" : ""}</span>
                    <input className="fb-field fb-mono" value={b} onChange={(e) => setBuckets((arr) => arr.map((x, j) => j === i ? e.target.value : x))} style={{ border: 0, background: "transparent", padding: "2px 0" }} />
                    <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)", flex: "0 0 auto" }}>{unit === "%" || unit === "pts" ? unit : ""}</span>
                  </div>
                  <button className="so-x" style={{ width: 24, height: 24 }} onClick={() => setBuckets((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove">−</button>
                </div>
              ))}
              <button type="button" onClick={() => setBuckets((arr) => [...arr, "new range"])} style={{ padding: "8px 10px", borderRadius: 7, border: "1px dashed var(--line-3)", background: "transparent", color: "var(--honey)", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>+ add bucket</button>
            </div>
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="so-row"><FLbl>Agents</FLbl><FInput value="48" mono /></div>
        <div className="so-row"><FLbl>News shocks</FLbl><FInput value="3" mono /></div>
      </div>
    </>
  );
}
function MMForm({ report }: FormProps) {
  const [shock, setShock] = React.useState("CPI hot");
  React.useEffect(() => { report(`Market-making theater on ZN1 (10Y T-Note futures), 12 MMs vs 8 takers, 1.5bp spread, ${shock} shock at 2.0σ.`); }, [shock, report]);
  return (
    <>
      <div className="so-row"><FLbl>Instrument</FLbl><FInput value="ZN1 (10Y T-Note futures)" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="so-row"><FLbl>MM count</FLbl><FInput value="12" mono /></div>
        <div className="so-row"><FLbl>TKR count</FLbl><FInput value="8" mono /></div>
        <div className="so-row"><FLbl>Spread (bp)</FLbl><FInput value="1.5" mono /></div>
        <div className="so-row"><FLbl>Shock (σ)</FLbl><FInput value="2.0" mono /></div>
      </div>
      <div className="so-row"><FLbl>Shock</FLbl><FPills options={["CPI hot", "Fed dovish", "Geopolitical", "Liquidity drain"]} value={shock} onChange={setShock} /></div>
    </>
  );
}
function RedditForm({ report }: FormProps) {
  const [seed, setSeed] = React.useState("just got 3000 shares of NVDA at $812, earnings tomorrow lfg 🚀");
  const [sub, setSub] = React.useState("r/wallstreetbets");
  React.useEffect(() => { report(`Reddit narrative cascade in ${sub}. Seed comment: ${seed}`); }, [seed, sub, report]);
  return (
    <>
      <div className="so-row"><FLbl>Subreddit</FLbl><FInput value={sub} onChange={setSub} /></div>
      <div className="so-row"><FLbl>Seed comment</FLbl><FArea value={seed} onChange={setSeed} rows={3} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="so-row"><FLbl>Cascade depth</FLbl><FInput value="4" mono /></div>
        <div className="so-row"><FLbl>Replies / level</FLbl><FInput value="6" mono /></div>
      </div>
    </>
  );
}
function ResearchForm({ report }: FormProps) {
  const [sources, setSources] = React.useState(["https://tavily.com/results/cpi-2026-05-21", "https://reuters.com/markets/fed-cpi-2026"]);
  const [brief, setBrief] = React.useState("briefs/2026-05-21-cpi.md");
  React.useEffect(() => { report(`Research swarm → consensus brief at ${brief}. Sources: ${sources.filter(Boolean).join(", ")}`); }, [sources, brief, report]);
  return (
    <>
      <div className="so-row"><FLbl>Sources</FLbl>
        <div style={{ display: "grid", gap: 6 }}>
          {sources.map((s, i) => (
            <div key={i} className="so-chip-x">
              <input className="fb-field fb-mono" value={s} onChange={(e) => setSources((arr) => arr.map((x, j) => j === i ? e.target.value : x))} style={{ border: 0, background: "transparent", padding: "2px 0", color: "var(--live)" }} />
              <button className="so-x" style={{ width: 24, height: 24 }} onClick={() => setSources((arr) => arr.filter((_, j) => j !== i))} aria-label="Remove">−</button>
            </div>
          ))}
          <button type="button" onClick={() => setSources((arr) => [...arr, "https://"])} style={{ padding: "8px 10px", borderRadius: 7, border: "1px dashed var(--line-3)", background: "transparent", color: "var(--live)", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer" }}>+ add source</button>
        </div>
      </div>
      <div className="so-row"><FLbl>Output brief</FLbl><FInput value={brief} onChange={setBrief} mono /></div>
    </>
  );
}
function OpsForm({ report }: FormProps) {
  const [f, setF] = React.useState("vault conflict storm");
  React.useEffect(() => { report(`Ops stress test: ${f}, intensity 2σ over 5 rounds.`); }, [f, report]);
  return (
    <>
      <div className="so-row"><FLbl>Failure profile</FLbl>
        <div style={{ display: "grid", gap: 6 }}>
          {["vault conflict storm", "tailnet partition", "stale env keys", "GH-Actions throttle"].map((x) => (
            <button key={x} type="button" onClick={() => setF(x)} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 9, alignItems: "center", padding: "9px 11px", borderRadius: 7, textAlign: "left", cursor: "pointer", border: "1px solid " + (f === x ? "color-mix(in srgb, var(--danger) 42%, transparent)" : "var(--line)"), background: f === x ? "var(--danger-soft)" : "transparent", color: f === x ? "var(--danger)" : "var(--fg-2)", fontFamily: "var(--f-mono)", fontSize: 12 }}>
              <span className="fr-dot" style={{ color: "var(--danger)" }} />{x}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="so-row"><FLbl>Intensity</FLbl><FInput value="2σ" mono /></div>
        <div className="so-row"><FLbl>Duration</FLbl><FInput value="5 rounds" mono /></div>
      </div>
    </>
  );
}
function CustomForm({ report }: FormProps) {
  const [s, setS] = React.useState("");
  React.useEffect(() => { report(s); }, [s, report]);
  return <div className="so-row"><FLbl>Scenario</FLbl><FArea value={s} onChange={setS} rows={8} placeholder="Describe an empty world. Anything goes." /></div>;
}

const FORMS: Record<TemplateId, React.FC<FormProps> | null> = {
  "polymarket": PolyForm, "market-maker": MMForm, "reddit-narrative": RedditForm,
  "research-swarm": ResearchForm, "ops": OpsForm, "x-thread": null, "custom": CustomForm,
};

function UrlSection() {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [building, setBuilding] = React.useState(false);
  const [built, setBuilt] = React.useState(false);
  const build = () => { setBuilding(true); setTimeout(() => { setBuilding(false); setBuilt(true); }, 900); };
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)", overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "11px 13px", background: "transparent", border: 0, color: "var(--fg)", cursor: "pointer" }}>
        <Icon name="sparkles" size={14} color="var(--honey)" />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Run from a URL</span>
        <span className="sv-mono" style={{ fontSize: 10, color: "var(--fg-4)" }}>let MiroShark fill this in</span>
        <span style={{ marginLeft: "auto", color: "var(--fg-4)", display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s" }}><Chevron dir="right" size={13} /></span>
      </button>
      {open && (
        <div style={{ padding: "0 13px 13px", display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}>Paste a press release, news article, or market link. MiroShark reads it, writes the seed briefing, and pre-fills the form below — no manual setup.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <FInput value={url} onChange={setUrl} mono placeholder="https://…" />
            <Button variant="primary" sm onClick={build} disabled={building}>{building ? "Reading…" : "Build"}</Button>
          </div>
          {built && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--live)" }}>
              <Icon name="check" size={13} sw={2.2} color="var(--live)" /> Scenario drafted from the URL — fields below are pre-filled. Review and launch.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Composer({ initialTemplate = "polymarket", onClose, onLaunch }: {
  initialTemplate?: TemplateId; onClose: () => void; onLaunch?: (payload: SimLaunchPayload) => void;
}) {
  const [tpl, setTpl] = React.useState<TemplateId>(initialTemplate);
  const meta = SW_TEMPLATES.find((t) => t.id === tpl);
  const Form = FORMS[tpl];
  const launchLabel = tpl === "x-thread" ? "Stage thread" : tpl === "ops" ? "Launch storm" : "Launch run";

  // Each form reports a human-readable scenario via its own effect on mount and
  // on edit. We don't reset on template change here — the newly mounted form's
  // effect runs after this component's, so resetting would clobber its report.
  const [scenario, setScenario] = React.useState(meta?.desc ?? "");
  const report = React.useCallback((s: string) => setScenario(s), []);

  const launch = () => {
    const text = scenario.trim() || meta?.desc || meta?.label || tpl;
    onLaunch?.({ template: tpl, scenario: text, rounds: DEFAULT_ROUNDS[tpl] ?? 1, platform: TEMPLATE_PLATFORM[tpl] ?? "parallel" });
  };

  return (
    <SlideOver open onClose={onClose} title="New simulation" sub="Pick a scenario template, configure it, and spin up a fresh swarm."
      footer={<>
        <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>◇ {meta?.agents} agents · ~$1 · ~10 min</span>
        <Button variant="primary" sm onClick={launch}><Icon name="plus" size={13} sw={2} /> {launchLabel}</Button>
      </>}>
      <UrlSection />
      <div className="so-row"><FLbl>Template</FLbl>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SW_TEMPLATES.map((t) => <button key={t.id} type="button" className="so-pill" data-on={tpl === t.id ? "" : undefined} onClick={() => setTpl(t.id)}>{t.label}</button>)}
        </div>
        {meta && <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>{meta.desc}</p>}
      </div>
      <div style={{ height: 1, background: "var(--line)" }} />
      {tpl === "x-thread" ? <XEditor report={report} /> : Form ? <Form report={report} /> : null}
    </SlideOver>
  );
}
