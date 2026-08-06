import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { homedir } from "@/lib/home-dir";
import {
  DEFAULT_TRADING_RISK_POLICY,
  evaluateTradingRisk,
  normalizeTradingRiskPolicy,
} from "@/lib/services/trading/trading-risk-policy";
import type {
  PortfolioAccountSnapshot,
  PortfolioHoldingSnapshot,
  PortfolioSnapshot,
  SimulatedTradingAccount,
  TradePlan,
  TradePlanExecution,
  TradeProposal,
  TradingAssetClass,
  TradingAccountPolicy,
  TradingBrokerConnection,
  TradingControlConfig,
  TradingControlOverview,
  TradingEvent,
  TradingExecutionMode,
  TradingReconciliation,
  TradingThesis,
  TradingThesisStatus,
} from "@/lib/types/trading-control";

const STORE_VERSION = 1 as const;
const DEFAULT_SIMULATOR_CASH_USD = 100_000;
const MAX_PLANS = 500;
const MAX_SNAPSHOTS = 720;
const MAX_EVENTS = 1_000;
const MAX_THESES = 200;
const MAX_RECONCILIATIONS = 500;

type TradingControlStore = TradingControlOverview;
type StoreMutation<T> = (store: TradingControlStore) => T | Promise<T>;

type QueueSlot = { promise: Promise<unknown> };
function queueSlot(): QueueSlot {
  const root = globalThis as typeof globalThis & { __hivemindTradingControlQueue?: QueueSlot };
  if (!root.__hivemindTradingControlQueue) root.__hivemindTradingControlQueue = { promise: Promise.resolve() };
  return root.__hivemindTradingControlQueue;
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function storePath() {
  return process.env.HIVEMINDOS_TRADING_CONTROL_PATH || join(homedir(), ".hivemindos", "trading-control.json");
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value: unknown, fallback = 0) {
  return Math.max(0, finite(value, fallback));
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  return Math.min(max, Math.max(min, finite(value, fallback)));
}

function text(value: unknown, max = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function textList(value: unknown, maxItems = 20, maxChars = 300) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => text(item, maxChars)).filter(Boolean))).slice(0, maxItems);
}

function executionMode(value: unknown, fallback: TradingExecutionMode = "paper"): TradingExecutionMode {
  return value === "research" || value === "paper" || value === "live" ? value : fallback;
}

function defaultConfig(): TradingControlConfig {
  return {
    executionMode: "paper",
    accountPolicies: {},
    riskPolicy: { ...DEFAULT_TRADING_RISK_POLICY },
    snapshotCadenceMinutes: 60,
  };
}

function emptyStore(): TradingControlStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date(0).toISOString(),
    config: defaultConfig(),
    plans: [],
    snapshots: [],
    theses: [],
    simulator: { accounts: {} },
    connections: [],
    reconciliations: [],
    events: [],
  };
}

function normalizeConfig(value: unknown): TradingControlConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultConfig();
  const input = value as Partial<TradingControlConfig>;
  const accountPolicies: Record<string, TradingAccountPolicy> = {};
  if (input.accountPolicies && typeof input.accountPolicies === "object" && !Array.isArray(input.accountPolicies)) {
    for (const [accountId, item] of Object.entries(input.accountPolicies)) {
      if (!accountId.trim() || !item || typeof item !== "object" || Array.isArray(item)) continue;
      const policy = item as { readOnly?: unknown; executionMode?: unknown };
      accountPolicies[accountId] = {
        readOnly: Boolean(policy.readOnly),
        ...(policy.executionMode === "research" || policy.executionMode === "paper" || policy.executionMode === "live"
          ? { executionMode: policy.executionMode }
          : {}),
      };
    }
  }
  return {
    executionMode: executionMode(input.executionMode),
    accountPolicies,
    riskPolicy: normalizeTradingRiskPolicy(input.riskPolicy),
    snapshotCadenceMinutes: Math.round(clamp(input.snapshotCadenceMinutes, 60, 5, 10_080)),
  };
}

function normalizeStore(value: unknown): TradingControlStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyStore();
  const input = value as Partial<TradingControlStore>;
  const fallback = emptyStore();
  return {
    version: STORE_VERSION,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : fallback.updatedAt,
    config: normalizeConfig(input.config),
    plans: Array.isArray(input.plans) ? input.plans.filter((item): item is TradePlan => Boolean(item?.id && item?.proposal)).slice(0, MAX_PLANS) : [],
    snapshots: Array.isArray(input.snapshots) ? input.snapshots.filter((item): item is PortfolioSnapshot => Boolean(item?.id && item?.capturedAt)).slice(0, MAX_SNAPSHOTS) : [],
    theses: Array.isArray(input.theses) ? input.theses.filter((item): item is TradingThesis => Boolean(item?.id && item?.asset)).slice(0, MAX_THESES) : [],
    simulator: input.simulator && typeof input.simulator === "object" && !Array.isArray(input.simulator)
      ? input.simulator
      : fallback.simulator,
    connections: Array.isArray(input.connections) ? input.connections.filter((item): item is TradingBrokerConnection => Boolean(item?.id && item?.packId)) : [],
    reconciliations: Array.isArray(input.reconciliations) ? input.reconciliations.filter((item): item is TradingReconciliation => Boolean(item?.id)).slice(0, MAX_RECONCILIATIONS) : [],
    events: Array.isArray(input.events) ? input.events.filter((item): item is TradingEvent => Boolean(item?.id && item?.kind)).slice(0, MAX_EVENTS) : [],
  };
}

export async function readTradingControlStore(): Promise<TradingControlStore> {
  try {
    const raw = await readFile(storePath(), "utf8");
    if (!raw.trim()) return emptyStore();
    return normalizeStore(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function writeTradingControlStore(store: TradingControlStore) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

function mutateStore<T>(mutate: StoreMutation<T>): Promise<T> {
  const slot = queueSlot();
  const operation = slot.promise.catch(() => undefined).then(async () => {
    const store = await readTradingControlStore();
    const result = await mutate(store);
    store.updatedAt = nowIso();
    await writeTradingControlStore(store);
    return result;
  });
  slot.promise = operation.catch(() => undefined);
  return operation;
}

function prependEvent(store: TradingControlStore, input: Omit<TradingEvent, "id" | "at"> & { at?: string }) {
  store.events = [{ id: `tevt_${randomUUID()}`, at: input.at || nowIso(), ...input }, ...store.events].slice(0, MAX_EVENTS);
}

function effectiveMode(config: TradingControlConfig, accountId: string): TradingExecutionMode {
  const account = config.accountPolicies[accountId];
  if (account?.readOnly) return "research";
  return account?.executionMode ?? config.executionMode;
}

function normalizeProposal(input: TradeProposal): TradeProposal {
  const accountId = text(input.accountId, 160);
  const asset = text(input.asset, 80).toUpperCase();
  if (!accountId) throw new Error("A trading account is required.");
  if (!asset) throw new Error("An asset is required.");
  const notionalUsd = positive(input.notionalUsd);
  if (!(notionalUsd > 0)) throw new Error("Trade amount must be greater than zero.");
  return {
    ...input,
    accountId,
    agentId: text(input.agentId, 160) || undefined,
    asset,
    notionalUsd,
    quantity: input.quantity === undefined ? undefined : positive(input.quantity),
    estimatedPrice: input.estimatedPrice === undefined ? undefined : positive(input.estimatedPrice),
    limitPrice: input.limitPrice === undefined ? undefined : positive(input.limitPrice),
    stopPrice: input.stopPrice === undefined ? undefined : positive(input.stopPrice),
    fromAsset: text(input.fromAsset, 80).toUpperCase() || undefined,
    fromQuantity: input.fromQuantity === undefined ? undefined : positive(input.fromQuantity),
    estimatedReceiveQuantity: input.estimatedReceiveQuantity === undefined ? undefined : positive(input.estimatedReceiveQuantity),
    leverage: input.leverage === undefined ? undefined : positive(input.leverage),
    venue: text(input.venue, 120) || undefined,
    network: text(input.network, 120) || undefined,
    source: text(input.source, 120) || undefined,
    sourceReference: text(input.sourceReference, 240) || undefined,
    companyTaskId: text(input.companyTaskId, 160) || undefined,
  };
}

function findPlan(store: TradingControlStore, id: string) {
  const plan = store.plans.find((item) => item.id === id);
  if (!plan) throw new Error("Trade plan not found.");
  return plan;
}

function audit(plan: TradePlan, action: string, note?: string) {
  const at = nowIso();
  plan.updatedAt = at;
  plan.audit.push({ at, action, status: plan.status, ...(note ? { note: text(note, 500) } : {}) });
}

export async function updateTradingControlConfig(input: Partial<TradingControlConfig>): Promise<TradingControlOverview> {
  await mutateStore((store) => {
    store.config = normalizeConfig({
      ...store.config,
      ...input,
      accountPolicies: input.accountPolicies ?? store.config.accountPolicies,
      riskPolicy: input.riskPolicy ? { ...store.config.riskPolicy, ...input.riskPolicy } : store.config.riskPolicy,
    });
    prependEvent(store, {
      kind: "config.updated",
      title: "Trading controls updated",
      detail: `Default execution mode is ${store.config.executionMode}; snapshot cadence is ${store.config.snapshotCadenceMinutes} minutes.`,
    });
  });
  return readTradingControlOverview();
}

export async function setTradingAccountPolicy(input: {
  accountId: string;
  readOnly: boolean;
  executionMode?: TradingExecutionMode;
}): Promise<TradingControlOverview> {
  const accountId = text(input.accountId, 160);
  if (!accountId) throw new Error("A trading account is required.");
  await mutateStore((store) => {
    store.config.accountPolicies[accountId] = {
      readOnly: Boolean(input.readOnly),
      ...(input.executionMode ? { executionMode: executionMode(input.executionMode) } : {}),
    };
    prependEvent(store, {
      kind: "account.policy-updated",
      title: "Account execution policy updated",
      detail: input.readOnly ? "The account is read-only." : `The account may use ${effectiveMode(store.config, accountId)} mode.`,
      accountId,
    });
  });
  return readTradingControlOverview();
}

export async function createTradePlan(input: {
  title?: string;
  proposal: TradeProposal;
  thesis?: string;
  evidence?: string[];
  missingContext?: string[];
}): Promise<TradePlan> {
  return mutateStore((store) => {
    const proposal = normalizeProposal(input.proposal);
    const mode = effectiveMode(store.config, proposal.accountId);
    const risk = evaluateTradingRisk({
      proposal,
      policy: store.config.riskPolicy,
      executionMode: mode,
      recentPlans: store.plans,
    });
    const createdAt = nowIso();
    const status = risk.decision === "block" ? "blocked" : "review";
    const plan: TradePlan = {
      id: `tplan_${randomUUID()}`,
      title: text(input.title, 160) || `${proposal.side} ${proposal.asset}`,
      proposal,
      thesis: text(input.thesis, 1_200) || undefined,
      evidence: textList(input.evidence, 20, 400),
      missingContext: Array.from(new Set([...textList(input.missingContext, 20, 300), ...(risk.reasoning.missingContext ?? [])])),
      executionMode: mode,
      status,
      risk,
      createdAt,
      updatedAt: createdAt,
      audit: [{ at: createdAt, action: "created", status }],
    };
    store.plans = [plan, ...store.plans].slice(0, MAX_PLANS);
    prependEvent(store, {
      kind: status === "blocked" ? "plan.blocked" : "plan.created",
      title: status === "blocked" ? "Trade plan blocked" : "Trade plan ready for review",
      detail: risk.summary,
      planId: plan.id,
      accountId: proposal.accountId,
      asset: proposal.asset,
    });
    return plan;
  });
}

export async function approveTradePlan(id: string, note?: string): Promise<TradePlan> {
  const plan = await mutateStore((store) => {
    const plan = findPlan(store, id);
    if (plan.status === "blocked") throw new Error("A blocked plan cannot be approved. Resolve its risk checks and create a fresh review.");
    if (plan.status !== "review" && plan.status !== "approved") throw new Error(`A ${plan.status} plan cannot be approved.`);
    plan.risk = evaluateTradingRisk({
      proposal: plan.proposal,
      policy: store.config.riskPolicy,
      executionMode: plan.executionMode,
      recentPlans: store.plans.filter((item) => item.id !== plan.id),
    });
    if (plan.risk.decision === "block") {
      plan.status = "blocked";
      audit(plan, "blocked-on-review", plan.risk.summary);
      prependEvent(store, {
        kind: "plan.blocked",
        title: "Trade plan blocked during review",
        detail: plan.risk.summary,
        planId: plan.id,
        accountId: plan.proposal.accountId,
        asset: plan.proposal.asset,
      });
      return plan;
    }
    plan.status = "approved";
    plan.reviewedAt = nowIso();
    plan.reviewNote = text(note, 500) || undefined;
    audit(plan, "approved", note);
    prependEvent(store, {
      kind: "plan.approved",
      title: "Trade plan approved",
      detail: plan.executionMode === "live" ? "The plan may reach its governed live rail." : `The plan is approved in ${plan.executionMode} mode.`,
      planId: plan.id,
      accountId: plan.proposal.accountId,
      asset: plan.proposal.asset,
    });
    return plan;
  });
  if (plan.status === "blocked") throw new Error(`The plan no longer passes risk review: ${plan.risk.summary}`);
  return plan;
}

export async function rejectTradePlan(id: string, note?: string): Promise<TradePlan> {
  return mutateStore((store) => {
    const plan = findPlan(store, id);
    if (["filled", "reconciled"].includes(plan.status)) throw new Error("A completed plan cannot be rejected.");
    plan.status = "rejected";
    plan.reviewedAt = nowIso();
    plan.reviewNote = text(note, 500) || undefined;
    audit(plan, "rejected", note);
    prependEvent(store, {
      kind: "plan.rejected",
      title: "Trade plan rejected",
      detail: plan.reviewNote || "The plan was stopped during review.",
      planId: plan.id,
      accountId: plan.proposal.accountId,
      asset: plan.proposal.asset,
    });
    return plan;
  });
}

function simulationAccount(store: TradingControlStore, accountId: string, at: string): SimulatedTradingAccount {
  return store.simulator.accounts[accountId] ?? {
    accountId,
    startingCashUsd: DEFAULT_SIMULATOR_CASH_USD,
    cashUsd: DEFAULT_SIMULATOR_CASH_USD,
    positions: {},
    updatedAt: at,
  };
}

function simulationFill(plan: TradePlan) {
  const proposal = plan.proposal;
  const orderPrice = proposal.orderType === "limit" || proposal.orderType === "stop_limit"
    ? proposal.limitPrice
    : proposal.orderType === "stop"
      ? proposal.stopPrice
      : proposal.estimatedPrice;
  const fillPrice = positive(orderPrice || proposal.estimatedPrice || proposal.limitPrice || proposal.stopPrice)
    || (positive(proposal.quantity) > 0 ? proposal.notionalUsd / positive(proposal.quantity) : 0);
  if (!(fillPrice > 0)) throw new Error("Paper fill needs a known estimated, limit, or stop price.");
  const quantity = positive(proposal.estimatedReceiveQuantity || proposal.quantity)
    || proposal.notionalUsd / fillPrice;
  if (!(quantity > 0)) throw new Error("Paper fill needs a positive quantity.");
  return { fillPrice, quantity };
}

function captureSimulatorSnapshot(store: TradingControlStore, reason: PortfolioSnapshot["reason"], capturedAt: string) {
  const accounts: PortfolioAccountSnapshot[] = Object.values(store.simulator.accounts).map((account) => ({
    accountId: account.accountId,
    label: "Paper portfolio",
    provider: "hivemind-simulator",
    custody: "virtual",
    cashUsd: account.cashUsd,
    health: "healthy",
    lastSyncAt: account.updatedAt,
    holdings: Object.values(account.positions)
      .filter((position) => Math.abs(position.quantity) > 1e-10)
      .map((position) => holdingSnapshot({
        asset: position.asset,
        assetClass: position.assetClass,
        quantity: position.quantity,
        marketPrice: position.marketPrice,
        marketValueUsd: position.quantity * position.marketPrice,
        costBasisUsd: position.quantity * position.averageCost,
        source: "hivemind-simulator",
      })),
  }));
  return storeSnapshot(store, { reason, capturedAt, accounts });
}

export async function simulateTradePlan(id: string, options: { now?: string } = {}): Promise<TradePlan> {
  return mutateStore((store) => {
    const plan = findPlan(store, id);
    if (plan.executionMode !== "paper") throw new Error("Only paper-mode plans can use the simulator.");
    if (plan.status !== "approved") throw new Error("Approve the plan before simulating it.");
    const at = options.now && Number.isFinite(Date.parse(options.now)) ? new Date(options.now).toISOString() : nowIso();
    const account = simulationAccount(store, plan.proposal.accountId, at);
    const { fillPrice, quantity } = simulationFill(plan);
    const key = plan.proposal.asset.toUpperCase();
    const current = account.positions[key];
    const reducing = plan.proposal.side === "sell" || plan.proposal.side === "remove" || plan.proposal.reduceOnly;
    const swapping = plan.proposal.side === "swap" && Boolean(plan.proposal.fromAsset && plan.proposal.fromQuantity);
    let realizedPnlUsd = current?.realizedPnlUsd ?? 0;

    if (swapping) {
      const sourceKey = plan.proposal.fromAsset!.toUpperCase();
      const sourceQuantity = positive(plan.proposal.fromQuantity);
      const cashAssets = new Set(["USD", "USDC", "USDT", "USDG", "DAI"]);
      if (cashAssets.has(sourceKey)) {
        if (account.cashUsd + 1e-9 < plan.proposal.notionalUsd) throw new Error("The paper portfolio does not have enough virtual cash for this swap.");
        account.cashUsd -= plan.proposal.notionalUsd;
      } else {
        const source = account.positions[sourceKey];
        if (!source || source.quantity + 1e-9 < sourceQuantity) throw new Error(`The paper portfolio does not hold ${sourceQuantity} ${sourceKey} to swap.`);
        source.quantity = Math.max(0, source.quantity - sourceQuantity);
        source.marketPrice = plan.proposal.notionalUsd / sourceQuantity;
        source.realizedPnlUsd += plan.proposal.notionalUsd - sourceQuantity * source.averageCost;
      }
      const previousQuantity = current?.quantity ?? 0;
      const nextQuantity = previousQuantity + quantity;
      account.positions[key] = {
        asset: key,
        assetClass: plan.proposal.assetClass,
        quantity: nextQuantity,
        averageCost: nextQuantity > 0 ? ((current?.averageCost ?? 0) * previousQuantity + plan.proposal.notionalUsd) / nextQuantity : fillPrice,
        marketPrice: fillPrice,
        realizedPnlUsd,
      };
    } else if (reducing) {
      if (!current || current.quantity + 1e-9 < quantity) throw new Error(`The paper portfolio does not hold ${quantity} ${key} to sell.`);
      account.cashUsd += quantity * fillPrice;
      realizedPnlUsd += quantity * (fillPrice - current.averageCost);
      account.positions[key] = {
        ...current,
        quantity: Math.max(0, current.quantity - quantity),
        marketPrice: fillPrice,
        realizedPnlUsd,
      };
    } else {
      const cost = plan.proposal.notionalUsd;
      if (account.cashUsd + 1e-9 < cost) throw new Error("The paper portfolio does not have enough virtual cash for this fill.");
      account.cashUsd -= cost;
      const previousQuantity = current?.quantity ?? 0;
      const nextQuantity = previousQuantity + quantity;
      const averageCost = nextQuantity > 0
        ? ((current?.averageCost ?? 0) * previousQuantity + cost) / nextQuantity
        : fillPrice;
      account.positions[key] = {
        asset: key,
        assetClass: plan.proposal.assetClass,
        quantity: nextQuantity,
        averageCost,
        marketPrice: fillPrice,
        realizedPnlUsd,
      };
    }
    account.updatedAt = at;
    store.simulator.accounts[account.accountId] = account;
    plan.status = "filled";
    plan.execution = {
      kind: "simulation",
      status: "filled",
      detail: `Paper fill: ${plan.proposal.side} ${quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${key} at $${fillPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}.`,
      reference: `paper_${randomUUID()}`,
      submittedAt: at,
      filledAt: at,
      fillPrice,
      filledQuantity: quantity,
      feesUsd: 0,
    };
    audit(plan, "simulated");
    prependEvent(store, {
      kind: "plan.simulated",
      at,
      title: "Paper order filled",
      detail: plan.execution.detail,
      planId: plan.id,
      accountId: plan.proposal.accountId,
      asset: key,
    });
    captureSimulatorSnapshot(store, "event", at);
    return plan;
  });
}

export async function assertTradePlanExecutable(input: {
  planId: string;
  accountId?: string;
  agentId?: string;
  asset: string | string[];
  notionalUsd: number;
  side?: TradeProposal["side"];
  orderType?: TradeProposal["orderType"];
  now?: number;
}): Promise<TradePlan> {
  const store = await readTradingControlStore();
  const plan = findPlan(store, input.planId);
  if (plan.executionMode !== "live") throw new Error("This plan is not approved for live execution.");
  if (plan.status !== "approved" && plan.status !== "submitted") throw new Error(`The live plan is ${plan.status}; approve it before execution.`);
  if (plan.risk.decision !== "allow") throw new Error("The live plan has blocking risk checks.");
  if (store.config.accountPolicies[plan.proposal.accountId]?.readOnly) throw new Error("This trading account is read-only.");
  if (input.accountId && plan.proposal.accountId !== input.accountId) throw new Error("The plan account does not match the execution account.");
  if (input.agentId && plan.proposal.agentId && plan.proposal.agentId !== input.agentId) throw new Error("The plan agent does not match the execution agent.");
  const executionAssets = (Array.isArray(input.asset) ? input.asset : [input.asset]).map((asset) => asset.trim().toUpperCase());
  if (!executionAssets.includes(plan.proposal.asset.toUpperCase())) throw new Error("The plan asset does not match the execution request.");
  if (input.side && plan.proposal.side !== input.side) throw new Error("The plan side does not match the execution request.");
  if (input.orderType && plan.proposal.orderType !== input.orderType) throw new Error("The plan order type does not match the execution request.");
  const difference = Math.abs(plan.proposal.notionalUsd - Number(input.notionalUsd));
  const boundedSlippageBps = Math.min(
    store.config.riskPolicy.maxSlippageBps,
    plan.proposal.quote?.slippageBps ?? 10,
  );
  if (difference > Math.max(0.01, plan.proposal.notionalUsd * boundedSlippageBps / 10_000)) {
    throw new Error("The execution amount moved beyond the reviewed plan's slippage bound.");
  }
  const freshRisk = evaluateTradingRisk({
    proposal: plan.proposal,
    policy: store.config.riskPolicy,
    executionMode: "live",
    recentPlans: store.plans.filter((item) => item.id !== plan.id),
    now: input.now,
  });
  if (freshRisk.decision === "block") throw new Error(`The live plan no longer passes risk checks: ${freshRisk.summary}`);
  return plan;
}

export async function assertTradingLiveMode(input: { planId?: string } = {}): Promise<void> {
  const store = await readTradingControlStore();
  if (input.planId?.trim()) {
    const plan = findPlan(store, input.planId.trim());
    if (plan.executionMode !== "live") throw new Error(`The Trade Plan is ${plan.executionMode}-only and cannot submit a real order.`);
    return;
  }
  if (store.config.executionMode !== "live") {
    throw new Error(`Global trading mode is ${store.config.executionMode}. Switch to Live before submitting a real order.`);
  }
  if (store.config.riskPolicy.requirePlanForLive) {
    throw new Error("Live trading requires an approved Trade Plan. Stage and review the order first.");
  }
}

export async function recordLiveTradePlanResult(input: {
  planId: string;
  execution: Omit<TradePlanExecution, "kind" | "submittedAt"> & { submittedAt?: string };
}): Promise<TradePlan> {
  return mutateStore((store) => {
    const plan = findPlan(store, input.planId);
    if (plan.executionMode !== "live") throw new Error("Only a live plan can record a live execution.");
    if (plan.status !== "approved" && plan.status !== "submitted") throw new Error(`The live plan is ${plan.status}; it cannot record an execution.`);
    const submittedAt = input.execution.submittedAt || nowIso();
    plan.execution = { kind: "live", submittedAt, ...input.execution };
    plan.status = input.execution.filledAt || input.execution.status === "filled" ? "filled" : "submitted";
    audit(plan, plan.status === "filled" ? "filled" : "submitted");
    prependEvent(store, {
      kind: plan.status === "filled" ? "plan.filled" : "plan.submitted",
      title: plan.status === "filled" ? "Live order filled" : "Live order submitted",
      detail: input.execution.detail,
      planId: plan.id,
      accountId: plan.proposal.accountId,
      asset: plan.proposal.asset,
    });
    return plan;
  });
}

export async function failTradePlan(id: string, detail: string): Promise<TradePlan> {
  return mutateStore((store) => {
    const plan = findPlan(store, id);
    plan.status = "failed";
    plan.execution = {
      kind: plan.executionMode === "live" ? "live" : "simulation",
      status: "failed",
      detail: text(detail, 1_000) || "Trade execution failed.",
      submittedAt: plan.execution?.submittedAt || nowIso(),
    };
    audit(plan, "failed", detail);
    prependEvent(store, {
      kind: "plan.failed",
      title: "Trade execution failed",
      detail: plan.execution.detail,
      planId: plan.id,
      accountId: plan.proposal.accountId,
      asset: plan.proposal.asset,
    });
    return plan;
  });
}

function holdingSnapshot(input: PortfolioHoldingSnapshot): PortfolioHoldingSnapshot {
  const marketValueUsd = positive(input.marketValueUsd);
  const costBasisUsd = input.costBasisUsd === undefined ? undefined : positive(input.costBasisUsd);
  const unrealizedPnlUsd = costBasisUsd === undefined ? undefined : marketValueUsd - costBasisUsd;
  const unrealizedPnlPct = costBasisUsd && costBasisUsd > 0 ? unrealizedPnlUsd! / costBasisUsd * 100 : undefined;
  return {
    asset: text(input.asset, 80).toUpperCase(),
    assetClass: input.assetClass,
    quantity: finite(input.quantity),
    marketPrice: positive(input.marketPrice),
    marketValueUsd,
    costBasisUsd,
    unrealizedPnlUsd,
    unrealizedPnlPct,
    source: text(input.source, 120) || undefined,
  };
}

function accountSnapshot(input: PortfolioAccountSnapshot): PortfolioAccountSnapshot {
  const holdings = (Array.isArray(input.holdings) ? input.holdings : []).map(holdingSnapshot).filter((item) => item.asset);
  const cashUsd = positive(input.cashUsd);
  const totalValueUsd = cashUsd + holdings.reduce((sum, item) => sum + item.marketValueUsd, 0);
  return {
    accountId: text(input.accountId, 160),
    label: text(input.label, 120) || "Trading account",
    provider: text(input.provider, 120) || "unknown",
    custody: text(input.custody, 120) || "unknown",
    cashUsd,
    holdings,
    totalValueUsd,
    health: input.health ?? "unknown",
    lastSyncAt: input.lastSyncAt && Number.isFinite(Date.parse(input.lastSyncAt)) ? new Date(input.lastSyncAt).toISOString() : undefined,
  };
}

function storeSnapshot(store: TradingControlStore, input: {
  reason: PortfolioSnapshot["reason"];
  capturedAt: string;
  accounts: PortfolioAccountSnapshot[];
}) {
  const accounts = input.accounts.map(accountSnapshot).filter((account) => account.accountId);
  const cashUsd = accounts.reduce((sum, account) => sum + account.cashUsd, 0);
  const totalValueUsd = accounts.reduce((sum, account) => sum + (account.totalValueUsd ?? 0), 0);
  const snapshot: PortfolioSnapshot = {
    id: `tsnap_${randomUUID()}`,
    capturedAt: input.capturedAt,
    reason: input.reason,
    accounts,
    totalValueUsd,
    cashUsd,
    investedValueUsd: totalValueUsd - cashUsd,
  };
  store.snapshots = [snapshot, ...store.snapshots].slice(0, MAX_SNAPSHOTS);
  prependEvent(store, {
    kind: "snapshot.captured",
    at: input.capturedAt,
    title: `${input.reason[0]!.toUpperCase()}${input.reason.slice(1)} portfolio snapshot`,
    detail: `${accounts.length} account${accounts.length === 1 ? "" : "s"}; total value $${totalValueUsd.toFixed(2)}.`,
  });
  return snapshot;
}

export async function capturePortfolioSnapshot(input: {
  reason?: PortfolioSnapshot["reason"];
  capturedAt?: string;
  accounts: PortfolioAccountSnapshot[];
}): Promise<PortfolioSnapshot> {
  return mutateStore((store) => storeSnapshot(store, {
    reason: input.reason ?? "manual",
    capturedAt: input.capturedAt && Number.isFinite(Date.parse(input.capturedAt)) ? new Date(input.capturedAt).toISOString() : nowIso(),
    accounts: input.accounts,
  }));
}

function nextReviewAt(cadenceDays: number, from = Date.now()) {
  return nowIso(from + cadenceDays * 86_400_000);
}

export async function createTradingThesis(input: {
  title: string;
  asset: string;
  assetClass: TradingAssetClass;
  direction?: TradingThesis["direction"];
  conviction?: TradingThesis["conviction"];
  summary: string;
  invalidation?: string;
  catalysts?: string[];
  reviewCadenceDays?: number;
}): Promise<TradingThesis> {
  return mutateStore((store) => {
    const at = nowIso();
    const cadence = Math.round(clamp(input.reviewCadenceDays, 14, 1, 365));
    const thesis: TradingThesis = {
      id: `thesis_${randomUUID()}`,
      title: text(input.title, 160) || `${text(input.asset, 80).toUpperCase()} thesis`,
      asset: text(input.asset, 80).toUpperCase(),
      assetClass: input.assetClass,
      direction: input.direction === "short" || input.direction === "neutral" ? input.direction : "long",
      conviction: input.conviction === "low" || input.conviction === "high" ? input.conviction : "medium",
      summary: text(input.summary, 1_500),
      invalidation: text(input.invalidation, 800) || undefined,
      catalysts: textList(input.catalysts, 20, 300),
      status: "watching",
      reviewCadenceDays: cadence,
      nextReviewAt: nextReviewAt(cadence),
      createdAt: at,
      updatedAt: at,
      notes: [],
    };
    if (!thesis.asset || !thesis.summary) throw new Error("A thesis needs an asset and a concise summary.");
    store.theses = [thesis, ...store.theses].slice(0, MAX_THESES);
    prependEvent(store, { kind: "thesis.created", title: "Research thesis added", detail: thesis.title, asset: thesis.asset });
    return thesis;
  });
}

export async function updateTradingThesis(id: string, input: {
  status?: TradingThesisStatus;
  note?: string;
  summary?: string;
  invalidation?: string;
  conviction?: TradingThesis["conviction"];
}): Promise<TradingThesis> {
  return mutateStore((store) => {
    const thesis = store.theses.find((item) => item.id === id);
    if (!thesis) throw new Error("Trading thesis not found.");
    if (input.status && ["draft", "watching", "validated", "invalidated", "archived"].includes(input.status)) thesis.status = input.status;
    if (input.summary !== undefined) thesis.summary = text(input.summary, 1_500);
    if (input.invalidation !== undefined) thesis.invalidation = text(input.invalidation, 800) || undefined;
    if (input.conviction === "low" || input.conviction === "medium" || input.conviction === "high") thesis.conviction = input.conviction;
    const note = text(input.note, 800);
    if (note) thesis.notes.unshift({ at: nowIso(), text: note });
    thesis.updatedAt = nowIso();
    thesis.nextReviewAt = nextReviewAt(thesis.reviewCadenceDays);
    prependEvent(store, { kind: "thesis.updated", title: "Research thesis updated", detail: `${thesis.title}: ${thesis.status}`, asset: thesis.asset });
    return thesis;
  });
}

export async function upsertBrokerConnection(input: Omit<TradingBrokerConnection, "health" | "createdAt" | "updatedAt"> & Partial<Pick<TradingBrokerConnection, "health" | "healthDetail" | "lastCheckedAt" | "createdAt" | "updatedAt">>): Promise<TradingBrokerConnection> {
  return mutateStore((store) => {
    if (input.packId !== "ccxt" && input.packId !== "ibkr") throw new Error("Unsupported broker pack.");
    const id = text(input.id, 160);
    if (!id) throw new Error("A broker connection id is required.");
    const existing = store.connections.find((item) => item.id === id);
    const at = nowIso();
    const connection: TradingBrokerConnection = {
      id,
      packId: input.packId,
      label: text(input.label, 120) || (input.packId === "ccxt" ? "Exchange data" : "Interactive Brokers paper"),
      enabled: Boolean(input.enabled),
      readOnly: true,
      paper: input.packId === "ibkr" ? true : input.paper !== false,
      settings: Object.fromEntries(Object.entries(input.settings ?? {}).map(([key, value]) => [text(key, 80), text(value, 240)]).filter(([key]) => key)),
      health: input.health ?? existing?.health ?? "unknown",
      healthDetail: text(input.healthDetail ?? existing?.healthDetail, 500) || undefined,
      lastCheckedAt: input.lastCheckedAt ?? existing?.lastCheckedAt,
      createdAt: existing?.createdAt ?? input.createdAt ?? at,
      updatedAt: at,
    };
    store.connections = [connection, ...store.connections.filter((item) => item.id !== id)];
    prependEvent(store, { kind: "broker.updated", title: "Broker pack updated", detail: `${connection.label} is ${connection.enabled ? "enabled" : "disabled"} in read-only ${connection.paper ? "paper/demo" : "data"} mode.` });
    return connection;
  });
}

export async function updateBrokerConnectionHealth(id: string, input: {
  health: TradingBrokerConnection["health"];
  detail: string;
  checkedAt?: string;
}): Promise<TradingBrokerConnection> {
  return mutateStore((store) => {
    const connection = store.connections.find((item) => item.id === id);
    if (!connection) throw new Error("Broker connection not found.");
    connection.health = input.health;
    connection.healthDetail = text(input.detail, 500);
    connection.lastCheckedAt = input.checkedAt || nowIso();
    connection.updatedAt = nowIso();
    prependEvent(store, { kind: "broker.checked", title: "Broker pack checked", detail: `${connection.label}: ${connection.healthDetail}` });
    return connection;
  });
}

export async function reconcileObservedPosition(input: {
  accountId: string;
  asset: string;
  assetClass: TradingAssetClass;
  observedQuantity: number;
  trackedQuantity: number;
  observedCostBasisUsd?: number;
  trackedCostBasisUsd?: number;
  source: string;
}): Promise<TradingReconciliation> {
  return mutateStore((store) => {
    const quantityDelta = finite(input.observedQuantity) - finite(input.trackedQuantity);
    const costBasisDeltaUsd = input.observedCostBasisUsd === undefined || input.trackedCostBasisUsd === undefined
      ? undefined
      : finite(input.observedCostBasisUsd) - finite(input.trackedCostBasisUsd);
    const matched = Math.abs(quantityDelta) < 1e-8 && (costBasisDeltaUsd === undefined || Math.abs(costBasisDeltaUsd) < 0.01);
    const item: TradingReconciliation = {
      id: `trec_${randomUUID()}`,
      accountId: text(input.accountId, 160),
      asset: text(input.asset, 80).toUpperCase(),
      assetClass: input.assetClass,
      observedQuantity: finite(input.observedQuantity),
      trackedQuantity: finite(input.trackedQuantity),
      quantityDelta,
      observedCostBasisUsd: input.observedCostBasisUsd === undefined ? undefined : positive(input.observedCostBasisUsd),
      trackedCostBasisUsd: input.trackedCostBasisUsd === undefined ? undefined : positive(input.trackedCostBasisUsd),
      costBasisDeltaUsd,
      status: matched ? "matched" : "attention",
      source: text(input.source, 160) || "external account",
      reconciledAt: nowIso(),
    };
    store.reconciliations = [item, ...store.reconciliations].slice(0, MAX_RECONCILIATIONS);
    prependEvent(store, {
      kind: "position.reconciled",
      title: matched ? "Position reconciled" : "Position needs attention",
      detail: matched ? `${item.asset} quantity and cost basis match.` : `${item.asset} quantity delta ${quantityDelta}; review the external account.`,
      accountId: item.accountId,
      asset: item.asset,
    });
    return item;
  });
}

function scheduledSnapshotDue(store: TradingControlStore, now: number) {
  const latest = store.snapshots.map((item) => Date.parse(item.capturedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return latest === undefined || now - latest >= store.config.snapshotCadenceMinutes * 60_000;
}

export async function readTradingControlOverview(options: { ensureScheduledSnapshot?: boolean; now?: string } = {}): Promise<TradingControlOverview> {
  if (options.ensureScheduledSnapshot) {
    const at = options.now && Number.isFinite(Date.parse(options.now)) ? Date.parse(options.now) : Date.now();
    const current = await readTradingControlStore();
    if (Object.keys(current.simulator.accounts).length && scheduledSnapshotDue(current, at)) {
      await mutateStore((store) => {
        if (Object.keys(store.simulator.accounts).length && scheduledSnapshotDue(store, at)) {
          captureSimulatorSnapshot(store, "scheduled", nowIso(at));
        }
      });
    }
  }
  return readTradingControlStore();
}
