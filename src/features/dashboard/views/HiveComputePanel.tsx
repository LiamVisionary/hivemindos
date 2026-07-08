"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Cpu, Download, RefreshCcw, ShieldCheck, Terminal, WalletCards } from "lucide-react";

import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { HiveComputeMarketplaceStatus } from "@/lib/types/hive-compute-marketplace";
import styles from "./HiveComputePanel.module.css";

type HiveComputePanelProps = {
  setActiveView?: (view: DashboardView) => void;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  status?: HiveComputeMarketplaceStatus;
};

type BusyAction = "refresh" | "install-worker" | "install-worker-deps" | "repair-worker" | null;

export function HiveComputePanel({ setActiveView }: HiveComputePanelProps) {
  const [status, setStatus] = useState<HiveComputeMarketplaceStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<BusyAction>("refresh");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialStatus() {
      try {
        const response = await fetch("/api/hive-compute/marketplace", { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as ApiResponse;
        if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute status failed.");
        if (!cancelled) setStatus(data.status);
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
  }, []);

  const refreshStatus = useCallback(async () => {
    setBusy("refresh");
    setMessage("");
    try {
      const response = await fetch("/api/hive-compute/marketplace", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute status failed.");
      setStatus(data.status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hive Compute status failed.");
    } finally {
      setBusy((current) => (current === "refresh" ? null : current));
    }
  }, []);

  const runAction = useCallback(async (action: Exclude<BusyAction, null | "refresh">) => {
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch("/api/hive-compute/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok || data.ok === false || !data.status) throw new Error(data.error || "Hive Compute action failed.");
      setStatus(data.status);
      setMessage(action === "install-worker-deps" ? "Worker dependencies installed." : "Worker module installed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hive Compute action failed.");
    } finally {
      setBusy(null);
    }
  }, []);

  const runCommand = status?.workerModule.runCommand || "";
  async function copyRunCommand() {
    if (!runCommand || !navigator.clipboard) return;
    await navigator.clipboard.writeText(runCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const statusTiles = status
    ? [
      {
        title: "Gateway",
        ready: status.gateway.configured && status.routing.ready,
        detail: status.gateway.configured ? status.routing.message : `Set ${status.gatewayEnv} in Env.`,
      },
      {
        title: "Worker module",
        ready: status.workerModule.installed,
        detail: status.workerModule.installed ? "Installed locally." : "Installable on demand.",
      },
      {
        title: "Ollama",
        ready: status.prerequisites.ollama.installed,
        detail: status.prerequisites.ollama.version || "Needed when this machine earns as a worker.",
      },
      {
        title: "Worker token",
        ready: status.workerToken.present,
        detail: status.workerToken.present ? `Set via ${status.workerToken.source || "environment"}.` : `Set ${status.workerTokenEnv}.`,
      },
    ]
    : [];

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

  const workerInstallBusy = busy === "install-worker" || busy === "repair-worker";
  const depsBusy = busy === "install-worker-deps";

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
            <button type="button" className={styles.secondaryButton} onClick={() => void refreshStatus()} disabled={Boolean(busy)}>
              {busy === "refresh" ? <span className={styles.spinner} aria-hidden="true" /> : <RefreshCcw size={16} aria-hidden="true" />}
              Refresh
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => setActiveView?.("env")}>
              <Terminal size={16} aria-hidden="true" />
              Open Env
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
                <span className={styles.eyebrow}><WalletCards size={15} /> Earn with spare GPU</span>
                <h2 className={styles.sectionTitle}>{status.earning.cta}</h2>
              </div>
              <span className={`${styles.pill} ${status.earning.ready ? styles.pillReady : ""}`}>
                <span className={styles.dot} aria-hidden="true" />
                {status.earning.ready ? "Worker ready" : "Installable"}
              </span>
            </div>
            <p className={styles.body}>{status.earning.message}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={() => void runAction(status.workerModule.installed ? "repair-worker" : "install-worker")} disabled={Boolean(busy)}>
                {workerInstallBusy ? <span className={styles.spinner} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {status.workerModule.installed ? "Repair worker" : "Install worker"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => void runAction("install-worker-deps")} disabled={Boolean(busy) || !status.prerequisites.node.installed}>
                {depsBusy ? <span className={styles.spinner} aria-hidden="true" /> : <Terminal size={16} aria-hidden="true" />}
                Install dependencies
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => void copyRunCommand()} disabled={!status.workerModule.installed}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? "Copied" : "Copy run command"}
              </button>
            </div>
            <div className={styles.list}>
              <InfoRow label="Module path" value={status.workerModule.root} mono />
              <InfoRow label="Run command" value={status.workerModule.runCommand} mono />
              <InfoRow label="Dependency install" value={status.workerModule.dependencyInstallCommand} mono />
            </div>
          </article>

          <article className={styles.section}>
            <div className={styles.sectionHead}>
              <div>
                <span className={styles.eyebrow}><ShieldCheck size={15} /> Routing boundary</span>
                <h2 className={styles.sectionTitle}>Marketplace authority stays hosted</h2>
              </div>
              <span className={`${styles.pill} ${status.routing.ready ? styles.pillReady : ""}`}>
                <span className={styles.dot} aria-hidden="true" />
                {status.routing.ready ? "Routing ready" : "Needs gateway"}
              </span>
            </div>
            <p className={styles.body}>{status.boundary.officialAuthority}</p>
            <p className={styles.body}>{status.boundary.selfHosted}</p>
            <p className={`${styles.body} ${styles.warning}`}>{status.boundary.promptPrivacy}</p>
            <div className={styles.list}>
              <InfoRow label="Gateway env" value={status.gatewayEnv} mono />
              <InfoRow label="OpenAI base env" value={status.openAiBaseEnv} mono />
              <InfoRow label="API key env" value={status.apiKeyEnv} mono />
              <InfoRow label="Chat route" value={status.routing.chatPath} mono />
            </div>
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
