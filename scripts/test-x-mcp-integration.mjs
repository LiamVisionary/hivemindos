#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const catalog = readFileSync("src/lib/services/mcp/catalog.ts", "utf8");
assert.match(catalog, /id: "xapi"/);
assert.match(catalog, /https:\/\/docs\.x\.com\/tools\/mcp/);
assert.match(catalog, /X_MCP_CLIENT_ID/);
assert.match(catalog, /X_MCP_CLIENT_SECRET/);
assert.match(catalog, /HIVEMINDOS_X_API_GATEWAY_BASE_URL/);
assert.match(catalog, /sideEffects: \["read", "write", "network", "browser", "payments"\]/);
assert.match(catalog, /id: "x-docs"/);
assert.match(catalog, /https:\/\/docs\.x\.com\/mcp/);

const bridge = readFileSync("scripts/x-mcp-bridge.mjs", "utf8");
assert.match(bridge, /@xdevplatform\/xurl/);
assert.match(bridge, /X_MCP_CLIENT_ID/);
assert.match(bridge, /X_MCP_CLIENT_SECRET/);
assert.match(bridge, /CLIENT_ID: clientId/);
assert.match(bridge, /CLIENT_SECRET: clientSecret/);
assert.match(bridge, /\["mcp", X_MCP_URL/);
assert.doesNotMatch(bridge, /console\.log\(.*CLIENT_SECRET/s);

const registrar = readFileSync("scripts/register-mcp-clients.mjs", "utf8");
assert.match(registrar, /xapi:/);
assert.match(registrar, /x-mcp-bridge\.mjs/);
assert.match(registrar, /--server hivemind\|xapi/);
assert.doesNotMatch(registrar, /X_MCP_CLIENT_SECRET/);

const dryRun = execFileSync(process.execPath, [
  "scripts/register-mcp-clients.mjs",
  "--server",
  "xapi",
  "--targets",
  "none",
  "--dry-run",
], { encoding: "utf8" });
assert.match(dryRun, /X API MCP registration/);
assert.match(dryRun, /server "xapi"/);
assert.match(dryRun, /targets: \(none\)/);

const service = readFileSync("src/lib/services/mcp/x-mcp.ts", "utf8");
assert.match(service, /writeSharedHiveEnvValue\(X_MCP_CLIENT_ID_ENV/);
assert.match(service, /writeSharedHiveEnvValue\(X_MCP_CLIENT_SECRET_ENV/);
assert.match(service, /startXMcpOAuth/);
assert.match(service, /syncXMcpRuntimeConfigs/);
assert.match(service, /removeXMcpRuntimeConfigs/);
assert.match(service, /getManagedXGatewayStatus/);
assert.doesNotMatch(service, /readFileSync\(.*\.xurl.*utf8/s);

const managedClient = readFileSync("src/lib/services/managed-x-api-client.ts", "utf8");
assert.match(managedClient, /DEFAULT_MANAGED_X_API_BASE_URL = "https:\/\/hivemindos-x-api-gateway\.hivemindos\.workers\.dev"/);
assert.match(managedClient, /startManagedXOAuth/);
assert.match(managedClient, /proxyManagedXApiCall/);
assert.match(managedClient, /proxyManagedXMcpRequest/);
assert.match(managedClient, /X-HivemindOS-Credit-Token/);
assert.doesNotMatch(managedClient, /payTo/i);

const route = readFileSync("src/app/api/integrations/x-mcp/route.ts", "utf8");
assert.match(route, /requireAuth\(request\)/);
assert.match(route, /save-credentials/);
assert.match(route, /start-oauth/);
assert.match(route, /sync-runtimes/);

const managedRoute = readFileSync("src/app/api/integrations/x-managed/route.ts", "utf8");
assert.match(managedRoute, /requireAuth\(request\)/);
assert.match(managedRoute, /getHivemindosModelCreditToken/);
assert.match(managedRoute, /listHivemindosModelCreditTokenSummaries/);
assert.match(managedRoute, /creditAccounts/);
assert.match(managedRoute, /oauth-start/);
assert.match(managedRoute, /CONFIRM_X_API_CALL/);

const managedMcpRoute = readFileSync("src/app/api/integrations/x-managed/mcp/route.ts", "utf8");
assert.match(managedMcpRoute, /proxyManagedXMcpRequest/);
assert.match(managedMcpRoute, /getHivemindosModelCreditToken/);

const hivemindMcp = readFileSync("scripts/hivemind-mcp", "utf8");
assert.match(hivemindMcp, /name: "x_api"/);
assert.match(hivemindMcp, /\/api\/integrations\/x-managed/);
assert.match(hivemindMcp, /CONFIRM_X_API_CALL/);

const ui = readFileSync("src/features/integrations/IntegrationsView.tsx", "utf8");
assert.match(ui, /\/api\/integrations\/x-mcp/);
assert.match(ui, /\/api\/integrations\/x-managed/);
assert.match(ui, /managedXReturnUrl/);
assert.match(ui, /xapi: \{ transport: "stdio"/);
assert.match(ui, /"x-docs": \{ transport: "http"/);

const xPanel = readFileSync("src/features/integrations/XAccountMcpPanel.tsx", "utf8");
assert.match(xPanel, /X Account MCP/);
assert.match(xPanel, /x-method-grid/);
assert.match(xPanel, /MethodCard/);
assert.match(xPanel, /Enable for all agents/);
assert.match(xPanel, /Managed credits/);
assert.match(xPanel, /Bring your own X app/);
assert.match(xPanel, /Runtime reach/);
assert.match(xPanel, /Connect managed X account/);
assert.match(xPanel, /Credits to charge/);
assert.match(xPanel, /managedGateway/);
assert.match(xPanel, /X_MCP_CLIENT_ID/);
assert.match(xPanel, /X_MCP_CLIENT_SECRET/);

const integrationsCss = readFileSync("src/features/integrations/integrations-redesign.css", "utf8");
assert.match(integrationsCss, /\.fr-root\.ni-embedded/);
assert.match(integrationsCss, /overflow-y:\s*auto/);
assert.match(integrationsCss, /\.x-method-grid/);
assert.match(integrationsCss, /\.x-method-panel/);

const integrationsPage = readFileSync("src/app/integrations/page.tsx", "utf8");
assert.match(integrationsPage, /params\.set\("view", "integrations"\)/);
assert.match(integrationsPage, /window\.location\.replace\(`\/\?\$\{params\.toString\(\)\}`\)/);

console.log("X MCP integration checks passed.");
