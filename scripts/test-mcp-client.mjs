#!/usr/bin/env node
// Verifies the in-app MCP client connects to a real MCP server (stdio), lists and calls its
// tools, reports status, and that the enable toggle gates connections.
import { register } from "node:module";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "lib", "mcp-fixture-server.mjs");

const mcp = await import("../src/lib/services/mcp/client.ts");

try {
  assert.equal(mcp.isMcpClientEnabled(), true, "MCP client should be enabled by default");

  const connected = await mcp.connectMcpServer({ id: "fixture", transport: "stdio", command: process.execPath, args: [fixturePath] });
  assert.equal(connected.id, "fixture");
  assert.ok(connected.tools.some((t) => t.name === "echo"), "echo tool should be listed");

  const tools = await mcp.listMcpTools("fixture");
  assert.ok(tools.some((t) => t.name === "echo"));

  const result = await mcp.callMcpTool("fixture", "echo", { text: "hello hive" });
  assert.equal(result.content[0].text, "echo: hello hive", "tool call should round-trip");

  const status = mcp.mcpClientStatus();
  assert.equal(status.enabled, true);
  assert.ok(status.servers.find((s) => s.id === "fixture"), "status should list the connected server");

  await mcp.disconnectMcpServer("fixture");
  assert.equal(mcp.mcpClientStatus().servers.length, 0, "disconnect should drop the server");

  // Toggle gates connections.
  await mcp.setMcpClientEnabled(false);
  assert.equal(mcp.isMcpClientEnabled(), false);
  await assert.rejects(() => mcp.connectMcpServer({ id: "fixture", transport: "stdio", command: process.execPath, args: [fixturePath] }), /disabled/);
  await mcp.setMcpClientEnabled(true); // restore default-on
  assert.equal(mcp.isMcpClientEnabled(), true);

  console.log("MCP client tests passed.");
} finally {
  await mcp.disconnectAllMcpServers().catch(() => {});
}
process.exit(0);
