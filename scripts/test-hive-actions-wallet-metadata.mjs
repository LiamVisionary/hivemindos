#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  listHiveActions,
  listMcpHiveActions,
} = await import("../src/lib/services/hive-actions/index.ts");

const actions = listHiveActions();
const byToolName = new Map(actions.map((action) => [
  action.mcp?.toolName ?? action.id.replace(/[^A-Za-z0-9]+/g, "_"),
  action,
]));
const mcpByName = new Map(listMcpHiveActions(actions).map((tool) => [tool.name, tool]));

const prepare = byToolName.get("prepare_crypto_action");
assert.ok(prepare, "prepare_crypto_action should be registered");
assert.equal(prepare.readOnly, true);
assert.equal(prepare.risk, "medium");
assert.equal(prepare.sideEffects.includes("wallet"), false);
assert.equal(prepare.sideEffects.includes("payment"), false);
assert.equal(mcpByName.get("prepare_crypto_action")?.annotations.readOnlyHint, true);
assert.equal(mcpByName.get("prepare_crypto_action")?.annotations.destructiveHint, false);

const expectedExecutions = [
  { tool: "send_usdc", token: "SEND_USDC", route: "/api/wallet/send" },
  { tool: "dex_swap", token: "CONFIRM_SWAP", route: "/api/trading/swap" },
  { tool: "stock_trade", tokens: ["CONFIRM_BUY", "CONFIRM_SELL"], route: "/api/trading" },
];

for (const expected of expectedExecutions) {
  const action = byToolName.get(expected.tool);
  assert.ok(action, `${expected.tool} should be registered`);
  assert.equal(action.readOnly, undefined, `${expected.tool} should not be read-only`);
  assert.equal(action.risk, "critical", `${expected.tool} should be critical risk`);
  assert.ok(action.sideEffects.includes("wallet"), `${expected.tool} should include wallet side effect`);
  assert.ok(action.sideEffects.includes("payment"), `${expected.tool} should include payment side effect`);
  assert.ok(action.sideEffects.includes("network"), `${expected.tool} should include network side effect`);
  assert.equal(action.contextIndex?.route, expected.route, `${expected.tool} should point at the execution route`);
  assert.ok(action.confirmation, `${expected.tool} should declare confirmation metadata`);
  if ("token" in expected) {
    assert.equal(action.confirmation.token, expected.token, `${expected.tool} token mismatch`);
  }
  if ("tokens" in expected) {
    assert.deepEqual(action.confirmation.tokens, expected.tokens, `${expected.tool} tokens mismatch`);
  }

  const descriptor = mcpByName.get(expected.tool);
  assert.ok(descriptor, `${expected.tool} should be exported to MCP metadata`);
  assert.equal(descriptor.annotations.readOnlyHint, false, `${expected.tool} MCP readOnlyHint`);
  assert.equal(descriptor.annotations.destructiveHint, true, `${expected.tool} MCP destructiveHint`);
  assert.equal(descriptor.annotations.openWorldHint, true, `${expected.tool} MCP openWorldHint`);
  assert.equal(descriptor.annotations["hivemindos/risk"], "critical", `${expected.tool} MCP risk`);
  assert.ok(descriptor.annotations["hivemindos/sideEffects"].includes("wallet"));
  assert.ok(descriptor.annotations["hivemindos/sideEffects"].includes("payment"));
  assert.deepEqual(
    descriptor.annotations["hivemindos/confirmation"],
    action.confirmation,
    `${expected.tool} MCP confirmation metadata`,
  );
}

console.log("Hive action wallet metadata tests passed.");
