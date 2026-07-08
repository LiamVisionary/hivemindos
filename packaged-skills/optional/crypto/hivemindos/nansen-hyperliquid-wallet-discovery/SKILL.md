---
name: nansen-hyperliquid-wallet-discovery
description: Use when a user asks to find profitable Hyperliquid wallets, inspect a trader's perp positions, or research Hyperliquid copytrade candidates with Nansen. The skill runs the HivemindOS Nansen complex template `hyperliquid-wallet-discovery` as watch-only research.
---

# Nansen Hyperliquid Wallet Discovery

Discover and inspect Hyperliquid traders through the HivemindOS Nansen route.

## Contract

- This is watch-only research. Never auto-copy, open, close, size, or rebalance Hyperliquid positions from this skill.
- Use Nansen-derived signals only as one input alongside local account exposure, leverage policy, liquidation distance, and explicit user confirmations.
- Do not expose raw public leaderboards or ranking tables. Summarize derived observations.
- Never print Nansen API keys, hosted credit tokens, private keys, or wallet-vault material.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "complex-template",
  "template": "hyperliquid-wallet-discovery",
  "address": "<wallet-address>"
}
```

Authenticated local route:

```http
POST /api/nansen/complex-template
```

```json
{
  "template": "hyperliquid-wallet-discovery",
  "address": "<wallet-address>"
}
```

Omit `address` to run discovery from the perp leaderboard only.

## Use

Use this when the user asks for:

- profitable Hyperliquid wallets to watch
- current positions for a candidate wallet
- recent perp trade activity for a wallet
- a no-trade risk memo before following a trader

## Response Pattern

Summarize:

- leaderboard or wallet subject
- position and trade context if an address was supplied
- leverage or liquidation-sensitive risk flags
- whether any Nansen sources failed
- what must be checked locally before a trade

Do not include an execution instruction. If the user asks to trade, hand off to the normal Hyperliquid confirmation flow after this research is complete.
