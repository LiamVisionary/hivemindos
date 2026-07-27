#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const appUrl = process.env.HIVEMINDOS_APP_URL || "http://127.0.0.1:5021";
const child = spawn(process.execPath, ["scripts/hivemind-mcp"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, HIVEMINDOS_APP_URL: appUrl },
  stdio: ["pipe", "pipe", "pipe"],
});

let nextId = 1;
let output = "";
let stderr = "";
const pending = new Map();

child.stderr.on("data", (chunk) => { stderr += String(chunk); });
child.stdout.on("data", (chunk) => {
  output += String(chunk);
  const lines = output.split("\n");
  output = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  }
});

function request(method, params = {}, timeoutMs = 210_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function call(name, args) {
  return request("tools/call", { name, arguments: args });
}

try {
  await request("initialize");
  const listed = await request("tools/list");
  for (const name of ["web_search", "web_fetch", "web_crawl", "web_screenshot"]) {
    assert.ok(listed.tools.some((tool) => tool.name === name), `${name} should be listed`);
  }

  const search = await call("web_search", { query: "Example Domain IANA", maxResults: 3 });
  assert.ok(search.structuredContent, "web_search should return structured content");

  const fetched = await call("web_fetch", { url: "https://example.com", maxChars: 2_000 });
  assert.ok(fetched.structuredContent, "web_fetch should return structured content");

  const crawled = await call("web_crawl", {
    url: "https://example.com",
    maxPages: 1,
    maxDepth: 0,
    maxTotalChars: 2_000,
    deadlineMs: 20_000,
  });
  assert.ok(crawled.structuredContent, "web_crawl should return structured content");

  const screenshot = await call("web_screenshot", { url: "https://example.com", fullPage: true });
  assert.ok(screenshot.content.some((item) => item.type === "image" && item.data && item.mimeType === "image/png"), "web_screenshot should return an MCP image block");
  assert.ok(existsSync(screenshot.structuredContent.path), "web_screenshot should persist its guarded local artifact");

  await assert.rejects(
    () => call("web_fetch", { url: "http://127.0.0.1:5021/api/web-research" }),
    /public|private|global|allowed|address|host/i,
    "web_fetch should reject private-network targets",
  );

  console.log("Real Hivemind MCP web research path passed search, fetch, crawl, screenshot, and SSRF rejection.");
} catch (error) {
  if (stderr.trim()) error.message = `${error.message}\nMCP stderr:\n${stderr}`;
  throw error;
} finally {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timeout);
    waiter.reject(new Error("MCP process closed."));
  }
  pending.clear();
  child.kill();
}
