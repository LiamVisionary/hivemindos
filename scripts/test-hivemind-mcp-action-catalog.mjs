#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  listHiveActions,
  listMcpHiveActions,
} = await import("../src/lib/services/hive-actions/index.ts");

function mcpRequest(child, message) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
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
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const expectedTools = listMcpHiveActions(listHiveActions());
const mcp = spawn("node", ["scripts/hivemind-mcp"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
mcp.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });
  const tools = await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  const actualByName = new Map(tools.tools.map((tool) => [tool.name, tool]));

  for (const expected of expectedTools) {
    assert.deepEqual(
      actualByName.get(expected.name),
      JSON.parse(JSON.stringify(expected)),
      `${expected.name} MCP descriptor should come from the Hive action registry`,
    );
  }

  for (const existing of [
    "handoff_file_task",
    "work_board",
    "queen_bee",
    "work_event",
    "request_human_approval",
    "send_usdc",
    "dex_swap",
    "stock_trade",
    "hyperliquid_trade",
    "company_api_preflight",
  ]) {
    assert.ok(actualByName.has(existing), `${existing} should remain exposed`);
  }
} catch (error) {
  if (stderr.trim()) {
    error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  }
  throw error;
} finally {
  mcp.kill();
}

console.log("Hivemind MCP action catalog tests passed.");
