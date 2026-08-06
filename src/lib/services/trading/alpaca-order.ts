import type { TradingOrderType, TradingTimeInForce } from "@/lib/types/trading-control";

export type AlpacaSupportedOrderType = Extract<TradingOrderType, "market" | "limit" | "stop" | "stop_limit">;
export type AlpacaTimeInForce = Extract<TradingTimeInForce, "day" | "gtc" | "ioc" | "fok">;

export type AlpacaOrderPayload = {
  symbol: string;
  side: "buy" | "sell";
  type: AlpacaSupportedOrderType;
  time_in_force: AlpacaTimeInForce;
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
};

function positive(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function decimal(value: number) {
  return String(Number(value.toFixed(8)));
}

export function buildAlpacaOrderPayload(input: {
  ticker: string;
  side: "buy" | "sell";
  notionalUsd: number;
  qty?: number;
  orderType?: AlpacaSupportedOrderType;
  timeInForce?: AlpacaTimeInForce;
  limitPrice?: number;
  stopPrice?: number;
}): AlpacaOrderPayload {
  const symbol = String(input.ticker || "").trim().toUpperCase();
  if (!symbol) throw new Error("A stock symbol is required.");
  const orderType = input.orderType ?? "market";
  const timeInForce = input.timeInForce ?? "day";
  const base: AlpacaOrderPayload = {
    symbol,
    side: input.side,
    type: orderType,
    time_in_force: timeInForce,
  };

  if (orderType === "market") {
    if (input.qty && input.qty > 0) return { ...base, qty: decimal(positive(input.qty, "Share quantity")) };
    return { ...base, notional: positive(input.notionalUsd, "Trade amount").toFixed(2) };
  }

  const qty = positive(input.qty, "Share quantity");
  const next: AlpacaOrderPayload = { ...base, qty: decimal(qty) };
  if (orderType === "limit" || orderType === "stop_limit") {
    next.limit_price = decimal(positive(input.limitPrice, "Limit price"));
  }
  if (orderType === "stop" || orderType === "stop_limit") {
    next.stop_price = decimal(positive(input.stopPrice, "Stop price"));
  }
  return next;
}
