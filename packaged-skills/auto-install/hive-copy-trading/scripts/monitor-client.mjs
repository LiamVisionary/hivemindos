#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";

const BASE_URL = "https://hivemindos-copy-trading-gateway.hivemindos.workers.dev";
const KEY_ENV = "HIVEMIND_COPY_TRADING_WALLET_KEY";
const STATE_PATH = process.env.HIVEMIND_COPY_TRADING_STATE_PATH || ".hive-copy-trading-monitors.json";
const RISK_ACK = "I understand copy trading can lose money";
const FEE_ACK = "I authorize HivemindOS to charge the published $1 usage minimum and uncapped 0.5% fee on each verified live copied trade";

const [command = "help", ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

try {
  if (command === "pricing") {
    print(await request("/v1/pricing"));
  } else if (command === "verify") {
    print(await request("/v1/bankr/verify", { method: "POST", body: { apiKey: walletKey() } }));
  } else if (command === "start") {
    await startMonitor(args);
  } else if (["status", "pause", "resume", "paper", "live", "cancel"].includes(command)) {
    await manageMonitor(command, args);
  } else {
    print({
      usage: [
        "monitor-client.mjs pricing",
        "monitor-client.mjs verify",
        "monitor-client.mjs start --target 0x... --confirm-risk --confirm-fee [--max-trade 5 --max-daily 25 --scale 20 --slippage 100]",
        "monitor-client.mjs status [--id ctmon_...]",
        "monitor-client.mjs pause|resume|paper|cancel [--id ctmon_...]",
        "monitor-client.mjs live [--id ctmon_...] --confirm-risk --confirm-fee",
      ],
    });
  }
} catch (error) {
  process.stderr.write(`${safeMessage(error)}\n`);
  process.exitCode = 1;
}

async function startMonitor(options) {
  const targetWallet = requiredAddress(options.target, "--target");
  if (options["confirm-risk"] !== true || options["confirm-fee"] !== true) {
    throw new Error("Starting live requires both --confirm-risk and --confirm-fee after showing current pricing to the user.");
  }
  const pricing = await request("/v1/pricing");
  if (pricing.ok !== true || pricing.commercial?.pricingAuthority !== "server") {
    throw new Error("Hosted copy-trading pricing is unavailable or not server-authoritative.");
  }
  const state = await readState();
  const activationIdempotencyKey = state.pending[targetWallet]?.activationIdempotencyKey
    || `ctstart_${randomUUID()}`;
  state.pending[targetWallet] = { activationIdempotencyKey, createdAt: new Date().toISOString() };
  await writeState(state);
  const apiKey = walletKey();
  const verified = await request("/v1/bankr/verify", { method: "POST", body: { apiKey } });
  const balance = Number(verified.wallet?.baseUsdcBalance);
  const minimum = Number(pricing.pricing?.usageMinimumUsd || 1);
  if (!Number.isFinite(balance) || balance < minimum) {
    throw new Error(`Fund at least $${minimum.toFixed(2)} Base USDC in the Bankr wallet before activation.`);
  }

  const payload = await request("/v1/monitors", {
    method: "POST",
    body: {
      activationIdempotencyKey,
      targetWallet,
      bankrConnection: { kind: "existing", apiKey },
      mode: "live",
      riskAcknowledgement: RISK_ACK,
      feeAcknowledgement: FEE_ACK,
      maxTradeUsd: numberArg(options["max-trade"], 5),
      maxDailyUsd: numberArg(options["max-daily"], 25),
      scalePercent: numberArg(options.scale, 20),
      maxSlippageBps: numberArg(options.slippage, 100),
    },
  });
  const monitorId = string(payload.monitorId || payload.subscriptionId);
  const accessToken = string(payload.accessToken);
  const manageUrl = string(payload.manageUrl);
  if (!monitorId || !accessToken || !manageUrl) throw new Error("Monitor activation returned no private management credential.");
  state.monitors[monitorId] = {
    id: monitorId,
    targetWallet,
    bankrWallet: string(payload.bankrWallet),
    accessToken,
    manageUrl,
    billing: payload.billing,
    createdAt: new Date().toISOString(),
  };
  delete state.pending[targetWallet];
  await writeState(state);
  print({
    ok: true,
    monitorId,
    targetWallet,
    bankrWallet: string(payload.bankrWallet),
    manageUrl,
    billing: payload.billing,
    mode: "live",
    note: "The access token was stored privately and was not printed. Live activation follows independent verification of the $1 Base USDC usage payment.",
  });
}

async function manageMonitor(commandName, options) {
  const state = await readState();
  const monitor = selectMonitor(state, options.id);
  if (commandName === "status") {
    print(await authorizedRequest(monitor, "GET"));
    return;
  }
  if (commandName === "cancel") {
    await authorizedRequest(monitor, "DELETE");
    delete state.monitors[monitor.id];
    await writeState(state);
    print({ ok: true, canceled: monitor.id, credentialErased: true });
    return;
  }
  let patch;
  if (commandName === "pause" || commandName === "resume") {
    patch = { status: commandName === "pause" ? "paused" : "active" };
  } else if (commandName === "paper") {
    patch = { mode: "paper" };
  } else {
    if (options["confirm-risk"] !== true || options["confirm-fee"] !== true) {
      throw new Error("Live mode requires both --confirm-risk and --confirm-fee after showing current pricing to the user.");
    }
    const pricing = await request("/v1/pricing");
    if (pricing.ok !== true) throw new Error("Current hosted pricing is unavailable; live mode was not enabled.");
    patch = { mode: "live", riskAcknowledgement: RISK_ACK, feeAcknowledgement: FEE_ACK };
  }
  print(await authorizedRequest(monitor, "PATCH", patch));
}

async function authorizedRequest(monitor, method, body) {
  return request(new URL(monitor.manageUrl).pathname, {
    method,
    token: monitor.accessToken,
    ...(body ? { body } : {}),
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(90_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Hosted service returned HTTP ${response.status}.`);
  return payload;
}

async function readState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
    return {
      schemaVersion: 1,
      monitors: object(parsed.monitors),
      pending: object(parsed.pending),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, monitors: {}, pending: {} };
    throw new Error("The private monitor state file is unreadable or invalid.");
  }
}

async function writeState(state) {
  const temporary = `${STATE_PATH}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, STATE_PATH);
  await chmod(STATE_PATH, 0o600);
}

function selectMonitor(state, requestedId) {
  const id = string(requestedId);
  if (id && state.monitors[id]) return state.monitors[id];
  const monitors = Object.values(state.monitors);
  if (monitors.length === 1) return monitors[0];
  if (!monitors.length) throw new Error("No private HivemindOS copy-trading monitor is stored.");
  throw new Error("More than one monitor is stored; pass --id ctmon_....");
}

function walletKey() {
  const key = string(process.env[KEY_ENV]);
  if (!/^bk_usr_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{24,128}$/.test(key)) {
    throw new Error(`Set ${KEY_ENV} in Bankr secure environment variables to a dedicated Wallet API key.`);
  }
  return key;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument: ${value}`);
    const name = value.slice(2);
    if (["confirm-risk", "confirm-fee"].includes(name)) parsed[name] = true;
    else parsed[name] = values[++index];
  }
  return parsed;
}

function requiredAddress(value, label) {
  const address = string(value).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error(`${label} must be a complete Base wallet address.`);
  return address;
}

function numberArg(value, fallback) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error("A numeric risk limit is invalid.");
  return number;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeMessage(error) {
  return (error instanceof Error ? error.message : "Copy-trading command failed.")
    .replace(/bk_usr_[A-Za-z0-9_-]+/g, "[redacted Bankr key]")
    .replace(/ctaccess_[A-Za-z0-9_-]+/g, "[redacted access token]");
}
