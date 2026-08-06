---
title: "Concentrated Liquidity"
---

# Concentrated Liquidity

HivemindOS can watch a real Uniswap v3 position on Base and model when moving its
price range may be worthwhile. The manager is deliberately **shadow-only**: it reads
public chain state and updates a virtual range, but it has no signer and cannot
approve tokens, remove liquidity, mint a position, or submit a transaction.

This makes it useful for testing the idea behind an automated market-making agent
before giving any separate system authority over funds.

## What the manager checks

Each evaluation reads the position NFT from Uniswap's official Base position-manager
contract, resolves its pool, and records the current tick, configured range, fee tier,
owner, token amounts, and observed Base block. For stablecoin-quoted pools it also
estimates the position's USD value.

The policy then classifies the position as:

- **Hold** — the price remains comfortably inside the range.
- **Watch** — the price is near or outside an edge, but a safety or economics gate
  has not cleared.
- **Propose rebalance** — a new virtual range is centered on the current tick because
  every configured gate cleared.

The explanation shown beside each decision includes the nearest-edge distance,
estimated fees recovered during the evaluation window, gas and inventory-cost
assumptions, expected net benefit, and any remaining cooldown.

## Read the paper ledger

Each saved monitor also keeps a local paper portfolio. It marks the virtual LP range
against the observed pool price, accrues fees from the configured fee-APR assumption
only while that range is active, and deducts the configured gas plus inventory cost
whenever the policy proposes a virtual rebalance. The ledger reports virtual
principal, modeled fees, total value, normalized return, a same-start HODL baseline,
excess return, cumulative costs, and the number of paper rebalances.

Paper returns are deliberately separate from the real NFT snapshot. Real principal
and uncollected fees remain on-chain evidence; paper fees are scenario output. The
ledger starts when the upgraded observer first evaluates a USD-priced position, so
do not compare it with a control measured over a different starting window.

## Set up a shadow monitor

1. Open **Trade**, then choose **Liquidity**.
2. Copy the numeric NFT ID for a Base Uniswap v3 position into **Position NFT ID**.
3. Choose a target range, edge trigger, cooldown, evaluation window, fee APR
   assumption, gas estimate, inventory/impermanent-loss cost, and minimum net benefit.
4. Select **Inspect position**. Check the owner warning, live range, block evidence,
   and decision explanation.
5. Select **Save shadow monitor**, then start it or run one evaluation immediately.

Importing an NFT ID grants no permissions. You can inspect an NFT owned by another
address, but HivemindOS labels the mismatch and makes no ownership claim.

## Understand the assumptions

The range manager does not predict fees or impermanent loss. Its fee APR, gas, and
inventory-cost inputs are your explicit scenario assumptions. A proposed rebalance
means the scenario cleared the configured threshold; it does not mean a real trade
would be profitable.

If a USD position value cannot be estimated, the economics gate fails closed. The
manager also enforces its cooldown and minimum-net-benefit threshold before changing
the virtual range. An out-of-range Uniswap v3 position does not earn fees until price
returns to its range, which is why range distance is shown prominently.

## Run it in the background

The Trade desk can run one evaluation while it is open. For an always-on observer,
install the optional user service from the repository:

```bash
./scripts/install-liquidity-range-manager.sh
```

The service heartbeat explicitly reports that it has no signing authority. To stop
and remove only this managed service and its installed daemon bundle:

```bash
./scripts/install-liquidity-range-manager.sh uninstall
```

Saved policies and shadow history stay local after uninstall, so they can be reviewed
or removed separately.

## Safety boundary

- Base and Uniswap v3 only.
- Public, read-only contract calls only.
- No private-key lookup, wallet approval, transaction construction, signature, or
  submission path.
- A “rebalance” event changes only the locally stored virtual range.
- Paper fee accrual uses the configured APR assumption; it is not a claim about fees
  earned by the real NFT.
- Estimates are scenario outputs, not financial, accounting, legal, or tax advice.

For protocol details, see Uniswap's documentation on
[concentrated liquidity](https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity)
and its current [Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments).
