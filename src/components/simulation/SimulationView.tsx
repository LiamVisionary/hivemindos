"use client";

/* SimulationView.tsx — the Work → Simulation route, "Split console" layout.

   Header (Work title + live stats + segmented mode rail with Simulation active),
   then a collapsible left rail listing every run on the shelf (live pinned, then
   ready/done/failed) plus a launch section — and a detail pane that renders the
   selected run in its native surface (prediction market, X/Reddit thread,
   research brief, ops log, or the market-making theater). Collapsing the shelf
   hands the full width to the detail.

   Data comes from useSimData() — a <SimDataProvider> feeds real MiroShark runs;
   with no provider it falls back to the mock dataset so the drop-in still
   renders standalone. The CSS scopes everything under .sim-root. */

import React from "react";
import "./simulation.css";
import { Button, Summary } from "./primitives";
import { Chevron, Icon } from "./icons";
import { SimDetail } from "./detail";
import { SimRunRow, SimTemplatesRail } from "./rail";
import { Composer } from "./Composer";
import { Publish } from "./Publish";
import { useSimData, type SimLaunchMode, type SimLaunchModeStatus } from "./sim-context";
import { SimViewProvider } from "./sim-view-context";
import type { Run, TemplateId } from "./sim-data";
import { MIROSHARK_X402_SIMULATION_PRICE_LABEL } from "@/lib/config/miroshark-x402";

const MODES = [
  { id: "kanban", label: "Workboard" },
  { id: "scheduler", label: "Automations" },
  { id: "swarm", label: "Simulation" },
  { id: "history", label: "History" },
];

export interface SimulationViewProps {
  /** "dark" (default) or "light". */
  theme?: "dark" | "light";
  /** Initial selected run id. Defaults to the live run. */
  initialRunId?: string;
  /** Start with the shelf collapsed. */
  railCollapsed?: boolean;
  /** Fired when the user picks a run. Overrides the context handler. */
  onSelectRun?: (run: Run) => void;
  /** Fired by the "New simulation" button and template rows. If omitted, an in-component composer slide-over opens. */
  onNewSimulation?: (t: TemplateId) => void;
  /** Fired when an x-thread run is approved for publishing. If omitted, an in-component publish slide-over opens. */
  onPublish?: (run: Run) => void;
  /** Fired when a header mode tab (Workboard/Automations/Simulation/History) is clicked. */
  onSelectMode?: (mode: string) => void;
}

function EmptyDetail({ label }: { label: string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", textAlign: "center", padding: "48px 24px", minHeight: 320 }}>
      <div>
        <div className="sv-eyebrow" style={{ color: "var(--honey)" }}>Simulation</div>
        <h2 style={{ margin: "10px 0 6px", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 22 }}>{label}</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-3)", maxWidth: "44ch", lineHeight: 1.5 }}>
          Launch a new simulation or load a saved run to populate the console with live agents, posts, markets, and events.
        </p>
      </div>
    </div>
  );
}

function LoadingDetail({ label }: { label: string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", textAlign: "center", padding: "48px 24px", minHeight: 320 }}>
      <div>
        <div className="sv-eyebrow" style={{ color: "var(--honey)" }}>
          <span className="fr-dot live" style={{ color: "var(--live)", marginRight: 7 }} /> Working
        </div>
        <h2 style={{ margin: "10px 0 6px", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 20 }}>{label}</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-3)", maxWidth: "44ch", lineHeight: 1.5 }}>
          Preparing the run shelf and output surfaces for the latest simulation data.
        </p>
      </div>
    </div>
  );
}

// One row in the launch-mode menu: a status dot + label + a sub-line that shows
// the description when ready, or the blocking reason when not.
function LaunchModeRow({ status, label, sub, onClick }: { status: SimLaunchModeStatus; label: string; sub: string; onClick: () => void }) {
  const dot = status.ready ? "var(--live)" : status.needsWallet ? "var(--honey)" : "var(--danger)";
  const clickable = status.ready || Boolean(status.needsWallet);
  return (
    <button type="button" onClick={onClick} disabled={!clickable}
      style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", border: 0, background: "transparent",
        color: "var(--fg)", cursor: clickable ? "pointer" : "default", borderRadius: "var(--radius-sm)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="fr-dot" style={{ color: dot, width: 7, height: 7 }} />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
        {status.note && <span className="sv-mono" style={{ marginLeft: "auto", fontSize: 10, color: "var(--fg-4)" }}>{status.note}</span>}
      </span>
      <span style={{ display: "block", marginLeft: 15, marginTop: 3, fontSize: 11, color: status.ready ? "var(--fg-3)" : dot, lineHeight: 1.45 }}>
        {status.ready ? sub : (status.reason || sub)}
      </span>
    </button>
  );
}

// The launch control: a split button whose primary action starts a local
// MiroShark run and whose caret menu lets the user pick the run kind — local
// (your own/fleet MiroShark) or a paid x402 run on the hosted MiroShark. Each
// mode shows its readiness; a not-ready mode explains why, and the paid mode
// with no usable wallet offers to open the Wallets tab.
function LaunchSplitButton({ modes, onPick, onOpenWallets }: {
  modes: { local: SimLaunchModeStatus; x402: SimLaunchModeStatus };
  onPick: (mode: SimLaunchMode) => void;
  onOpenWallets?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<"menu" | "wallet">("menu");
  const close = () => { setOpen(false); setView("menu"); };

  const primary = () => {
    if (modes.local.ready) { onPick("local"); close(); }
    else { setView("menu"); setOpen(true); }
  };
  const pickMode = (mode: SimLaunchMode) => {
    const status = modes[mode];
    if (status.ready) { onPick(mode); close(); return; }
    if (mode === "x402" && status.needsWallet) { setView("wallet"); return; }
    // local not-ready (or x402 not-ready for another reason): leave the menu open
    // so the inline reason stays visible.
  };

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className="fb-btn primary sm" onClick={primary}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="plus" size={14} sw={2} /> New simulation
      </button>
      <button type="button" className="fb-btn primary sm" aria-label="Choose run kind" aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setView("menu"); setOpen((o) => !o); }}
        style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, marginLeft: 1, padding: "0 8px", display: "inline-flex", alignItems: "center" }}>
        <Chevron dir="down" size={13} />
      </button>
      {open && (
        <>
          <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div role="menu" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, width: 300,
            background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: "var(--radius)", boxShadow: "0 16px 40px rgba(0,0,0,0.35)", padding: 6 }}>
            {view === "menu" ? (
              <>
                <LaunchModeRow status={modes.local} label="Local MiroShark" sub="Runs on your own or a connected fleet MiroShark. Free." onClick={() => pickMode("local")} />
                <div style={{ height: 1, background: "var(--line)", margin: "4px 8px" }} />
                <LaunchModeRow status={modes.x402} label="Paid run · x402" sub={`Runs on the hosted MiroShark. Pays ~${MIROSHARK_X402_SIMULATION_PRICE_LABEL} from a wallet.`} onClick={() => pickMode("x402")} />
              </>
            ) : (
              <div style={{ padding: "12px 12px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Icon name="alert" size={15} color="var(--honey)" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>No wallet for paid runs</span>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5 }}>
                  A paid x402 run charges ~{MIROSHARK_X402_SIMULATION_PRICE_LABEL}, so it needs a wallet. Open the Wallets tab to create or import one first?
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <Button variant="ghost" sm onClick={() => setView("menu")}>Not now</Button>
                  <Button variant="primary" sm onClick={() => { onOpenWallets?.(); close(); }}>Open Wallets</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SimulationView({ theme = "dark", initialRunId, railCollapsed = false, onSelectRun, onNewSimulation, onPublish, onSelectMode }: SimulationViewProps) {
  const data = useSimData();
  const { runs, live, others, active, stats, getRun } = data;

  // The user's pick is stored, but the *effective* selection is derived during
  // render so it stays valid as the live run list changes (picked run resolved →
  // fall back to the live/first run). No selection-syncing effect needed.
  const [picked, setPicked] = React.useState<string | null>(initialRunId ?? null);
  const [open, setOpen] = React.useState(!railCollapsed);
  const [composer, setComposer] = React.useState<{ tpl: TemplateId; mode: SimLaunchMode; scenario?: string } | null>(null);
  const [publish, setPublish] = React.useState<Run | null>(null);
  const launchModes = data.launchModes ?? { local: { ready: true }, x402: { ready: true } };

  // Re-run / Retry / Launch from a run card → open the composer pre-seeded with
  // the run's scenario, so the user gets the SAME launch options (Local vs paid
  // x402) as a fresh run rather than a silent relaunch.
  const rerun = React.useCallback((run: Run) => {
    setComposer({ tpl: "custom", mode: "local", scenario: (run.summary || run.title || "").trim() });
  }, []);
  const simViewActions = React.useMemo(() => ({ rerun }), [rerun]);

  const sel = picked && runs.some((r) => r.id === picked) ? picked : (active?.id || runs[0]?.id || "");
  const selected = sel ? getRun(sel) : null;

  const pick = (id: string) => {
    setPicked(id);
    const run = getRun(id);
    if (!run) return;
    if (onSelectRun) onSelectRun(run);
    else data.onSelectRun?.(run);
  };
  const openComposer = (t: TemplateId, mode: SimLaunchMode = "local") => { if (onNewSimulation) onNewSimulation(t); else setComposer({ tpl: t, mode }); };
  // The in-component publish slide-over opens for review; its confirm fires the
  // live publish handler (data.onPublish). The onPublish prop fully overrides it.
  const openPublish = (run: Run) => { if (onPublish) onPublish(run); else setPublish(run); };

  return (
    <SimViewProvider value={simViewActions}>
    <div className="sim-root" data-sim-theme={theme === "light" ? "light" : undefined} style={{ minHeight: "100%", fontFamily: "var(--f-body)", color: "var(--fg)" }}>
      <header style={{ padding: "20px 28px 14px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 11, minWidth: 0 }}>
            <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" }}>Work</span>
            <span style={{ fontSize: 12.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>multi-agent simulations</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {stats.map((s) => <Summary key={s.label} n={s.value} label={s.label} live={s.live} tone={s.tone} />)}
          </div>
        </div>
        <div className="fb-seg" style={{ marginTop: 16 }} role="tablist" aria-label="Work view mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={m.id === "swarm"} data-active={m.id === "swarm" ? "" : undefined}
              onClick={() => onSelectMode?.(m.id)} style={onSelectMode && m.id !== "swarm" ? { cursor: "pointer" } : undefined}>{m.label}</button>
          ))}
        </div>
      </header>

      <div style={{ padding: "22px 28px 30px" }}>
        {/* section head */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", margin: "2px 0 16px" }}>
          <div>
            <span className="fr-eyebrow" style={{ fontSize: 10.5, letterSpacing: "0.14em" }}>Simulation</span>
            <h2 style={{ margin: "6px 0 0", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>Swarm console</h2>
            <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--fg-3)", maxWidth: "60ch", lineHeight: 1.5 }}>Every run on the shelf in one place — pick one to watch it live or read its result.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <LaunchSplitButton modes={launchModes} onOpenWallets={data.onOpenWallets}
              onPick={(mode) => openComposer("polymarket", mode)} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: open ? "300px 1fr" : "1fr", gap: 18, alignItems: "start" }}>
          {open && (
            <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "2px 2px" }}>
                <span className="sv-eyebrow">Live · {live.length}</span>
                <button type="button" onClick={() => setOpen(false)} title="Hide shelf" aria-label="Hide shelf"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 99, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", fontFamily: "var(--f-body)", fontSize: 11, cursor: "pointer" }}>
                  <Chevron dir="left" size={12} /> Hide
                </button>
              </div>
              {live.map((r) => <SimRunRow key={r.id} run={r} selected={sel === r.id} onClick={() => pick(r.id)} />)}
              <div className="sv-eyebrow" style={{ margin: "12px 2px 2px" }}>The shelf · {others.length}</div>
              {others.map((r) => <SimRunRow key={r.id} run={r} selected={sel === r.id} onClick={() => pick(r.id)} />)}
              <div className="sv-eyebrow" style={{ margin: "16px 2px 2px" }}>Launch</div>
              <SimTemplatesRail compact onPick={openComposer} />
            </div>
          )}
          <div key={sel} className="fb-fade" style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", padding: "20px 22px", minWidth: 0 }}>
            {!open && (
              <button type="button" onClick={() => setOpen(true)} title="Show shelf"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 14, padding: "6px 11px", borderRadius: 99, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-2)", fontFamily: "var(--f-body)", fontSize: 12, cursor: "pointer" }}>
                <Chevron dir="right" size={13} /> Shelf
              </button>
            )}
            {data.loading
              ? <LoadingDetail label={data.loadingLabel || "Loading simulation"} />
              : selected
                ? <SimDetail run={selected} onPublish={openPublish} />
                : <EmptyDetail label={data.emptyLabel || "No swarm runs loaded"} />}
          </div>
        </div>
      </div>

      {composer && <Composer initialTemplate={composer.tpl} initialMode={composer.mode} initialScenario={composer.scenario} onClose={() => setComposer(null)} onLaunch={(payload) => { data.onLaunch?.(payload); setComposer(null); }} />}
      {publish && <Publish run={publish} onClose={() => setPublish(null)} onPublished={() => data.onPublish?.(publish)} />}
    </div>
    </SimViewProvider>
  );
}
