---
title: "Stock Trading"
---

# Stock Trading

Buy and sell stocks right from HivemindOS, in the **Trade tab → Stocks** or by asking
an agent ("buy $25 of AAPL", "sell my AAPL"). There are four ways to trade, and you can
practice for free before risking real money.

## Four ways to trade

- **Alpaca** — a real, regulated US stock brokerage. Place market buy and sell orders
  on normal stocks. Starts in **paper** (practice) mode; you opt in to live trading.
- **Robinhood Agentic Trading** — connect Robinhood's official Trading MCP with
  browser sign-in, then place long-equity market orders in the dedicated Robinhood
  Agentic brokerage account. HivemindOS asks Robinhood to review the order first,
  shows the returned review and warnings, and requires a separate confirmation before
  placing it.
- **xStocks** — tokenized versions of stocks that trade on-chain (on Solana). Buying
  uses your USDC; selling turns the position back into USDC. Good if you'd rather keep
  everything crypto-native. (Needs a Solana wallet with a little SOL for fees.)
- **Robinhood Chain Stock Tokens** — eligible stock and ETF tokens that trade on
  Robinhood Chain. Buying uses USDG; selling turns the position back into USDG.
  Good if you want tokenized equity exposure on an EVM chain. (Needs a Robinhood
  Chain wallet with USDG plus ETH gas.)

You choose the venue per agent in the **Wallets** screen, along with how much it's
allowed to trade at once.

## Practice first: paper trading

The Stocks screen has a **Paper trading** toggle:

- **On (default)** — orders run against a free, simulated Alpaca account. You get a
  real-looking portfolio and fills, but **no real money moves and no real stock is
  bought.** Perfect for trying it out.
- **Off (live)** — real orders with real money. This only works if you've turned on
  live trading for that wallet, so you can't flip to live by accident.

A **portfolio panel** shows the selected account's value, cash, buying power, and your
open positions with profit/loss — for whichever mode (paper or live) you're viewing.

## Setting up Alpaca

Alpaca gives you **separate logins for practice and live**, so you add separate keys:

- **Paper (practice):** add `ALPACA_PAPER_API_KEY_ID` and `ALPACA_PAPER_API_SECRET_KEY`
  to your shared env. Generate them from Alpaca's dashboard with the account switched to
  "Paper."
- **Live (real money):** add `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`. Generate
  these with the account on "Live."

Only the key **names** are stored — never the values themselves. xStocks and
Robinhood Chain Stock Tokens need no brokerage keys; they sign from your own wallet.

## Connecting Robinhood Agentic Trading

1. Open **Integrations → MCP Servers**.
2. Select **Connect Robinhood** and finish Robinhood's browser authorization.
3. If Robinhood returns more than one account, choose the dedicated **Agentic** account.
4. In Wallet settings or the Trade tab, choose **Robinhood Agentic** as that wallet's
   stock-trading venue.

The connection uses Robinhood's OAuth flow; there is no Robinhood password or API key
to paste into HivemindOS. OAuth tokens, registered-client details, and reconnect state
are stored locally in an encrypted HivemindOS vault. Disconnect removes that local
session; you can separately revoke the authorization from Robinhood account settings.

Robinhood grants the connected agent read access to authorized account numbers,
positions, balances, transactions, order history, watchlists, and scans. HivemindOS
only exposes an explicit read-tool allowlist to agents. Robinhood's raw order-placement,
order-cancel, watchlist-mutation, and scan-mutation tools are not exposed directly.
Equity placement and cancellation go through the governed HivemindOS trade route.

## Confirmations & limits

- Every buy and sell asks you to confirm before it runs.
- Each agent has a **max per-trade amount**, so a single order can't exceed what you
  allow.
- A buy spends money, so it counts toward your spending limits. A sell brings money in,
  and a paper trade isn't real money — neither counts against your budgets. If you've
  frozen a company, even practice trades are blocked.
- Official builds use the HivemindOS platform fee on xStocks, Robinhood Chain Stock
  Tokens, Robinhood Agentic orders, and live Alpaca orders: **1% with a $0.01 minimum**.
  A `$100` live brokerage or tokenized-stock order produces a `$1.00` platform fee.
  The preview shows it before you confirm, and the fee is collected as its own USDC or
  USDG transaction after the order is accepted or the swap completes. Paper trading
  does not charge this fee.
- Robinhood Chain Stock Tokens can be blocked by upstream liquidity, legal, or
  eligibility rules. When that happens, HivemindOS shows the block instead of trying
  to route around it.

## A note on market hours

Alpaca and Robinhood Agentic brokerage orders follow the market sessions and order
handling supported by those brokers. An order submitted while its market is closed may
queue for the next eligible session. Robinhood Chain Stock Tokens and xStocks are
on-chain markets instead; availability depends on the venue's live liquidity and the
user's jurisdiction rather than this brokerage-hours rule.

Trades show up in **Wallets · Activity** alongside everything else.

See [Safety & Limits](governance.html) for the full picture on caps and confirmations.
