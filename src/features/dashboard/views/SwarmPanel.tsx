"use client";

/* SwarmPanel — the Work → Simulation route.

   Renders the redesigned Simulation UI (@/components/simulation) fed with REAL
   MiroShark data: swarmRuns/currentRun/market/agents/decisions are adapted into
   the UI's SimDataset, and the operational seams (select / launch / publish) are
   wired to the live MiroShark controller handlers. No demo data.

   The "New simulation" control is a split button with two launch modes:
     • Local MiroShark — the existing /api/miroshark/swarm path (your own or a
       connected fleet MiroShark). Gated on mirosharkStatus.ok.
     • Paid run · x402 — the hosted MiroShark at x402.miroshark.xyz (~$1 USDC).
       The user picks a funding wallet (their own or an agent's) and confirms the
       charge here in SwarmPanel; the drop-in just emits the mode. */

import React from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SwarmAgent, SwarmDecision, SwarmMarket, SwarmRun } from "@/components/swarm/swarm-data";
import {
  SimDataProvider, SimulationView, buildSimDataset,
  type Run, type SimDataset, type SimLaunchPayload, type SimLaunchModeStatus,
} from "@/components/simulation";
import type { DashboardView, MiroSharkRunResult, MiroSharkStatus } from "@/features/dashboard/dashboard-types";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { fetchPersonalWalletBalance, fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import { WalletSelectModal, type PickableWallet } from "@/features/dashboard/views/trade/WalletSelectModal";
import {
  agentPickable, personalPickable, isX402CapableWallet, x402WalletBlockReason, type PickableAgent,
} from "@/features/dashboard/views/trade/wallet-pickables";
import tradeStyles from "@/features/dashboard/views/trade/trade.module.css";
import { MiroSharkProcessCard, MiroSharkSimulationCard } from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import type { MiroSharkProcessSummary, MiroSharkSimulationCardData } from "@/features/dashboard/views/chat/miroshark-card-parser";

type MiroSharkPlatform = MiroSharkRunResult["platform"];

// MiroShark-scoped "last used wallet" — persisted separately from other
// features so a user can keep one wallet for paid sims and others elsewhere.
const LAST_WALLET_KEY = "hivemindos.miroshark.lastWalletId.v1";
function readLastWalletId(): string {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(LAST_WALLET_KEY) || ""; } catch { return ""; }
}
function writeLastWalletId(id: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LAST_WALLET_KEY, id); } catch { /* quota — best effort */ }
}

type SwarmPanelProps = {
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  // live data
  swarmRuns: SwarmRun[];
  currentSwarmRun: SwarmRun | null;
  swarmMarket: SwarmMarket;
  swarmAgents: SwarmAgent[];
  swarmDecisions: SwarmDecision[];
  swarmStatusLabel: string;
  selectedSwarmRunId: string;
  // status / loading
  mirosharkRunPending: boolean;
  mirosharkProgressLabel: string;
  mirosharkArchiveStatus: string;
  mirosharkStatus: MiroSharkStatus | null;
  // composer draft state (read back to know when a deferred launch is ready)
  mirosharkScenario: string;
  // wallet wiring (for the paid x402 launch mode)
  walletsByAgent?: Record<string, unknown>;
  displayAgents?: PickableAgent[];
  selectedAgent?: { id?: string } | null;
  setSelectedAgentId?: (id: string) => void;
  getSurvivalSnapshot?: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  sharedVault?: SharedVaultConfig;
  // handlers
  loadMirosharkArchivedRun: (runId: string) => void | Promise<void>;
  startNewMirosharkSimulation: (templateId?: string) => void;
  launchMirosharkSwarm: () => void | Promise<void>;
  setMirosharkScenario: Dispatch<SetStateAction<string>>;
  setMirosharkRounds: Dispatch<SetStateAction<number>>;
  setMirosharkPlatform: Dispatch<SetStateAction<MiroSharkPlatform>>;
  runMirosharkExperiment: (action: "stop" | "inject" | "fork" | "branch" | "publish", runId: string) => void | Promise<void>;
};

function coercePlatform(value: string): MiroSharkPlatform {
  return value === "twitter" || value === "reddit" || value === "parallel" || value === "polymarket"
    ? value
    : "parallel";
}

// Export a run by downloading its full payload as JSON (works offline / in the
// desktop webview — no backend needed). Uses the original SwarmRun when available
// so the export carries the real posts/market/timeline data, not the derived view.
function downloadRunJson(id: string, data: unknown) {
  if (typeof document === "undefined") return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `miroshark-${id || "run"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Map a composed scenario to exactly one MiroShark x402 seed (the buyer rejects
// zero or multiple seeds). A bare URL becomes a `url` seed; a polymarket event
// link additionally seeds a prediction_market question; everything else is a
// free-text `prompt`.
function scenarioToSeed(scenario: string): { prompt?: string; url?: string; prediction_market?: string } {
  const text = scenario.trim();
  if (/^https?:\/\/\S+$/i.test(text)) {
    const seed: { url: string; prediction_market?: string } = { url: text };
    const match = text.match(/polymarket\.com\/(?:event|market)\/([a-z0-9-]+)/i);
    if (match) {
      const title = match[1].replace(/-/g, " ").trim();
      if (title.length >= 4) seed.prediction_market = `Will this resolve YES: ${title}`.slice(0, 300);
    }
    return seed;
  }
  return { prompt: text };
}

function extractRunId(payload: unknown): string | undefined {
  try { return JSON.stringify(payload).match(/run_[A-Za-z0-9_-]{4,}/)?.[0]; } catch { return undefined; }
}

function shortAddress(address?: string): string {
  const a = (address || "").trim();
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

type X402RunPhase = "confirm" | "running" | "error";

// ── live x402 run tracking (after pay → progress → report) ──────────────────
const X402_TERMINAL = /\b(?:complete|completed|success|succeeded|ready|failed|failure|error|cancelled|canceled|stopped)\b/i;

// Pull a string field from an opaque MiroShark payload (top level or under .data).
function readField(payload: unknown, keys: string[]): string {
  const pick = (o: unknown): string => {
    if (!o || typeof o !== "object") return "";
    const rec = o as Record<string, unknown>;
    for (const k of keys) { const v = rec[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
    return "";
  };
  if (!payload || typeof payload !== "object") return "";
  return pick(payload) || pick((payload as Record<string, unknown>).data);
}
const statusLabelFrom = (m: unknown) => readField(m, ["status", "state", "runner_status", "runnerStatus", "phase", "message"]);
const reportMarkdownFrom = (m: unknown) => readField(m, ["report_markdown", "reportMarkdown", "markdown", "report_md", "report"]);
function readUrl(payload: unknown, keys: string[]): string | undefined {
  const v = readField(payload, keys);
  return /^https?:\/\//i.test(v) ? v : undefined;
}

type X402Job = {
  runId: string;
  title: string;
  network?: string;
  amountUsd?: number;
  paymentLabel?: string;
  reportUrl?: string;
  statusUrl?: string;
  waitUrl?: string;
};

// Docked card shown after a paid run starts: polls the hosted run's status and
// renders the live progress stepper, then the report — the same cards chat uses.
function X402JobCard({ job, onClose }: { job: X402Job; onClose: () => void }) {
  const [status, setStatus] = React.useState("running");
  const [reportMarkdown, setReportMarkdown] = React.useState("");
  const [timedOut, setTimedOut] = React.useState(false);
  const terminal = X402_TERMINAL.test(status);

  React.useEffect(() => {
    if (!job.runId) return;
    let stop = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 90; // ~7.5 min at 5s — then stop and point to chat.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const res = await fetch("/api/miroshark/x402", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", runId: job.runId }),
      }).catch(() => null);
      const data = await res?.json().catch(() => null) as { miroshark?: unknown } | null;
      if (stop) return;
      const label = statusLabelFrom(data?.miroshark) || "running";
      setStatus(label);
      if (X402_TERMINAL.test(label)) {
        const rr = await fetch("/api/miroshark/x402", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "report", runId: job.runId, format: "md" }),
        }).catch(() => null);
        const rd = await rr?.json().catch(() => null) as { miroshark?: unknown } | null;
        if (!stop) setReportMarkdown(reportMarkdownFrom(rd?.miroshark));
        return; // terminal — stop polling
      }
      attempts += 1;
      if (attempts >= MAX_ATTEMPTS) { setTimedOut(true); return; } // give up gracefully
      timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 3000);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [job.runId]);

  const card: MiroSharkSimulationCardData = {
    runId: job.runId, status, paid: true, paymentLabel: job.paymentLabel, amountUsd: job.amountUsd,
    network: job.network, reportMarkdown, title: job.title, seed: job.title,
    reportUrl: job.reportUrl, statusUrl: job.statusUrl, waitUrl: job.waitUrl,
  };
  const summary: MiroSharkProcessSummary = {
    currentStage: reportMarkdown ? 3 : 2,
    latest: !job.runId ? "Run started — the report opens in the MiroShark card in chat."
      : timedOut ? "Still running — check the MiroShark card in chat for the report."
      : reportMarkdown ? "Report ready."
      : `Running on the hosted MiroShark…${status && status !== "running" ? ` (${status})` : ""}`,
    runId: job.runId, status, subject: job.title,
  };
  const showReport = terminal || Boolean(reportMarkdown) || timedOut || !job.runId;

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, width: 440, maxWidth: "calc(100vw - 36px)", maxHeight: "calc(100vh - 36px)", overflowY: "auto", zIndex: 60, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} aria-label="Dismiss"
          style={{ width: 26, height: 26, borderRadius: 99, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(20,22,28,0.92)", color: "#fff", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
      </div>
      {showReport ? <MiroSharkSimulationCard card={card} /> : <MiroSharkProcessCard summary={summary} />}
    </div>
  );
}

export function SwarmPanel({
  setActiveView,
  swarmRuns,
  currentSwarmRun,
  swarmMarket,
  swarmAgents,
  swarmDecisions,
  swarmStatusLabel,
  selectedSwarmRunId,
  mirosharkRunPending,
  mirosharkProgressLabel,
  mirosharkArchiveStatus,
  mirosharkStatus,
  mirosharkScenario,
  walletsByAgent,
  displayAgents,
  selectedAgent,
  setSelectedAgentId,
  getSurvivalSnapshot,
  sharedVault,
  loadMirosharkArchivedRun,
  startNewMirosharkSimulation,
  launchMirosharkSwarm,
  setMirosharkScenario,
  setMirosharkRounds,
  setMirosharkPlatform,
  runMirosharkExperiment,
}: SwarmPanelProps) {
  // ── local-mode deferred launch (unchanged) ────────────────────────────────
  // launchMirosharkSwarm() reads the controller's scenario from its closure, so
  // we stage the composer state, then fire the launch on the next render once
  // mirosharkScenario reflects the requested scenario. A ref avoids setState-in-effect.
  const pendingLaunchRef = React.useRef<SimLaunchPayload | null>(null);
  React.useEffect(() => {
    const pending = pendingLaunchRef.current;
    if (pending && mirosharkScenario === pending.scenario) {
      pendingLaunchRef.current = null;
      void launchMirosharkSwarm();
    }
  }, [mirosharkScenario, launchMirosharkSwarm]);

  // Stage a local MiroShark launch: set the controller's scenario/rounds/platform,
  // then fire launchMirosharkSwarm() once mirosharkScenario settles (deferred ref).
  // Shared by the composer's local launch and the run-card Re-run/Retry/Launch.
  const stageLocalLaunch = React.useCallback((payload: SimLaunchPayload) => {
    startNewMirosharkSimulation(payload.template);
    setMirosharkPlatform(coercePlatform(payload.platform));
    setMirosharkRounds(payload.rounds);
    setMirosharkScenario(payload.scenario); // set last so it wins the batch
    pendingLaunchRef.current = payload;
  }, [startNewMirosharkSimulation, setMirosharkPlatform, setMirosharkRounds, setMirosharkScenario]);

  // ── personal (user) wallets, loaded the way the Trade picker does ──────────
  const vaultPath = sharedVault?.enabled ? String(sharedVault.vaultPath || "").trim() : "";
  const [personalWallets, setPersonalWallets] = React.useState<Array<Record<string, unknown>>>([]);
  const [personalLoading, setPersonalLoading] = React.useState(true);
  React.useEffect(() => {
    let ignore = false;
    void (async () => {
      setPersonalLoading(true);
      const list = await fetchPersonalWalletRecords(vaultPath);
      if (ignore) return;
      setPersonalWallets(list);
      const refreshed = await Promise.all(list.map(async (record) => {
        const address = String(record.address || "").trim();
        const network = String(record.network || "").trim();
        if (!address || !network) return record;
        const balance = await fetchPersonalWalletBalance(address, network);
        return balance ? { ...record, currentBalanceUsd: balance.currentBalanceUsd, nativeBalance: balance.nativeBalance, tokens: balance.tokens, lastOnchainSyncAt: balance.lastOnchainSyncAt } : record;
      }));
      if (ignore) return;
      setPersonalWallets(refreshed);
      setPersonalLoading(false);
    })();
    return () => { ignore = true; };
  }, [vaultPath]);

  // Wallets that can actually FUND an x402 run (local signing key + supported
  // network). Watch-only / runtime-custody wallets are excluded — they'd 404.
  const x402Pickables = React.useMemo<PickableWallet[]>(() => {
    const user = personalWallets
      .map(personalPickable)
      .filter((p): p is PickableWallet => Boolean(p))
      .filter((p) => isX402CapableWallet(p.wallet));
    const agentP = (displayAgents ?? [])
      .map((a) => agentPickable(a, walletsByAgent))
      .filter((p) => isX402CapableWallet(p.wallet));
    return [...user, ...agentP];
  }, [personalWallets, displayAgents, walletsByAgent]);

  // ── per-mode readiness for the split launch button ─────────────────────────
  const localStatus = React.useMemo<SimLaunchModeStatus>(() => {
    if (mirosharkStatus?.ok) return { ready: true, note: "connected" };
    const phase = mirosharkStatus?.phase;
    const reason = phase === "starting" ? "MiroShark is starting — try again in a moment."
      : phase === "installed-stopped" ? "MiroShark is installed but not running. Start it (Maintenance tab) to run locally."
      : phase === "needs-config" ? (mirosharkStatus?.error || "MiroShark is connected but its API isn't ready yet.")
      : (mirosharkStatus?.error || "No local or fleet MiroShark is connected. Install or start MiroShark to run locally.");
    return { ready: false, reason };
  }, [mirosharkStatus?.ok, mirosharkStatus?.phase, mirosharkStatus?.error]);

  const x402Status = React.useMemo<SimLaunchModeStatus>(() => {
    if (x402Pickables.length > 0) return { ready: true, note: "~$1 USDC" };
    if (personalLoading) return { ready: true, note: "~$1 USDC" }; // optimistic until wallets load
    const reason = personalWallets.length > 0
      ? "Your wallets can't fund paid runs yet (watch-only or unsupported network). Open the Wallets tab to add a local Base/Solana key."
      : "No wallet set up for paid runs. Open the Wallets tab to create or import one.";
    return { ready: false, needsWallet: true, reason };
  }, [x402Pickables.length, personalLoading, personalWallets.length]);

  // ── paid (x402) launch flow state ──────────────────────────────────────────
  const [pendingX402, setPendingX402] = React.useState<SimLaunchPayload | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [confirmWalletId, setConfirmWalletId] = React.useState<string | null>(null);
  // WalletSelectModal fires onConfirm then onClose in the same click, so onClose
  // can't read the just-set confirmWalletId. This ref tells the two apart: a true
  // value means "a wallet was picked" (keep the flow), false means "cancelled".
  const justPickedRef = React.useRef(false);
  const [runPhase, setRunPhase] = React.useState<X402RunPhase>("confirm");
  const [runError, setRunError] = React.useState<string | null>(null);
  // After a successful pay, the confirm modal closes and this drives the docked
  // live progress → report card.
  const [x402Job, setX402Job] = React.useState<X402Job | null>(null);

  const chosen = confirmWalletId ? x402Pickables.find((p) => p.id === confirmWalletId) ?? null : null;

  const defaultWalletId = React.useMemo(() => {
    const last = readLastWalletId();
    if (last && x402Pickables.some((p) => p.id === last)) return last;
    if (selectedAgent?.id && x402Pickables.some((p) => p.id === selectedAgent.id)) return selectedAgent.id;
    return x402Pickables[0]?.id ?? "";
  }, [x402Pickables, selectedAgent?.id]);

  const closeX402 = () => {
    setPendingX402(null);
    setPickerOpen(false);
    setConfirmWalletId(null);
    setRunPhase("confirm");
    setRunError(null);
  };

  const onWalletConfirm = (id: string) => {
    justPickedRef.current = true;
    writeLastWalletId(id);
    // Only sync the global selected agent for real agents, not personal wallets.
    if (!id.startsWith("user:")) setSelectedAgentId?.(id);
    setConfirmWalletId(id);
    setRunPhase("confirm");
    setRunError(null);
  };

  const payX402 = async () => {
    if (!chosen || !pendingX402) return;
    if (x402WalletBlockReason(chosen.wallet)) return; // Pay is disabled in this case
    setRunPhase("running");
    setRunError(null);
    const seed = scenarioToSeed(pendingX402.scenario);
    try {
      const response = await fetch("/api/miroshark/x402", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run",
          agentId: chosen.id,
          ...seed,
          deep_research: pendingX402.deepResearch || undefined,
          // Build the policy explicitly: this run IS an x402 payment, and the
          // user has picked this wallet + confirmed the ~$1 charge, so we force
          // the x402 rail and pass the per-run confirmation token. We never
          // override a disabled wallet here — Pay is gated on the wallet being
          // spend-enabled (x402WalletBlockReason).
          policy: {
            enabled: true,
            provider: "x402",
            maxPaymentUsd: Math.max(1, Number(chosen.wallet.maxPaymentUsd) || 0),
            approvalRequiredOverUsd: 0,
            autoPayEnabled: true,
          },
          confirmation: "PAY_X402",
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; result?: { amountUsd?: number; network?: string }; miroshark?: unknown } | null;
      if (!response.ok || !data?.ok) {
        setRunPhase("error");
        setRunError(data?.error || `Paid run failed (HTTP ${response.status}).`);
        return;
      }
      // Paid OK → close the confirm modal and hand off to the docked live card,
      // which polls status and renders the report when it lands.
      const amountUsd = Number(data.result?.amountUsd);
      const network = readField(data.miroshark, ["network"]) || (typeof data.result?.network === "string" ? data.result.network : undefined);
      setX402Job({
        runId: extractRunId(data.miroshark) || "",
        title: (pendingX402.scenario || "Paid simulation").slice(0, 140),
        network: network || undefined,
        amountUsd: Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : undefined,
        paymentLabel: Number.isFinite(amountUsd) && amountUsd > 0 ? `$${amountUsd.toFixed(2)} USDC` : "$1.00 USDC",
        reportUrl: readUrl(data.miroshark, ["report_url", "reportUrl"]),
        statusUrl: readUrl(data.miroshark, ["status_url", "statusUrl"]),
        waitUrl: readUrl(data.miroshark, ["wait_url", "waitUrl"]),
      });
      closeX402();
    } catch {
      // A slow deep_research run can exceed the request timeout while still
      // processing server-side — say so rather than implying it failed.
      setRunPhase("error");
      setRunError("The paid run didn't return in time. It may still be processing on MiroShark — check the MiroShark card in chat for the report.");
    }
  };

  const base = React.useMemo<Omit<SimDataset, "loading" | "loadingLabel" | "emptyLabel" | "onLaunch" | "onPublish" | "onSelectRun">>(
    () => buildSimDataset({
      runs: swarmRuns,
      currentRun: currentSwarmRun,
      market: swarmMarket,
      agents: swarmAgents,
      decisions: swarmDecisions,
      statusLabel: swarmStatusLabel,
    }),
    [swarmRuns, currentSwarmRun, swarmMarket, swarmAgents, swarmDecisions, swarmStatusLabel],
  );

  const loading = mirosharkRunPending || mirosharkArchiveStatus === "Loading saved run...";

  const dataset: SimDataset = {
    ...base,
    loading,
    loadingLabel: mirosharkArchiveStatus === "Loading saved run..." ? "Loading saved run" : (mirosharkProgressLabel || "MiroShark running"),
    emptyLabel: swarmStatusLabel ? `No swarm runs loaded · ${swarmStatusLabel}` : "No swarm runs loaded",
    launchModes: { local: localStatus, x402: x402Status },
    onOpenWallets: () => setActiveView("wallet"),
    onSelectRun: (run: Run) => {
      if (run.id !== currentSwarmRun?.id) void loadMirosharkArchivedRun(run.id);
    },
    onLaunch: (payload: SimLaunchPayload) => {
      if (payload.mode === "x402") {
        // Compose → pick a wallet → confirm the $1 charge → POST /api/miroshark/x402.
        setRunPhase("confirm");
        setRunError(null);
        setConfirmWalletId(null);
        setPendingX402(payload);
        setPickerOpen(true);
        return;
      }
      // Local MiroShark — the existing deferred launch.
      stageLocalLaunch(payload);
    },
    onPublish: (run: Run) => { void runMirosharkExperiment("publish", run.id); },
    onExport: (run: Run) => {
      const source = swarmRuns.find((r) => r.id === run.id)
        ?? (currentSwarmRun && currentSwarmRun.id === run.id ? currentSwarmRun : null)
        ?? run;
      downloadRunJson(run.id, source);
    },
    onStop: (run: Run) => { void runMirosharkExperiment("stop", run.id); },
  };

  const blockReason = chosen ? x402WalletBlockReason(chosen.wallet) : "";

  return (
    <div style={{ height: "100%", overflow: "auto" }} aria-busy={loading || undefined}>
      <SimDataProvider value={dataset}>
        <SimulationView
          initialRunId={selectedSwarmRunId || currentSwarmRun?.id || undefined}
          onSelectMode={(mode) => setActiveView(mode as DashboardView)}
        />
      </SimDataProvider>

      {/* Paid run · x402 — wallet picker (reuses the Trade wallet picker) */}
      {pickerOpen && pendingX402 && (
        <WalletSelectModal
          pickables={x402Pickables}
          getSurvivalSnapshot={getSurvivalSnapshot ?? (() => ({}) as AgentSurvivalSnapshot)}
          currentId={defaultWalletId}
          title="Select a wallet for this paid run"
          subtitle="Pick which wallet pays the ~$1 USDC. Your own wallets come first, then configured agent wallets."
          confirmLabel="Use this wallet"
          onConfirm={onWalletConfirm}
          onClose={() => {
            setPickerOpen(false);
            // Cancelled (X/backdrop) — drop the pending run. A pick keeps it for the confirm step.
            if (justPickedRef.current) justPickedRef.current = false;
            else if (!confirmWalletId) setPendingX402(null);
          }}
        />
      )}

      {/* Paid run · x402 — confirm the charge, then run */}
      {pendingX402 && confirmWalletId && chosen && (
        <div className={tradeStyles.modalOverlay} role="presentation" onMouseDown={() => { if (runPhase !== "running") closeX402(); }}>
          <div className={tradeStyles.modal} role="dialog" aria-modal="true" aria-label="Confirm paid run" onMouseDown={(e) => e.stopPropagation()}>
            <div className={tradeStyles.modalHead}>
              <div>
                <h3 className={tradeStyles.title} style={{ fontSize: 15 }}>
                  {runPhase === "error" ? "Paid run" : "Confirm paid run · x402"}
                </h3>
                <p className={tradeStyles.subtitle}>
                  {runPhase === "running" ? "Paying and starting the run on x402.miroshark.xyz…"
                    : "Runs on the hosted MiroShark (x402.miroshark.xyz). You're charged per the server's payment requirement (~$1 USDC)."}
                </p>
              </div>
              <button type="button" className={tradeStyles.iconBtn} onClick={closeX402} aria-label="Close" disabled={runPhase === "running"}>×</button>
            </div>

            <div className={tradeStyles.modalBody}>
              <div style={{ display: "grid", gap: 8, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--fw-line, rgba(255,255,255,0.08))" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ opacity: 0.7 }}>Wallet</span>
                  <span style={{ fontWeight: 600 }}>{chosen.name}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ opacity: 0.7 }}>Address</span>
                  <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{shortAddress(chosen.wallet.walletAddress)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ opacity: 0.7 }}>Charge</span>
                  <span style={{ fontWeight: 600 }}>~$1.00 USDC{pendingX402.deepResearch ? " · deep research" : ""}</span>
                </div>
              </div>

              {blockReason && runPhase === "confirm" && (
                <p style={{ marginTop: 12, color: "var(--fw-warn, #e0a800)", fontSize: 13, lineHeight: 1.5 }}>{blockReason}</p>
              )}
              {runPhase === "error" && runError && (
                <p style={{ marginTop: 12, color: "var(--fw-danger, #ff6b6b)", fontSize: 13, lineHeight: 1.5 }}>{runError}</p>
              )}
            </div>

            <div className={tradeStyles.modalFoot}>
              <button type="button" className={tradeStyles.btn} onClick={() => { setConfirmWalletId(null); setPickerOpen(true); setRunPhase("confirm"); setRunError(null); }} disabled={runPhase === "running"}>
                Change wallet
              </button>
              {blockReason ? (
                <button type="button" className={`${tradeStyles.btn} ${tradeStyles.btnPrimary}`} onClick={() => { setActiveView("wallet"); closeX402(); }}>Open Wallets</button>
              ) : (
                <button type="button" className={`${tradeStyles.btn} ${tradeStyles.btnPrimary}`} onClick={payX402} disabled={runPhase === "running"}>
                  {runPhase === "running" ? "Paying…" : runPhase === "error" ? "Retry · pay $1" : "Pay $1 & run"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Paid run · x402 — live progress + report (after pay, modal auto-closes) */}
      {x402Job && <X402JobCard job={x402Job} onClose={() => setX402Job(null)} />}
    </div>
  );
}
