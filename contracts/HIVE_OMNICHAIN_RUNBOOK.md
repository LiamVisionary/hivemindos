# HIVE Omnichain Bridge — Launch Runbook v3 (Base ⇄ Robinhood Chain)

Status: **READY TO REVIEW — NOT DEPLOYED, and blocked on the go/no-go gates in
§10.** No mainnet contract deployed, no real key used, no mainnet transaction
broadcast. Compile-clean, 27 unit+invariant tests green, and the full v3 deploy
pipeline dress-rehearsed on local forks of both real chains.

Philosophy (v3, after an external audit): not "copy a working bridge and add
controls" but **prove finality, bound actual value at risk, earn through useful
liquidity, and distribute only genuine surplus.** Mechanism is still ClawBank's
topology (one Base lockbox + Robinhood mint/burn OFT); everything around it is
hardened.

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

Tests: `test/HiveOftBridge.t.sol` (25 unit/adversarial) + `test/HiveOftInvariant.t.sol`
(3 invariants, 64 runs × 40 depth). Coverage includes dual-window enforcement
(short binds, long binds, long caps cumulative bursts), decay + retry-after-decay,
adapter inbound drain cap, paused-credit retry, timelock governance flow, forged
`lzReceive` rejection, unwired-peer rejection, fee cap, fee dust exactness,
donations-only-add-surplus, and the backing invariant under 2,560 randomized ops.

Off-chain:
- `bridge/index.html` — fail-closed page (see §7).
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
3-of-5 Safe  --proposer-->  72h TimelockController  --owner+delegate-->  adapter / OFT
```
Fallback: 2-of-3 Safe, hardware-separated signers. Safe requirements, guardian
powers, and delayed-action list are in the audit plan and encoded in the scripts.

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

## 6. Bridge fee — earn only when net-positive

Immutable cap **25 bps**; launch **0**; per-destination overrides removed. First
review after ≥30 days; ≤5 bps per increase; ≥14 days between; ≥7 days public
notice; every increase behind the timelock. Enable only when
`extra bridge revenue − lost LP revenue − user spread cost − reputational cost`
is positive. A bridge fee stacked on a 1% swap fee would add arbitrage friction —
default is to leave it at 0 and earn via POL/LP instead.

## 7. Bridge page — fail closed (`bridge/index.html`)

Verified in-browser (no console errors, staged state correct): reads backing
across two RPC providers per chain; on any failed/ disagreeing read it shows
**“unable to verify — do not bridge”** and disables the button (never assumes
zero/backed). Delivery status comes from the **LayerZero Scan message API**, not
a local timeout — a timeout shows “Submitted — delivery not yet verified,” never
“Delivered.” Requotes immediately before signing; exact (not unlimited)
approval; dual-window capacity shown; destination-gas warning before you strand
yourself; source/dest/LZ-Scan links; endorsement disclaimer. Fill
`CONFIG.adapter`/`CONFIG.oft`/`swapLink` after deploy (see `bridge/README.md`).

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
- **Phase C — mainnet canary:** queue tiny limits via timelock → execute →
  bridge ~1 HIVE round trip → verify backing exactly → pause/unpause drill →
  observe 48–72h, no public announcement.
- **Phase D — liquidity canary:** fund treasury quote asset, bridge a small HIVE
  allocation, initialize the canonical pool at a TWAP-verified price, add the
  defensive POL position, test swaps, observe 48–72h.
- **Phase E — public launch:** only after every §10 item; publish page, official
  pool link, security config, limits, fee policy, dashboard, status channel;
  fee stays 0; expand only via delayed announced actions.

Testnet rehearsal (Base Sepolia 84532 ⇄ Robinhood Testnet 46630) is MANDATORY
first and runs the same scripts; it exercises the one thing forks cannot — real
DVN message delivery — and produces the observed finality numbers for §3.
Blocked only on ~0.1 Sepolia ETH to the throwaway deployer.

## 10. Go/no-go (mainnet blocked until all checked)

- [ ] Independent smart-contract + LayerZero-config review complete.
- [ ] Expanded fuzz/invariant suite passes (have: 28 tests, 2,560-call invariant).
- [ ] Live testnet runs 7 stable days; retry-after-limit + adapter-drain proven live.
- [ ] Directional finality values documented from observed L1 posting.
- [ ] `VerifyHiveOftDeployment` passes on both chains.
- [ ] Safe + timelock ceremony done; guardian pause drill < 5 min.
- [ ] Dual-window limits derived from TVL + loss budget (not supply).
- [ ] Fee 0, capped 25 bps.
- [ ] Monitor fails closed with redundant RPCs (have: 18 hermetic tests).
- [ ] UI never assumes backing/fee/delivery (have: verified staged).
- [ ] Incident runbook rehearsed (§17 of the audit plan; SEV-0..3).
- [ ] Canonical pool analysis; treasury + quote-asset funding approved.
- [ ] **Legal review** covers LP activity, buybacks, and any staker benefit
      (SEC 33-11412 covers protocol staking, NOT revenue-share-for-locking — the
      seasonal tier-bucket reward design is SUSPENDED pending counsel).
- [ ] Contracts deploy closed; canary round trip; 48–72h observation; addresses
      + disclosures published.

## 11. Long-term economics (standing plan; unchanged from v2)

Principle: never rent yield with promises; own the fee-collecting infrastructure
and pay stakers from real revenue.
- **Layer 1** — tier vault v1 stays permanently non-custodial; staked principal
  never traded/lent/bridged/rehypothecated.
- **Layer 2** — Protocol-Owned Liquidity: treasury owns Base + Robinhood LP
  positions (funded by Bankr creator fees, the ≤0.25% bridge fee once justified,
  platform revenue, minor treasury-capital arb desk); LP fees compound into POL.
- **Layer 3** — stakers earn a fixed PUBLISHED share of net realized revenue,
  denominated preferentially in platform utility (compute credits), buybacks
  secondary; never a promised rate; **gated on legal review** (see §10).
Rejected: rehypothecation, emission APYs, rented TVL, arb-as-headline-yield.

## 12. Scale reality

Liam holds ~2% of HIVE (~$3.5K liquid, post Bankr-fee claim). Bridge deploy is
~$5–10 gas; pool seeding is optional/deferred and can come from anyone. Security
spend (audit, bounty, second monitor) gates RAISING limits, not deploy-closed +
canary — value-at-risk at canary limits is a few hundred dollars. Everything
contract-level (dual windows, 25bp cap, timelock, directional finality, script
split) is cheap now and impossible later, so it all ships pre-deploy.

## Rollback

Nothing is live. To discard: delete `contracts/src/oft/`, `contracts/test/HiveOft*.t.sol`,
`contracts/script/*.s.sol` + `HiveOftAddresses.sol`, this runbook, `bridge/`,
`scripts/hive-bridge-monitor.mjs` + its test; revert `contracts/foundry.toml`;
remove the added devDependencies. Post-deploy there is no undo of on-chain
contracts — only pause + timelock peer-severance + migration; hence the
multisig, closed-by-default valve, canary, and legal gates above.
