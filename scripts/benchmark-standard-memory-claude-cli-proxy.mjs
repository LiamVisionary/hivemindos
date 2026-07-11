#!/usr/bin/env node

// Dev-only loopback adapter: exposes an OpenAI-compatible /v1/chat/completions
// endpoint that answers by shelling out to the local Claude Code CLI. It exists
// only so scripts/benchmark-standard-memory-evaluate.py (which speaks the OpenAI
// chat-completions wire format) can drive `claude-sonnet-5` for the standard
// memory benchmarks without adding a model client to the production app.
//
// It NEVER reads or exports Claude's OAuth credential: it spawns `claude`, which
// resolves its own login internally. It refuses to bind to anything but the
// loopback interface. Per-request it runs exactly:
//
//   claude -p --model <model> --output-format json --tools "" --no-session-persistence
//
// with the flattened system+user prompt delivered on stdin, and maps the CLI's
// JSON envelope back to an OpenAI chat.completion (including real token usage).

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const CLAUDE_BIN = process.env.CLAUDE_CLI_BIN || process.env.CLAUDE_CODE_EXECPATH || "claude";

function parseArgs(argv) {
  const args = { host: "127.0.0.1", port: 8766, timeoutMs: 300_000, maxInFlight: 6 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--host") args.host = argv[++index];
    else if (argv[index] === "--port") args.port = Number(argv[++index]);
    else if (argv[index] === "--timeout-ms") args.timeoutMs = Number(argv[++index]);
    else if (argv[index] === "--max-in-flight") args.maxInFlight = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (args.host !== "127.0.0.1") throw new Error("The Claude CLI benchmark proxy must stay bound to 127.0.0.1");
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65_535) throw new Error("--port must be between 1024 and 65535");
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1_000) throw new Error("--timeout-ms must be at least 1000");
  if (!Number.isInteger(args.maxInFlight) || args.maxInFlight < 1 || args.maxInFlight > 16) throw new Error("--max-in-flight must be 1-16");
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
    if (bytes > 32 * 1024 * 1024) throw new Error("Request body exceeds the 32 MiB benchmark limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function flattenPrompt(messages) {
  if (!Array.isArray(messages)) throw new Error("messages must be an array");
  const systemParts = [];
  const turnParts = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") throw new Error("messages must contain objects");
    const role = String(message.role ?? "");
    const content = String(message.content ?? "");
    if (!new Set(["system", "user", "assistant"]).has(role)) throw new Error(`Unsupported message role: ${role}`);
    if (role === "system") systemParts.push(content);
    else turnParts.push(content);
  }
  const system = systemParts.join("\n\n").trim();
  const turns = turnParts.join("\n\n").trim();
  return system ? `${system}\n\n${turns}` : turns;
}

// Run the exact specified command; deliver the prompt on stdin so large
// retrieval contexts never hit an argv length limit.
function runClaude(model, prompt, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const startedAt = performance.now();
    const child = spawn(
      CLAUDE_BIN,
      ["-p", "--model", model, "--output-format", "json", "--tools", "", "--no-session-persistence"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to spawn ${CLAUDE_BIN}: ${error.message}`));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const latencyMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const rawOut = Buffer.concat(stdout).toString("utf8").trim();
      const rawErr = Buffer.concat(stderr).toString("utf8").trim();
      let envelope;
      try {
        envelope = JSON.parse(rawOut);
      } catch {
        reject(new Error(`claude CLI produced non-JSON output (exit ${code}): ${rawErr || rawOut.slice(0, 400) || "<empty>"}`));
        return;
      }
      resolveRun({ envelope, latencyMs, code, rawErr });
    });
    child.stdin.end(prompt);
  });
}

function usageFromEnvelope(usage) {
  const u = usage && typeof usage === "object" ? usage : {};
  const input = Number(u.input_tokens || 0);
  const cacheRead = Number(u.cache_read_input_tokens || 0);
  const cacheCreate = Number(u.cache_creation_input_tokens || 0);
  const output = Number(u.output_tokens || 0);
  const promptTokens = input + cacheRead + cacheCreate;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: output,
    total_tokens: promptTokens + output,
    prompt_tokens_details: { cached_tokens: cacheRead },
  };
}

const args = parseArgs(process.argv.slice(2));

let inFlight = 0;
const waiters = [];
async function acquire() {
  if (inFlight < args.maxInFlight) { inFlight += 1; return; }
  await new Promise((r) => waiters.push(r));
  inFlight += 1;
}
function release() {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) next();
}

const server = createServer((request, response) => {
  void (async () => {
    if (request.method === "GET" && request.url === "/health") {
      json(response, 200, { ok: true, authMode: "claude-cli", model: "claude-sonnet-5", bin: CLAUDE_BIN, devOnly: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      json(response, 404, { error: { message: "Not found" } });
      return;
    }
    const body = await readJson(request);
    const model = String(body.model ?? "").trim();
    if (!model) throw new Error("model is required");
    const prompt = flattenPrompt(body.messages);
    await acquire();
    let result;
    try {
      result = await runClaude(model, prompt, args.timeoutMs);
    } finally {
      release();
    }
    const { envelope, latencyMs } = result;
    // Surface a CLI/auth failure honestly instead of returning an empty answer.
    if (envelope.is_error || envelope.subtype !== "success" || typeof envelope.result !== "string") {
      json(response, 502, {
        error: {
          message: `claude CLI error: ${envelope.result ?? envelope.subtype ?? "unknown"}`,
          type: "claude_cli_error",
          subtype: envelope.subtype ?? null,
        },
      });
      return;
    }
    json(response, 200, {
      id: `claude-cli-${randomUUID()}`,
      object: "chat.completion",
      model,
      provider: "Claude CLI",
      choices: [{ index: 0, message: { role: "assistant", content: envelope.result }, finish_reason: "stop" }],
      usage: usageFromEnvelope(envelope.usage),
      benchmark: {
        authMode: "claude-cli",
        devOnly: true,
        latencyMs,
        cliDurationMs: Number(envelope.duration_ms || 0),
        totalCostUsd: Number(envelope.total_cost_usd || 0),
      },
    });
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    json(response, 502, { error: { message } });
  });
});

server.listen(args.port, args.host, () => {
  console.log(JSON.stringify({ ok: true, host: args.host, port: args.port, authMode: "claude-cli", bin: CLAUDE_BIN, devOnly: true }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
