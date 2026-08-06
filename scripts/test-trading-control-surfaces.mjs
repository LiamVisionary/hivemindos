#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [view, workspace, ticket, route, stockRoute, swapRoute, docs] = await Promise.all([
  read("src/components/trade/TradeView.tsx"),
  read("src/components/trade/TradingWorkspace.tsx"),
  read("src/components/trade/StockTicket.tsx"),
  read("src/app/api/trading/control/route.ts"),
  read("src/app/api/trading/route.ts"),
  read("src/app/api/trading/swap/route.ts"),
  read("docs/for-users/trading/index.md"),
]);

for (const label of ["Trade", "Research", "Portfolio", "Plans", "Activity", "Automations"]) {
  assert.match(workspace, new RegExp(`>${label}<|\"${label}\"`), `missing ${label} workspace destination`);
}
assert.match(view, /TradingLifecycleProvider/, "the Trade route should provide one lifecycle across tickets and workspace views");
assert.match(view, /ExecutionModeControl/, "execution mode must remain visible in the Trade header");
assert.match(workspace, /<details[\s\S]*Advanced risk policy/, "advanced risk configuration should be collapsed by default");
assert.match(ticket, /<details[\s\S]*Advanced order/, "advanced stock order controls should be collapsed by default");
assert.match(workspace, /aria-label="Trading workspace"/, "workspace navigation needs an accessible name");
assert.match(route, /requireAuth\(request\)/, "the control API must authenticate before reading or mutating trading state");
assert.match(route, /okJson|errorJson/, "the control API must use the canonical response envelope");
assert.match(stockRoute, /assertTradingLiveMode\(\{ planId \}\)/, "live stock execution must honor the global mode and plan requirement");
assert.match(stockRoute, /assertTradePlanExecutable/, "live stock execution must bind to the exact reviewed plan");
assert.match(swapRoute, /assertTradingLiveMode\(\{ planId \}\)/, "live DEX execution must honor the global mode and plan requirement");
assert.doesNotMatch(workspace, /localStorage|sessionStorage|indexedDB/i, "durable trading state must stay server-owned");
assert.match(docs, /Research-only[\s\S]*Paper[\s\S]*Live/i, "public trading docs should explain the three execution modes");
assert.match(docs, /Trade Plans/i, "public trading docs should explain the plan review lifecycle");

console.log("Trading control surface checks passed.");
