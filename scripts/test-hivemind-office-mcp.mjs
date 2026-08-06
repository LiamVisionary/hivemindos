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
        if (parsed.error) reject(Object.assign(new Error(parsed.error.message), { data: parsed.error.data }));
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
    req.on("data", (chunk) => { raw += chunk; });
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
      resolve({ server, requests, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

const fake = await startFakeDashboard();
const mcp = spawn("node", ["scripts/hivemind-mcp"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, HIVEMINDOS_APP_URL: fake.url },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
mcp.stderr.on("data", (chunk) => { stderr += String(chunk); });

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
  await mcpRequest(mcp, { jsonrpc: "2.0", id: id++, method: "initialize", params: {} });
  const listed = await mcpRequest(mcp, { jsonrpc: "2.0", id: id++, method: "tools/list", params: {} });
  const tools = new Map(listed.tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "hivemind_office_status",
    "hivemind_office_inspect_document",
    "hivemind_office_open_document",
    "hivemind_office_prepare_update",
    "hivemind_office_apply_update",
  ]) {
    assert.ok(tools.has(name), `${name} should be listed by the bundled MCP server`);
    assert.ok(tools.get(name).title, `${name} should expose an MCP title`);
  }
  assert.equal(tools.get("hivemind_office_status").annotations.readOnlyHint, true);
  assert.equal(tools.get("hivemind_office_apply_update").annotations.destructiveHint, true);
  assert.equal(tools.get("hivemind_office_apply_update").annotations.openWorldHint, false);

  const statusRequest = await callTool("hivemind_office_status", {});
  assert.equal(statusRequest.method, "GET");
  assert.equal(statusRequest.url, "/api/hivemind-office");

  const inspectRequest = await callTool("hivemind_office_inspect_document", {
    path: "/Users/example/report.docx",
    includeText: false,
  });
  assert.equal(inspectRequest.method, "POST");
  assert.deepEqual(inspectRequest.body, {
    action: "inspect",
    path: "/Users/example/report.docx",
    includeText: false,
  });

  const openRequest = await callTool("hivemind_office_open_document", { path: "/Users/example/candidate.docx" });
  assert.deepEqual(openRequest.body, { action: "open", path: "/Users/example/candidate.docx" });

  const prepareRequest = await callTool("hivemind_office_prepare_update", {
    originalPath: "/Users/example/report.docx",
    candidatePath: "/Users/example/candidate.docx",
  });
  assert.equal(prepareRequest.body.action, "prepare-update");
  assert.equal(prepareRequest.body.mode, "copy");

  const hashes = {
    expectedOriginalSha256: "a".repeat(64),
    expectedCandidateSha256: "b".repeat(64),
    reviewFingerprint: "c".repeat(64),
  };
  await assert.rejects(
    callTool("hivemind_office_apply_update", {
      originalPath: "/Users/example/report.docx",
      candidatePath: "/Users/example/candidate.docx",
      ...hashes,
      confirmation: "CONFIRM_HIVEMIND_OFFICE_REPLACE_ORIGINAL",
    }),
    /copy requires confirmation CONFIRM_HIVEMIND_OFFICE_SAVE_COPY/,
  );

  const applyCopy = await callTool("hivemind_office_apply_update", {
    originalPath: "/Users/example/report.docx",
    candidatePath: "/Users/example/candidate.docx",
    destinationPath: "/Users/example/report reviewed.docx",
    ...hashes,
    confirmation: "CONFIRM_HIVEMIND_OFFICE_SAVE_COPY",
  });
  assert.equal(applyCopy.body.action, "apply-update");
  assert.equal(applyCopy.body.mode, "copy");
  assert.equal(applyCopy.body.confirmation, "CONFIRM_HIVEMIND_OFFICE_SAVE_COPY");

  const applyReplace = await callTool("hivemind_office_apply_update", {
    originalPath: "/Users/example/report.docx",
    candidatePath: "/Users/example/candidate.docx",
    mode: "replace-original",
    ...hashes,
    confirmation: "CONFIRM_HIVEMIND_OFFICE_REPLACE_ORIGINAL",
  });
  assert.equal(applyReplace.body.mode, "replace-original");
  assert.equal(applyReplace.body.confirmation, "CONFIRM_HIVEMIND_OFFICE_REPLACE_ORIGINAL");
} catch (error) {
  if (stderr.trim()) error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  throw error;
} finally {
  mcp.kill();
  fake.server.close();
}

console.log("Hivemind Office MCP descriptors, annotations, confirmation preflight, and dashboard routing tests passed.");
