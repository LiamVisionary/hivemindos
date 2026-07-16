---
title: HIVE Token Receipts
description: Direct on-chain evidence for the HIVE Base contract, launch distribution, permanent liquidity architecture, contract controls, holder concentration, staking, and confirmed buybacks.
---

# HIVE Token Receipts

HIVE on Base is identified by one canonical contract:

```text
Network: Base (chain ID 8453)
Symbol: HIVE
Contract: 0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3
```

The [live HIVE receipt dossier](https://hivemindos.app/hive/receipts/) and its [machine-readable manifest](https://hivemindos.app/hive-token-receipts.json) publish the current evidence set. This page summarizes the launch facts observed at Base block `48,551,072` on July 12, 2026 UTC. Holder balances, staking totals, liquidity, price, volume, and sentiment change over time and must be refreshed from the linked sources.

## Launch Distribution

The [launch transaction](https://basescan.org/tx/0x35adf31159934811e9bc99b7c1c22183bc7ca19209f88aea0b2d334143d4ea9e) minted 100 billion HIVE into the Doppler launch path.

- 100,000,000,000 HIVE initial supply
- 99,999,999,999.999999957521 HIVE routed to the Uniswap V4 PoolManager
- 0.000000000000042479 HIVE of historical launch rounding dust burned in that transaction
- zero creator premint
- zero creator vesting allocation

The zero-premint receipt describes the launch only. It does not claim that the founder, treasury, team, or related parties hold zero HIVE acquired later on the open market.

The public [Bankr launch record](https://api.bankr.bot/token-launches/0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3) independently binds the contract to the same launch transaction and Uniswap V4 pool ID. It attributes both the deployer identity and fee recipient to [`0x8a25202e830f024aa5e1bdd01a8e997534655c51`](https://basescan.org/address/0x8a25202e830f024aa5e1bdd01a8e997534655c51). The same wallet receives 95% of the Bankr/Doppler trading-fee allocation, with 5% assigned to Doppler. That centralized fee right is disclosed separately from token supply, liquidity custody, staking principal, and user wallets. The attribution is a launch receipt, not a claim that the project has attested the wallet's complete deployer history or every related-wallet cluster.

## Permanent Liquidity Architecture

HIVE uses Doppler multicurve liquidity on Uniswap V4. It does not issue a conventional creator-held V2 LP token; launch-liquidity permanence comes from the immutable V4 configuration described below.

The token's immutable Doppler asset configuration identifies:

| Role | Address |
| --- | --- |
| Uniswap V4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| Doppler initializer | `0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544` |
| NoOp migrator | `0x6ddfED58D238Ca3195E49d8ac3d4cEa6386E5C33` |
| Migration destination | `0xdeaDDeADDEaDdeaDdEAddEADDEAdDeadDEADDEaD` |

Doppler's [canonical NoOpMigrator source](https://github.com/whetstoneresearch/doppler/blob/568fc2fe42e6aaf5928fac5dd4365555f0dcad86/src/migrators/NoOpMigrator.sol) always reverts migration. HIVE's configuration therefore prevents the launch liquidity from being withdrawn through Doppler's migration path. This is the V4 permanent-liquidity receipt; it does not depend on a creator-held LP position.

Permanent launch liquidity does not guarantee market depth, price stability, demand, or an exit at a particular price.

## Contract Controls

The HIVE contract is [exact-match verified as Doppler DERC20 on BaseScan](https://basescan.org/address/0xa382c83e2a3b79368f372c2eb9b6925ffaf45ba3#code).

- The token owner is Doppler Airlock at `0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12`, not the founder wallet.
- The launch governance and timelock are dead addresses.
- The verified transfer path contains no project-configurable buy tax, sell tax, blacklist, or pause switch.
- The DERC20 template exposes a maximum 2% yearly inflation parameter.
- HIVE's inflation clock has never started: `currentYearStart()` and `lastMintTimestamp()` both return zero.

The inflation parameter deserves explicit disclosure. Doppler Airlock starts the mint clock only inside a successful migration. HIVE's immutable migration target is the NoOp migrator, whose migration call always reverts. Because EVM transactions are atomic, the preceding ownership and mint-clock changes roll back as well. Inflation is therefore inactive and cannot be started through HIVE's configured migration path.

## Holder Concentration Snapshot

The July 12 snapshot paginated the public [Blockscout holder API](https://base.blockscout.com/api/v2/tokens/0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3/holders), which returned 319 holder addresses.

After excluding only the named Uniswap V4 PoolManager, Doppler initializer, HIVE staking vault, Doppler Airlock, and known sink/dead addresses, the largest included address held 3.2711% and the top ten included addresses held 17.986% of supply. Smart-contract wallets remained included unless they were one of those named protocol or pooled-custody exclusions.

The exact addresses, balances, exclusions, and method are in the machine-readable manifest. This is a reproducible distribution snapshot, not proof that wallets are unrelated or that beneficial ownership is fully known.

## Live Utility And Buyback Receipts

The [HIVE staking contract](https://basescan.org/address/0x26c7121e41e779327adbd5682646dc5deb764539#code) held 2.213947706948184371 billion actively staked HIVE at the snapshot block and was not paused. Staking is non-custodial and non-yield-bearing. It supplies community status, access signals, member usage pricing on participating apps, and Honey multipliers.

The [HIVE Buyback Ledger](https://hivemindos.app/buybacks/) publishes confirmed HIVE purchases. These purchases use the separate 15% buyback allocation rather than the company treasury. HivemindOS does not destroy purchased HIVE. A buyback creates no holder return, staking payout, company ownership, price floor, or claim on revenue.

## Verification Boundary

This dossier improves transparency; it is not a smart-contract audit or financial advice. Review the verified contracts and refresh live market and holder data before relying on the snapshot.

<nav class="nextNav" aria-label="HIVE investor reading path">
  <a href="honey-hive-treasury.html">Back: Honey, HIVE, And Treasury</a>
  <a href="hive-staking-and-community-tiers.html">Next: HIVE Staking</a>
</nav>
