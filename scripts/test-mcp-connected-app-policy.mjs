#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mcpRoute = await readFile("src/app/api/mcp/client/route.ts", "utf8");
assert.match(mcpRoute, /authorizeOperation/);
assert.match(mcpRoute, /recordAuditEvent/);
assert.match(mcpRoute, /callMcpTool/);
assert.match(mcpRoute, /decisionAllowed/);
assert.match(mcpRoute, /okJson/);
assert.match(mcpRoute, /errorJson/);

const appProxyRoute = await readFile("src/app/api/fleet/apps/request/route.ts", "utf8");
assert.match(appProxyRoute, /authorizeOperation/);
assert.match(appProxyRoute, /recordAuditEvent/);
assert.match(appProxyRoute, /normalizeRequestPath/);
assert.match(appProxyRoute, /Only GET and POST app requests are supported/);
assert.match(appProxyRoute, /decisionAllowed/);

console.log("MCP and connected-app policy guards passed.");
