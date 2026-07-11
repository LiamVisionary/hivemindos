#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function request(child, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${message.method}.`)), 5_000);
    const onData = (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id !== message.id) continue;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        resolve(parsed);
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const mcp = spawn("node", ["scripts/hivemind-mcp"], { stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
mcp.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  await request(mcp, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const listed = await request(mcp, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tool = listed.result.tools.find((candidate) => candidate.name === "app_builder");
  assert.ok(tool, "app_builder must be exposed to local agents through MCP");
  assert.equal(tool.annotations["hivemindos/risk"], "high");
  assert.ok(tool.annotations["hivemindos/confirmation"].tokens.includes("CONFIRM_APP_PROJECT_CREATE"));

  const rejected = await request(mcp, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "app_builder", arguments: { action: "create", backend: "local", directory: "/tmp/example", name: "Example" } },
  });
  assert.match(rejected.error.message, /CONFIRM_APP_PROJECT_CREATE/);
} catch (error) {
  if (stderr.trim()) error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  throw error;
} finally {
  mcp.kill();
}

console.log("App Builder is exposed through MCP with operation-specific confirmation gating.");
