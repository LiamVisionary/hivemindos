"use client";

import * as React from "react";
import {
  ArrowRight,
  BatteryCharging,
  Check,
  ChevronLeft,
  Cpu,
  CreditCard,
  Download,
  Gauge,
  Key,
  Link2,
  Lock,
  Moon,
  Network,
  Package,
  Pause,
  Play,
  RefreshCcw,
  Search,
  ShieldCheck,
  Square,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { FleetMachine } from "@/components/fleet/fleet-data";
import type {
  HiveComputeHostModel,
  HiveComputeHostRunConfig,
  HiveComputeHostWhen,
  HiveComputeMarketplaceStatus,
} from "@/lib/types/hive-compute-marketplace";
import styles from "./hive-compute-host-modal.module.css";

type ApiResponse = {
  ok?: boolean;
  error?: string;
  status?: HiveComputeMarketplaceStatus;
};

type BusyAction = "refresh" | "setup-hosting" | "run-worker" | "stop-worker" | "open-mpp-session" | null;
type Step = "intro" | "setup" | "manage" | "earnings";
type StageStatus = "ready" | "block" | "error" | "dim";

type Stage = { key: string; label: string; Icon: LucideIcon; status: StageStatus; energized: boolean; on: boolean };

const STAGE_META: Array<{ key: string; label: string; Icon: LucideIcon }> = [
  { key: "worker", label: "Worker", Icon: Cpu },
  { key: "gateway", label: "Gateway", Icon: Network },
  { key: "token", label: "Token", Icon: Key },
  { key: "model", label: "Model", Icon: Package },
  { key: "payments", label: "Payments", Icon: CreditCard },
];

const HOST_WHEN_OPTIONS: Array<{ id: HiveComputeHostWhen; label: string; Icon: LucideIcon }> = [
  { id: "idle", label: "Idle only", Icon: Moon },
  { id: "always", label: "Always", Icon: Zap },
  { id: "sched", label: "Scheduled", Icon: Square },
];

const SETUP_TASK_LABELS = [
  "Install worker & dependencies",
  "Connect to the gateway",
  "Issue worker token",
  "Discover local models",
];

function isRunning(status: HiveComputeMarketplaceStatus | null): boolean {
  return status?.host.run?.status === "running" || status?.host.run?.status === "starting";
}

function moneyMicro(value: number): string {
  return (value / 1_000_000).toFixed(2);
}

function money(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return "$" + (n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(2));
}

function computeEarnings(count: number, markdown: number) {
  const priceFactor = 1 - (markdown / 100) * 0.5;
  const dayLo = count * 0.28 * priceFactor;
  const dayHi = count * 0.84 * priceFactor;
  const monthLo = dayLo * 30;
  const monthHi = dayHi * 30;
  return {
    dayLo,
    dayHi,
    monthLo,
    monthHi,
    monthMid: (monthLo + monthHi) / 2,
    dayStr: `${money(dayLo)}–${money(dayHi)}`,
    monthStr: `${money(monthLo)}–${money(monthHi)}`,
  };
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function normalizeDeviceToken(value: string): string {
  // Drop possessives ("Liam's" → "Liam") so an LM Studio device name and a
  // Tailscale machine name for the same box normalize alike.
  return value.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function deviceCoreName(value: string): string {
  // LM Studio device names often carry a role suffix ("-Host", ".local") the
  // fleet name lacks — strip it before comparing.
  return normalizeDeviceToken(value.replace(/[\s._-]*(host|local|lan|pc|node)$/i, ""));
}

// Best-effort location for an LM Link host: match the LM Studio device name to a
// non-self fleet machine and borrow its (fleet-derived) location. Returns
// undefined when there is no confident match, or when tied matches disagree on
// location, rather than guessing.
function resolveLinkHostLocation(deviceName: string | undefined, machines: FleetMachine[] | undefined): string | undefined {
  if (!deviceName || !machines?.length) return undefined;
  const target = deviceCoreName(deviceName);
  if (target.length < 4) return undefined;
  const scored = machines
    .filter((machine) => !/^this\b/i.test((machine.name || "").trim()))
    .map((machine) => {
      const name = normalizeDeviceToken(machine.name || "");
      const tailnet = normalizeDeviceToken(machine.tailnet || "");
      let score = 0;
      if (name === target || tailnet === target) score = 3;
      else if (name.includes(target) || target.includes(name) || tailnet.includes(target)) score = 2;
      return { machine, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return undefined;
  const topScore = scored[0].score;
  const tied = scored.filter((entry) => entry.score === topScore);
  // Prefer the human city label ("New York relay") over the generic location
  // bucket ("Tailscale relay").
  const labels = new Set(
    tied.map((entry) => (entry.machine.city || entry.machine.location || "").trim()).filter(Boolean),
  );
  return labels.size === 1 ? [...labels][0] : undefined;
}

function paymentsReady(status: HiveComputeMarketplaceStatus): boolean {
  return (
    status.payments.x402.ready &&
    (!status.payments.mpp.enabled || status.payments.mpp.ready || !status.payments.mpp.requireSession)
  );
}

function readinessBooleans(status: HiveComputeMarketplaceStatus): boolean[] {
  const wm = status.workerModule;
  return [
    wm.installed && wm.nodeModulesInstalled && !wm.updateAvailable,
    status.gateway.configured,
    status.workerToken.present,
    status.host.backend.reachable && status.host.models.length > 0,
    paymentsReady(status),
  ];
}

type MeterOverride =
  | { mode: "empty" }
  | { mode: "live" }
  | { mode: "setup"; progress: number }
  | null;

function buildStages(status: HiveComputeMarketplaceStatus | null, override: MeterOverride): Stage[] {
  if (override?.mode === "empty") {
    return STAGE_META.map((m) => ({ ...m, status: "dim" as const, energized: false, on: false }));
  }
  if (override?.mode === "live") {
    return STAGE_META.map((m) => ({ ...m, status: "ready" as const, energized: true, on: true }));
  }
  if (override?.mode === "setup") {
    const p = override.progress;
    return STAGE_META.map((m, i) => {
      if (i < p) return { ...m, status: "ready" as const, energized: true, on: true };
      if (i === p && p < 4) return { ...m, status: "block" as const, energized: false, on: true };
      return { ...m, status: "dim" as const, energized: false, on: false };
    });
  }
  if (!status) return STAGE_META.map((m) => ({ ...m, status: "dim" as const, energized: false, on: false }));

  const bools = readinessBooleans(status);
  const firstBad = bools.findIndex((b) => !b);
  const errorAtGateway = status.gateway.configured && status.gateway.health?.ok === false;
  return STAGE_META.map((m, i) => {
    if (firstBad === -1) return { ...m, status: "ready" as const, energized: true, on: true };
    if (i < firstBad) return { ...m, status: "ready" as const, energized: true, on: true };
    if (i === firstBad) {
      const st: StageStatus = i === 1 && errorAtGateway ? "error" : "block";
      return { ...m, status: st, energized: false, on: true };
    }
    return { ...m, status: "dim" as const, energized: false, on: false };
  });
}

function meterStatusFor(
  step: Step,
  status: HiveComputeMarketplaceStatus | null,
): { text: string; tone: "live" | "error" | "honey" | "idle"; live: boolean } {
  if (step === "intro") return { text: "Not set up yet", tone: "idle", live: false };
  if (step === "setup") return { text: "Setting up…", tone: "honey", live: true };
  const running = isRunning(status);
  if (step === "earnings" && running) return { text: "Live · earning", tone: "live", live: true };
  if (!status) return { text: "Checking…", tone: "idle", live: false };
  const bools = readinessBooleans(status);
  const firstBad = bools.findIndex((b) => !b);
  if (firstBad === -1 && running) return { text: "Live · all gates open", tone: "live", live: true };
  if (firstBad === -1) return { text: "Ready to go live", tone: "honey", live: false };
  const errorAtGateway = status.gateway.configured && status.gateway.health?.ok === false;
  if (errorAtGateway) return { text: "Blocked at gateway", tone: "error", live: false };
  return { text: "Waiting to go live", tone: "honey", live: false };
}

export function HiveComputeHostModal({
  machine,
  machines,
  onClose,
}: {
  machine: FleetMachine;
  machines?: FleetMachine[];
  onClose: () => void;
}) {
  const [status, setStatus] = React.useState<HiveComputeMarketplaceStatus | null>(null);
  const [busy, setBusy] = React.useState<BusyAction>("refresh");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [step, setStep] = React.useState<Step>("intro");
  const [setupProgress, setSetupProgress] = React.useState(0);
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  const [config, setConfig] = React.useState<HiveComputeHostRunConfig>({
    markdown: 20,
    maxConcurrency: 1,
    selectedModelIds: null,
    hostWhen: "idle",
    dailyCapUsd: null,
    pauseOnBattery: true,
    yieldToUser: true,
  });

  const appliedRef = React.useRef(false);
  const setupTimerRef = React.useRef<number | null>(null);
  const finishTimerRef = React.useRef<number | null>(null);

  const machineName = machine.name || "this machine";
  const running = isRunning(status);

  // Which machine's models to discover. A "This …" display name or a direct
  // loopback collector means the dashboard host itself. A linkd peer-proxy URL
  // (http://127.0.0.1:8788/peer/<ip>:<port>) is loopback-hosted but reaches a
  // REMOTE machine, so it must NOT count as self.
  const targetCollectorUrl = (machine.collectorUrl || "").trim();
  const isPeerProxyCollector = /\/peer\//i.test(targetCollectorUrl);
  const isSelfMachine =
    /^this\b/i.test((machine.name || "").trim()) ||
    (!!targetCollectorUrl &&
      !isPeerProxyCollector &&
      /^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)(:|\/|$)/i.test(targetCollectorUrl));

  // Prefer the human city label ("New York relay") over the generic location
  // bucket ("Tailscale relay") when attributing where a machine's models run.
  const targetLocation = (machine.city || machine.location || "").trim();

  const targetQuery = React.useMemo(() => {
    const params = new URLSearchParams();
    if (targetCollectorUrl) params.set("targetCollectorUrl", targetCollectorUrl);
    if (machine.name) params.set("targetMachineName", machine.name);
    if (targetLocation) params.set("targetLocation", targetLocation);
    if (isSelfMachine) params.set("targetSelf", "1");
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [targetCollectorUrl, machine.name, targetLocation, isSelfMachine]);

  const targetBody = React.useMemo(
    () => ({
      ...(targetCollectorUrl ? { collectorUrl: targetCollectorUrl } : {}),
      ...(machine.name ? { machineName: machine.name } : {}),
      ...(targetLocation ? { location: targetLocation } : {}),
      isSelf: isSelfMachine,
    }),
    [targetCollectorUrl, machine.name, targetLocation, isSelfMachine],
  );

  const applyStatus = React.useCallback((next: HiveComputeMarketplaceStatus) => {
    setStatus(next);
    if (!appliedRef.current) {
      appliedRef.current = true;
      setConfig(next.host.config);
      const nextRunning = isRunning(next);
      const setUp =
        next.host.canRun || (next.workerModule.installed && next.workerModule.nodeModulesInstalled);
      setStep(nextRunning ? "earnings" : setUp ? "manage" : "intro");
    }
  }, []);

  const clearSetupTimer = React.useCallback(() => {
    if (setupTimerRef.current !== null) {
      window.clearInterval(setupTimerRef.current);
      setupTimerRef.current = null;
    }
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
  }, []);

  // Initial status load.
  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/hive-compute/marketplace${targetQuery}`, { cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json().catch(() => ({}))) as ApiResponse;
          if (!response.ok || data.ok === false || !data.status) {
            throw new Error(data.error || "Hive Compute status failed.");
          }
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
  }, [applyStatus, targetQuery]);

  // Cleanup timers on unmount.
  React.useEffect(() => () => clearSetupTimer(), [clearSetupTimer]);

  // Escape to close.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live uptime ticker while hosting on the earnings view.
  React.useEffect(() => {
    if (step !== "earnings" || !running) return undefined;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step, running]);

  const fetchStatus = React.useCallback(async () => {
    setBusy("refresh");
    setError("");
    try {
      const response = await fetch(`/api/hive-compute/marketplace${targetQuery}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || data.ok === false || !data.status) {
        throw new Error(data.error || "Hive Compute status failed.");
      }
      applyStatus(data.status);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Hive Compute status failed.");
    } finally {
      setBusy((current) => (current === "refresh" ? null : current));
    }
  }, [applyStatus, targetQuery]);

  const postAction = React.useCallback(
    async (action: Exclude<BusyAction, null | "refresh">, successMessage: string): Promise<boolean> => {
      setBusy(action);
      setError("");
      setMessage("");
      try {
        const response = await fetch("/api/hive-compute/marketplace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, config, target: targetBody }),
        });
        const data = (await response.json().catch(() => ({}))) as ApiResponse;
        if (!response.ok || data.ok === false || !data.status) {
          throw new Error(data.error || "Hive Compute action failed.");
        }
        applyStatus(data.status);
        setMessage(successMessage);
        return true;
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Hive Compute action failed.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [applyStatus, config, targetBody],
  );

  const startSetup = React.useCallback(async () => {
    clearSetupTimer();
    setStep("setup");
    setSetupProgress(0);
    setBusy("setup-hosting");
    setError("");
    setMessage("");
    setupTimerRef.current = window.setInterval(() => {
      setSetupProgress((p) => Math.min(3, p + 1));
    }, 660);
    try {
      const response = await fetch("/api/hive-compute/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup-hosting", config, target: targetBody }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || data.ok === false || !data.status) {
        throw new Error(data.error || "Hosting setup failed.");
      }
      clearSetupTimer();
      applyStatus(data.status);
      setSetupProgress(4);
      finishTimerRef.current = window.setTimeout(() => {
        setStep("manage");
        setBusy(null);
        setMessage("Hosting is set up. Advertise models and go live when ready.");
      }, 520);
    } catch (setupError) {
      clearSetupTimer();
      setError(setupError instanceof Error ? setupError.message : "Hosting setup failed.");
      setStep("intro");
      setBusy(null);
    }
  }, [applyStatus, clearSetupTimer, config, targetBody]);

  const patchConfig = React.useCallback((patch: Partial<HiveComputeHostRunConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  }, []);

  const availableModelIds = React.useMemo(
    () => status?.host.models.map((model) => model.providerModelId) ?? [],
    [status?.host.models],
  );
  const selectedModelIdSet = React.useMemo(
    () => new Set(config.selectedModelIds ?? availableModelIds),
    [availableModelIds, config.selectedModelIds],
  );

  const toggleModel = React.useCallback(
    (modelId: string) => {
      setConfig((current) => {
        const selected = new Set(current.selectedModelIds === null ? availableModelIds : current.selectedModelIds);
        if (selected.has(modelId)) selected.delete(modelId);
        else selected.add(modelId);
        const nextSelected = availableModelIds.filter((id) => selected.has(id));
        const enabled = Math.max(1, nextSelected.length);
        return {
          ...current,
          selectedModelIds: nextSelected,
          maxConcurrency: Math.min(Math.max(1, current.maxConcurrency), enabled),
        };
      });
    },
    [availableModelIds],
  );

  const enableAllModels = React.useCallback(() => {
    setConfig((current) => ({ ...current, selectedModelIds: null }));
  }, []);

  const advertisedModels = React.useMemo(
    () => (status?.host.models ?? []).filter((model) => selectedModelIdSet.has(model.providerModelId)),
    [status?.host.models, selectedModelIdSet],
  );
  const enabledCount = advertisedModels.length;
  const totalModels = status?.host.models.length ?? 0;
  const concMax = Math.max(1, enabledCount);
  const concurrency = Math.min(config.maxConcurrency, concMax);
  const earn = React.useMemo(() => computeEarnings(enabledCount, config.markdown), [enabledCount, config.markdown]);

  const runPrimary = React.useCallback(async () => {
    if (!status) return;
    if (running) {
      const ok = await postAction("stop-worker", "Hive Compute worker stopped.");
      if (ok) setStep("manage");
      return;
    }
    if (status.host.canRun) {
      const ok = await postAction("run-worker", "Hive Compute worker is live.");
      if (ok) setStep("earnings");
      return;
    }
    void startSetup();
  }, [postAction, running, startSetup, status]);

  const stopFromEarnings = React.useCallback(async () => {
    const ok = await postAction("stop-worker", "Hive Compute worker stopped.");
    if (ok) setStep("manage");
  }, [postAction]);

  const openMppSession = React.useCallback(() => {
    void postAction("open-mpp-session", "MPP machine-payment session opened.");
  }, [postAction]);

  const backHandler = React.useCallback(() => {
    clearSetupTimer();
    setStep("manage");
  }, [clearSetupTimer]);

  // ---- derived view flags ----
  const isSkeleton = status === null;
  // Manage is the root view for a set-up machine; Intro is only the pre-setup pitch and
  // must never be reachable afterwards (it would falsely read "not set up yet"). So the
  // only back affordance is Earnings → Manage.
  const showBack = step === "earnings";
  const meterOverride: MeterOverride =
    step === "intro"
      ? { mode: "empty" }
      : step === "setup"
        ? { mode: "setup", progress: setupProgress }
        : step === "earnings" && running
          ? { mode: "live" }
          : null;
  const stages = buildStages(status, meterOverride);
  const meterStatus = meterStatusFor(step, status);
  const setupBusy = busy === "setup-hosting";
  const primaryBusy = busy === "run-worker" || busy === "stop-worker" || busy === "setup-hosting";

  const primary = running
    ? { label: "Stop hosting", Icon: Pause }
    : status?.host.canRun
      ? { label: "Go live", Icon: Play }
      : { label: "Set up hosting", Icon: Download };

  const title =
    step === "intro"
      ? "Rent out your spare compute"
      : `Rent out ${machineName}`;
  const subtitle =
    step === "intro"
      ? `${machineName} earns from marketplace inference jobs whenever it’s idle — you set the price and the guardrails.`
      : step === "setup"
        ? "Hang tight — bringing each stage online."
        : step === "earnings"
          ? running
            ? `Live on the marketplace — here’s how ${machineName} is performing.`
            : `Projected earnings for ${machineName} at your current settings.`
          : "Advertise the models you want, tune pricing and guardrails, then go live.";

  const noticeTone: "live" | "error" | "honey" = error ? "error" : running ? "live" : "honey";
  const noticeText = error || message;

  const discoveredFrom = status?.host.discoveredFrom;
  const remoteDiscovery = Boolean(discoveredFrom?.remote);
  // Going live runs the worker on the dashboard host, so it can't rent out a
  // different fleet machine from here — discovery is read-only for remote targets.
  const primaryDisabled = Boolean(busy) || remoteDiscovery;

  const modelHost = (model: HiveComputeHostModel): { name: string; location?: string } | null => {
    if (!model.remote || !model.hostDeviceName) return null;
    return {
      name: model.hostDeviceName,
      location: model.hostLocation || resolveLinkHostLocation(model.hostDeviceName, machines),
    };
  };

  return (
    <div role="presentation" className={styles.backdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Hive Compute host setup for ${machineName}`}
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
      >
          <CloseIconButton
            type="button"
            title="Close"
            aria-label="Close Hive Compute host setup"
            onClick={onClose}
            className={styles.close}
          />

          <header className={styles.header}>
            {showBack ? (
              <button type="button" aria-label="Back" className={styles.back} onClick={backHandler}>
                <ChevronLeft size={17} aria-hidden="true" />
              </button>
            ) : null}
            <span className={styles.headerMark}>
              <Cpu size={24} aria-hidden="true" />
            </span>
            <div className={styles.headerText}>
              <span className={styles.kicker}>
                <Cpu size={13} aria-hidden="true" /> Hive Compute host
              </span>
              <h2 className={styles.title}>{title}</h2>
              <p className={styles.sub}>{subtitle}</p>
            </div>
          </header>

          {isSkeleton ? (
            <div className={styles.skeletonWrap} role="status" aria-label="Checking Hive Compute host setup">
              <div className={styles.skeleton} />
              <div className={styles.skeleton} />
              <div className={styles.skeleton} />
            </div>
          ) : (
            <div className={styles.body}>
              {/* ---------- readiness meter (local host only; a remote target
                   can't be gone-live from here, so its local readiness is moot) ---------- */}
              {!remoteDiscovery ? (
              <div className={styles.meter}>
                <div className={styles.meterHead}>
                  <span className={styles.meterKicker}>Readiness path</span>
                  <span className={styles.meterStatus} data-tone={meterStatus.tone} data-live={meterStatus.live}>
                    <span className={styles.meterDot} aria-hidden="true" />
                    {meterStatus.text}
                  </span>
                </div>
                <div className={styles.meterSegs}>
                  {stages.map((s) => (
                    <div key={s.key} className={styles.seg} data-status={s.status} data-energized={s.energized} />
                  ))}
                </div>
                <div className={styles.meterLabels}>
                  {stages.map((s) => {
                    const Icon = s.Icon;
                    return (
                      <div key={s.key} className={styles.stage} data-status={s.status} data-on={s.on}>
                        <span className={styles.stageIcon}>
                          <Icon size={18} aria-hidden="true" />
                        </span>
                        <span className={styles.stageName}>{s.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              ) : null}

              {remoteDiscovery ? (
                <p className={styles.remoteBanner} role="status">
                  <Link2 size={14} aria-hidden="true" />
                  <span>
                    Showing the models <b>{machineName}</b>
                    {discoveredFrom?.location ? ` · ${discoveredFrom.location}` : ""} can serve. Renting it out runs the
                    worker on that machine — open HivemindOS on {machineName} to go live there.
                  </span>
                </p>
              ) : null}

              {step === "setup" ? renderSetup() : null}
              {step === "intro" ? renderIntro() : null}
              {step === "manage" ? renderManage() : null}
              {step === "earnings" ? renderEarnings() : null}

              {noticeText ? (
                <p className={styles.notice} data-tone={noticeTone} role="status">
                  {noticeText}
                </p>
              ) : null}
            </div>
          )}
      </section>
    </div>
  );

  // ---------- intro ----------
  function renderIntro() {
    const introSteps = [
      { n: "1", Icon: Download, title: "Install the worker", desc: `Adds the worker and its dependencies to ${machineName}.` },
      { n: "2", Icon: Search, title: "Discover local models", desc: "Finds models in LM Studio or Ollama and prices them." },
      { n: "3", Icon: CreditCard, title: "Open a payment session", desc: "Starts a secure marketplace payment rail." },
    ];
    const trust = [
      { Icon: Lock, label: "Encrypted prompt delivery" },
      { Icon: ShieldCheck, label: "Sandboxed worker" },
      { Icon: Check, label: "You set the price" },
      { Icon: Pause, label: "Pause anytime" },
    ];
    const note =
      enabledCount === 0
        ? `Start LM Studio or Ollama on ${machineName} to price your models and estimate earnings. You can pause anytime.`
        : `Based on ${enabledCount} advertised model${enabledCount === 1 ? "" : "s"} priced ${config.markdown}% below list, at typical marketplace demand while ${machineName} is idle. You can pause anytime.`;
    return (
      <>
        <div className={styles.introEarn}>
          <div className={styles.introEarnMain}>
            <span className={styles.kicker}>
              <TrendingUp size={13} aria-hidden="true" /> Estimated earnings
            </span>
            <div className={styles.introEarnRow}>
              <span className={styles.introEarnBig}>{earn.monthStr}</span>
              <span className={styles.introEarnUnit}>/ month</span>
            </div>
            <span className={styles.introEarnDay}>{earn.dayStr} / day · while idle</span>
          </div>
          <p className={styles.introEarnNote}>{note}</p>
        </div>

        <div className={styles.introHow}>
          <span className={styles.kicker}>How it works</span>
          <div className={styles.introSteps}>
            {introSteps.map((s) => {
              const Icon = s.Icon;
              return (
                <div key={s.n} className={styles.introStep}>
                  <div className={styles.introStepHead}>
                    <span className={styles.introStepIcon}>
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <span className={styles.introStepNum}>Step {s.n}</span>
                  </div>
                  <span className={styles.introStepTitle}>{s.title}</span>
                  <span className={styles.introStepDesc}>{s.desc}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.introTrust}>
          {trust.map((t) => {
            const Icon = t.Icon;
            return (
              <span key={t.label} className={styles.trustPill}>
                <Icon size={12} aria-hidden="true" /> {t.label}
              </span>
            );
          })}
        </div>

        <div className={styles.introActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Maybe later
          </button>
          <button type="button" className={styles.btnPrimary} onClick={() => void startSetup()} disabled={Boolean(busy)}>
            {setupBusy ? <span className={styles.spinner} aria-hidden="true" /> : null}
            Set up hosting
            {setupBusy ? null : <ArrowRight size={15} aria-hidden="true" />}
          </button>
        </div>
      </>
    );
  }

  // ---------- setup ----------
  function renderSetup() {
    return (
      <div className={styles.setupCard}>
        <div>
          <h3 className={styles.setupTitle}>Setting up hosting…</h3>
          <p className={styles.setupSub}>
            Installing on {machineName} and saving safe defaults as each stage lights up.
          </p>
        </div>
        <div className={styles.setupTasks}>
          {SETUP_TASK_LABELS.map((label, i) => {
            const state = i < setupProgress ? "done" : i === setupProgress ? "active" : "pending";
            return (
              <div key={label} className={styles.setupTask} data-state={state}>
                <span className={styles.setupTaskNodeWrap}>
                  {state === "done" ? (
                    <span className={styles.setupNodeDone}>
                      <Check size={13} aria-hidden="true" />
                    </span>
                  ) : state === "active" ? (
                    <span className={styles.setupNodeActive} aria-hidden="true" />
                  ) : (
                    <span className={styles.setupNodePending} aria-hidden="true" />
                  )}
                </span>
                <span className={styles.setupTaskLabel}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- manage ----------
  function renderManage() {
    if (!status) return null;
    const nextTitle = running
      ? "This machine is live"
      : status.host.canRun
        ? "Ready to go live"
        : "Finish setup to go live";
    const nextLede = running
      ? "Energy is flowing end to end — jobs are being accepted and metered."
      : status.host.canRun
        ? "Advertise the models you want and tune pricing and guardrails, then go live when you’re ready."
        : status.host.message;
    return (
      <>
        {!remoteDiscovery ? (
          <div className={styles.nextCard}>
            <div className={styles.nextMain}>
              <span className={styles.cardKicker}>
                <Cpu size={13} aria-hidden="true" /> What happens next
              </span>
              <h3 className={styles.nextTitle}>{nextTitle}</h3>
            </div>
            <p className={styles.nextLede}>{nextLede}</p>
          </div>
        ) : null}

        <div className={styles.modelsCard}>
          <div className={styles.modelsHead}>
            <span className={styles.cardKicker}>
              <Package size={13} aria-hidden="true" /> Models advertised
            </span>
            <span className={styles.modelsEst}>
              <TrendingUp size={13} aria-hidden="true" />
              <b>{earn.monthStr}</b> / mo est.
            </span>
            <span className={styles.modelsCount}>
              {enabledCount} of {totalModels} advertised
              {enabledCount < totalModels ? (
                <button type="button" className={styles.enableAll} onClick={enableAllModels}>
                  <Check size={11} aria-hidden="true" /> Enable all
                </button>
              ) : null}
            </span>
          </div>
          {status.host.models.length ? (
            <div className={styles.modelChips} role="group" aria-label="Models to advertise through Hive Compute">
              {status.host.models.map((model) => {
                const active = selectedModelIdSet.has(model.providerModelId);
                const host = modelHost(model);
                return (
                  <button
                    key={model.providerModelId}
                    type="button"
                    className={styles.modelChip}
                    data-active={active}
                    data-remote={Boolean(host)}
                    aria-pressed={active}
                    onClick={() => toggleModel(model.providerModelId)}
                  >
                    <span className={styles.modelChipDot} aria-hidden="true" />
                    <span className={styles.modelChipText}>
                      <span>{model.name || model.id}</span>
                      <span className={styles.modelChipPrice}>
                        ${moneyMicro(model.inputPer1m)} / ${moneyMicro(model.outputPer1m)} per M
                      </span>
                      {host ? (
                        <span className={styles.modelChipHost}>
                          <Link2 size={9} aria-hidden="true" /> on {host.name}
                          {host.location ? ` · ${host.location}` : ""}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className={styles.modelsEmpty}>Start LM Studio or Ollama on {machineName}, then refresh.</p>
          )}
        </div>

        <section className={styles.card}>
          <span className={styles.cardKicker}>
            <Gauge size={13} aria-hidden="true" /> Hosting controls
          </span>
          <div className={styles.controlRows}>
            <div className={styles.sliderRow}>
              <span className={styles.sliderLabel}>Max concurrent jobs</span>
              <input
                type="range"
                className={styles.slider}
                min={1}
                max={concMax}
                step={1}
                value={concurrency}
                onChange={(event) =>
                  patchConfig({ maxConcurrency: Math.min(concMax, Math.max(1, Number(event.target.value))) })
                }
              />
              <b className={styles.sliderVal}>{concurrency}</b>
            </div>
            <div className={styles.sliderRow}>
              <span className={styles.sliderLabel}>List markdown</span>
              <input
                type="range"
                className={styles.slider}
                min={0}
                max={80}
                step={1}
                value={config.markdown}
                onChange={(event) => patchConfig({ markdown: Number(event.target.value) })}
              />
              <b className={styles.sliderVal}>{config.markdown}%</b>
            </div>
          </div>
          <div className={styles.controlDivider}>
            <div className={styles.segRow}>
              <span className={styles.segRowLabel}>Run hosting when</span>
              <div className={styles.segGroup} role="group" aria-label="Run hosting when">
                {HOST_WHEN_OPTIONS.map((option) => {
                  const Icon = option.Icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={styles.segBtn}
                      data-active={config.hostWhen === option.id}
                      onClick={() => patchConfig({ hostWhen: option.id })}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={styles.switchRow}>
              <div className={styles.switchItem}>
                <span className={styles.switchLabel}>
                  <BatteryCharging size={14} aria-hidden="true" /> Pause on battery
                </span>
                <button
                  type="button"
                  aria-label="Pause on battery"
                  aria-pressed={config.pauseOnBattery}
                  className={styles.switch}
                  data-on={config.pauseOnBattery}
                  onClick={() => patchConfig({ pauseOnBattery: !config.pauseOnBattery })}
                >
                  <span className={styles.switchKnob} aria-hidden="true" />
                </button>
              </div>
              <div className={styles.switchItem}>
                <span className={styles.switchLabel}>
                  <ShieldCheck size={14} aria-hidden="true" /> Yield to user activity
                </span>
                <button
                  type="button"
                  aria-label="Yield to user activity"
                  aria-pressed={config.yieldToUser}
                  className={styles.switch}
                  data-on={config.yieldToUser}
                  onClick={() => patchConfig({ yieldToUser: !config.yieldToUser })}
                >
                  <span className={styles.switchKnob} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {!remoteDiscovery ? (
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>Advanced diagnostics</summary>
            <div className={styles.detailsBody}>
              <div className={styles.detailRow}>
                <span className={styles.cardKicker}>
                  <ShieldCheck size={13} aria-hidden="true" /> Payments &amp; privacy
                </span>
                <span className={styles.detailPill}>
                  Privacy: {status.privacy.attestationReady && status.privacy.encryptedDeliveryReady ? "Verified enclave" : "Standard"}
                </span>
              </div>
              <p className={styles.detailText}>{status.payments.mpp.message}</p>
              <p className={styles.detailText}>{status.privacy.message}</p>
              <div className={styles.detailRow}>
                <span className={styles.detailPill}>
                  {status.payments.mpp.sessionToken.present
                    ? `MPP via ${status.payments.mpp.sessionToken.source || "environment"}`
                    : "MPP not open"}
                </span>
                <span className={styles.detailPill}>{status.privacy.mode}</span>
              </div>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={openMppSession}
                disabled={Boolean(busy) || !status.gateway.configured || !status.payments.mpp.enabled}
              >
                {busy === "open-mpp-session" ? <span className={styles.spinner} aria-hidden="true" /> : <Zap size={15} aria-hidden="true" />}
                Open MPP session
              </button>
            </div>
          </details>
        ) : null}

        {renderWorkerOutput()}

        <div className={styles.footer}>
          <div className={styles.footerBtns}>
            <button type="button" className={styles.btnSecondary} onClick={() => setStep("earnings")}>
              <TrendingUp size={13} aria-hidden="true" /> View earnings
            </button>
            <button type="button" className={styles.btnSecondary} onClick={() => void fetchStatus()} disabled={Boolean(busy)}>
              {busy === "refresh" ? <span className={styles.spinner} aria-hidden="true" /> : <RefreshCcw size={15} aria-hidden="true" />}
              Refresh
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void runPrimary()}
              disabled={primaryDisabled}
              title={remoteDiscovery ? `Open HivemindOS on ${machineName} to host it` : undefined}
            >
              {primaryBusy ? <span className={styles.spinner} aria-hidden="true" /> : <primary.Icon size={15} aria-hidden="true" />}
              {primary.label}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ---------- earnings ----------
  function renderEarnings() {
    if (!status) return null;
    const capacity = status.gateway.capacity;
    const perf = capacity?.modelPerformance ?? [];
    const measured = perf.filter((p) => p.samples > 0);
    const avgTps = measured.length
      ? measured.reduce((acc, p) => acc + p.tokensPerSecond, 0) / measured.length
      : null;
    const avgTtft = measured.length
      ? measured.reduce((acc, p) => acc + p.timeToFirstTokenMs, 0) / measured.length
      : null;
    const liveWorkers = capacity?.liveWorkers ?? 0;
    const pendingJobs = capacity?.pendingJobs ?? 0;
    const availableSlots = capacity?.availableSlots;
    const startedAt = status.host.run?.startedAt;
    const uptime = running && startedAt ? formatDuration(nowTick - startedAt) : "—";

    // Projected earnings per advertised model, weighted by price. Real inputs; labeled projection.
    const weights = advertisedModels.map((m) => m.inputPer1m + m.outputPer1m);
    const sumW = weights.reduce((a, b) => a + b, 0);
    const perModel = advertisedModels
      .map((m, i) => ({
        name: m.name || m.id,
        month: sumW > 0 ? (weights[i] / sumW) * earn.monthMid : 0,
      }))
      .sort((a, b) => a.month - b.month);
    const barMax = perModel.reduce((max, m) => Math.max(max, m.month), 0);
    const topModels = [...perModel].sort((a, b) => b.month - a.month).slice(0, 4);
    const topMax = topModels.reduce((max, m) => Math.max(max, m.month), 0);

    const statCards = [
      { kicker: "Session", value: uptime, sub: running ? "hosting now" : "idle", honey: false },
      {
        kicker: "Live workers",
        value: String(liveWorkers),
        sub: availableSlots != null ? `${availableSlots} slots free` : "on the gateway",
        honey: false,
      },
      { kicker: "Queue", value: String(pendingJobs), sub: "pending jobs", honey: false },
      { kicker: "Projected / mo", value: earn.monthStr, sub: `≈ ${earn.dayStr} / day`, honey: true },
    ];

    const perfStats = [
      { label: "Live workers", value: String(liveWorkers) },
      { label: "Pending jobs", value: String(pendingJobs) },
      { label: "Avg speed", value: avgTps != null ? `${avgTps.toFixed(0)} tok/s` : "—" },
      { label: "Avg first token", value: avgTtft != null ? `${avgTtft.toFixed(0)} ms` : "—" },
    ];

    return (
      <>
        <div className={styles.statGrid}>
          {statCards.map((card) => (
            <div key={card.kicker} className={`${styles.statCard} ${card.honey ? styles.statCardHoney : ""}`}>
              <span className={styles.statKicker}>{card.kicker}</span>
              <b className={styles.statVal}>{card.value}</b>
              <span className={styles.statSub}>{card.sub}</span>
            </div>
          ))}
        </div>

        <div className={styles.chartCard}>
          <div className={styles.chartHead}>
            <span className={styles.cardKicker}>
              <TrendingUp size={13} aria-hidden="true" /> Projected earnings by advertised model
            </span>
            <span className={styles.chartTotal}>{earn.monthStr} / mo projected</span>
          </div>
          {perModel.length ? (
            <>
              <div className={styles.chartBars}>
                {perModel.map((m, i) => (
                  <div key={`${m.name}-${i}`} className={styles.chartBarSlot} title={`${m.name}: ${money(m.month)} / mo`}>
                    <div
                      className={styles.chartBar}
                      data-peak={i === perModel.length - 1}
                      style={{ height: `${barMax > 0 ? Math.max(6, Math.round((m.month / barMax) * 100)) : 6}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className={styles.chartAxis}>
                <span>Lowest priced</span>
                <span>Highest priced</span>
              </div>
            </>
          ) : (
            <p className={styles.chartEmpty}>Advertise at least one model to project earnings.</p>
          )}
        </div>

        <div className={styles.earnCols}>
          <section className={styles.card}>
            <span className={styles.cardKicker}>
              <Gauge size={13} aria-hidden="true" /> Live performance
            </span>
            <div className={styles.perfRows}>
              {perfStats.map((stat) => (
                <div key={stat.label} className={styles.perfRow}>
                  <span className={styles.perfLabel}>{stat.label}</span>
                  <b className={styles.perfVal}>{stat.value}</b>
                </div>
              ))}
            </div>
          </section>
          <section className={styles.card}>
            <span className={styles.cardKicker}>
              <CreditCard size={13} aria-hidden="true" /> Top advertised · projected / mo
            </span>
            {topModels.length ? (
              <div className={styles.topList}>
                {topModels.map((m, i) => (
                  <div key={`${m.name}-${i}`} className={styles.topItem}>
                    <div className={styles.topRow}>
                      <span className={styles.topName}>{m.name}</span>
                      <b className={styles.topAmount}>{money(m.month)}</b>
                    </div>
                    <div className={styles.topBarTrack}>
                      <div className={styles.topBar} style={{ width: `${topMax > 0 ? Math.round((m.month / topMax) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.modelsEmpty}>No advertised models yet.</p>
            )}
          </section>
        </div>

        {renderWorkerOutput()}

        <div className={`${styles.footer} ${styles.footerSpread}`}>
          <span className={styles.footerNote}>
            {running ? `Hosting for ${uptime} · guardrails saved on go-live` : "Not currently hosting · projections shown"}
          </span>
          <div className={styles.footerBtns}>
            <button type="button" className={styles.btnSecondary} onClick={() => setStep("manage")}>
              <Gauge size={13} aria-hidden="true" /> Adjust settings
            </button>
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => void stopFromEarnings()}
              disabled={Boolean(busy) || !running}
            >
              {busy === "stop-worker" ? <span className={styles.spinner} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
              Stop hosting
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderWorkerOutput() {
    const output = status?.host.run?.output;
    if (!output) return null;
    const tail = output.split(/\r?\n/).slice(-8).join("\n").trim();
    if (!tail) return null;
    return (
      <div className={styles.outputCard}>
        <span className={styles.cardKicker}>
          <Cpu size={13} aria-hidden="true" /> Worker output
        </span>
        <pre className={styles.outputMono}>{tail}</pre>
      </div>
    );
  }
}
