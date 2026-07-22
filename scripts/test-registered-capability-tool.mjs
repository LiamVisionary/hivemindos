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
  capabilityInoperableNotice,
  capabilityInvocationCorrectiveSystemPrompt,
  createCapabilityToolHealth,
  invokeHiveCapabilityRuntimeEvent,
  invokeHiveCapabilityToolDefinition,
  plannedHiveActionIds,
  runInvokeHiveCapabilityTool,
} = await import("../src/app/api/chat/agent-runtime/invoke-hive-capability-tool.ts");
const { capabilityApprovalContinuationPrompt } = await import("../src/lib/services/chat/capability-approval.ts");
const { CAPABILITY_APPROVAL_CONTINUATION_MARKER } = await import("../src/lib/types/capability-approval.ts");

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

// --- Capability-plan invocation hardening (weak tool-calling models) ---
// Confirmed failure 2026-07-18: the free Scout model made five
// invoke_hive_capability calls that all failed validation on missing
// surface/capabilityId even though the approved plan continuation named the
// exact capability, then confabulated a diagnosis. The plan block in the
// latest user message now supplies defaults for the addressing fields.

const plannedUserText = [
  CAPABILITY_APPROVAL_CONTINUATION_MARKER,
  "HivemindOS selected the only ready capability automatically. Continue the original task now.",
  "Selected capability map:",
  "- Social: Read social posts (already available)",
  "  Capability id: hive-action:social.posts-read",
].join("\n");

{
  // The parser must understand the real continuation prompt the planner emits,
  // not a hand-mirrored copy — guards generator↔parser format drift.
  const generated = capabilityApprovalContinuationPrompt({
    version: 1,
    reviewMode: "automatic",
    id: "plan-1",
    task: "create a flappy bird clone",
    agentId: "agent-1",
    agentName: "Agent",
    chatStorageKey: "chat-1",
    chatLeaf: "leaf-1",
    status: "approved",
    items: [{
      id: "item-1",
      intent: "app-builder",
      label: "App workspace",
      reason: "Create a durable project.",
      candidates: [{
        id: "hive-action:apps.build",
        name: "Create app workspace",
        summary: "Create and run a durable local app project.",
        kind: "hive-action",
        availability: "ready",
        locator: "/api/app-builder",
      }],
      selectedCapabilityId: "hive-action:apps.build",
      decision: "use",
    }],
    createdAt: 1,
  });
  assert.deepEqual(plannedHiveActionIds(generated), ["apps.build"]);
  assert.deepEqual(plannedHiveActionIds(plannedUserText), ["social.posts-read"]);
  assert.deepEqual(plannedHiveActionIds("please invoke hive-action:apps.build for me"), [], "ids without the approval marker never produce defaults");
}

{
  // Missing surface, operation, and capabilityId all default from the plan;
  // the invocation still runs through the normal read path.
  const test = harness({ actions: [readSocialAction, publishSocialAction] });
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    arguments: { limit: 3 },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: plannedUserText,
  }, test.dependencies);
  assert.equal(test.requests.length, 1, "plan defaults address the planned capability");
  assert.match(test.requests[0].url, /\/api\/social\/posts\?limit=3$/);
  assert.match(result.toolResultContent, /post-3/);
}

{
  // Plan defaults must NOT bypass the mutating-action approval gate: a planned
  // mutating action with defaulted identifiers still returns approvalRequired.
  const publishPlanText = plannedUserText.replace("social.posts-read", "social.posts-publish");
  const test = harness({ actions: [readSocialAction, publishSocialAction] });
  const blocked = await runInvokeHiveCapabilityTool(JSON.stringify({
    arguments: { text: "Hello social world" },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: publishPlanText,
  }, test.dependencies);
  assert.equal(test.requests.length, 0, "defaulted identifiers keep the confirmation gate");
  assert.match(blocked.toolResultContent, /approvalRequired/);
  assert.match(blocked.toolResultContent, /CONFIRM_SOCIAL_POST/);
}

{
  // Surface synonyms from weak models normalize instead of hard-failing.
  const test = harness({ actions: [readSocialAction, publishSocialAction] });
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "hive-action",
    operation: "invoke",
    capabilityId: "social.posts-read",
    arguments: { limit: 1 },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Read one social post.",
  }, test.dependencies);
  assert.equal(test.requests.length, 1);
  assert.match(result.toolResultContent, /post-3/);
}

{
  // An explicitly named but unknown capability is not silently redirected to
  // the plan; the failure carries the exact corrective JSON shape instead.
  const test = harness({ actions: [readSocialAction, publishSocialAction] });
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "hive_action",
    operation: "invoke",
    capabilityId: "wallet",
    arguments: { limit: 1 },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: plannedUserText,
  }, test.dependencies);
  assert.equal(test.requests.length, 0);
  assert.equal(result.ok, false);
  assert.equal(result.invalidRequest, true);
  const payload = JSON.parse(result.toolResultContent);
  assert.match(payload.correction, /"capabilityId":"social\.posts-read"/);
  assert.deepEqual(payload.plannedCapabilities, ["hive-action:social.posts-read"]);
}

{
  // Without a plan the strict validation errors are unchanged and carry no
  // correction, but they are flagged as invalid requests for the runtime.
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    operation: "invoke",
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "create a flappy bird clone",
  }, harness().dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.invalidRequest, true);
  assert.match(result.fallbackText, /surface must be mcp, connected_app, or hive_action/);
  assert.doesNotMatch(result.toolResultContent, /correction/);
  // The persisted process event carries the real error text, not a generic badge.
  const event = invokeHiveCapabilityRuntimeEvent(result);
  assert.equal(event.message, "Hive capability failed");
  assert.match(event.detail, /surface must be mcp, connected_app, or hive_action/);
  assert.match(event.detail, /nothing was run/i);
}

{
  // Real execution failures surface their upstream error text in the event detail.
  const failingDependencies = {
    ...harness({ actions: [readSocialAction] }).dependencies,
    fetcher: async () => jsonResponse({ ok: false, error: "collector offline" }, 502),
  };
  const result = await runInvokeHiveCapabilityTool(JSON.stringify({
    surface: "hive_action",
    operation: "invoke",
    capabilityId: "social.posts-read",
    arguments: { limit: 1 },
  }), {
    origin: "http://127.0.0.1:5021",
    permissionMode: "manual",
    userText: "Read one social post.",
  }, failingDependencies);
  assert.equal(result.ok, false);
  const event = invokeHiveCapabilityRuntimeEvent(result);
  assert.match(event.detail, /collector offline/, "the chat badge shows the real failure text");
}

{
  // The non-stream tool loop forwards corrective steering messages to the
  // model on the continuation round (real behavior, not just source text).
  const { runNonStreamToolConversation } = await import("../src/app/api/chat/agent-runtime/non-stream-tool-conversation.ts");
  const continuationBodies = [];
  const result = await runNonStreamToolConversation({
    initialToolCalls: [{ id: "call_1", name: INVOKE_HIVE_CAPABILITY_TOOL_NAME, arguments: "{}" }],
    request: {
      url: "http://model.test/v1/chat/completions",
      headers: {},
      messages: [{ role: "user", content: "create a flappy bird clone" }],
      model: "test-model",
      provider: "test",
      sentTools: true,
      cacheBody: {},
      inferenceBody: {},
    },
    toolDefinitions: [invokeHiveCapabilityToolDefinition()],
    maxToolRounds: 2,
    timeoutMs: 5_000,
    runToolCalls: async () => ({
      events: [],
      assistantToolCalls: [{ id: "call_1", type: "function", function: { name: INVOKE_HIVE_CAPABILITY_TOOL_NAME, arguments: "{}" } }],
      toolResultMessages: [{ role: "tool", tool_call_id: "call_1", content: JSON.stringify({ ok: false, error: "invalid" }) }],
      fallbacks: ["Capability call failed."],
      finalTexts: [],
      failures: ["Capability call failed."],
      prompted: false,
      steeringMessages: [{ role: "system", content: capabilityInvocationCorrectiveSystemPrompt(["apps.build"]) }],
    }),
    fetcher: async (_url, init) => {
      continuationBodies.push(JSON.parse(init.body));
      return jsonResponse({ choices: [{ message: { content: "done" } }] });
    },
  });
  assert.equal(result.text, "done");
  const steering = continuationBodies[0].messages.filter((message) => (
    message.role === "system" && /failing validation/.test(String(message.content))
  ));
  assert.equal(steering.length, 1, "the corrective system nudge reaches the model on the continuation round");
  assert.equal(continuationBodies[0].messages.at(-1).role, "system", "the nudge lands after the round's tool results");
  assert.equal(continuationBodies[0].messages.at(-2).role, "tool", "tool results still precede the nudge");
}

{
  const corrective = capabilityInvocationCorrectiveSystemPrompt(["apps.build"]);
  assert.match(corrective, /"surface":"hive_action"/);
  assert.match(corrective, /capabilityId "apps\.build"/);
  assert.match(corrective, /do not invent a different explanation/i);
  const notice = capabilityInoperableNotice(5);
  assert.match(notice, /5 invalid capability tool calls/);
  assert.match(notice, /stronger tool-calling model/);
}

{
  // Health tracker: the nudge fires once per streak of 2+ malformed calls and
  // the terminal notice only when nothing executed.
  const nudges = [];
  const health = createCapabilityToolHealth({ plannedCapabilityIds: ["apps.build"], onCorrectiveNudge: (count) => nudges.push(count) });
  const invalid = { ok: false, invalidRequest: true, toolResultContent: "{}", fallbackText: "invalid" };
  health.track(invalid);
  assert.equal(health.correctiveSystemMessage(), null, "one malformed call is not yet a streak");
  health.track(invalid);
  const nudge = health.correctiveSystemMessage();
  assert.equal(nudge?.role, "system");
  assert.match(String(nudge?.content), /failing validation/);
  assert.equal(health.correctiveSystemMessage(), null, "the nudge fires once per streak");
  assert.deepEqual(nudges, [2]);
  assert.match(health.inoperableFinalNotice(), /2 invalid capability tool calls/);
  health.track({ ok: true, toolResultContent: "{}", fallbackText: "done" });
  assert.equal(health.inoperableFinalNotice(), "", "an executed capability suppresses the inoperable notice");
}

{
  const streamSource = readFileSync(new URL("../src/app/api/chat/agent-runtime/stream-openai-compatible.ts", import.meta.url), "utf8");
  const retrievalSource = readFileSync(new URL("../src/lib/services/chat/task-retrieval-context.ts", import.meta.url), "utf8");
  assert.match(streamSource, /invokeHiveCapabilityToolDefinition\(\)/, "the native runtime advertises the provider-neutral executor");
  assert.match(streamSource, /runInvokeHiveCapabilityTool\(call\.arguments/, "the native runtime executes model-selected registered capabilities");
  assert.match(streamSource, /plannedCapabilities: plannedCapabilityIds/, "both runtime call sites thread the approved capability plan");
  assert.match(streamSource, /capabilityHealth\.correctiveSystemMessage\(\)/, "repeated malformed calls trigger the corrective system nudge");
  assert.match(streamSource, /capabilityHealth\.inoperableFinalNotice\(\)/, "runs ending with zero executed capabilities append the honest notice");
  const nonStreamSource = readFileSync(new URL("../src/app/api/chat/agent-runtime/non-stream-tool-conversation.ts", import.meta.url), "utf8");
  assert.match(nonStreamSource, /steeringMessages/, "the non-stream loop forwards corrective steering messages");
  assert.match(retrievalSource, /capability id:/, "retrieval includes canonical executable capability ids");
  assert.match(retrievalSource, /capabilityId=\$\{hiveActionId\}/, "retrieval maps Hive Action hits to generic invocation coordinates");
  assert.match(retrievalSource, /untrustedContextMessage\("Connected MCP capability inventory"/, "external MCP schemas are wrapped as untrusted prompt data");
}

console.log("registered capability tool tests passed");
