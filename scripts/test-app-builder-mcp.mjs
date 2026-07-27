#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function request(child, lines, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${message.method}.`)), 5_000);
    const onLine = (line) => {
      if (!line.trim()) return;
      const parsed = JSON.parse(line);
      if (parsed.id !== message.id) return;
      clearTimeout(timeout);
      lines.off("line", onLine);
      resolve(parsed);
    };
    lines.on("line", onLine);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const mcp = spawn("node", ["scripts/hivemind-mcp"], { stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: mcp.stdout });
let stderr = "";
mcp.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  await request(mcp, lines, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const listed = await request(mcp, lines, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tool = listed.result.tools.find((candidate) => candidate.name === "app_builder");
  assert.ok(tool, "app_builder must be exposed to local agents through MCP");
  assert.equal(tool.annotations["hivemindos/risk"], "high");
  assert.ok(tool.annotations["hivemindos/confirmation"].tokens.includes("CONFIRM_APP_PROJECT_CREATE"));
  assert.ok(tool.inputSchema.properties.action.enum.includes("adopt"));
  assert.ok(tool.inputSchema.properties.action.enum.includes("export_source"));
  assert.ok(tool.inputSchema.properties.templateId.enum.includes("static"));

  const rejected = await request(mcp, lines, {
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
  lines.close();
  mcp.kill();
}

console.log("App Builder is exposed through MCP with operation-specific confirmation gating.");
