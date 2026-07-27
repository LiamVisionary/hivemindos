---
name: nansen-related-wallet-clustering
description: Use when a user asks to identify related wallets, cluster an address, inspect counterparties, or check address balance/transaction patterns with Nansen. The skill runs the HivemindOS Nansen complex template `related-wallets-scale`.
---

# Nansen Related Wallet Clustering

Use Nansen profiler data to build a cautious related-wallet research brief.

## Contract

- Treat wallet clustering as probabilistic context. Do not assert common ownership without independent evidence.
- Use the HivemindOS Nansen route or MCP action; do not ask for provider keys.
- Do not publish raw address lists or counterparty tables. Return derived relationship hypotheses, caveats, and next checks.
- Use the live Nansen profiler labels path through HivemindOS. Do not use the stale `/api/beta/profiler/address/labels` snippet from older template docs.

## Route

Prefer the MCP/Hive action:

```json
{
  "action": "complex-template",
  "template": "related-wallets-scale",
  "address": "<wallet-address>",
  "chain": "ethereum"
}
```

Authenticated local route:

```http
POST /api/nansen/complex-template
```

```json
{
  "template": "related-wallets-scale",
  "address": "<wallet-address>",
  "chain": "ethereum",
  "includeLabels": true
}
```

## Use

Use this when the user asks for:

- wallets related to a target address
- first funder, signer, deployment, or shared-counterparty clues
- CEX deposit overlap
- coordinated transaction or balance patterns
- a graph-ready relationship summary

## Response Pattern

Summarize:

- target address and chain
- strongest relationship types
- counterparties and balance/transaction pattern caveats
- source failures, if any
- confidence language and follow-up validation steps

Avoid doxxing language or certainty claims unless the source evidence is explicit and independently verified.
