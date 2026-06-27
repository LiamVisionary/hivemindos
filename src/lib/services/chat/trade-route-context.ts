/**
 * Route-aware capability briefing for the Trade desk + Wallets screen.
 *
 * Surfaced through the dashboard screen context (DashboardScreenContext.capabilities)
 * so the hive — both the Queen router and the executing agent — knows what the
 * user can actually do from these money screens without depending on a per-turn
 * capability-search race. Each line is capability-level (what is possible),
 * gated at runtime by the real credential/readiness checks the trade rails run
 * (`/api/crypto/capabilities`, `/api/trading` readiness), so it never asserts a
 * specific rail is live.
 *
 * Pure data — no server-only imports — so it is safe to import into the client
 * dashboard. This text is prepended to the user's message before the executing
 * agent's natural-language send/swap interceptors parse it, so it MUST avoid:
 *   • raw 0x/base58 addresses and "to/from <addr>" phrasing (mis-captured as a
 *     recipient/source), and
 *   • the words private/privately/veil/shield/shielded and "http(s)://"
 *     (those make parseSendRequest/parseSwapRequest bail, silently disabling the
 *     deterministic acting-wallet default-source). Guarded by
 *     scripts/test-acting-wallet-context.mjs (pnpm test:acting-wallet-context).
 */

/** xStocks on-chain tokenized-equity allowlist (mirrors lib/config/xstocks-tokens). */
const XSTOCK_TICKERS = "AAPL, NVDA, TSLA, MSFT, AMZN, GOOGL, META, COIN, QQQ, MSTR, AMD, HOOD, CRCL, SPY";

export const TRADE_ROUTE_CAPABILITY_LINES: readonly string[] = [
  "Crypto swap: on-chain DEX (0x on Base, Jupiter on Solana) for the acting wallet, or Bankr for cross-chain/general swaps. Local swaps carry a hard per-swap USD cap and need a CONFIRM_SWAP reply.",
  "Send/transfer USDC: governed send from the acting wallet; needs a SEND_USDC reply, and personal wallets always require that confirmation and never auto-send.",
  "Hyperliquid: open/close perps and spot, set leverage and margin, place TWAPs, and transfer/withdraw — each with its own confirmation token (CONFIRM_HYPERLIQUID_ORDER, _BUILDER, _CANCEL, _ACCOUNT, _TRANSFER, _TWAP).",
  "Stocks via Alpaca: buy and sell with market orders, paper by default and live only when the acting wallet has live Alpaca keys configured; buys need CONFIRM_BUY and sells need CONFIRM_SELL. A paper-configured wallet cannot escalate to live.",
  "Paper stock trades: the default Alpaca venue — fully simulated, no real money and no platform fee; switch a wallet to live only deliberately.",
  `xStocks (on-chain tokenized equities): buy/sell by swapping USDC via Jupiter on a Solana acting wallet; allowlisted tickers only — ${XSTOCK_TICKERS}.`,
  "Bankr (when a Bankr wallet is the acting wallet, or a Bankr key is configured): launch a token (creator earns 57% of the 1.2% swap fee), bet on Polymarket, buy/sell/mint NFTs, set recurring automations (DCA/TWAP/limit/stop), and run Bankr Agent jobs.",
  "HivemindOS platform fee: a small percentage of each trade, swap, and send is automatically taken from the acting wallet and paid to the HivemindOS platform — it is built in and collected on every applicable action, never something the user triggers and never paid to the user.",
  "Claiming the wallet's OWN earnings: to collect creator or token fees the acting wallet has earned (e.g. from a token it launched), route that through the wallet's provider — a Bankr wallet claims its creator fees through the Bankr agent into that same wallet. This is separate from the HivemindOS platform fee above.",
  "Portfolio/balances: read the acting wallet's crypto holdings, the stock portfolio (Alpaca account), and the unified spend-activity ledger; read-only checks need no confirmation.",
];

/** A short capability subset for the Wallets screen (account-management focus). */
export const WALLET_ROUTE_CAPABILITY_LINES: readonly string[] = [
  "Send/transfer USDC: governed send from the selected wallet; needs a SEND_USDC reply, and personal wallets always require it.",
  "Fund an agent: move USDC from a personal/managed wallet into a governed agent wallet.",
  "Swap and trade: open the Trade desk for swaps, Hyperliquid, and stock/xStock trades against the acting wallet.",
  "Fees: HivemindOS automatically takes its platform fee from the selected wallet on each trade and send, paid to the HivemindOS platform (built in, not user-triggered). To claim the wallet's OWN earned creator/token fees, route through its provider — e.g. a Bankr wallet claims its creator fees through the Bankr agent into that wallet.",
  "Balances/usage: read the selected wallet's balance, honey ledger, and runtime spend; read-only checks need no confirmation.",
];

export function tradeRouteCapabilities(): string[] {
  return [...TRADE_ROUTE_CAPABILITY_LINES];
}

export function walletRouteCapabilities(): string[] {
  return [...WALLET_ROUTE_CAPABILITY_LINES];
}
