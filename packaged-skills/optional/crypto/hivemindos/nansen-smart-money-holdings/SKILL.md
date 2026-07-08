---
name: nansen-smart-money-holdings
description: Use when a user asks for Nansen-powered Smart Money holdings, token concentration, or aggregated onchain positioning before a crypto trade. The skill runs the HivemindOS Nansen simple template `smart-money-holdings` and returns derived research only.
---

# Nansen Smart Money Holdings

Run Nansen's Smart Money holdings simple template through HivemindOS.

## Contract

- Use the HivemindOS route or MCP action, not a direct Nansen API key in chat.
- Treat the output as read-only due diligence. Do not execute swaps, sends, or copy wallet activity from this skill.
- Return derived HivemindOS analysis, not raw Smart Money tables, rankings, realtime feeds, or dashboards.
- Attribute displayed Nansen-derived data when the response says attribution is required.
- Never print, request, or store `NANSEN_API_KEY` or hosted credit tokens.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "simple-template",
  "template": "smart-money-holdings",
  "chains": ["ethereum", "base", "solana"]
}
```

Authenticated local route:

```http
POST /api/nansen/simple-template
```

```json
{
  "template": "smart-money-holdings",
  "chains": ["ethereum", "base"]
}
```

## Use

Use this when the user asks for:

- tokens held by Smart Money wallets
- aggregated Smart Money exposure
- token concentration across chains
- watchlist ideas before deeper token research
- accumulation context that should be compared with netflow

## Response Pattern

Summarize:

- chains and token segment reviewed
- strongest holding or concentration signals
- whether stablecoins or specific labels were filtered
- failed or partial Nansen sources
- attribution requirement and next due-diligence steps

End by reminding that this is research, not execution or a copy-trading signal.
