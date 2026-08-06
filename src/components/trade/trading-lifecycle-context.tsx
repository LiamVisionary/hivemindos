"use client";

import React from "react";

import {
  approveTradingPlan,
  assertTradingPlanLive,
  createTradingPlan,
  fetchTradingControl,
  probeTradingBrokerConnection,
  reconcileTradingPosition,
  rejectTradingPlan,
  reviseTradingThesis,
  savePortfolioSnapshot,
  saveTradingBrokerConnection,
  saveTradingThesis,
  simulateTradingPlan,
  updateTradingAccountPolicy,
  updateTradingConfig,
} from "@/features/dashboard/views/trade/trade-api";
import type { TradingBrokerPackDefinition } from "@/lib/config/trading-brokers";
import type {
  PortfolioAccountSnapshot,
  TradePlan,
  TradeProposal,
  TradingBrokerConnection,
  TradingControlConfig,
  TradingControlOverview,
  TradingExecutionMode,
  TradingReconciliation,
  TradingThesis,
} from "@/lib/types/trading-control";
import { TRADING_EXECUTION_MODE_META } from "@/lib/types/trading-control";

type PlanDraft = {
  title?: string;
  proposal: TradeProposal;
  thesis?: string;
  evidence?: string[];
  missingContext?: string[];
};

type TradingLifecycleValue = {
  overview: TradingControlOverview | null;
  brokerPacks: TradingBrokerPackDefinition[];
  loading: boolean;
  busy: boolean;
  error: string;
  mode: TradingExecutionMode;
  refresh: () => Promise<TradingControlOverview | null>;
  setMode: (mode: TradingExecutionMode) => Promise<boolean>;
  setConfig: (config: Partial<TradingControlConfig>) => Promise<boolean>;
  setAccountPolicy: (input: { accountId: string; readOnly: boolean; executionMode?: TradingExecutionMode }) => Promise<boolean>;
  createPlan: (input: PlanDraft) => Promise<TradePlan | null>;
  approvePlan: (id: string, note?: string) => Promise<TradePlan | null>;
  rejectPlan: (id: string, note?: string) => Promise<TradePlan | null>;
  simulatePlan: (id: string) => Promise<TradePlan | null>;
  captureSnapshot: (accounts: PortfolioAccountSnapshot[]) => Promise<boolean>;
  createThesis: (input: Omit<TradingThesis, "id" | "status" | "nextReviewAt" | "createdAt" | "updatedAt" | "notes">) => Promise<boolean>;
  reviseThesis: (id: string, input: Partial<Pick<TradingThesis, "status" | "summary" | "invalidation" | "conviction">> & { note?: string }) => Promise<boolean>;
  saveConnection: (connection: Partial<TradingBrokerConnection>) => Promise<boolean>;
  probeConnection: (id: string) => Promise<boolean>;
  reconcilePosition: (input: Omit<TradingReconciliation, "id" | "quantityDelta" | "costBasisDeltaUsd" | "status" | "reconciledAt">) => Promise<boolean>;
};

const TradingLifecycleContext = React.createContext<TradingLifecycleValue | null>(null);

export function TradingLifecycleProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = React.useState<TradingControlOverview | null>(null);
  const [brokerPacks, setBrokerPacks] = React.useState<TradingBrokerPackDefinition[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState(0);
  const [error, setError] = React.useState("");

  const refresh = React.useCallback(async () => {
    const response = await fetchTradingControl();
    setLoading(false);
    if (!response.ok || !response.overview) {
      setError(response.error || "Trading controls could not be loaded.");
      return null;
    }
    setOverview(response.overview);
    setBrokerPacks(response.brokerPacks ?? []);
    setError("");
    return response.overview;
  }, []);

  React.useEffect(() => {
    let active = true;
    void fetchTradingControl().then((response) => {
      if (!active) return;
      setLoading(false);
      if (!response.ok || !response.overview) {
        setError(response.error || "Trading controls could not be loaded.");
        return;
      }
      setOverview(response.overview);
      setBrokerPacks(response.brokerPacks ?? []);
      setError("");
    });
    return () => { active = false; };
  }, []);

  const run = React.useCallback(async <T,>(operation: () => Promise<{ ok: boolean; error?: string } & Partial<T>>) => {
    setPending((count) => count + 1);
    setError("");
    try {
      const response = await operation();
      if (!response.ok) {
        setError(response.error || "Trading-control action failed.");
        return null;
      }
      return response;
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }, []);

  const value = React.useMemo<TradingLifecycleValue>(() => ({
    overview,
    brokerPacks,
    loading,
    busy: pending > 0,
    error,
    mode: overview?.config.executionMode ?? "paper",
    refresh,
    setMode: async (mode) => {
      const response = await run(() => updateTradingConfig({ executionMode: mode }));
      if (!response?.overview) return false;
      setOverview(response.overview);
      return true;
    },
    setConfig: async (config) => {
      const response = await run(() => updateTradingConfig(config));
      if (!response?.overview) return false;
      setOverview(response.overview);
      return true;
    },
    setAccountPolicy: async (input) => {
      const response = await run(() => updateTradingAccountPolicy(input));
      if (!response?.overview) return false;
      setOverview(response.overview);
      return true;
    },
    createPlan: async (input) => {
      const response = await run(() => createTradingPlan(input));
      if (!response?.plan) return null;
      setOverview((current) => current ? { ...current, plans: [response.plan!, ...current.plans.filter((item) => item.id !== response.plan!.id)] } : current);
      return response.plan;
    },
    approvePlan: async (id, note) => {
      const response = await run(() => approveTradingPlan(id, note));
      if (!response?.plan) return null;
      setOverview((current) => current ? { ...current, plans: current.plans.map((item) => item.id === id ? response.plan! : item) } : current);
      return response.plan;
    },
    rejectPlan: async (id, note) => {
      const response = await run(() => rejectTradingPlan(id, note));
      if (!response?.plan) return null;
      setOverview((current) => current ? { ...current, plans: current.plans.map((item) => item.id === id ? response.plan! : item) } : current);
      return response.plan;
    },
    simulatePlan: async (id) => {
      const response = await run(() => simulateTradingPlan(id));
      if (!response?.plan) return null;
      await refresh();
      return response.plan;
    },
    captureSnapshot: async (accounts) => {
      const response = await run(() => savePortfolioSnapshot(accounts));
      if (!response?.snapshot) return false;
      await refresh();
      return true;
    },
    createThesis: async (input) => {
      const response = await run(() => saveTradingThesis(input));
      if (!response?.thesis) return false;
      await refresh();
      return true;
    },
    reviseThesis: async (id, input) => {
      const response = await run(() => reviseTradingThesis(id, input));
      if (!response?.thesis) return false;
      await refresh();
      return true;
    },
    saveConnection: async (connection) => {
      const response = await run(() => saveTradingBrokerConnection(connection));
      if (!response?.connection) return false;
      await refresh();
      return true;
    },
    probeConnection: async (id) => {
      const response = await run(() => probeTradingBrokerConnection(id));
      if (!response?.connection) return false;
      await refresh();
      return true;
    },
    reconcilePosition: async (input) => {
      const response = await run(() => reconcileTradingPosition(input));
      if (!response?.reconciliation) return false;
      await refresh();
      return true;
    },
  }), [brokerPacks, error, loading, overview, pending, refresh, run]);

  return <TradingLifecycleContext.Provider value={value}>{children}</TradingLifecycleContext.Provider>;
}

export function useTradingLifecycle() {
  const value = React.useContext(TradingLifecycleContext);
  if (!value) throw new Error("useTradingLifecycle must be used within TradingLifecycleProvider");
  return value;
}

export function ExecutionModeControl() {
  const { mode, busy, setMode } = useTradingLifecycle();
  return (
    <div className="tl-mode" role="radiogroup" aria-label="Trading execution mode">
      {(["research", "paper", "live"] as TradingExecutionMode[]).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={mode === option}
          data-active={mode === option ? "" : undefined}
          data-live={option === "live" ? "" : undefined}
          disabled={busy}
          title={TRADING_EXECUTION_MODE_META[option].detail}
          onClick={() => void setMode(option)}
        >
          {TRADING_EXECUTION_MODE_META[option].shortLabel}
        </button>
      ))}
    </div>
  );
}

export function useTradePlanFlow() {
  const lifecycle = useTradingLifecycle();
  const [plan, setPlan] = React.useState<TradePlan | null>(null);
  const [error, setError] = React.useState("");

  const stage = React.useCallback(async (draft: PlanDraft) => {
    setError("");
    const created = await lifecycle.createPlan(draft);
    setPlan(created);
    if (!created) setError(lifecycle.error || "The trade plan could not be created.");
    return created;
  }, [lifecycle]);

  const approveAndContinue = React.useCallback(async (executeLive?: (planId: string) => Promise<{ ok: boolean; error?: string }>) => {
    if (!plan) return null;
    setError("");
    const approved = await lifecycle.approvePlan(plan.id, "Reviewed in the governed Trade ticket.");
    if (!approved) {
      const refreshed = await lifecycle.refresh();
      setPlan(refreshed?.plans.find((item) => item.id === plan.id) ?? plan);
      setError(lifecycle.error || "The plan could not be approved.");
      return null;
    }
    setPlan(approved);
    if (approved.executionMode === "research") return approved;
    if (approved.executionMode === "paper") {
      const simulated = await lifecycle.simulatePlan(approved.id);
      if (!simulated) setError(lifecycle.error || "The paper fill could not be simulated.");
      setPlan(simulated);
      return simulated;
    }
    if (!executeLive) {
      setError("This live plan needs its original execution ticket before it can be submitted.");
      return approved;
    }
    const preflight = await assertTradingPlanLive(approved.id);
    if (!preflight.ok) {
      setError(preflight.error || "The live plan no longer passes its execution preflight.");
      const refreshed = await lifecycle.refresh();
      setPlan(refreshed?.plans.find((item) => item.id === approved.id) ?? approved);
      return approved;
    }
    const outcome = await executeLive(approved.id);
    const refreshed = await lifecycle.refresh();
    const current = refreshed?.plans.find((item) => item.id === approved.id) ?? approved;
    setPlan(current);
    if (!outcome.ok) setError(outcome.error || "The governed execution rail rejected this plan.");
    return current;
  }, [lifecycle, plan]);

  const reject = React.useCallback(async () => {
    if (!plan) return null;
    setError("");
    const rejected = await lifecycle.rejectPlan(plan.id, "Rejected in the governed Trade ticket.");
    setPlan(rejected);
    if (!rejected) setError(lifecycle.error || "The plan could not be rejected.");
    return rejected;
  }, [lifecycle, plan]);

  const clear = React.useCallback(() => { setPlan(null); setError(""); }, []);

  return { plan, setPlan, error, busy: lifecycle.busy, mode: lifecycle.mode, stage, approveAndContinue, reject, clear };
}
