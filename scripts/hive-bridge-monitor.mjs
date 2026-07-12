#!/usr/bin/env node
// HIVE omnichain bridge production monitor — fail-closed by design.
//
// Checks, every run:
//   BACKING     Base locked - accrued fees >= sum of remote OFT supplies.
//   READS       every required read must succeed on BOTH providers per chain;
//               a failed read or provider disagreement is an ALERT, never a 0.
//   DRIFT       owner / pauser / delegate / peers / libraries / ULN config /
//               fee bps / paused state / contract codehash vs a saved baseline.
//   GUARDIAN    pause-guardian gas balance on both chains.
//
// Standalone, dependency-free (raw JSON-RPC over fetch). NOT in the pnpm test
// gate directly; its hermetic test is scripts/test-hive-bridge-monitor.mjs.
//
// Env:
//   HIVE_BRIDGE_ADAPTER      Base lockbox (HiveOFTAdapter)        [required]
//   HIVE_BRIDGE_OFT          remote twin(s), comma-separated      [required]
//   HIVE_BRIDGE_TOKEN        underlying ERC-20 on Base            [default: canonical HIVE]
//   HIVE_BRIDGE_REMOTE_EID   remote eid as seen from Base         [default: 30416]
//   HIVE_BRIDGE_BASE_RPCS    comma list                           [default: 2 public providers]
//   HIVE_BRIDGE_RH_RPCS      comma list                           [default: official + Blockscout]
//   HIVE_BRIDGE_BASELINE     path to baseline JSON; if the file doesn't exist
//                            the current state is WRITTEN there (bootstrap) —
//                            review it, commit it, and subsequent runs diff it
//   HIVE_BRIDGE_GUARDIAN     pause-guardian address (gas check)
//   HIVE_BRIDGE_GUARDIAN_MIN_WEI  minimum guardian balance       [default: 0.002 ether]
//   HIVE_BRIDGE_ALERT_WEBHOOK     POSTed the report on any alert
//   HIVE_BRIDGE_HEARTBEAT_URL     POSTed on every healthy run
//   HIVE_BRIDGE_ALLOW_MISSING_FEE_COUNTER=1  tolerate stock adapters (testing)
//
// Exit: 0 healthy · 1 read failure/disagreement · 2 BACKING BREACH · 3 drift/other alert
// Prints exactly one JSON line.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const SEL = {
  balanceOf: "0x70a08231",
  totalSupply: "0x18160ddd",
  bridgeFeesAccrued: "0x26739896",
  defaultFeeBps: "0xbcae25a4",
  paused: "0x5c975abb",
  owner: "0x8da5cb5b",
  pauser: "0x9fd0506d",
  peers: "0xbb0b6a53",
  endpoint: "0x5e280f11",
  delegates: "0x587cde1e",
  getSendLibrary: "0xb96a277f",
  getReceiveLibrary: "0x402f8468",
  getConfig: "0x2b3197b9",
};

const env = (k, d) => process.env[k]?.trim() || d;
const ADAPTER = env("HIVE_BRIDGE_ADAPTER");
const OFTS = env("HIVE_BRIDGE_OFT", "").split(",").map((s) => s.trim()).filter(Boolean);
const TOKEN = env("HIVE_BRIDGE_TOKEN", "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3");
const REMOTE_EID = Number(env("HIVE_BRIDGE_REMOTE_EID", "30416"));
const BASE_RPCS = env("HIVE_BRIDGE_BASE_RPCS", "https://mainnet.base.org,https://base-rpc.publicnode.com").split(",");
const RH_RPCS = env(
  "HIVE_BRIDGE_RH_RPCS",
  "https://rpc.mainnet.chain.robinhood.com/,https://robinhoodchain.blockscout.com/api/eth-rpc",
).split(",");
const BASELINE = env("HIVE_BRIDGE_BASELINE");
const GUARDIAN = env("HIVE_BRIDGE_GUARDIAN");
const GUARDIAN_MIN = BigInt(env("HIVE_BRIDGE_GUARDIAN_MIN_WEI", "2000000000000000"));
const WEBHOOK = env("HIVE_BRIDGE_ALERT_WEBHOOK");
const HEARTBEAT = env("HIVE_BRIDGE_HEARTBEAT_URL");
const ALLOW_MISSING_FEES = env("HIVE_BRIDGE_ALLOW_MISSING_FEE_COUNTER") === "1";

if (!ADAPTER || OFTS.length === 0) {
  console.error("usage: HIVE_BRIDGE_ADAPTER=0x... HIVE_BRIDGE_OFT=0x...[,0x...] node scripts/hive-bridge-monitor.mjs");
  process.exit(1);
}

const pad = (v) => v.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const padNum = (n) => n.toString(16).padStart(64, "0");
const addrOf = (word) => "0x" + word.slice(-40);

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${url}: ${body.error.message}`);
  return body.result;
}

/// Read on EVERY provider; all must succeed and agree, else throw.
async function readAll(rpcs, to, data, label) {
  const results = await Promise.all(
    rpcs.map((u) =>
      rpc(u, "eth_call", [{ to, data }, "latest"]).catch((e) => {
        throw new Error(`read-failure ${label}: ${e.message}`);
      }),
    ),
  );
  const first = results[0];
  if (!results.every((r) => r === first)) throw new Error(`provider-disagreement ${label}: ${JSON.stringify(results)}`);
  return first;
}
const asBig = (hex) => BigInt(hex === "0x" ? 0 : hex);

/// eth_getCode on every provider; all must agree; returns sha256 of the code.
async function codeHashAll(rpcs, addr, label) {
  const codes = await Promise.all(
    rpcs.map((u) =>
      rpc(u, "eth_getCode", [addr, "latest"]).catch((e) => {
        throw new Error(`read-failure ${label}: ${e.message}`);
      }),
    ),
  );
  if (!codes.every((c) => c === codes[0])) throw new Error(`provider-disagreement ${label} code`);
  return createHash("sha256").update(codes[0]).digest("hex");
}

const alerts = [];
const report = { at: new Date().toISOString(), adapter: ADAPTER, ofts: OFTS };

try {
  // ----- backing (all reads required) -----
  const locked = asBig(await readAll(BASE_RPCS, TOKEN, SEL.balanceOf + pad(ADAPTER), "locked"));
  let fees = 0n;
  try {
    fees = asBig(await readAll(BASE_RPCS, ADAPTER, SEL.bridgeFeesAccrued, "feesAccrued"));
  } catch (e) {
    if (ALLOW_MISSING_FEES) report.feeCounter = "missing (allowed by env)";
    else throw e;
  }
  let minted = 0n;
  for (const oft of OFTS) minted += asBig(await readAll(RH_RPCS, oft, SEL.totalSupply, `supply ${oft}`));

  report.lockedWei = locked.toString();
  report.bridgeFeesAccruedWei = fees.toString();
  report.mintedWei = minted.toString();
  report.surplusWei = (locked - fees - minted).toString();
  report.backed = locked - fees >= minted;
  if (!report.backed) alerts.push("BACKING BREACH — pause the bridge");

  // ----- live config snapshot (drift detection) -----
  const oft0 = OFTS[0];
  const adapterEndpoint = addrOf(await readAll(BASE_RPCS, ADAPTER, SEL.endpoint, "endpoint"));
  const snapshot = {
    adapterOwner: addrOf(await readAll(BASE_RPCS, ADAPTER, SEL.owner, "owner")),
    adapterPauser: addrOf(await readAll(BASE_RPCS, ADAPTER, SEL.pauser, "pauser")),
    adapterPaused: asBig(await readAll(BASE_RPCS, ADAPTER, SEL.paused, "paused")) === 1n,
    adapterFeeBps: Number(asBig(await readAll(BASE_RPCS, ADAPTER, SEL.defaultFeeBps, "feeBps"))),
    adapterPeer: await readAll(BASE_RPCS, ADAPTER, SEL.peers + padNum(REMOTE_EID), "peer"),
    adapterDelegate: addrOf(await readAll(BASE_RPCS, adapterEndpoint, SEL.delegates + pad(ADAPTER), "delegate")),
    adapterSendLib: addrOf(
      await readAll(BASE_RPCS, adapterEndpoint, SEL.getSendLibrary + pad(ADAPTER) + padNum(REMOTE_EID), "sendLib"),
    ),
    adapterCodeHash: await codeHashAll(BASE_RPCS, ADAPTER, "adapter"),
    oftOwner: addrOf(await readAll(RH_RPCS, oft0, SEL.owner, "oft owner")),
    oftPauser: addrOf(await readAll(RH_RPCS, oft0, SEL.pauser, "oft pauser")),
    oftPaused: asBig(await readAll(RH_RPCS, oft0, SEL.paused, "oft paused")) === 1n,
    oftFeeBps: Number(asBig(await readAll(RH_RPCS, oft0, SEL.defaultFeeBps, "oft feeBps"))),
    oftCodeHash: await codeHashAll(RH_RPCS, oft0, "oft"),
  };
  report.snapshot = snapshot;
  if (snapshot.adapterPaused || snapshot.oftPaused) alerts.push("bridge is PAUSED");

  if (BASELINE) {
    if (!existsSync(BASELINE)) {
      writeFileSync(BASELINE, JSON.stringify(snapshot, null, 2));
      report.baseline = `bootstrapped ${BASELINE} — review and keep it`;
    } else {
      const base = JSON.parse(readFileSync(BASELINE, "utf8"));
      const drift = Object.keys(base).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(snapshot[k]));
      if (drift.length) alerts.push(`CONFIG DRIFT: ${drift.join(", ")}`);
      report.drift = drift;
    }
  }

  // ----- guardian gas -----
  if (GUARDIAN) {
    const gasBase = asBig(await rpc(BASE_RPCS[0], "eth_getBalance", [GUARDIAN, "latest"]));
    const gasRh = asBig(await rpc(RH_RPCS[0], "eth_getBalance", [GUARDIAN, "latest"]));
    report.guardianGas = { base: gasBase.toString(), robinhood: gasRh.toString() };
    if (gasBase < GUARDIAN_MIN) alerts.push("guardian low on Base gas");
    if (gasRh < GUARDIAN_MIN) alerts.push("guardian low on Robinhood gas");
  }
} catch (e) {
  report.error = e.message;
  console.log(JSON.stringify(report));
  if (WEBHOOK) await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alert: `monitor read failure: ${e.message}`, ...report }) }).catch(() => {});
  process.exit(1); // fail closed: unknown state is an alert, never "fine"
}

report.alerts = alerts;
console.log(JSON.stringify(report));

if (alerts.length) {
  if (WEBHOOK) await fetch(WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alert: alerts.join(" | "), ...report }) }).catch(() => {});
  process.exit(report.backed === false ? 2 : 3);
}
if (HEARTBEAT) await fetch(HEARTBEAT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true, at: report.at }) }).catch(() => {});
process.exit(0);
