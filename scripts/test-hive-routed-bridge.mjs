import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  HIVE_ROUTE_VERSION,
  createInitialRouteState,
  classifyRelayStatus,
  extractRecipientTokenTransfers,
  extractRelayTransactions,
  nextRouteAction,
  recordRouteCheckpoint,
  restoreRouteState,
} from "../bridge/hive-route-core.mjs";

test("buy checkpoints never resubmit an ambiguous Relay or LayerZero transaction", () => {
  let state = createInitialRouteState({
    direction: "buy",
    account: "0x000000000000000000000000000000000000dEaD",
    amount: "1000000000000000",
    paymentCurrency: "native",
  });
  assert.equal(nextRouteAction(state), "quote-relay");

  state = recordRouteCheckpoint(state, {
    kind: "relay-quoted",
    quoteId: "quote-1",
    expiresAt: "2026-07-20T21:00:00.000Z",
    expectedOutputAmount: "995000000000000000000",
  });
  assert.equal(nextRouteAction(state), "submit-relay");

  state = recordRouteCheckpoint(state, {
    kind: "relay-submitted",
    requestId: `0x${"1".repeat(64)}`,
    txHash: `0x${"2".repeat(64)}`,
  });
  assert.equal(nextRouteAction(state), "poll-relay");
  assert.throws(
    () => recordRouteCheckpoint(state, {
      kind: "relay-submitted",
      requestId: `0x${"3".repeat(64)}`,
      txHash: `0x${"4".repeat(64)}`,
    }),
    /already submitted/i,
  );

  state = recordRouteCheckpoint(state, {
    kind: "relay-settled",
    destinationTxHash: `0x${"5".repeat(64)}`,
    outputAmount: "994000000000000000000",
  });
  assert.equal(state.relayOutputAmount, "994000000000000000000");
  assert.equal(nextRouteAction(state), "quote-oft");
  state = recordRouteCheckpoint(state, {
    kind: "oft-submitted",
    txHash: `0x${"6".repeat(64)}`,
    outputAmount: "993503000000000000000",
  });
  assert.equal(state.oftOutputAmount, "993503000000000000000");
  assert.equal(nextRouteAction(state), "poll-oft");
  assert.throws(
    () => recordRouteCheckpoint(state, {
      kind: "oft-submitted",
      txHash: `0x${"7".repeat(64)}`,
      outputAmount: "993503000000000000000",
    }),
    /already submitted/i,
  );
});

test("Relay execution accepts only account-bound transactions on the expected origin chain", () => {
  const account = "0x000000000000000000000000000000000000dEaD";
  const requestId = `0x${"a".repeat(64)}`;
  const plan = {
    steps: [{
      kind: "transaction",
      requestId,
      items: [{ status: "incomplete", data: {
        from: account,
        to: "0x1111111111111111111111111111111111111111",
        chainId: 4663,
        value: "1000",
        data: "0x1234",
      } }],
    }],
  };
  assert.deepEqual(extractRelayTransactions(plan, 4663, account), [{
    requestId,
    to: "0x1111111111111111111111111111111111111111",
    chainId: 4663,
    value: 1000n,
    data: "0x1234",
  }]);

  assert.throws(() => extractRelayTransactions({ steps: [{ ...plan.steps[0], kind: "signature" }] }, 4663, account), /unsupported Relay step/i);
  assert.throws(() => extractRelayTransactions({ steps: [{ ...plan.steps[0], items: [{ status: "incomplete", data: { ...plan.steps[0].items[0].data, chainId: 8453 } }] }] }, 4663, account), /chain/i);
  assert.throws(() => extractRelayTransactions({ steps: [{ ...plan.steps[0], items: [{ status: "incomplete", data: { ...plan.steps[0].items[0].data, from: "0x2222222222222222222222222222222222222222" } }] }] }, 4663, account), /sender/i);
  assert.throws(() => extractRelayTransactions({ steps: [{ ...plan.steps[0], items: [{ status: "incomplete", data: { ...plan.steps[0].items[0].data, value: "-1" } }] }] }, 4663, account), /value/i);

  const approvalThenDeposit = {
    steps: [{
      kind: "transaction",
      items: [
        { status: "incomplete", data: { ...plan.steps[0].items[0].data, value: "0" } },
        { status: "incomplete", data: { ...plan.steps[0].items[0].data, value: "0" } },
      ],
      requestId,
    }],
  };
  assert.equal(extractRelayTransactions(approvalThenDeposit, 4663, account).length, 2);
  assert.throws(
    () => extractRelayTransactions({ steps: [{ ...approvalThenDeposit.steps[0], items: approvalThenDeposit.steps[0].items.slice().reverse() }, {
      kind: "transaction",
      requestId: null,
      items: [{ status: "incomplete", data: { ...plan.steps[0].items[0].data, value: "0" } }],
    }] }, 4663, account),
    /request-bearing Relay transaction must be last/i,
  );
});

test("Relay status classification distinguishes success, refund, hard failure, and pending", () => {
  assert.equal(classifyRelayStatus({ status: "success" }), "success");
  assert.equal(classifyRelayStatus({ status: "refund" }), "refunded");
  assert.equal(classifyRelayStatus({ status: "failure" }), "failed");
  assert.equal(classifyRelayStatus({ status: "pending" }), "pending");
  assert.equal(classifyRelayStatus({ status: "waiting" }), "pending");
  assert.equal(classifyRelayStatus({}), "unknown");
});

test("buy output is derived from canonical HIVE Transfer logs to the recipient", () => {
  const token = "0x1111111111111111111111111111111111111111";
  const account = "0x000000000000000000000000000000000000dEaD";
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const recipientTopic = `0x${account.slice(2).toLowerCase().padStart(64, "0")}`;
  const otherRecipient = `0x${"2".repeat(64)}`;
  const encodeAmount = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
  const logs = [
    { address: token, topics: [transferTopic, `0x${"1".repeat(64)}`, recipientTopic], data: encodeAmount(900n) },
    { address: `0x${token.slice(2).toUpperCase()}`, topics: [transferTopic, `0x${"3".repeat(64)}`, recipientTopic], data: encodeAmount(25n) },
    { address: token, topics: [transferTopic, `0x${"4".repeat(64)}`, otherRecipient], data: encodeAmount(1000n) },
    { address: "0x2222222222222222222222222222222222222222", topics: [transferTopic, `0x${"5".repeat(64)}`, recipientTopic], data: encodeAmount(1000n) },
  ];
  assert.equal(extractRecipientTokenTransfers(logs, token, account), 925n);
  assert.throws(() => extractRecipientTokenTransfers([], token, account), /no canonical token transfer/i);
  assert.throws(
    () => extractRecipientTokenTransfers([{ address: token, topics: [transferTopic, `0x${"1".repeat(64)}`, recipientTopic], data: "0x01" }], token, account),
    /invalid transfer log/i,
  );
});

test("sell starts with OFT and only requests Relay after Base delivery", () => {
  let state = createInitialRouteState({
    direction: "sell",
    account: "0x000000000000000000000000000000000000dEaD",
    amount: "1000000000000000000",
    paymentCurrency: "native",
  });
  assert.equal(nextRouteAction(state), "quote-oft");
  state = recordRouteCheckpoint(state, {
    kind: "oft-submitted",
    txHash: `0x${"8".repeat(64)}`,
    outputAmount: "999500000000000000",
  });
  assert.equal(nextRouteAction(state), "poll-oft");
  state = recordRouteCheckpoint(state, { kind: "oft-delivered", destinationTxHash: `0x${"9".repeat(64)}` });
  assert.equal(state.oftOutputAmount, "999500000000000000");
  assert.equal(nextRouteAction(state), "quote-relay");
});

test("cross-leg output amounts are mandatory positive integers", () => {
  let buy = createInitialRouteState({
    direction: "buy",
    account: "0x000000000000000000000000000000000000dEaD",
    amount: "1000000000000000",
    paymentCurrency: "native",
  });
  assert.throws(() => recordRouteCheckpoint(buy, {
    kind: "relay-quoted",
    quoteId: "quote-1",
    expiresAt: "2026-07-20T21:00:00.000Z",
  }), /output amount/i);
  buy = recordRouteCheckpoint(buy, {
    kind: "relay-quoted",
    quoteId: "quote-1",
    expiresAt: "2026-07-20T21:00:00.000Z",
    expectedOutputAmount: "900",
  });
  buy = recordRouteCheckpoint(buy, {
    kind: "relay-submitted",
    requestId: `0x${"a".repeat(64)}`,
    txHash: `0x${"b".repeat(64)}`,
  });
  assert.throws(() => recordRouteCheckpoint(buy, {
    kind: "relay-settled",
    destinationTxHash: `0x${"c".repeat(64)}`,
    outputAmount: "0",
  }), /output amount/i);

  const sell = createInitialRouteState({
    direction: "sell",
    account: "0x000000000000000000000000000000000000dEaD",
    amount: "1000",
    paymentCurrency: "native",
  });
  assert.throws(() => recordRouteCheckpoint(sell, {
    kind: "oft-submitted",
    txHash: `0x${"d".repeat(64)}`,
  }), /output amount/i);
});

test("public URL recovery state is bounded, versioned, and rejects malformed hashes", () => {
  const original = createInitialRouteState({
    direction: "buy",
    account: "0x000000000000000000000000000000000000dEaD",
    amount: "1000000000000000",
    paymentCurrency: "usdg",
  });
  const encoded = Buffer.from(JSON.stringify(original)).toString("base64url");
  const restored = restoreRouteState(encoded);
  assert.equal(restored.version, HIVE_ROUTE_VERSION);
  assert.equal(restored.paymentCurrency, "usdg");
  assert.throws(() => restoreRouteState("not-json"), /invalid recovery state/i);
  assert.throws(
    () => restoreRouteState(Buffer.from(JSON.stringify({ ...original, relayTxHash: "0x1234" })).toString("base64url")),
    /invalid recovery state/i,
  );
});

test("bridge page exposes the governed testnet deployment and routed state machine", () => {
  const html = readFileSync(new URL("../bridge/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../bridge/hive-route-app.mjs", import.meta.url), "utf8");
  const surface = `${html}\n${app}`;

  for (const id of [
    "routeCapability",
    "routeConnectBtn",
    "routeDirection",
    "routeCurrency",
    "routeAmount",
    "routeQuoteBtn",
    "routeRunBtn",
    "routeClearBtn",
    "routeQuoteSummary",
    "routeRecovery",
    "routeStatus",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, "u"), `missing routed bridge control ${id}`);
  }

  assert.match(html, /hive-route-app\.mjs/u);
  assert.match(html, /0x827781443C4B19c317bbA59b441EdEcCFa2cD23b/u);
  assert.match(html, /0xA131dB107711D5DC6743DFF002eACdDCA1f0946d/u);
  assert.match(html, /chainId:\s*46630/u);
  assert.match(html, /hivemindos-hive-bridge-gateway-testnet\.hivemindos\.workers\.dev/u);
  assert.match(html, /mainnet:[\s\S]*?deployed:\s*true/u);
  assert.match(html, /mainnet:[\s\S]*?adapter:\s*"0x9e365A3aA8A6Dc4Be95A6900E1dB8Fadd2f221Ce"/u);
  assert.match(html, /mainnet:[\s\S]*?oft:\s*"0x26c7121e41e779327Adbd5682646dC5deb764539"/u);
  assert.match(html, /location\.hostname\.includes\("testnet"\)/u);
  assert.doesNotMatch(surface, /localStorage|sessionStorage|indexedDB/u);
});

test("routed bridge keeps sell proceeds selectable and fails closed on recovery-account mismatch", () => {
  const app = readFileSync(new URL("../bridge/hive-route-app.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(app, /routeCurrency["']\)\.disabled\s*=\s*selling/u);
  assert.match(app, /account\s*=\s*null;[\s\S]{0,240}recovery URL belongs/u);
});

test("routed buying preflights both LayerZero directions before Relay can take funds", () => {
  const app = readFileSync(new URL("../bridge/hive-route-app.mjs", import.meta.url), "utf8");

  assert.match(app, /function getAmountCanBeSent\(uint32\)/u);
  assert.match(app, /sourceEid \| INBOUND_FLAG/u);
  assert.match(app, /destinationEid \| OUTBOUND_LONG_FLAG/u);
  assert.match(
    app,
    /async function submitRelay\(\)[\s\S]*?await requireOftCapacity\(oftLeg\(BigInt\(routeState\.relayExpectedOutputAmount\)\)\);[\s\S]*?extractRelayTransactions/u,
  );
  assert.match(app, /No transaction was submitted\./u);
});

test("same-day mainnet deployment uses public routed capacity, not canary capacity", () => {
  const deployment = readFileSync(
    new URL("../contracts/script/DeployAndBootstrapHiveMainnet.s.sol", import.meta.url),
    "utf8",
  );

  assert.match(deployment, /PUBLIC_HOURLY_LIMIT\s*=\s*5_000_000_000 ether/u);
  assert.match(deployment, /PUBLIC_DAILY_LIMIT\s*=\s*10_000_000_000 ether/u);
  assert.doesNotMatch(deployment, /CANARY_(?:HOURLY|DAILY)_LIMIT/u);
});

test("replacement launcher pins the unlocked keystore sender and funds Robinhood gas safely", () => {
  const launcher = readFileSync(
    new URL("./deploy-hive-mainnet-replacement.sh", import.meta.url),
    "utf8",
  );

  assert.match(launcher, /DEPLOYER="0x0c9ed3fa03490dffba59c2b9c94a12f46efbb22c"/u);
  assert.equal((launcher.match(/--sender "\$DEPLOYER"/gu) ?? []).length, 2);
  assert.match(launcher, /ROBINHOOD_MAINNET_ARCHIVE_RPC_URL/u);
  assert.match(launcher, /robinhood-mainnet\/base-mainnet/u);
  assert.doesNotMatch(launcher, /mainnet\.base\.org|base\.drpc\.org/u);
  assert.doesNotMatch(launcher, /base-rpc\.publicnode\.com/u);
  assert.match(launcher, /ROBINHOOD_FUNDING_AMOUNT_WEI="2500000000000000"/u);
  assert.match(launcher, /BASE_FUNDING_NONCE="12"/u);
  assert.match(launcher, /refusing to submit another/u);
  assert.match(launcher, /transaction_chain" != "8453"/u);
  assert.doesNotMatch(launcher, /\$\{[^}]+,,\}/u);
});

test("replacement canary is resumable and reconciles exact backing", () => {
  const canary = readFileSync(
    new URL("./canary-hive-mainnet-replacement.sh", import.meta.url),
    "utf8",
  );

  assert.match(canary, /CANARY_BUY_WEI="50000000000000"/u);
  assert.match(canary, /BASE_SWAP_NONCE="13"/u);
  assert.match(canary, /FINAL_BASE_LOCKED_WEI="1000000000000000"/u);
  assert.match(canary, /FINAL_REMOTE_SUPPLY_WEI="500000000000000"/u);
  assert.match(canary, /refusing to submit another buy/u);
  assert.match(canary, /Robinhood return was already submitted; waiting without resubmitting\./u);
  assert.match(canary, /ROBINHOOD_MAINNET_ARCHIVE_RPC_URL/u);
  assert.match(canary, /robinhood-mainnet\/base-mainnet/u);
  assert.doesNotMatch(canary, /mainnet\.base\.org|base\.drpc\.org|base-rpc\.publicnode\.com/u);
});
