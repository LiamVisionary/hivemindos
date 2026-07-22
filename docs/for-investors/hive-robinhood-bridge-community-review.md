---
title: HIVE × Robinhood Chain Bridge — Community Review Draft
description: A plain-English explanation of the proposed HIVE bridge between Base and Robinhood Chain, including liquidity, fees, safeguards, testnet evidence, and open questions.
---

# HIVE × Robinhood Chain Bridge

**Community review draft — July 20, 2026**

We are considering bringing HIVE from Base to Robinhood Chain without launching a second supply or asking the community to fund another liquidity pool.

The short version:

- Base remains HIVE's home market.
- HIVE on Robinhood Chain would be backed 1:1 by HIVE locked on Base.
- We would not mint a separate unbacked supply.
- We would not need to provide a HIVE/ETH liquidity pool on Robinhood Chain at launch.
- Robinhood users could still buy or sell HIVE through the existing Base market.

This document explains the proposed system in simple terms so the Base and HIVE communities can challenge it before any mainnet launch.

## HIVE stays one 1:1-backed token

The canonical HIVE contract remains on Base:

```text
Network: Base
Contract: 0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3
Initial supply: 100,000,000,000 HIVE
```

When someone bridges HIVE from Base to Robinhood Chain:

1. Their HIVE is locked in a bridge contract on Base.
2. The matching amount is created for them on Robinhood Chain.
3. Those Robinhood HIVE tokens cannot exist without matching Base HIVE locked behind them.

When HIVE comes back:

1. The Robinhood HIVE is destroyed.
2. The matching Base HIVE is unlocked for the user.

This is a lock-and-mint bridge. It does not duplicate the economically usable supply: every spendable HIVE on Robinhood Chain should have one HIVE locked and unavailable on Base.

## Where does the liquidity come from?

The bridge itself does not need a trading pool. It only moves HIVE that somebody already owns.

For buying and selling, the proposal is to keep using HIVE's existing Base market instead of creating a thin second market on Robinhood Chain.

### Buying HIVE from Robinhood Chain

```text
User pays ETH or USDG on Robinhood Chain
              ↓
Relay routes the payment to Base
              ↓
The existing Base market sells HIVE
              ↓
The purchased HIVE is bridged back to the user on Robinhood Chain
```

The HIVE comes from sellers and liquidity already available in the Base market. It does not come from a HivemindOS treasury wallet, and HivemindOS does not need to front the purchase.

### Selling HIVE from Robinhood Chain

Selling runs the same path in reverse:

```text
User bridges HIVE back to Base
              ↓
The Base market buys the HIVE
              ↓
Relay returns ETH or USDG to the user on Robinhood Chain
```

There would be no local Robinhood HIVE market initially. Robinhood wallets could hold and transfer HIVE there, while buying and selling would use Base liquidity behind a guided cross-chain flow.

## Proposed fees

The current testnet design uses:

- **0.05% direct bridge fee** when HIVE crosses chains.
- **0.45% routed-trade app fee** when the app coordinates a buy or sell through Relay.
- **0.50% nominal HivemindOS fee** for a routed trade that includes one bridge step.

Relay costs, network gas, market price impact, and any live provider fees are separate. The user should see the complete quote before signing anything.

The bridge contract permanently caps its own fee at 0.25%. Governance could lower the bridge fee, but could never raise it above that cap without replacing the contracts and going through a new public review.

These are proposed launch economics, not a promise that every trade will cost exactly 0.50% all-in.

## What has actually been tested?

The direct bridge is deployed on Base Sepolia and Robinhood testnet.

We completed a real round trip:

- 1,000 test HIVE moved from Base Sepolia to Robinhood testnet.
- 999.5 HIVE arrived after the 0.05% bridge fee.
- The HIVE was then bridged back to Base Sepolia.
- After both directions, the remaining Robinhood supply exactly matched the net HIVE locked on Base.
- Contract, invariant, recovery, hosted-gateway, and browser tests passed.

Relay supports both Base and Robinhood Chain on mainnet, and a read-only quote found a route from Robinhood ETH into the existing Base HIVE market.

Relay does **not** currently support Robinhood testnet. That means the direct HIVE bridge has been proven with real testnet transactions, but the complete routed buy/sell flow cannot be economically settled through Relay on testnet. It has been tested with controlled provider simulations and must still pass a small, capped mainnet canary before wider activation.

No HIVE mainnet bridge contract has been deployed and no real mainnet funds have been moved.

## Main safeguards

- No owner-controlled mint function for Robinhood HIVE.
- Every Robinhood HIVE must remain backed by locked Base HIVE.
- Hourly and daily limits cap how much can move in either direction.
- A guardian can pause the bridge but cannot mint, withdraw backing, or change configuration.
- Mainnet governance changes must wait at least 72 hours.
- Bridge fees are accounted for separately from backing, so governance cannot withdraw user principal as “fees.”
- The app accepts only the official HIVE and payment-token addresses.
- Expired quotes, wrong wallets, wrong networks, duplicate submissions, and excessive price impact fail closed.
- The direct bridge remains separate from Relay, so a Relay outage does not make already-bridged HIVE unbacked.

## Risks and trade-offs

This design avoids asking the community to fund a second pool, but it is not risk-free.

- **Bridge risk:** The system depends on LayerZero messaging, the configured verification network, and our bridge contracts.
- **Routing risk:** One-click buying and selling depends on Relay continuing to support Robinhood Chain and Base.
- **Market risk:** Large trades can still move the HIVE price on Base. A bridge does not create liquidity or guarantee an exit price.
- **Multi-step risk:** A routed trade crosses multiple transactions. The app can save and resume each checkpoint, but it cannot make separate blockchains truly atomic.
- **Governance risk:** Pausing, limits, fee withdrawals, and configuration need transparent multisig and timelock operations.
- **New-chain risk:** Robinhood Chain is newer than Base and has less production history.

The bridge should launch with conservative limits, public monitoring, and a small real-money canary—not with unlimited capacity on day one.

## Questions for the community

We would especially value feedback on these points:

1. Does keeping all price discovery and liquidity on Base make sense for the first launch?
2. Is 0.05% for direct bridging and 0.50% nominally for routed trades reasonable?
3. Should ETH and USDG both be supported for Robinhood-side buying and selling?
4. What trade-size and price-impact limits would you want at launch?
5. What additional audits, monitors, multisig participants, or emergency controls would earn your trust?
6. Would you prefer direct bridging to launch first, with routed trading enabled only after a separate canary?

## Review links

- [HIVE token receipts and Base contract evidence](hive-token-receipts.html)
- [Live testnet bridge](https://hivemindos-hive-bridge-testnet.pages.dev)
- [Relay mainnet supported-chain registry](https://api.relay.link/chains)
- [Relay testnet support documentation](https://docs.relay.link/references/api/api_guides/testnet)
- [LayerZero OFT documentation](https://docs.layerzero.network/v2/concepts/value-transfer-implementations)
- [Robinhood Chain documentation](https://docs.robinhood.com/chain/)

This is an infrastructure review draft, not a mainnet launch announcement, a guarantee of liquidity, or financial advice.
