#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function mcpRequest(child, message) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MCP response to ${message.method}`));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
    };
    const onData = (chunk) => {
      buffer += String(chunk);
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        if (!line) continue;
        const parsed = JSON.parse(line);
        if (parsed.id !== message.id) continue;
        cleanup();
        resolve(parsed);
        return;
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

async function callToolExpectError(child, id, name, args, expectedText) {
  const response = await mcpRequest(child, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  assert.ok(response.error, `${name} should fail before dashboard execution`);
  assert.match(response.error.message, expectedText);
  assert.doesNotMatch(response.error.message, /ECONNREFUSED|dashboard API|127\.0\.0\.1|localhost|5020/i);
  return response.error.message;
}

function getTool(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `${name} should be exposed`);
  return tool;
}

function assertExecutionToolMetadata(tool, expectedTokens) {
  assert.equal(tool.annotations?.destructiveHint, true);
  assert.equal(tool.annotations?.["hivemindos/risk"], "critical");
  assert.ok(tool.annotations?.["hivemindos/sideEffects"]?.includes("wallet"));
  assert.ok(tool.annotations?.["hivemindos/sideEffects"]?.includes("payment"));
  const confirmation = tool.annotations?.["hivemindos/confirmation"];
  assert.ok(confirmation, `${tool.name} should expose confirmation metadata`);
  const tokens = [
    typeof confirmation.token === "string" ? confirmation.token : null,
    ...(Array.isArray(confirmation.tokens) ? confirmation.tokens : []),
  ].filter(Boolean);
  assert.deepEqual(tokens.sort(), [...expectedTokens].sort());
}

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
  const listResponse = await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  const tools = listResponse.result.tools;

  assertExecutionToolMetadata(getTool(tools, "send_usdc"), ["SEND_USDC"]);
  assertExecutionToolMetadata(getTool(tools, "dex_swap"), ["CONFIRM_SWAP"]);
  assertExecutionToolMetadata(getTool(tools, "stock_trade"), ["CONFIRM_BUY", "CONFIRM_SELL"]);

  await callToolExpectError(
    mcp,
    3,
    "send_usdc",
    { agentId: "agent:test", toAddress: "0x0000000000000000000000000000000000000001", amountUsd: 1 },
    /SEND_USDC/,
  );
  await callToolExpectError(
    mcp,
    4,
    "dex_swap",
    {
      agentId: "agent:test",
      sellToken: "USDC",
      buyToken: "WETH",
      amountHuman: "1",
      confirmation: "SEND_USDC",
    },
    /CONFIRM_SWAP/,
  );
  await callToolExpectError(
    mcp,
    5,
    "stock_trade",
    {
      agentId: "agent:test",
      side: "buy",
      ticker: "AAPL",
      notionalUsd: 1,
      confirmation: "CONFIRM_SELL",
    },
    /CONFIRM_BUY/,
  );
  await callToolExpectError(
    mcp,
    6,
    "stock_trade",
    {
      agentId: "agent:test",
      side: "sell",
      ticker: "AAPL",
      qty: 1,
      confirmation: "CONFIRM_BUY",
    },
    /CONFIRM_SELL/,
  );
} catch (error) {
  if (stderr.trim()) {
    error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  }
  throw error;
} finally {
  mcp.kill();
}

console.log("MCP wallet confirmation policy tests passed.");
