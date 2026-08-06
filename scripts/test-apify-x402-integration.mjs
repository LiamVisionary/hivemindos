#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  apifyActorApiId,
  buildApifyActorRunUrl,
  buildApifyFundingUrl,
  buildApifyStoreSearchUrl,
  normalizeApifyActorId,
  parseApifyBalancePayload,
  parseApifyPrepaidTokenPayload,
  projectApifyStoreResponse,
} = await import("../src/lib/services/apify/contracts.ts");
const { listHiveActions, listMcpHiveActions } = await import("../src/lib/services/hive-actions/index.ts");
const { HIVE_MCP_SERVER_CATALOG } = await import("../src/lib/services/mcp/catalog.ts");
const { confirmX402Settlement } = await import("../src/lib/services/wallet/x402-agent-fetch.ts");

const ROOT = new URL("../", import.meta.url);
const sourcePaths = [
  "src/lib/services/apify/contracts.ts",
  "src/lib/services/apify/client.ts",
  "src/lib/services/apify/token-vault.ts",
  "src/app/api/apify/route.ts",
  "src/lib/services/wallet/x402-agent-fetch.ts",
  "src/app/api/wallet/x402/route.ts",
  "scripts/hivemind-mcp",
];
const sources = Object.fromEntries(await Promise.all(
  sourcePaths.map(async (path) => [path, await readFile(new URL(path, ROOT), "utf8")]),
));

assert.equal(normalizeApifyActorId("apify/instagram-scraper"), "apify/instagram-scraper");
assert.equal(normalizeApifyActorId("apify~instagram-scraper"), "apify/instagram-scraper");
assert.equal(apifyActorApiId("apify/instagram-scraper"), "apify~instagram-scraper");
for (const invalid of ["instagram-scraper", "apify/a/b", "https://apify.com/apify/test", "../actor", "apify/%2factors"]) {
  assert.throws(() => normalizeApifyActorId(invalid), /username\/name/);
}

const fundingUrl = new URL(buildApifyFundingUrl(1.5));
assert.equal(fundingUrl.origin, "https://agi.apify.com");
assert.equal(fundingUrl.pathname, "/protocols/x402/prepaid-tokens");
assert.equal(fundingUrl.searchParams.get("amount"), "1.50");
assert.equal(fundingUrl.searchParams.get("currency"), "usd");
assert.throws(() => buildApifyFundingUrl(0.99), /\$1\.00/);
assert.throws(() => buildApifyFundingUrl(1.001), /two decimal places/);

const storeUrl = new URL(buildApifyStoreSearchUrl("instagram posts", 5, 0));
assert.equal(storeUrl.origin, "https://api.apify.com");
assert.equal(storeUrl.searchParams.get("allowsAgenticUsers"), "true");
assert.equal(storeUrl.searchParams.get("includeInputSchema"), "true");

const runUrl = new URL(buildApifyActorRunUrl({
  actorId: "apify/instagram-scraper",
  maxChargeUsd: 0.25,
  resultLimit: 20,
  timeoutSecs: 120,
}));
assert.equal(runUrl.origin, "https://api.apify.com");
assert.equal(runUrl.pathname, "/v2/actors/apify~instagram-scraper/run-sync-get-dataset-items");
assert.equal(runUrl.searchParams.get("maxTotalChargeUsd"), "0.25");
assert.equal(runUrl.searchParams.get("limit"), "20");
assert.equal(runUrl.searchParams.get("timeout"), "120");
assert.equal(runUrl.searchParams.get("clean"), "1");
assert.throws(() => buildApifyActorRunUrl({
  actorId: "apify/instagram-scraper",
  maxChargeUsd: 0.25,
  resultLimit: 20,
  timeoutSecs: 151,
}), /10 to 150/);

const token = parseApifyPrepaidTokenPayload({
  data: {
    token: "apify_api_this_is_a_test_token_value",
    remainingBalanceUsd: 1,
    expiresAt: "2030-01-01T00:00:00.000Z",
  },
});
assert.equal(token.remainingBalanceUsd, 1);
assert.equal(token.expiresAt, "2030-01-01T00:00:00.000Z");
assert.deepEqual(parseApifyBalancePayload({ remainingBalanceUsd: 0.75 }), { remainingBalanceUsd: 0.75, expiresAt: undefined });
assert.throws(() => parseApifyPrepaidTokenPayload({ token: "short" }), /invalid prepaid-token payload/);

const projected = projectApifyStoreResponse({
  data: {
    total: 2,
    items: [
      {
        id: "eligible-id",
        username: "apify",
        name: "eligible",
        title: "Eligible Actor",
        description: "Returns useful data.",
        url: "https://apify.com/apify/eligible",
        isWhiteListedForAgenticPayments: true,
        currentPricingInfo: {
          pricingModel: "PAY_PER_EVENT",
          minimalMaxTotalChargeUsd: 0.01,
          pricingPerEvent: {
            actorChargeEvents: {
              result: {
                eventTitle: "Result",
                eventTieredPricingUsd: { FREE: { tieredEventPriceUsd: 0.002 } },
              },
            },
          },
        },
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        stats: { totalRuns: 10, totalUsers: 4 },
      },
      {
        id: "blocked-id",
        username: "apify",
        name: "blocked",
        isWhiteListedForAgenticPayments: false,
      },
    ],
  },
});
assert.equal(projected.total, 2);
assert.equal(projected.actors.length, 1);
assert.equal(projected.actors[0].actorId, "apify/eligible");
assert.equal(projected.actors[0].pricing.model, "PAY_PER_EVENT");
assert.equal(projected.actors[0].pricing.events[0].priceUsd, 0.002);

const actions = listHiveActions();
const actionByTool = new Map(actions.map((action) => [action.mcp?.toolName, action]));
const mcpByTool = new Map(listMcpHiveActions(actions).map((tool) => [tool.name, tool]));
for (const readTool of ["apify_search_actors", "apify_x402_status"]) {
  assert.equal(actionByTool.get(readTool)?.readOnly, true, `${readTool} should be read-only`);
  assert.equal(mcpByTool.get(readTool)?.annotations.readOnlyHint, true);
}
for (const execution of [
  { tool: "apify_fund", token: "PAY_APIFY" },
  { tool: "apify_run_actor", token: "RUN_APIFY_ACTOR" },
]) {
  const action = actionByTool.get(execution.tool);
  assert.ok(action, `${execution.tool} should be registered`);
  assert.equal(action.risk, "critical");
  assert.ok(action.sideEffects.includes("wallet"));
  assert.ok(action.sideEffects.includes("payment"));
  assert.equal(action.confirmation?.token, execution.token);
  assert.equal(action.contextIndex?.route, "/api/apify");
  assert.equal(mcpByTool.get(execution.tool)?.annotations.destructiveHint, true);
}

const catalogEntry = HIVE_MCP_SERVER_CATALOG.find((entry) => entry.id === "apify-actors");
assert.ok(catalogEntry, "Apify should be discoverable in the MCP catalog");
assert.equal(catalogEntry.source, "official");
assert.match(catalogEntry.repoUrl, /github\.com\/apify\/apify-mcp-server/);

assert.match(sources["src/lib/services/apify/token-vault.ts"], /createCipheriv\("aes-256-gcm"/);
assert.match(sources["src/lib/services/apify/token-vault.ts"], /mode: 0o600/);
assert.match(sources["src/lib/services/apify/token-vault.ts"], /refusing to overwrite it/);
assert.match(sources["src/lib/services/apify/contracts.ts"], /maxTotalChargeUsd/);
assert.match(sources["src/lib/services/apify/client.ts"], /is not currently eligible for agentic prepaid payments/);
assert.match(sources["src/lib/services/apify/client.ts"], /onPaymentSettled: async/);
assert.match(sources["src/lib/services/apify/client.ts"], /acceptPaidResourceAsSettlement/);
assert.match(sources["src/app/api/apify/route.ts"], /okJson\(\{ result \}\)/);
assert.match(sources["src/app/api/apify/route.ts"], /directlyConfirmed \? "PAY_X402"/);
assert.doesNotMatch(sources["src/app/api/apify/route.ts"], /token:\s*stored\.token/);
assert.match(sources["src/lib/services/wallet/x402-agent-fetch.ts"], /export function normalizeX402Policy/);
assert.match(sources["src/lib/services/wallet/x402-agent-fetch.ts"], /if \(paymentSettled && input\.onPaymentSettled\)/);
assert.match(sources["src/lib/services/wallet/x402-agent-fetch.ts"], /confirmX402Settlement/);
assert.match(sources["src/app/api/wallet/x402/route.ts"], /normalizeX402Policy/);
assert.match(sources["scripts/hivemind-mcp"], /"apify_fund", "apify_run_actor"/);
assert.match(sources["scripts/hivemind-mcp"], /name === "apify_search_actors"/);
assert.match(sources["scripts/hivemind-mcp"], /name === "apify_run_actor"/);

const paidResource = {
  token: "apify_api_test_paid_resource_token",
  remainingBalanceUsd: 1,
  expiresAt: "2030-01-01T00:00:00.000Z",
};
let capturedPaidResource = null;
const paidWithoutHeader = await confirmX402Settlement({
  paid: true,
  responseOk: true,
  status: 201,
  resource: {
    status: 201,
    amountUsd: 1,
    contentType: "application/json",
    bodyPreview: JSON.stringify(paidResource),
    bodyJson: paidResource,
  },
  acceptPaidResourceAsSettlement: (settled) => {
    capturedPaidResource = parseApifyPrepaidTokenPayload(settled.bodyJson);
    return true;
  },
});
assert.equal(paidWithoutHeader, true);
assert.equal(capturedPaidResource?.token, paidResource.token);
assert.equal(await confirmX402Settlement({
  paid: true,
  responseOk: true,
  status: 201,
  paymentResponse: "settled-header",
  resource: { status: 201, amountUsd: 1, contentType: "application/json", bodyPreview: "{}" },
}), true);
assert.equal(await confirmX402Settlement({
  paid: true,
  responseOk: false,
  status: 500,
  resource: { status: 500, amountUsd: 1, contentType: "application/json", bodyPreview: "{}" },
  acceptPaidResourceAsSettlement: () => true,
}), false);

function mcpRequest(child, message) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      child.stdout.off("data", onData);
      reject(new Error(`Timed out waiting for MCP response to ${message.method}`));
    }, 5_000);
    const onData = (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id !== message.id) continue;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        resolve(parsed);
        return;
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const mcp = spawn("node", ["scripts/hivemind-mcp"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: ["pipe", "pipe", "pipe"],
});
let mcpStderr = "";
mcp.stderr.on("data", (chunk) => { mcpStderr += String(chunk); });
try {
  await mcpRequest(mcp, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const missingFundConfirmation = await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "apify_fund", arguments: { agentId: "agent:test", amountUsd: 1 } },
  });
  assert.match(missingFundConfirmation.error?.message ?? "", /PAY_APIFY/);
  assert.doesNotMatch(missingFundConfirmation.error?.message ?? "", /ECONNREFUSED|dashboard API|localhost|127\.0\.0\.1/i);

  const wrongRunConfirmation = await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "apify_run_actor",
      arguments: {
        agentId: "agent:test",
        actorId: "apify/instagram-scraper",
        input: {},
        maxChargeUsd: 0.1,
        confirmation: "PAY_APIFY",
      },
    },
  });
  assert.match(wrongRunConfirmation.error?.message ?? "", /RUN_APIFY_ACTOR/);
  assert.doesNotMatch(wrongRunConfirmation.error?.message ?? "", /ECONNREFUSED|dashboard API|localhost|127\.0\.0\.1/i);
} catch (error) {
  if (mcpStderr.trim()) error.message = `${error.message}\nMCP stderr:\n${mcpStderr}`;
  throw error;
} finally {
  mcp.kill();
}

let fakeDashboardHits = 0;
const fakeDashboard = createServer((_request, response) => {
  fakeDashboardHits += 1;
  response.writeHead(502, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false, error: "authoritative paid-route failure" }));
});
await new Promise((resolve) => fakeDashboard.listen(0, "127.0.0.1", resolve));
const fakeAddress = fakeDashboard.address();
assert.ok(fakeAddress && typeof fakeAddress === "object");
const failoverMcp = spawn("node", ["scripts/hivemind-mcp"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    HIVEMINDOS_APP_URL: `http://127.0.0.1:${fakeAddress.port}`,
  },
  stdio: ["pipe", "pipe", "pipe"],
});
try {
  await mcpRequest(failoverMcp, { jsonrpc: "2.0", id: 4, method: "initialize", params: {} });
  const authoritativeError = await mcpRequest(failoverMcp, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "apify_search_actors", arguments: { query: "must-not-fail-over", limit: 1 } },
  });
  assert.match(authoritativeError.error?.message ?? "", /authoritative paid-route failure/);
  assert.equal(fakeDashboardHits, 1, "MCP must stop after a canonical dashboard error instead of retrying another port");
} finally {
  failoverMcp.kill();
  await new Promise((resolve, reject) => fakeDashboard.close((error) => error ? reject(error) : resolve()));
}

console.log("Apify x402 integration tests passed.");
