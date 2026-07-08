---
name: nansen-defi-positions
description: Use when a user asks for Nansen-powered DeFi positions, protocol exposure, pending rewards, or borrow/debt context for a wallet. The skill runs the HivemindOS Nansen simple template `defi-positions` and returns derived research only.
---

# Nansen DeFi Positions

Run Nansen's DeFi positions simple template through HivemindOS.

## Contract

- Use the HivemindOS route or MCP action, not a direct Nansen API key in chat.
- Treat the output as read-only due diligence before a trade or wallet decision. Do not execute swaps, sends, lending actions, or Hyperliquid actions from this skill.
- Return derived HivemindOS analysis, not raw Nansen feeds or dashboards.
- Attribute displayed Nansen-derived data when the response says attribution is required.
- Never print, request, or store `NANSEN_API_KEY` or hosted credit tokens.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "simple-template",
  "template": "defi-positions",
  "address": "<wallet-address>"
}
```

Authenticated local route:

```http
POST /api/nansen/simple-template
```

```json
{
  "template": "defi-positions",
  "address": "<wallet-address>"
}
```

## Use

Use this when the user asks for:

- wallet DeFi positions
- protocol exposure
- pending rewards
- borrow, debt, or collateral context
- wallet portfolio due diligence before an onchain action

## Response Pattern

Summarize:

- wallet or entity under review
- protocols and notable position types
- debt, borrow, reward, and concentration risks
- failed or partial Nansen sources
- attribution requirement and next checks

End by reminding that this is research, not execution.
