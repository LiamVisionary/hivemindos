/* index.ts — barrel export for the redesigned Trade desk ("The Desk"). */

export { TradeView, default } from "./TradeView";
export { TradeDeskProvider, useTradeDesk } from "./trade-context";
export type {
  TradeDeskData, DeskWallet, DeskWalletKind, DeskHolding, DeskPortfolio,
  DeskMover, DeskActivity, DeskStockReadiness,
} from "./trade-context";
