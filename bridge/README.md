# HIVE Bridge Page

Standalone, self-contained static page for the HIVE Base ⇄ Robinhood Chain
bridge (`index.html`, no build step). Staged and safe to host now: until the
bridge contracts are deployed it shows a "not deployed" banner and disables the
widget. It is not part of the Next.js dashboard and not in any test gate.

## Wire it up after deploy

Edit the `CONFIG` object at the top of the inline script in `index.html`:

- `adapter` — the deployed `HiveOFTAdapter` on Base
- `oft` — the deployed `HiveOFT` on Robinhood Chain
- `swapLink` — the official Uniswap link once the pool is seeded

Everything else (HIVE token, chain params, EIDs, RPCs, explorers) is already
filled with the verified constants from `contracts/script/HiveOftAddresses.sol`.

## What it does

- **Add Robinhood chain / Add HIVE token** wallet buttons, plus manual details.
- **Bridge widget**: connect wallet, quote via `quoteOFT`/`quoteSend` (so the
  displayed "you'll receive" automatically reflects dust and any bridge fee),
  approve (Base→Robinhood only), send, then poll destination balance; every
  send links to LayerZero Scan.
- **Live backing stats** read on-chain by the visitor's own browser: locked on
  Base, minted on Robinhood, `locked − fees ≥ minted` verdict, and remaining
  rate-limit capacity for the current window.
- Friendly errors for the hardened contract behaviors (`RateLimitExceeded`,
  `EnforcedPause`).

## Dependencies / hosting

Single external dependency: ethers v6 pinned from jsDelivr. Host anywhere
static (Cloudflare Pages fits the fleet's existing setup) — e.g. point
`bridge.<domain>` at this folder. The page performs only read RPC calls until
a wallet signs.
