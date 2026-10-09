---
name: nft-drop-playbook
description: Use when the user asks about launching an NFT collection, mint mechanics, allowlists, reveal strategies, metadata standards, royalty enforcement, or marketplace fee structures.
version: 0.1.0
---

# NFT Drop Playbook

Launch mechanics for NFT collections — the decisions that matter before mint day, in the order you should make them.

## 1. Standard and chain

- **ERC-721** for 1/1s and small collections where each token is distinct. **ERC-1155** for editions, semi-fungible drops, or gas-sensitive large mints.
- Pick the chain for your audience, not your ideology: Ethereum mainnet for high-value art collectors, L2s (Base, Arbitrum) for accessible mints, Solana for speed and low fees. Each has a different collector culture — match the drop to the room.
- **Soulbound** (non-transferable) only when the token represents identity, access, or attendance. Do not soulbind art people paid for; they will resent it.

## 2. Metadata that survives

- **Pin everything.** Metadata JSON and assets go on IPFS (pinned, not just added) or Arweave (pay-once permanent). An HTTP URL in the token URI is a rug on yourself — when your server dies, the art dies.
- **Freeze the metadata.** If the contract allows post-mint metadata changes, say so publicly. Collectors price mutable metadata at a discount; undisclosed mutability is a trust event when discovered.
- **On-chain vs off-chain**: fully on-chain art (SVG or generative code in the contract) is the gold standard for permanence and costs more gas. Off-chain with Arweave is the pragmatic default.

## 3. Supply and pricing

- **Supply follows demand, not ambition.** 10k collections need 10k buyers. An unsold mint is a public failure metric. Smaller supplies (100-1,000) with real demand outperform bloated ones every cycle.
- **Price in the collector's unit.** ETH-denominated on mainnet, SOL on Solana, stablecoin-denominated when you want price certainty. Volatile mint currencies move your effective price between announcement and mint.
- **Free mints** are a distribution strategy, not a revenue strategy. They work for building a holder base you will monetize later (access, future drops). They fail as standalone launches with no follow-through.

## 4. Allowlists

- **Allowlist = guaranteed mint window**, not a discount tier (though discounts are common). Publish the exact mechanics: how spots are earned, wallet submission deadline, mint window length.
- **Oversubscription kills.** More allowlist spots than supply = gas war among your own supporters. Cap the list at or below supply, or run phases.
- **Sybil check the list.** One person with 40 wallets is not community. Require some proof of humanity or participation history for high-demand drops.

## 5. Reveal

- **Delayed reveal** (mint a placeholder, reveal art later) builds event energy but concentrates trust risk — the team could reveal anything. Only use it with a credible team and a published reveal date.
- **Instant reveal** is the trust-maximizing default. What you mint is what you see.
- **Choose-and-reveal** (collector picks from trait pools) adds interactivity at the cost of complexity. Worth it for gaming-adjacent drops.

## 6. Royalties and fees

- **Royalties are mostly unenforceable on-chain since 2023.** Major marketplaces made them optional. Price the mint assuming zero secondary royalties, and treat any royalty revenue as a bonus.
- **Marketplace fees are the real economics now.** Standard escrow/marketplace fees run around 2.5-5% per sale. Factor this into your revenue model instead of royalties.
- If royalties matter to the project, use blocklists (e.g. operator-filter registries) on chains that support them, and be honest that they only work on compliant marketplaces.

## 7. Launch day

- **Load-test the mint.** Simulate 10x expected traffic against the mint function. A crashed mint page is the most common launch failure.
- **One contract, one mint page, one announcement thread.** Scam links multiply around launches — publish the official contract address in advance through a channel you control.
- **Post-mint, the work starts.** A drop with no roadmap communication in the first 72 hours bleeds holders. Have the first utility or community beat ready before mint, not after.

## Pitfalls

- Never launch the mint contract unaudited above trivial value. A reentrancy bug in a mint function is a career-ending event.
- Never promise utility you have not scoped. "Metaverse integration coming" with no build plan is a liability, not a roadmap.
- Wash-trading your own floor looks like volume for a day and like fraud forever. The chain remembers.
