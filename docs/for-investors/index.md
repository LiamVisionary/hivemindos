---
title: For Investors
description: HivemindOS business model — revenue streams, trading and on-chain fees, paid-feature boundaries, Honey and HIVE rewards, staking tiers, treasury, and buybacks.
---

# For Investors

This is the business side of HivemindOS: how it makes money, where the free-vs-paid line sits, and how the Honey/HIVE economy, treasury, and buybacks fit together. For the product itself, see the [For Users](../for-users/) docs.

Revenue comes from optional premium services, trading and on-chain fees, hosted agent/model messages, the Agent Marketplace, and Enterprise. The details live in the [Ecosystem Plan](ecosystem-plan.html) and [Paid Features](paid-features/), but the current numbers should be visible up front.

## Current Revenue Snapshot

| Revenue stream | Current number | What that means |
| --- | ---: | --- |
| Wallet sends, swaps, live stocks, xStocks, x402, and private payments | **1%**, with a **$0.01 minimum** | A `$100` action produces `$1.00` in revenue. A tiny `$0.25` test action produces the `$0.01` minimum. |
| Hyperliquid builder fee | **0.005%** of eligible filled notional | A `$10,000` fill produces `$0.50` in revenue. |
| Hosted HivemindOS agent/model messages | **$0.001 per successful hosted chat completion** on the current default hosted paid agent | `1,000` messages produces `$1`. `100,000` messages produces `$100`. `1,000,000` messages produces `$1,000`. |
| Future paid infrastructure | TBD by product | Hive Cloud, managed compute, marketplace fees, and enterprise contracts. |

The app still shows fees before users confirm money movement. The point here is not mystery monetization. It is clear take rate, clear message pricing, and paid infrastructure where HivemindOS actually runs something.

HivemindOS should be useful before anyone pays for a cloud feature. Start here when you want to understand what stays free, what becomes paid, and how Honey and HIVE fit around the product without blocking it.

The line is simple: local-first control room features stay available by default, and paid services cover infrastructure that costs real money to run or maintain for users.

The ecosystem plan keeps that boundary explicit: HivemindOS remains free and open source, while optional premium services fund company operations, growth, treasury reserves, revenue-backed HIVE buybacks, and proposed seasonal HIVE reward buckets for stakers.

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
    <small>Stake-to-unlock, tier benefits, seasonal HIVE reward buckets, alpha rooms, bounties, governance, and review policy.</small>
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
    <p>The contribution and ownership layers: Honey earning paths, HIVE claims, treasury strategy, buybacks, future burns, staking, and seasonal reward buckets.</p>
    <a href="honey-hive-treasury.html">Open token model</a>
  </section>
  <section class="docCard">
    <h3>HIVE Staking And Community Tiers</h3>
    <p>The stake-to-unlock model for holder identity, alpha rooms, bounties, marketplace curation, private opportunity rooms, seasonal HIVE rewards, Operator influence, and Visionary council access.</p>
    <a href="hive-staking-and-community-tiers.html">Open staking tiers</a>
  </section>
</div>

## Seasonal HIVE Reward Buckets

The proposed staking reward message is simple:

```text
Stake higher. Earn from a bigger bucket.
```

Every reward season, eligible HivemindOS revenue can fund separate HIVE reward buckets for each staking tier. Each tier splits its own bucket by time-weighted staking, so higher-tier wallets do not dilute lower-tier wallets and late stakes only earn for the time they were active.

For every `$1,000,000` in eligible HivemindOS revenue, the proposed display model is:

| Tier      | Bucket rate | Per `$1,000,000` eligible revenue |
| --------- | ----------: | --------------------------------: |
| Holder    |     0.0625% |                    `$625` in HIVE |
| Supporter |      0.125% |                  `$1,250` in HIVE |
| Builder   |       0.25% |                  `$2,500` in HIVE |
| Curator   |        0.5% |                  `$5,000` in HIVE |
| Operator  |          1% |                 `$10,000` in HIVE |
| Visionary |          2% |                 `$20,000` in HIVE |
| **Total** |  **3.9375%** |          **`$39,375` in HIVE rewards** |

The seasonal reward rules are simple: there is no pre-season staking requirement, a wallet needs at least 7 active staking days in the season to qualify, rewards are based on how much HIVE was staked and for how long, and reward credit stops when a wallet requests unstaking. When a season publishes the HIVE price used for rewards, the page can show both the dollar value and the estimated HIVE amount. Actual payouts still need an official claim or treasury process. The current staking vault should not be described as paying HIVE rewards directly.

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
</div>

## Current Boundary

| Area               | Free default                                          | Paid path                                                    |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------ |
| Agent calls        | BYOK Agent Calls using the user's OpenAI Realtime key | HivemindOS Cloud Agent Calls using managed LiveKit/SFU rooms |
| Agent runtime work | Local and user-configured runtimes                    | Future managed runtime capacity, if offered                  |
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

Optional premium services may include Hive Cloud, managed compute, the Agent Marketplace, and Enterprise.

Hive Cloud covers one-click deployment, managed infrastructure, hosted memory, team workspaces, and monitoring.

Managed compute runs agents and swarms on Hivemind infrastructure with usage-based pricing.

The Agent Marketplace can support paid agents, swarms, workflows, and templates, with Hivemind taking a marketplace fee.

Marketplace creators can choose pricing models such as free, pay-per-use, lifetime access, subscription access, bounty-funded creation, or commissions on revenue generated through a workflow.

Enterprise covers SSO, teams, compliance, private deployments, and support contracts.

Trading and on-chain activity is also a direct revenue source. Official builds collect a policy-driven **1% platform fee with a $0.01 minimum** on supported local-wallet actions: USDC sends, DEX swaps, xStocks trades, live Alpaca orders, public x402 payments, and Veil private transfers. Official builds also collect a **0.005% Hyperliquid builder fee** on eligible local Hyperliquid fills. Paper trades and read-only checks are never charged. Rates and recipient addresses live in the official platform-fee policy, not the app. See [Wallets, Honey, And x402](../for-users/features/wallets-honey-and-x402.html) and the [Trading](../for-users/trading/index.html) docs for the mechanism.

## HIVE Staker Discounts

HIVE staking can make paid managed services cheaper without making them HIVE-only.

Eligible discounts may apply to Hive Cloud subscriptions, managed compute, managed HONEY credit purchases, Agent Marketplace platform fees, and hosted team, memory, monitoring, or orchestration add-ons. Non-stakers should still be able to buy the same paid services at the standard fiat, card, managed HONEY credit, or enterprise price.

HIVE can lower managed-service pricing in two ways: paying with HIVE can earn a small checkout discount, and staking HIVE can earn a tiered platform-margin discount. The launch target is a 3-5% checkout discount for HIVE payment, plus the staking tier discount when eligible, capped at 30% combined.

Discounts apply to HivemindOS platform margin, not raw provider or infrastructure cost. A checkout should not discount below direct compute cost, provider API cost, payment processor fees, or other pass-through costs needed to deliver the service.

## HIVE Community Utility

HIVE staking also powers community utility around the future Agent Marketplace and bounty economy.

Curators are marketplace power users who help surface useful agents, workflows, templates, skills, and bounties. Their benefit is early opportunity access, reputation as trusted recommenders, and better distribution surfaces for their own high-quality listings.

Operators and Visionaries get stronger ecosystem ops influence: roadmap signaling, bounty theme prioritization, marketplace quality standards, grant direction, and strategy-room access. Visionary can also qualify for a scarce council seat with direct roadmap access and a structured channel to advise the developer or core team. This influence does not grant treasury control, admin access to user funds, binding voting authority, or unilateral payout authority.
