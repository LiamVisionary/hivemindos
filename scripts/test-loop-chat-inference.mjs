#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
register(new URL("./lib/json-esm-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-loop-chat-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = join(tempHome, "missing-vault");

const captured = [];
const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/api/fleet/apps")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ apps: [] }));
    return;
  }
  if (request.url?.startsWith("/v1/chat/completions")) {
    const body = await readRequestBody(request);
    captured.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"index":0,"delta":{"content":"Loop-ready context received."},"finish_reason":null}]}\n\n');
    response.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});

try {
  await listen(server);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  const { NextRequest } = await import("next/server");
  const chatRoute = await import("../src/app/api/chat/agent-runtime/route.ts");
  const { loopEngineeringRequest, requiresCapabilityRouting } = await import("../src/lib/services/chat/task-retrieval-context.ts");

  const prompts = [
    "Fix the flaky OAuth refresh test. Keep retrying until lint, typecheck, and the focused test are clean, then hand off if auth blocks you.",
    "Every weekday morning, scan AI agent funding news, cite sources, and deliver a short brief with receipts.",
    "Build a tiny receipt viewer, smoke it in the browser, judge the result, and stop if cost or risk gets weird.",
  ];

  for (const prompt of prompts) {
    assert(!/\bloop(?:ed|ing|s)?\b/i.test(prompt), "fixture prompt should not say loop explicitly");
    assert.equal(loopEngineeringRequest(prompt), true, "loop-shaped prompt should be classified for loop engineering");
    assert.equal(requiresCapabilityRouting(prompt), true, "loop-shaped prompt should trigger chat capability routing");
    const before = captured.length;
    const response = await chatRoute.POST(new NextRequest(`${origin}/api/chat/agent-runtime`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent: {
          id: `loop-chat-${before}`,
          name: "Loop Chat Fixture",
          runtime: "hivemind-os",
          provider: "mock",
          model: "mock-loop-model",
          gatewayUrl: origin,
          chatPath: "/v1/chat/completions",
          runtimeCapabilities: { chat: true },
          workerClass: "code",
        },
        messages: [{ role: "user", content: prompt }],
        sharedVault: { enabled: false },
        agentMode: "act",
        chatStorageKey: `loop-chat-thread-${before}`,
      }),
    }));
    assert.equal(response.status, 200);
    const streamed = await response.text();
    assert.match(streamed, /Loop-ready context received/);
    assert.equal(captured.length, before + 1, "mock chat runtime should receive one request");
    const systemMessage = captured.at(-1).messages.find((message) => message.role === "system");
    assert(systemMessage, "chat route should inject a system message for hivemind-os runtime");
    assert.match(systemMessage.content, /Loop engineering readiness/);
    assert.match(systemMessage.content, /Loop-shaped task routing/);
    assert.match(systemMessage.content, /Work Board loop-engineering work/);
    assert.match(systemMessage.content, /For loop-shaped requests/);
    assert.match(systemMessage.content, /no local command\/file\/browser execution tool is exposed/);
    assert.match(systemMessage.content, /\/api\/loops/);
    assert.match(systemMessage.content, /L0-L3 loop audits/);
    assert.match(systemMessage.content, /Work Board/);
  }

  console.log("loop chat inference tests passed");
} finally {
  await close(server).catch(() => undefined);
  await rm(tempHome, { recursive: true, force: true });
}

function listen(serverInstance) {
  return new Promise((resolve, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(0, "127.0.0.1", () => {
      serverInstance.off("error", reject);
      resolve();
    });
  });
}

function close(serverInstance) {
  return new Promise((resolve, reject) => {
    if (!serverInstance.listening) {
      resolve();
      return;
    }
    serverInstance.close((error) => error ? reject(error) : resolve());
  });
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}
