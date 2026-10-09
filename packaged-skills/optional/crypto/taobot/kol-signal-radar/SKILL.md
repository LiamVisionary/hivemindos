---
name: kol-signal-radar
description: Use when the user asks about tracking smart money or KOL wallets, interpreting whale buys, detecting coordinated shilling, or reading on-chain signals before entering a token.
version: 0.1.0
---

# KOL Signal Radar

Read key-opinion-leader and smart-money wallet activity as a signal feed — and, more importantly, learn to discard the noise that is engineered to look like signal.

## What counts as a signal

A genuine accumulation signal has three properties:

1. **Real value moved.** Native currency (ETH/SOL) or stables went in, tokens came out, through a swap — not a transfer. Transfers are gifts; swaps are buys.
2. **Single-wallet conviction.** One wallet, one direction, meaningful size relative to that wallet's history. A whale's $500 buy is noise; their $50k buy is a position.
3. **Asymmetric timing.** The buy happened before the narrative, not after the announcement. Post-announcement KOL buys are exit-liquidity formation.

## Noise patterns that mimic signal

### Coordinated dusting

Multiple KOLs receiving identical tiny amounts (e.g. exactly 1.0 token, ~$0.0006 each) from different senders. This is airdrop spray designed to land the token on KOL holder lists and radar feeds. **Identical tiny deltas across wallets = coordinated dusting, not convergence.** Weight as noise regardless of whose wallets they are.

### Multi-recipient distributions

One transaction sending the same token to 5+ wallets (observed patterns: 1M tokens to 10 wallets, 10M to 100 wallets) via an aggregator or distributor contract, with zero native value attached. The recipients did not buy — they received. Headlines that say a KOL "bought" from these are wrong. Demote to inflow noise.

Detection heuristic: 5 or more same-token transfers to distinct recipients inside a single transaction receipt = distribution, not accumulation.

### Contract self-mints and deployer airdrops

Tokens appearing in a wallet via mint (not swap) or via direct transfer from the deployer are not buys. Check the transaction type before the headline: `mint` and `transfer` are not `swap`.

### Wash clusters

Two to three wallets trading the same token back and forth at rising prices. Real signal needs unique counterparties; count distinct wallets on the other side of the flow, not transaction count.

## Reading a hit

When a radar flags KOL activity, check before acting:

- **Kind**: is it a swap (buy), a transfer (gift), or a mint (manufactured)? Only swaps are accumulation.
- **Delta**: how much value actually moved? Dust-sized deltas are spray even from famous wallets.
- **Sender**: did the tokens come from a DEX router (organic) or a distributor/airdropper contract (manufactured)?
- **Wallet history**: does this wallet usually hold, or does it dump airdrops within hours? A serial dumper receiving tokens is a sell warning, not a buy signal.
- **Cluster check**: are multiple flagged wallets all receiving from the same distributor in the same block? That is one event, not independent confirmation.

## Using signal in entries

- **Signal confirms, never initiates.** A KOL buy is a reason to run the safety vet and check the chart — not a reason to skip them.
- **Front-run the funders, not the deployers.** When tracing copycat or spam token waves, find which wallets funded the deployers. The funding wallet is the leading indicator for the next launch; the deployer wallet is the lagging one.
- **Decay is fast.** A KOL buy signal older than 24-48h in memecoin time is archaeology. Act on fresh flow or not at all.

## Pitfalls

- Never treat two KOLs holding the same token as "convergence" without checking whether both received it from the same distributor.
- Never size up on signal alone. Conviction comes from the vet plus the chart plus the signal, in that order.
- Radars optimize for recall (catch everything); your job is precision (act on almost nothing). Most hits are noise — that is the base rate, not a bug.
