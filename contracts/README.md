# HIVE Staking Contracts

This workspace contains the v1 non-custodial HIVE staking contract.

The contract is intentionally simple:

- users stake HIVE into `HiveStakeVault`;
- active staked balance drives HivemindOS community tiers;
- pending unstake does not count toward tier rights;
- users withdraw after the cooldown;
- admins cannot withdraw user HIVE principal;
- there are no rewards, emissions, slashing, or treasury custody mechanics.

## Local Commands

Install Foundry, then run from this folder:

```bash
forge build
forge test
```

The contract imports OpenZeppelin from the repository `node_modules` tree. Run `pnpm install` at the repository root before compiling.

## Deployment Inputs

Deploy `HiveStakeVault` with:

- `hiveToken`: the HIVE ERC-20 token address on Base;
- `initialOwner`: the admin or multisig address;
- `initialCooldown`: the launch unstake cooldown in seconds;
- `maxCooldown`: the maximum cooldown the owner may ever set. The contract hard-rejects values above 30 days.

Recommended launch values:

- `initialCooldown`: `259200` seconds, or 3 days;
- `maxCooldown`: `604800` seconds, or 7 days;
- `initialOwner`: a multisig, not an individual hot wallet.

After deployment:

1. Verify the contract source on Base.
2. Set `HIVE_STAKING_CONTRACT_ADDRESS` for server-side reads.
3. Set `NEXT_PUBLIC_HIVE_STAKING_CONTRACT_ADDRESS` only if browser UI needs direct read access.
4. Link wallet identity and Telegram permissions to the deployed contract's `stakedBalanceOf`.
