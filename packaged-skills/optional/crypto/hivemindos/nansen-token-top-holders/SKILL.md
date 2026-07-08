---
name: nansen-token-top-holders
description: Use when a user asks for Nansen-powered top holders of a token, token holder concentration, or Smart Money holder context before a crypto trade. The skill runs the HivemindOS Nansen simple template `token-top-holders` and returns derived research only.
---

# Nansen Token Top Holders

Run Nansen's top-token-holders simple template through HivemindOS.

## Contract

- Use the HivemindOS route or MCP action, not a direct Nansen API key in chat.
- Treat the output as read-only due diligence. Do not execute trades, copy wallets, or assert ownership from labels alone.
- Return derived HivemindOS analysis, not raw holder tables, public trader rankings, or copy-trading signals.
- Attribute displayed Nansen-derived data when the response says attribution is required.
- Never print, request, or store `NANSEN_API_KEY` or hosted credit tokens.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "simple-template",
  "template": "token-top-holders",
  "chain": "ethereum",
  "tokenAddress": "<token-contract-address>",
  "labelType": "all_holders"
}
```

Authenticated local route:

```http
POST /api/nansen/simple-template
```

```json
{
  "template": "token-top-holders",
  "chain": "ethereum",
  "tokenAddress": "<token-contract-address>",
  "premiumLabels": true
}
```

## Use

Use this when the user asks for:

- top holders of a token
- holder concentration or whale context
- Smart Money holder lens
- exchange or entity holder context
- token risk review before a buy or sell

## Response Pattern

Summarize:

- token and chain under review
- concentration or holder-segment signals
- label uncertainty and attribution requirement
- failed or partial Nansen sources
- next checks such as token flows, wallet exposure, and liquidity

End by reminding that this is research, not execution or a copy-trading instruction.
