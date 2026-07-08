---
name: nansen-cex-health-monitor
description: Use when a user asks to monitor a centralized exchange's onchain health, balances, or daily net flows with Nansen. The skill runs the HivemindOS Nansen complex template `cex-health-monitor`.
---

# Nansen CEX Health Monitor

Monitor exchange balance and counterparty-flow context with Nansen through HivemindOS.

## Contract

- This is read-only research for exchange-risk awareness.
- Do not present a single Nansen snapshot as proof of solvency or insolvency.
- Prefer repeated snapshots for trend claims; otherwise label the result as point-in-time.
- Use the HivemindOS route or MCP action and never expose Nansen provider keys.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "complex-template",
  "template": "cex-health-monitor",
  "entityName": "Coinbase",
  "chain": "base"
}
```

Authenticated local route:

```http
POST /api/nansen/complex-template
```

```json
{
  "template": "cex-health-monitor",
  "entityName": "Coinbase",
  "chain": "base"
}
```

## Use

Use this when the user asks for:

- CEX assets on exchange
- daily net flow context
- exchange health snapshots
- monitored outflow alerts
- chain-specific flow checks for an entity

## Response Pattern

Summarize:

- entity and chain
- balance snapshot caveats
- inflow/outflow context from counterparties
- source failures or partial status
- whether this should become a scheduled monitor

Never imply an exchange is safe or unsafe based on this data alone.
