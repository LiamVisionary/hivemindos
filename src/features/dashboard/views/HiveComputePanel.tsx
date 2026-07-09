"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Cpu, Gauge, Pause, Play, RefreshCcw, ShieldCheck, Terminal, WalletCards, Zap } from "lucide-react";

import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { HiveComputeHostRunConfig, HiveComputeMarketplaceStatus } from "@/lib/types/hive-compute-marketplace";
import styles from "./HiveComputePanel.module.css";

type HiveComputePanelProps = {
  setActiveView?: (view: DashboardView) => void;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  status?: HiveComputeMarketplaceStatus;
};

type BusyAction = "refresh" | "install-worker" | "install-worker-deps" | "repair-worker" | "setup-hosting" | "run-worker" | "stop-worker" | "open-mpp-session" | null;

const DEFAULT_HOST_CONFIG: HiveComputeHostRunConfig = {
  markdown: 20,
  maxConcurrency: 1,
  selectedModelIds: null,
  hostWhen: "idle",
  dailyCapUsd: null,
  pauseOnBattery: true,
  yieldToUser: true,
};

export function HiveComputePanel({ setActiveView }: HiveComputePanelProps) {
  const [status, setStatus] = useState<HiveComputeMarketplaceStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<BusyAction>("refresh");
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState<HiveComputeHostRunConfig>(DEFAULT_HOST_CONFIG);
  const appliedConfigRef = useRef(false);

  const applyStatus = useCallback((next: HiveComputeMarketplaceStatus) => {
    setStatus(next);
    if (!appliedConfigRef.current) {
      appliedConfigRef.current = true;
      setConfig(next.host.config);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialStatus() {
      try {
        const response = await fetch("/api/hive-compute/marketplace", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as ApiResponse;
        if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute status failed.");
        if (!cancelled) applyStatus(data.status);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Hive Compute status failed.");
      } finally {
        if (!cancelled) setBusy(null);
      }
    }
    void loadInitialStatus();
    return () => {
      cancelled = true;
    };
  }, [applyStatus]);

  const refreshStatus = useCallback(async () => {
    setBusy("refresh");
    setMessage("");
    try {
      const response = await fetch("/api/hive-compute/marketplace", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute status failed.");
      applyStatus(data.status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hive Compute status failed.");
    } finally {
      setBusy((current) => (current === "refresh" ? null : current));
    }
  }, [applyStatus]);

  const runAction = useCallback(async (action: Exclude<BusyAction, null | "refresh">) => {
    setBusy(action);
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
      if (action === "install-worker-deps") setMessage("Worker dependencies installed.");
      if (action === "install-worker") setMessage("Worker module installed.");
      if (action === "repair-worker") setMessage("Worker module repaired.");
      if (action === "setup-hosting") setMessage("Hosting setup finished.");
      if (action === "run-worker") setMessage("Hive Compute worker is live.");
      if (action === "stop-worker") setMessage("Hive Compute worker stopped.");
      if (action === "open-mpp-session") setMessage("MPP machine-payment session opened.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hive Compute action failed.");
    } finally {
      setBusy(null);
    }
  }, [applyStatus, config]);

  const patchConfig = (patch: Partial<HiveComputeHostRunConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  };

  const availableModelIds = useMemo(
    () => status?.host.models.map((model) => model.providerModelId) ?? [],
    [status?.host.models],
  );
  const selectedModelIdSet = useMemo(
    () => new Set(config.selectedModelIds ?? availableModelIds),
    [availableModelIds, config.selectedModelIds],
  );

  const toggleModel = useCallback((modelId: string) => {
    setConfig((current) => {
      const selected = new Set(current.selectedModelIds === null ? availableModelIds : current.selectedModelIds);
      if (selected.has(modelId)) {
        selected.delete(modelId);
      } else {
        selected.add(modelId);
      }
      return { ...current, selectedModelIds: availableModelIds.filter((id) => selected.has(id)) };
    });
  }, [availableModelIds]);

  const enableAllModels = () => {
    patchConfig({ selectedModelIds: null });
  };

  const runCommand = status?.workerModule.runCommand || "";
  async function copyRunCommand() {
    if (!runCommand || !navigator.clipboard) return;
    await navigator.clipboard.writeText(runCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!status) {
    return (
      <div className={styles.panel}>
        <div className={styles.shell}>
          <div className={styles.hero}>
            <div>
              <span className={styles.eyebrow}><Cpu size={16} /> Hive Compute</span>
              <h1 className={styles.title}>GPU Marketplace</h1>
              <p className={styles.lead}>Checking marketplace routing, worker setup, and local GPU prerequisites.</p>
            </div>
          </div>
          <div className={styles.skeletonWrap} role="status" aria-label="Loading Hive Compute setup">
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
            <div className={styles.skeleton} />
          </div>
          {message ? <p className={styles.body}>{message}</p> : null}
        </div>
      </div>
    );
  }

  const workerRunning = status.host.run?.status === "running" || status.host.run?.status === "starting";
  const setupBusy = busy === "setup-hosting" || busy === "install-worker" || busy === "install-worker-deps" || busy === "repair-worker";
  const primaryAction = workerRunning ? "stop-worker" : status.host.canRun ? "run-worker" : "setup-hosting";
  const primaryLabel = workerRunning ? "Stop hosting" : status.host.canRun ? "Go live" : "Set up hosting";
  const paymentReady = status.payments.x402.ready && (!status.payments.mpp.enabled || status.payments.mpp.ready || !status.payments.mpp.requireSession);
  const privacyLabel = status.privacy.attestationReady && status.privacy.encryptedDeliveryReady ? "Verified enclave" : "Standard";
  const advertisedModelCount = status.host.models.filter((model) => selectedModelIdSet.has(model.providerModelId)).length;
  const statusTiles = [
    {
      title: "Gateway",
      ready: status.gateway.configured && status.routing.ready,
      detail: status.gateway.configured ? "Connected." : "Needs gateway access.",
    },
    {
      title: "Worker",
      ready: status.workerModule.installed && status.workerModule.nodeModulesInstalled && !status.workerModule.updateAvailable,
      detail: status.workerModule.updateAvailable
        ? "Set up hosting will update it."
        : status.workerModule.installed && status.workerModule.nodeModulesInstalled ? "Installed." : "Set up hosting will install it.",
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
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}><Cpu size={16} /> Marketplace inference</span>
            <h1 className={styles.title}>{status.productName}</h1>
            <p className={styles.lead}>
              Route agent model calls through marketplace GPUs, or install the optional worker module on this machine to rent out spare local GPU capacity.
            </p>
          </div>
          <div className={styles.heroActions}>
            <button type="button" className={styles.button} onClick={() => void runAction(primaryAction)} disabled={Boolean(busy)}>
              {busy === primaryAction || setupBusy ? <span className={styles.spinner} aria-hidden="true" /> : workerRunning ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {setupBusy ? "Setting up" : primaryLabel}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => void refreshStatus()} disabled={Boolean(busy)}>
              {busy === "refresh" ? <span className={styles.spinner} aria-hidden="true" /> : <RefreshCcw size={16} aria-hidden="true" />}
              Refresh
            </button>
          </div>
        </section>

        <section className={styles.statusGrid} aria-label="Hive Compute readiness">
          {statusTiles.map((tile) => (
            <article key={tile.title} className={styles.tile}>
              <div className={styles.tileHead}>
                <h2 className={styles.tileTitle}>{tile.title}</h2>
                <span className={`${styles.pill} ${tile.ready ? styles.pillReady : ""}`}>
                  <span className={styles.dot} aria-hidden="true" />
                  {tile.ready ? "Ready" : "Setup"}
                </span>
              </div>
              <p className={styles.tileDetail}>{tile.detail}</p>
            </article>
          ))}
        </section>

        {message ? <p className={`${styles.body} ${styles.warning}`} role="status">{message}</p> : null}

        <section className={styles.mainGrid}>
          <article className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <span className={styles.eyebrow}><WalletCards size={15} /> Host this machine</span>
                <h2 className={styles.sectionTitle}>{workerRunning ? "Accepting jobs" : status.host.canRun ? "Ready to go live" : "One-click setup"}</h2>
              </div>
              <span className={`${styles.pill} ${workerRunning || status.host.canRun ? styles.pillReady : ""}`}>
                <span className={styles.dot} aria-hidden="true" />
                {workerRunning ? "Live" : status.host.canRun ? "Ready" : "Setup"}
              </span>
            </div>
            <p className={styles.body}>
              {workerRunning
                ? "This machine is live on Hive Compute and can receive eligible marketplace inference jobs."
                : status.host.canRun
                  ? "Everything needed is ready. Use Go live when you want this machine to start accepting jobs."
                  : "Set up hosting installs the worker, installs dependencies, discovers local models, saves safe defaults, and opens a payment session when your gateway supports it."}
            </p>
            <div className={styles.chips}>
              <span className={`${styles.pill} ${advertisedModelCount ? styles.pillReady : ""}`}><span className={styles.dot} aria-hidden="true" />{advertisedModelCount} advertised model{advertisedModelCount === 1 ? "" : "s"}</span>
              <span className={`${styles.pill} ${paymentReady ? styles.pillReady : ""}`}><span className={styles.dot} aria-hidden="true" />Payments: {paymentReady ? "Active" : "Setup"}</span>
              <span className={`${styles.pill} ${privacyLabel === "Verified enclave" ? styles.pillReady : ""}`}><span className={styles.dot} aria-hidden="true" />Privacy: {privacyLabel}</span>
            </div>
            <div className={styles.hostControls}>
              <label className={styles.range}>
                <span className={styles.body}>List markdown: <b>{config.markdown}%</b></span>
                <input type="range" min={0} max={80} step={1} value={config.markdown} onChange={(event) => patchConfig({ markdown: Number(event.target.value) })} />
              </label>
              <div className={styles.controlRow}>
                <span className={styles.body}><Gauge size={15} aria-hidden="true" /> Max concurrency</span>
                <span className={styles.stepper}>
                  <button type="button" onClick={() => patchConfig({ maxConcurrency: Math.max(1, config.maxConcurrency - 1) })} aria-label="Lower concurrency">-</button>
                  <span>{config.maxConcurrency}</span>
                  <button type="button" onClick={() => patchConfig({ maxConcurrency: Math.min(256, config.maxConcurrency + 1) })} aria-label="Raise concurrency">+</button>
                </span>
              </div>
              <div className={styles.modelPicker}>
                <div className={styles.controlRow}>
                  <span className={styles.body}>Models to advertise</span>
                  <button type="button" className={styles.chipButton} onClick={enableAllModels}>
                    <Check size={14} aria-hidden="true" />
                    Enable all
                  </button>
                </div>
                <div className={styles.modelChips} role="group" aria-label="Models to advertise through Hive Compute">
                  {status.host.models.length ? status.host.models.map((model) => {
                    const active = selectedModelIdSet.has(model.providerModelId);
                    return (
                      <button
                        key={model.providerModelId}
                        type="button"
                        className={styles.modelChip}
                        data-active={active}
                        aria-pressed={active}
                        onClick={() => toggleModel(model.providerModelId)}
                      >
                        {active ? <Check size={14} aria-hidden="true" /> : null}
                        <span>{model.name || model.id}</span>
                      </button>
                    );
                  }) : (
                    <p className={styles.body}>Start LM Studio or Ollama, then refresh.</p>
                  )}
                </div>
                <p className={styles.small}>Disabled models stay available locally but are not listed for marketplace jobs.</p>
              </div>
            </div>
          </article>

          <article className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <span className={styles.eyebrow}><ShieldCheck size={15} /> Safety</span>
                <h2 className={styles.sectionTitle}>Payments and privacy</h2>
              </div>
              <span className={`${styles.pill} ${paymentReady ? styles.pillReady : ""}`}>
                <span className={styles.dot} aria-hidden="true" />
                {paymentReady ? "Active" : "Setup"}
              </span>
            </div>
            <p className={styles.body}>{status.payments.mpp.enabled ? status.payments.mpp.message : status.payments.x402.message}</p>
            <p className={styles.body}>{status.privacy.message}</p>
            <div className={styles.chips}>
              <span className={styles.pill}>{status.payments.mpp.enabled ? "MPP available" : "x402 per call"}</span>
              <span className={styles.pill}>{privacyLabel}</span>
            </div>
          </article>
        </section>

        <details className={styles.details}>
          <summary>Advanced diagnostics</summary>
          <section className={styles.mainGrid}>
            <article className={styles.section}>
              <div className={styles.sectionHead}>
                <div>
                  <span className={styles.eyebrow}><Terminal size={15} /> Runtime details</span>
                  <h2 className={styles.sectionTitle}>Setup internals</h2>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={() => setActiveView?.("env")}>
                  <Terminal size={16} aria-hidden="true" />
                  Open Env
                </button>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void copyRunCommand()} disabled={!status.workerModule.installed}>
                  {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy run command"}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => void runAction("open-mpp-session")} disabled={Boolean(busy) || !status.gateway.configured || !status.payments.mpp.enabled}>
                  {busy === "open-mpp-session" ? <span className={styles.spinner} aria-hidden="true" /> : <Zap size={16} aria-hidden="true" />}
                  Open MPP session
                </button>
              </div>
              <div className={styles.list}>
                <InfoRow label="Module path" value={status.workerModule.root} mono />
                <InfoRow label="Run command" value={status.workerModule.runCommand} mono />
                <InfoRow label="Gateway env" value={status.gatewayEnv} mono />
                <InfoRow label="Local backend" value={`${status.host.backend.label} · ${status.host.backend.host}`} mono />
                <InfoRow label="MPP session" value={status.payments.mpp.sessionToken.present ? `Present via ${status.payments.mpp.sessionToken.source || "environment"}` : "Not open"} />
                <InfoRow label="TEE evidence" value={status.privacy.attestationReady ? `${status.privacy.teeProvider || "TEE"} via ${status.privacy.evidenceSource || "evidence"}` : "Not ready"} />
              </div>
            </article>

            <article className={styles.section}>
              <div className={styles.sectionHead}>
                <div>
                  <span className={styles.eyebrow}><ShieldCheck size={15} /> Boundary</span>
                  <h2 className={styles.sectionTitle}>Hosted authority</h2>
                </div>
                <span className={`${styles.pill} ${status.routing.ready ? styles.pillReady : ""}`}>
                  <span className={styles.dot} aria-hidden="true" />
                  {status.routing.ready ? "Routing ready" : "Needs gateway"}
                </span>
              </div>
              <p className={styles.body}>{status.boundary.officialAuthority}</p>
              <p className={`${styles.body} ${styles.warning}`}>{status.boundary.promptPrivacy}</p>
              <p className={styles.body}>{status.boundary.confidentialCompute}</p>
            </article>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <span className={styles.eyebrow}><Cpu size={15} /> Model routes</span>
                <h2 className={styles.sectionTitle}>Agent model picker options</h2>
              </div>
              <span className={styles.pill}>{status.models.length} routes</span>
            </div>
            <div className={styles.modelList}>
              {status.models.map((model) => (
                <article key={model.id} className={styles.model}>
                  <div className={styles.row}>
                    <div>
                      <strong>{model.name || model.id}</strong>
                      <p className={styles.small}>{model.subtitle || model.disabledReason || "Advertised by the configured gateway."}</p>
                    </div>
                    <span className={styles.pill}>{model.badge || model.group || "Route"}</span>
                  </div>
                  <div className={styles.mono}>{model.id}</div>
                </article>
              ))}
            </div>
          </section>
        </details>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.row}>
      <span className={styles.meta}>{label}</span>
      <span className={mono ? styles.mono : styles.meta}>{value || "Not set"}</span>
    </div>
  );
}
