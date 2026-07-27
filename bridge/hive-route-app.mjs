import {
  classifyRelayStatus,
  createInitialRouteState,
  encodeRouteState,
  extractRecipientTokenTransfers,
  extractRelayTransactions,
  nextRouteAction,
  recordRouteCheckpoint,
  restoreRouteState,
} from "./hive-route-core.mjs";

const ethers = globalThis.ethers;
const config = globalThis.HIVE_BRIDGE_CONFIG;
const byId = (id) => document.getElementById(id);
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const AMOUNT_PATTERN = /^[1-9][0-9]{0,77}$/;
const OUTBOUND_LONG_FLAG = 0x40000000n;
const INBOUND_FLAG = 0x80000000n;
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const OFT_ABI = [
  "function getAmountCanBeSent(uint32) view returns (uint256,uint256)",
  "function quoteOFT((uint32,bytes32,uint256,uint256,bytes,bytes,bytes)) view returns ((uint256,uint256),(int256,string)[],(uint256,uint256))",
  "function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))",
  "function send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address) payable",
];

let account = null;
let capabilities = null;
let routeState = restoreFromUrl();
let relayQuote = null;
let oftQuote = null;
let running = false;

function restoreFromUrl() {
  const match = /^#route=([A-Za-z0-9_-]+)$/u.exec(globalThis.location.hash);
  if (!match) return null;
  try {
    return restoreRouteState(match[1]);
  } catch {
    globalThis.history.replaceState(null, "", `${globalThis.location.pathname}${globalThis.location.search}`);
    return null;
  }
}

function saveState(next) {
  routeState = next;
  const encoded = encodeRouteState(next);
  globalThis.history.replaceState(null, "", `${globalThis.location.pathname}${globalThis.location.search}#route=${encoded}`);
  renderRecovery();
}

function clearState() {
  routeState = null;
  relayQuote = null;
  oftQuote = null;
  globalThis.history.replaceState(null, "", `${globalThis.location.pathname}${globalThis.location.search}`);
  setRouteStatus("");
  renderRecovery();
  updateRouteButtons();
}

function setRouteStatus(message, kind = "") {
  const element = byId("routeStatus");
  element.textContent = message;
  element.className = `status ${kind}`;
}

function shortError(error) {
  const message = error?.shortMessage || error?.message || String(error);
  return message.length > 220 ? `${message.slice(0, 220)}…` : message;
}

function renderRecovery() {
  const recovery = byId("routeRecovery");
  const clearButton = byId("routeClearBtn");
  if (!routeState) {
    recovery.textContent = "No route in progress. Progress is recoverable from this page URL after the first quote.";
    clearButton.hidden = true;
    return;
  }
  const action = nextRouteAction(routeState);
  recovery.textContent = action === "complete"
    ? "Route complete. The URL contains a non-secret transaction receipt trail."
    : `Recovery checkpoint: ${action}. Reloading will not resubmit a completed transaction.`;
  clearButton.hidden = false;
  byId("routeDirection").value = routeState.direction;
  byId("routeCurrency").value = routeState.paymentCurrency;
}

function updateRouteButtons() {
  const supported = Boolean(capabilities?.routedTradeSupported);
  byId("routeQuoteBtn").disabled = running || !account || !supported || !config.deployed;
  byId("routeRunBtn").disabled = running || !account || !supported || !config.deployed;
  byId("routeRunBtn").textContent = routeState && nextRouteAction(routeState) !== "complete" ? "Resume route" : "Run route";
}

async function loadCapabilities() {
  const capability = byId("routeCapability");
  try {
    const response = await fetch(`${config.gateway}/v1/capabilities`, { headers: { accept: "application/json" } });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) throw new Error(body?.error || "Route capability check failed.");
    capabilities = body;
    if (body.routedTradeSupported) {
      capability.textContent = `Available via Base liquidity · 0.45% routed app fee + 0.05% OFT fee · ${body.maximumTotalImpactPercent}% hard impact limit`;
      capability.className = "route-note good";
    } else {
      const missing = Array.isArray(body.missingChainIds) ? body.missingChainIds.join(", ") : "unknown";
      capability.textContent = `Direct HIVE bridging is live. Routed buying/selling is unavailable on this network because Relay is missing chain ${missing}.`;
      capability.className = "route-note warn-text";
    }
  } catch (error) {
    capabilities = null;
    capability.textContent = `Routed trading is unavailable: ${shortError(error)}`;
    capability.className = "route-note warn-text";
  }
  updateRouteButtons();
}

async function connectRouteWallet() {
  if (!globalThis.ethereum) throw new Error("No EVM wallet was found.");
  const accounts = await globalThis.ethereum.request({ method: "eth_requestAccounts" });
  const connectedAccount = ethers.getAddress(accounts[0]);
  if (routeState && routeState.account.toLowerCase() !== connectedAccount.toLowerCase()) {
    account = null;
    byId("routeConnectBtn").textContent = "Connect wallet";
    updateRouteButtons();
    throw new Error(`This recovery URL belongs to ${routeState.account}, not the connected account.`);
  }
  account = connectedAccount;
  byId("routeConnectBtn").textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
  updateRouteButtons();
}

async function ensureChain(chain) {
  const current = await globalThis.ethereum.request({ method: "eth_chainId" });
  if (current === chain.chainIdHex) return;
  try {
    await globalThis.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
  } catch {
    await globalThis.ethereum.request({ method: "wallet_addEthereumChain", params: [{
      chainId: chain.chainIdHex,
      chainName: chain.name,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: [chain.rpcs[0]],
      blockExplorerUrls: [chain.explorer],
    }] });
  }
}

async function inputDecimals(direction, paymentCurrency) {
  if (direction === "sell" || paymentCurrency === "native") return 18;
  if (!config.usdg) throw new Error("USDG is not configured on this network.");
  const provider = new ethers.JsonRpcProvider(config.robinhood.rpcs[0]);
  return Number(await new ethers.Contract(config.usdg, ERC20_ABI, provider).decimals());
}

async function readInputAmount() {
  const direction = byId("routeDirection").value;
  const paymentCurrency = byId("routeCurrency").value;
  const decimals = await inputDecimals(direction, paymentCurrency);
  let amount;
  try {
    amount = ethers.parseUnits(byId("routeAmount").value || "0", decimals).toString();
  } catch {
    throw new Error("Enter a valid route amount.");
  }
  if (!AMOUNT_PATTERN.test(amount)) throw new Error("Route amount must be greater than zero.");
  return { direction, paymentCurrency, amount };
}

function routeInputAmount() {
  if (routeState.direction === "buy") return routeState.amount;
  if (!routeState.oftOutputAmount) throw new Error("The Base HIVE delivery amount is not confirmed yet.");
  return routeState.oftOutputAmount;
}

async function requestRelayQuote() {
  const amount = routeInputAmount();
  const response = await fetch(`${config.gateway}/v1/routes/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      direction: routeState.direction,
      user: account,
      recipient: account,
      amount,
      paymentCurrency: routeState.paymentCurrency,
    }),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) throw new Error(body?.error || "Relay quote failed.");
  const outputAmount = body?.quote?.details?.currencyOut?.amount;
  if (typeof outputAmount !== "string" || !AMOUNT_PATTERN.test(outputAmount)) {
    throw new Error("Relay quote has no valid canonical output amount.");
  }
  if (!HASH_PATTERN.test(body.requestId)) throw new Error("Relay quote has no valid request id.");
  if (routeState.direction === "buy") await requireOftCapacity(oftLeg(BigInt(outputAmount)));
  relayQuote = body;
  saveState(recordRouteCheckpoint(routeState, {
    kind: "relay-quoted",
    quoteId: body.requestId,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    expectedOutputAmount: outputAmount,
  }));
  const impact = Number(body.totalImpactPercent);
  byId("routeQuoteSummary").textContent = `${routeState.direction === "buy" ? "Expected Base HIVE" : "Expected Robinhood proceeds"}: ${outputAmount} base units · total impact ${impact.toFixed(2)}%${body.priceImpactWarning ? " ⚠" : ""}`;
  return body;
}

function oftLeg(amount) {
  const buy = routeState.direction === "buy";
  return {
    sourceChain: buy ? config.base : config.robinhood,
    destinationChain: buy ? config.robinhood : config.base,
    sourceAddress: buy ? config.adapter : config.oft,
    destinationAddress: buy ? config.oft : config.adapter,
    amount,
    approvalToken: buy ? config.hiveBase : null,
  };
}

function oftSource() {
  const amount = BigInt(routeState.direction === "buy" ? routeState.relayOutputAmount : routeState.amount);
  return oftLeg(amount);
}

async function remainingCapacity(address, chain, keys) {
  const capacities = await Promise.all(chain.rpcs.map(async (rpc) => {
    const provider = new ethers.JsonRpcProvider(rpc);
    const oft = new ethers.Contract(address, OFT_ABI, provider);
    const results = await Promise.all(keys.map((key) => oft.getAmountCanBeSent(key)));
    return results.map(([, amountCanBeSent]) => BigInt(amountCanBeSent));
  }));
  return capacities.flat().reduce((minimum, value) => value < minimum ? value : minimum);
}

async function requireOftCapacity(leg) {
  const destinationEid = BigInt(leg.destinationChain.eid);
  const sourceEid = BigInt(leg.sourceChain.eid);
  const [sourceCapacity, destinationCapacity] = await Promise.all([
    remainingCapacity(leg.sourceAddress, leg.sourceChain, [
      destinationEid,
      destinationEid | OUTBOUND_LONG_FLAG,
    ]),
    remainingCapacity(leg.destinationAddress, leg.destinationChain, [
      sourceEid | INBOUND_FLAG,
      sourceEid | INBOUND_FLAG | OUTBOUND_LONG_FLAG,
    ]),
  ]);
  const capacity = sourceCapacity < destinationCapacity ? sourceCapacity : destinationCapacity;
  if (leg.amount > capacity) {
    throw new Error(
      `Route needs ${ethers.formatEther(leg.amount)} HIVE but only ${ethers.formatEther(capacity)} HIVE of bridge capacity is currently available. No transaction was submitted.`,
    );
  }
  return capacity;
}

async function requestOftQuote() {
  const source = oftSource();
  await requireOftCapacity(source);
  const provider = new ethers.JsonRpcProvider(source.sourceChain.rpcs[0]);
  const oft = new ethers.Contract(source.sourceAddress, OFT_ABI, provider);
  const recipient = ethers.zeroPadValue(account, 32);
  const parameter = [source.destinationChain.eid, recipient, source.amount, 0n, "0x", "0x", "0x"];
  const [, , receipt] = await oft.quoteOFT(parameter);
  const outputAmount = BigInt(receipt[1]);
  const finalParameter = [source.destinationChain.eid, recipient, source.amount, outputAmount, "0x", "0x", "0x"];
  const [nativeFee] = await oft.quoteSend(finalParameter, false);
  oftQuote = { ...source, parameter: finalParameter, outputAmount, nativeFee: BigInt(nativeFee) };
  byId("routeQuoteSummary").textContent = `OFT leg: ${ethers.formatEther(source.amount)} HIVE → ${ethers.formatEther(outputAmount)} HIVE · LayerZero fee ${ethers.formatEther(nativeFee)} ETH`;
  return oftQuote;
}

async function submitRelay() {
  if (!relayQuote || Date.parse(routeState.relayQuoteExpiresAt) <= Date.now()) await requestRelayQuote();
  if (routeState.direction === "buy") {
    await requireOftCapacity(oftLeg(BigInt(routeState.relayExpectedOutputAmount)));
  }
  const origin = routeState.direction === "buy" ? config.robinhood : config.base;
  const transactions = extractRelayTransactions(relayQuote.quote, origin.chainId, account);
  await ensureChain(origin);
  const signer = await new ethers.BrowserProvider(globalThis.ethereum).getSigner();
  for (const transaction of transactions) {
    setRouteStatus(transaction.requestId ? "Confirm the Relay deposit transaction…" : "Confirm the required token approval…");
    const sent = await signer.sendTransaction({ to: transaction.to, data: transaction.data, value: transaction.value });
    if (transaction.requestId) {
      saveState(recordRouteCheckpoint(routeState, {
        kind: "relay-submitted",
        requestId: transaction.requestId,
        txHash: sent.hash,
      }));
    }
    await sent.wait();
  }
}

async function pollRelay() {
  setRouteStatus("Relay transaction submitted. Waiting for destination settlement…");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${config.gateway}/v1/routes/status?requestId=${encodeURIComponent(routeState.relayRequestId)}`);
    const body = await response.json();
    if (!response.ok || body?.ok !== true) throw new Error(body?.error || "Relay status failed.");
    const classification = classifyRelayStatus(body);
    if (classification === "refunded") throw new Error("Relay refunded the route. The route was not completed; do not submit the OFT leg.");
    if (classification === "failed") throw new Error("Relay marked the route failed. Do not resubmit without clearing this recovery receipt.");
    if (classification === "success") {
      const hashes = body?.status?.txHashes;
      if (!Array.isArray(hashes) || hashes.length === 0 || !hashes.every((hash) => HASH_PATTERN.test(hash))) {
        throw new Error("Relay reported success without a valid destination transaction hash.");
      }
      const destinationTxHash = hashes[hashes.length - 1];
      let outputAmount = routeState.relayExpectedOutputAmount;
      if (routeState.direction === "buy") {
        const provider = new ethers.JsonRpcProvider(config.base.rpcs[0]);
        const receipt = await provider.getTransactionReceipt(destinationTxHash);
        if (!receipt || receipt.status !== 1) throw new Error("Relay destination receipt is not successful on Base.");
        outputAmount = extractRecipientTokenTransfers(receipt.logs, config.hiveBase, account).toString();
      }
      saveState(recordRouteCheckpoint(routeState, {
        kind: "relay-settled",
        destinationTxHash,
        outputAmount,
      }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Relay is still pending. Reload this recovery URL and choose Resume route; do not send again.");
}

async function submitOft() {
  const quote = await requestOftQuote();
  await ensureChain(quote.sourceChain);
  const signer = await new ethers.BrowserProvider(globalThis.ethereum).getSigner();
  if (quote.approvalToken) {
    const token = new ethers.Contract(quote.approvalToken, ERC20_ABI, signer);
    const allowance = await token.allowance(account, quote.sourceAddress);
    if (allowance < quote.amount) {
      setRouteStatus("Confirm the exact HIVE approval for the OFT adapter…");
      await (await token.approve(quote.sourceAddress, quote.amount)).wait();
    }
  }
  setRouteStatus("Confirm the LayerZero HIVE bridge transaction…");
  const oft = new ethers.Contract(quote.sourceAddress, OFT_ABI, signer);
  const sent = await oft.send(quote.parameter, [quote.nativeFee, 0n], account, { value: quote.nativeFee });
  saveState(recordRouteCheckpoint(routeState, {
    kind: "oft-submitted",
    txHash: sent.hash,
    outputAmount: quote.outputAmount.toString(),
  }));
  await sent.wait();
}

async function pollOft() {
  setRouteStatus("LayerZero transaction submitted. Waiting for verified delivery…");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${config.lzScanApi}${routeState.oftSourceTxHash}`);
    if (response.ok) {
      const body = await response.json();
      const message = body?.data?.[0];
      const status = message?.status?.name;
      if (status === "FAILED" || status === "BLOCKED") {
        throw new Error(`LayerZero delivery is ${status.toLowerCase()} and remains retryable. Do not re-send.`);
      }
      if (status === "DELIVERED") {
        const destinationTxHash = message?.destination?.tx?.txHash;
        if (!HASH_PATTERN.test(destinationTxHash)) throw new Error("LayerZero delivered without a valid destination transaction hash.");
        saveState(recordRouteCheckpoint(routeState, { kind: "oft-delivered", destinationTxHash }));
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("LayerZero delivery is still unconfirmed. Reload this recovery URL and choose Resume route; do not send again.");
}

async function previewRoute() {
  if (!account) await connectRouteWallet();
  if (!routeState || nextRouteAction(routeState) === "complete") {
    const input = await readInputAmount();
    saveState(createInitialRouteState({ ...input, account }));
  }
  if (routeState.direction === "buy") await requestRelayQuote();
  else await requestOftQuote();
  setRouteStatus("Quote ready. Review it, then choose Run route.", "ok");
  updateRouteButtons();
}

async function runRoute() {
  if (!account) await connectRouteWallet();
  if (!routeState || nextRouteAction(routeState) === "complete") {
    const input = await readInputAmount();
    saveState(createInitialRouteState({ ...input, account }));
  }
  running = true;
  updateRouteButtons();
  try {
    for (let transitions = 0; transitions < 8; transitions += 1) {
      const action = nextRouteAction(routeState);
      if (action === "quote-relay") await requestRelayQuote();
      else if (action === "submit-relay") await submitRelay();
      else if (action === "poll-relay") await pollRelay();
      else if (action === "quote-oft") await submitOft();
      else if (action === "poll-oft") await pollOft();
      else if (action === "complete") {
        setRouteStatus("Route complete. HIVE liquidity was sourced on Base; no Robinhood HIVE pool was required.", "ok");
        return;
      }
    }
    throw new Error("Route stopped after too many state transitions.");
  } finally {
    running = false;
    updateRouteButtons();
  }
}

function directionChanged() {
  const selling = byId("routeDirection").value === "sell";
  byId("routeAmountLabel").textContent = selling ? "HIVE TO SELL" : "PAYMENT AMOUNT";
  byId("routeAmountSymbol").textContent = selling ? "HIVE" : (byId("routeCurrency").value === "usdg" ? "USDG" : "ETH");
}

byId("routeConnectBtn").addEventListener("click", () => connectRouteWallet().catch((error) => setRouteStatus(shortError(error), "err")));
byId("routeQuoteBtn").addEventListener("click", () => previewRoute().catch((error) => setRouteStatus(shortError(error), "err")));
byId("routeRunBtn").addEventListener("click", () => runRoute().catch((error) => setRouteStatus(shortError(error), "err")));
byId("routeClearBtn").addEventListener("click", clearState);
byId("routeDirection").addEventListener("change", directionChanged);
byId("routeCurrency").addEventListener("change", directionChanged);

if (!config.usdg) byId("routeCurrency").querySelector('option[value="usdg"]').disabled = true;
directionChanged();
renderRecovery();
updateRouteButtons();
loadCapabilities();
