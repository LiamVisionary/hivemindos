---
title: HivemindOS Ecosystem Plan
description: The free product, premium services, Honey contribution layer, HIVE ownership layer, treasury, and long-term value loop.
---

# HivemindOS Ecosystem Plan

HivemindOS stays free and open source. The token should support the ecosystem, not sit in front of the product.

The product comes first.

## Core Principles

Anyone can:

- Self-host HivemindOS.
- Build agents.
- Build swarms.
- Modify the code.
- Run local models.
- Use HivemindOS without owning HIVE.

The token is not required for the core product.

## Premium Services

Revenue comes from optional services that cost real money to operate, maintain, or support.

### Hive Cloud

Managed HivemindOS hosting:

- One-click deployment.
- Managed infrastructure.
- Hosted memory.
- Team workspaces.
- Monitoring.

### Managed Compute

Run agents and swarms on Hivemind infrastructure.

Users pay only for usage.

### Agent Marketplace

Buy and sell:

- Agents.
- Swarms.
- Workflows.
- Templates.

Hivemind can take a marketplace fee.

Creators can choose the business model that fits the asset:

| Model | What the buyer gets |
| --- | --- |
| Free | Public or community workflow access |
| Pay-per-use | A charged run each time the workflow is executed |
| Lifetime access | One-time purchase for ongoing access to a workflow or template |
| Subscription | Recurring access to a maintained agent, workflow, or playbook |
| Bounty funded | Community or treasury-funded creation of a requested asset |
| Commission on earnings | The creator earns a percentage of revenue generated through the workflow |

Payments can use ordinary checkout rails, managed HONEY credits, HIVE, or other supported crypto rails. Pay-per-use workflows can also use x402 endpoints with the assets those endpoints explicitly accept.

HIVE staking should improve marketplace economics and trust: lower platform fees, stronger creator badges, curation rights, private opportunity rooms, Visionary council access, and better distribution surfaces for high-quality listings. HIVE payment should be available as a rail, but staking should remain the alignment layer around the marketplace rather than the only way to buy.

Paying with HIVE can also earn a small checkout discount on eligible managed services. That payment discount can stack with staking discounts up to a capped maximum, but discounts should apply only to HivemindOS platform margin and never reduce pricing below direct service cost.

### Enterprise

Business customers can pay for:

- SSO.
- Teams.
- Compliance.
- Private deployments.
- Support contracts.

### Managed X API And X MCP

HivemindOS can operate hosted social/API integrations where the cost is not just UI polish. The managed X API and X MCP gateway handles:

- Sign in with X through HivemindOS-controlled hosted infrastructure.
- Server-side OAuth token custody.
- Vetted X API and X MCP calls.
- Hosted credit debit and receipts after successful calls.
- Public pricing policy through hosted HivemindOS infrastructure.

Users fund the same hosted HivemindOS credit balance used by managed models through card or x402 top-ups. X API and X MCP calls debit those credits only after the hosted gateway receives a successful upstream response.

The current default pricing policy uses the upstream X API unit cost plus **25% markup**, with a **$0.001 minimum debit**. The hosted policy can be overridden by production rates from the X Developer Console, so the hosted endpoint is the authority rather than the downloaded app.

Current default examples:

| Managed X action | Upstream unit cost | HivemindOS retail debit | Gross platform margin before infrastructure and payment costs |
| --- | ---: | ---: | ---: |
| X MCP tool call | `$0.005` per request | `$0.00625` | `$0.00125` |
| Post read | `$0.005` per resource | `$0.00625` | `$0.00125` |
| User read | `$0.010` per resource | `$0.01250` | `$0.00250` |
| Post create | `$0.015` per request | `$0.01875` | `$0.00375` |

The revenue HivemindOS collects is the retail credit debit. The margin is the retail debit minus upstream X/API cost, before ordinary hosting, payment-processing, and operations costs.

### Trading & On-Chain Fees

HivemindOS earns a usage fee on supported on-chain and trading actions taken from a user's acting wallet:

- A platform fee of **1% with a $0.01 minimum** on local USDC sends, DEX swaps, xStocks trades, live Alpaca stock orders, public x402 payments, and Veil private transfers and x402 payments. It is quoted before confirmation and collected as a separate USDC transfer after the action succeeds.
- A Hyperliquid builder fee of 0.5 bps (0.005%) on eligible filled local Hyperliquid orders, approved separately by the user.
- A Zero Human Company revenue share of **2% with a $0.01 minimum** on recorded company revenue events, net of refunds and chargebacks when the settlement route knows them. The local app can record the event and collect the share from a selected company agent wallet, while official marketplace or hosted-company revenue should be enforced by HivemindOS-controlled billing infrastructure or a verifiable payment rail.

Paper trades, read-only checks, and no-payment x402 calls are never charged. Recipient addresses and official wallet-fee policy are controlled by HivemindOS-managed infrastructure, and proceeds feed the same treasury and allocation below. See [Wallets, Honey, And x402](../for-users/features/wallets-honey-and-x402.html) for the mechanism.

Current examples:

| Activity | User volume | HivemindOS revenue |
| --- | ---: | ---: |
| Wallet send, swap, live stock, xStock, paid API, or private payment | `$100` | `$1.00` |
| Wallet send, swap, live stock, xStock, paid API, or private payment | `$0.25` | `$0.01` minimum |
| Recorded Zero Human Company revenue | `$500` | `$10.00` |
| Hyperliquid eligible fill | `$10,000` | `$0.50` |

### Hosted Agent And Model Messages

HivemindOS also earns from hosted agent/model messages when the user does not bring their own model key or wants a HivemindOS-managed model route.

The current default hosted paid agent is **$0.001 per successful chat completion**.

| Hosted message volume | HivemindOS revenue |
| ---: | ---: |
| `1,000` messages | `$1` |
| `100,000` messages | `$100` |
| `1,000,000` messages | `$1,000` |

## Contribution And Ownership

Honey is the contribution layer. HIVE is the ownership layer.

Honey measures productive participation in the Hivemind ecosystem. HIVE represents ecosystem ownership and alignment.

```text
Use HivemindOS
  -> Earn Honey
  -> Claim HIVE
```

For the deeper token, treasury, buyback, and staking model, see [Honey, HIVE, And Treasury](honey-hive-treasury.html).

## Revenue Allocation

Initial allocation:

| Area               | Share |
| ------------------ | ----: |
| Company operations |   50% |
| Growth             |   20% |
| Treasury           |   15% |
| Buybacks           |   15% |

Company operations includes founder salary, development, hosting, infrastructure, contractors, legal, and accounting.

Growth includes marketing, partnerships, community, and user acquisition.

Treasury builds long-term ecosystem reserves.

Buybacks are used to acquire HIVE from the open market when revenue supports them. They are revenue-backed momentum, not a guaranteed demand floor. Stake-lock remains the locked-supply mechanism; buybacks remain the revenue-driven support mechanism.

## Value Wheel

<ol class="valueWheel" aria-label="HivemindOS value wheel">
  <li><span>1</span><strong>Use HivemindOS</strong></li>
  <li><span>2</span><strong>Earn Honey</strong></li>
  <li><span>3</span><strong>Claim HIVE</strong></li>
  <li><span>4</span><strong>Hold or stake</strong></li>
  <li><span>5</span><strong>Strengthen ecosystem</strong></li>
  <li><span>6</span><strong>More adoption</strong></li>
  <li><span>7</span><strong>More revenue</strong></li>
  <li><span>8</span><strong>Treasury reserves</strong></li>
  <li><span>9</span><strong>Revenue-backed buybacks</strong></li>
  <li><span>10</span><strong>Fund Honey rewards</strong></li>
  <li><span>11</span><strong>More usage</strong></li>
</ol>

Step 11 feeds back into Step 1: more usage makes the product more useful, gives more people a reason to participate, and restarts the loop.

## One-Sentence Pitch

HivemindOS is a free and open-source operating system for AI agents. Users earn Honey by participating in the ecosystem through usage, creation, contribution, and growth. Honey can be claimed for HIVE, while revenue from optional premium services funds operations, ecosystem growth, treasury reserves, and revenue-backed HIVE buybacks, creating a sustainable flywheel between product adoption and token value.

<nav class="nextNav" aria-label="Monetization reading path">
  <a href="index.html">Back to monetization</a>
  <a href="honey-hive-treasury.html">Next: Honey, HIVE, And Treasury</a>
</nav>
