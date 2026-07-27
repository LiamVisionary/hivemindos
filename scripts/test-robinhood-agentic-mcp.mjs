import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildRobinhoodEquityOrderArgs } from "../src/lib/services/trading/robinhood-agentic-order.ts";

const flatSchema = {
  type: "object",
  properties: {
    account_number: { type: "string" },
    symbol: { type: "string" },
    side: { type: "string" },
    order_type: { type: "string" },
    time_in_force: { type: "string" },
    notional: { type: "number" },
    quantity: { type: "number" },
  },
  required: ["account_number", "symbol", "side", "order_type", "time_in_force", "notional"],
};

assert.deepEqual(buildRobinhoodEquityOrderArgs(flatSchema, {
  accountId: "agentic-123",
  ticker: "AAPL",
  side: "buy",
  notionalUsd: 25,
}), {
  account_number: "agentic-123",
  symbol: "AAPL",
  side: "buy",
  order_type: "market",
  time_in_force: "day",
  notional: 25,
});

const nested = buildRobinhoodEquityOrderArgs({
  type: "object",
  properties: {
    accountId: { type: "string" },
    order: {
      type: "object",
      properties: {
        ticker: { type: "string" },
        direction: { type: "string" },
        type: { type: "string" },
        tif: { type: "string" },
        qty: { type: "number" },
      },
      required: ["ticker", "direction", "type", "tif", "qty"],
    },
  },
  required: ["accountId", "order"],
}, {
  accountId: "agentic-456",
  ticker: "MSFT",
  side: "sell",
  notionalUsd: 100,
  qty: 2,
});
assert.deepEqual(nested, {
  accountId: "agentic-456",
  order: { ticker: "MSFT", direction: "sell", type: "market", tif: "day", qty: 2 },
});

assert.throws(() => buildRobinhoodEquityOrderArgs({
  type: "object",
  properties: { symbol: { type: "string" }, custom_required_field: { type: "string" } },
  required: ["symbol", "custom_required_field"],
}, { ticker: "NVDA", side: "buy", notionalUsd: 10 }), /could not safely derive: custom_required_field/);

const [service, route, trade, proxy, catalog, panel, actionCatalog, actionDefinition, mcpScript] = await Promise.all([
  readFile(new URL("../src/lib/services/trading/robinhood-agentic.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/integrations/robinhood-mcp/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/services/trading/buy-stock.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/services/mcp/catalog.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/features/integrations/RobinhoodMcpPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/services/hive-actions/catalog.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/services/hive-actions/robinhood-agentic.ts", import.meta.url), "utf8"),
  readFile(new URL("./hivemind-mcp", import.meta.url), "utf8"),
]);

assert.match(service, /ROBINHOOD_AGENTIC_READ_TOOLS/);
assert.match(service, /review_equity_order/);
assert.match(service, /place_equity_order/);
assert.match(service, /ROBINHOOD_AGENTIC_TRADE_TOOLS/);
assert.match(route, /body\.action === "read" \|\| body\.tool/);
assert.doesNotMatch(route, /place_equity_order|cancel_equity_order/);
assert.match(trade, /executeRobinhoodAgenticTrade/);
assert.match(trade, /resolveSpendGovernance/);
assert.match(trade, /stockTradeConfirmation/);
assert.match(proxy, /robinhood-mcp\/callback/);
assert.match(catalog, /id: "robinhood-trading"/);
assert.match(panel, /Robinhood review · HivemindOS confirmation|HivemindOS caps and explicit confirmation/);
assert.match(actionCatalog, /robinhoodAgenticReadAction/);
assert.match(actionDefinition, /toolName: "robinhood_agentic_read"/);
assert.match(mcpScript, /name === "robinhood_agentic_read"/);

console.log("PASS: Robinhood Agentic MCP OAuth, read allowlist, schema adapter, and governed trade wiring are present.");
