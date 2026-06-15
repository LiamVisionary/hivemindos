---
title: HIVE Staking And Community Tiers
description: How HIVE staking can unlock community alignment, identity, alpha access, bounties, and governance without blocking non-crypto product users.
---

# HIVE Staking And Community Tiers

Staking means a user locks HIVE while they want ecosystem benefits.

The user still owns the HIVE. It is not a payment to HivemindOS. While the stake remains locked, the user receives community, reputation, and alignment benefits. If the user unstakes, the tokens return to them and the benefits pause.

The staking layer should not sit in front of the core product. HivemindOS remains usable without holding HIVE.

## Product Boundary

HIVE staking is for community alignment.

It can unlock:

- Holder identity and status.
- Governance signaling.
- Alpha rooms.
- Early workflow drops.
- Bounty boosting.
- Curator eligibility.
- Marketplace trust signals.
- Honey multipliers.
- Marketplace fee discounts.

It should not be the only way to access optional paid product features.

Paid product features should remain available through non-crypto paths such as card payments, fiat subscriptions, managed HONEY credits, or enterprise contracts. HIVE staking can make those paths better, cheaper, higher-status, or more powerful, but it should not make ordinary paid users feel locked out of the product.

## Why Stake Instead Of Spend

Staking is better than pay-per-action for the token layer.

Pay-per-action forces users to spend HIVE constantly. That adds friction and can create sell pressure.

Stake-to-unlock is cleaner:

```text
Hold or stake HIVE
  -> unlock benefits
  -> keep using the ecosystem
  -> unstake when benefits are no longer wanted
```

The result is a structural sink. Supply stays locked for as long as people want the benefits.

Buybacks can still support the ecosystem, but buybacks are a flow. Staking is a stock: it removes tokens from circulation while the user wants access, status, and influence.

## V1 Staking Model

Launch staking as a real Base staking contract.

The v1 staking system should be non-custodial:

- Users connect a wallet.
- Users approve the HIVE token for the staking contract.
- Users stake HIVE into the contract.
- The contract records each wallet's staked balance.
- HivemindOS, Telegram permissions, alpha-room checks, governance polls, and marketplace reputation read the staked balance.
- Users can request unstaking.
- After a visible cooldown, users withdraw their HIVE back to the same wallet.

The Telegram tip bot ledger can still handle tips and bounty escrow, but it should not be the canonical staking system. Staking should happen on-chain so users can verify custody and exit rules directly.

## Contract Requirements

The v1 contract should stay simple.

Required behavior:

- Stake HIVE.
- Request unstake.
- Withdraw after the cooldown.
- Read a wallet's active staked balance.
- Read a wallet's pending unstake amount.
- Read when pending unstake becomes withdrawable.
- Emit events for stake, unstake request, withdrawal, pause, and cooldown changes.

Recommended public methods:

```solidity
stake(uint256 amount)
requestUnstake(uint256 amount)
withdrawUnstaked()
stakedBalanceOf(address account) view returns (uint256)
pendingUnstakeOf(address account) view returns (uint256)
unstakeAvailableAt(address account) view returns (uint256)
```

Recommended safety rules:

- No rewards emission at launch.
- No admin withdrawal of user stake.
- No admin function that can move user principal.
- A short unstake cooldown, such as 3 to 7 days, to reduce flash-staking.
- A bounded cooldown setting so governance or admins cannot silently trap users.
- Pausable staking for emergencies.
- User-controlled withdrawal even if product permissions are paused.
- Multisig ownership for pause and parameter controls.
- Verified source code on Base.
- Base Sepolia testing before Base mainnet deployment.

The contract should be boring on purpose. The value is the social, product, and community layer that reads staking state, not a complex yield mechanism.

## How Users Stake

The product staking flow should be:

1. Open the dedicated `/stake` route or the Wallets view.
2. Connect or add a Base-compatible wallet.
   - In the Tauri desktop app, staking uses a local HivemindOS wallet from the encrypted wallet vault.
   - In a normal browser build, staking can use an injected browser wallet when available.
3. Refresh wallet portfolios so the app can detect HIVE balances across connected Base wallets.
4. Press `Stake` from the `/stake` wallet list or directly on the Base HIVE token row in Wallets.
5. Enter an amount or choose the maximum available amount.
6. Approve HIVE.
7. Confirm the stake transaction.
8. See the active tier, pending unstake status, and cooldown rules once the staking contract read confirms.

After staking, the same wallet can be linked to community surfaces:

- HIVE profile badge.
- Telegram account.
- Alpha-room access checks.
- Governance vote weight.
- Bounty curator eligibility.
- Marketplace seller or contributor status.

Users who do not use crypto can still buy product features through fiat, subscriptions, managed HONEY credits, or enterprise contracts. They simply do not receive the HIVE-only community alignment signals unless they stake.

## Launch Tiers

The tier names are social titles, but each title should map to real privileges.

| Tier       | Stake     | Role                                      |
| ---------- | --------: | ----------------------------------------- |
| Holder     |    1m HIVE | Wallet-linked identity and basic status   |
| Supporter  |   10m HIVE | Community access and stronger signal      |
| Builder    |   50m HIVE | Early workflows and contributor status    |
| Curator    |  100m HIVE | Bounty and marketplace curation eligibility |
| Operator   |  250m HIVE | Ecosystem operations and higher influence |
| Visionary  |    1b HIVE | Highest alignment, access, and status     |

These thresholds are fixed in HIVE at launch. They should not float minute-by-minute with price.

Early believers take more risk while the ecosystem is smaller, so they may earn meaningful status earlier. If HIVE appreciates later, those early locked positions become harder to replicate, which is part of the alignment mechanic.

## Tier Benefits

### Holder

Holder is the low-friction identity tier.

Benefits:

- Wallet-linked HIVE holder badge.
- Basic profile/status surface.
- Eligibility for public holder announcements.
- Basic governance signaling in non-binding polls.

Holder should not unlock the most valuable rooms or rights. It proves setup and alignment, not deep contribution.

### Supporter

Supporter is the first meaningful community tier.

Benefits:

- Supporter badge.
- Basic community holder room.
- Small Honey multiplier.
- Access to selected early updates.
- Stronger governance signal than Holder.

### Builder

Builder is for people who create, test, or use early workflows seriously.

Benefits:

- Builder badge.
- Access to alpha workflow drops.
- Early access to zero-human company monetization workflows.
- Higher Honey multiplier.
- Contributor reputation surface.
- Eligibility for builder-only experiments.

### Curator

Curator is for trusted marketplace and bounty participants.

Benefits:

- Curator badge.
- Bounty boost eligibility.
- Ability to help surface, categorize, and recommend bounties.
- Eligibility for curator-assisted bounty review.
- Marketplace trust signal for agents, swarms, workflows, and templates.
- Higher marketplace visibility for published work.

Curator does not mean unilateral payout power. Admins or a multisig should retain final treasury and dispute control at launch.

### Operator

Operator is for serious ecosystem members who help the network run.

Benefits:

- Operator badge.
- Higher governance weight on roadmap and community votes.
- Private operator room.
- Priority access to alpha workflows.
- Higher Honey multiplier.
- Lower marketplace fee tier.
- Higher bounty boost visibility.
- Eligibility to help curate bounty categories and marketplace policy.
- Trusted seller or trusted contributor status for published agents and workflows.

Operator should feel like: “I help operate the network.”

### Visionary

Visionary is the top alignment tier.

Benefits:

- Visionary badge.
- Highest Honey multiplier.
- Lowest marketplace fee tier.
- Highest bounty boost visibility.
- Highest-signal private room.
- Earliest access to experimental monetization workflows.
- Ability to propose official bounty boards or themed grant rounds.
- Priority listing for marketplace agents and workflows.
- Public recognition as a top aligned backer, when the user opts in.

Visionary should feel like: “I am a major aligned backer and ecosystem tastemaker.”

Visionary is not treasury control. Visionaries can propose, signal, curate, and boost. Final execution of treasury spending should remain with admin or multisig controls.

## Alpha Rooms

Alpha rooms are early-access and community-status spaces. They are not permanent product lockouts.

They can include:

- Early zero-human company monetization workflows.
- Agent marketplace experiments.
- Bounty board previews.
- Product roadmap previews.
- Operator and Visionary strategy discussions.

If an alpha-room experiment becomes a stable paid product feature, it should eventually have a non-crypto paid path.

## Governance

Governance is a signaling and prioritization layer at launch.

Stake can influence:

- Roadmap priorities.
- Treasury-backed bounty themes.
- Marketplace policy proposals.
- Community grant priorities.
- Alpha workflow focus areas.

Governance should start as non-binding or admin-executed signaling. HIVE holders can help choose direction, but smart-contract treasury execution and binding protocol governance should wait until the system is mature enough to be safe.

## Bounties And Boosting

Bounty boosts let community members add HIVE from their internal Telegram balance to increase a bounty's visibility and reward.

At launch:

- Boosts can be off-chain in the Telegram tip bot ledger.
- Boosted funds lock into the bounty escrow bucket.
- Accepted payouts credit the winner’s internal balance.
- Cancelled or expired bounties refund boosters exactly by ledger entry.
- Admins handle acceptance and disputes.

The staking contract should decide who is eligible to curate, amplify bounty visibility, or receive higher boost weight. The bounty funds themselves can remain in the existing Telegram escrow ledger until a separate bounty escrow contract is worth the extra complexity.

## Tier Review Policy

Do not fully auto-adjust tiers based on live token price.

Fully dynamic tiers are confusing and gameable. They can also punish users abruptly when the token moves.

Recommended policy:

- Keep launch thresholds fixed in HIVE.
- Review tiers monthly or after major market moves.
- Use a public change notice before tier changes.
- Give existing stakers a grace period when thresholds increase.
- Keep paid product pricing separate from staking tiers.

For features with real infrastructure cost, price in credits, fiat, or subscription terms. For status, access, curation, governance, and community alignment, use fixed HIVE staking tiers.

## Unstaking

Unstaking returns the user’s HIVE, but benefits pause.

Recommended rules:

- Users can request unstaking at any time.
- Benefits pause when active stake falls below the tier threshold.
- A short cooldown can prevent flash-staking, such as 3 to 7 days.
- The cooldown should be clear before staking.
- Pending unstake should not count toward tier status.
- After the cooldown, users withdraw from the contract back to their wallet.

## Safety Rules

The staking layer should avoid creating unnecessary security or governance risk.

- Do not give any tier unilateral treasury control.
- Do not let social status bypass safety review.
- Keep admin or multisig control over treasury payouts at launch.
- Keep non-crypto paid paths open for product access.
- Make benefit changes public before they take effect.
- Treat staking as an alignment mechanism, not a promise of financial return.
- Keep staking non-custodial and contract-readable.
- Do not add yield, emissions, slashing, or lock extensions until the simple staking layer is proven.
- Do not deploy upgradeability unless the admin, timelock, and user notice model are explicit.

## Summary

HIVE staking should make alignment visible and useful.

The core product remains open. Paid features remain available without crypto. HIVE staking adds identity, access, influence, bounty power, curation rights, marketplace trust, and Honey multipliers for people who want to be closer to the ecosystem.

That keeps the token attached to real community demand without turning HivemindOS into a token-gated product.

<nav class="nextNav" aria-label="Monetization reading path">
  <a href="honey-hive-treasury.html">Previous: Honey, HIVE, And Treasury</a>
  <a href="paid-features/">Next: Paid Features</a>
</nav>
