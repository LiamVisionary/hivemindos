#!/usr/bin/env node
// Hermetic test for scripts/hive-bridge-monitor.mjs.
// Spins up stub JSON-RPC servers (no chain, no network) and asserts the
// monitor's exit code + JSON for each scenario: healthy, backing breach,
// read-failure (fail-closed), provider disagreement, config drift, paused,
// and low guardian gas.

import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEL = {
  balanceOf: "0x70a08231", totalSupply: "0x18160ddd", bridgeFeesAccrued: "0x26739896",
  defaultFeeBps: "0xbcae25a4", paused: "0x5c975abb", owner: "0x8da5cb5b", pauser: "0x9fd0506d",
  peers: "0xbb0b6a53", endpoint: "0x5e280f11", delegates: "0x587cde1e", getSendLibrary: "0xb96a277f",
};
const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const addrWord = (a) => word(a);
const numWord = (n) => n.toString(16).padStart(64, "0");
const ADAPTER = "0x1111111111111111111111111111111111111111";
const OFT = "0x2222222222222222222222222222222222222222";
const ENDPOINT = "0x3333333333333333333333333333333333333333";
const OWNER = "0x4444444444444444444444444444444444444444";
const GUARDIAN = "0x5555555555555555555555555555555555555555";
const SENDLIB = "0x6666666666666666666666666666666666666666";

let passed = 0, failed = 0;
const servers = [];

// A stub chain: maps selector-prefixed calldata -> return word. `state`
// overrides let a scenario mutate one value or force an RPC error.
function makeChain(defaults) {
  return (calldata, to) => {
    const sel = calldata.slice(0, 10);
    const key = `${to.toLowerCase()}:${sel}`;
    if (key in defaults) {
      const v = defaults[key];
      if (v === "REVERT") { const e = new Error("execution reverted"); e.rpcError = true; throw e; }
      return "0x" + v;
    }
    return "0x" + "0".repeat(64);
  };
}

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        let payload;
        try { payload = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
        try {
          const { method, params } = payload;
          let result;
          if (method === "eth_call") result = handler.call(params[0].data, params[0].to);
          else if (method === "eth_getCode") result = handler.code(params[0]);
          else if (method === "eth_getBalance") result = handler.balance(params[0]);
          else result = "0x";
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
        } catch (e) {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: 3, message: e.message } }));
        }
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
    servers.push(srv);
  });
}

function baseDefaults(overrides = {}) {
  const d = {
    // Base token.balanceOf(adapter) = locked
    [`${"0xa382c83e2a3b79368f372c2eb9b6925ffaf45ba3"}:${SEL.balanceOf}`]: numWord(1000n),
    [`${ADAPTER}:${SEL.bridgeFeesAccrued}`]: numWord(0n),
    [`${ADAPTER}:${SEL.owner}`]: addrWord(OWNER),
    [`${ADAPTER}:${SEL.pauser}`]: addrWord(GUARDIAN),
    [`${ADAPTER}:${SEL.paused}`]: numWord(0n),
    [`${ADAPTER}:${SEL.defaultFeeBps}`]: numWord(0n),
    [`${ADAPTER}:${SEL.peers}`]: addrWord(OFT),
    [`${ADAPTER}:${SEL.endpoint}`]: addrWord(ENDPOINT),
    [`${ENDPOINT}:${SEL.delegates}`]: addrWord(OWNER),
    [`${ENDPOINT}:${SEL.getSendLibrary}`]: addrWord(SENDLIB),
  };
  return { ...d, ...overrides };
}
function rhDefaults(overrides = {}) {
  const d = {
    [`${OFT}:${SEL.totalSupply}`]: numWord(1000n),
    [`${OFT}:${SEL.owner}`]: addrWord(OWNER),
    [`${OFT}:${SEL.pauser}`]: addrWord(GUARDIAN),
    [`${OFT}:${SEL.paused}`]: numWord(0n),
    [`${OFT}:${SEL.defaultFeeBps}`]: numWord(0n),
  };
  return { ...d, ...overrides };
}

function chainHandler(callMap, { code = "0xabcd", balance = "0xde0b6b3a7640000" } = {}) {
  const call = makeChain(callMap);
  return { call, code: () => code, balance: () => balance };
}

async function run(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/hive-bridge-monitor.mjs"], {
      env: { ...process.env, ...env }, cwd: process.cwd(),
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(out.trim().split("\n").pop()); } catch {}
      resolve({ code, json, out });
    });
  });
}

function check(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name} ${detail}`); }
}

async function main() {
  // Two Base providers, two RH providers (default: agreeing).
  const baseA = await startServer(chainHandler(baseDefaults()));
  const baseB = await startServer(chainHandler(baseDefaults()));
  const rhA = await startServer(chainHandler(rhDefaults()));
  const rhB = await startServer(chainHandler(rhDefaults()));
  const url = (s) => `http://127.0.0.1:${s.address().port}`;

  const baseEnv = {
    HIVE_BRIDGE_ADAPTER: ADAPTER,
    HIVE_BRIDGE_OFT: OFT,
    HIVE_BRIDGE_REMOTE_EID: "30416",
    HIVE_BRIDGE_BASE_RPCS: `${url(baseA)},${url(baseB)}`,
    HIVE_BRIDGE_RH_RPCS: `${url(rhA)},${url(rhB)}`,
  };

  console.log("scenario: healthy");
  let r = await run(baseEnv);
  check("exit 0", r.code === 0, `got ${r.code}`);
  check("backed true", r.json?.backed === true);
  check("no alerts", Array.isArray(r.json?.alerts) && r.json.alerts.length === 0);

  console.log("scenario: backing breach (minted > locked)");
  const rhBreachA = await startServer(chainHandler(rhDefaults({ [`${OFT}:${SEL.totalSupply}`]: numWord(2000n) })));
  const rhBreachB = await startServer(chainHandler(rhDefaults({ [`${OFT}:${SEL.totalSupply}`]: numWord(2000n) })));
  r = await run({ ...baseEnv, HIVE_BRIDGE_RH_RPCS: `${url(rhBreachA)},${url(rhBreachB)}` });
  check("exit 2", r.code === 2, `got ${r.code}`);
  check("backed false", r.json?.backed === false);
  check("breach alert present", r.json?.alerts?.some((a) => /BACKING BREACH/.test(a)));

  console.log("scenario: read failure -> fail closed");
  const baseRevert = await startServer(chainHandler(baseDefaults({ [`${ADAPTER}:${SEL.pauser}`]: "REVERT" })));
  r = await run({ ...baseEnv, HIVE_BRIDGE_BASE_RPCS: `${url(baseRevert)},${url(baseB)}` });
  check("exit 1 (fail closed)", r.code === 1, `got ${r.code}`);
  check("error reported", typeof r.json?.error === "string" && /read-failure/.test(r.json.error));

  console.log("scenario: provider disagreement -> fail closed");
  const rhDisagree = await startServer(chainHandler(rhDefaults({ [`${OFT}:${SEL.totalSupply}`]: numWord(999n) })));
  r = await run({ ...baseEnv, HIVE_BRIDGE_RH_RPCS: `${url(rhA)},${url(rhDisagree)}` });
  check("exit 1 (disagreement)", r.code === 1, `got ${r.code}`);
  check("disagreement error", /provider-disagreement/.test(r.json?.error ?? ""));

  console.log("scenario: config drift vs baseline");
  const dir = mkdtempSync(join(tmpdir(), "hive-mon-"));
  const baselinePath = join(dir, "baseline.json");
  r = await run({ ...baseEnv, HIVE_BRIDGE_BASELINE: baselinePath }); // bootstrap
  check("bootstrap exit 0", r.code === 0, `got ${r.code}`);
  check("baseline written", /bootstrapped/.test(r.json?.baseline ?? ""));
  // now change the owner on both Base providers
  const baseDriftA = await startServer(chainHandler(baseDefaults({ [`${ADAPTER}:${SEL.owner}`]: addrWord("0x9999999999999999999999999999999999999999") })));
  const baseDriftB = await startServer(chainHandler(baseDefaults({ [`${ADAPTER}:${SEL.owner}`]: addrWord("0x9999999999999999999999999999999999999999") })));
  r = await run({ ...baseEnv, HIVE_BRIDGE_BASE_RPCS: `${url(baseDriftA)},${url(baseDriftB)}`, HIVE_BRIDGE_BASELINE: baselinePath });
  check("drift exit 3", r.code === 3, `got ${r.code}`);
  check("drift names adapterOwner", r.json?.alerts?.some((a) => /CONFIG DRIFT.*adapterOwner/.test(a)), JSON.stringify(r.json?.alerts));

  console.log("scenario: paused -> alert");
  const basePausedA = await startServer(chainHandler(baseDefaults({ [`${ADAPTER}:${SEL.paused}`]: numWord(1n) })));
  const basePausedB = await startServer(chainHandler(baseDefaults({ [`${ADAPTER}:${SEL.paused}`]: numWord(1n) })));
  r = await run({ ...baseEnv, HIVE_BRIDGE_BASE_RPCS: `${url(basePausedA)},${url(basePausedB)}` });
  check("paused exit 3", r.code === 3, `got ${r.code}`);
  check("paused alert", r.json?.alerts?.some((a) => /PAUSED/.test(a)));

  console.log("scenario: low guardian gas");
  const baseLowGasA = await startServer({ call: makeChain(baseDefaults()), code: () => "0xabcd", balance: () => "0x1" });
  r = await run({ ...baseEnv, HIVE_BRIDGE_BASE_RPCS: `${url(baseLowGasA)},${url(baseB)}`, HIVE_BRIDGE_GUARDIAN: GUARDIAN });
  check("low gas exit 3", r.code === 3, `got ${r.code}`);
  check("guardian gas alert", r.json?.alerts?.some((a) => /guardian low/.test(a)), JSON.stringify(r.json?.alerts));

  rmSync(dir, { recursive: true, force: true });
  servers.forEach((s) => s.close());

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); servers.forEach((s) => s.close()); process.exit(1); });
