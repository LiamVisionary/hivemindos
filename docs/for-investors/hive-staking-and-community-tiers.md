---
title: HIVE Staking And Community Tiers
description: Six optional non-custodial HIVE staking tiers with Honey earning, free-agent usage, and member-pricing benefits—without yield, ownership, or required product access.
---

# HIVE Staking And Community Tiers

HIVE staking is an optional membership layer. Stake HIVE across six bee tiers to earn qualifying Honey faster, receive more free-agent usage, and save up to 61% on participating services. HivemindOS remains useful without holding or staking HIVE.

## Product Boundary

The free local-first product remains free. Ordinary cloud subscriptions, managed usage, and enterprise contracts remain available through supported non-token payment paths.

Staking may provide:

- wallet-linked community identity and profile status
- stake-based Honey earning multipliers
- stake-based free-agent usage multipliers
- member pricing of up to 61% off on participating services
- eligibility signals for token-specific community activities

Staking does not grant company ownership, binding governance, treasury control, admin access, guaranteed placement, yield, revenue share, or a financial return. Product benefits are services, not payouts.

## V1 Contract Model

The Base staking contract is deliberately simple:

1. A user connects a Base-compatible wallet.
2. The user approves and stakes HIVE.
3. The contract records active stake for tier reads.
4. The user requests unstaking.
5. The visible three-day cooldown completes.
6. The user withdraws the unstaked HIVE to the same wallet.

The user retains the right to withdraw principal after the cooldown. Staked principal is not company treasury property and cannot be used for buybacks.

## Six Membership Tiers

| Public tier | Active stake | Honey earning | Free-agent usage |
| --- | ---: | ---: | ---: |
| Honeybee | 1m HIVE | 1.00× | 1.10× |
| Bumblebee | 10m HIVE | 1.10× | 1.20× |
| Mason Bee | 50m HIVE | 1.25× | 1.35× |
| Orchid Bee | 100m HIVE | 1.45× | 1.50× |
| Carpenter Bee | 250m HIVE | 1.70× | 1.75× |
| Queen Bee | 1b HIVE | 2.00× | 2.00× |

These are membership and service-benefit tiers, not investment-return tiers. Tier names and thresholds do not promise future value.

## Honey Earning Multipliers

The Honey column applies the active tier multiplier when qualifying Honey is earned from accepted contribution evidence. It does not create Honey for wallet activity alone, weaken contribution review, or create a transferable balance.

Honey remains one cumulative, non-transferable, non-spendable contribution ledger. A multiplier changes how much Honey an accepted contribution records; it does not convert Honey to HIVE or make Honey cash-equivalent. HivemindOS-controlled infrastructure verifies the linked staking wallet and applies the multiplier.

## Free-Agent Usage Multipliers

The ordinary free-agent allowance remains available without staking and is powered by Swarm Sovereign models. A workspace with a signature-verified staking-wallet link receives the tier multiplier shown above on its eligible request and token allowance.

- The allowance is an in-kind service benefit. It cannot be transferred, redeemed, withdrawn, sold, or converted into cash, HIVE, Honey, revenue, or treasury assets.
- One verified workspace shares one boosted allowance across its devices. Linking one wallet does not create a new boosted pool for every device.
- IP and platform-wide safety limits remain unchanged.
- Missing authentication, an unlinked workspace, an unknown tier, or a failed server-to-server tier check falls back to the ordinary unstaked allowance.
- If cumulative Honey independently qualifies a workspace for a bounded allowance, the higher verified multiplier applies; the multipliers do not stack.

The quota schedule may change or pause prospectively for capacity, abuse, legal, security, or operational reasons. Usage already consumed is not a stored balance or property right.

## Member Pricing: Up To 61% Off

Participating services may offer HIVE members up to 61% off. This is consumption pricing: a member pays a lower price for eligible usage, and no tier receives a payout.

Exact service prices, cost floors, eligible products, and tier-level discount calculations remain server-owned. HivemindOS-controlled infrastructure resolves the active stake and quoted price; the downloadable client cannot grant a tier, override a price, or price a service below its enforced cost floor.

The universal public claim is “up to 61% off,” not a promise that every product, purchase, or tier receives the maximum discount. Current exact prices should be read from the owning hosted service at quote time rather than copied into static documentation.

## Revenue Policy Is Separate From Staking

HivemindOS allocates 15% of each service's server-owned allocation basis — realized margin for most managed services, recognized platform revenue for others — to HIVE buybacks. A separate exact 15% goes to the company treasury. The treasury does not fund buybacks, and staked principal funds neither rail. The tokenomics policy assigns no fixed use to the remainder.

Confirmed HIVE purchases are published in the [HIVE Buyback Ledger](https://hivemindos.app/buybacks/). HivemindOS does not burn HIVE. Buybacks and treasury allocations create no payout, ownership right, governance right, price promise, or claim for a holder or staker.

## Safety And Communication

- Show the contract address, chain, active stake, pending unstake, cooldown, and withdrawal state.
- Never imply that user principal is available to the company treasury or buyback rail.
- Never market expected appreciation as a reason to stake.
- Never present company revenue or buybacks as a staking return.
- Keep core product access independent from token ownership.
- Publish material benefit or policy changes prospectively with an effective date.

Tier thresholds, member pricing, eligibility, staking benefits, and execution may change, pause, or end for legal, regulatory, tax, accounting, security, liquidity, market-integrity, reserve, or operational reasons. Completed on-chain receipts remain part of the historical record. See [Tokenomics Policy Changes](honey-hive-treasury.html#tokenomics-policy-changes) for the canonical policy.

<nav class="nextNav" aria-label="Monetization reading path">
  <a href="hive-token-receipts.html">Back: HIVE Token Receipts</a>
  <a href="paid-features/">Next: Paid Features</a>
</nav>
