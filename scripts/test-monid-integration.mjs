#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  MONID_API_BASE_URL,
  MONID_API_KEY_ENV,
  MONID_RUN_CONFIRMATION,
  monidPricesMatch,
  monidRunSchema,
  readMonid,
  runMonid,
} = await import("../src/lib/services/integrations/monid.ts");
const { CONNECTOR_MANIFESTS_BY_KEY } = await import("../src/lib/services/integrations/connector-manifests.ts");
const { connectionProvider } = await import("../src/lib/services/integrations/provider-connections.ts");
const { monidReadAction, monidRunAction } = await import("../src/lib/services/hive-actions/integrations/monid.ts");

assert.equal(MONID_API_BASE_URL, "https://api.monid.ai");
assert.equal(MONID_API_KEY_ENV, "MONID_API_KEY");
assert.equal(MONID_RUN_CONFIRMATION, "CONFIRM_MONID_RUN");

const calls = [];
const mockFetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith("/v1/discover")) {
    return Response.json({ results: [{ provider: "akta-pro", endpoint: "/companies/search" }] });
  }
  if (String(url).endsWith("/v1/run")) {
    return Response.json({ runId: "run-1", status: "RUNNING" }, { status: 202 });
  }
  return Response.json({ balance: { value: 12.5, currency: "USD" } });
};

const discovery = await readMonid({ action: "discover", query: "private company signals", limit: 5 }, "test-monid-key", mockFetch);
assert.equal(discovery.status, 200);
assert.deepEqual(discovery.data, { results: [{ provider: "akta-pro", endpoint: "/companies/search" }] });
assert.equal(calls[0].url, "https://api.monid.ai/v1/discover");
assert.equal(calls[0].init.method, "POST");
assert.equal(calls[0].init.headers.Authorization, "Bearer test-monid-key");
assert.deepEqual(JSON.parse(calls[0].init.body), { query: "private company signals", limit: 5 });

const price = { type: "PER_CALL", amount: 0.125, flatFee: null, currency: "USD" };
assert.equal(monidPricesMatch(price, { ...price, currency: "usd" }), true, "Currency matching should be case-insensitive.");
assert.equal(monidPricesMatch(price, { ...price, amount: 0.25 }), false, "A changed price must fail closed.");
assert.equal(monidPricesMatch(price, { type: "PER_RESULT", amount: 0.125, currency: "USD" }), false, "A changed price model must fail closed.");
assert.equal(monidRunSchema.safeParse({ provider: "akta-pro", endpoint: "/companies/search", input: {} }).success, false, "Paid runs must carry the inspected price.");

const run = await runMonid({
  provider: "akta-pro",
  endpoint: "/companies/search",
  input: { query: "Databricks" },
  confirmedPrice: price,
  confirmation: MONID_RUN_CONFIRMATION,
}, "test-monid-key", mockFetch);
assert.equal(run.status, 202);
assert.deepEqual(JSON.parse(calls.at(-1).init.body), {
  provider: "akta-pro",
  endpoint: "/companies/search",
  input: { query: "Databricks" },
});
assert.equal(JSON.stringify(calls.at(-1)).includes("confirmedPrice"), false, "Local confirmation metadata must not be sent to Monid.");

const manifest = CONNECTOR_MANIFESTS_BY_KEY.monid;
assert.equal(manifest.auth.tokenEnvKey, MONID_API_KEY_ENV);
assert.ok(manifest.operations.some((operation) => operation.id === "discover-inspect-monid" && operation.readOnly));
const paidOperation = manifest.operations.find((operation) => operation.id === "run-monid-tool");
assert.deepEqual(paidOperation.sideEffects, ["network", "payment"]);
assert.equal(paidOperation.risk, "high");
assert.ok(paidOperation.requiredClaims.includes("wallet:spend"));

assert.equal(monidReadAction.readOnly, true);
assert.deepEqual(monidReadAction.requiresConnection, [MONID_API_KEY_ENV]);
assert.equal(monidReadAction.mcp.toolName, "monid_read");
assert.equal(monidRunAction.mcp.toolName, "monid_run");
assert.deepEqual(monidRunAction.sideEffects, ["network", "payment"]);
assert.equal(monidRunAction.confirmation.token, MONID_RUN_CONFIRMATION);
assert.match(monidRunAction.contextIndex.retrievalText, /re-inspects immediately before execution/i);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), "https://api.monid.ai/v1/wallet/balance");
  assert.equal(init.headers.Authorization, "Bearer verified-monid-key");
  return Response.json({ balance: { value: "8.40", currency: "usd" } });
};
try {
  const verification = await connectionProvider("monid").verify("verified-monid-key", {});
  assert.deepEqual(verification, { ok: true, account: "8.40 USD balance" });
} finally {
  globalThis.fetch = originalFetch;
}

const routeSource = readFileSync(new URL("../src/app/api/integrations/monid/route.ts", import.meta.url), "utf8");
assert.ok(routeSource.indexOf("inspectMonidEndpoint") < routeSource.indexOf("runMonid(parsed.data)"), "The route must re-inspect before executing.");
assert.match(routeSource, /monidPricesMatch\(parsed\.data\.confirmedPrice, currentPrice\)/);
assert.match(routeSource, /parsed\.data\.confirmation !== MONID_RUN_CONFIRMATION/);

const mcpSource = readFileSync(new URL("./hivemind-mcp", import.meta.url), "utf8");
assert.match(mcpSource, /name === "monid_read"[\s\S]*?mode: "read"/);
assert.match(mcpSource, /name === "monid_run"[\s\S]*?CONFIRM_MONID_RUN[\s\S]*?mode: "run"/);

const panelSource = readFileSync(new URL("../src/features/integrations/ConnectionsPanel.tsx", import.meta.url), "utf8");
assert.match(panelSource, /monid: \{ mono: "Mo"/);

console.log("Monid integration tests passed.");
