import "server-only";

import { clawbankApiToken, clawbankMcpUrl } from "./client";
import type { ClawbankMcpCallResult, ClawbankMcpTool } from "./types";

/**
 * ClawBank MCP (JSON-RPC) discovery client.
 *
 * ClawBank's REST docs are intentionally partial: they document auth and a few
 * bodies, then defer the authoritative, per-account surface to MCP `tools/list`
 * and capability `*_guide` tools. This client speaks the Streamable HTTP MCP
 * transport — `initialize` (capturing any `Mcp-Session-Id`), an optional
 * `notifications/initialized`, then `tools/list` / `tools/call` — and parses
 * both plain-JSON and SSE (`text/event-stream`) responses.
 *
 * NOTE (inferred, not verified against the live server — no token in this env):
 * the handshake follows the MCP spec the docs reference. If a server rejects
 * the pre-handshake `tools/list`, {@link clawbankMcpRpc} retries after a full
 * initialize. The REST typed methods in ./client remain the verified-shape
 * path; this MCP layer powers generic discovery and the long-tail capabilities.
 */

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_TIMEOUT_MS = 60_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Parse an MCP HTTP response that may be JSON or an SSE stream. Returns the
 *  first JSON-RPC message object found (the response to our single request). */
async function parseMcpBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await response.text();
  if (!text) return null;
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        return JSON.parse(payload);
      } catch {
        // keep scanning for a parseable data line
      }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type McpRpcOutcome = {
  ok: boolean;
  result: unknown;
  error: string;
  sessionId: string;
  status: number;
};

async function postRpc(
  url: string,
  token: string,
  body: Record<string, unknown>,
  sessionId: string,
): Promise<{ response: Response; parsed: unknown } | { error: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ClawBank MCP request failed." };
  }
  const parsed = await parseMcpBody(response);
  return { response, parsed };
}

function rpcId(): string {
  // Deterministic-enough unique id without Math.random/Date (unavailable in
  // workflow scripts and discouraged); per-call counter is sufficient.
  rpcCounter += 1;
  return `cb-${rpcCounter}`;
}
let rpcCounter = 0;

/**
 * Send one JSON-RPC method to the ClawBank MCP endpoint. Performs a full
 * `initialize` handshake first (carrying the returned session id) so stateful
 * servers accept the call; falls back gracefully if the server is stateless.
 */
export async function clawbankMcpRpc(
  method: string,
  params: Record<string, unknown> = {},
  options: { token?: string; url?: string } = {},
): Promise<McpRpcOutcome> {
  const token = (options.token ?? (await clawbankApiToken())).trim();
  if (!token) {
    return { ok: false, result: null, error: "No ClawBank credential is configured.", sessionId: "", status: 0 };
  }
  const url = options.url ?? (await clawbankMcpUrl());

  // 1) initialize
  const initOut = await postRpc(url, token, {
    jsonrpc: "2.0",
    id: rpcId(),
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "hivemindos", version: "0.1.0" },
    },
  }, "");
  if ("error" in initOut) {
    return { ok: false, result: null, error: initOut.error, sessionId: "", status: 0 };
  }
  const sessionId = initOut.response.headers.get("mcp-session-id")?.trim() ?? "";
  const initParsed = asRecord(initOut.parsed);
  if (initParsed.error) {
    return { ok: false, result: null, error: rpcErrorMessage(initParsed.error), sessionId, status: initOut.response.status };
  }

  // 2) notifications/initialized (best-effort; some servers require it).
  await postRpc(url, token, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId).catch(() => undefined);

  // 3) the actual method
  const callOut = await postRpc(url, token, {
    jsonrpc: "2.0",
    id: rpcId(),
    method,
    params,
  }, sessionId);
  if ("error" in callOut) {
    return { ok: false, result: null, error: callOut.error, sessionId, status: 0 };
  }
  const parsed = asRecord(callOut.parsed);
  if (parsed.error) {
    return { ok: false, result: null, error: rpcErrorMessage(parsed.error), sessionId, status: callOut.response.status };
  }
  return { ok: true, result: parsed.result ?? null, error: "", sessionId, status: callOut.response.status };
}

function rpcErrorMessage(error: unknown): string {
  const record = asRecord(error);
  return stringValue(record.message) || "ClawBank MCP error.";
}

/** Discover the authoritative live tool surface for this account. */
export async function clawbankListMcpTools(
  options: { token?: string } = {},
): Promise<{ ok: boolean; tools: ClawbankMcpTool[]; error: string }> {
  const outcome = await clawbankMcpRpc("tools/list", {}, options);
  if (!outcome.ok) return { ok: false, tools: [], error: outcome.error };
  const result = asRecord(outcome.result);
  const list = Array.isArray(result.tools) ? result.tools : [];
  const tools: ClawbankMcpTool[] = list.map((entry) => {
    const record = asRecord(entry);
    return {
      name: stringValue(record.name),
      description: stringValue(record.description),
      inputSchema: record.inputSchema ? (asRecord(record.inputSchema) as Record<string, unknown>) : null,
      annotations: record.annotations ? (asRecord(record.annotations) as Record<string, unknown>) : null,
    };
  }).filter((tool) => tool.name);
  return { ok: true, tools, error: "" };
}

/** Invoke a discovered MCP tool by name. `isError` is folded into `ok`. */
export async function clawbankCallMcpTool(
  name: string,
  args: Record<string, unknown> = {},
  options: { token?: string } = {},
): Promise<ClawbankMcpCallResult> {
  const outcome = await clawbankMcpRpc("tools/call", { name, arguments: args }, options);
  if (!outcome.ok) {
    return { ok: false, isError: true, structuredContent: null, content: null, error: outcome.error, raw: null };
  }
  const result = asRecord(outcome.result);
  const isError = result.isError === true;
  return {
    ok: !isError,
    isError,
    structuredContent: result.structuredContent ?? null,
    content: result.content ?? null,
    error: isError ? mcpCallErrorText(result) : "",
    raw: outcome.result,
  };
}

function mcpCallErrorText(result: Record<string, unknown>): string {
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content
      .map((block) => stringValue(asRecord(block).text))
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }
  return "ClawBank MCP tool reported an error.";
}
