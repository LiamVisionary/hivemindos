"use client";

/* Composer.tsx — the launch composer. A template picker plus a per-template
   config form, in a slide-over. Each form reports a human-readable scenario
   string up to the composer; launch fires onLaunch({ template, scenario,
   rounds, platform }) so the panel can start a real MiroShark run. */

import React from "react";
import { Button, Toggle } from "./primitives";
import { Icon, Chevron } from "./icons";
import { SlideOver, FLbl, FInput, FArea, FPills, XEditor } from "./SlideOver";
import { SW_TEMPLATES, type TemplateId } from "./sim-data";
import { useSimData } from "./sim-context";
import type { SimLaunchMode, SimLaunchPayload } from "./sim-context";

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
  const [agents, setAgents] = React.useState("48");
  const [news, setNews] = React.useState("3");
  React.useEffect(() => {
    const detail = kind === "Binary" ? `binary market, opening YES ${yes}¢`
      : kind === "Dated" ? `dated market, ${gran.toLowerCase()} windows resolving by ${resolveBy}`
      : `bucketed market (${unit}) with ranges: ${buckets.join(", ")}`;
    report(`Prediction market: ${q} — ${detail}. Simulate with ${agents} agents and ${news} news shocks.`);
  }, [kind, q, yes, resolveBy, gran, unit, buckets, agents, news, report]);
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
        <div className="so-row"><FLbl>Agents</FLbl><FInput value={agents} onChange={setAgents} mono /></div>
        <div className="so-row"><FLbl>News shocks</FLbl><FInput value={news} onChange={setNews} mono /></div>
      </div>
    </>
  );
}
function MMForm({ report }: FormProps) {
  const [shock, setShock] = React.useState("CPI hot");
  const [instrument, setInstrument] = React.useState("ZN1 (10Y T-Note futures)");
  const [mm, setMm] = React.useState("12");
  const [tkr, setTkr] = React.useState("8");
  const [spread, setSpread] = React.useState("1.5");
  const [sigma, setSigma] = React.useState("2.0");
  React.useEffect(() => { report(`Market-making theater on ${instrument}, ${mm} MMs vs ${tkr} takers, ${spread}bp spread, ${shock} shock at ${sigma}σ.`); }, [instrument, mm, tkr, spread, sigma, shock, report]);
  return (
    <>
      <div className="so-row"><FLbl>Instrument</FLbl><FInput value={instrument} onChange={setInstrument} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="so-row"><FLbl>MM count</FLbl><FInput value={mm} onChange={setMm} mono /></div>
        <div className="so-row"><FLbl>TKR count</FLbl><FInput value={tkr} onChange={setTkr} mono /></div>
        <div className="so-row"><FLbl>Spread (bp)</FLbl><FInput value={spread} onChange={setSpread} mono /></div>
        <div className="so-row"><FLbl>Shock (σ)</FLbl><FInput value={sigma} onChange={setSigma} mono /></div>
      </div>
      <div className="so-row"><FLbl>Shock</FLbl><FPills options={["CPI hot", "Fed dovish", "Geopolitical", "Liquidity drain"]} value={shock} onChange={setShock} /></div>
    </>
  );
}
function RedditForm({ report }: FormProps) {
  const [seed, setSeed] = React.useState("just got 3000 shares of NVDA at $812, earnings tomorrow lfg 🚀");
  const [sub, setSub] = React.useState("r/wallstreetbets");
  const [depth, setDepth] = React.useState("4");
  const [replies, setReplies] = React.useState("6");
  React.useEffect(() => { report(`Reddit narrative cascade in ${sub}, ${depth} levels deep with ${replies} replies per level. Seed comment: ${seed}`); }, [seed, sub, depth, replies, report]);
  return (
    <>
      <div className="so-row"><FLbl>Subreddit</FLbl><FInput value={sub} onChange={setSub} /></div>
      <div className="so-row"><FLbl>Seed comment</FLbl><FArea value={seed} onChange={setSeed} rows={3} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="so-row"><FLbl>Cascade depth</FLbl><FInput value={depth} onChange={setDepth} mono /></div>
        <div className="so-row"><FLbl>Replies / level</FLbl><FInput value={replies} onChange={setReplies} mono /></div>
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
  const [intensity, setIntensity] = React.useState("2σ");
  const [duration, setDuration] = React.useState("5 rounds");
  React.useEffect(() => { report(`Ops stress test: ${f}, intensity ${intensity} over ${duration}.`); }, [f, intensity, duration, report]);
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
        <div className="so-row"><FLbl>Intensity</FLbl><FInput value={intensity} onChange={setIntensity} mono /></div>
        <div className="so-row"><FLbl>Duration</FLbl><FInput value={duration} onChange={setDuration} mono /></div>
      </div>
    </>
  );
}
function CustomForm({ report, initial }: FormProps & { initial?: string }) {
  const [s, setS] = React.useState(initial ?? "");
  React.useEffect(() => { report(s); }, [s, report]);
  return <div className="so-row"><FLbl>Scenario</FLbl><FArea value={s} onChange={setS} rows={8} placeholder="Describe an empty world. Anything goes." /></div>;
}

const FORMS: Record<TemplateId, React.FC<FormProps> | null> = {
  "polymarket": PolyForm, "market-maker": MMForm, "reddit-narrative": RedditForm,
  "research-swarm": ResearchForm, "ops": OpsForm, "x-thread": null, "custom": CustomForm,
};

// Add a source URL to the run. The link is appended to the scenario string that
// gets sent to MiroShark (no fake "reading" — MiroShark ingests it when it builds
// the run's graph), so this is a real, honest input.
function UrlSection({ onAdd }: { onAdd: (url: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [added, setAdded] = React.useState("");
  const add = () => { const u = url.trim(); if (!u) return; onAdd(u); setAdded(u); };
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)", overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "11px 13px", background: "transparent", border: 0, color: "var(--fg)", cursor: "pointer" }}>
        <Icon name="sparkles" size={14} color="var(--honey)" />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Add a source URL</span>
        <span className="sv-mono" style={{ fontSize: 10, color: added ? "var(--live)" : "var(--fg-4)" }}>{added ? "added" : "optional"}</span>
        <span style={{ marginLeft: "auto", color: "var(--fg-4)", display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s" }}><Chevron dir="right" size={13} /></span>
      </button>
      {open && (
        <div style={{ padding: "0 13px 13px", display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}>Paste a press release, news article, or market link. It is added to the scenario sent to MiroShark as a source to incorporate.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <FInput value={url} onChange={setUrl} mono placeholder="https://…" />
            <Button variant="primary" sm onClick={add} disabled={!url.trim()}>Add</Button>
          </div>
          {added && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--live)" }}>
              <Icon name="check" size={13} sw={2.2} color="var(--live)" /> Source added to the scenario: {added}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Composer({ initialTemplate = "polymarket", initialMode = "local", initialScenario, onClose, onLaunch }: {
  initialTemplate?: TemplateId; initialMode?: SimLaunchMode; initialScenario?: string;
  onClose: () => void; onLaunch?: (payload: SimLaunchPayload) => void;
}) {
  const data = useSimData();
  const launchModes = data.launchModes ?? { local: { ready: true }, x402: { ready: true } };
  const [tpl, setTpl] = React.useState<TemplateId>(initialTemplate);
  const [mode, setMode] = React.useState<SimLaunchMode>(initialMode);
  const [deepResearch, setDeepResearch] = React.useState(false);
  const [sourceUrl, setSourceUrl] = React.useState("");
  const meta = SW_TEMPLATES.find((t) => t.id === tpl);
  const Form = FORMS[tpl];
  const isPaid = mode === "x402";
  const modeStatus = launchModes[mode];
  const blocked = modeStatus.ready === false;
  const launchLabel = isPaid ? "Pay $1 & run"
    : tpl === "x-thread" ? "Stage thread" : tpl === "ops" ? "Launch storm" : "Launch run";

  // Each form reports a human-readable scenario via its own effect on mount and
  // on edit. We don't reset on template change here — the newly mounted form's
  // effect runs after this component's, so resetting would clobber its report.
  const [scenario, setScenario] = React.useState(initialScenario ?? meta?.desc ?? "");
  const report = React.useCallback((s: string) => setScenario(s), []);

  const launch = () => {
    if (blocked) return;
    const base = scenario.trim() || meta?.desc || meta?.label || tpl;
    const text = sourceUrl ? `${base}\n\nSource URL to incorporate: ${sourceUrl}` : base;
    onLaunch?.({
      template: tpl, scenario: text, rounds: DEFAULT_ROUNDS[tpl] ?? 1,
      platform: TEMPLATE_PLATFORM[tpl] ?? "parallel", mode, deepResearch: isPaid ? deepResearch : undefined,
    });
  };

  return (
    <SlideOver open onClose={onClose}
      title={isPaid ? "New paid simulation · x402" : "New simulation"}
      sub={isPaid
        ? "Compose a scenario, then pick a wallet and confirm the ~$1 charge. Runs on the hosted MiroShark — no local install needed."
        : "Pick a scenario template, configure it, and spin up a fresh swarm."}
      footer={<>
        <span className="sv-mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>
          {isPaid ? `◇ pays ~$1 USDC · pick a wallet & confirm next` : `◇ ${meta?.agents} agents · runs on your MiroShark · ~10 min`}
        </span>
        <Button variant="primary" sm onClick={launch} disabled={blocked} title={blocked ? modeStatus.reason : undefined}>
          <Icon name={isPaid ? "trade" : "plus"} size={13} sw={2} /> {launchLabel}
        </Button>
      </>}>
      {/* Run kind — the same Local vs paid x402 choice the split button offers. */}
      <div className="so-row"><FLbl>Run with</FLbl>
        <div className="so-seg">
          {([["local", "Local MiroShark"], ["x402", "Paid · $1"]] as const).map(([m, l]) => (
            <button key={m} type="button" data-on={mode === m ? "" : undefined} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
        {blocked && modeStatus.reason && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "9px 11px", borderRadius: "var(--radius-sm)", border: "1px solid color-mix(in srgb, var(--danger) 38%, transparent)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 11.5, lineHeight: 1.45 }}>
            <Icon name="warn" size={14} color="var(--danger)" /> <span style={{ flex: 1 }}>{modeStatus.reason}</span>
            {isPaid && modeStatus.needsWallet && data.onOpenWallets && (
              <Button variant="ghost" sm onClick={() => { data.onOpenWallets?.(); onClose(); }}>Open Wallets</Button>
            )}
          </div>
        )}
      </div>
      {isPaid && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", background: "var(--panel-2)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>Deep research</div>
            <div style={{ fontSize: 11, color: "var(--fg-4)", lineHeight: 1.45 }}>Let MiroShark read sources before simulating. Slower, richer report.</div>
          </div>
          <Toggle on={deepResearch} onChange={() => setDeepResearch((v) => !v)} />
        </div>
      )}
      <UrlSection onAdd={setSourceUrl} />
      <div className="so-row"><FLbl>Template</FLbl>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SW_TEMPLATES.map((t) => <button key={t.id} type="button" className="so-pill" data-on={tpl === t.id ? "" : undefined} onClick={() => setTpl(t.id)}>{t.label}</button>)}
        </div>
        {meta && <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>{meta.desc}</p>}
      </div>
      <div style={{ height: 1, background: "var(--line)" }} />
      {tpl === "x-thread" ? <XEditor report={report} />
        : tpl === "custom" ? <CustomForm report={report} initial={initialScenario} />
        : Form ? <Form report={report} /> : null}
    </SlideOver>
  );
}
