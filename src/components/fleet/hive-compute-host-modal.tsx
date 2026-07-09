"use client";

import * as React from "react";
import {
  BatteryCharging,
  Check,
  Cpu,
  Gauge,
  Moon,
  Pause,
  Play,
  RefreshCcw,
  ShieldCheck,
  Square,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { FleetMachine } from "@/components/fleet/fleet-data";
import type { HiveComputeHostRunConfig, HiveComputeMarketplaceStatus } from "@/lib/types/hive-compute-marketplace";
import styles from "./hive-compute-host-modal.module.css";

type ApiResponse = {
  ok?: boolean;
  error?: string;
  status?: HiveComputeMarketplaceStatus;
};

type BusyAction = "refresh" | "install-worker" | "install-worker-deps" | "repair-worker" | "setup-hosting" | "run-worker" | "stop-worker" | "open-mpp-session" | null;

const HOST_WHEN_OPTIONS: Array<{ id: HiveComputeHostRunConfig["hostWhen"]; icon: LucideIcon; label: string }> = [
  { id: "idle", icon: Moon, label: "Idle only" },
  { id: "always", icon: Zap, label: "Always" },
  { id: "sched", icon: Square, label: "Scheduled" },
];

function isRunning(status: HiveComputeMarketplaceStatus | null) {
  return status?.host.run?.status === "running" || status?.host.run?.status === "starting";
}

function moneyMicro(value: number) {
  return (value / 1_000_000).toFixed(2);
}

function StatusTile({ title, ready, detail }: { title: string; ready: boolean; detail: string }) {
  return (
    <article className={styles.tile}>
      <span className={`${styles.pill} ${ready ? styles.pillReady : styles.pillWarn}`}>
        <span className={styles.dot} aria-hidden="true" />
        {ready ? "Ready" : "Needs setup"}
      </span>
      <strong>{title}</strong>
      <p className={styles.small}>{detail}</p>
    </article>
  );
}

export function HiveComputeHostModal({ machine, onClose }: { machine: FleetMachine; onClose: () => void }) {
  const [status, setStatus] = React.useState<HiveComputeMarketplaceStatus | null>(null);
  const [busy, setBusy] = React.useState<BusyAction>("refresh");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [config, setConfig] = React.useState<HiveComputeHostRunConfig>({
    markdown: 20,
    maxConcurrency: 4,
    hostWhen: "idle",
    dailyCapUsd: null,
    pauseOnBattery: true,
    yieldToUser: true,
  });
  const appliedConfigRef = React.useRef(false);

  const applyStatus = React.useCallback((next: HiveComputeMarketplaceStatus) => {
    setStatus(next);
    if (!appliedConfigRef.current) {
      appliedConfigRef.current = true;
      setConfig(next.host.config);
    }
  }, []);

  const fetchStatus = React.useCallback(async () => {
    setBusy("refresh");
    setError("");
    try {
      const response = await fetch("/api/hive-compute/marketplace", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute status failed.");
      applyStatus(data.status);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Hive Compute status failed.");
    } finally {
      setBusy((current) => (current === "refresh" ? null : current));
    }
  }, [applyStatus]);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch("/api/hive-compute/marketplace", { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json().catch(() => ({})) as ApiResponse;
          if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute status failed.");
          if (!cancelled) applyStatus(data.status);
        })
        .catch((fetchError) => {
          if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "Hive Compute status failed.");
        })
        .finally(() => {
          if (!cancelled) setBusy((current) => (current === "refresh" ? null : current));
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyStatus]);

  const runAction = React.useCallback(async (action: Exclude<BusyAction, null | "refresh">) => {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/hive-compute/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, config }),
      });
      const data = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute action failed.");
      applyStatus(data.status);
      if (action === "install-worker") setMessage("Hive Compute worker installed.");
      if (action === "repair-worker") setMessage("Hive Compute worker repaired.");
      if (action === "setup-hosting") setMessage("Hosting setup finished.");
      if (action === "install-worker-deps") setMessage("Worker dependencies installed.");
      if (action === "run-worker") setMessage("Hive Compute worker is live.");
      if (action === "stop-worker") setMessage("Hive Compute worker stopped.");
      if (action === "open-mpp-session") setMessage("MPP machine-payment session opened.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Hive Compute action failed.");
    } finally {
      setBusy(null);
    }
  }, [applyStatus, config]);

  const patchConfig = (patch: Partial<HiveComputeHostRunConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  };

  const run = status?.host.run;
  const live = isRunning(status);
  const setupBusy = busy === "setup-hosting" || busy === "install-worker" || busy === "install-worker-deps" || busy === "repair-worker";
  const primaryAction = live ? "stop-worker" : status?.host.canRun ? "run-worker" : "setup-hosting";
  const primaryLabel = live ? "Stop hosting" : status?.host.canRun ? "Go live" : "Set up hosting";
  const paymentReady = status ? status.payments.x402.ready && (!status.payments.mpp.enabled || status.payments.mpp.ready || !status.payments.mpp.requireSession) : false;
  const privacyLabel = status?.privacy.attestationReady && status.privacy.encryptedDeliveryReady ? "Verified enclave" : "Standard";
  const statusTiles = status ? [
    {
      title: "Worker",
      ready: status.workerModule.installed && status.workerModule.nodeModulesInstalled,
      detail: status.workerModule.installed && status.workerModule.nodeModulesInstalled ? "Installed." : "Set up hosting will install it.",
    },
    {
      title: "Gateway",
      ready: status.gateway.configured,
      detail: status.gateway.configured ? "Connected." : "Needs gateway access.",
    },
    {
      title: "Token",
      ready: status.workerToken.present,
      detail: status.workerToken.present ? "Worker can authenticate." : "Needs worker token.",
    },
    {
      title: "Model",
      ready: status.host.backend.reachable && status.host.models.length > 0,
      detail: status.host.backend.message,
    },
    {
      title: "Payments",
      ready: paymentReady,
      detail: paymentReady ? "Ready." : status.payments.mpp.enabled ? "Needs payment session." : "Needs gateway.",
    },
  ] : [];

  return (
    <div role="presentation" className={styles.backdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Hive Compute host setup for ${machine.name}`}
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
      >
        <CloseIconButton type="button" title="Close" aria-label="Close Hive Compute host setup" onClick={onClose} className={styles.close} />
        <header className={styles.header}>
          <span className={styles.mark}><Cpu size={25} aria-hidden="true" /></span>
          <div>
            <span className={styles.eyebrow}><Cpu size={14} aria-hidden="true" /> Hive Compute host</span>
            <h2>Rent out {machine.name}</h2>
            <p>Turn this machine into a first-party Hive Compute worker for marketplace inference.</p>
          </div>
        </header>

        {!status ? (
          <div className={styles.skeletonWrap} role="status" aria-label="Checking Hive Compute host setup">
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.chips}>
                <span className={`${styles.pill} ${status.host.canRun ? styles.pillReady : styles.pillWarn}`}>
                  <span className={styles.dot} aria-hidden="true" />
                  {status.host.canRun ? "Ready to host" : "Setup needed"}
                </span>
                <span className={`${styles.pill} ${live ? styles.pillReady : ""}`}>
                  <span className={styles.dot} aria-hidden="true" />
                  {live ? "Worker live" : "Worker idle"}
                </span>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void fetchStatus()}>
                  {busy === "refresh" ? <span className={styles.spinner} aria-hidden="true" /> : <RefreshCcw size={15} aria-hidden="true" />}
                  Refresh
                </button>
                <button type="button" className={styles.button} disabled={Boolean(busy)} onClick={() => void runAction(primaryAction)}>
                  {busy === primaryAction || setupBusy ? <span className={styles.spinner} aria-hidden="true" /> : live ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                  {setupBusy ? "Setting up" : primaryLabel}
                </button>
              </div>
            </div>

            <div className={styles.statusGrid} aria-label="Hive Compute host readiness">
              {statusTiles.map((tile) => <StatusTile key={tile.title} {...tile} />)}
            </div>

            <div className={styles.summaryGrid}>
              <section className={styles.section}>
                <div>
                  <span className={styles.eyebrow}><Cpu size={14} aria-hidden="true" /> What happens next</span>
                  <h3>{live ? "This machine is live" : status.host.canRun ? "Ready to go live" : "One-click setup"}</h3>
                </div>
                <p className={styles.body}>
                  {live
                    ? "Hive Compute is accepting eligible marketplace jobs from this machine."
                    : status.host.canRun
                      ? "Press Go live when you want this machine to start accepting jobs."
                      : "Set up hosting installs the worker, installs dependencies, discovers local models, saves safe defaults, and opens a payment session when your gateway supports it."}
                </p>
                <div className={styles.chips}>
                  <span className={`${styles.pill} ${paymentReady ? styles.pillReady : styles.pillWarn}`}><span className={styles.dot} aria-hidden="true" />Payments: {paymentReady ? "Active" : "Setup"}</span>
                  <span className={`${styles.pill} ${privacyLabel === "Verified enclave" ? styles.pillReady : ""}`}><span className={styles.dot} aria-hidden="true" />Privacy: {privacyLabel}</span>
                  <span className={styles.pill}>{status.host.models.length} model{status.host.models.length === 1 ? "" : "s"}</span>
                </div>
              </section>

              <section className={styles.section}>
                <div>
                  <span className={styles.eyebrow}><Gauge size={14} aria-hidden="true" /> Hosting controls</span>
                  <h3>Pricing and guardrails</h3>
                </div>
                <label className={styles.range}>
                  <span className={styles.body}>List markdown: <b>{config.markdown}%</b></span>
                  <input type="range" min={0} max={80} step={1} value={config.markdown} onChange={(event) => patchConfig({ markdown: Number(event.target.value) })} />
                </label>
                <div className={styles.toolbar}>
                  <span className={styles.body}>Max concurrency</span>
                  <span className={styles.stepper}>
                    <button type="button" onClick={() => patchConfig({ maxConcurrency: Math.max(1, config.maxConcurrency - 1) })} aria-label="Lower concurrency">-</button>
                    <span>{config.maxConcurrency}</span>
                    <button type="button" onClick={() => patchConfig({ maxConcurrency: Math.min(256, config.maxConcurrency + 1) })} aria-label="Raise concurrency">+</button>
                  </span>
                </div>
                <div className={styles.segmented} role="group" aria-label="Host when">
                  {HOST_WHEN_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button key={option.id} type="button" data-active={config.hostWhen === option.id} onClick={() => patchConfig({ hostWhen: option.id })}>
                        <Icon size={14} aria-hidden="true" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className={styles.chips}>
                  <button type="button" className={styles.toggle} data-active={config.pauseOnBattery} onClick={() => patchConfig({ pauseOnBattery: !config.pauseOnBattery })}>
                    <BatteryCharging size={14} aria-hidden="true" />
                    Pause on battery
                  </button>
                  <button type="button" className={styles.toggle} data-active={config.yieldToUser} onClick={() => patchConfig({ yieldToUser: !config.yieldToUser })}>
                    <ShieldCheck size={14} aria-hidden="true" />
                    Yield to user activity
                  </button>
                </div>
              </section>
            </div>

            <details className={styles.details}>
              <summary>Advanced diagnostics</summary>
              <div className={styles.grid}>
                <section className={styles.section}>
                  <div>
                    <span className={styles.eyebrow}><Gauge size={14} aria-hidden="true" /> Model backend</span>
                    <h3>{status.host.backend.label}</h3>
                  </div>
                  <p className={styles.body}>{status.host.backend.message}</p>
                  <code className={styles.backendCode}>{status.host.backend.host}</code>
                  <div className={styles.modelList}>
                    {status.host.models.length ? status.host.models.map((model) => (
                      <article key={model.id} className={styles.modelRow}>
                        <span>
                          <b>{model.name || model.id}</b>
                          <p className={styles.small}>{model.providerModelId}</p>
                        </span>
                        <span className={styles.pill}>${moneyMicro(model.inputPer1m)} / ${moneyMicro(model.outputPer1m)} per M</span>
                      </article>
                    )) : (
                      <p className={styles.body}>Start LM Studio or Ollama, then refresh.</p>
                    )}
                  </div>
                </section>
                <section className={styles.section}>
                  <div>
                    <span className={styles.eyebrow}><ShieldCheck size={14} aria-hidden="true" /> Payments and privacy</span>
                    <h3>Gateway-enforced controls</h3>
                  </div>
                  <p className={styles.body}>{status.payments.mpp.message}</p>
                  <p className={styles.body}>{status.privacy.message}</p>
                  <div className={styles.chips}>
                    <span className={styles.pill}>{status.payments.mpp.sessionToken.present ? `MPP via ${status.payments.mpp.sessionToken.source || "environment"}` : "MPP not open"}</span>
                    <span className={styles.pill}>{status.privacy.mode}</span>
                  </div>
                  <button type="button" className={styles.secondaryButton} onClick={() => void runAction("open-mpp-session")} disabled={Boolean(busy) || !status.gateway.configured || !status.payments.mpp.enabled}>
                    {busy === "open-mpp-session" ? <span className={styles.spinner} aria-hidden="true" /> : <Zap size={15} aria-hidden="true" />}
                    Open MPP session
                  </button>
                </section>
              </div>
            </details>

            {run?.output ? (
              <section className={styles.section}>
                <span className={styles.eyebrow}><Check size={14} aria-hidden="true" /> Worker output</span>
                <pre className={styles.mono}>{run.output.split(/\r?\n/).slice(-8).join("\n")}</pre>
              </section>
            ) : null}

            <p className={`${styles.notice} ${error ? styles.error : ""}`} role="status">
              {error || message || status.host.message}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
