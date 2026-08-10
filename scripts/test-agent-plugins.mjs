#!/usr/bin/env node

import { register } from "node:module";
import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureServer = join(repoRoot, "scripts", "lib", "mcp-fixture-server.mjs");
const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-agent-plugins-"));
const tempHome = join(tempRoot, "home");
const vault = join(tempRoot, "vault");
const plugin = join(tempRoot, "plugin");
const outside = join(tempRoot, "outside");
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.AGENT_PLUGIN_SHOULD_NOT_INHERIT = "secret";
process.env.HIVEMINDOS_AGENT_PLUGIN_DATA_ROOT = join(
  tempHome,
  ".hivemindos",
  "agent-plugins",
  "data",
);

function skillMarkdown(name, description, body = "# Skill\n") {
  return [
    "---",
    "name: " + name,
    "description: " + description,
    "---",
    "",
    body,
  ].join("\n");
}

function shellQuote(value) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function localUrl(server, path) {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}${path}`;
}

let redirectedHeaderForwarded = false;
let httpServerFailure = "";
let httpServerStatus = 0;
const httpServer = createServer(async (request, response) => {
  response.on("finish", () => { httpServerStatus = response.statusCode; });
  if (request.headers["x-redirect-test"]) redirectedHeaderForwarded = true;
  try {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const message = JSON.parse(raw);
    if (!("id" in message)) {
      response.writeHead(202).end();
      return;
    }
    const result = message.method === "initialize"
      ? {
          protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "http-fixture", version: "1.0.0" },
        }
      : message.method === "tools/list"
        ? { tools: [{ name: "http-echo", description: "HTTP fixture", inputSchema: { type: "object" } }] }
        : message.method === "tools/call"
          ? { content: [{ type: "text", text: "http echo" }] }
          : {};
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  } catch (error) {
    httpServerFailure = error instanceof Error ? error.message : String(error);
    response.writeHead(500).end(httpServerFailure);
  }
});
await listen(httpServer);
const httpEndpoint = localUrl(httpServer, "/mcp");
const redirectServer = createServer((_request, response) => {
  response.writeHead(307, { location: httpEndpoint });
  response.end();
});
await listen(redirectServer);

async function write(path, content, mode) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  if (mode) await chmod(path, mode);
}

await mkdir(tempHome, { recursive: true });
const realTempHome = await realpath(tempHome);
await mkdir(vault, { recursive: true });
await write(join(outside, "SKILL.md"), skillMarkdown("escape", "Must never be loaded."));
await write(join(outside, "outside.txt"), "outside");
await mkdir(plugin, { recursive: true });
await symlink(outside, join(plugin, "escape-dir"));
await write(
  join(plugin, "plugin.json"),
  JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "conformance-plugin",
    version: "1.2.3",
    description: "Agent Plugins conformance fixture.",
    extensions: {
      "com.example.client": {
        ignored: true,
      },
    },
    unknownField: "reported and ignored",
  }, null, 2),
);
await write(
  join(plugin, "skills", "summarize", "SKILL.md"),
  skillMarkdown("summarize", "Summarizes text. Use when a concise summary is requested."),
);
await write(join(plugin, "skills", "summarize", "references", "inside.txt"), "inside");
await symlink(join(outside, "outside.txt"), join(plugin, "skills", "summarize", "references", "outside.txt"));
await write(
  join(plugin, "skills", "bad-name", "SKILL.md"),
  skillMarkdown("different-name", "This skill is intentionally invalid."),
);
await mkdir(join(plugin, "skills", "escape"), { recursive: true });
await symlink(join(outside, "SKILL.md"), join(plugin, "skills", "escape", "SKILL.md"));
await write(
  join(plugin, "skills", "group", "nested", "SKILL.md"),
  skillMarkdown("nested", "A nested skill that fixed discovery must ignore."),
);
await write(join(plugin, "config.json"), "{}");
await write(
  join(plugin, "bin", "server"),
  [
    "#!/bin/sh",
    "[ \"$CONFIG\" = \"$PLUGIN_ROOT/config.json\" ] || exit 71",
    "[ \"$PWD\" = \"$PLUGIN_DATA\" ] || exit 72",
    "[ -z \"$AGENT_PLUGIN_SHOULD_NOT_INHERIT\" ] || exit 73",
    "exec /usr/bin/env node " + shellQuote(fixtureServer),
    "",
  ].join("\n"),
  0o755,
);
await write(
  join(plugin, "mcp.json"),
  JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      local: {
        type: "stdio",
        command: "./bin/server",
        env: {
          CONFIG: "\${PLUGIN_ROOT}/config.json",
        },
        cwd: "\${PLUGIN_DATA}",
      },
      http: {
        type: "streamable-http",
        url: httpEndpoint,
        headers: {
          "X-Direct": "yes",
        },
      },
      redirected: {
        type: "streamable-http",
        url: localUrl(redirectServer, "/redirect"),
        headers: {
          "X-Redirect-Test": "must-not-forward",
        },
      },
      escaping: {
        type: "stdio",
        command: "./../outside/server",
      },
      escapingCwd: {
        type: "stdio",
        command: "./bin/server",
        cwd: "./escape-dir/missing",
      },
      insecureRemote: {
        type: "streamable-http",
        url: "http://example.com/mcp",
      },
      legacy: {
        type: "sse",
        url: "https://example.com/sse",
      },
    },
  }, null, 2),
);

const loader = await import("../src/lib/services/agent-plugins/loader.ts");
const runtime = await import("../src/lib/services/agent-plugins/runtime.ts");
const mcp = await import("../src/lib/services/mcp/client.ts");

try {
  const inspection = await loader.inspectAgentPlugin(plugin);
  assert.equal(
    loader.expandAgentPluginValue("\${PLUGIN_ROOT}:\${PLUGIN_DATA}", "/tmp/\${PLUGIN_DATA}", "/data"),
    "/tmp/\${PLUGIN_DATA}:/data",
    "placeholder expansion must be single-pass and non-recursive",
  );
  assert.deepEqual(
    loader.agentPluginHttpHeaders({ Accept: "text/plain", "Mcp-Session-Id": "package", "X-Tenant": "public" }),
    { "X-Tenant": "public" },
    "client-generated HTTP and MCP headers must take precedence",
  );
  assert.equal(inspection.valid, true, "valid root manifest should load despite an unknown top-level field");
  assert.equal(inspection.manifest?.name, "conformance-plugin");
  assert.deepEqual(inspection.skills.map((skill) => skill.name), ["summarize"], "only immediate, valid, contained skills load");
  assert.deepEqual(inspection.mcpServers.map((server) => server.name).sort(), ["http", "local", "redirected"], "invalid and unsupported MCP entries are isolated");
  assert.ok(inspection.diagnostics.some((item) => item.code === "manifest-field-ignored"));
  assert.ok(inspection.diagnostics.some((item) => item.code === "extensions-ignored"));
  assert.ok(inspection.diagnostics.some((item) => item.code === "skill-spec-invalid"));
  assert.ok(inspection.diagnostics.some((item) => item.code === "skill-path-invalid"));
  assert.ok(inspection.diagnostics.some((item) => item.code === "mcp-server-semantics-invalid"));
  assert.ok(inspection.diagnostics.some((item) => item.code === "mcp-transport-unsupported"));

  const invalidManifestRoot = join(tempRoot, "invalid-manifest");
  await write(join(invalidManifestRoot, "plugin.json"), JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "Bad Name",
  }));
  const invalidManifest = await loader.inspectAgentPlugin(invalidManifestRoot);
  assert.equal(invalidManifest.valid, false, "fatal manifest schema violations reject the whole plugin");

  const invalidMcpRoot = join(tempRoot, "invalid-mcp");
  await write(join(invalidMcpRoot, "plugin.json"), JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "skills-survive",
  }));
  await write(
    join(invalidMcpRoot, "skills", "survivor", "SKILL.md"),
    skillMarkdown("survivor", "Remains available when the MCP component is invalid."),
  );
  await write(join(invalidMcpRoot, "mcp.json"), JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {},
    unknown: true,
  }));
  const invalidMcp = await loader.inspectAgentPlugin(invalidMcpRoot);
  assert.equal(invalidMcp.valid, true);
  assert.deepEqual(invalidMcp.skills.map((skill) => skill.name), ["survivor"]);
  assert.equal(invalidMcp.mcpServers.length, 0);
  assert.ok(invalidMcp.diagnostics.some((item) => item.code === "mcp-top-level-invalid"));

  const firstLoad = await runtime.loadAgentPlugin({ pluginPath: plugin, vaultPath: vault });
  assert.equal(firstLoad.loaded, true);
  assert.equal(firstLoad.plugin?.skills[0]?.status, "installed");
  assert.equal(firstLoad.plugin?.mcpServers.find((server) => server.name === "local")?.status, "connected");
  assert.ok(firstLoad.plugin?.mcpServers.find((server) => server.name === "local")?.tools?.some((tool) => tool.name === "echo"));
  const httpLoad = firstLoad.plugin?.mcpServers.find((server) => server.name === "http");
  assert.equal(httpLoad?.status, "connected", [httpLoad?.error, httpServerFailure, `HTTP ${httpServerStatus}`].filter(Boolean).join("; "));
  assert.ok(firstLoad.plugin?.mcpServers.find((server) => server.name === "http")?.tools?.some((tool) => tool.name === "http-echo"));
  assert.equal(firstLoad.plugin?.mcpServers.find((server) => server.name === "redirected")?.status, "failed");
  assert.equal(redirectedHeaderForwarded, false, "plugin headers must not cross an HTTP redirect");
  assert.ok(
    firstLoad.plugin?.pluginDataPath.startsWith(realTempHome),
    "PLUGIN_DATA should be client-managed under the test home; received " + firstLoad.plugin?.pluginDataPath,
  );
  await accessFile(join(vault, "Skills", "agent-plugins", "conformance-plugin", "summarize", "SKILL.md"));
  await assert.rejects(
    () => lstat(join(vault, "Skills", "agent-plugins", "conformance-plugin", "summarize", "references", "outside.txt")),
    "out-of-root resource symlinks must not be imported",
  );
  assert.ok(firstLoad.plugin?.diagnostics.some((item) => item.code === "skill-resource-denied"));

  await write(
    join(plugin, "skills", "summarize", "SKILL.md"),
    skillMarkdown("summarize", "Summarizes text after a plugin update. Use for concise summaries."),
  );
  const secondLoad = await runtime.loadAgentPlugin({ pluginPath: plugin, vaultPath: vault });
  assert.equal(secondLoad.plugin?.skills[0]?.status, "updated");
  assert.ok(secondLoad.plugin?.skills[0]?.archivePath);
  await accessFile(secondLoad.plugin.skills[0].archivePath);
  const installedMarkdown = await readFile(
    join(vault, "Skills", "agent-plugins", "conformance-plugin", "summarize", "SKILL.md"),
    "utf8",
  );
  assert.match(installedMarkdown, /after a plugin update/);

  const unloaded = await runtime.unloadAgentPlugin(plugin);
  assert.equal(unloaded.unloaded, true);
  assert.equal(mcp.mcpClientStatus().servers.some((server) => server.id.includes("conformance-plugin")), false);
  console.log("Agent Plugins conformance tests passed.");
} finally {
  await mcp.disconnectAllMcpServers().catch(() => {});
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => redirectServer.close(resolve));
  await rm(tempRoot, { recursive: true, force: true });
}

async function accessFile(path) {
  const item = await lstat(path);
  assert.ok(item.isFile() || item.isDirectory());
}
