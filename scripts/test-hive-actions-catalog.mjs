#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  listHiveActions,
  listMcpHiveActions,
} = await import("../src/lib/services/hive-actions/index.ts");

const actions = listHiveActions();
assert.ok(actions.length >= 8, "expected initial read-only Hive action catalog");

const ids = new Set();
const toolNames = new Set();

for (const action of actions) {
  assert.ok(action.id, "action id required");
  assert.ok(!ids.has(action.id), `duplicate action id ${action.id}`);
  ids.add(action.id);
  assert.ok(action.title, `${action.id} title required`);
  assert.ok(action.description, `${action.id} description required`);
  assert.ok(action.tags.length > 0, `${action.id} tags required`);
  assert.ok(action.contextIndex?.summary, `${action.id} context-index summary required`);
  assert.ok(action.contextIndex?.retrievalText, `${action.id} retrieval text required`);

  const mcp = action.mcp?.toolName ?? action.id.replace(/[^A-Za-z0-9]+/g, "_");
  assert.ok(!toolNames.has(mcp), `duplicate MCP tool name ${mcp}`);
  toolNames.add(mcp);

  if (action.sideEffects.includes("wallet") || action.sideEffects.includes("payment")) {
    assert.ok(action.confirmation, `${action.id} money action needs confirmation`);
  } else {
    assert.notEqual(action.risk, "critical", `${action.id} should not be critical`);
  }
}

const exposed = listMcpHiveActions(actions);
assert.ok(exposed.some((tool) => tool.name === "crypto_capabilities"));
const actionsByMcpName = new Map(actions.map((action) => [
  action.mcp?.toolName ?? action.id.replace(/[^A-Za-z0-9]+/g, "_"),
  action,
]));
for (const tool of exposed) {
  const action = actionsByMcpName.get(tool.name);
  assert.ok(action, `${tool.name} should map back to an action`);
  if (action.readOnly) {
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be read-only`);
    assert.equal(tool.annotations.destructiveHint, false, `${tool.name} should be non-destructive`);
  }
  if (action.sideEffects.includes("wallet") || action.sideEffects.includes("payment")) {
    assert.equal(tool.annotations.destructiveHint, true, `${tool.name} money action should be destructive`);
  }
}

console.log("Hive action catalog tests passed.");
