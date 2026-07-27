---
name: nansen-token-tracking-smart-money
description: Use when a user asks for Nansen-powered token discovery, token tracking, Smart Money netflow, or trader-credibility checks before a crypto trade. The skill runs the HivemindOS Nansen complex template `token-tracking-smart-money` and returns derived research only.
---

# Nansen Token Tracking And Smart Money

Run Nansen's automated token tracking and Smart Money analysis template through HivemindOS.

## Contract

- Use the HivemindOS route or MCP action, not a direct Nansen API key in chat.
- Treat the output as read-only due diligence before a trade. Do not execute swaps, sends, or Hyperliquid actions from this skill.
- Return derived HivemindOS analysis, not raw Smart Money tables, public trader rankings, or realtime feeds.
- Attribute displayed Nansen-derived data when the response says attribution is required.
- Never print, request, or store `NANSEN_API_KEY` or hosted credit tokens.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "complex-template",
  "template": "token-tracking-smart-money",
  "chains": ["ethereum", "base", "solana"],
  "tokenSymbol": "ETH"
}
```

Authenticated local route:

```http
POST /api/nansen/complex-template
```

```json
{
  "template": "token-tracking-smart-money",
  "chain": "ethereum",
  "tokenAddress": "<token-contract-address>"
}
```

## Use

Use this when the user asks for:

- tokens Smart Money is accumulating
- token screener candidates before a buy
- Nansen Smart Money netflow
- profitable holders for a token
- a daily or ad hoc token discovery brief

If the user gives only a symbol, run the template with `tokenSymbol`; if they provide a contract address, include `tokenAddress` so the template can add the TGM PnL leaderboard.

## Response Pattern

Summarize:

- candidate token or subject
- strongest accumulation or liquidity signals
- failed or partial Nansen sources
- risk flags and attribution requirement
- next due-diligence steps before any trade

End by reminding that this is research, not execution.
