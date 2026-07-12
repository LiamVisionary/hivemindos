---
title: HIVE Staking And Community Tiers
description: Non-custodial HIVE staking for optional community identity, access signals, and tier-based member usage pricing without yield, ownership, or required product access.
---

# HIVE Staking And Community Tiers

HIVE staking is an optional on-chain signal of ecosystem alignment. Staking carries community status, access signals, and tier-based member usage pricing on participating hive products. It does not sit in front of the core product and it does not automatically produce rewards, company ownership, or a claim on revenue.

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

Staking does not grant treasury control, company voting rights, admin access, guaranteed listing placement, or a financial return. Member usage pricing changes the unit price a member pays for usage; it never pays anything out.

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

These are social, access, and member-pricing tiers, not investment-return tiers. Tier names and thresholds do not promise future value.

## Member Usage Pricing

Staking tier can set the member unit price a wallet pays when consuming participating hive products. This is consumption pricing, not value distribution: a higher tier pays a lower unit price for usage it buys, and no tier is paid anything.

- Member pricing is server-enforced. Effective unit prices are resolved by HivemindOS-controlled infrastructure, never by local environment, client configuration, or client-supplied values.
- Member pricing is product-scoped. Each participating product publishes its own tier usage pricing, and a tier does not promise a specific price on every product or forever.
- Member pricing is not a return. It never pays out cash, tokens, revenue, or any claim on proceeds. Money still moves in one direction: from the member to the product.

Core subscriptions and ordinary non-token payment paths remain independent of staking, and HivemindOS remains usable without holding or staking HIVE.

Hive Research launches with the following server-enforced analysis prices. Discounts are measured against the same $0.99 price available without staking.

| Tier | Price per analysis | Discount |
| --- | ---: | ---: |
| No stake | $0.99 | Standard price |
| Holder | $0.99 | 0% |
| Supporter | $0.89 | 10% |
| Builder | $0.79 | 20% |
| Curator | $0.69 | 30% |
| Operator | $0.49 | 51% |
| Visionary | $0.39 cost-backed floor | 61% at the current floor |

The cost-backed floor may rise when the underlying data or model cost rises; the server will not price a tier below the configured landed-cost floor.

## HivemindOS Revenue Buyback Policy And Receipt

HivemindOS allocates 15% of recognized HivemindOS platform revenue to weekly automatic HIVE purchase batches. Recognized revenue excludes directly attributable pass-through costs, refunds, reversals, gross marketplace transaction volume, and purchased credits that have not yet been consumed.

Hive Research completed one real paid production analysis and one treasury-funded HIVE purchase on Base under its earlier app-specific policy. The completed transaction remains public in the [Agent Buyback Ledger](https://hivemindos.app/buybacks/#hive-research), while new research revenue follows the 15% platform-wide policy.

Purchases use the dedicated company treasury rather than a connected user wallet or staked principal. A purchase is not reported as burned unless a separate burn transaction exists.

This policy operates independently from staking. Treasury HIVE remains company property until spent or burned; no tier receives a payout, distribution, ownership right, or claim on purchases, burns, revenue, or treasury assets.

## No Automatic Yield

The v1 staking contract is not a yield farm. It has no automatic revenue share, token emission, reward multiplier, or buyback-funded distribution.

Member usage pricing is a product-pricing program, not a reward paid by the staking contract or the treasury. Revenue-linked purchases and burns are ecosystem treasury actions, not distributions or promises to stakers. Revenue share, cash distributions, or any claim on business proceeds remain separate and are not implied by staking.

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

Tier thresholds, member pricing, eligibility, staking benefits, purchase or burn policies, and execution may change, pause, or end for legal, regulatory, tax, accounting, security, liquidity, market-integrity, reserve, or operational reasons. Material changes are published prospectively with an effective date; completed on-chain receipts remain part of the historical record. See [Tokenomics Policy Changes](honey-hive-treasury.html#tokenomics-policy-changes) for the canonical policy.

<nav class="nextNav" aria-label="Monetization reading path">
  <a href="hive-token-receipts.html">Back: HIVE Token Receipts</a>
  <a href="paid-features/">Next: Paid Features</a>
</nav>
