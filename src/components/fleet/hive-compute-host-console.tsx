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

import type { FleetMachine } from "@/components/fleet/fleet-data";
import {
  isHiveComputeBenchmarkProxyTimeout,
  waitForHiveComputeBenchmarkCompletion,
} from "@/components/fleet/hive-compute-benchmark-recovery";
import { concurrencyAfterAdvertisedModelChange } from "@/components/fleet/hive-compute-concurrency";
import {
  hiveComputePriceDraftKey,
  parseHiveComputePriceDraft,
  type HiveComputePriceField,
} from "@/components/fleet/hive-compute-price-draft";
import { HiveComputeHostEarningsView, money } from "@/components/fleet/hive-compute-host-earnings";
import { resolveLinkHostLocation } from "@/components/fleet/hive-compute-host-location";
import { formatGigabytes, hiveComputeMemoryFit } from "@/components/fleet/hive-compute-memory-fit";
import { HiveComputeRemoteHostControls } from "@/components/fleet/hive-compute-remote-host";
import type {
  HiveComputeHostModel,
  HiveComputeHostRunConfig,
  HiveComputeHostWhen,
  HiveComputeMarketplaceStatus,
} from "@/lib/types/hive-compute-marketplace";
import {
  HIVE_COMPUTE_PROVIDER_PRICE_BOUNDS,
  estimateHiveComputeEarnings,
  hiveComputeAvailabilityFactor,
  isHiveComputeBenchmarkCurrent,
  resolveHiveComputeModelPrice,
} from "@/lib/services/hive-compute-pricing";
import styles from "./hive-compute-host-modal.module.css";

type ApiResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  status?: HiveComputeMarketplaceStatus;
};

type BusyAction = "refresh" | "setup-hosting" | "benchmark-pricing" | "run-worker" | "stop-worker" | "open-mpp-session" | "start-lmstudio" | null;
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

// One label per real setup stage — the meter advances only when the stage's
// API call actually completes.
const SETUP_TASK_LABELS = [
  "Install the worker module",
  "Install worker dependencies",
  "Check gateway & worker token",
  "Benchmark and price models",
];

function isRunning(status: HiveComputeMarketplaceStatus | null): boolean {
  return status?.host.run?.status === "running" || status?.host.run?.status === "starting";
}

function moneyMicro(value: number): string {
  const dollars = value / 1_000_000;
  return dollars.toFixed(dollars > 0 && dollars < 0.01 ? 4 : 2);
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

/**
 * Shared Hive Compute host UI — the readiness meter plus the intro / setup /
 * manage / earnings flow. Rendered both inside the fleet {@link HiveComputeHostModal}
 * (per-machine) and by the dashboard Hive Compute route (self, no machine).
 *
 * Renders content only (a header + body fragment). The surrounding chrome —
 * backdrop, dialog role, close button, page shell — belongs to the caller,
 * which also supplies the `styles.tokens`/`styles.surface` wrapper.
 *
 * `machine` omitted ⇒ target this machine (the route's "self" case). `onClose`
 * omitted ⇒ no dismiss affordance (the route can't close to anywhere).
 */
export function HiveComputeHostConsole({
  machine,
  machines,
  onClose,
}: {
  machine?: FleetMachine;
  machines?: FleetMachine[];
  onClose?: () => void;
}) {
  const [status, setStatus] = React.useState<HiveComputeMarketplaceStatus | null>(null);
  const [busy, setBusy] = React.useState<BusyAction>("refresh");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [step, setStep] = React.useState<Step>("intro");
  const [setupProgress, setSetupProgress] = React.useState(0);
  const [setupDetail, setSetupDetail] = React.useState("");
  const [nowTick, setNowTick] = React.useState(() => Date.now());
  const [priceDrafts, setPriceDrafts] = React.useState<Record<string, string>>({});
  const [config, setConfig] = React.useState<HiveComputeHostRunConfig>({
    pricingStrategy: "balanced",
    targetHourlyUsd: 1,
    modelPrices: {},
    modelBenchmarks: {},
    maxConcurrency: 1,
    selectedModelIds: null,
    hostWhen: "idle",
    schedule: null,
    dailyCapUsd: null,
    pauseOnBattery: true,
    yieldToUser: true,
  });

  const appliedRef = React.useRef(false);
  const finishTimerRef = React.useRef<number | null>(null);
  // JSON of the config as the server last knew it — the auto-save effect only
  // fires when the local config actually drifts from this.
  const persistedConfigRef = React.useRef("");

  const setConfigFromServer = React.useCallback((next: HiveComputeHostRunConfig) => {
    persistedConfigRef.current = JSON.stringify(next);
    setConfig(next);
  }, []);

  const machineName = machine?.name || "this machine";
  const running = isRunning(status);

  // Which machine's models to discover. A "This …" display name or a direct
  // loopback collector means the dashboard host itself. A linkd peer-proxy URL
  // (http://127.0.0.1:8788/peer/<ip>:<port>) is loopback-hosted but reaches a
  // REMOTE machine, so it must NOT count as self. No machine at all (the route)
  // targets self as well — the API defaults to this machine when unqualified.
  const targetCollectorUrl = (machine?.collectorUrl || "").trim();
  const isPeerProxyCollector = /\/peer\//i.test(targetCollectorUrl);
  const isSelfMachine =
    !machine ||
    /^this\b/i.test((machine.name || "").trim()) ||
    (!!targetCollectorUrl &&
      !isPeerProxyCollector &&
      /^https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)(:|\/|$)/i.test(targetCollectorUrl));

  // Prefer the human city label ("New York relay") over the generic location
  // bucket ("Tailscale relay") when attributing where a machine's models run.
  const targetLocation = (machine?.city || machine?.location || "").trim();
  const targetMachineName = machine?.name ?? "";

  const targetQuery = React.useMemo(() => {
    const params = new URLSearchParams();
    if (targetCollectorUrl) params.set("targetCollectorUrl", targetCollectorUrl);
    if (targetMachineName) params.set("targetMachineName", targetMachineName);
    if (targetLocation) params.set("targetLocation", targetLocation);
    if (isSelfMachine) params.set("targetSelf", "1");
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [targetCollectorUrl, targetMachineName, targetLocation, isSelfMachine]);

  const targetBody = React.useMemo(
    () => ({
      ...(targetCollectorUrl ? { collectorUrl: targetCollectorUrl } : {}),
      ...(targetMachineName ? { machineName: targetMachineName } : {}),
      ...(targetLocation ? { location: targetLocation } : {}),
      isSelf: isSelfMachine,
    }),
    [targetCollectorUrl, targetMachineName, targetLocation, isSelfMachine],
  );

  const applyStatus = React.useCallback((next: HiveComputeMarketplaceStatus) => {
    setStatus(next);
    if (!appliedRef.current) {
      appliedRef.current = true;
      setConfigFromServer(next.host.config);
      const nextRunning = isRunning(next);
      const setUp =
        next.host.canRun || (next.workerModule.installed && next.workerModule.nodeModulesInstalled);
      setStep(nextRunning ? "earnings" : setUp ? "manage" : "intro");
    }
  }, [setConfigFromServer]);

  const clearSetupTimer = React.useCallback(() => {
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

  // Live uptime ticker while hosting on the earnings view.
  React.useEffect(() => {
    if (step !== "earnings" || !running) return undefined;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step, running]);

  // Debounce-save config edits (guardrails, selection, pricing) so closing the
  // panel doesn't lose them; actions persist too, this covers edit-then-close.
  React.useEffect(() => {
    if (!appliedRef.current || step === "intro" || step === "setup") return undefined;
    const serialized = JSON.stringify(config);
    if (serialized === persistedConfigRef.current) return undefined;
    const timer = window.setTimeout(() => {
      persistedConfigRef.current = serialized;
      void fetch("/api/hive-compute/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-config", config, target: targetBody }),
      }).catch(() => {
        // Best-effort: the next action or go-live persists the same config.
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [config, step, targetBody]);

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

  // Raw marketplace POST with an explicit config (multi-step sequences thread
  // the latest server config through instead of relying on React state).
  const postMarketplaceWith = React.useCallback(
    async (postConfig: HiveComputeHostRunConfig | null, body: Record<string, unknown>) => {
      const response = await fetch("/api/hive-compute/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...(postConfig ? { config: postConfig } : {}), target: targetBody }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      return { response, data };
    },
    [targetBody],
  );

  const expectOkStatus = React.useCallback((result: { response: Response; data: ApiResponse }) => {
    if (!result.response.ok || result.data.ok === false || !result.data.status) {
      throw new Error(result.data.error || "Hive Compute action failed.");
    }
    return result.data.status;
  }, []);

  const fetchStatusOnce = React.useCallback(async () => {
    const response = await fetch(`/api/hive-compute/marketplace${targetQuery}`, { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as ApiResponse;
    if (!response.ok || data.ok === false || !data.status) {
      throw new Error(data.error || "Hive Compute status failed.");
    }
    return data.status;
  }, [targetQuery]);

  const postAction = React.useCallback(
    async (action: Exclude<BusyAction, null | "refresh">, successMessage: string): Promise<boolean> => {
      setBusy(action);
      setError("");
      setMessage("");
      try {
        const nextStatus = expectOkStatus(await postMarketplaceWith(config, { action }));
        applyStatus(nextStatus);
        setConfigFromServer(nextStatus.host.config);
        setMessage(successMessage);
        return true;
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Hive Compute action failed.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [applyStatus, config, expectOkStatus, postMarketplaceWith, setConfigFromServer],
  );

  // Benchmark models one request at a time so progress is real and a dev-proxy
  // timeout only re-waits the single model that is still measuring.
  const benchmarkModelsSequentially = React.useCallback(
    async (
      modelIds: string[],
      startConfig: HiveComputeHostRunConfig,
      onProgress: (done: number, total: number, modelId: string) => void,
    ): Promise<HiveComputeMarketplaceStatus | null> => {
      let workingConfig = startConfig;
      let lastStatus: HiveComputeMarketplaceStatus | null = null;
      for (let index = 0; index < modelIds.length; index += 1) {
        const modelId = modelIds[index];
        onProgress(index, modelIds.length, modelId);
        const startedAt = Date.now();
        const { response, data } = await postMarketplaceWith(workingConfig, {
          action: "benchmark-pricing",
          models: [modelId],
        });
        if (isHiveComputeBenchmarkProxyTimeout(data)) {
          lastStatus = await waitForHiveComputeBenchmarkCompletion({
            poll: fetchStatusOnce,
            isComplete: (nextStatus) => {
              // Complete when this model has a fresh measurement — or when the
              // run recorded it as a failure and excluded it.
              const failed = nextStatus.host.lastBenchmark?.failures.some((failure) => failure.modelId === modelId);
              if (failed && Date.parse(nextStatus.host.lastBenchmark?.at ?? "") >= startedAt) return true;
              const benchmark = nextStatus.host.config.modelBenchmarks[modelId];
              return isHiveComputeBenchmarkCurrent(benchmark) && Date.parse(benchmark.measuredAt) >= startedAt;
            },
          });
        } else if (!response.ok || data.ok === false || !data.status) {
          throw new Error(data.error || `Benchmark failed for ${modelId}.`);
        } else {
          lastStatus = data.status;
        }
        if (lastStatus) workingConfig = lastStatus.host.config;
      }
      if (lastStatus) {
        applyStatus(lastStatus);
        setConfigFromServer(lastStatus.host.config);
      }
      return lastStatus;
    },
    [applyStatus, fetchStatusOnce, postMarketplaceWith, setConfigFromServer],
  );

  const selectedOrAllModelIds = React.useCallback(
    (fromStatus: HiveComputeMarketplaceStatus | null) =>
      config.selectedModelIds ?? (fromStatus?.host.models ?? []).map((model) => model.providerModelId),
    [config.selectedModelIds],
  );

  // Opening the LM Studio app does not start its HTTP server, so the models it
  // holds stay invisible until `lms server start` runs on the host machine.
  const startLmStudio = React.useCallback(async () => {
    await postAction("start-lmstudio", "LM Studio server started.");
  }, [postAction]);

  // Setup runs each stage for real — the progress meter advances when a stage
  // actually completes (no timer-faked progress), and the benchmark stage
  // reports which model is measuring, N of M.
  const startSetup = React.useCallback(async () => {
    clearSetupTimer();
    setStep("setup");
    setSetupProgress(0);
    setSetupDetail("");
    setBusy("setup-hosting");
    setError("");
    setMessage("");
    let moduleInstalled = status?.workerModule.installed ?? false;
    try {
      expectOkStatus(await postMarketplaceWith(null, { action: "install-worker" }));
      moduleInstalled = true;
      setSetupProgress(1);
      expectOkStatus(await postMarketplaceWith(null, { action: "install-worker-deps" }));
      setSetupProgress(2);
      const fresh = await fetchStatusOnce();
      applyStatus(fresh);
      setSetupProgress(3);
      const ids = selectedOrAllModelIds(fresh);
      if (ids.length) {
        await benchmarkModelsSequentially(ids, fresh.host.config, (done, total, modelId) => {
          setSetupDetail(`${modelId} · ${done + 1} of ${total}`);
        });
      }
      setSetupDetail("");
      // Finalize with the server's saved config (persisted by the benchmark
      // loop): re-checks readiness and opens an MPP session when available.
      const finalStatus = expectOkStatus(await postMarketplaceWith(null, { action: "setup-hosting" }));
      applyStatus(finalStatus);
      setConfigFromServer(finalStatus.host.config);
      setSetupProgress(4);
      finishTimerRef.current = window.setTimeout(() => {
        setStep("manage");
        setBusy(null);
        setMessage("Hosting is set up. Advertise models and go live when ready.");
      }, 520);
    } catch (setupError) {
      clearSetupTimer();
      setSetupDetail("");
      setError(setupError instanceof Error ? setupError.message : "Hosting setup failed.");
      // Once the module is installed, Manage (with its readiness meter) is the
      // honest place to land — bouncing to the intro would read "not set up".
      setStep(moduleInstalled ? "manage" : "intro");
      setBusy(null);
    }
  }, [applyStatus, benchmarkModelsSequentially, clearSetupTimer, expectOkStatus, fetchStatusOnce, postMarketplaceWith, selectedOrAllModelIds, setConfigFromServer, status?.workerModule.installed]);

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
        const previousEnabledCount = selected.size;
        if (selected.has(modelId)) selected.delete(modelId);
        else selected.add(modelId);
        const nextSelected = availableModelIds.filter((id) => selected.has(id));
        return {
          ...current,
          selectedModelIds: nextSelected,
          maxConcurrency: concurrencyAfterAdvertisedModelChange(
            current.maxConcurrency,
            previousEnabledCount,
            nextSelected.length,
          ),
        };
      });
    },
    [availableModelIds],
  );

  const enableAllModels = React.useCallback(() => {
    setConfig((current) => ({
      ...current,
      selectedModelIds: null,
      maxConcurrency: concurrencyAfterAdvertisedModelChange(
        current.maxConcurrency,
        current.selectedModelIds?.length ?? availableModelIds.length,
        availableModelIds.length,
      ),
    }));
  }, [availableModelIds]);

  const advertisedModels = React.useMemo(
    () => (status?.host.models ?? []).filter((model) => selectedModelIdSet.has(model.providerModelId)),
    [status?.host.models, selectedModelIdSet],
  );
  const pricedAdvertisedModels = React.useMemo(
    () => advertisedModels.map((model) => ({
      model,
      price: resolveHiveComputeModelPrice(model.providerModelId, config),
      benchmark: isHiveComputeBenchmarkCurrent(config.modelBenchmarks[model.providerModelId])
        ? config.modelBenchmarks[model.providerModelId]
        : undefined,
    })),
    [advertisedModels, config],
  );
  const benchmarkedCount = pricedAdvertisedModels.filter((entry) => entry.benchmark).length;
  const providerPriceBounds = status?.gateway.capacity?.pricing?.providerBounds ?? HIVE_COMPUTE_PROVIDER_PRICE_BOUNDS;
  const enabledCount = advertisedModels.length;
  const pricingReady = enabledCount > 0 && benchmarkedCount === enabledCount;
  const totalModels = status?.host.models.length ?? 0;
  const concMax = Math.max(1, enabledCount);
  const concurrency = Math.min(config.maxConcurrency, concMax);
  const platformFeeBps = status?.gateway.capacity?.pricing?.platformFeeBps ?? 2_000;
  const earningEstimate = React.useMemo(() => estimateHiveComputeEarnings({
    models: pricedAdvertisedModels,
    maxConcurrency: concurrency,
    fallbackTargetHourlyUsd: 1,
    platformFeeBps,
    availabilityFactor: hiveComputeAvailabilityFactor(config.hostWhen, config.schedule),
  }), [concurrency, config.hostWhen, config.schedule, platformFeeBps, pricedAdvertisedModels]);
  const earn = React.useMemo(() => ({
    monthMid: (earningEstimate.monthLowUsd + earningEstimate.monthHighUsd) / 2,
    dayStr: `${money(earningEstimate.dayLowUsd)}–${money(earningEstimate.dayHighUsd)}`,
    monthStr: `${money(earningEstimate.monthLowUsd)}–${money(earningEstimate.monthHighUsd)}`,
    activeHourStr: `${money(earningEstimate.activeHourlyUsd)} / active hr`,
  }), [earningEstimate]);

  const patchModelPrice = React.useCallback((modelId: string, field: HiveComputePriceField, dollars: number) => {
    const current = resolveHiveComputeModelPrice(modelId, config);
    const bounds = providerPriceBounds[field];
    const usdMicro = Math.min(bounds.max, Math.max(bounds.min, Math.round((Number.isFinite(dollars) ? dollars : 0) * 1_000_000)));
    setConfig((previous) => ({
      ...previous,
      pricingStrategy: "custom",
      modelPrices: {
        ...previous.modelPrices,
        [modelId]: {
          inputUsdMicroPerMTok: current.inputUsdMicroPerMTok,
          outputUsdMicroPerMTok: current.outputUsdMicroPerMTok,
          minimumJobUsdMicro: current.minimumJobUsdMicro,
          [field]: usdMicro,
        },
      },
    }));
  }, [config, providerPriceBounds]);

  const commitModelPriceDraft = React.useCallback((modelId: string, field: HiveComputePriceField, rawValue: string) => {
    const bounds = providerPriceBounds[field];
    const dollars = parseHiveComputePriceDraft(rawValue, {
      min: bounds.min / 1_000_000,
      max: bounds.max / 1_000_000,
    });
    if (dollars !== null) patchModelPrice(modelId, field, dollars);
    const draftKey = hiveComputePriceDraftKey(modelId, field);
    setPriceDrafts((current) => {
      const next = { ...current };
      delete next[draftKey];
      return next;
    });
  }, [patchModelPrice, providerPriceBounds]);

  // Full benchmark pass, one model per request, with live progress in the
  // notice line. Success message differs between first-run and refresh.
  const runBenchmarkFlow = React.useCallback(async (successMessage: string): Promise<boolean> => {
    if (!status) return false;
    setBusy("benchmark-pricing");
    setError("");
    setMessage("");
    try {
      const ids = selectedOrAllModelIds(status);
      if (!ids.length) throw new Error("Advertise at least one model before benchmarking.");
      await benchmarkModelsSequentially(ids, config, (done, total, modelId) => {
        setMessage(`Benchmarking ${modelId} · ${done + 1} of ${total}…`);
      });
      setMessage(successMessage);
      return true;
    } catch (benchmarkError) {
      setError(benchmarkError instanceof Error ? benchmarkError.message : "Benchmark failed.");
      return false;
    } finally {
      setBusy(null);
    }
  }, [benchmarkModelsSequentially, config, selectedOrAllModelIds, status]);

  const runPrimary = React.useCallback(async () => {
    if (!status) return;
    if (running) {
      const ok = await postAction("stop-worker", "Hive Compute worker stopped.");
      if (ok) setStep("manage");
      return;
    }
    if (!pricingReady && enabledCount > 0) {
      await runBenchmarkFlow("Models benchmarked. Below-market Automatic prices are ready to review.");
      return;
    }
    if (status.host.canRun) {
      const ok = await postAction("run-worker", "Hive Compute worker is live.");
      if (ok) setStep("earnings");
      return;
    }
    void startSetup();
  }, [enabledCount, postAction, pricingReady, runBenchmarkFlow, running, startSetup, status]);

  const stopFromEarnings = React.useCallback(async () => {
    const ok = await postAction("stop-worker", "Hive Compute worker stopped.");
    if (ok) setStep("manage");
  }, [postAction]);

  const openMppSession = React.useCallback(() => {
    void postAction("open-mpp-session", "MPP machine-payment session opened.");
  }, [postAction]);

  const benchmarkPricing = React.useCallback(() => {
    void runBenchmarkFlow("Benchmark refreshed. Automatic prices remain below the market reference.");
  }, [runBenchmarkFlow]);

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
  const primaryBusy = busy === "run-worker" || busy === "stop-worker" || busy === "setup-hosting" || busy === "benchmark-pricing";

  const primary = running
    ? { label: "Stop hosting", Icon: Pause }
    : !pricingReady && enabledCount > 0
      ? { label: "Benchmark models", Icon: Gauge }
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

  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };

  const setHostWhen = (id: HiveComputeHostWhen) => {
    patchConfig({
      hostWhen: id,
      // Picking Scheduled without a saved window seeds a sensible overnight one.
      ...(id === "sched" && !config.schedule ? { schedule: { startHour: 22, endHour: 8 } } : {}),
    });
  };

  const benchmarkFailures = status?.host.lastBenchmark?.failures ?? [];
  const memoryFit = hiveComputeMemoryFit(advertisedModels, concurrency, status?.host.machineMemoryBytes);

  return (
    <>
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
                {discoveredFrom?.location ? ` · ${discoveredFrom.location}` : ""} can serve. Remote quick-host below runs
                the worker on that machine over Hivemind Link; exact pricing setup still lives on {machineName}&rsquo;s own
                HivemindOS.
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
    </>
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
        : pricingReady
          ? `Based on the ${concurrency} highest-earning advertised model slot${concurrency === 1 ? "" : "s"}, measured speed, and 10–30% marketplace utilization while ${machineName} is available. ${earn.activeHourStr} at full use.`
          : `Benchmark the selected models on ${machineName} before reviewing prices or projected earnings.`;
    return (
      <>
        <div className={styles.introEarn}>
          <div className={styles.introEarnMain}>
            <span className={styles.kicker}>
              <TrendingUp size={13} aria-hidden="true" /> Estimated provider earnings
            </span>
            <div className={styles.introEarnRow}>
              <span className={styles.introEarnBig}>{pricingReady ? earn.monthStr : "Not estimated"}</span>
              {pricingReady ? <span className={styles.introEarnUnit}>/ month</span> : null}
            </div>
            <span className={styles.introEarnDay}>
              {pricingReady ? `${earn.dayStr} / day · while idle` : "Available after model benchmarking"}
            </span>
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
          {onClose ? (
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Maybe later
            </button>
          ) : null}
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
            const detail = state === "active" && setupDetail ? ` — ${setupDetail}` : "";
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
                <span className={styles.setupTaskLabel}>{label}{detail}</span>
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
      : !pricingReady
        ? "Benchmark selected models"
      : status.host.canRun
        ? "Ready to go live"
        : "Finish setup to go live";
    const nextLede = running
      ? "Energy is flowing end to end — jobs are being accepted and metered."
      : !pricingReady
        ? "Measure real prompt and output speed first. Prices and earnings appear after measurement."
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

        {remoteDiscovery ? (
          <HiveComputeRemoteHostControls
            machineName={machineName}
            targetBody={targetBody}
            modelCount={status.host.models.length}
          />
        ) : null}

        {benchmarkFailures.length ? (
          <p
            className={styles.notice}
            data-tone="error"
            role="status"
            title={benchmarkFailures.map((failure) => `${failure.modelId}: ${failure.message}`).join("\n")}
          >
            {benchmarkFailures.length === 1
              ? `${benchmarkFailures[0].modelId} failed its benchmark (${benchmarkFailures[0].message}) and was excluded from advertising. Fix the local backend and rebenchmark to retry.`
              : `${benchmarkFailures.length} models failed their benchmark and were excluded from advertising: ${benchmarkFailures.map((failure) => failure.modelId).join(", ")}. Fix the local backend and rebenchmark to retry.`}
          </p>
        ) : null}

        <div className={styles.modelsCard}>
          <div className={styles.modelsHead}>
            <span className={styles.cardKicker}>
              <Package size={13} aria-hidden="true" /> Models advertised
            </span>
            <span className={styles.modelsEst}>
              <TrendingUp size={13} aria-hidden="true" />
              {pricingReady ? <><b>{earn.monthStr}</b> / mo net est.</> : <b>Benchmark to estimate</b>}
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
                const price = resolveHiveComputeModelPrice(model.providerModelId, config);
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
                      <span className={styles.modelChipPrice} data-unpriced={price.source === "starter"}>
                        {price.source === "starter"
                          ? "Not priced yet"
                          : `$${moneyMicro(price.inputUsdMicroPerMTok)} in · $${moneyMicro(price.outputUsdMicroPerMTok)} out / M${price.minimumJobUsdMicro ? ` · $${moneyMicro(price.minimumJobUsdMicro)} min` : ""}`}
                      </span>
                      <span className={styles.modelChipPricingSource} data-source={price.source}>
                        {price.source === "benchmark" ? "Automatic · below market" : price.source === "custom" ? "Custom ask" : "Benchmark required"}
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
            <div className={styles.modelsEmptyRow}>
              <p className={styles.modelsEmpty}>
                {isSelfMachine
                  ? "No models yet. Opening the LM Studio app does not start its local server — start it here to advertise your models."
                  : `Start LM Studio or Ollama on ${machineName}, then refresh.`}
              </p>
              {isSelfMachine ? (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => void startLmStudio()}
                  disabled={Boolean(busy)}
                >
                  {busy === "start-lmstudio"
                    ? <span className={styles.spinner} aria-hidden="true" />
                    : <Play size={14} aria-hidden="true" />}
                  Start LM Studio server
                </button>
              ) : null}
            </div>
          )}
        </div>

        <section className={styles.card}>
          <span className={styles.cardKicker}>
            <Gauge size={13} aria-hidden="true" /> Hosting controls
          </span>
          <div className={styles.controlRows}>
            <div className={styles.sliderRow}>
              <span className={styles.sliderLabel}>Max concurrent jobs</span>
              {/* A range with min === max has no travel, and browsers park the
                  thumb at the far left — which reads as 0 when the value is 1.
                  With a single possible slot, render a disabled full slider
                  (min 0 is display-only; the change handler still floors at 1). */}
              <input
                type="range"
                className={styles.slider}
                min={concMax <= 1 ? 0 : 1}
                max={concMax}
                step={1}
                value={concurrency}
                disabled={concMax <= 1}
                title={concMax <= 1 ? "Advertise more models to add concurrent job slots" : undefined}
                onChange={(event) =>
                  patchConfig({ maxConcurrency: Math.min(concMax, Math.max(1, Number(event.target.value))) })
                }
              />
              <b className={styles.sliderVal}>{enabledCount > 0 ? <>{concurrency}/{enabledCount}</> : "0/0"}</b>
            </div>
            {memoryFit && !memoryFit.fits ? (
              <p className={styles.pricingHint} role="status">
                Tight fit: the {memoryFit.models.length === 1 ? "largest advertised model needs" : `${memoryFit.models.length} largest advertised models need`} about{" "}
                {formatGigabytes(memoryFit.totalBytes)} of weights at {concurrency} concurrent slot{concurrency === 1 ? "" : "s"}, and this
                machine has {formatGigabytes(memoryFit.machineMemoryBytes)} of memory total. Jobs may swap or fail — advertise smaller
                models or lower the slot count.
              </p>
            ) : null}
            {pricingReady ? (
              <>
                <div className={styles.pricingHeadRow}>
                  <div>
                    <span className={styles.sliderLabel}>Pricing</span>
                    <span className={styles.pricingHint}>All {enabledCount} advertised models measured</span>
                  </div>
                  {!remoteDiscovery ? (
                    <button type="button" className={styles.btnSecondary} onClick={benchmarkPricing} disabled={Boolean(busy)}>
                      {busy === "benchmark-pricing" ? <span className={styles.spinner} aria-hidden="true" /> : <Gauge size={14} aria-hidden="true" />}
                      Rebenchmark
                    </button>
                  ) : null}
                </div>
                <div className={styles.strategyGroup} role="group" aria-label="Pricing mode">
                  <button
                    type="button"
                    className={styles.strategyBtn}
                    data-active={config.pricingStrategy !== "custom"}
                    aria-pressed={config.pricingStrategy !== "custom"}
                    onClick={() => patchConfig({ pricingStrategy: "balanced", targetHourlyUsd: 1 })}
                    disabled={remoteDiscovery}
                  >
                    Automatic
                  </button>
                  <button
                    type="button"
                    className={styles.strategyBtn}
                    data-active={config.pricingStrategy === "custom"}
                    aria-pressed={config.pricingStrategy === "custom"}
                    onClick={() => patchConfig({ pricingStrategy: "custom" })}
                    disabled={remoteDiscovery}
                  >
                    Custom
                  </button>
                </div>
                {config.pricingStrategy !== "custom" ? (
                  <p className={styles.pricingHint}>Starts below comparable hosted-model prices. Benchmark speed can only lower the ask further.</p>
                ) : (
                  <>
                    <p className={styles.pricingHint}>Exact per-model asks are active — edit them below.</p>
                    <div className={styles.priceEditorList}>
                      {status.host.models.map((model) => {
                        const price = resolveHiveComputeModelPrice(model.providerModelId, config);
                        const inputDraftKey = hiveComputePriceDraftKey(model.providerModelId, "inputUsdMicroPerMTok");
                        const outputDraftKey = hiveComputePriceDraftKey(model.providerModelId, "outputUsdMicroPerMTok");
                        const minimumDraftKey = hiveComputePriceDraftKey(model.providerModelId, "minimumJobUsdMicro");
                        return (
                          <div key={model.providerModelId} className={styles.priceEditorRow}>
                            <div className={styles.priceEditorModel}>
                              <b>{model.name || model.id}</b>
                              <span>{isHiveComputeBenchmarkCurrent(model.benchmark) ? `${model.benchmark.outputTokensPerSecond.toFixed(1)} output tok/s` : "Benchmark required"}</span>
                            </div>
                            <label className={styles.priceField}>
                              <span>Input $/M</span>
                              <input
                                type="number"
                                min={providerPriceBounds.inputUsdMicroPerMTok.min / 1_000_000}
                                max={providerPriceBounds.inputUsdMicroPerMTok.max / 1_000_000}
                                step={0.01}
                                value={priceDrafts[inputDraftKey] ?? (price.inputUsdMicroPerMTok / 1_000_000).toFixed(2)}
                                onChange={(event) => setPriceDrafts((current) => ({ ...current, [inputDraftKey]: event.target.value }))}
                                onBlur={(event) => commitModelPriceDraft(model.providerModelId, "inputUsdMicroPerMTok", event.target.value)}
                                onKeyDown={blurOnEnter}
                                disabled={remoteDiscovery}
                              />
                            </label>
                            <label className={styles.priceField}>
                              <span>Output $/M</span>
                              <input
                                type="number"
                                min={providerPriceBounds.outputUsdMicroPerMTok.min / 1_000_000}
                                max={providerPriceBounds.outputUsdMicroPerMTok.max / 1_000_000}
                                step={0.01}
                                value={priceDrafts[outputDraftKey] ?? (price.outputUsdMicroPerMTok / 1_000_000).toFixed(2)}
                                onChange={(event) => setPriceDrafts((current) => ({ ...current, [outputDraftKey]: event.target.value }))}
                                onBlur={(event) => commitModelPriceDraft(model.providerModelId, "outputUsdMicroPerMTok", event.target.value)}
                                onKeyDown={blurOnEnter}
                                disabled={remoteDiscovery}
                              />
                            </label>
                            <label className={styles.priceField}>
                              <span>Minimum $/job</span>
                              <input
                                type="number"
                                min={0}
                                max={providerPriceBounds.minimumJobUsdMicro.max / 1_000_000}
                                step={0.001}
                                value={priceDrafts[minimumDraftKey] ?? (price.minimumJobUsdMicro / 1_000_000).toFixed(3)}
                                onChange={(event) => setPriceDrafts((current) => ({ ...current, [minimumDraftKey]: event.target.value }))}
                                onBlur={(event) => commitModelPriceDraft(model.providerModelId, "minimumJobUsdMicro", event.target.value)}
                                onKeyDown={blurOnEnter}
                                disabled={remoteDiscovery}
                              />
                            </label>
                          </div>
                        );
                      })}
                      <p className={styles.priceEditorNote}>Prices save when you leave a field. The hosted gateway validates each ask, applies its {platformFeeBps / 100}% fee, and locks the accepted price into the job receipt. Earnings projections are net of that fee.</p>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className={styles.benchmarkGate} role="status">
                <Gauge size={18} aria-hidden="true" />
                <div>
                  <b>Benchmark required</b>
                  <span>{benchmarkedCount} of {enabledCount} selected models measured. Pricing unlocks after the benchmark.</span>
                </div>
              </div>
            )}
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
                      onClick={() => setHostWhen(option.id)}
                    >
                      <Icon size={14} aria-hidden="true" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {config.hostWhen === "sched" ? (
              <div className={styles.schedRow}>
                <label className={styles.priceField}>
                  <span>From</span>
                  <select
                    value={config.schedule?.startHour ?? 22}
                    onChange={(event) =>
                      patchConfig({
                        schedule: { startHour: Number(event.target.value), endHour: config.schedule?.endHour ?? 8 },
                      })
                    }
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.priceField}>
                  <span>Until</span>
                  <select
                    value={config.schedule?.endHour ?? 8}
                    onChange={(event) =>
                      patchConfig({
                        schedule: { startHour: config.schedule?.startHour ?? 22, endHour: Number(event.target.value) },
                      })
                    }
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
                    ))}
                  </select>
                </label>
                <span className={styles.pricingHint}>
                  This machine&rsquo;s local time; an Until before From wraps past midnight.
                </span>
              </div>
            ) : null}
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
            <div className={styles.switchRow}>
              <div className={styles.switchItem}>
                <span className={styles.switchLabel}>
                  <CreditCard size={14} aria-hidden="true" /> Daily earnings cap
                </span>
                <button
                  type="button"
                  aria-label="Daily earnings cap"
                  aria-pressed={config.dailyCapUsd !== null}
                  className={styles.switch}
                  data-on={config.dailyCapUsd !== null}
                  onClick={() => patchConfig({ dailyCapUsd: config.dailyCapUsd === null ? 25 : null })}
                >
                  <span className={styles.switchKnob} aria-hidden="true" />
                </button>
              </div>
              {config.dailyCapUsd !== null ? (
                <label className={styles.priceField}>
                  <span>Cap $/day</span>
                  <input
                    type="number"
                    min={1}
                    max={10_000}
                    step={1}
                    value={config.dailyCapUsd}
                    onChange={(event) =>
                      patchConfig({ dailyCapUsd: Math.min(10_000, Math.max(1, Math.round(Number(event.target.value) || 1))) })
                    }
                    onKeyDown={blurOnEnter}
                  />
                </label>
              ) : null}
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
    return (
      <HiveComputeHostEarningsView
        status={status}
        running={running}
        nowTick={nowTick}
        pricingReady={pricingReady}
        pricedAdvertisedModels={pricedAdvertisedModels}
        concurrency={concurrency}
        earn={earn}
        enabledCount={enabledCount}
        busy={Boolean(busy)}
        stopBusy={busy === "stop-worker"}
        onAdjustSettings={() => setStep("manage")}
        onStopHosting={() => void stopFromEarnings()}
        workerOutput={renderWorkerOutput()}
      />
    );
  }

  function renderWorkerOutput() {
    const run = status?.host.run;
    const output = run?.output;
    if (!output) return null;
    const tail = output.split(/\r?\n/).slice(-8).join("\n").trim();
    if (!tail) return null;
    return (
      <div className={styles.outputCard}>
        <span className={styles.cardKicker}>
          <Cpu size={13} aria-hidden="true" /> Worker output
          {run?.restarts ? ` · restarted ${run.restarts}×` : ""}
        </span>
        <pre className={styles.outputMono}>{tail}</pre>
      </div>
    );
  }
}
