#!/usr/bin/env node
// HIVE omnichain bridge backing monitor.
//
// Verifies the peg invariant of the Base ⇄ Robinhood OFT bridge:
//   HIVE.balanceOf(adapter) - bridgeFeesAccrued  >=  HiveOFT.totalSupply()
// (locked principal on Base must always cover the supply minted on Robinhood).
//
// Standalone and dependency-free (raw JSON-RPC over fetch); NOT part of the
// pnpm test gate. Run ad hoc or on a cron/fleet schedule after deploy:
//
//   HIVE_BRIDGE_ADAPTER=0x... HIVE_BRIDGE_OFT=0x... node scripts/hive-bridge-monitor.mjs
//
// Env:
//   HIVE_BRIDGE_ADAPTER        Base lockbox (HiveOFTAdapter)          [required]
//   HIVE_BRIDGE_OFT            Robinhood twin (HiveOFT)               [required]
//   HIVE_BRIDGE_TOKEN          underlying ERC-20 on Base              [default: canonical HIVE]
//   HIVE_BRIDGE_BASE_RPC       Base RPC                               [default: https://mainnet.base.org]
//   HIVE_BRIDGE_RH_RPC         Robinhood RPC                          [default: https://rpc.mainnet.chain.robinhood.com/]
//   HIVE_BRIDGE_ALERT_WEBHOOK  optional URL to POST the JSON report to on breach
//
// Exit codes: 0 = backed, 2 = BACKING BREACH, 1 = error (RPC down etc).
// Prints exactly one JSON line either way, so schedulers can parse it.

const SEL = {
  balanceOf: "0x70a08231", // balanceOf(address)
  totalSupply: "0x18160ddd", // totalSupply()
  bridgeFeesAccrued: "0x26739896", // bridgeFeesAccrued()
};

const env = (key, fallback) => process.env[key]?.trim() || fallback;
const ADAPTER = env("HIVE_BRIDGE_ADAPTER");
const OFT = env("HIVE_BRIDGE_OFT");
const TOKEN = env("HIVE_BRIDGE_TOKEN", "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3");
const BASE_RPC = env("HIVE_BRIDGE_BASE_RPC", "https://mainnet.base.org");
const RH_RPC = env("HIVE_BRIDGE_RH_RPC", "https://rpc.mainnet.chain.robinhood.com/");
const WEBHOOK = env("HIVE_BRIDGE_ALERT_WEBHOOK");

if (!ADAPTER || !OFT) {
  console.error("usage: HIVE_BRIDGE_ADAPTER=0x... HIVE_BRIDGE_OFT=0x... node scripts/hive-bridge-monitor.mjs");
  process.exit(1);
}

async function ethCall(rpc, to, data) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  if (!res.ok) throw new Error(`${rpc} HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${rpc} ${to} ${data.slice(0, 10)}: ${body.error.message}`);
  return BigInt(body.result === "0x" ? 0 : body.result);
}

const pad = (addr) => "000000000000000000000000" + addr.toLowerCase().replace(/^0x/, "");

try {
  const locked = await ethCall(BASE_RPC, TOKEN, SEL.balanceOf + pad(ADAPTER));
  // Fee counter is a HiveOFTAdapter extension; absent on stock adapters (e.g. ClawBank) — treat as 0.
  const fees = await ethCall(BASE_RPC, ADAPTER, SEL.bridgeFeesAccrued).catch(() => 0n);
  const minted = await ethCall(RH_RPC, OFT, SEL.totalSupply);

  const principal = locked - fees;
  const backed = principal >= minted;
  const report = {
    at: new Date().toISOString(),
    adapter: ADAPTER,
    oft: OFT,
    lockedWei: locked.toString(),
    bridgeFeesAccruedWei: fees.toString(),
    mintedWei: minted.toString(),
    surplusWei: (principal - minted).toString(),
    backed,
  };
  console.log(JSON.stringify(report));

  if (!backed && WEBHOOK) {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alert: "HIVE bridge BACKING BREACH — pause the bridge", ...report }),
    }).catch((e) => console.error(`webhook failed: ${e.message}`));
  }
  process.exit(backed ? 0 : 2);
} catch (e) {
  console.log(JSON.stringify({ at: new Date().toISOString(), error: e.message }));
  process.exit(1);
}
