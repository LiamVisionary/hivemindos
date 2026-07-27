#!/usr/bin/env node

import { createServer } from "node:http";
import { register } from "node:module";
import { randomUUID } from "node:crypto";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { openAiOAuthStatus, runOpenAiOAuthChatTurn } = await import(
  "../src/lib/services/openai-oauth.ts"
);

function parseArgs(argv) {
  const args = { host: "127.0.0.1", port: 8765, timeoutMs: 180_000 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--host") args.host = argv[++index];
    else if (argv[index] === "--port") args.port = Number(argv[++index]);
    else if (argv[index] === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (args.host !== "127.0.0.1") throw new Error("The OAuth benchmark proxy must stay bound to 127.0.0.1");
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65_535) throw new Error("--port must be between 1024 and 65535");
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1_000) throw new Error("--timeout-ms must be at least 1000");
  return args;
}

function json(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw new Error("Request body exceeds the 8 MiB benchmark limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) throw new Error("messages must be an array");
  return value.map((message) => {
    if (!message || typeof message !== "object") throw new Error("messages must contain objects");
    const role = String(message.role ?? "");
    const content = String(message.content ?? "");
    if (!new Set(["system", "user", "assistant"]).has(role)) throw new Error(`Unsupported message role: ${role}`);
    return { role, content };
  });
}

const args = parseArgs(process.argv.slice(2));
const status = await openAiOAuthStatus();
if (!status.connected) throw new Error("ChatGPT OAuth is not connected");

const server = createServer((request, response) => {
  void (async () => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { ok: true, authMode: "chatgpt-oauth", devOnly: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      json(response, 404, { error: { message: "Not found" } });
      return;
    }
    const body = await readJson(request);
    const model = String(body.model ?? "").trim();
    if (!model) throw new Error("model is required");
    const startedAt = performance.now();
    const text = await runOpenAiOAuthChatTurn(model, normalizeMessages(body.messages), {
      timeoutMs: args.timeoutMs,
    });
    json(response, 200, {
      id: `chatgpt-oauth-${randomUUID()}`,
      object: "chat.completion",
      model,
      provider: "ChatGPT OAuth",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: null,
      benchmark: {
        authMode: "chatgpt-oauth",
        devOnly: true,
        latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
        tokenUsageUnavailable: true,
      },
    });
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    json(response, 502, { error: { message } });
  });
});

server.listen(args.port, args.host, () => {
  console.log(JSON.stringify({ ok: true, host: args.host, port: args.port, authMode: "chatgpt-oauth", devOnly: true }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
