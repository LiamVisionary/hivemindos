import { NextRequest, NextResponse } from "next/server";

import { openAICompatibleInferenceCacheHints } from "@/lib/services/chat/inference-cache-hints";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

/**
 * Thin OpenAI-compatible proxy for the in-page Page Agent (alibaba/page-agent).
 *
 * Why this route exists at all: Page Agent runs in the browser and drives the
 * dashboard's own DOM. To pick an action it POSTs a standard OpenAI
 * `/chat/completions` body that INCLUDES `tools` + `tool_choice` and expects the
 * model to answer with a raw `tool_calls` array. Every other HivemindOS LLM path
 * (the agent-runtime SSE loop, the paid-agent / wallet-paid gateways) runs its
 * OWN internal tool loop and strips the caller's `tools`/`tool_choice`, flattening
 * the reply to plain text — which would leave Page Agent's forced tool-call parse
 * with nothing to parse. So this route's single job is to forward the browser's
 * completion body VERBATIM (tools intact) to a tool-capable upstream and return
 * the upstream reply unchanged.
 *
 * Auth: this sits behind the dashboard gate in `src/proxy.ts`. A logged-in
 * browser session reaches it with its normal session cookie, exactly like every
 * other dashboard -> /api call; provider keys never leave the server.
 *
 * Phase 1: upstream is fixed to OpenRouter (a tool-capable provider whose key is
 * already in the shared hive env). Generalizing to "whichever agent the user is
 * currently using" is a deliberate fast-follow — see the design brief. Not every
 * runtime/provider can drive Page Agent (CLI runtimes, hive-fusion, and the
 * text-flattening wrappers cannot), so the caller must be gated to a tool-capable
 * OpenAI provider before it ever reaches here.
 */

const UPSTREAM_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY_ENV = "OPENROUTER_API_KEY";
// Tool-capable default; the client may override via the request `model`.
// NOTE: `openai/gpt-4o-mini` is rejected by this OpenRouter account's data /
// privacy policy ("no endpoints matching your guardrail restrictions"), so the
// default is a verified-working, policy-compliant, tool-capable, cheap model.
// Override with PAGE_AGENT_MODEL, or (for the real integration) the caller's
// active model.
const DEFAULT_MODEL =
  process.env.PAGE_AGENT_MODEL?.trim() || "qwen/qwen3-235b-a22b-2507";
const REQUEST_TIMEOUT_MS = 120_000;

type OpenAIChatCompletionBody = {
  model?: string;
  messages?: unknown[];
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: unknown;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | OpenAIChatCompletionBody
    | null;
  if (!body || typeof body !== "object") {
    return jsonError("An OpenAI-compatible chat completion body is required.", 400);
  }
  if (!Array.isArray(body.messages)) {
    return jsonError("`messages` must be an array.", 400);
  }

  const apiKey = (await hiveEnvValue(OPENROUTER_KEY_ENV).catch(() => "")).trim();
  if (!apiKey) {
    return jsonError(
      `Page Agent needs a tool-capable model provider. Set ${OPENROUTER_KEY_ENV} in the shared hive env (hive-env-add).`,
      503,
    );
  }

  // Forward the caller's body verbatim — the whole point is that `tools` and
  // `tool_choice` survive. We only fill a default model and force non-streaming
  // (Page Agent's OpenAI client issues a single non-streaming tool call).
  const model = (typeof body.model === "string" && body.model.trim()) || DEFAULT_MODEL;
  const cacheHints = openAICompatibleInferenceCacheHints({
    provider: "openrouter",
    model,
    cacheScope: "page-agent",
  });
  const upstreamBody: OpenAIChatCompletionBody = {
    ...body,
    model,
    stream: false,
    ...cacheHints.body,
  };

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter attribution headers (optional, recommended).
        "HTTP-Referer": "https://hivemindos.local/page-agent",
        "X-Title": "HivemindOS Page Agent",
        ...cacheHints.headers,
      },
      body: JSON.stringify(upstreamBody),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Page Agent model request timed out."
        : error instanceof Error
          ? error.message
          : "Page Agent model request failed.";
    return jsonError(message, 504);
  }

  const text = await upstream.text();
  // Pass the upstream reply straight through (JSON when possible) so Page Agent's
  // client parses the real `tool_calls` array. Preserve the upstream status.
  const json = safeJson(text);
  if (json !== undefined) {
    return NextResponse.json(json, {
      status: upstream.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "text/plain",
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error: { message: error } }, { status });
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
