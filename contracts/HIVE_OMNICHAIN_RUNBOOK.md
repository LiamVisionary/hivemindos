# HIVE Omnichain Bridge — Readiness Runbook v2 (Base ⇄ Robinhood Chain)

Status: **READY TO REVIEW — NOT DEPLOYED.** No mainnet contract deployed, no
real key used, no mainnet transaction broadcast. Everything below has been
compile-verified, unit-tested (12/12), and dress-rehearsed end-to-end on local
forks of BOTH real chains (throwaway keys, local anvil only).

Mechanism: ClawBank's exact pattern — a LayerZero v2 OFT with a lock-and-mint
adapter on Base and a mint/burn twin on Robinhood Chain — **hardened** with
three additions ClawBank does not have: bidirectional rate limits, a
hard-capped (≤1%) bridge fee defaulting to 0, and pause with a guardian role.

---

## 1. Verified facts (2026-07-12, all ground-truth, none from marketing)

ClawBank's live deployment, read on-chain:

| Thing | Value | How confirmed |
|---|---|---|
| ClawBank Robinhood OFT / Base adapter | `0x65b4…EC08` (same addr both chains) | `token()`, `approvalRequired()`, `peers()` reads |
| Backing (peg) | locked on Base ≥ minted on Robinhood | `balanceOf(adapter)` vs `totalSupply()` |
| DVN security | required 2-of-2 [LayerZero Labs, Nethermind], 10 confirmations, both directions, both chains, NOT defaults | `getConfig` on both endpoints + metadata identity match |
| Bridge fee | **none** — ClawBank earns nothing per bridge | fee getters revert on both chains |
| Owner | single EOA `0x1A92…Cf78A` | `owner()` reads — we do better (multisig) |

LayerZero constants (baked into `script/HiveOftAddresses.sol`; an earlier draft
had WRONG DVN/lib values from a misread API summary — all corrected from live
chain reads + metadata identity match):

| Chain | Chain ID | EID | EndpointV2 |
|---|---|---|---|
| Base | 8453 | 30184 | `0x1a44…728c` |
| Robinhood | 4663 | 30416 | `0x6F47…DD5B` |
| Base Sepolia (rehearsal) | 84532 | 40245 | `0x6EDC…f10f` |
| Robinhood Testnet (rehearsal) | 46630 | 40451 | `0x3aCA…Fe32` |

HIVE token audit (**complete — this gate is cleared**):
- `0xA382…45bA3`, verified Doppler `DERC20`, NOT a proxy (EIP-1967 slots zero).
- No fee-on-transfer / rebasing / pause / blacklist. **Fork-proven lossless** on
  `transfer` AND `approve`+`transferFrom` (exact amount conservation on a Base
  mainnet fork) — the property the lockbox requires.
- Owner powers on HIVE itself: `mintInflation()` capped at 2%/yr exists but is
  **un-armed** (`currentYearStart == 0`); `burn`/`lockPool` owner-gated. None of
  this affects bridge correctness (home-chain supply changes don't touch the peg).
- Supply-cap check: OFT encodes amounts as uint64 in 6 shared decimals → max
  ~18.4T tokens; HIVE's 100B fits with ~180× headroom (verified in OFTCore).

## 2. What's built (all compiled + tested)

```
src/oft/HiveBridgeControls.sol   shared rails: rate limits, capped fee, pause
src/oft/HiveOFTAdapter.sol       Base lockbox (wraps real HIVE)
src/oft/HiveOFT.sol              Robinhood mint/burn twin (no owner mint)
script/HiveOftAddresses.sol      verified constants (mainnet + testnet)
script/DeployHiveAdapterBase.s.sol    step 1 (Base or Base Sepolia)
script/DeployHiveOftRobinhood.s.sol   step 2 (Robinhood mainnet or testnet)
script/SetDvnConfigHive.s.sol         step 3 — pin DVNs (mainnet, both sides)
script/WireHiveOft.s.sol              step 4 — peer + options + OPEN THE VALVE
test/HiveOftBridge.t.sol         12 tests, all passing
```

Beyond `contracts/`:

```
bridge/index.html                staged public bridge page (add-chain/add-token,
                                 widget with quoteOFT/quoteSend + LayerZero Scan
                                 links, live locked-vs-minted stats read by the
                                 visitor's browser; disabled until CONFIG gets
                                 the deployed addresses — see bridge/README.md)
scripts/hive-bridge-monitor.mjs  backing-invariant monitor (dependency-free;
                                 exit 2 + optional webhook on breach; validated
                                 live against ClawBank's real bridge)
```

The controls, and why:
- **Rate limits (both directions, LayerZero's audited RateLimiter).** Outbound
  keyed by dstEid; inbound keyed by `srcEid | 0x80000000`. The INBOUND limit is
  the important one: it caps lockbox-drain / unbacked-mint rate even if the DVN
  set is compromised — the one failure the OFT standard can't stop. Blocked
  inbound credits stay verified on the endpoint and re-execute permissionlessly
  after decay: delayed, never lost. **Contracts deploy CLOSED (limits 0);**
  the wire script opens the valve explicitly.
- **Bridge fee, hard-capped at 1% (compile-time constant), default 0.** Launch
  behavior = stock OFT = ClawBank. Fee revenue is optional and can never exceed
  1% — "owner rugs via fee" is structurally impossible. Adapter-side fees are
  tracked in `bridgeFeesAccrued` and withdrawal is capped to it — locked
  principal is unreachable by construction (test-pinned).
- **Pause + guardian.** A hot `pauser` bot may pause (incident response at
  3am); only the owner multisig can unpause/configure/withdraw.

Test coverage (12/12 green): round-trip supply conservation, closed-by-default,
outbound limit enforce + window decay, inbound limit blocking credits, fee
charge/withdraw on both sides, backing invariant under fees + withdrawal, fee
cap, fee slippage protection, pause/guardian role separation, owner-only admin,
supply-moves-only-via-bridge.

Fork dress rehearsals (local anvil forks of the REAL chains, throwaway key):
- Base fork: deploy → wire → DVN pin all succeeded; real Base ULN libs
  **accepted our exact config**; buckets and peer verified in post-state.
- Robinhood fork: same, and the resulting ULN config decoded **byte-identical
  to ClawBank's live production config**: `(10, 2, 0, 0, [Nethermind, LZ Labs])`.

## 3. Fee revenue — the honest answer

- The LayerZero **messaging fee** (ETH the bridger pays per transfer) goes to
  DVNs/executor/LayerZero. Not you. Always.
- **ClawBank earns zero from bridging** (verified: no fee module).
- **This build can earn**: owner-set bps (≤1%) of bridged amount, withdrawable
  to the treasury on each side via `withdrawBridgeFees`. Launch recommendation:
  leave at 0 for adoption; it's a one-tx treasury decision later.
- The **real launch revenue is LP fees**: whoever seeds the HIVE pool on
  Robinhood earns the swap fees. That's a treasury action, not a bridge feature.
- Route any fee withdrawals to an official treasury wallet (same policy as the
  dedicated Hyperliquid builder wallet), not a personal one.

### Bankr launch economics (verified 2026-07-12)

- HIVE is a Bankr token: "fair launch on Base", **0.7% swap fee on the launch
  pool split 95% creator / 5% Doppler protocol**, creator fees land in the
  Bankr agent wallet automatically (docs.bankr.bot llms-full.txt). The repo's
  `claim-bankr-hive` honey-ledger rail is the claim path.
- On-chain corroboration: HIVE's top Base holder is Uniswap v4's PoolManager
  with **30.4B HIVE (~30% of supply)** — the launch liquidity; HIVE's `owner()`
  is a contract (Bankr/Doppler infra), not a personal EOA.
- So "Bankr holds the initial supply" ≈ the supply sits in the locked v4 launch
  pool, and the creator's accruing fee share sits with Bankr until claimed.
  **Treasury HIVE for bridging/seeding comes from Bankr-wallet claims (or
  market buys) — user-staked HIVE in the stake vault is not treasury money.**
- Robinhood-side contrast: a pool we seed there is plain Uniswap v4 (no Doppler
  hook) — the fee tier accrues to our LP position directly. ClawBank's RH pool
  is **1% tier** (verified via GeckoTerminal): $22.1K TVL absorbing ~$235K/day
  → ~$2.35K/day to its LP at current flow. Do NOT project that onto HIVE
  blindly — HIVE's Base pool does ~$5.9K/day today; the bet is that the
  Robinhood audience adds net-new volume (it did for ClawBank, whose RH volume
  exceeds its Base volume).
- Bankr has no omnichain/bridge support of its own — this LayerZero bridge is
  the only path (ClawBank markets itself as the first bankr token omnichain).

## 4. Decisions still yours before mainnet

1. **The owner multisig** (`HIVE_OFT_OWNER`) — a Safe you control. Non-negotiable.
2. **Guardian pauser** — which bot/wallet gets `setPauser` (can pause, nothing else).
3. **Initial rate limits** — defaults in the wire script: 1B HIVE (1% of supply)
   per direction per 24h window. Override via env if you want tighter/looser.
4. **Bridge fee at launch** — recommend 0 (matches ClawBank; can enable later ≤1%).
5. **Liquidity plan** — how much HIVE to bridge and seed into a Robinhood pool.

## 5. Deploy sequence (mainnet)

Simulate-first: every script is a no-op without `--broadcast` + a signer.

```bash
cd contracts
export BASE_RPC_URL="https://mainnet.base.org"
export ROBINHOOD_RPC_URL="https://rpc.mainnet.chain.robinhood.com/"
export HIVE_OFT_OWNER=0x<your-safe>

# 1+2. deploy (simulate, then add --account <deployer> --broadcast [--verify on Base])
forge script script/DeployHiveAdapterBase.s.sol --rpc-url "$BASE_RPC_URL"
forge script script/DeployHiveOftRobinhood.s.sol --rpc-url "$ROBINHOOD_RPC_URL"
#   -> export HIVE_ADAPTER=<printed>   HIVE_ROBINHOOD_OFT=<printed>

# 3. pin DVNs on BOTH sides (before opening the valve; signer = owner/delegate)
HIVE_LOCAL_OAPP=$HIVE_ADAPTER       forge script script/SetDvnConfigHive.s.sol --rpc-url "$BASE_RPC_URL"      --account <owner> --broadcast
HIVE_LOCAL_OAPP=$HIVE_ROBINHOOD_OFT forge script script/SetDvnConfigHive.s.sol --rpc-url "$ROBINHOOD_RPC_URL" --account <owner> --broadcast

# 4. wire BOTH sides — sets peer + enforced options + rate limits (OPENS the bridge)
HIVE_LOCAL_OAPP=$HIVE_ADAPTER       HIVE_REMOTE_OAPP=$HIVE_ROBINHOOD_OFT forge script script/WireHiveOft.s.sol --rpc-url "$BASE_RPC_URL"      --account <owner> --broadcast
HIVE_LOCAL_OAPP=$HIVE_ROBINHOOD_OFT HIVE_REMOTE_OAPP=$HIVE_ADAPTER       forge script script/WireHiveOft.s.sol --rpc-url "$ROBINHOOD_RPC_URL" --account <owner> --broadcast

# 5. guardian + smoke test
#    setPauser(<guardian>) on both; then bridge 1 HIVE Base->RH, confirm mint,
#    bridge back, confirm release. Only then announce / seed liquidity.
```

Owner is a Safe? Run each script unbroadcast to produce calldata and execute
from the Safe (or use LayerZero devtools `lz:oapp:wire`).

### Testnet rehearsal (recommended first)

Same scripts, testnet pair (Base Sepolia 84532 ⇄ Robinhood Testnet 46630).
Deploy a mock ERC-20 on Sepolia and pass it as `HIVE_TESTNET_TOKEN`. Skip
SetDvnConfig (defaults are fine on testnet). This exercises the one thing local
forks cannot: real DVN/executor message delivery between live networks.

## 6. Post-deploy verification

- [ ] `peers()` on both sides point at each other; `token()` on the adapter is HIVE.
- [ ] `getConfig` on both send+receive libs decodes to `(10, 2, 0, 0, [LZ Labs, Nethermind])`.
- [ ] `getAmountCanBeSent` shows the intended buckets on both sides (outbound key = remote eid; inbound key = `inboundRateLimitKey(remote eid)`).
- [ ] Smoke test round trip with ~1 HIVE.
- [ ] **Standing monitor**: schedule `scripts/hive-bridge-monitor.mjs` (env
      `HIVE_BRIDGE_ADAPTER`/`HIVE_BRIDGE_OFT`, optional
      `HIVE_BRIDGE_ALERT_WEBHOOK`) on a fleet cron; exit 2 = breach → page the
      guardian to pause. Validated live against ClawBank's bridge.
- [ ] **Publish the bridge page**: fill `CONFIG.adapter`/`CONFIG.oft` (and
      later `swapLink`) in `bridge/index.html`, host the folder statically
      (e.g. Cloudflare Pages at `bridge.<domain>`).

## 7. Risk summary

- Trust root = owner multisig + DVN set (LZ Labs + Nethermind must both sign a
  forged message for an attack; the inbound rate limit then caps the damage per
  window; the guardian pauses; the multisig severs the peer).
- One lockbox, ever. New chains = new peers on the SAME adapter.
- 18→6 shared-decimal dust (<1e12 wei HIVE) is truncated per transfer — standard OFT.
- Enforced lzReceive gas default is 120k (covers credit + rate limit + pause);
  tune with `HIVE_LZRECEIVE_GAS` after profiling the smoke test.

## Rollback

Nothing is live. To discard: delete `contracts/src/oft/`, `contracts/test/HiveOftBridge.t.sol`,
the `contracts/script/*.s.sol` + `HiveOftAddresses.sol`, this runbook; revert the
`contracts/foundry.toml` remappings; remove the `@layerzerolabs/*` +
`solidity-bytes-utils` devDependencies. Post-deploy there is no undo of on-chain
contracts — only pause + peer-severance + migration; hence the multisig, the
closed-by-default valve, and the smoke-test gates above.
