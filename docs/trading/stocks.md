---
title: "Stock Trading"
---

# Stock Trading

Buy and sell stocks right from HivemindOS, in the **Trade tab → Stocks** or by asking
an agent ("buy $25 of AAPL", "sell my AAPL"). There are two ways to trade, and you can
practice for free before risking real money.

## Two ways to trade

- **Alpaca** — a real, regulated US stock brokerage. Place market buy and sell orders
  on normal stocks. Starts in **paper** (practice) mode; you opt in to live trading.
- **xStocks** — tokenized versions of stocks that trade on-chain (on Solana). Buying
  uses your USDC; selling turns the position back into USDC. Good if you'd rather keep
  everything crypto-native. (Needs a Solana wallet with a little SOL for fees.)

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

Only the key **names** are stored — never the values themselves. xStocks needs no keys
(it signs from your own Solana wallet).

## Confirmations & limits

- Every buy and sell asks you to confirm before it runs.
- Each agent has a **max per-trade amount**, so a single order can't exceed what you
  allow.
- A buy spends money, so it counts toward your spending limits. A sell brings money in,
  and a paper trade isn't real money — neither counts against your budgets. If you've
  frozen a company, even practice trades are blocked.

## A note on market hours

Stock orders only fill while the US market is open. If you place one when the market's
closed, it queues and fills at the next open — that's normal, not an error.

Trades show up in **Wallets · Activity** alongside everything else.

See [Safety & Limits](governance.html) for the full picture on caps and confirmations.
