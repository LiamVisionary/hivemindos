---
title: HIVE Staking And Community Tiers
description: Non-custodial HIVE staking for optional community identity and access signals without yield, ownership, or required product access.
---

# HIVE Staking And Community Tiers

HIVE staking is an optional on-chain signal of ecosystem alignment. It does not sit in front of the core product and it does not automatically produce rewards, company ownership, or a claim on revenue.

## Product Boundary

HivemindOS remains usable without holding or staking HIVE. Ordinary cloud subscriptions, managed usage, and enterprise contracts remain available through supported non-token payment paths.

Staking may be read as a signal for:

- wallet-linked community identity
- profile status
- access to token-specific community rooms
- contributor or curator eligibility
- non-binding governance signaling
- marketplace reputation context
- early access to explicitly experimental ecosystem programs

Staking does not grant treasury control, company voting rights, admin access, guaranteed listing placement, guaranteed discounts, or a financial return.

## V1 Contract Model

The Base staking contract is designed to be simple:

1. A user connects a Base-compatible wallet.
2. The user approves and stakes HIVE.
3. The contract records active stake for tier reads.
4. The user requests unstaking.
5. The visible three-day cooldown completes.
6. The user withdraws the unstaked HIVE to the same wallet.

The user retains the right to withdraw principal after the cooldown. Administrative controls should not move user principal, extend locks without consent, or convert the staking vault into a treasury or reward pool.

## Launch Tiers

| Tier | Stake | Community signal |
| --- | ---: | --- |
| Holder | 1m HIVE | Wallet-linked identity and basic status |
| Supporter | 10m HIVE | Stronger community alignment signal |
| Builder | 50m HIVE | Contributor status and experimental-access eligibility |
| Curator | 100m HIVE | Curation eligibility and marketplace trust context |
| Operator | 250m HIVE | Ecosystem-operations signaling |
| Visionary | 1b HIVE | Highest community status and council eligibility |

These are social and access tiers, not investment-return tiers. Tier names and thresholds do not promise future value.

## No Automatic Yield

The v1 staking contract is not a yield farm. It has no automatic revenue share, token emission, reward multiplier, or buyback-funded distribution.

If a future reward or discount program is proposed, it must be a separate server-authoritative program with its own funded budget, eligibility rules, expiry, anti-fraud controls, accounting, and legal review. It must not be implied by the act of staking itself.

## Marketplace And Governance Use

Staking may inform reputation and eligibility, but verified work remains the stronger signal.

- A large stake cannot turn an unsafe workflow into a verified workflow.
- A tier cannot override marketplace fraud or quality controls.
- Governance signaling is advisory unless a separate legally valid process says otherwise.
- Council access does not grant control over company assets or user funds.

## Safety And Communication

- Show the contract address, chain, active stake, pending unstake, cooldown, and withdrawal state.
- Never imply that user principal is available to the company treasury.
- Never market expected appreciation as a reason to stake.
- Never present company revenue, buybacks, or reward pools as a promised staking return.
- Keep core product access independent from token ownership.

<nav class="nextNav" aria-label="Monetization reading path">
  <a href="honey-hive-treasury.html">Back: Honey, HIVE, And Treasury</a>
  <a href="paid-features/">Next: Paid Features</a>
</nav>
