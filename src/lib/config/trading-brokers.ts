import type { TradingBrokerPackId } from "@/lib/types/trading-control";

export type TradingBrokerPackCapability = "health" | "market-data" | "portfolio" | "orders";

export type TradingBrokerPackDefinition = {
  id: TradingBrokerPackId;
  label: string;
  summary: string;
  supportedModes: Array<"read-only" | "paper">;
  capabilities: Record<TradingBrokerPackCapability, boolean>;
  setup: string;
};

export const TRADING_BROKER_PACK_MATRIX: Record<TradingBrokerPackId, TradingBrokerPackDefinition> = {
  ccxt: {
    id: "ccxt",
    label: "Exchange data pack",
    summary: "A CCXT-shaped, read-only market-data adapter for supported public exchange APIs.",
    supportedModes: ["read-only", "paper"],
    capabilities: { health: true, "market-data": true, portfolio: false, orders: false },
    setup: "Choose Coinbase or Kraken. Public market data needs no exchange API key.",
  },
  ibkr: {
    id: "ibkr",
    label: "Interactive Brokers paper",
    summary: "Read-only health and portfolio discovery through a locally configured Client Portal Gateway.",
    supportedModes: ["read-only", "paper"],
    capabilities: { health: true, "market-data": false, portfolio: true, orders: false },
    setup: "Run the IBKR Client Portal Gateway in paper mode and set IBKR_GATEWAY_URL in the runtime environment.",
  },
};

export function tradingBrokerPacks() {
  return Object.values(TRADING_BROKER_PACK_MATRIX);
}
