# HIVE Base-Routed Robinhood Bridge — Testnet Decision Record

Date: 2026-07-20

Status: Frozen for testnet implementation. Mainnet broadcast remains prohibited
until a separate explicit approval and a fresh preflight.

## Outcome

HivemindOS will use one canonical HIVE market on Base and one 1:1 LayerZero OFT
bridge to Robinhood Chain. It will not create or fund a second HIVE market on
Robinhood Chain.

The user experience has two distinct products:

1. Direct bridge: move HIVE between Base and Robinhood Chain.
2. Base-routed trade: move the user's payment asset from Robinhood Chain to
   Base through an external solver, buy from the existing Base HIVE market,
   then bridge the purchased HIVE back to Robinhood Chain. Selling performs
   those operations in reverse.

No step uses HivemindOS treasury inventory as trade liquidity. The external
solver fronts cross-chain settlement, the Base market supplies the HIVE side,
and the user supplies the input asset and gas.

## Evidence audit

### Confirmed on 2026-07-20

- The existing OFT implementation passed 28/28 Foundry unit, adversarial, and
  invariant tests before this work. The bridge monitor suite passed 18/18.
- Base Sepolia RPC reported chain ID 84532. Its LayerZero EndpointV2 at
  `0x6EDCE65403992e310A62460808c4b910D972f10f` has deployed code and reports
  endpoint ID 40245.
- Robinhood testnet RPC reported chain ID 46630. Its LayerZero EndpointV2 at
  `0x3aCAAf60502791D199a5a5F0B173D78229eBFe32` has deployed code and reports
  endpoint ID 40451.
- Relay's live mainnet chain API lists Base (8453) and Robinhood Chain (4663)
  with deposits enabled.
- A read-only Relay mainnet price request for Robinhood native ETH to canonical
  Base HIVE (`0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3`)
  returned a valid cross-chain swap route. The same request with a 45 bps app
  fee returned that app fee explicitly in the quote.
- Relay's testnet chain API lists Base Sepolia but does not list Robinhood
  testnet. Therefore the external-solver payment hop cannot be truthfully
  broadcast end to end on the selected testnet pair today.
- Robinhood's official contracts page identifies mainnet USDG as
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` and WETH as
  `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`.
- Relay documents app fees as quote-time basis points paid to an EVM claim
  address, accrued in offchain Base USDC, and independently observable through
  its request and app-fee balance APIs.

Primary sources:

- Robinhood network and bridge documentation:
  <https://docs.robinhood.com/chain/connecting/>,
  <https://docs.robinhood.com/chain/bridging/>
- Robinhood canonical contracts:
  <https://docs.robinhood.com/chain/contracts/>
- Base network information:
  <https://docs.base.org/base-chain/quickstart/connecting-to-base>
- Relay testnet support and live chain API:
  <https://docs.relay.link/references/api/api_guides/testnet>,
  <https://api.testnets.relay.link/chains>
- Relay app fees and quote API:
  <https://docs.relay.link/features/app-fees>,
  <https://docs.relay.link/references/api/get-quote-v2>
- Bankr supported chains:
  <https://docs.bankr.bot/getting-started/supported-chains/>

### Inferred, with required confirmation

- Relay should continue to route canonical Base HIVE at mainnet launch. This
  must be reconfirmed with fresh buy and sell executable quotes immediately
  before mainnet deployment because liquidity, indexing, and solver support
  can change.
- USDG should be usable as a Robinhood-side routed input/output where Relay has
  sufficient inventory. This requires a fresh executable quote for the exact
  production amount and recipient; canonical-token identity alone does not
  prove route liquidity.
- A 45 bps routed fee plus a 5 bps OFT fee is commercially sustainable at
  moderate volume. Realized Relay fee collection and hosted cost telemetry are
  required before claiming a complete margin.

## Frozen testnet parameters

| Parameter | Testnet value |
| --- | --- |
| Home chain | Base Sepolia, chain ID 84532, LayerZero EID 40245 |
| Remote chain | Robinhood testnet, chain ID 46630, LayerZero EID 40451 |
| Home token | Dedicated 18-decimal mock HIVE, 1 billion minted to the test deployer |
| Remote token | HIVE OFT with no owner-callable mint |
| Direct bridge fee | 5 bps per outbound transfer |
| OFT immutable fee ceiling | 25 bps |
| Routed app fee | 45 bps of routed input, injected only by hosted authority |
| Nominal HivemindOS routed take | 50 bps: 45 bps route + one 5 bps OFT send |
| Trade type | Exact input only |
| Price-impact warning | 3% |
| Price-impact hard stop | 10% |
| Quote freshness | 60 seconds locally, plus provider expiry |
| Hourly bridge capacity | 10 million HIVE in each direction |
| Daily bridge capacity | 100 million HIVE in each direction |
| Testnet timelock delay | 0 seconds for same-session rehearsal |
| Mainnet timelock floor | 72 hours, enforced by deployment policy |
| Pause guardian/unpauser | Dedicated testnet signer for rehearsal only |

The mainnet rate limits, governance addresses, fee recipient, and minimum trade
size are deliberately not frozen here.

## Architecture

### Direct bridge

```text
Base HIVE holder
  -> approve exact HIVE amount
  -> Base HiveOFTAdapter locks full amount and retains the 5 bps fee surplus
  -> LayerZero verifies/delivers the message
  -> Robinhood HiveOFT mints only the amount received

Robinhood HIVE holder
  -> Robinhood HiveOFT retains the 5 bps fee and burns the amount received
  -> LayerZero verifies/delivers the message
  -> Base HiveOFTAdapter releases the same received amount
```

At all times, Base locked principal excluding accrued adapter fees must be at
least the total Robinhood OFT supply.

### Routed buy

```text
User's RH ETH or USDG
  -> hosted gateway requests a Relay quote with server-owned 45 bps app fee
  -> user signs the exact Relay transaction on Robinhood Chain
  -> Relay solver settles into canonical HIVE from the existing Base market
  -> user bridges that Base HIVE through the OFT adapter
  -> user receives canonical 1:1-backed HIVE on Robinhood Chain
```

### Routed sell

```text
User's Robinhood HIVE
  -> user bridges HIVE through the OFT to Base
  -> hosted gateway requests a Relay quote from canonical Base HIVE
  -> user signs the exact Relay transaction on Base
  -> Relay settles RH ETH or canonical USDG to the user
```

The workflow is resumable, not falsely atomic. Each confirmed transaction is a
checkpoint. A slow bridge is polled and never blindly resubmitted. A failed
provider fill follows Relay's request/refund status rather than starting a
second order.

## Commercial and sustainability model

- Direct bridge revenue is 5 bps in HIVE. Users separately pay LayerZero and
  source-chain gas, so HivemindOS does not subsidize transport.
- Routed trade revenue is 45 bps collected by Relay in Base USDC plus 5 bps in
  HIVE on the OFT step. This keeps the nominal HivemindOS take at 50 bps while
  leaving the raw bridge cheap enough for arbitrage and direct transfers.
- Relay solver, gas, and price-impact costs are additive and must be displayed
  from the live quote; they are not HivemindOS revenue.
- At $100,000 monthly routed volume, 45 bps produces $450 of routed revenue.
  At $1,000,000 it produces $4,500. Direct bridge revenue depends on HIVE price
  and direction-specific bridge volume.
- Accounting coverage is incomplete until live Relay `paidAppFees`, hosted
  Worker cost, and OFT fee-withdrawal receipts are reconciled. Until then the
  system may report gross fee policy but not complete realized margin.
- No high-volume discount is included in the testnet policy. Adding one is a
  separate server-side commercial decision and must not be client-selectable.

## Threat model and controls

| Threat | Control |
| --- | --- |
| Unbacked remote mint or lockbox drain | No owner mint; LayerZero peer binding; inbound and outbound hourly/daily limits; 1:1 backing monitor |
| Owner raises bridge fee | Compile-time 25 bps ceiling; fee changes through governance |
| Owner withdraws backing principal | Adapter withdrawal is capped to separately accrued fee accounting |
| Client redirects revenue or lowers fee | Hosted gateway owns recipient, fee, networks, and canonical token addresses; client fields are ignored/rejected |
| Fake HIVE or USDG address | Exact server-owned address allowlist per network profile |
| Stale or manipulated quote | Exact-input plans, bounded age, provider expiry, recipient/refund binding, re-quote before signing |
| Excessive price impact | Warn at 3%; refuse at 10%; never enable provider override-price-impact |
| Duplicate transaction after timeout | Persist source hash/request ID; poll authoritative status; never auto-resubmit ambiguous transfers |
| Provider outage or unsupported testnet | Capability endpoint fails closed; direct OFT bridge remains independent |
| Compromised pause guardian | Guardian can pause but cannot unpause, configure, mint, or withdraw |
| Compromised proposer | Timelock delay and canceller on mainnet; testnet zero-delay authority is explicitly non-production |
| Mainnet accident during rehearsal | Scripts and hosted policy reject production chain IDs in testnet mode; mainnet needs separate deployment command and approval |

## Testnet acceptance gates

1. All pre-existing bridge tests remain green.
2. New policy and governance tests first fail, then pass for fee injection,
   canonical routes, mainnet rejection, quote expiry, recipient binding,
   duplicate/recovery states, rate limits, pause, and backing invariants.
3. Contracts deploy closed on both testnets under testnet timelocks.
4. Peers, enforced options, fees, guardian, unpauser, and limits are applied
   through the actual timelock call path.
5. A real Base Sepolia -> Robinhood testnet send delivers and is independently
   read from both chains.
6. A real Robinhood testnet -> Base Sepolia return delivers, and locked
   principal excluding fees still covers remote supply.
7. The routed worker is deployed in testnet mode and truthfully reports
   Robinhood testnet as unsupported by Relay rather than returning fake
   calldata.
8. A hermetic Relay E2E proves the complete buy/sell workflow, fee injection,
   execution checkpoints, refunds, and replay handling. A live read-only
   mainnet quote proves current route discovery but does not authorize or
   broadcast a mainnet transaction.
9. The deployment receipt records chain IDs, addresses, transaction hashes,
   balances, fee values, capacities, test outputs, and every unverified item.

Mainnet readiness cannot be labeled complete while gate 7 reflects the upstream
testnet coverage gap. That gap may be accepted only through an explicit
mainnet canary decision after fresh review; it must not be relabeled as a passed
testnet E2E.
