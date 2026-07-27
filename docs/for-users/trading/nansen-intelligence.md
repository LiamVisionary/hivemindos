---
title: "Nansen Intelligence"
---

# Nansen Intelligence

HivemindOS can use Nansen as a read-only onchain research layer before a wallet,
token, or Hyperliquid decision. Agents can ask for a short brief, compare it with
local wallet state, and then keep any trade or payment behind the normal preview
and confirmation flow.

## What Agents Can Ask For

- **Token brief** - token profile, flow intelligence, buyers and sellers, price
  history, and optional DEX trades or indicator checks.
- **Wallet brief** - wallet balances, PnL, counterparties, related wallets, and
  DeFi holdings when a Nansen API key is configured.
- **Hyperliquid brief** - address positions and trades, token perp context,
  market screening, and optional transformed leaderboard context for internal
  due diligence.
- **Market scout** - token and perp screens across selected chains, useful for
  watchlists and daily scout briefs.
- **Simple templates** - DeFi positions, Smart Money holdings, token top
  holders, and token screener discovery.
- **Complex templates** - packaged workflows for token tracking and Smart Money
  netflow, Hyperliquid wallet discovery, related-wallet clustering,
  top-wallet token research, and CEX-health monitoring.
- **Nansen Agent research** - fast or expert research mode for broader questions
  through BYOK or HivemindOS-managed credits.

These are research calls only. They do not sign, swap, send, trade, or change an
exchange account.

## Setup

The preferred setup is a Nansen API key:

```bash
hive-env-add NANSEN_API_KEY
```

HivemindOS reads that key from the shared hive env at runtime and sends requests
to Nansen with the required `apikey` header. The status surface reports only
whether `NANSEN_API_KEY` is present; it never prints the value.

If no API key is configured, HivemindOS can use hosted HivemindOS credits through
the HivemindOS-managed Nansen broker. In that mode the hosted gateway owns the
Nansen API key, bills the user's HivemindOS credit token, records a receipt, and
returns a derived brief. Direct Nansen x402 is not the HivemindOS cloud product
path.

## Guardrails

- Nansen data is one signal, not an execution policy. Agents should combine it
  with wallet state, market data, news or social context, and the user's limits.
- HivemindOS returns derived briefs, not raw Smart Money dashboards, raw wallet
  rankings, near-real-time feeds, or copy-trading signals.
- Displayed Nansen-derived data should show attribution when the source requires
  it.
- Any later money movement still uses the normal HivemindOS preview,
  confirmation, and spend-governance routes.
- Copytrade-named templates are watch-only research in HivemindOS. They do not
  auto-open, auto-close, rebalance, or copy another wallet's trades.

## Simple Templates

Use `POST /api/nansen/simple-template` or the `nansen_intelligence` action with
`action: "simple-template"` and one of these template IDs:

| Template | Use |
| --- | --- |
| `defi-positions` | Wallet DeFi holdings, rewards, protocol exposure, and borrow/debt context. |
| `smart-money-holdings` | Aggregated Smart Money token holdings across selected chains. |
| `token-top-holders` | Token holder concentration and optional holder-label lens for a token contract. |
| `token-screener-discovery` | Multi-chain token screener candidates for new-token discovery and watchlists. |

## Complex Templates

Use `POST /api/nansen/complex-template` or the `nansen_intelligence` action with
`action: "complex-template"` and one of these template IDs:

| Template | Use |
| --- | --- |
| `token-tracking-smart-money` | Token screener, Smart Money netflow, and optional token PnL leaderboard context. |
| `hyperliquid-wallet-discovery` | Hyperliquid trader discovery plus optional wallet positions and trade activity. |
| `related-wallets-scale` | Premium address labels, related-wallet, counterparty, balance-pattern, and transaction-pattern context for a target address. |
| `top-wallet-copytrade-research` | Token flow intelligence, PnL leaderboard, Smart Money DEX trades, holders, and optional wallet PnL summary. |
| `cex-health-monitor` | Entity balance snapshot and recent counterparty flow context for exchange-health monitoring. |

`related-wallets-scale` uses Nansen's live profiler label reference path,
`/api/v1/profiler/address/premium-labels`, not the stale beta path shown in an
older template snippet.

## Agent And API Surface

Agents discover the capability as `nansen_intelligence`. The local dashboard API
also exposes the same read-only surfaces:

| Route | Use |
| --- | --- |
| `GET /api/nansen/status` | Check BYOK presence, managed-credit readiness, endpoint catalog, and compliance notes. |
| `POST /api/nansen/token-brief` | Build a token due-diligence brief from a token address or symbol. |
| `POST /api/nansen/wallet-brief` | Build a wallet portfolio and profiler brief. |
| `POST /api/nansen/hyperliquid-brief` | Build Hyperliquid market, token, or address context. |
| `POST /api/nansen/market-scout` | Build a multi-chain token/perp scout brief. |
| `POST /api/nansen/simple-template` | Run one of the four simple Nansen workflows listed above. |
| `POST /api/nansen/complex-template` | Run one of the five complex Nansen workflows listed above. |
| `POST /api/nansen/agent` | Ask Nansen Agent fast or expert mode through BYOK or managed HivemindOS credits. |

Successful responses use the normal HivemindOS API envelope, for example
`{ "ok": true, "brief": { ... } }` for brief routes. Managed-cloud responses may
include billing metadata inside the brief so users can see the hosted credit debit
and receipt id.

## Where It Fits

Use Nansen when the question is "what should we know before acting?" Use the
Trade tab, wallet routes, Hyperliquid routes, or Bankr routes only after the
human or agent has a concrete action to preview and confirm.
