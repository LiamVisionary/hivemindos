---
title: "Hyperliquid Perps"
---

# Hyperliquid Perps

HivemindOS can trade Hyperliquid perpetual futures from a local EVM wallet. Use it
when you want to go long or short on crypto with collateral in your own Hyperliquid
account, while still keeping HivemindOS previews, confirmations, wallet limits, and
agent controls around the trade.

Perpetual futures are leveraged derivatives. They can move faster than spot tokens,
can be liquidated, and can pay or receive funding. Treat them as active trading tools,
not as passive holdings.

## What you can do

In the Trade tab, Hyperliquid currently supports:

- **Markets:** BTC, ETH, SOL, and HYPE perps.
- **Direction:** open a long or open a short.
- **Order style:** market orders for immediate execution, or limit orders at your
  chosen price.
- **Slippage guard:** choose how much price movement a market order may tolerate.
- **Reduce only:** close or shrink an existing position without accidentally making it
  larger or flipping direction.
- **Status:** refresh account value, builder approval state, and open positions.
- **Quotes:** preview size, estimated notional, price, network, and builder fee before
  you trade.

Agents can help with the same flow: check status, prepare a quote, ask you to approve
the builder fee if needed, and then place the order only after confirmation.

## Where the money comes from

Local Hyperliquid trades use **the selected wallet's own Hyperliquid account**. They
do not use HivemindOS treasury funds, the HivemindOS builder wallet, or another user's
funds.

To trade, the wallet needs:

- A local EVM signing wallet in HivemindOS.
- USDC collateral in that wallet's Hyperliquid account.
- A per-trade limit high enough for the order you are placing.

If a wallet is not funded or not allowed to trade enough, HivemindOS stops at the
preview or quote step and tells you what is missing.

## Local Hyperliquid vs Bankr

HivemindOS has two Hyperliquid paths, and the funding source is different:

| Path | Uses whose funds? | Best for |
|---|---|---|
| **Local Hyperliquid** | The selected HivemindOS EVM wallet's own Hyperliquid account | Direct wallet-controlled perp trades with HivemindOS limits |
| **Bankr Hyperliquid** | Bankr's connected trading wallet | Provider-mediated trading and Bankr-managed workflows |

The app should always make the funding source clear before you confirm.

## The builder fee

Official HivemindOS builds attach the HivemindOS Hyperliquid builder code to local
Hyperliquid perp fills. This is how HivemindOS earns a small fee when it routes a
Hyperliquid trade for you.

Current official setting:

| Fee | Meaning |
|---|---|
| **0.5 bps** | **0.005%** of filled notional |

Examples:

| Filled volume | HivemindOS builder fee |
|---:|---:|
| $1,000 | $0.05 |
| $10,000 | $0.50 |
| $100,000 | $5.00 |

This builder fee is separate from normal Hyperliquid trading fees, funding payments,
and any price slippage. Before your first local Hyperliquid trade, you approve the
maximum HivemindOS builder fee for your wallet. If the official fee changes later,
the app asks you to approve again before trading at the new rate.

Self-hosted or forked builds may use a different builder policy. They should disclose
their own fee clearly before you trade.

## Fees, funding, and liquidation

Hyperliquid perps have several costs and risks:

- **Trading fees** are charged by Hyperliquid when orders fill. Fee tiers can depend
  on recent trading volume.
- **Funding** is paid between longs and shorts. It can be a cost or a credit, and it
  updates over time.
- **Builder fee** is the small HivemindOS fee above when an official HivemindOS local
  Hyperliquid order fills.
- **Slippage** can happen on market orders if the execution price moves while the
  order fills.
- **Liquidation** can happen if your account no longer has enough margin for the open
  position.

HivemindOS can preview and limit what it sends, but it cannot remove market risk. Once
a position is open, price movement, leverage, funding, and liquidation rules belong to
Hyperliquid.

## Safety controls

Hyperliquid trades follow the same HivemindOS wallet safety model as other money
actions:

- You see a quote before placing an order.
- You confirm before a real order is sent.
- Wallet max trade limits apply.
- Daily and monthly budgets apply where the action spends new risk.
- A frozen company stops its agents from trading.
- Personal wallets never auto-spend.
- Agent wallets can act only within the limits you set.
- Reduce-only closes are available so an agent can shrink risk without increasing it.

If an order is too large, off-policy, missing approval, or unavailable for the selected
wallet, HivemindOS refuses it before execution.

## What agents can do

Agents can help with local Hyperliquid in plain English:

- "Show my Hyperliquid status."
- "Quote a $25 ETH long."
- "Open a small SOL short if it is within limits."
- "Close my HYPE position reduce-only."
- "Check whether the builder fee is approved."

The agent should always show the review first. For a builder approval, it asks for the
builder approval step. For an order, it asks for the order confirmation step. A coding
agent, dashboard agent, or chat agent all use the same wallet limits and confirmations.

## Current limitations

Local Hyperliquid in HivemindOS is intentionally focused:

- It is for **perps**, not Hyperliquid spot.
- The Trade tab exposes BTC, ETH, SOL, and HYPE perps.
- Advanced order types such as stop loss, take profit, and scale orders are not exposed
  in the HivemindOS local Hyperliquid panel yet.
- Portfolio margin and other advanced Hyperliquid account modes should be managed in
  Hyperliquid directly.
- Standalone cross-chain bridging is separate from placing a Hyperliquid trade. See
  [Crypto Trading](crypto.html) for the current bridge note.

For the general trading safety model, see [Safety & Limits](governance.html).

## Official Hyperliquid references

- [Builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes)
- [Fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)
- [Margining](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining)
- [Order types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types)
