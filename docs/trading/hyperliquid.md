---
title: "Hyperliquid Trading"
---

# Hyperliquid Trading

HivemindOS can trade Hyperliquid spot and perpetual futures from a local EVM wallet while keeping previews, confirmations, wallet limits, and agent controls around the action. It uses the selected wallet's own Hyperliquid account and collateral.

Hyperliquid perps are leveraged derivatives. Spot trades are direct token buys and sells. Both can move quickly, and perps can be liquidated, so treat them as active trading tools rather than passive holdings.

## What You Can Do

In the Trade tab, Hyperliquid supports:

- **Perps:** open longs or shorts, close or shrink risk with reduce-only orders, and use market, limit, or trigger orders.
- **Spot:** buy or sell supported Hyperliquid spot markets from the same wallet's spot balance.
- **Take-profit / stop-loss:** place trigger orders that fire as take-profit or stop-loss orders.
- **Order controls:** check open orders, check an order status, cancel by order id or client order id, modify an existing order, or set up cancel-all protection when the account qualifies.
- **Account controls:** set leverage and add or remove isolated margin.
- **Balances and history:** refresh account value, open positions, spot balances, open orders, fills, fee state, and builder approval state.
- **Transfers and withdrawals:** move USDC between spot and perps, send USDC on Hyperliquid, send spot assets, or request a USDC withdrawal.
- **TWAP:** place or cancel time-weighted orders when the order is large enough for Hyperliquid's minimums.

Agents can help with the same flow from chat: check status, prepare a quote, ask for builder approval if needed, place or cancel orders, adjust leverage or margin, run a bounded transfer, or prepare a withdrawal only after the right confirmation.

## First-Time Setup

To trade locally, pick an EVM wallet in HivemindOS that can sign transactions and has funds in its Hyperliquid account. If your USDC is outside Hyperliquid, deposit or bridge it into Hyperliquid first. Hyperliquid's Arbitrum USDC bridge has its own rules and timing; Hyperliquid currently warns that deposits under 5 USDC are not credited, and withdrawals usually take a few minutes to arrive.

Official HivemindOS builds also ask for a separate builder-fee approval before the first eligible order that needs it. After that approval, HivemindOS attaches the builder code automatically when it places eligible orders for you. You do not need to find or paste a builder code yourself.

## Where The Money Comes From

Local Hyperliquid uses **the selected wallet's own Hyperliquid account**. It does not use HivemindOS treasury funds, the HivemindOS builder wallet, Bankr's wallet, or another user's funds.

To use it, the wallet needs:

- A local EVM signing wallet in HivemindOS.
- Funds in that wallet's Hyperliquid account.
- Wallet trade or payment limits high enough for the action.

If a wallet is not funded, not approved, or over its limits, HivemindOS stops before execution and tells you what is missing.

## Local Hyperliquid Vs Bankr

HivemindOS has two Hyperliquid paths:

| Path | Uses whose funds? | Best for |
|---|---|---|
| **Local Hyperliquid** | The selected HivemindOS EVM wallet's own Hyperliquid account | Direct wallet-controlled spot/perp trading with HivemindOS limits |
| **Bankr Hyperliquid** | Bankr's connected trading wallet | Provider-mediated trading and Bankr-managed workflows |

The app should always make the funding source clear before you confirm.

## The Builder Fee

Official HivemindOS builds attach the HivemindOS Hyperliquid builder code to eligible local Hyperliquid fills. This is how HivemindOS earns a small routing fee when it helps place a Hyperliquid trade.

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

This builder fee is separate from normal Hyperliquid trading fees, funding payments, and price slippage. Before your first local Hyperliquid trade that needs it, you approve the maximum HivemindOS builder fee for your wallet. If the official fee changes later, the app asks you to approve again before trading at the new rate.

The approval does **not** let HivemindOS use your funds, open trades on its own, or withdraw from your account. It only allows Hyperliquid to pay the approved builder fee on eligible fills that HivemindOS actually sends for you. You can revoke the approval in Hyperliquid; if it is missing later, HivemindOS asks again before it trades.

Some fills may not produce a builder fee because Hyperliquid decides fee eligibility at the exchange level. For example, builder fees apply normally to perps, while some spot fills can be treated differently by Hyperliquid's spot-fee rules.

Self-hosted or forked builds may use a different builder policy. They should disclose their own fee clearly before you trade.

## Fees, Funding, And Liquidation

Hyperliquid actions can include several costs and risks:

- **Trading fees** are charged by Hyperliquid when orders fill.
- **Funding** applies to perps and can be a cost or a credit.
- **Builder fee** is the small HivemindOS fee above when an official local Hyperliquid order fills with the builder code attached.
- **Slippage** can happen on market orders if execution moves while the order fills.
- **Liquidation** can happen on perps if an account no longer has enough margin.

HivemindOS can preview and limit what it sends, but it cannot remove market risk. Once a position or order exists, price movement, leverage, funding, and liquidation rules belong to Hyperliquid.

## Hyperliquid Minimums And Availability

HivemindOS checks what it can before sending an action, but Hyperliquid makes the final decision. Expect the exchange to refuse actions when an account does not have enough margin, an order is below the market minimum, a price or size does not match the market rules, or a feature is not available for that account yet.

Practical limits users commonly run into:

- Ordinary orders need to meet Hyperliquid's minimum order value.
- TWAP orders need a larger total size than tiny test trades.
- Scheduled cancel-all protection may be unavailable until the account has enough trading history.
- Deposits and withdrawals follow Hyperliquid bridge timing, not HivemindOS timing.

If Hyperliquid refuses an action, HivemindOS shows the reason and leaves the account state unchanged except for actions Hyperliquid already accepted.

## Safety Controls

Hyperliquid follows the same HivemindOS wallet safety model as other money actions:

- You can quote before placing an order.
- You confirm before a real signed action is sent.
- Wallet max trade and max payment limits apply.
- Daily and monthly budgets apply where the action creates new risk or moves funds.
- A frozen company stops its agents from trading.
- Personal wallets never auto-spend.
- Agent wallets can act only within the limits you set.
- Reduce-only orders are available for shrinking perp risk without increasing it.

If an order, transfer, margin change, TWAP, or approval is too large, off-policy, missing approval, or unavailable for the selected wallet, HivemindOS refuses it before execution.

## What Agents Can Do

Agents can help with local Hyperliquid in plain English:

- "Show my Hyperliquid status."
- "Quote a $25 ETH long."
- "Buy $25 of HYPE spot."
- "Place a stop loss on my BTC position."
- "Cancel my open SOL order."
- "Set BTC leverage to 3x."
- "Move $10 from spot to perps."
- "Withdraw $10 USDC from Hyperliquid."
- "Place a $50 TWAP on ETH."

The agent should show a review first and ask for the matching confirmation before any signed action. Dashboard agents, chat agents, and coding agents all use the same wallet limits and confirmations.

For the general trading safety model, see [Safety & Limits](governance.html).

## Official Hyperliquid References

- [Builder codes](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes)
- [Fees](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)
- [Funding](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding)
- [Margining](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining)
- [Order types](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-types)
- [Bridge2 deposits and withdrawals](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/bridge2)
