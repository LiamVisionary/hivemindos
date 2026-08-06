#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

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
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

function startFakeDashboard() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      const record = { method: req.method, url: req.url, body };
      requests.push(record);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, request: record }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

const fake = await startFakeDashboard();
const mcp = spawn("node", ["scripts/hivemind-mcp"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    HIVEMINDOS_APP_URL: fake.url,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
mcp.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

let id = 1;
async function callTool(name, args) {
  const response = await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: id++,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return response.structuredContent.request;
}

try {
  await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: id++,
    method: "initialize",
    params: {},
  });

  const tools = await mcpRequest(mcp, {
    jsonrpc: "2.0",
    id: id++,
    method: "tools/list",
    params: {},
  });
  const toolNames = new Set(tools.tools.map((tool) => tool.name));
  for (const name of ["work_board", "queen_bee", "work_event", "request_human_approval"]) {
    assert.ok(toolNames.has(name), `${name} should be listed`);
  }

  const listRequest = await callTool("work_board", {
    action: "list",
    board: "ops",
    includeArchived: true,
    query: "release",
  });
  assert.equal(listRequest.method, "GET");
  assert.match(listRequest.url, /^\/api\/kanban\?/);
  assert.match(listRequest.url, /board=ops/);
  assert.match(listRequest.url, /include_archived=true/);
  assert.match(listRequest.url, /q=release/);

  const createRequest = await callTool("work_board", {
    action: "create-task",
    board: "ops",
    title: "Ship docs",
    status: "ready",
    priority: "high",
    skills: ["docs"],
  });
  assert.equal(createRequest.method, "POST");
  assert.match(createRequest.url, /^\/api\/kanban\?board=ops$/);
  assert.equal(createRequest.body.title, "Ship docs");
  assert.equal(createRequest.body.source, "mcp:work-board");
  assert.deepEqual(createRequest.body.skills, ["docs"]);

  const queenRequest = await callTool("queen_bee", {
    action: "queue-task",
    message: "Coordinate release QA",
    priority: "urgent",
    skills: ["qa"],
  });
  assert.equal(queenRequest.method, "POST");
  assert.equal(queenRequest.url, "/api/queen-bee");
  assert.equal(queenRequest.body.message, "Coordinate release QA");
  assert.equal(queenRequest.body.source, "mcp:queen-bee");

  const eventRequest = await callTool("work_event", {
    action: "publish",
    eventName: "deploy_done",
    payload: { version: "0.2.4" },
  });
  assert.equal(eventRequest.method, "POST");
  assert.equal(eventRequest.url, "/api/work-events");
  assert.equal(eventRequest.body.action, "publish");
  assert.equal(eventRequest.body.eventName, "deploy_done");
  assert.deepEqual(eventRequest.body.payload, { version: "0.2.4" });

  const approvalRequest = await callTool("request_human_approval", {
    board: "ops",
    title: "Approve deploy",
    request: "May the agent deploy the release?",
    options: ["allow", "deny"],
  });
  assert.equal(approvalRequest.method, "POST");
  assert.match(approvalRequest.url, /^\/api\/kanban\?board=ops$/);
  assert.equal(approvalRequest.body.status, "needs-human");
  assert.equal(approvalRequest.body.priority, "high");
  assert.equal(approvalRequest.body.assignee, "human");
  assert.match(approvalRequest.body.body, /does not grant approval/);
} catch (error) {
  if (stderr.trim()) {
    error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  }
  throw error;
} finally {
  mcp.kill();
  fake.server.close();
}

console.log("Hivemind MCP work tool routing tests passed.");
