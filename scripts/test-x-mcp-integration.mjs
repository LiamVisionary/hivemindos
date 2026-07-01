#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const catalog = readFileSync("src/lib/services/mcp/catalog.ts", "utf8");
assert.match(catalog, /id: "xapi"/);
assert.match(catalog, /https:\/\/docs\.x\.com\/tools\/mcp/);
assert.match(catalog, /X_MCP_CLIENT_ID/);
assert.match(catalog, /X_MCP_CLIENT_SECRET/);
assert.match(catalog, /sideEffects: \["read", "write", "network", "browser"\]/);
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
assert.doesNotMatch(service, /readFileSync\(.*\.xurl.*utf8/s);

const route = readFileSync("src/app/api/integrations/x-mcp/route.ts", "utf8");
assert.match(route, /requireAuth\(request\)/);
assert.match(route, /save-credentials/);
assert.match(route, /start-oauth/);
assert.match(route, /sync-runtimes/);

const ui = readFileSync("src/features/integrations/IntegrationsView.tsx", "utf8");
assert.match(ui, /\/api\/integrations\/x-mcp/);
assert.match(ui, /xapi: \{ transport: "stdio"/);
assert.match(ui, /"x-docs": \{ transport: "http"/);

const xPanel = readFileSync("src/features/integrations/XAccountMcpPanel.tsx", "utf8");
assert.match(xPanel, /X Account MCP/);
assert.match(xPanel, /Enable for all agents/);
assert.match(xPanel, /X_MCP_CLIENT_ID/);
assert.match(xPanel, /X_MCP_CLIENT_SECRET/);

console.log("X MCP integration checks passed.");
