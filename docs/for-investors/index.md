---
title: For Investors
description: HivemindOS business model — revenue streams, trading and on-chain fees, paid-feature boundaries, Honey and HIVE rewards, staking tiers, treasury, and buybacks.
---

# For Investors

This is the business side of HivemindOS: how it makes money, where the free-vs-paid line sits, and how the Honey/HIVE economy, treasury, and buybacks fit together. For the product itself, see the [For Users](../for-users/) docs.

Revenue comes from optional premium services, trading and on-chain fees, hosted agent/model messages, managed hosted integrations, the Agent Marketplace, and Enterprise. The details live in the [Ecosystem Plan](ecosystem-plan.html) and [Paid Features](paid-features/), but the current numbers should be visible up front.

## Current Revenue Snapshot

| Revenue stream | Current number | What that means |
| --- | ---: | --- |
| Wallet sends, swaps, live stocks, tokenized stocks, ordinary public x402, and private payments | **1%**, with a **$0.01 minimum** | A `$100` action produces `$1.00` in revenue. A tiny `$0.25` test action produces the `$0.01` minimum. |
| MiroShark hosted x402 simulations | **$0.20 gross proxy spread** inside the **$1.20 USDC** user charge | The user pays HivemindOS `$1.20`; the hosted proxy pays MiroShark upstream up to `$1.00`; HivemindOS keeps the expected `$0.20` only after upstream success. No extra 1% local x402 platform fee is added. |
| Hive Compute marketplace inference | Default **20% platform fee** on token-metered marketplace usage | At the current default provider price, 1M input plus 1M output tokens debits `$0.040`: `$0.032` provider earning and `$0.008` gross HivemindOS platform revenue before infrastructure, payment, support, and payout costs. |
| Zero Human Company revenue share | **2%**, with a **$0.01 minimum** | A company running in HivemindOS that records `$1,000` in revenue produces `$20.00` in HivemindOS revenue. |
| Hyperliquid builder fee | **0.005%** of eligible filled notional | A `$10,000` fill produces `$0.50` in revenue. |
| Hosted HivemindOS agent/model messages | **$0.001 per successful hosted chat completion** on the current default hosted paid agent | `1,000` messages produces `$1`. `100,000` messages produces `$100`. `1,000,000` messages produces `$1,000`. |
| Managed X API and X MCP calls | Hosted policy retail debit: upstream X API unit cost plus **25% markup**, with a **$0.001 minimum** by default | The current default X MCP tool-call policy debits `$0.00625` from hosted credits for a `$0.005` upstream unit. HivemindOS collects the retail debit and keeps the markup after upstream X/API cost, infrastructure, and payment-processing costs. |
| Future paid infrastructure | TBD by product | Hive Cloud, managed compute, marketplace fees, and enterprise contracts. |

The app still shows fees before users confirm money movement. The point here is not mystery monetization. It is clear take rate, clear message pricing, and paid infrastructure where HivemindOS actually runs something.

HivemindOS should be useful before anyone pays for a cloud feature. Start here when you want to understand what stays free, what becomes paid, and how Honey and HIVE fit around the product without blocking it.

The line is simple: local-first control room features stay available by default, and paid services cover infrastructure that costs real money to run or maintain for users.

The ecosystem plan keeps that boundary explicit: HivemindOS remains free and open source, while optional premium services fund company operations, growth, treasury reserves, revenue-backed HIVE buybacks, and proposed seasonal HIVE reward pools for stakers.

## Recommended Path

<ol class="routePath" aria-label="Recommended monetization reading path">
  <li>
    <span>1</span>
    <a href="ecosystem-plan.html">Ecosystem Plan</a>
    <small>Free product, premium services, revenue allocation, and value loop.</small>
  </li>
  <li>
    <span>2</span>
    <a href="honey-hive-treasury.html">Honey, HIVE, And Treasury</a>
    <small>Contribution, ownership, treasury, buybacks, staking, and rewards.</small>
  </li>
  <li>
    <span>3</span>
    <a href="hive-staking-and-community-tiers.html">HIVE Staking And Community Tiers</a>
    <small>Stake-to-unlock, tier benefits, weighted seasonal HIVE rewards, alpha rooms, bounties, governance, and review policy.</small>
  </li>
  <li>
    <span>4</span>
    <a href="./paid-features/">Paid Features</a>
    <small>The rule for paid infrastructure and the current paid-feature shelf.</small>
  </li>
  <li>
    <span>5</span>
    <a href="paid-features/hivemind-cloud-agent-calls.html">Cloud Agent Calls</a>
    <small>The first concrete paid feature example.</small>
  </li>
  <li>
    <span>6</span>
    <a href="paid-features/hive-compute-marketplace.html">Hive Compute Marketplace</a>
    <small>Marketplace inference, spare-GPU supply, x402/MPP rails, provider earnings, and the platform fee.</small>
  </li>
</ol>

## Start With The Boundary

If a feature can run locally with the user's own keys and machine, keep it free by default.

If a feature needs HivemindOS to provide hosted infrastructure, shared room orchestration, reliability work, or ongoing third-party usage, put it in the paid-feature shelf and say so plainly.

## Strategy Pages

<div class="docGrid">
  <section class="docCard">
    <h3>HivemindOS Ecosystem Plan</h3>
    <p>The full plan for the free product, premium services, Honey, HIVE, revenue allocation, treasury reserves, buybacks, and the value wheel.</p>
    <a href="ecosystem-plan.html">Open ecosystem plan</a>
  </section>
  <section class="docCard">
    <h3>Honey, HIVE, And Treasury</h3>
    <p>The contribution and ownership layers: Honey earning paths, HIVE claims, treasury strategy, buybacks, future burns, staking, and seasonal reward pools.</p>
    <a href="honey-hive-treasury.html">Open token model</a>
  </section>
  <section class="docCard">
    <h3>HIVE Staking And Community Tiers</h3>
    <p>The stake-to-unlock model for holder identity, alpha rooms, bounties, marketplace curation, private opportunity rooms, seasonal HIVE rewards, Operator influence, and Visionary council access.</p>
    <a href="hive-staking-and-community-tiers.html">Open staking tiers</a>
  </section>
</div>

## Seasonal HIVE Reward Pool

The proposed staking reward message is simple:

```text
Stake higher. Earn stronger reward weight.
```

Every reward season, eligible HivemindOS revenue can fund one fixed HIVE reward pool. Stakers split that pool by time-weighted active stake, with higher tiers applying stronger reward weight. This keeps the company payout capped while making anonymous wallet splitting worse than staking the same HIVE in the highest tier it qualifies for.

For every `$1,000,000` in eligible HivemindOS revenue, the proposed display model is:

| Tier      | Reward weight | Boost vs Holder |
| --------- | ------------: | --------------: |
| Holder    |         1.00x |            Base |
| Supporter |         1.10x |            +10% |
| Builder   |         1.25x |            +25% |
| Curator   |         1.45x |            +45% |
| Operator  |         1.70x |            +70% |
| Visionary |         2.00x |           +100% |
| **Pool**  |              | **3.9375% / `$39,375` in HIVE rewards** |

The seasonal reward rules are simple: there is no pre-season staking requirement, a wallet needs at least 7 active staking days in the season to qualify, rewards are based on how much weighted HIVE was staked and for how long, and reward credit stops when a wallet requests unstaking. When a season publishes the HIVE price used for rewards, the page can show both the dollar value and the estimated HIVE amount. Actual payouts still need an official claim or treasury process. The current staking vault should not be described as paying HIVE rewards directly.

## Paid-Service Pages

<div class="docGrid">
  <section class="docCard">
    <h3>Paid Features</h3>
    <p>The current paid-feature shelf. Start here when a capability needs managed infrastructure, hosted reliability, or premium orchestration.</p>
    <a href="./paid-features/">Open paid features</a>
  </section>
  <section class="docCard">
    <h3>HivemindOS Cloud Agent Calls</h3>
    <p>Managed LiveKit/SFU rooms for mobile-friendly, multi-party, and multi-agent voice calls.</p>
    <a href="paid-features/hivemind-cloud-agent-calls.html">Open cloud calls</a>
  </section>
  <section class="docCard">
    <h3>Hive Compute Marketplace</h3>
    <p>First-party marketplace inference with spare-GPU supply, x402 and MPP payment rails, provider earnings, and a default 20% platform fee.</p>
    <a href="paid-features/hive-compute-marketplace.html">Open compute marketplace</a>
  </section>
</div>

## Current Boundary

| Area               | Free default                                          | Paid path                                                    |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| Agent calls        | BYOK Agent Calls using the user's OpenAI Realtime key | HivemindOS Cloud Agent Calls using managed LiveKit/SFU rooms |
| Agent runtime work | Local and user-configured runtimes                    | Future managed runtime capacity, if offered                  |
| Model inference    | Local models and user-configured model keys           | Hive Compute marketplace routing, settlement, receipts, reputation, and payout state |
| Brain and vault    | Local Obsidian vault and user-owned sync choices      | Future managed brain hosting, if offered                     |

## Managed Agent Credits

Managed agents use HONEY as the visible credit unit. The ledger separates reward Honey from managed HONEY credits:

- Reward Honey is earned through ecosystem participation and may be claimable to HIVE.
- Managed HONEY credits are spend-only service credits for HivemindOS-managed agents and cannot be claimed to HIVE.

Users can start without provider API keys. For the current hosted paid agent, the visible default is **$0.001 per successful hosted chat completion**. HivemindOS can also quote larger managed jobs through managed HONEY credits, then run the agent through HivemindOS-held provider keys at a configured markup.

Official credit changes are spoof-resistant: credits are written only from verified funding events, and debits are signed by trusted managed runtimes after provider usage is observed server-side.

## Payment Rails

Paid HivemindOS services and marketplace items should support multiple payment rails.

Supported or planned rails include:

- Card and fiat checkout.
- Managed HONEY credits.
- Crypto payments.
- HIVE payments.
- x402-enabled pay-per-use payments.
- Enterprise invoices or contracts.

HIVE is a first-class payment rail and the staking alignment layer. Users can spend HIVE when they choose it as the payment method, and they can stake HIVE when they want status, discounts, trust, distribution, early access, curation rights, and governance signal.

The product rule is: HIVE can be used to pay, but HIVE should not be the only way to access ordinary paid services.

## Revenue Sources

Optional premium services may include Hive Cloud, Hive Compute, managed compute, the Agent Marketplace, and Enterprise.

Hive Cloud covers one-click deployment, managed infrastructure, hosted memory, team workspaces, and monitoring.

Hive Compute routes marketplace inference to live worker capacity and settles usage through the hosted gateway. The current default marketplace policy charges token-metered retail usage, keeps a **20% HivemindOS platform fee**, and records provider earnings for payout.

Managed compute runs agents and swarms on Hivemind infrastructure with usage-based pricing.

The Agent Marketplace can support paid agents, swarms, workflows, and templates, with Hivemind taking a marketplace fee.

Marketplace creators can choose pricing models such as free, pay-per-use, lifetime access, subscription access, bounty-funded creation, or commissions on revenue generated through a workflow.

Enterprise covers SSO, teams, compliance, private deployments, and support contracts.

Managed hosted integrations are also direct revenue. The managed X API and X MCP path lets users sign in with X through HivemindOS-controlled hosted infrastructure, then spend hosted HivemindOS credits on vetted X API or X MCP calls. The hosted gateway owns OAuth token custody, pricing policy, credit balances, and debits. The downloaded app only forwards the server-issued credit token. The current default policy charges retail at upstream X API unit cost plus **25% markup**, with a **$0.001 minimum debit**; the default X MCP tool call is `$0.005` upstream and `$0.00625` retail. Production pricing is served by the hosted pricing policy so it can track X Developer Console rates without making the local app authoritative.

Trading and on-chain activity is also a direct revenue source. Official builds collect a policy-driven **1% platform fee with a $0.01 minimum** on supported local-wallet actions: stablecoin sends, DEX swaps, xStocks trades, Robinhood Chain Stock Token trades, live Alpaca orders, ordinary public x402 payments, and Veil private transfers. HivemindOS-hosted MiroShark proxy runs are the named exception: the **$1.20 USDC** charge already includes the **$0.20** HivemindOS cut, so the local wallet does not add a separate 1% x402 platform-fee transfer. Zero Human Companies running in HivemindOS use a **2% revenue share with a $0.01 minimum** on recorded company revenue. Official builds also collect a **0.005% Hyperliquid builder fee** on eligible local Hyperliquid fills. Paper trades and read-only checks are never charged. Recipient addresses and official wallet-fee policy stay in HivemindOS-managed infrastructure. See [Wallets, Honey, And x402](../for-users/features/wallets-honey-and-x402.html) and the [Trading](../for-users/trading/index.html) docs for the mechanism.

## HIVE Staker Discounts

HIVE staking can make paid managed services cheaper without making them HIVE-only.

Eligible discounts may apply to Hive Cloud subscriptions, managed compute, managed HONEY credit purchases, Agent Marketplace platform fees, and hosted team, memory, monitoring, or orchestration add-ons. Non-stakers should still be able to buy the same paid services at the standard fiat, card, managed HONEY credit, or enterprise price.

HIVE can lower managed-service pricing in two ways: paying with HIVE can earn a small checkout discount, and staking HIVE can earn a tiered platform-margin discount. The launch target is a 3-5% checkout discount for HIVE payment, plus the staking tier discount when eligible, capped at 30% combined.

Discounts apply to HivemindOS platform margin, not raw provider or infrastructure cost. A checkout should not discount below direct compute cost, provider API cost, payment processor fees, or other pass-through costs needed to deliver the service.

## HIVE Community Utility

HIVE staking also powers community utility around the future Agent Marketplace and bounty economy.

Curators are marketplace power users who help surface useful agents, workflows, templates, skills, and bounties. Their benefit is early opportunity access, reputation as trusted recommenders, and better distribution surfaces for their own high-quality listings.

Operators and Visionaries get stronger ecosystem ops influence: roadmap signaling, bounty theme prioritization, marketplace quality standards, grant direction, and strategy-room access. Visionary can also qualify for a scarce council seat with direct roadmap access and a structured channel to advise the developer or core team. This influence does not grant treasury control, admin access to user funds, binding voting authority, or unilateral payout authority.
