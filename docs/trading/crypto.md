---
title: "Crypto Trading"
---

# Crypto Trading

Everything you can do with crypto in HivemindOS, in one place. Pick an action in the
**Trade tab → Crypto**, or just describe it to an agent. You'll always see a preview
and confirm before anything moves.

## Move your own money

These spend from the wallet you've selected.

- **Swap** — trade one token for another, on Base or Solana (for example, USDC → ETH).
  Built-in swaps are capped at a small amount per swap as a safety rail. Works with
  both your personal wallet and agent wallets.
- **Send USDC** — send dollars (USDC) to any address. Your personal wallet always asks
  you to confirm; an agent wallet follows the limits you set for it.
- **Private transfer** — send USDC or ETH privately through Veil, so the amount and
  destination aren't openly linked to you. (Private sends to a public address have a
  small minimum.)
- **Pay an API (x402)** — pay-per-use online services that charge tiny amounts per
  request. HivemindOS handles the payment and gets you the result.
- **Receive** — show a deposit address so you (or anyone) can add funds to a wallet.

## Trade Hyperliquid perps with your wallet

HivemindOS can place local Hyperliquid perpetual futures trades from a selected EVM
wallet. These trades use that wallet's own Hyperliquid account and collateral, not
HivemindOS funds and not Bankr's wallet.

You can:

- Go long or short on BTC, ETH, SOL, and HYPE perps.
- Use market or limit orders.
- Set a market slippage guard.
- Mark a trade as **reduce only** when you want to close or shrink a position.
- Refresh account value, open positions, and builder-fee approval state.
- Ask an agent to quote, review, and place the trade under the same wallet limits.

The official HivemindOS builder fee is **0.5 bps (0.005%)** of filled notional. You
approve that fee separately before the first local Hyperliquid trade that needs it.
See [Hyperliquid Perps](hyperliquid.html) for the full user guide.

## Trade & explore with Bankr

These run through **Bankr**, a connected trading service. Heads up: they use **Bankr's
own trading wallet**, not the wallet you picked — the app makes that clear when you
choose one of these.

- **Trade / swap** — buy or sell tokens, including across different chains.
- **Perps (leverage)** — open leveraged long/short positions on Hyperliquid through
  Bankr's wallet and provider flow.
- **Prediction markets** — search and bet on Polymarket markets.
- **NFTs** — buy, sell, or mint NFTs.
- **Launch a token** — create your own token on Base, with a liquidity pool set up for you.
- **Automations** — recurring buys (DCA), scheduled orders (TWAP), and limit / stop
  orders that keep running on their own.
- **Fund credits** — top up Bankr's LLM credits.
- **Portfolio** — check balances, profit/loss, and positions across chains.

## Where the money comes from

The app is always upfront about this:

- **Your selected wallet** pays for swaps, sends, private transfers, and x402.
- **Your selected EVM wallet's Hyperliquid account** pays for local Hyperliquid perps.
- **Bankr's wallet** is used for the Bankr actions above (perps, prediction, NFTs,
  token launches, bridges, automations).
- A few rails route through other connected accounts (a card account for card
  checkouts, your prepaid runtime balance, etc.) — again, shown before you confirm.

## One current limitation: standalone bridging

Trying to **bridge funds from one chain to another on their own** (e.g. "move my USDC
from Base to Arbitrum") through Bankr currently fails — it's a bug on Bankr's side,
not in HivemindOS. We've reported it.

The good news: bridging **still works automatically when it's part of a bigger action**
— funding a Hyperliquid perp moves your collateral across chains for you, and placing
a Polymarket bet bridges to Polygon for you. If you specifically need to move funds to
another chain by themselves right now, use a dedicated bridge app like **deBridge** or
**Across**, then bring the funds back into HivemindOS.

See [Safety & Limits](governance.html) for how spending caps and confirmations apply to
all of the above.
