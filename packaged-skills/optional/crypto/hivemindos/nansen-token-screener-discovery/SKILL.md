---
name: nansen-token-screener-discovery
description: Use when a user asks for Nansen-powered token screener discovery, new token candidates, or multi-chain watchlist ideas before a crypto trade. The skill runs the HivemindOS Nansen simple template `token-screener-discovery` and returns derived research only.
---

# Nansen Token Screener Discovery

Run Nansen's Token Screener simple template through HivemindOS.

## Contract

- Use the HivemindOS route or MCP action, not a direct Nansen API key in chat.
- Treat the output as read-only due diligence. Do not execute swaps, sends, or automated buys from this skill.
- Return derived HivemindOS analysis, not raw screener feeds or realtime alerts.
- Attribute displayed Nansen-derived data when the response says attribution is required.
- Never print, request, or store `NANSEN_API_KEY` or hosted credit tokens.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "simple-template",
  "template": "token-screener-discovery",
  "chains": ["ethereum", "base", "solana"],
  "timeframe": "24h"
}
```

Authenticated local route:

```http
POST /api/nansen/simple-template
```

```json
{
  "template": "token-screener-discovery",
  "chain": "base",
  "timeframe": "24h",
  "filters": { "token_age_days": { "max": 7 } }
}
```

## Use

Use this when the user asks for:

- new-token discovery
- token screener candidates
- multi-chain watchlists
- tokens to research before a trade
- daily or ad hoc market scouting

## Response Pattern

Summarize:

- chains and timeframe reviewed
- candidate tokens or segments that stood out
- liquidity, market cap, age, or holder-count caveats
- failed or partial Nansen sources
- next checks before any swap

End by reminding that this is research, not execution.
