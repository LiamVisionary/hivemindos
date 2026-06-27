"use client";

/* trade-context.tsx — the data contract for the redesigned Trade desk.

   TradePanel builds a TradeDeskData from REAL data (wallet picker + balances,
   Alpaca portfolio, live market data, FX, the spend-ledger activity feed) and
   provides it here. The presentational view + its order tickets + capability
   rail read it through useTradeDesk(). Money actually moves via the typed
   trade-api fetchers the tickets call directly with this identity — the context
   carries data + identity + navigation, not execution. */

import React from "react";
import type { CryptoCapabilityMap } from "@/features/dashboard/views/trade/trade-api";

export type DeskWalletKind = "user" | "agent" | "bankr";

export type DeskWallet = {
  id: string;
  name: string;
  short: string;
  kind: DeskWalletKind;
  custody: string;
  /** Truncated address for the header chip. */
  addr: string;
  /** Full address for the Receive action. */
  fullAddress: string;
  network: string;
  /** Per-trade USD guardrail cap (null = none / your custody). */
  cap: number | null;
};

export type DeskHolding = {
  /** Stable unique row identity (crypto: token mint/contract; stocks: ticker).
     Used as the React list key so two distinct holdings that share a display
     symbol — e.g. two Solana mints both labelled "USGR" — don't collide. */
  id: string;
  sym: string;
  name: string;
  amount: number;
  /** Stocks carry share count instead of token amount. */
  shares?: number;
  usd: number;
  chg: number;
};

export type DeskPortfolio = {
  rows: DeskHolding[];
  total: number;
  dayChange: number;
  dayPct: number;
  /** Real value-history series (USD) for the sparkline; empty when unavailable. */
  history: number[];
  /**
   * Set when the live balance/portfolio read FAILED (RPC timeout, rate limit, no
   * server, …). Lets the hero distinguish a failed read (show this + Refresh) from
   * a genuinely empty wallet ($0.00 is real). Null/undefined = loaded cleanly.
   */
  error?: string | null;
};

export type DeskMover = { sym: string; name: string; price: number; chg: number; history: number[] };

export type DeskActivity = {
  id: string;
  kind: string;
  text: string;
  via: string;
  wid: string;
  when: string;
  hrs: number;
  usd: number;
  state: string;
  src: "crypto" | "stocks";
};

export type DeskStockReadiness = {
  venue: "alpaca" | "xstocks" | null;
  liveEnabled: boolean;
  venueReady: boolean;
  paperConfigured: boolean;
  liveConfigured: boolean;
  paperKeys: string[];
  liveKeys: string[];
  buyingPower: number;
  confirmations: { buy: string; sell: string };
  account: { equity: number; cash: number; buyingPower: number; portfolioValue: number; status: string } | null;
  /** xStocks ticker allowlist (when the venue is xstocks). */
  xstockTickers: string[];
};

export type TradeDeskData = {
  // identity
  agentId: string;
  wallet: DeskWallet;
  walletConfig: Record<string, unknown> | null;
  walletKind: DeskWalletKind;
  network: string;
  isEvmWallet: boolean;
  isSolanaWallet: boolean;
  hasActingWallet: boolean;
  /** Chains the ACTING wallet holds — the action chain dropdown (swap/buy/sell). */
  walletChains: Array<{ key: string; label: string; network: string; accountId: string }>;
  /** Switch the acting wallet to its account on `network` (re-points execution). */
  onSelectChain: (network: string) => void;
  /** Short labels of every chain the user holds across personal + agent wallets;
   *  used to filter the bridge / cross-chain action dropdowns. */
  availableChains: string[];

  // status
  loading: boolean;

  // crypto
  cryptoPortfolio: DeskPortfolio;
  cryptoBalances: Record<string, number>;
  cryptoMovers: DeskMover[];
  swapTokens: string[];
  swapMaxUsd: number;
  cryptoCaps: CryptoCapabilityMap | null;

  // stocks
  stockPortfolio: DeskPortfolio;
  stockMovers: DeskMover[];
  stockReadiness: DeskStockReadiness;
  paper: boolean;
  setPaper: (paper: boolean) => void;

  // activity
  activity: DeskActivity[];
  /** Resolve an activity executor id → display name + kind (for attribution chips). */
  actors: Record<string, { name: string; kind: DeskWalletKind }>;

  // fx
  currency: string;
  fxRates: Record<string, number>;
  setCurrency: (currency: string) => void;

  // theming
  theme: "light" | "dark";

  // navigation + lifecycle
  onChangeWallet: () => void;
  onOpenView: (view: string) => void;
  refresh: () => void;
};

const TradeDeskContext = React.createContext<TradeDeskData | null>(null);

export function TradeDeskProvider({ value, children }: { value: TradeDeskData; children: React.ReactNode }) {
  return <TradeDeskContext.Provider value={value}>{children}</TradeDeskContext.Provider>;
}

export function useTradeDesk(): TradeDeskData {
  const value = React.useContext(TradeDeskContext);
  if (!value) throw new Error("useTradeDesk must be used within a TradeDeskProvider");
  return value;
}
