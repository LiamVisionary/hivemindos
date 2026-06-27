#!/usr/bin/env node
// Validates the ClawBank Hive action registry + MCP server wiring stay
// consistent: metadata gates, MCP exposure, route registration, confirmation
// tokens, and execution-preflight coverage.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { listHiveActions, listMcpHiveActions } = await import("../src/lib/services/hive-actions/index.ts");
const { CLAWBANK_CONFIRM } = await import("../src/lib/services/clawbank/index.ts");

const actions = listHiveActions();
const byTool = new Map(actions.filter((a) => a.mcp?.toolName).map((a) => [a.mcp.toolName, a]));

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const READ_TOOLS = {
  clawbank_status: "/api/clawbank",
  clawbank_list_tools: "/api/clawbank/run",
  clawbank_read: "/api/clawbank/run",
};
const WRITE_TOOLS = {
  clawbank_send_usdc: { route: "/api/clawbank/wallet", token: CLAWBANK_CONFIRM.SEND_USDC },
  clawbank_trade: { route: "/api/clawbank/trading", token: CLAWBANK_CONFIRM.SWAP },
  clawbank_money_transfer: { route: "/api/clawbank/money", token: CLAWBANK_CONFIRM.MONEY_TRANSFER },
  clawbank_call: { route: "/api/clawbank/run", token: CLAWBANK_CONFIRM.CALL },
};

// --- all expected tools exist --------------------------------------------
for (const tool of [...Object.keys(READ_TOOLS), ...Object.keys(WRITE_TOOLS)]) {
  assert.ok(byTool.has(tool), `Hive action ${tool} is missing from the registry`);
}
ok("all 7 clawbank_* Hive actions are registered");

// --- read tools: read-only, no money side effects, correct route ---------
for (const [tool, route] of Object.entries(READ_TOOLS)) {
  const action = byTool.get(tool);
  assert.equal(action.readOnly, true, `${tool} must be readOnly`);
  assert.ok(!action.sideEffects.includes("wallet") && !action.sideEffects.includes("payment"), `${tool} must not move money`);
  assert.ok(!action.confirmation, `${tool} must not require confirmation`);
  assert.equal(action.contextIndex?.route, route, `${tool} route mismatch`);
}
ok("read tools are readOnly, non-money, route-correct");

// --- write tools: critical wallet+payment + confirmation token + route ----
for (const [tool, expect] of Object.entries(WRITE_TOOLS)) {
  const action = byTool.get(tool);
  assert.equal(action.risk, "critical", `${tool} must be critical risk`);
  assert.ok(action.sideEffects.includes("wallet") && action.sideEffects.includes("payment"), `${tool} must have wallet+payment side effects`);
  assert.ok(action.confirmation && action.confirmation.token === expect.token, `${tool} must require ${expect.token}`);
  assert.notEqual(action.readOnly, true, `${tool} must not be readOnly`);
  assert.equal(action.contextIndex?.route, expect.route, `${tool} route mismatch`);
}
ok("write tools are critical wallet+payment with the right confirmation token + route");

// --- MCP export includes every clawbank tool ------------------------------
const mcpNames = new Set(listMcpHiveActions(actions).map((t) => t.name));
for (const tool of [...Object.keys(READ_TOOLS), ...Object.keys(WRITE_TOOLS)]) {
  assert.ok(mcpNames.has(tool), `${tool} is not exposed via listMcpHiveActions`);
}
ok("every clawbank_* tool is exposed in the MCP catalog");

// --- MCP server (scripts/hivemind-mcp) wiring -----------------------------
const mcpSource = readFileSync(new URL("./hivemind-mcp", import.meta.url), "utf8");
for (const tool of [...Object.keys(READ_TOOLS), ...Object.keys(WRITE_TOOLS)]) {
  assert.ok(mcpSource.includes(`name === "${tool}"`), `scripts/hivemind-mcp has no callTool handler for ${tool}`);
}
for (const tool of Object.keys(WRITE_TOOLS)) {
  // Each write tool must be in EXECUTION_TOOL_NAMES (preflight confirmation gate).
  const execLine = mcpSource.match(/const EXECUTION_TOOL_NAMES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(execLine && execLine[1].includes(`"${tool}"`), `${tool} missing from EXECUTION_TOOL_NAMES`);
}
ok("scripts/hivemind-mcp has handlers for all tools + execution gate for writes");

console.log(`\nclawbank-actions: ${passed} checks passed`);
