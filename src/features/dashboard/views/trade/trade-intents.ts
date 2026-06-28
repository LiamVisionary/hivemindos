/* The crypto capability catalog the Trade tab surfaces. Each entry maps a
   user-facing action to a `crypto-capability-router` intent and the inputs that
   intent needs. The router decides which configured provider serves it. */

export type CryptoIntentInputKind =
  | "prompt" // natural-language Bankr action (swap, perps, prediction, etc.)
  | "recipient-amount" // address + USD amount (+ asset for private transfer)
  | "url" // paid API call: URL + method + max USD
  | "amount" // USD amount only (fund credits)
  | "address" // read-only receive address
  | "info" // informational / hand-off (e.g. cards)
  | "none"; // read-only action with no inputs

export type CryptoIntentDef = {
  id: string;
  label: string;
  desc: string;
  group: string;
  input: CryptoIntentInputKind;
  /** Whether the action moves money / changes state (vs a read). */
  mutating: boolean;
  promptPlaceholder?: string;
  withAsset?: boolean;
};

export const CRYPTO_INTENT_GROUPS = ["Trade & markets", "Move money", "Pay & fund", "Read"] as const;

export const CRYPTO_INTENTS: CryptoIntentDef[] = [
  { id: "trade", label: "Swap / Trade", desc: "Spot buy or sell a token", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "swap $50 USDC to ETH" },
  { id: "crosschain-swap", label: "Cross-chain swap", desc: "Swap across chains", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "swap 100 USDC on Base to SOL on Solana" },
  { id: "bridge", label: "Bridge", desc: "Move a token between chains", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "bridge 0.2 ETH from Base to Arbitrum" },
  { id: "hyperliquid", label: "Hyperliquid", desc: "Spot, perps, orders", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "quote a $25 ETH long or buy HYPE spot" },
  { id: "polymarket", label: "Prediction markets", desc: "Search or bet on Polymarket", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "bet $20 yes on the next Fed cut market" },
  { id: "token-launch", label: "Launch a token", desc: "Deploy a new token", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "launch a token called HIVE BEE, ticker BEE" },
  { id: "claim-fees", label: "Claim fees", desc: "Collect creator & LP trading fees", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "claim my creator fees for BEE" },
  { id: "nft", label: "NFTs", desc: "Buy, sell, or mint NFTs", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "buy the floor of <collection>" },
  { id: "automation", label: "Automations", desc: "DCA, TWAP, limit, stop", group: "Trade & markets", input: "prompt", mutating: true, promptPlaceholder: "DCA $25 into ETH every day" },
  { id: "copy-trading", label: "Copy trading", desc: "Auto-mirror a wallet's trades", group: "Trade & markets", input: "info", mutating: true },

  { id: "send", label: "Send USDC", desc: "On-chain USDC transfer", group: "Move money", input: "recipient-amount", mutating: true },
  { id: "private-transfer", label: "Private transfer", desc: "Shielded USDC / ETH via Veil", group: "Move money", input: "recipient-amount", mutating: true, withAsset: true },
  { id: "crosschain-payment", label: "Cross-chain pay", desc: "Pay an address on another chain", group: "Move money", input: "prompt", mutating: true, promptPlaceholder: "pay 50 USDC on Base to 0x… as a recipient on Polygon" },
  { id: "receive", label: "Receive", desc: "Show a deposit address", group: "Move money", input: "address", mutating: false },

  { id: "paid-api", label: "Pay an API (x402)", desc: "Pay-per-call HTTP 402", group: "Pay & fund", input: "url", mutating: true },
  { id: "private-paid-api", label: "Private API pay", desc: "x402 via a fresh Veil payer", group: "Pay & fund", input: "url", mutating: true },
  { id: "fund-llm-credits", label: "Fund LLM credits", desc: "Top up Bankr LLM credits", group: "Pay & fund", input: "amount", mutating: true },
  { id: "card-payment", label: "Card payment", desc: "Virtual-card checkout (MoneyClaw)", group: "Pay & fund", input: "info", mutating: true },

  { id: "portfolio", label: "Portfolio", desc: "Read balances, PnL, positions", group: "Read", input: "none", mutating: false },
];

export const STOCK_SIDES = ["buy", "sell"] as const;

/** Common Alpaca symbols for the picker (Alpaca accepts any valid US ticker). */
export const COMMON_ALPACA_TICKERS = [
  "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "META", "COIN",
  "SPY", "QQQ", "MSTR", "AMD", "HOOD", "CRCL", "NFLX", "PLTR",
];
