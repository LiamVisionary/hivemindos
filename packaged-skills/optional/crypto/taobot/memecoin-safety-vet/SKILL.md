---
name: memecoin-safety-vet
description: Use when the user asks whether a memecoin is safe to buy, wants a pre-buy safety checklist, asks about honeypots, rug pulls, mint authority, holder concentration, or liquidity locks.
version: 0.1.0
---

# Memecoin Safety Vet

A pre-buy checklist for memecoins on EVM and Solana. Run it before any position, especially sub-$50 pilots where one rug wipes the sizing edge. Hard fails are non-negotiable.

## Hard fails (any one = no buy)

- **Mint authority not renounced.** If the deployer can still mint, supply is not fixed. Check on Solscan (Solana) or the token contract's `mintAuthority` (EVM). This is the single highest-signal check.
- **Freeze authority still held** (Solana). A freeze authority lets the holder freeze your wallet's tokens. Renounced or never set only.
- **No locked or burned liquidity.** If the deployer can pull LP, the floor is fictional. Verify the LP lock on a locker (Unicrypt, Team Finance) or a burn address.
- **Honeypot on the sell path.** Simulate or check: can a normal wallet sell? High sell tax (>10%), sell-cooldown traps, and max-tx limits that only apply to sellers are all honeypot shapes.

## Concentration checks

- **Top-10 holders over 40% of supply = fail.** One coordinated dump ends the chart. Read the holder table, excluding known burn addresses and the LP pair itself.
- **Deployer still holding a large bag.** A deployer holding 5%+ with no vesting is a timed sell, not alignment.
- **Fresh wallets in the top holders.** A cluster of wallets funded in the last 24h, all buying the same token, is usually one entity (or a coordinated group), not organic demand.

## Distribution vs demand

Learn to tell real buying from manufactured activity:

- **Airdrop dusting**: many tiny identical transfers (e.g. 1.0 token, ~$0.0006 each) from different senders to many wallets. This is spray to land on holder lists and KOL radars, not accumulation. Identical tiny deltas = coordinated dusting, not convergence.
- **Multi-recipient distributions**: one transaction sending the same token to 5+ wallets (10, 100 — the pattern scales) with zero native value attached. The recipients "bought" nothing; they received. Demote these to noise.
- **Wash volume**: repeated back-and-forth between two wallets at escalating prices. Check the actual unique buyer count, not the volume number.

## Entry discipline

- **Size pilots small.** $5-10 pilots let you take many shots; size up only on very high conviction after the vet passes clean.
- **Never chase a vertical green candle.** A +400% run with no pullback is someone else's exit liquidity forming. Wait for a real pullback (20%+ off the local top) or walk away.
- **Exits ride trailing stops, not hope.** Common structure: hard stop at -25% from entry for memecoins, trailing stop that activates at +80% peak and sells all on a 25% pullback from peak, time exit at 48h without +50%. Adjust the numbers to your book, but never hold a memecoin on narrative alone past the time exit.

## Pitfalls

- A "renounced" contract with an upgradeable proxy is not renounced. Read the proxy admin.
- Social proof is not a vet. Follower counts and KOL mentions are bought; the chain is not.
- "Doxxed dev" means nothing without locked liquidity. Identity does not prevent a sell.
- Your first green candle is the most dangerous one. It teaches you the vet is optional. It is not.
