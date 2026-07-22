#!/usr/bin/env node

import http from "node:http";
import { pathToFileURL } from "node:url";

import {
  buildGovernancePackage,
  HIVE_MAINNET_DEPLOYMENT,
} from "./hive-mainnet-governance.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5022;

const CHAIN_METADATA = Object.freeze({
  base: Object.freeze({
    chainIdHex: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://base.blockscout.com"],
  }),
  robinhood: Object.freeze({
    chainIdHex: "0x1237",
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com/"],
    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  }),
});

function serializeForInlineScript(value) {
  return JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item))
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function buildGovernanceQueuePayload() {
  return {
    requiredOwner: HIVE_MAINNET_DEPLOYMENT.owner,
    safe: HIVE_MAINNET_DEPLOYMENT.safe,
    timelock: HIVE_MAINNET_DEPLOYMENT.timelock,
    delaySeconds: HIVE_MAINNET_DEPLOYMENT.timelockDelaySeconds,
    chains: Object.fromEntries(
      Object.entries(CHAIN_METADATA).map(([chainKey, metadata]) => {
        const governancePackage = buildGovernancePackage(chainKey);
        return [chainKey, {
          ...metadata,
          transactions: governancePackage.transactions.map((transaction) => ({
            kind: transaction.kind,
            operationId: transaction.operationId,
            to: transaction.to,
            value: transaction.value,
            data: transaction.data,
          })),
        }];
      }),
    ),
  };
}

export function renderGovernanceQueuePage() {
  const payload = serializeForInlineScript(buildGovernanceQueuePayload());
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Cancel Old HIVE Mainnet Governance</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #090b12; color: #f6f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 18px; }
    main { width: min(760px, 100%); }
    h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 46px); letter-spacing: -0.04em; }
    p { color: #aeb5c7; line-height: 1.55; }
    code { color: #d7b7ff; overflow-wrap: anywhere; }
    .card { background: #111522; border: 1px solid #252b3d; border-radius: 18px; padding: 22px; margin-top: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    button { width: 100%; border: 0; border-radius: 12px; padding: 13px 16px; font: inherit; font-weight: 750; cursor: pointer; background: #c992ff; color: #170722; }
    button.secondary { background: #232a3d; color: #f6f7fb; }
    button.danger { background: #ff817a; color: #2c0705; }
    button:disabled { cursor: not-allowed; opacity: .46; }
    .status { min-height: 24px; margin-top: 12px; color: #d7dbea; white-space: pre-wrap; }
    .ok { color: #79e3b0; }
    .warn { color: #ffc978; }
    .small { font-size: 13px; }
  </style>
</head>
<body>
<main>
  <h1>Cancel old HIVE operations</h1>
  <p>The original v1 bridge will not be used. This local page cancels its four pending timelock operations so they can never activate after the 72-hour delay.</p>
  <section class="card">
    <button id="connect">Connect governance wallet</button>
    <div id="wallet-status" class="status">Required wallet: <code>${HIVE_MAINNET_DEPLOYMENT.owner}</code></div>
  </section>
  <section class="grid">
    <div class="card">
      <h2>Base</h2>
      <p>Two approvals: cancel configuration, then cancel canary limits.</p>
      <button id="cancel-base" class="danger" disabled>Cancel old Base operations</button>
      <div id="status-base" class="status small"></div>
    </div>
    <div class="card">
      <h2>Robinhood Chain</h2>
      <p>Two approvals: cancel configuration, then cancel canary limits.</p>
      <button id="cancel-robinhood" class="danger" disabled>Cancel old Robinhood operations</button>
      <div id="status-robinhood" class="status small"></div>
    </div>
  </section>
  <p class="small">Safe: <code>${HIVE_MAINNET_DEPLOYMENT.safe}</code><br>Timelock: <code>${HIVE_MAINNET_DEPLOYMENT.timelock}</code></p>
</main>
<script>
const payload = ${payload};
const requiredOwner = payload.requiredOwner.toLowerCase();
const announcedProviders = [];
let provider = null;
let connectedAccount = null;
let providerEventsBound = false;

window.addEventListener("eip6963:announceProvider", (event) => {
  const detail = event?.detail;
  if (!detail?.provider || !detail?.info?.uuid) return;
  if (announcedProviders.some((entry) => entry.info.uuid === detail.info.uuid)) return;
  announcedProviders.push(detail);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function resolveProvider() {
  const rabbyAnnouncement = announcedProviders.find((entry) => /rabby/i.test(entry.info?.name || ""));
  if (rabbyAnnouncement?.provider) return rabbyAnnouncement.provider;
  if (window.rabby) return window.rabby;
  const injectedProviders = Array.isArray(window.ethereum?.providers) ? window.ethereum.providers : [];
  return injectedProviders.find((candidate) => candidate?.isRabby) || window.ethereum;
}

function describeError(error) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const message = typeof error.message === "string" ? error.message : "Wallet request failed";
    const code = error.code === undefined ? "" : " (code " + String(error.code) + ")";
    const detail = typeof error.data === "string"
      ? ": " + error.data
      : error.data && typeof error.data === "object" && typeof error.data.message === "string"
        ? ": " + error.data.message
        : "";
    return message + code + detail;
  }
  return String(error || "Wallet request failed");
}

function setWalletStatus(message, tone = "") {
  const element = document.getElementById("wallet-status");
  element.textContent = message;
  element.className = "status " + tone;
}

function setChainStatus(chainKey, message, tone = "") {
  const element = document.getElementById("status-" + chainKey);
  element.textContent = message;
  element.className = "status small " + tone;
}

function setActionButtons(enabled) {
  document.getElementById("cancel-base").disabled = !enabled;
  document.getElementById("cancel-robinhood").disabled = !enabled;
}

async function connect() {
  provider = resolveProvider();
  if (!provider) {
    throw new Error("No browser wallet was detected. Open this page in the browser profile containing your wallet extension.");
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  connectedAccount = String(accounts?.[0] || "");
  if (connectedAccount.toLowerCase() !== requiredOwner) {
    setActionButtons(false);
    throw new Error("Connected " + (connectedAccount || "no account") + ". Switch the wallet extension to " + payload.requiredOwner + ".");
  }
  setWalletStatus("Connected governance wallet: " + connectedAccount, "ok");
  setActionButtons(true);
  if (!providerEventsBound && typeof provider.on === "function") {
    providerEventsBound = true;
    provider.on("accountsChanged", () => {
      connectedAccount = null;
      setActionButtons(false);
      setWalletStatus("Wallet account changed. Reconnect " + payload.requiredOwner + ".", "warn");
    });
  }
  return connectedAccount;
}

async function ensureChain(chain) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: chain.chainIdHex,
      chainName: chain.chainName,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: chain.rpcUrls,
      blockExplorerUrls: chain.blockExplorerUrls,
    }] });
  }
}

async function operationTimestamp(operationId) {
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: payload.timelock, data: "0xd45c4435" + operationId.slice(2) }, "latest"],
  });
  return BigInt(result || "0x0");
}

async function waitForReceipt(transactionHash) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [transactionHash] });
    if (receipt) {
      if (BigInt(receipt.status || "0x0") !== 1n) throw new Error("Transaction reverted: " + transactionHash);
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for " + transactionHash + ". Check the explorer before retrying.");
}

async function cancelChain(chainKey) {
  const chain = payload.chains[chainKey];
  const button = document.getElementById("cancel-" + chainKey);
  const completedOperations = [];
  button.disabled = true;
  try {
    if (!connectedAccount || connectedAccount.toLowerCase() !== requiredOwner) await connect();
    await ensureChain(chain);
    for (let index = 0; index < chain.transactions.length; index += 1) {
      const transaction = chain.transactions[index];
      const label = transaction.kind === "configuration" ? "configuration" : "canary activation";
      const existingTimestamp = await operationTimestamp(transaction.operationId);
      if (existingTimestamp === 0n) {
        completedOperations.push({ label, transactionHash: null });
        setChainStatus(chainKey, label + " is already canceled; skipping.", "ok");
        continue;
      }
      setChainStatus(chainKey, "Approve " + (index + 1) + "/2 in Rabby: cancel " + label + ".", "warn");
      const transactionHash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: connectedAccount,
          to: payload.timelock,
          value: "0x0",
          data: "0xc4d252f5" + transaction.operationId.slice(2),
        }],
      });
      setChainStatus(chainKey, "Waiting for cancellation: " + transactionHash);
      await waitForReceipt(transactionHash);
      if (await operationTimestamp(transaction.operationId) !== 0n) {
        throw new Error(label + " still has a nonzero timelock timestamp after a successful receipt.");
      }
      completedOperations.push({ label, transactionHash });
    }
    const details = completedOperations.map((operation) => {
      return operation.label + " canceled" + (operation.transactionHash ? " · " + operation.transactionHash : "");
    });
    setChainStatus(chainKey, chain.chainName + ": both old operations are canceled.\\n" + details.join("\\n"), "ok");
  } catch (error) {
    setChainStatus(chainKey, describeError(error), "warn");
  } finally {
    button.disabled = connectedAccount?.toLowerCase() !== requiredOwner;
  }
}

document.getElementById("connect").addEventListener("click", () => connect().catch((error) => {
  setWalletStatus(describeError(error), "warn");
}));
document.getElementById("cancel-base").addEventListener("click", () => cancelChain("base"));
document.getElementById("cancel-robinhood").addEventListener("click", () => cancelChain("robinhood"));
</script>
</body>
</html>`;
}

export function startGovernanceQueueServer({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" || (request.url !== "/" && request.url !== "/favicon.ico")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    if (request.url === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https:; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "x-content-type-options": "nosniff",
    });
    response.end(renderGovernanceQueuePage());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${port}` }));
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  const { url } = await startGovernanceQueueServer();
  process.stdout.write(`HIVE governance approval page: ${url}\n`);
}
