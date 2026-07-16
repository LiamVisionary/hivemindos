#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";

function createMcpClient(child) {
  let bufferedOutput = "";
  const pending = new Map();

  child.stdout.on("data", (chunk) => {
    bufferedOutput += String(chunk);
    const lines = bufferedOutput.split("\n");
    bufferedOutput = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      const request = pending.get(parsed.id);
      if (!request) continue;
      clearTimeout(request.timeout);
      pending.delete(parsed.id);
      if (parsed.error) request.reject(new Error(parsed.error.message));
      else request.resolve(parsed.result);
    }
  });

  return function mcpRequest(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(message.id);
      reject(new Error(`Timed out waiting for ${message.params?.name || message.method}`));
    }, 5_000);
    pending.set(message.id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
  };
}

const requests = [];
const server = http.createServer((request, response) => {
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { raw += chunk; });
  request.on("end", () => {
    const record = { method: request.method, url: request.url, body: raw ? JSON.parse(raw) : null };
    requests.push(record);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, request: record }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const child = spawn("node", ["scripts/hivemind-mcp"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, HIVEMINDOS_APP_URL: `http://127.0.0.1:${address.port}` },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
const mcpRequest = createMcpClient(child);
let id = 1;

async function call(name, args) {
  const result = await mcpRequest({
    jsonrpc: "2.0",
    id: id++,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return result.structuredContent.request;
}

try {
  await mcpRequest({ jsonrpc: "2.0", id: id++, method: "initialize", params: {} });
  const listed = await mcpRequest({ jsonrpc: "2.0", id: id++, method: "tools/list", params: {} });
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const name of ["beeline_profiles", "beeline_open_browser", "beeline_browser_use", "beeline_local_credentials", "beeline_local_credential_use", "beeline_connections", "beeline_calendar_list", "beeline_calendar_create", "beeline_mcp_read", "beeline_mcp_call"]) {
    assert.ok(names.has(name), `${name} should be listed`);
  }

  const profiles = await call("beeline_profiles", { query: "my mom" });
  assert.equal(profiles.method, "GET");
  assert.equal(profiles.url, "/api/beeline/actions?query=my%20mom");

  const connections = await call("beeline_connections", { profileId: "beeline_mom" });
  assert.equal(connections.method, "GET");
  assert.equal(connections.url, "/api/beeline/broker?profileId=beeline_mom");

  const calendarRead = await call("beeline_calendar_list", { profileId: "beeline_mom", connectionId: "bee_conn_google" });
  assert.equal(calendarRead.body.action, "calendar-list");

  await assert.rejects(
    () => call("beeline_calendar_create", { profileId: "beeline_mom", connectionId: "bee_conn_google" }),
    /CONFIRM_BEELINE_CALENDAR/,
  );
  const calendarWrite = await call("beeline_calendar_create", {
    profileId: "beeline_mom",
    connectionId: "bee_conn_google",
    event: { summary: "Appointment", start: { dateTime: "2026-07-15T19:00:00-04:00" }, end: { dateTime: "2026-07-15T19:30:00-04:00" } },
    idempotencyKey: "appointment-20260715-1900",
    confirmation: "CONFIRM_BEELINE_CALENDAR",
  });
  assert.equal(calendarWrite.body.action, "calendar-create");
  assert.equal(calendarWrite.body.idempotencyKey, "appointment-20260715-1900");

  const browser = await call("beeline_browser_use", {
    profileId: "beeline_mom",
    browserAction: "open",
    url: "https://example.com/appointments",
    confirmation: "CONFIRM_BEELINE_BROWSER_ACTION",
  });
  assert.equal(browser.url, "/api/beeline/actions");
  assert.equal(browser.body.browserAction, "open");

  const localCredentials = await call("beeline_local_credentials", { profileId: "beeline_mom" });
  assert.equal(localCredentials.method, "GET");
  assert.equal(localCredentials.url, "/api/beeline/local-credentials?profileId=beeline_mom");

  const localUse = await call("beeline_local_credential_use", {
    profileId: "beeline_mom",
    usage: "http",
    destinationUrl: "https://portal.example.com/appointments",
    capability: "healthcare",
    method: "POST",
    body: { time: "19:00" },
  });
  assert.equal(localUse.method, "POST");
  assert.equal(localUse.url, "/api/beeline/local-credentials");
  assert.equal(localUse.body.destinationUrl, "https://portal.example.com/appointments");
  assert.equal(localUse.body.confirmation, undefined, "Flexible local use should not require a narrow-operation confirmation");

  const mcpRead = await call("beeline_mcp_read", {
    profileId: "beeline_mom",
    connectionId: "bee_conn_mcp",
    request: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  assert.equal(mcpRead.body.action, "mcp-read");

  await assert.rejects(
    () => call("beeline_mcp_call", { profileId: "beeline_mom", connectionId: "bee_conn_mcp" }),
    /CONFIRM_BEELINE_MCP_ACTION/,
  );
  const mcpWrite = await call("beeline_mcp_call", {
    profileId: "beeline_mom",
    connectionId: "bee_conn_mcp",
    request: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "book", arguments: { time: "19:00" } } },
    idempotencyKey: "appointment-mcp-20260715-1900",
    confirmation: "CONFIRM_BEELINE_MCP_ACTION",
  });
  assert.equal(mcpWrite.body.action, "mcp-call");
} catch (error) {
  if (stderr.trim()) error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  throw error;
} finally {
  child.kill();
  server.close();
}

console.log("Beeline MCP routing checks passed.");
