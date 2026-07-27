---
title: "Crypto Trading"
---

# Crypto Trading

Everything you can do with crypto in HivemindOS, in one place. Pick an action in the
**Trade tab → Crypto**, or just describe it to an agent. You'll always see a preview
and confirm before anything moves.

## Move your own money

These spend from the wallet you've selected.

- **Swap** — trade one token for another, on Base, Robinhood Chain, or Solana
  (for example, USDC → ETH or USDG → WETH).
  Built-in swaps are capped at a small amount per swap as a safety rail. Works with
  both your personal wallet and agent wallets.
- **Send stablecoins** — send dollars from the selected wallet: USDC on Base/Solana
  or USDG on Robinhood Chain. Your personal wallet always asks you to confirm; an
  agent wallet follows the limits you set for it.
- **Private transfer** — send USDC or ETH privately through Veil, so the amount and
  destination aren't openly linked to you. (Private sends to a public address have a
  small minimum.)
- **Pay an API (x402)** — pay-per-use online services that charge tiny amounts per
  request. HivemindOS handles the payment and gets you the result.
- **Receive** — show a deposit address so you (or anyone) can add funds to a wallet.

## Trade Hyperliquid with your wallet

HivemindOS can place local Hyperliquid spot and perpetual futures trades from a
selected EVM wallet. These trades use that wallet's own Hyperliquid account and
collateral, not HivemindOS funds and not Bankr's wallet.

You can:

- Go long or short on perps, or buy and sell spot markets.
- Use market, limit, trigger, and TWAP orders.
- Set a market slippage guard.
- Mark a trade as **reduce only** when you want to close or shrink a position.
- Manage open orders, leverage, isolated margin, spot/perp transfers, USDC sends, spot sends, and withdrawals.
- Refresh account value, open positions, spot balances, open orders, fills, fees, and builder-fee approval state.
- Ask an agent to quote, review, and place the trade under the same wallet limits.

The official HivemindOS builder fee is **0.5 bps (0.005%)** of filled notional. You
approve that fee separately before the first local Hyperliquid trade that needs it;
after approval, HivemindOS attaches the builder code automatically to eligible orders.
That approval does not let HivemindOS use your funds or withdraw from your account.
See [Hyperliquid Trading](hyperliquid.html) for the full user guide.

## Shared practice book

HivemindOS can keep a local **shared practice book** for crypto targets. This is
useful when you start in an Alpaca paper account and later want to practice or execute
the same target exposure through Hyperliquid.

The practice book can:

- Capture open crypto positions from an Alpaca paper account and save them as the
  shared target.
- Capture Hyperliquid spot/perp status without replacing the target, or deliberately
  make Hyperliquid the new target.
- Add a manual target from supported assets when an old paper account is no longer
  available.
- Compare the shared target with the selected wallet's Hyperliquid account and prepare
  the order differences needed to replay the target.

The book does **not** merge custody between providers. Alpaca paper balances remain
simulated inside Alpaca, and Hyperliquid balances remain in the selected wallet's own
Hyperliquid account. HivemindOS stores the normalized target locally, shows the replay
plan, and only places Hyperliquid orders after the explicit replay confirmation and the
wallet's normal limits pass.

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
- **Always-on copy trading** — follow bounded new Base swaps from a target wallet
  using a separate Bankr wallet. New monitors start with one free paper event;
  live copies carry a disclosed post-verification HivemindOS fee.
- **Fund credits** — top up Bankr's LLM credits.
- **Portfolio** — check balances, profit/loss, and positions across chains.

## Where the money comes from

The app is always upfront about this:

- **Your selected wallet** pays for swaps, sends, private transfers, and x402.
- **Your selected EVM wallet's Hyperliquid account** pays for local Hyperliquid spot/perp trades, transfers, and withdrawals.
- **Bankr's wallet** is used for the Bankr actions above (perps, prediction, NFTs,
  token launches, bridges, automations).
- A few rails route through other connected accounts (a card account for card
  checkouts, your prepaid runtime balance, etc.) — again, shown before you confirm.

## HivemindOS fees

Official HivemindOS builds charge **no platform fee for ordinary wallet transfers**.
The current hosted policy charges 0.20% for DEX swaps and 0.50% for ordinary paid x402
or private-payment execution, with a $0.01 minimum and $10 maximum where a fee applies.
The preview shows the fee before confirmation, and the fee is sent as its own USDC or
USDG transaction only after the main action succeeds.

Local Hyperliquid trades use a separate builder fee, described in the Hyperliquid
guide. Hosted Bankr copy trading charges 0.50% of verified copied-trade notional,
with a $0.02 minimum and $0.50 maximum, directly from the Bankr execution wallet;
paper, skipped, failed, and unverified copies cost $0. Other Bankr and card-style
provider flows may have their own provider fees instead of this fee.

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
