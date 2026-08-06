import type { NextRequest } from "next/server";

import { tradingBrokerPacks } from "@/lib/config/trading-brokers";
import { probeTradingBrokerPack } from "@/lib/services/trading/broker-packs";
import {
  approveTradePlan,
  assertTradePlanExecutable,
  capturePortfolioSnapshot,
  createTradePlan,
  createTradingThesis,
  readTradingControlOverview,
  recordLiveTradePlanResult,
  reconcileObservedPosition,
  rejectTradePlan,
  setTradingAccountPolicy,
  simulateTradePlan,
  updateBrokerConnectionHealth,
  updateTradingControlConfig,
  updateTradingThesis,
  upsertBrokerConnection,
} from "@/lib/services/trading/trading-control-store";
import type {
  PortfolioAccountSnapshot,
  TradeProposal,
  TradingAssetClass,
  TradingBrokerConnection,
  TradingControlConfig,
  TradingExecutionMode,
  TradingThesis,
  TradingThesisStatus,
} from "@/lib/types/trading-control";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ControlAction =
  | "config.update"
  | "account-policy.update"
  | "plan.create"
  | "plan.approve"
  | "plan.reject"
  | "plan.simulate"
  | "plan.record-external"
  | "plan.assert-live"
  | "snapshot.capture"
  | "thesis.create"
  | "thesis.update"
  | "broker.upsert"
  | "broker.probe"
  | "position.reconcile";

type ControlBody = {
  action?: ControlAction;
  id?: string;
  note?: string;
  title?: string;
  thesis?: string;
  evidence?: string[];
  missingContext?: string[];
  proposal?: TradeProposal;
  config?: Partial<TradingControlConfig>;
  accountId?: string;
  readOnly?: boolean;
  executionMode?: TradingExecutionMode;
  accounts?: PortfolioAccountSnapshot[];
  reason?: "manual" | "event" | "scheduled" | "reconciliation";
  asset?: string;
  assetClass?: TradingAssetClass;
  direction?: TradingThesis["direction"];
  conviction?: TradingThesis["conviction"];
  summary?: string;
  invalidation?: string;
  catalysts?: string[];
  reviewCadenceDays?: number;
  status?: TradingThesisStatus;
  connection?: Partial<TradingBrokerConnection>;
  observedQuantity?: number;
  trackedQuantity?: number;
  observedCostBasisUsd?: number;
  trackedCostBasisUsd?: number;
  source?: string;
  executionStatus?: string;
  reference?: string;
  detail?: string;
  filled?: boolean;
  filledQuantity?: number;
  fillPrice?: number;
  feesUsd?: number;
};

function required(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function object<T extends object>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is required.`);
  return value as T;
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const overview = await readTradingControlOverview({ ensureScheduledSnapshot: true });
    return okJson({ overview, brokerPacks: tradingBrokerPacks() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Trading controls could not be loaded.", 500);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = (await request.json().catch(() => ({}))) as ControlBody;
    const action = body.action;
    if (!action) return errorJson("A trading-control action is required.");

    if (action === "config.update") {
      const overview = await updateTradingControlConfig(object<Partial<TradingControlConfig>>(body.config, "Trading config"));
      return okJson({ overview });
    }

    if (action === "account-policy.update") {
      const overview = await setTradingAccountPolicy({
        accountId: required(body.accountId, "Account id"),
        readOnly: Boolean(body.readOnly),
        executionMode: body.executionMode,
      });
      return okJson({ overview });
    }

    if (action === "plan.create") {
      const plan = await createTradePlan({
        title: body.title,
        proposal: object<TradeProposal>(body.proposal, "Trade proposal"),
        thesis: body.thesis,
        evidence: body.evidence,
        missingContext: body.missingContext,
      });
      return okJson({ plan }, { status: 201 });
    }

    if (action === "plan.approve") {
      return okJson({ plan: await approveTradePlan(required(body.id, "Plan id"), body.note) });
    }

    if (action === "plan.reject") {
      return okJson({ plan: await rejectTradePlan(required(body.id, "Plan id"), body.note) });
    }

    if (action === "plan.simulate") {
      return okJson({ plan: await simulateTradePlan(required(body.id, "Plan id")) });
    }

    if (action === "plan.record-external") {
      const submittedAt = new Date().toISOString();
      const plan = await recordLiveTradePlanResult({
        planId: required(body.id, "Plan id"),
        execution: {
          status: body.executionStatus?.trim() || (body.filled ? "filled" : "submitted"),
          reference: body.reference?.trim() || undefined,
          detail: required(body.detail, "Execution detail"),
          submittedAt,
          filledAt: body.filled ? submittedAt : undefined,
          filledQuantity: body.filledQuantity,
          fillPrice: body.fillPrice,
          feesUsd: body.feesUsd,
        },
      });
      return okJson({ plan });
    }

    if (action === "plan.assert-live") {
      const id = required(body.id, "Plan id");
      const overview = await readTradingControlOverview();
      const plan = overview.plans.find((item) => item.id === id);
      if (!plan) return errorJson("Trade plan not found.", 404);
      await assertTradePlanExecutable({
        planId: plan.id,
        accountId: plan.proposal.accountId,
        agentId: plan.proposal.agentId,
        asset: plan.proposal.asset,
        notionalUsd: plan.proposal.notionalUsd,
        side: plan.proposal.side,
        orderType: plan.proposal.orderType,
      });
      return okJson({ plan });
    }

    if (action === "snapshot.capture") {
      const accounts = Array.isArray(body.accounts) ? body.accounts : [];
      return okJson({ snapshot: await capturePortfolioSnapshot({ accounts, reason: body.reason ?? "manual" }) }, { status: 201 });
    }

    if (action === "thesis.create") {
      const thesis = await createTradingThesis({
        title: required(body.title, "Thesis title"),
        asset: required(body.asset, "Asset"),
        assetClass: body.assetClass ?? "stock",
        direction: body.direction,
        conviction: body.conviction,
        summary: required(body.summary, "Thesis summary"),
        invalidation: body.invalidation,
        catalysts: body.catalysts,
        reviewCadenceDays: body.reviewCadenceDays,
      });
      return okJson({ thesis }, { status: 201 });
    }

    if (action === "thesis.update") {
      const thesis = await updateTradingThesis(required(body.id, "Thesis id"), {
        status: body.status,
        note: body.note,
        summary: body.summary,
        invalidation: body.invalidation,
        conviction: body.conviction,
      });
      return okJson({ thesis });
    }

    if (action === "broker.upsert") {
      const input = object<Partial<TradingBrokerConnection>>(body.connection, "Broker connection");
      if (input.packId !== "ccxt" && input.packId !== "ibkr") return errorJson("Choose a supported broker pack.");
      const connection = await upsertBrokerConnection({
        id: required(input.id, "Connection id"),
        packId: input.packId,
        label: required(input.label, "Connection label"),
        enabled: Boolean(input.enabled),
        readOnly: true,
        paper: true,
        settings: input.settings ?? {},
      });
      return okJson({ connection });
    }

    if (action === "broker.probe") {
      const id = required(body.id, "Connection id");
      const overview = await readTradingControlOverview();
      const connection = overview.connections.find((item) => item.id === id);
      if (!connection) return errorJson("Broker connection not found.", 404);
      const probe = await probeTradingBrokerPack(connection);
      const updated = await updateBrokerConnectionHealth(id, { health: probe.health, detail: probe.detail, checkedAt: probe.checkedAt });
      return okJson({ connection: updated, probe });
    }

    if (action === "position.reconcile") {
      const reconciliation = await reconcileObservedPosition({
        accountId: required(body.accountId, "Account id"),
        asset: required(body.asset, "Asset"),
        assetClass: body.assetClass ?? "stock",
        observedQuantity: Number(body.observedQuantity),
        trackedQuantity: Number(body.trackedQuantity),
        observedCostBasisUsd: body.observedCostBasisUsd,
        trackedCostBasisUsd: body.trackedCostBasisUsd,
        source: required(body.source, "Reconciliation source"),
      });
      return okJson({ reconciliation });
    }

    return errorJson(`Unsupported trading-control action "${action}".`);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Trading-control action failed.");
  }
}
