import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const { z } = await import("zod");
const {
  buildConnectedMcpCapabilityContext,
} = await import("../src/lib/services/mcp/capability-context.ts");
const {
  INVOKE_HIVE_CAPABILITY_TOOL_NAME,
  invokeHiveCapabilityToolDefinition,
  runInvokeHiveCapabilityTool,
} = await import("../src/app/api/chat/agent-runtime/invoke-hive-capability-tool.ts");

const connectedMcpStatus = {
  enabled: true,
  servers: [{
    id: "social-reader",
    transport: "http",
    connectedAt: 1,
    tools: [{
      name: "list_my_posts",
      description: "Read the authenticated user's recent social posts.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    }, {
      name: "publish_post",
      description: "Publish a post to the authenticated social account.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    }],
  }],
};

{
  const context = buildConnectedMcpCapabilityContext(connectedMcpStatus);
  assert.match(context, /social-reader/);
  assert.match(context, /list_my_posts/);
  assert.match(context, /authenticated user's recent social posts/);
  assert.match(context, /read-only/i);
  assert.doesNotMatch(context, /follow|ignore|system prompt/i, "the inventory remains data-only");
}

{
  const definition = invokeHiveCapabilityToolDefinition();
  assert.equal(definition.function.name, INVOKE_HIVE_CAPABILITY_TOOL_NAME);
  assert.deepEqual(definition.function.parameters.properties.surface.enum, ["mcp", "connected_app", "hive_action"]);
  assert.deepEqual(definition.function.parameters.properties.operation.enum, ["list", "invoke"]);
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function harness({ status = connectedMcpStatus, actions = [] } = {}) {
  const requests = [];
  return {
    requests,
    dependencies: {
      authHeaders: () => ({ "x-test-auth": "1" }),
      fetcher: async (url, init = {}) => {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url: String(url), method: init.method, body });
        if (String(url).includes("/api/mcp/client")) {
          return jsonResponse({ ok: true, result: { posts: [{ id: "post-2", text: "Observed" }] } });
        }
        if (String(url).includes("/api/fleet/apps/request")) {
          return jsonResponse({ ok: true, comments: [{ id: "comment-1", text: "Nice work" }] });
        }
        return jsonResponse({ ok: true, data: [{ id: "post-3", text: "From the Hive Action" }], collectorIp: "100.81.250.107" });
      },
      listActions: () => actions,
      mcpStatus: () => status,
      readSharedEnv: async () => ({}),
    },
  };
}

{
  const test = harness();
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "mcp",
    operation: "invoke",
    serverId: "social-reader",
    toolName: "list_my_posts",
    arguments: { limit: 2 },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Show my recent social posts.",
  }, test.dependencies);
  assert.equal(test.requests.length, 1);
  assert.equal(test.requests[0].url, "http://127.0.0.1:5021/api/mcp/client");
  assert.deepEqual(test.requests[0].body, {
    action: "call-tool",
    id: "social-reader",
    name: "list_my_posts",
    args: { limit: 2 },
  });
  assert.match(result.toolResultContent, /post-2/);
}

{
  const test = harness();
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "mcp",
    operation: "invoke",
    serverId: "social-reader",
    toolName: "publish_post",
    arguments: { text: "Do not publish this" },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Publish this.",
  }, test.dependencies);
  assert.equal(test.requests.length, 0, "mutating MCP tools must not run in manual mode without a confirmation contract");
  assert.match(result.toolResultContent, /approvalRequired/);
}

{
  const test = harness();
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "mcp",
    operation: "invoke",
    serverId: "social-reader",
    toolName: "publish_post",
    arguments: { text: "Approved through the chat permission control" },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "bypass",
    userText: "Run the approved action.",
  }, test.dependencies);
  assert.equal(test.requests.length, 1, "Bypass permission may execute the exact pending MCP mutation");
  assert.equal(test.requests[0].body.name, "publish_post");
  assert.match(result.toolResultContent, /post-2/);
}

{
  const test = harness();
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "connected_app",
    operation: "invoke",
    appId: "social-app",
    method: "GET",
    path: "/api/comments/latest",
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Read the latest comment.",
  }, test.dependencies);
  assert.equal(test.requests.length, 1);
  assert.equal(test.requests[0].url, "http://127.0.0.1:5021/api/fleet/apps/request");
  assert.equal(test.requests[0].body.method, "GET");
  assert.match(result.toolResultContent, /comment-1/);
}

{
  const test = harness();
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "connected_app",
    operation: "invoke",
    appId: "social-app",
    method: "POST",
    path: "/api/posts",
    arguments: { text: "Do not publish this" },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Publish this.",
  }, test.dependencies);
  assert.equal(test.requests.length, 0, "raw app POSTs must stay permission-gated");
  assert.match(result.toolResultContent, /approvalRequired/);
}

const readSocialAction = {
  id: "social.posts-read",
  title: "Read social posts",
  description: "Read posts from a connected social API.",
  schema: z.object({ limit: z.number().optional() }),
  sideEffects: ["read", "network"],
  risk: "low",
  tags: ["social"],
  readOnly: true,
  contextIndex: {
    summary: "Read social posts.",
    retrievalText: "Read recent social posts.",
    route: "/api/social/posts",
    methods: ["GET"],
  },
};

const publishSocialAction = {
  id: "social.posts-publish",
  title: "Publish social post",
  description: "Publish a post through a connected social API.",
  schema: z.object({ text: z.string(), confirmation: z.string().optional() }),
  sideEffects: ["network", "public-message"],
  risk: "high",
  tags: ["social"],
  confirmation: {
    token: "CONFIRM_SOCIAL_POST",
    reason: "Publishing makes content public.",
    when: "always",
  },
  contextIndex: {
    summary: "Publish a social post.",
    retrievalText: "Publish a post only after confirmation.",
    route: "/api/social/posts",
    methods: ["POST"],
  },
};

{
  const test = harness({ actions: [readSocialAction, publishSocialAction] });
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "hive_action",
    operation: "invoke",
    capabilityId: "hive-action:social.posts-read",
    arguments: { limit: 3 },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Read three social posts.",
  }, test.dependencies);
  assert.equal(test.requests.length, 1);
  assert.match(test.requests[0].url, /\/api\/social\/posts\?limit=3$/);
  assert.match(result.toolResultContent, /post-3/);
  assert.doesNotMatch(result.toolResultContent, /100\.81\.250\.107/);
  assert.match(result.toolResultContent, /<tailnet-ip>/);
}

{
  const test = harness({ actions: [readSocialAction, publishSocialAction] });
  const blocked = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "hive_action",
    operation: "invoke",
    capabilityId: "social.posts-publish",
    arguments: { text: "Hello social world" },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Publish hello social world.",
  }, test.dependencies);
  assert.equal(test.requests.length, 0);
  assert.match(blocked.toolResultContent, /CONFIRM_SOCIAL_POST/);

  const confirmed = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "hive_action",
    operation: "invoke",
    capabilityId: "social.posts-publish",
    arguments: { text: "Hello social world" },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "CONFIRM_SOCIAL_POST",
  }, test.dependencies);
  assert.equal(test.requests.length, 1);
  assert.equal(test.requests[0].body.confirmation, "CONFIRM_SOCIAL_POST");
  assert.match(confirmed.toolResultContent, /post-3/);
}

{
  const streamSource = readFileSync(new URL("../src/app/api/chat/agent-runtime/stream-openai-compatible.ts", import.meta.url), "utf8");
  const retrievalSource = readFileSync(new URL("../src/lib/services/chat/task-retrieval-context.ts", import.meta.url), "utf8");
  assert.match(streamSource, /invokeHiveCapabilityToolDefinition\(\)/, "the native runtime advertises the provider-neutral executor");
  assert.match(streamSource, /runInvokeHiveCapabilityTool\(call\.arguments/, "the native runtime executes model-selected registered capabilities");
  assert.match(retrievalSource, /capability id:/, "retrieval includes canonical executable capability ids");
  assert.match(retrievalSource, /capabilityId=\$\{hiveActionId\}/, "retrieval maps Hive Action hits to generic invocation coordinates");
  assert.match(retrievalSource, /untrustedContextMessage\("Connected MCP capability inventory"/, "external MCP schemas are wrapped as untrusted prompt data");
}

console.log("registered capability tool tests passed");
