#!/usr/bin/env node
// Real optional-provider E2E: Next route -> service -> audited binary -> managed
// graph cache -> normalized route response. This intentionally performs a local
// index write and never contacts a model/provider.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const { NextRequest } = await import("next/server");
const { POST } = await import("../src/app/api/code-intelligence/route.ts");

const repoPath = process.cwd();
const mode = ["fast", "moderate", "full"].includes(process.env.CODE_INTEL_E2E_MODE)
  ? process.env.CODE_INTEL_E2E_MODE
  : "full";

async function post(body) {
  const response = await POST(new NextRequest("http://127.0.0.1:5021/api/code-intelligence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoPath, ...body }),
  }));
  const data = await response.json();
  assert.equal(response.status, 200, data.error ?? `HTTP ${response.status}`);
  assert.equal(data.ok, true, data.error ?? "code-intelligence request failed");
  return data;
}

const before = await post({ action: "status" });
assert.equal(before.providers["codebase-memory"].availability, "available", "real engine is installed and healthy");

const indexed = process.env.CODE_INTEL_E2E_SKIP_INDEX === "1"
  ? null
  : await post({ action: "index-repository", mode, persistence: false });
if (indexed) {
  assert.equal(indexed.status, "indexed");
  assert.equal(indexed.meta.provider, "codebase-memory");
  assert.ok(indexed.nodes > 0, "persistent graph has nodes");
  assert.ok(indexed.edges > 0, "persistent graph has edges");
}

const after = await post({ action: "status" });
assert.equal(after.graphReady, true, JSON.stringify(after.providers["codebase-memory"]));
assert.equal(after.activeProvider, "codebase-memory", JSON.stringify(after.providers["codebase-memory"]));
assert.equal(after.providers["codebase-memory"].version, "0.10.2");

const search = await post({ action: "search-graph", query: "submitQueenBeeMessage", limit: 30 });
assert.equal(search.meta.provider, "codebase-memory");
assert.ok(search.nodes.some((node) => node.name === "submitQueenBeeMessage" || node.qualifiedName?.includes("submitQueenBeeMessage")), "graph finds the Queen Bee submission call chain");

const symbol = search.nodes.find((node) => node.kind === "Function" && node.qualifiedName?.includes("submitQueenBeeMessage"))
  ?? search.nodes.find((node) => node.filePath && node.qualifiedName?.includes("submitQueenBeeMessage"))
  ?? search.nodes[0];
const trace = await post({ action: "trace-path", functionName: symbol.qualifiedName ?? "submitQueenBeeMessage", direction: "both", depth: 3 });
assert.equal(trace.meta.provider, "codebase-memory");
assert.ok(Array.isArray(trace.callers));
assert.ok(Array.isArray(trace.callees));

const snippet = await post({ action: "get-code-snippet", qualifiedName: symbol.qualifiedName, includeNeighbors: true });
assert.equal(snippet.meta.provider, "codebase-memory");
assert.match(snippet.source, /submitQueenBeeMessage/);

const architecture = await post({ action: "get-architecture", aspects: ["languages", "routes", "entry_points"] });
assert.equal(architecture.meta.provider, "codebase-memory");
assert.ok(architecture.totalNodes > 0);

const envFiles = await post({ action: "search-graph", filePattern: "(^|/)\\.env(\\.|$)", limit: 20 });
assert.equal(envFiles.nodes.length, 0, "secret-bearing .env files are absent from the graph");

const changes = await post({ action: "detect-changes", baseRef: "HEAD", scope: "files", depth: 1 });
assert.equal(changes.meta.provider, "codebase-memory");
assert.ok(changes.touchedFiles.includes("src/lib/services/queen-bee/task-loop-policy.ts"), "real diff impact sees this task's new policy module");

console.log(`Real code-intelligence E2E passed (${mode}, ${indexed?.nodes ?? after.providers["codebase-memory"].nodes} nodes, ${indexed?.edges ?? after.providers["codebase-memory"].edges} edges).`);
