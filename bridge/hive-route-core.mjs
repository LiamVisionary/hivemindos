export const HIVE_ROUTE_VERSION = 1;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const AMOUNT_PATTERN = /^[1-9][0-9]{0,77}$/;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DIRECTIONS = new Set(["buy", "sell"]);
const PAYMENT_CURRENCIES = new Set(["native", "usdg"]);
const STATE_KEYS = new Set([
  "version",
  "direction",
  "account",
  "amount",
  "paymentCurrency",
  "relayQuoteId",
  "relayQuoteExpiresAt",
  "relayExpectedOutputAmount",
  "relayRequestId",
  "relaySourceTxHash",
  "relayDestinationTxHash",
  "relayOutputAmount",
  "oftSourceTxHash",
  "oftDestinationTxHash",
  "oftOutputAmount",
]);

export function createInitialRouteState(input) {
  const state = {
    version: HIVE_ROUTE_VERSION,
    direction: input?.direction,
    account: input?.account,
    amount: input?.amount,
    paymentCurrency: input?.paymentCurrency,
  };
  return validateRouteState(state);
}

export function nextRouteAction(stateInput) {
  const state = validateRouteState(stateInput);
  if (state.direction === "buy") {
    if (!state.relayQuoteId && !state.relayRequestId) return "quote-relay";
    if (!state.relayRequestId) return "submit-relay";
    if (!state.relayDestinationTxHash) return "poll-relay";
    if (!state.oftSourceTxHash) return "quote-oft";
    if (!state.oftDestinationTxHash) return "poll-oft";
    return "complete";
  }
  if (!state.oftSourceTxHash) return "quote-oft";
  if (!state.oftDestinationTxHash) return "poll-oft";
  if (!state.relayQuoteId && !state.relayRequestId) return "quote-relay";
  if (!state.relayRequestId) return "submit-relay";
  if (!state.relayDestinationTxHash) return "poll-relay";
  return "complete";
}

export function recordRouteCheckpoint(stateInput, checkpoint) {
  const state = validateRouteState(stateInput);
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw new Error("Invalid route checkpoint.");
  }
  let next;
  switch (checkpoint.kind) {
    case "relay-quoted": {
      if (state.relayRequestId) throw new Error("Relay transaction is already submitted.");
      if (typeof checkpoint.quoteId !== "string" || !checkpoint.quoteId || checkpoint.quoteId.length > 200) {
        throw new Error("Invalid Relay quote id.");
      }
      const expiresAt = parseTimestamp(checkpoint.expiresAt, "Relay quote expiry");
      requireAmount(checkpoint.expectedOutputAmount, "Relay expected output amount");
      next = {
        ...state,
        relayQuoteId: checkpoint.quoteId,
        relayQuoteExpiresAt: expiresAt,
        relayExpectedOutputAmount: checkpoint.expectedOutputAmount,
      };
      break;
    }
    case "relay-submitted": {
      if (state.relayRequestId || state.relaySourceTxHash) throw new Error("Relay transaction is already submitted.");
      requireHash(checkpoint.requestId, "Relay request id");
      requireHash(checkpoint.txHash, "Relay transaction hash");
      next = { ...state, relayRequestId: checkpoint.requestId, relaySourceTxHash: checkpoint.txHash };
      break;
    }
    case "relay-settled": {
      if (!state.relayRequestId) throw new Error("Relay transaction has not been submitted.");
      requireHash(checkpoint.destinationTxHash, "Relay destination transaction hash");
      requireAmount(checkpoint.outputAmount, "Relay output amount");
      next = {
        ...state,
        relayDestinationTxHash: checkpoint.destinationTxHash,
        relayOutputAmount: checkpoint.outputAmount,
      };
      break;
    }
    case "oft-submitted": {
      if (state.oftSourceTxHash) throw new Error("LayerZero transaction is already submitted.");
      requireHash(checkpoint.txHash, "LayerZero transaction hash");
      requireAmount(checkpoint.outputAmount, "LayerZero output amount");
      next = {
        ...state,
        oftSourceTxHash: checkpoint.txHash,
        oftOutputAmount: checkpoint.outputAmount,
      };
      break;
    }
    case "oft-delivered": {
      if (!state.oftSourceTxHash) throw new Error("LayerZero transaction has not been submitted.");
      requireHash(checkpoint.destinationTxHash, "LayerZero destination transaction hash");
      next = { ...state, oftDestinationTxHash: checkpoint.destinationTxHash };
      break;
    }
    default:
      throw new Error("Invalid route checkpoint kind.");
  }
  return validateRouteState(next);
}

export function encodeRouteState(stateInput) {
  const json = JSON.stringify(validateRouteState(stateInput));
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return base64Encode(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function restoreRouteState(encoded) {
  try {
    if (typeof encoded !== "string" || encoded.length < 4 || encoded.length > 4_096 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) {
      throw new Error("malformed");
    }
    const padded = encoded.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = base64Decode(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return validateRouteState(parsed);
  } catch {
    throw new Error("Invalid recovery state.");
  }
}

export function extractRelayTransactions(plan, expectedChainId, account) {
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) throw new Error("Invalid Relay origin chain.");
  if (typeof account !== "string" || !ADDRESS_PATTERN.test(account)) throw new Error("Invalid Relay sender account.");
  if (!plan || typeof plan !== "object" || Array.isArray(plan) || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error("Relay quote has no executable steps.");
  }
  const expectedSender = account.toLowerCase();
  const transactions = [];
  for (const step of plan.steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error("Invalid Relay step.");
    if (step.kind !== "transaction") throw new Error(`Unsupported Relay step kind: ${String(step.kind)}.`);
    if (!Array.isArray(step.items) || step.items.length === 0) throw new Error("Relay transaction step has no items.");
    const requestId = step.requestId === undefined ? null : step.requestId;
    if (requestId !== null && (typeof requestId !== "string" || !HASH_PATTERN.test(requestId))) {
      throw new Error("Invalid Relay request id.");
    }
    const stepTransactions = [];
    for (const item of step.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid Relay transaction item.");
      if (item.status === "complete") continue;
      const data = item.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Relay transaction data is missing.");
      if (typeof data.from !== "string" || data.from.toLowerCase() !== expectedSender) {
        throw new Error("Relay transaction sender does not match the connected account.");
      }
      if (!Number.isSafeInteger(Number(data.chainId)) || Number(data.chainId) !== expectedChainId) {
        throw new Error("Relay transaction chain does not match the expected origin chain.");
      }
      if (typeof data.to !== "string" || !ADDRESS_PATTERN.test(data.to) || /^0x0{40}$/iu.test(data.to)) {
        throw new Error("Relay transaction target is invalid.");
      }
      if (typeof data.value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(data.value)) {
        throw new Error("Relay transaction value is invalid.");
      }
      if (typeof data.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(data.data) || data.data.length > 200_002) {
        throw new Error("Relay transaction calldata is invalid.");
      }
      stepTransactions.push({
        requestId: null,
        to: data.to,
        chainId: expectedChainId,
        value: BigInt(data.value),
        data: data.data,
      });
    }
    if (stepTransactions.length > 0 && requestId) {
      stepTransactions[stepTransactions.length - 1] = {
        ...stepTransactions[stepTransactions.length - 1],
        requestId,
      };
    }
    transactions.push(...stepTransactions);
  }
  if (transactions.length === 0) throw new Error("Relay quote has no incomplete transactions.");
  const requestTransactions = transactions.filter((transaction) => transaction.requestId);
  if (requestTransactions.length === 0) throw new Error("Relay quote has no request id.");
  if (requestTransactions.length !== 1 || transactions[transactions.length - 1].requestId === null) {
    throw new Error("The request-bearing Relay transaction must be last.");
  }
  return transactions;
}

export function classifyRelayStatus(value) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) && value.status
    && typeof value.status === "object" && !Array.isArray(value.status)
    ? value.status.status
    : value?.status;
  if (typeof candidate !== "string") return "unknown";
  const status = candidate.toLowerCase();
  if (["success", "complete", "completed", "delivered", "filled"].includes(status)) return "success";
  if (["refund", "refunded"].includes(status)) return "refunded";
  if (["failure", "failed", "cancelled", "canceled"].includes(status)) return "failed";
  if (["pending", "waiting", "submitted", "delayed", "processing"].includes(status)) return "pending";
  return "unknown";
}

export function extractRecipientTokenTransfers(logs, token, account) {
  if (!Array.isArray(logs)) throw new Error("Invalid transaction receipt logs.");
  if (typeof token !== "string" || !ADDRESS_PATTERN.test(token)) throw new Error("Invalid canonical token address.");
  if (typeof account !== "string" || !ADDRESS_PATTERN.test(account)) throw new Error("Invalid token recipient account.");
  const expectedToken = token.toLowerCase();
  const expectedRecipient = `0x${account.slice(2).toLowerCase().padStart(64, "0")}`;
  let total = 0n;
  for (const log of logs) {
    if (!log || typeof log !== "object" || Array.isArray(log)) continue;
    if (typeof log.address !== "string" || log.address.toLowerCase() !== expectedToken) continue;
    if (!Array.isArray(log.topics) || String(log.topics[0]).toLowerCase() !== TRANSFER_TOPIC) continue;
    if (String(log.topics[2]).toLowerCase() !== expectedRecipient) continue;
    if (typeof log.data !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(log.data)) {
      throw new Error("Invalid transfer log for the canonical token.");
    }
    total += BigInt(log.data);
  }
  if (total <= 0n) throw new Error("No canonical token transfer to the route recipient was found.");
  return total;
}

function validateRouteState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid route state.");
  for (const key of Object.keys(value)) {
    if (!STATE_KEYS.has(key)) throw new Error(`Invalid route state field: ${key}.`);
  }
  if (value.version !== HIVE_ROUTE_VERSION) throw new Error("Unsupported route state version.");
  if (!DIRECTIONS.has(value.direction)) throw new Error("Invalid route direction.");
  if (typeof value.account !== "string" || !ADDRESS_PATTERN.test(value.account)) throw new Error("Invalid route account.");
  if (typeof value.amount !== "string" || !AMOUNT_PATTERN.test(value.amount)) throw new Error("Invalid route amount.");
  if (!PAYMENT_CURRENCIES.has(value.paymentCurrency)) throw new Error("Invalid payment currency.");
  optionalString(value.relayQuoteId, 200, "Relay quote id");
  if (value.relayQuoteExpiresAt !== undefined) parseTimestamp(value.relayQuoteExpiresAt, "Relay quote expiry");
  for (const [field, label] of [
    ["relayExpectedOutputAmount", "Relay expected output amount"],
    ["relayOutputAmount", "Relay output amount"],
    ["oftOutputAmount", "LayerZero output amount"],
  ]) {
    if (value[field] !== undefined) requireAmount(value[field], label);
  }
  for (const [field, label] of [
    ["relayRequestId", "Relay request id"],
    ["relaySourceTxHash", "Relay source transaction hash"],
    ["relayDestinationTxHash", "Relay destination transaction hash"],
    ["oftSourceTxHash", "LayerZero source transaction hash"],
    ["oftDestinationTxHash", "LayerZero destination transaction hash"],
  ]) {
    if (value[field] !== undefined) requireHash(value[field], label);
  }
  if (value.relaySourceTxHash && !value.relayRequestId) throw new Error("Invalid recovery state: Relay hash has no request id.");
  if (value.relayDestinationTxHash && !value.relaySourceTxHash) throw new Error("Invalid recovery state: Relay delivery has no source hash.");
  if (value.relayDestinationTxHash && !value.relayOutputAmount) throw new Error("Invalid recovery state: Relay delivery has no output amount.");
  if (value.relayQuoteId && !value.relayExpectedOutputAmount) throw new Error("Invalid recovery state: Relay quote has no output amount.");
  if (value.oftDestinationTxHash && !value.oftSourceTxHash) throw new Error("Invalid recovery state: LayerZero delivery has no source hash.");
  if (value.oftSourceTxHash && !value.oftOutputAmount) throw new Error("Invalid recovery state: LayerZero transaction has no output amount.");
  return Object.freeze({ ...value });
}

function requireHash(value, label) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
}

function requireAmount(value, label) {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
}

function optionalString(value, maxLength, label) {
  if (value !== undefined && (typeof value !== "string" || !value || value.length > maxLength)) {
    throw new Error(`Invalid ${label}.`);
  }
}

function parseTimestamp(value, label) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid ${label}.`);
  }
  return new Date(value).toISOString();
}

function base64Encode(value) {
  if (typeof btoa === "function") return btoa(value);
  return Buffer.from(value, "binary").toString("base64");
}

function base64Decode(value) {
  if (typeof atob === "function") return atob(value);
  return Buffer.from(value, "base64").toString("binary");
}
