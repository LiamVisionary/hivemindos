---
title: Monetization
description: HivemindOS paid feature boundaries and premium service notes.
---

# Monetization

HivemindOS should be useful before anyone pays for a cloud feature. Start here when you want to understand what stays free, what becomes paid, and how Honey and HIVE fit around the product without blocking it.

The line is simple: local-first control room features stay available by default, and paid services cover infrastructure that costs real money to run or maintain for users.

The ecosystem plan keeps that boundary explicit: HivemindOS remains free and open source, while optional premium services fund company operations, growth, treasury reserves, and HIVE buybacks.

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
    <small>Stake-to-unlock, tier benefits, alpha rooms, bounties, governance, and review policy.</small>
  </li>
  <li>
    <span>4</span>
    <a href="paid-features/">Paid Features</a>
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
    <p>The contribution and ownership layers: Honey earning paths, HIVE claims, treasury strategy, buybacks, future burns, and staking.</p>
    <a href="honey-hive-treasury.html">Open token model</a>
  </section>
  <section class="docCard">
    <h3>HIVE Staking And Community Tiers</h3>
    <p>The stake-to-unlock model for holder identity, alpha rooms, bounties, curator rights, governance signaling, Operator status, and Visionary access.</p>
    <a href="hive-staking-and-community-tiers.html">Open staking tiers</a>
  </section>
</div>

## Paid-Service Pages

<div class="docGrid">
  <section class="docCard">
    <h3>Paid Features</h3>
    <p>The current paid-feature shelf. Start here when a capability needs managed infrastructure, hosted reliability, or premium orchestration.</p>
    <a href="paid-features/">Open paid features</a>
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

Users can start without provider API keys. HivemindOS quotes the task, lets the user fund managed HONEY through a verified rail such as Stripe Checkout, Stripe crypto payments, x402, Bankr, an agent wallet, or HIVE, then runs the managed agent through HivemindOS-held provider keys at a configured markup.

Official credit changes are spoof-resistant: credits are written only from verified funding events, and debits are signed by trusted managed runtimes after provider usage is observed server-side.

## Revenue Sources

Optional premium services may include Hive Cloud, managed compute, the Agent Marketplace, and Enterprise.

Hive Cloud covers one-click deployment, managed infrastructure, hosted memory, team workspaces, and monitoring.

Managed compute runs agents and swarms on Hivemind infrastructure with usage-based pricing.

The Agent Marketplace can support paid agents, swarms, workflows, and templates, with Hivemind taking a marketplace fee.

Enterprise covers SSO, teams, compliance, private deployments, and support contracts.

## HIVE Staker Discounts

HIVE staking can make paid managed services cheaper without making them HIVE-only.

Eligible discounts may apply to Hive Cloud subscriptions, managed compute, managed HONEY credit purchases, Agent Marketplace platform fees, and hosted team, memory, monitoring, or orchestration add-ons. Non-stakers should still be able to buy the same paid services at the standard fiat, card, managed HONEY credit, or enterprise price.

Discounts apply to HivemindOS platform margin, not raw provider or infrastructure cost. A checkout should not discount below direct compute cost, provider API cost, payment processor fees, or other pass-through costs needed to deliver the service.
