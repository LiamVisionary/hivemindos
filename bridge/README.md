# HIVE Base ⇄ Robinhood Bridge

Standalone static client for the governed HIVE LayerZero bridge and the
Base-routed buy/sell flow. It has no build step and does not belong to the
Next.js dashboard.

## Live deployments

- Mainnet page: `https://hivemindos-hive-bridge.pages.dev`
- Mainnet hosted policy: `https://hivemindos-hive-bridge-gateway.hivemindos.workers.dev`
- Base HIVE: `0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3`
- Mainnet Base adapter: `0x9e365A3aA8A6Dc4Be95A6900E1dB8Fadd2f221Ce`
- Mainnet Robinhood OFT: `0x26c7121e41e779327Adbd5682646dC5deb764539`

- Testnet page: `https://hivemindos-hive-bridge-testnet.pages.dev`
- Testnet hosted policy: `https://hivemindos-hive-bridge-gateway-testnet.hivemindos.workers.dev`
- Base Sepolia mock HIVE: `0x827781443C4B19c317bbA59b441EdEcCFa2cD23b`
- Base Sepolia adapter: `0xA131dB107711D5DC6743DFF002eACdDCA1f0946d`
- Robinhood testnet OFT: `0xA131dB107711D5DC6743DFF002eACdDCA1f0946d`

The same adapter/OFT address on both testnets is a normal consequence of the
dedicated deployer using the same nonce; they are different contracts on
different chain IDs. Testnet tokens have no monetary value.

Each Pages host defaults to its matching network. `?network=mainnet` and
`?network=testnet` allow an explicit profile selection.

## User flows

- **Direct bridge:** quotes the OFT contract, uses an exact Base-token
  approval, submits the LayerZero send, and treats only LayerZero's delivered
  message state as success.
- **Routed buy:** Robinhood ETH or USDG → Relay to Base → canonical Base HIVE
  market → HIVE adapter → Robinhood OFT.
- **Routed sell:** Robinhood OFT → Base adapter → canonical Base HIVE market →
  Relay settlement to Robinhood ETH or USDG.

No Robinhood HIVE pool or HivemindOS-funded liquidity is required. Relay's
mainnet service supports Base and Robinhood Chain, but its testnet service does
not currently list Robinhood testnet 46630. The hosted testnet policy therefore
reports direct bridging as available and routed trading as unsupported; quote
requests fail closed with HTTP 424.

## Safety behavior

- Backing is live-checked as `Base adapter balance − adapter fees ≥ Robinhood
  OFT total supply`; failed or disagreeing reads disable direct sends.
- Direct fee is 5 bps on-chain and cannot exceed 25 bps.
- Routed fee is 45 bps in the hosted server policy; client-supplied fees,
  recipients, tokens, and chain IDs are rejected.
- Routed state is a bounded, versioned, non-secret URL receipt. Reloading or
  sharing the URL cannot authorize a transaction and will not resubmit a
  checkpointed send.
- Relay execution is bound to the connected account, expected origin chain,
  exact transaction target/value/calldata, canonical assets, and a 10% maximum
  total-impact policy.
- No `localStorage`, `sessionStorage`, or IndexedDB is used.

## Verification

Run:

```bash
pnpm test:hive-routed-bridge
cd contracts && forge test -vv
```

The hosted gateway has its own TypeScript, domain, and static trust-boundary
tests under the private `hivemind-cloud-services/workers/hive-bridge-gateway`
checkout.

The live Base Sepolia → Robinhood testnet → Base Sepolia smoke test passed and
is recorded in `contracts/deployments/hive-bridge-testnet-2026-07-20.json`.
Both LayerZero messages report delivered and the final backing reconciliation
is exact.

The current mainnet replacement was configured while empty, permanently handed
to the existing 72-hour timelocks, passed both live deployment verifiers, and
passed a real Base → Robinhood → Base canary with exact final backing.
The hosted gateway and public page target this replacement, while the prior
canary-capped pair is paused on both chains.
The deployment and canary receipt is recorded in
`contracts/deployments/hive-bridge-mainnet-replacement-2026-07-21.json`.
