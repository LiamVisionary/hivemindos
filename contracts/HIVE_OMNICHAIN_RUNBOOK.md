# HIVE Omnichain Bridge — Launch Runbook v3 (Base ⇄ Robinhood Chain)

Status: **TESTNET E2E PASSED; MAINNET DEPLOYED CLOSED.** Base Sepolia and
Robinhood testnet are configured through their owning rehearsal timelocks, and
the real two-way LayerZero smoke transfer delivered with exact backing
reconciliation. On 2026-07-20, the mainnet Safe, 72-hour timelocks, Base adapter,
and Robinhood OFT were deployed and independently verified. Mainnet peers and
rate limits remain zero, so no mainnet HIVE can move until the governance owner
schedules the reviewed configuration and canary operations and the delay
elapses. The hosted mainnet route remains disabled.

Philosophy (v3, after an external audit): **prove finality, bound actual value at
risk, and reuse the canonical Base HIVE market instead of funding a second
market.** Mechanism is still ClawBank's topology (one Base lockbox + Robinhood
mint/burn OFT); everything around it is hardened.

---

## 1. Verified facts (2026-07-12, all ground-truth)

| Thing | Value | How |
|---|---|---|
| Base EID / EndpointV2 | 30184 / `0x1a44…728c` | on-chain + LZ metadata |
| Robinhood EID / EndpointV2 | 30416 / `0x6F47…DD5B` | read from ClawBank's live OFT (`endpoint().eid()`) |
| DVN stack (both dirs, both chains) | required 2-of-2 LayerZero Labs + Nethermind | `getConfig` on both endpoints |
| **Robinhood block time** | **0.099s** (measured over 1,000 blocks) | so ClawBank's `confirmations:10` ≈ 1s — too weak; we use directional finality |
| HIVE token (Base) | `0xA382…45bA3`, DERC20, non-proxy, **fork-proven lossless** transfer/transferFrom | Basescan + anvil fork |
| ClawBank bridge fee | none (verified) | fee getters revert |
| ClawBank peg | backed (locked ≥ minted) | live monitor run |
| Safe contracts on Robinhood (chain 4663) | v1.4.1 factory + singletons deployed | `cast code` |

Full endpoint/DVN/lib addresses live in `script/HiveOftAddresses.sol` with
inline provenance.

## 2. What's built (all compiled + tested)

Contracts (`src/oft/`):
- `HiveBridgeControls.sol` — dual-window rate limits, 25 bps immutable fee cap
  (default 0, no per-destination overrides), pause + guardian, key-space guard.
- `HiveOFTAdapter.sol` — Base lockbox; fee surplus tracked in `bridgeFeesAccrued`,
  withdrawal can never touch principal.
- `HiveOFT.sol` — Robinhood mint/burn twin; no owner mint.

Scripts (`script/`), split so **configuration and activation are distinct events**:
- `DeployHiveGovernance.s.sol` — TimelockController (Safe proposer, guardian
  canceller, open executor, self-administered).
- `DeployHiveAdapterBase.s.sol` / `DeployHiveOftRobinhood.s.sol` — deploy owned
  by the timelock (mainnet + testnet).
- `SetDvnConfigHive.s.sol` — **directional** ULN config (send = local source
  depth, receive = remote source depth), 2-of-2 DVNs.
- `ConfigureHiveOftPeers.s.sol` / `ConfigureHiveOftOptions.s.sol` — peers +
  enforced options, safe to run while CLOSED.
- `SetHiveRateLimits.s.sol` — **the bridge-opening action** (no default limits).
- `SetHiveGuardian.s.sol` — set the pause guardian.
- `VerifyHiveOftDeployment.s.sol` — read-only gate; reverts on any drift.
- `DeployMockHive.s.sol` / `SmokeSendHive.s.sol` — testnet rehearsal + smoke test.
- `ConfigureHiveOftTestnet.s.sol` — zero-delay rehearsal batch executed through
  the actual owning timelock; structurally rejects mainnet.

Tests: `test/HiveOftBridge.t.sol` (25 unit/adversarial) + `test/HiveOftInvariant.t.sol`
(3 invariants, 64 runs × 40 depth). Coverage includes dual-window enforcement
(short binds, long binds, long caps cumulative bursts), decay + retry-after-decay,
adapter inbound drain cap, paused-credit retry, timelock governance flow, forged
`lzReceive` rejection, unwired-peer rejection, fee cap, fee dust exactness,
donations-only-add-surplus, and the backing invariant under 2,560 randomized ops.

Off-chain:
- `bridge/index.html` + `bridge/hive-route-*.mjs` — fail-closed direct bridge
  plus recovery-safe Base-routed buy/sell state machine (see §7).
- Official hosted `hive-bridge-gateway` — server-owned asset, chain, recipient,
  fee, impact, and provider policy. Testnet reports routed trading unsupported
  because Relay does not list chain 46630; direct bridging remains available.
- `scripts/hive-bridge-monitor.mjs` + `scripts/test-hive-bridge-monitor.mjs`
  (18 hermetic tests) — see §8.

## 3. Directional finality (the audit's key fix)

Confirmations are per SOURCE chain, never shared or copied:
- `BASE_SOURCE_CONFIRMATIONS = 30` (~60s at Base's ~2s blocks).
- `ROBINHOOD_SOURCE_CONFIRMATIONS = 1800` (~3min at 0.099s blocks) — a
  conservative START; the FINAL value must come from observed L1-posting cadence
  during the testnet gate. Never lowered for UX.

On each chain: the SEND library gets the local chain's depth; the RECEIVE
library gets the remote chain's depth. Send and matching receive are identical
by construction. `SetDvnConfigHive.s.sol` and `VerifyHiveOftDeployment.s.sol`
enforce this; it was applied and read back correctly on the real Base ULN libs
in the fork rehearsal (send=30, recv=1800).

## 4. Governance (Safe → Timelock → contracts)

```
temporary 1-of-1 Safe  --proposer-->  72h TimelockController  --owner+delegate-->  adapter / OFT
```
The temporary Safe owner is the single governance wallet selected for launch.
Moving to hardware-separated multi-owner governance remains a later hardening
step; it does not change either timelock or bridge address. Guardian powers and
the delayed-action list are encoded in the scripts.

- **Guardian (hot):** pause only (+ optional timelock canceller). Cannot unpause,
  configure, raise limits, reset capacity, change fees, or withdraw.
- **Timelock (delayed):** unpause, peers, delegate, libraries, DVNs/finality,
  limit increases, capacity resets, fee enable/increase, fee withdrawal, guardian
  change.
- **Immediate:** pause.

**Unpause is deliberately not timelocked (implemented).** A dedicated `unpauser`
role (set to the governing Safe) may unpause directly, bypassing the 72h delay,
while every risk-*increasing* action still rides the timelock owner. Rationale:
unpause only restores already-configured, already-rate-limited operation — it
cannot move funds, mint, or change limits/DVNs/fees — so routing it through 72h
would turn a false-alarm pause into a multi-day forced outage for no security
gain. The Safe's own multisig quorum is the control. `setUnpauser(0)` reverts to
fully-timelocked owner-only unpause if you ever want that. Set via
`SetHiveUnpauser.s.sol`; tested in `test_SafeUnpauserBypassesTimelock`.

## 5. Rate limits — bound actual value at risk

Four buckets per direction pair: outbound {hourly, daily}, inbound {hourly,
daily}. Deploy CLOSED (all 0). Derive from loss budget, NOT total supply:
- hourly ≤ 1–2% of locked principal, daily ≤ 5%, plus an absolute dollar cap if
  that's the real tolerance.
- Recalc weekly at a conservative price (no on-chain oracle in the bridge path).
- Increases ride the 72h timelock and require the §6 evidence.
- The inbound buckets are the load-bearing ones — they cap lockbox drain /
  unbacked mint even under DVN compromise. Blocked credits stay retryable.

## 6. Fees — explicit, capped, and server-owned

Direct OFT fee: **5 bps (0.05%)**, with an immutable **25 bps** contract cap and
no per-destination overrides. Routed buy/sell fee: **45 bps (0.45%)**, injected
by HivemindOS-controlled infrastructure; users cannot override its recipient,
rate, assets, or chains. Nominal platform fees for a routed trade are therefore
50 bps before provider costs, gas, and market impact. Any on-chain fee increase
rides the timelock. There is no high-volume discount at launch.

## 7. Bridge page — fail closed (`bridge/index.html`)

Verified against the live testnet deployment in a headless browser with no
console errors: reads backing across every configured RPC; on any failed or
disagreeing read it shows
**“unable to verify — do not bridge”** and disables the button (never assumes
zero/backed). Delivery status comes from the **LayerZero Scan message API**, not
a local timeout — a timeout shows “Submitted — delivery not yet verified,” never
“Delivered.” Requotes immediately before signing; exact (not unlimited)
approval; dual-window capacity shown; destination-gas warning before you strand
yourself; source/dest/LZ-Scan links; endorsement disclaimer. Routed progress is
checkpointed in a bounded non-secret URL receipt, never browser storage, so a
reload resumes polling without resubmitting a completed transaction.

## 8. Monitor — fail closed (`scripts/hive-bridge-monitor.mjs`)

Two RPC providers per chain, every read required, provider disagreement = alert,
never a silent 0. Checks backing (locked − fees ≥ Σ remote supplies), config
drift vs a committed baseline (owner/delegate/pauser/peers/libs/fee/paused/
codehash), pause state, and guardian gas. Exit 0/1/2/3 = healthy/read-failure/
breach/other-alert; optional webhook + heartbeat. Validated live against
ClawBank (fail-closed on their stock OFT, as designed) and by 18 hermetic
scenario tests (`scripts/test-hive-bridge-monitor.mjs`). Schedule on a fleet
cron; page the guardian to pause on exit 2/3.

## 9. Deploy sequence (phased; simulate-first everywhere)

- **Phase A — governance:** deploy Safe (or verify), one timelock per chain,
  proposer/canceller/executor roles, test a harmless queued action.
- **Phase B — contracts, still CLOSED:** deploy adapter + OFT owned by the
  timelocks; verify source/bytecode/non-proxy; `SetDvnConfigHive` (directional);
  `ConfigureHiveOftOptions`; `ConfigureHiveOftPeers`; `SetHiveGuardian`; run
  `VerifyHiveOftDeployment` (must pass); publish addresses.

Current mainnet deployment:
- Safe: `0xBeB2245F15ff9F596aB673C26dEc525e7aF44cfB`
- 72-hour TimelockController: `0x6C41ac629EC899dA4bfBB4C8A5022b3A165fca7e`
- Replacement Base adapter: `0x9e365A3aA8A6Dc4Be95A6900E1dB8Fadd2f221Ce`
- Replacement Robinhood OFT: `0x26c7121e41e779327Adbd5682646dC5deb764539`
- Superseded capped pair, paused on both chains:
  `0x7356B05c633Ad0EA0030075043172c493578987e`
- Abandoned closed v1 pair: `0xA131dB107711D5DC6743DFF002eACdDCA1f0946d`
- Safe owner + routed-fee recipient + pause guardian:
  `0x08D73e591c2D3f4EB7E243A2212682e376CA913e`

The replacement pair was configured atomically while both Base backing and
Robinhood supply were zero, then its owner and LayerZero delegate were handed
permanently to the existing 72-hour timelocks before the first HIVE moved. It
has 5 billion HIVE/hour and 10 billion HIVE/day limits in each direction and
passed a real round-trip canary with exact final backing. The hosted gateway
and public Pages client target the replacement, and the superseded capped pair
is paused on both chains. The replacement
deployment and canary receipt is in
`contracts/deployments/hive-bridge-mainnet-replacement-2026-07-21.json`; the
superseded capped-pair receipt remains in
`contracts/deployments/hive-bridge-mainnet-2026-07-21.json`.

Robinhood RPC gas estimation needs an explicit safety margin for ceremony
broadcasts. Use `--gas-estimate-multiplier 300` on Robinhood mainnet and
testnet, and independently verify every receipt plus the deployer's final
`DEFAULT_ADMIN_ROLE == false`. During the July 2026 rehearsal the default
estimate exhausted its entire gas limit on the final renounce; resubmitting
that exact call with an explicit 200,000 gas limit succeeded. Do not treat a
Forge broadcast summary as proof that every transaction in a multi-call
ceremony succeeded.
- **Phase C — mainnet canary:** queue tiny limits via timelock → execute →
  bridge ~1 HIVE round trip → verify backing exactly → pause/unpause drill →
  observe 48–72h, no public announcement.
- **Phase D — routed-trade canary:** use Relay to move a user's Robinhood ETH or
  USDG to Base, execute against the existing canonical Base HIVE market, then
  OFT-bridge the purchased HIVE back. Test the reverse sell path. No Robinhood
  HIVE pool or treasury liquidity is required.
- **Phase E — public launch:** only after every §10 item; publish page, official
  Base market link, security config, limits, fee policy, dashboard, and status
  channel; expand only via delayed announced actions.

Testnet rehearsal (Base Sepolia 84532 ⇄ Robinhood Testnet 46630) is MANDATORY
first and runs the same scripts; it exercises the one thing forks cannot — real
DVN message delivery — and produces the observed finality numbers for §3.
The July 2026 rehearsal is deployed and its two-way smoke transfer passed. The
Base→Robinhood leg delivered 1,000 → 999.5 HIVE. The return delivered 999.5 →
999.00025 HIVE; final net Base backing and Robinhood supply both equal 0.49975
HIVE. The deployment receipt records every source/destination transaction.

## 10. Activation/public-launch gate

- [ ] Independent smart-contract + LayerZero-config review complete.
- [ ] Expanded fuzz/invariant suite passes (have: 28 tests, 2,560-call invariant).
- [ ] Live testnet runs 7 stable days; retry-after-limit + adapter-drain proven live.
- [ ] Directional finality values documented from observed L1 posting.
- [ ] `VerifyHiveOftDeployment` passes on both chains.
- [ ] Safe + timelock ceremony done; guardian pause drill < 5 min.
- [ ] Dual-window limits derived from TVL + loss budget (not supply).
- [ ] Direct fee 5 bps verified on both chains; immutable cap 25 bps.
- [ ] Monitor fails closed with redundant RPCs (have: 18 hermetic tests).
- [ ] UI never assumes backing/fee/delivery (have: verified staged).
- [ ] Incident runbook rehearsed (§17 of the audit plan; SEV-0..3).
- [ ] Existing Base HIVE route has acceptable liquidity/impact at the canary
      size; Robinhood pool funding is intentionally not required.
- [ ] Contracts deploy closed; canary round trip; 48–72h observation; addresses
      + disclosures published.

## 11. Long-term economics (standing plan; unchanged from v2)

Principle: never rent yield with promises; own the fee-collecting infrastructure
and pay stakers from real revenue.
- **Layer 1** — tier vault v1 stays permanently non-custodial; staked principal
  never traded/lent/bridged/rehypothecated.
- **Layer 2** — Base liquidity remains canonical. Routed Robinhood trades reuse
  that market; any future protocol-owned liquidity is a separate reviewed
  treasury decision, not a requirement for the bridge.
- **Layer 3** — stakers earn a fixed PUBLISHED share of net realized revenue,
  denominated preferentially in platform utility (compute credits), buybacks
  secondary; never a promised rate; **gated on legal review** (see §10).
Rejected: rehypothecation, emission APYs, rented TVL, arb-as-headline-yield.

## 12. Scale reality

Robinhood pool seeding is not required. Security spend (audit, bounty, second
monitor) gates RAISING limits, not deploy-closed + canary. Everything
contract-level (dual windows, 25bp cap, timelock, directional finality, script
split) is cheap now and impossible later, so it all ships pre-deploy.

## Rollback

Testnet contracts are immutable deployments and cannot be deleted. Rollback is
pause + timelock peer-severance for the contracts, Worker disable/version
rollback for the hosted policy, and Pages deployment rollback/removal for the
UI. Mainnet deployments cannot be deleted. Before activation they can be
abandoned safely because peers and every rate-limit bucket are zero. After
activation, rollback is pause, delayed peer-severance, and migration.
