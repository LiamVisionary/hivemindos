import type { ReasoningTrail } from "@/lib/types/reasoning-trail";
import type { HyperliquidOrderSummary } from "@/lib/services/trading/hyperliquid";

export function hyperliquidOrderReasoning(order: HyperliquidOrderSummary): Partial<ReasoningTrail> {
  return {
    summary: "This is a Hyperliquid order from the agent wallet.",
    whyNow: order.reduceOnly
      ? "Reduce-only orders still pass the company governance check before execution."
      : "The order notional crossed a wallet governance rule and was paused before execution.",
    impact: order.reduceOnly
      ? "Approving lets the reduce-only order continue. Rejecting stops this order attempt."
      : `Approving lets the agent place about $${order.notionalUsd.toFixed(2)} on Hyperliquid. Rejecting keeps the order blocked.`,
    requestedAction: "Approve only if the market, side, size, and notional match the intended trading plan.",
    evidence: [
      `Market: ${order.coin}`,
      `Side: ${order.side}`,
      `Notional: $${order.notionalUsd.toFixed(2)}`,
      `Reduce only: ${order.reduceOnly ? "yes" : "no"}`,
    ],
    missingContext: [],
    source: "Hyperliquid order governance",
  };
}

export function hyperliquidValueTransferReasoning(amountUsd: number, target: string): Partial<ReasoningTrail> {
  return {
    summary: "This is a Hyperliquid value-transfer action from the agent wallet.",
    whyNow: "The action value crossed a wallet governance rule and was paused before execution.",
    impact: `Approving lets the Hyperliquid action continue for about $${amountUsd.toFixed(2)}. Rejecting keeps it blocked.`,
    requestedAction: "Approve only if this Hyperliquid action and value are expected.",
    evidence: [
      `Target: ${target}`,
      `Value: $${amountUsd.toFixed(2)}`,
    ],
    missingContext: [],
    source: "Hyperliquid value transfer governance",
  };
}
