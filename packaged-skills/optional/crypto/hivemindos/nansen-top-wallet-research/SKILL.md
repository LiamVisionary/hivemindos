---
name: nansen-top-wallet-research
description: Use when a user asks for Nansen-powered top-wallet, token-flow, holder, PnL, or Smart Money DEX-trade research for a token. The skill runs the HivemindOS Nansen complex template `top-wallet-copytrade-research` as read-only analysis.
---

# Nansen Top Wallet Research

Research token flows, profitable wallets, holders, and Smart Money DEX activity for a specific token.

## Contract

- This skill does not execute copytrades. It returns watch-only research and pre-trade caveats.
- Require `tokenAddress`; ask for the chain if it is not clear, defaulting to Ethereum only when reasonable.
- Do not expose raw trader rankings or Smart Money feeds. Summarize derived observations and source status.
- Route through HivemindOS Nansen intelligence so BYOK and hosted-credit policy stays server-side.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "complex-template",
  "template": "top-wallet-copytrade-research",
  "chain": "ethereum",
  "tokenAddress": "<token-contract-address>"
}
```

Authenticated local route:

```http
POST /api/nansen/complex-template
```

```json
{
  "template": "top-wallet-copytrade-research",
  "chain": "ethereum",
  "tokenAddress": "<token-contract-address>",
  "timeframe": "7d"
}
```

Add `address` only when the user also wants a wallet PnL summary for a specific wallet.

## Use

Use this when the user asks for:

- top wallets for a token
- Smart Money DEX buys or exits
- holder concentration by smart-money labels
- flow intelligence for accumulation/distribution
- a watchlist before manually reviewing a token trade

## Response Pattern

Summarize:

- token and chain
- flow direction and holder concentration
- profitable-wallet context without raw rankings
- Smart Money DEX activity caveats
- local wallet and risk checks before any action
