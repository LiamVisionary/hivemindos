#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const repoRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, repoRoot), "utf8");
}

async function assertFile(path) {
  const info = await stat(new URL(path, repoRoot));
  assert.equal(info.isFile(), true, `${path} should exist`);
}

function assertIncludes(text, needle, label) {
  assert.ok(text.includes(needle), `${label} should include ${needle}`);
}

const nansen = await import("../src/lib/services/nansen.ts");
assert.equal(nansen.NANSEN_API_KEY_ENV, "NANSEN_API_KEY");
assert.equal(nansen.NANSEN_API_BASE_URL, "https://api.nansen.ai");
assert.equal(nansen.NANSEN_MCP_URL, "https://mcp.nansen.ai/ra/mcp");
assert.equal(nansen.NANSEN_MANAGED_CREDIT_SLUG, "default");
assert.equal(nansen.NANSEN_ENDPOINTS.portfolioDefiHoldings.path, "/api/v1/portfolio/defi-holdings");
assert.equal(nansen.NANSEN_ENDPOINTS.tokenFlowIntelligence.path, "/api/v1/tgm/flow-intelligence");
assert.equal(nansen.NANSEN_ENDPOINTS.smartMoneyNetflow.path, "/api/v1/smart-money/netflow");
assert.equal(nansen.NANSEN_ENDPOINTS.smartMoneyDexTrades.path, "/api/v1/smart-money/dex-trades");
assert.equal(nansen.NANSEN_ENDPOINTS.smartMoneyHoldings.path, "/api/v1/smart-money/holdings");
assert.equal(nansen.NANSEN_ENDPOINTS.tokenPnlLeaderboard.path, "/api/v1/tgm/pnl-leaderboard");
assert.equal(nansen.NANSEN_ENDPOINTS.tokenHolders.path, "/api/v1/tgm/holders");
assert.equal(nansen.NANSEN_ENDPOINTS.tokenHolders.credits, 5);
assert.equal(nansen.NANSEN_ENDPOINTS.addressHistoricalBalances.path, "/api/v1/profiler/address/historical-balances");
assert.equal(nansen.NANSEN_ENDPOINTS.addressLabels.path, "/api/v1/profiler/address/labels");
assert.equal(nansen.NANSEN_ENDPOINTS.addressPremiumLabels.path, "/api/v1/profiler/address/premium-labels");
assert.equal(nansen.NANSEN_ENDPOINTS.perpScreener.path, "/api/v1/perp-screener");
assert.equal(nansen.NANSEN_ENDPOINTS.agentExpert.path, "/api/v1/agent/expert");

const parsed = nansen.parseNansenAgentSse([
  'data: {"type":"delta","text":"Flow "}',
  'data: {"type":"tool_call","name":"token_flow_intelligence"}',
  'data: {"type":"delta","text":"ready"}',
  'data: {"type":"finish","conversation_id":"conv_1","tool_calls":[{"name":"token_information"}]}',
  "data: [DONE]",
].join("\n"), "expert");
assert.equal(parsed.ok, true);
assert.equal(parsed.mode, "expert");
assert.equal(parsed.text, "Flow ready");
assert.equal(parsed.conversationId, "conv_1");
assert.deepEqual(parsed.toolCalls.sort(), ["token_flow_intelligence", "token_information"]);

const serviceSource = await source("src/lib/services/nansen.ts");
assertIncludes(serviceSource, "managedNansenBaseUrl", "Nansen service");
assertIncludes(serviceSource, "resolvePooledHivemindosModelCreditToken", "Nansen service");
assertIncludes(serviceSource, "portfolioDefiHoldings", "Nansen service");
assertIncludes(serviceSource, "buildNansenSimpleTemplateBrief", "Nansen service");
assertIncludes(serviceSource, 'nansenPost("tokenInformation", { ...base, timeframe: "1d" })', "Nansen token information contract");
assertIncludes(serviceSource, 'nansenPost("tokenFlowIntelligence", { ...base, timeframe: "1d" })', "Nansen flow intelligence contract");
assertIncludes(serviceSource, '{ ...dated, buy_or_sell: "BUY" }', "Nansen buyer leaderboard contract");
assertIncludes(serviceSource, '{ ...dated, buy_or_sell: "SELL" }', "Nansen seller leaderboard contract");
assertIncludes(serviceSource, "smartMoneyHoldings", "Nansen service");
assertIncludes(serviceSource, "HivemindOS hosted credits", "Nansen service");
assertIncludes(serviceSource, "Return derived HivemindOS analysis", "Nansen service");
assertIncludes(serviceSource, "Powered by Nansen API", "Nansen service attribution");
assert.ok(!serviceSource.includes("/api/beta/profiler/address/labels"), "Nansen service should not use stale beta labels path");
assert.ok(!serviceSource.includes("executeX402Fetch"), "Nansen service should not call direct x402 from the public app");

for (const route of [
  "src/app/api/nansen/status/route.ts",
  "src/app/api/nansen/token-brief/route.ts",
  "src/app/api/nansen/wallet-brief/route.ts",
  "src/app/api/nansen/hyperliquid-brief/route.ts",
  "src/app/api/nansen/market-scout/route.ts",
  "src/app/api/nansen/simple-template/route.ts",
  "src/app/api/nansen/complex-template/route.ts",
  "src/app/api/nansen/agent/route.ts",
]) {
  await assertFile(route);
  const routeSource = await source(route);
  assertIncludes(routeSource, "requireNansenRouteAuth", route);
  assertIncludes(routeSource, "okJson", route);
}

const routeShared = await source("src/app/api/nansen/_shared.ts");
assertIncludes(routeShared, "requireAuth", "Nansen route auth helper");
assertIncludes(routeShared, "upstreamErrorJson", "Nansen route error helper");

const actionCatalog = await source("src/lib/services/hive-actions/catalog.ts");
assertIncludes(actionCatalog, 'id: "nansen.intelligence"', "Hive action catalog");
assertIncludes(actionCatalog, 'toolName: "nansen_intelligence"', "Hive action catalog");
assertIncludes(actionCatalog, '"simple-template"', "Hive action catalog");
assertIncludes(actionCatalog, '"defi-positions"', "Hive action catalog");
assertIncludes(actionCatalog, '"complex-template"', "Hive action catalog");
assertIncludes(actionCatalog, '"cex-health-monitor"', "Hive action catalog");
assertIncludes(actionCatalog, "creditSlug", "Hive action catalog");
assert.ok(!actionCatalog.includes("approvalThresholdSatisfied: z.boolean().optional()"), "Nansen action should not expose wallet approval fields");

const contextIndex = await source("src/lib/services/context-index.ts");
assertIncludes(contextIndex, "tool-schema:nansen-onchain-intelligence", "context index");
assertIncludes(contextIndex, "NANSEN_HIVEMIND_INTEGRATION_FACTS", "context index");
assertIncludes(contextIndex, "simple-template", "context index");
assertIncludes(contextIndex, "packagedSkillFileStats", "context index");

const packagedSkillIndex = await source("src/lib/services/context-index/packaged-skills.ts");
assertIncludes(packagedSkillIndex, "PACKAGED_OPTIONAL_SKILLS_ROOT", "packaged skill context index");
assertIncludes(packagedSkillIndex, "Optional Nansen workflow playbook", "packaged skill context index");
assertIncludes(packagedSkillIndex, "not required for Nansen access", "packaged skill context index");

const hiveCapabilitySearchSkill = await source("packaged-skills/auto-install/hive-capability-search/SKILL.md");
assertIncludes(hiveCapabilitySearchSkill, "optional packaged catalog metadata", "hive capability search skill");
assertIncludes(hiveCapabilitySearchSkill, "installable workflow playbooks", "hive capability search skill");

const chatContext = await source("src/lib/services/chat/nansen-capability-context.ts");
assertIncludes(chatContext, "/api/nansen/token-brief", "chat Nansen context");
assertIncludes(chatContext, "/api/nansen/simple-template", "chat Nansen context");
assertIncludes(chatContext, "/api/nansen/complex-template", "chat Nansen context");
assertIncludes(chatContext, "NANSEN_API_KEY", "chat Nansen context");
assertIncludes(chatContext, "copy-trading signals", "chat Nansen context");

const agentRuntime = await source("src/app/api/chat/agent-runtime/route.ts");
assertIncludes(agentRuntime, "buildNansenCapabilityContext", "agent runtime");
assertIncludes(agentRuntime, "nansenCapabilityContext", "agent runtime");

const mcp = await source("scripts/hivemind-mcp");
assertIncludes(mcp, "callNansenIntelligence", "hivemind MCP");
assertIncludes(mcp, '"/api/nansen/hyperliquid-brief"', "hivemind MCP");
assertIncludes(mcp, '"/api/nansen/simple-template"', "hivemind MCP");
assertIncludes(mcp, '"/api/nansen/complex-template"', "hivemind MCP");
assertIncludes(mcp, 'if (name === "nansen_intelligence")', "hivemind MCP");
assertIncludes(mcp, "nansenBillingContext", "hivemind MCP");
assert.ok(!mcp.includes("nansenPaymentContext"), "MCP Nansen action should not build direct payment contexts");

const trade = await import("../src/lib/services/chat/trade-route-context.ts");
const forbidden = /\b(private|privately|veil|shield|shielded)\b|https?:\/\/|\$\s*\d|\d\s*(?:usdc|usd|dollars?|bucks)\b/i;
assert.ok(
  trade.TRADE_ROUTE_CAPABILITY_LINES.some((line) => line.includes("Nansen intelligence") && line.includes("token-screener") && line.includes("CEX-health")),
  "Trade route capabilities should mention Nansen intelligence",
);
for (const line of [...trade.TRADE_ROUTE_CAPABILITY_LINES, ...trade.WALLET_ROUTE_CAPABILITY_LINES]) {
  assert.ok(!forbidden.test(line), `Capability line must stay parser-safe: ${line}`);
}

const tradeIntents = await import("../src/features/dashboard/views/trade/trade-intents.ts");
const expectedNansenTradeActions = [
  "nansen-defi-positions",
  "nansen-smart-money-holdings",
  "nansen-token-holders",
  "nansen-token-screener",
  "nansen-token-tracking",
  "nansen-hyperliquid-wallets",
  "nansen-related-wallets",
  "nansen-top-wallets",
  "nansen-cex-health",
];
for (const id of expectedNansenTradeActions) {
  const intent = tradeIntents.CRYPTO_INTENTS.find((item) => item.id === id);
  assert.ok(intent, `Trade route should expose ${id}`);
  assert.equal(intent.group, "Read", `${id} should be a read action`);
  assert.equal(intent.input, "nansen", `${id} should use the Nansen action panel`);
  assert.equal(intent.mutating, false, `${id} should be read-only`);
}

const tradeApi = await source("src/features/dashboard/views/trade/trade-api.ts");
assertIncludes(tradeApi, "TradeNansenSimpleTemplateId", "Trade API");
assertIncludes(tradeApi, '"/api/nansen/simple-template"', "Trade API");
assertIncludes(tradeApi, "runNansenSimpleTemplate", "Trade API");
assertIncludes(tradeApi, "TradeNansenComplexTemplateId", "Trade API");
assertIncludes(tradeApi, '"/api/nansen/complex-template"', "Trade API");
assertIncludes(tradeApi, "runNansenComplexTemplate", "Trade API");

const capabilityRail = await source("src/components/trade/CapabilityRail.tsx");
assertIncludes(capabilityRail, "NANSEN_TRADE_ACTIONS", "Trade capability rail");
assertIncludes(capabilityRail, "NansenCapabilityPanel", "Trade capability rail");
assertIncludes(capabilityRail, "runNansenSimpleTemplate", "Trade capability rail");
assertIncludes(capabilityRail, "runNansenComplexTemplate", "Trade capability rail");
assertIncludes(capabilityRail, "Find top wallets", "Trade capability rail");
assertIncludes(capabilityRail, "nansenTopWalletTokenOptions", "Trade capability rail");
assertIncludes(capabilityRail, "nansen-top-wallet-token-options", "Trade capability rail");
assertIncludes(capabilityRail, "Search token or paste contract", "Trade capability rail");
assert.ok(!capabilityRail.includes("Compare wallet (optional)"), "Top-wallet Trade tile should not ask for a compare wallet by default");
for (const id of expectedNansenTradeActions) {
  assertIncludes(capabilityRail, id, "Trade capability rail");
}

const tradePrimitives = await source("src/components/trade/primitives.tsx");
assertIncludes(tradePrimitives, "nansen: { label: \"Nansen\"", "Trade provider badge metadata");

const tradeCss = await source("src/components/trade/trade-desk.css");
assertIncludes(tradeCss, ".tk-nansen-result", "Trade Nansen styles");
assertIncludes(tradeCss, ".tk-nansen-sources", "Trade Nansen styles");

const tradingIndex = await source("docs/for-users/trading/index.md");
assertIncludes(tradingIndex, "nansen-intelligence.html", "trading docs index");
assertIncludes(tradingIndex, "Research token, wallet, DeFi positions, Smart Money holdings, token-holder, token-screener, Hyperliquid, related-wallet, and CEX-health context", "trading docs index");

const nansenDocs = await source("docs/for-users/trading/nansen-intelligence.md");
assertIncludes(nansenDocs, "hive-env-add NANSEN_API_KEY", "Nansen docs");
assertIncludes(nansenDocs, "HivemindOS-managed Nansen broker", "Nansen docs");
assertIncludes(nansenDocs, "GET /api/nansen/status", "Nansen docs");
assertIncludes(nansenDocs, "POST /api/nansen/simple-template", "Nansen docs");
assertIncludes(nansenDocs, "token-screener-discovery", "Nansen docs");
assertIncludes(nansenDocs, "POST /api/nansen/complex-template", "Nansen docs");
assertIncludes(nansenDocs, "token-tracking-smart-money", "Nansen docs");
assertIncludes(nansenDocs, "POST /api/nansen/agent", "Nansen docs");
assertIncludes(nansenDocs, "raw Smart Money dashboards", "Nansen docs");
assert.ok(!nansenDocs.includes("pay-per-call flow from a governed local wallet"), "Nansen docs should not advertise direct Nansen x402");

for (const skill of [
  "nansen-defi-positions",
  "nansen-smart-money-holdings",
  "nansen-token-top-holders",
  "nansen-token-screener-discovery",
  "nansen-token-tracking-smart-money",
  "nansen-hyperliquid-wallet-discovery",
  "nansen-related-wallet-clustering",
  "nansen-top-wallet-research",
  "nansen-cex-health-monitor",
]) {
  await assertFile(`packaged-skills/optional/crypto/hivemindos/${skill}/SKILL.md`);
  await assertFile(`packaged-skills/optional/crypto/hivemindos/${skill}/.hivemind-skill-source.json`);
}

const { searchContextIndex } = await import("../src/lib/services/context-index.ts");

for (const skill of [
  "nansen-defi-positions",
  "nansen-smart-money-holdings",
  "nansen-token-top-holders",
  "nansen-token-screener-discovery",
  "nansen-token-tracking-smart-money",
  "nansen-hyperliquid-wallet-discovery",
  "nansen-related-wallet-clustering",
  "nansen-top-wallet-research",
  "nansen-cex-health-monitor",
]) {
  const result = await searchContextIndex({ query: skill, kinds: ["skill"], limit: 20 });
  const hit = result.items.find((item) => item.id === `skill:packaged:optional:crypto/hivemindos/${skill}`);
  assert.ok(hit, `hive capability search should surface optional packaged skill ${skill}`);
  assertIncludes(hit.summary, "Optional installable workflow playbook", `${skill} capability-search summary`);
  assertIncludes(hit.load.note ?? "", "not required for Nansen access", `${skill} capability-search load note`);
  assertIncludes(hit.load.note ?? "", "nansen_intelligence", `${skill} capability-search load note`);
}

for (const query of [
  "Nansen DeFi positions simple template",
  "Nansen Smart Money holdings",
  "Nansen token top holders",
  "Nansen token screener discovery",
  "Nansen CEX health monitor",
]) {
  const result = await searchContextIndex({ query, limit: 30 });
  assert.ok(
    result.items.some((item) => item.id === "hive-action:nansen.intelligence"),
    `hive capability search should surface the core Nansen action for ${query}`,
  );
}

const packagedReadme = await source("packaged-skills/README.md");
assertIncludes(packagedReadme, "crypto/hivemindos/nansen-*", "packaged skills README");
assertIncludes(packagedReadme, "Capability search", "packaged skills README");

const packagedDocs = await source("docs/for-users/packaged-skills/third-party-skills.md");
assertIncludes(packagedDocs, "crypto/hivemindos/nansen-*", "packaged skills docs");
assertIncludes(packagedDocs, "not required for Nansen access", "packaged skills docs");

console.log("Nansen intelligence integration checks passed.");
