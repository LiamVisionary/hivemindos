#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { spawnSync } from "node:child_process";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const { listHiveActions, listMcpHiveActions } = await import("../src/lib/services/hive-actions/index.ts");
const { runInvokeHiveCapabilityTool } = await import("../src/app/api/chat/agent-runtime/invoke-hive-capability-tool.ts");

const actions = listHiveActions();
const expected = new Map([
  ["web.search", "web_search"],
  ["web.fetch", "web_fetch"],
  ["web.crawl", "web_crawl"],
  ["web.screenshot", "web_screenshot"],
]);

for (const [id, toolName] of expected) {
  const action = actions.find((candidate) => candidate.id === id);
  assert.ok(action, `${id} should be registered as a Hive Action`);
  assert.equal(action.readOnly, true, `${id} should be read-only`);
  assert.deepEqual(action.sideEffects, ["read", "network"], `${id} should declare only passive network reads`);
  assert.equal(action.risk, "low", `${id} should remain low risk`);
  assert.equal(action.mcp?.toolName, toolName, `${id} should expose its canonical tool name`);
  assert.match(action.contextIndex?.route || "", /^\/api\/web-research\//, `${id} should use the guarded API route`);
}

const tools = new Map(listMcpHiveActions(actions).map((tool) => [tool.name, tool]));
for (const toolName of expected.values()) {
  const tool = tools.get(toolName);
  assert.ok(tool, `${toolName} should be exported through the shared Hivemind MCP`);
  assert.ok(tool.title, `${toolName} should include an MCP title`);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.annotations.openWorldHint, true);
}

{
  const requests = [];
  const outcome = await runInvokeHiveCapabilityTool({
    surface: "hive_action",
    operation: "invoke",
    capabilityId: "web.search",
    arguments: { query: "runtime-independent research" },
  }, {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Search the web for runtime-independent research.",
  }, {
    authHeaders: () => ({ "x-test-auth": "1" }),
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, result: { results: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    listActions: () => actions,
    mcpStatus: () => ({ enabled: true, servers: [] }),
    readSharedEnv: async () => ({}),
  });
  assert.equal(requests.length, 1, "native chat should invoke the registered web action exactly once");
  assert.equal(requests[0].url, "http://127.0.0.1:5021/api/web-research/search");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), { query: "runtime-independent research" });
  assert.match(outcome.toolResultContent, /results/);
}

const fetchSchema = JSON.stringify(tools.get("web_fetch")?.inputSchema);
for (const forbidden of ["actions", "cookies", "extra_headers", "proxy", "useragent", "respect_robots"]) {
  assert.ok(!fetchSchema.includes(forbidden), `web_fetch must not expose upstream ${forbidden}`);
}
assert.match(fetchSchema, /pages/, "web_fetch should expose bounded PDF page ranges");
assert.match(fetchSchema, /focus/, "web_fetch should expose focused extraction");

const crawlSchema = JSON.stringify(tools.get("web_crawl")?.inputSchema);
for (const requiredBound of ["maxPages", "maxDepth", "maxTotalChars", "deadlineMs"]) {
  assert.ok(crawlSchema.includes(requiredBound), `web_crawl should expose ${requiredBound}`);
}

const installer = readFileSync(new URL("./install-web-research.mjs", import.meta.url), "utf8");
assert.match(installer, /PACKAGE_VERSION = "11\.1\.6"/);
assert.match(installer, /EXPECTED_SHA256 = "7deb3ac10b8cd48aeff093bb41beb94b16e173b2a12a97678345820b12b7f4fa"/);
assert.match(installer, /playwright", "install", "chromium"/);
assert.doesNotMatch(installer, /hound\s+-u|--update/, "HivemindOS must not expose Hound self-update");

const guard = readFileSync(new URL("./web-research/hound_guard.py", import.meta.url), "utf8");
assert.match(guard, /address\.is_global/);
assert.match(guard, /follow_redirects=False/);
assert.match(guard, /_create_route_handler/);
assert.match(guard, /Credentials embedded in URLs are not allowed/);

const python = process.platform === "win32" ? "py" : "python3";
const pythonArgs = process.platform === "win32" ? ["-3", "-"] : ["-"];
const guardProbe = spawnSync(python, pythonArgs, {
  input: `import sys\nsys.path.insert(0, ${JSON.stringify(new URL("./web-research", import.meta.url).pathname)})\nfrom hound_guard import validate_public_url\nblocked = ["http://127.0.0.1", "http://[::1]", "http://169.254.169.254/latest/meta-data", "http://user:pass@example.com"]\nfor value in blocked:\n    try:\n        validate_public_url(value)\n    except ValueError:\n        continue\n    raise SystemExit("allowed unsafe URL: " + value)\n`,
  encoding: "utf8",
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
});
assert.equal(guardProbe.status, 0, guardProbe.stderr || guardProbe.stdout);

const mcp = readFileSync(new URL("./hivemind-mcp", import.meta.url), "utf8");
for (const toolName of expected.values()) assert.ok(mcp.includes(`name === "${toolName}"`), `${toolName} should route through Hivemind MCP`);
assert.match(mcp, /type: "image", data: imageData/, "web_screenshot should return an MCP image block");

const setup = readFileSync(new URL("../setup.sh", import.meta.url), "utf8");
const uninstall = readFileSync(new URL("../uninstall.sh", import.meta.url), "utf8");
const setupPs = readFileSync(new URL("../setup.ps1", import.meta.url), "utf8");
const uninstallPs = readFileSync(new URL("../uninstall.ps1", import.meta.url), "utf8");
for (const source of [setup, setupPs]) assert.match(source, /install-web-research\.mjs/);
for (const source of [uninstall, uninstallPs]) assert.match(source, /web-research-state\.json/);

console.log("Runtime-independent guarded web research tests passed.");
