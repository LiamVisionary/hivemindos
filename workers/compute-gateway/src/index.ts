type Env = {
  DB: D1Database;
  BANKR_LLM_KEY?: string;
  BANKR_MANAGEMENT_KEY?: string;
  BANKR_LLM_BASE_URL?: string;
  DEFAULT_MODEL?: string;
  HONEY_LEDGER_URL?: string;
  HONEY_LEDGER_SECRET?: string;
  HONEY_BILLING_SECRET?: string;
  HONEY_LEDGER_READ_TOKEN?: string;
  MANAGED_HONEY_CREDITS_PER_USD?: string;
  MANAGED_AGENT_MARKUP_BPS?: string;
  MANAGED_AGENT_USD_PER_1K_TOKENS?: string;
  ALLOW_SHARED_BANKR_KEY?: string;
  DAILY_TOKEN_CAP?: string;
  CORS_ORIGIN?: string;
};

type ChatMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string }>;
};

type GatewayRequest = {
  workspaceId?: string;
  agentId?: string;
  agentName?: string;
  runtime?: string;
  model?: string;
  bankrLlmKey?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
};

type LedgerReceipt = {
  eventId: string;
  issuerId: string;
  workspaceId: string;
  agentId: string;
  tokensUsed: number;
  model: string;
  source: string;
  timestamp: string;
  signature: string;
};

type LedgerSubmitResult = {
  ok: boolean;
  honeyDelta: number;
  error?: string;
};

type ManagedHoneyQuote = {
  honeyAmount: number;
  retailUsd: number;
  upstreamUsd: number;
  markupBps: number;
  unitUsd: number;
};

const corsHeaders = (env: Env) => ({
  "Access-Control-Allow-Origin": env.CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Hivemind-Workspace-Id,X-Hivemind-Agent-Id,X-Hivemind-Agent-Name,X-Bankr-LLM-Key",
});

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(env, { ok: true, service: "hivemindos-compute-gateway" });
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      return handleChat(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      return handleOpenAIChatCompletions(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      return proxyModels(request, env);
    }

    return json(env, { ok: false, error: "Not found." }, 404);
  },
};

export default worker;

async function handleChat(request: Request, env: Env) {
  if (!env.HONEY_LEDGER_SECRET) return sse(env, { error: "Trusted compute gateway is missing HONEY_LEDGER_SECRET." }, 500);

  const body = await request.json().catch(() => null) as GatewayRequest | null;
  const bankrKey = cleanSecret(body?.bankrLlmKey) || sharedBankrKey(env);
  if (!bankrKey) {
    return sse(env, {
      error: "Honey rewards need your own Bankr LLM key. Add Bankr LLM credits funded with HIVE, set BANKR_LLM_KEY locally, then retry.",
    }, 402);
  }
  const workspaceId = cleanId(body?.workspaceId ?? "");
  const agentId = cleanId(body?.agentId ?? "");
  const model = cleanId(body?.model ?? env.DEFAULT_MODEL ?? "gpt-5.4-mini");
  const messages = Array.isArray(body?.messages) ? body.messages : [];

  if (!workspaceId || !agentId || messages.length === 0) {
    return sse(env, { error: "Missing workspaceId, agentId, or messages." }, 400);
  }

  const promptTokens = estimateTokens(JSON.stringify(messages));
  const cap = positiveInteger(env.DAILY_TOKEN_CAP, 50_000);
  const current = await readDailyUsage(env, workspaceId);
  if (current + promptTokens > cap) {
    return sse(env, { error: `Daily reward compute cap reached for this workspace (${cap.toLocaleString()} tokens).` }, 429);
  }

  const upstream = await fetch(env.BANKR_LLM_BASE_URL ?? "https://llm.bankr.bot/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bankrKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  const data = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
  if (!upstream.ok) {
    return sse(env, { error: extractError(data) || `Compute gateway upstream returned ${upstream.status}.` }, upstream.status);
  }

  const outputText = extractAssistantText(data);
  const usageTokens = extractUsageTokens(data) ?? estimateTokens(`${JSON.stringify(messages)}\n${outputText}`);
  const acceptedTokens = Math.max(1, Math.min(usageTokens, Math.max(0, cap - current)));
  await addDailyUsage(env, workspaceId, acceptedTokens);

  const receipt = await signedReceipt(env, {
    eventId: crypto.randomUUID(),
    issuerId: "hivemindos-compute-gateway",
    workspaceId,
    agentId,
    tokensUsed: acceptedTokens,
    model,
    source: "trusted-compute-gateway",
    timestamp: new Date().toISOString(),
  });
  const submitted = await submitHoneyReceipt(env, receipt);
  if (!submitted.ok) return sse(env, { error: submitted.error }, 502);
  await env.DB.prepare(
    "INSERT INTO compute_events (event_id, workspace_id, agent_id, model, tokens_used, honey_delta) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(receipt.eventId, workspaceId, agentId, model, acceptedTokens, submitted.honeyDelta).run();

  return new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: outputText } }] })}`,
      "",
      `data: ${JSON.stringify({ honey: { id: receipt.eventId, agentId, agentName: body?.agentName, kind: "usage", source: "chat", tokensUsed: acceptedTokens, honeyDelta: submitted.honeyDelta, hiveDelta: 0, createdAt: receipt.timestamp } })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...corsHeaders(env),
      },
    },
  );
}

async function handleOpenAIChatCompletions(request: Request, env: Env) {
  if (!env.HONEY_LEDGER_SECRET) return openAIError(env, "Trusted compute gateway is missing HONEY_LEDGER_SECRET.", 500);

  const body = await request.json().catch(() => null) as GatewayRequest | null;
  const auth = parseRewardAuth(request, body, env);
  if (!auth.bankrKey) {
    return openAIError(env, "Reward compute needs a Bankr LLM key. Use Authorization: Bearer bk_... or a Hivemind reward key.", 402);
  }

  const model = cleanId(body?.model ?? env.DEFAULT_MODEL ?? "gpt-5.4-mini");
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) return openAIError(env, "Missing messages.", 400);

  const promptTokens = estimateTokens(JSON.stringify(messages));
  const cap = positiveInteger(env.DAILY_TOKEN_CAP, 50_000);
  const current = await readDailyUsage(env, auth.workspaceId);
  if (current + promptTokens > cap) {
    return openAIError(env, `Daily reward compute cap reached for this workspace (${cap.toLocaleString()} tokens).`, 429);
  }
  const estimatedManagedQuote = quoteManagedHoney(env, Math.max(promptTokens, Number(body?.max_tokens ?? body?.max_completion_tokens ?? 0) || promptTokens));
  if (auth.usesManagedHoney) {
    const hasBudget = await hasManagedHoneyBudget(env, auth.workspaceId, auth.agentId, estimatedManagedQuote.honeyAmount);
    if (!hasBudget) return openAIError(env, "Add managed HONEY credits before using HivemindOS-managed provider keys.", 402);
  }

  const upstream = await fetch(env.BANKR_LLM_BASE_URL ?? "https://llm.bankr.bot/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.bankrKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...body,
      model,
      messages,
      stream: false,
    }),
  });

  const data = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
  if (!upstream.ok) return openAIError(env, extractError(data) || `Compute gateway upstream returned ${upstream.status}.`, upstream.status);

  const outputText = extractAssistantText(data);
  const usageTokens = extractUsageTokens(data) ?? estimateTokens(`${JSON.stringify(messages)}\n${outputText}`);
  const acceptedTokens = Math.max(1, Math.min(usageTokens, Math.max(0, cap - current)));
  await addDailyUsage(env, auth.workspaceId, acceptedTokens);
  const managedHoney = auth.usesManagedHoney
    ? await submitManagedHoneyDebit(env, {
      workspaceId: auth.workspaceId,
      agentId: auth.agentId,
      tokensUsed: acceptedTokens,
      model,
      quote: quoteManagedHoney(env, acceptedTokens),
    })
    : null;

  const receipt = await signedReceipt(env, {
    eventId: crypto.randomUUID(),
    issuerId: "hivemindos-reward-gateway",
    workspaceId: auth.workspaceId,
    agentId: auth.agentId,
    tokensUsed: acceptedTokens,
    model,
    source: "verified-reward-gateway",
    timestamp: new Date().toISOString(),
  });
  const submitted = await submitHoneyReceipt(env, receipt);
  if (!submitted.ok) return openAIError(env, submitted.error ?? "Honey ledger rejected trusted receipt.", 502);
  await env.DB.prepare(
    "INSERT INTO compute_events (event_id, workspace_id, agent_id, model, tokens_used, honey_delta) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(receipt.eventId, auth.workspaceId, auth.agentId, model, acceptedTokens, submitted.honeyDelta).run();

  const responseBody = openAIChatResponse(data, {
    id: receipt.eventId,
    model,
    outputText,
    tokensUsed: acceptedTokens,
    honeyDelta: submitted.honeyDelta,
  });

  if (body?.stream === true) {
    return openAIStream(env, responseBody, {
      id: receipt.eventId,
      agentId: auth.agentId,
      agentName: auth.agentName,
      tokensUsed: acceptedTokens,
      honeyDelta: submitted.honeyDelta,
      createdAt: receipt.timestamp,
      managedHoney,
    });
  }

  return json(env, {
    ...responseBody,
    ...(managedHoney ? { managedHoney } : {}),
    honey: {
      id: receipt.eventId,
      agentId: auth.agentId,
      agentName: auth.agentName,
      kind: "usage",
      source: "verified-reward-gateway",
      tokensUsed: acceptedTokens,
      honeyDelta: submitted.honeyDelta,
      hiveDelta: 0,
      createdAt: receipt.timestamp,
    },
  });
}

async function proxyModels(request: Request, env: Env) {
  const auth = parseRewardAuth(request, null, env);
  if (!auth.bankrKey) return openAIError(env, "Reward compute needs a Bankr LLM key.", 402);
  const baseUrl = (env.BANKR_LLM_BASE_URL ?? "https://llm.bankr.bot/v1/chat/completions").replace(/\/chat\/completions\/?$/, "");
  const upstream = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${auth.bankrKey}` },
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", ...corsHeaders(env) },
  });
}

async function readDailyUsage(env: Env, workspaceId: string) {
  const row = await env.DB.prepare("SELECT tokens_used FROM workspace_daily_usage WHERE workspace_id = ? AND usage_date = ?")
    .bind(workspaceId, today()).first<{ tokens_used: number }>();
  return Number(row?.tokens_used ?? 0);
}

async function addDailyUsage(env: Env, workspaceId: string, tokens: number) {
  await env.DB.prepare(
    `INSERT INTO workspace_daily_usage (workspace_id, usage_date, tokens_used, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(workspace_id, usage_date) DO UPDATE SET
        tokens_used = tokens_used + excluded.tokens_used,
        updated_at = datetime('now')`,
  ).bind(workspaceId, today(), tokens).run();
}

async function submitHoneyReceipt(env: Env, receipt: LedgerReceipt): Promise<LedgerSubmitResult> {
  const response = await fetch(`${(env.HONEY_LEDGER_URL ?? "").replace(/\/+$/, "")}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(receipt),
  }).catch(() => null);
  if (!response?.ok) return { ok: false, honeyDelta: 0, error: `Honey ledger rejected trusted receipt${response ? `: ${response.status}` : "."}` };
  const data = await response.json().catch(() => null) as { honeyDelta?: number } | null;
  return { ok: true, honeyDelta: Number(data?.honeyDelta ?? 0) || 0 };
}

async function hasManagedHoneyBudget(env: Env, workspaceId: string, agentId: string, requiredHoney: number) {
  if (!env.HONEY_LEDGER_URL) return false;
  const url = `${env.HONEY_LEDGER_URL.replace(/\/+$/, "")}/ledger?workspaceId=${encodeURIComponent(workspaceId)}&agentId=${encodeURIComponent(agentId)}`;
  const response = await fetch(url, { headers: authHeaders(env.HONEY_LEDGER_READ_TOKEN) }).catch(() => null);
  if (!response?.ok) return false;
  const data = await response.json().catch(() => null) as {
    ledger?: { balances?: Array<{ agentId?: string; managedHoneyBalance?: number }> };
  } | null;
  const balance = data?.ledger?.balances?.find((item) => item.agentId === agentId)?.managedHoneyBalance ?? 0;
  return Number(balance) >= requiredHoney;
}

async function submitManagedHoneyDebit(env: Env, input: {
  workspaceId: string;
  agentId: string;
  model: string;
  tokensUsed: number;
  quote: ManagedHoneyQuote;
}) {
  const secret = env.HONEY_BILLING_SECRET || env.HONEY_LEDGER_SECRET;
  if (!env.HONEY_LEDGER_URL || !secret) {
    throw new Error("Managed HONEY billing is not configured for shared-key compute.");
  }
  const timestamp = new Date().toISOString();
  const event = {
    eventId: crypto.randomUUID(),
    issuerId: "hivemindos-managed-compute-gateway",
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    kind: "debit" as const,
    honeyAmount: input.quote.honeyAmount,
    usdAmount: input.quote.retailUsd,
    provider: "bankr",
    sku: "managed-agent-compute",
    units: Math.max(1, input.tokensUsed) / 1000,
    unitUsd: input.quote.unitUsd,
    markupBps: input.quote.markupBps,
    source: "managed-agent",
    timestamp,
    idempotencyKey: `${input.workspaceId}:${input.agentId}:${timestamp}:${input.model}`,
    metadataHash: shortHash(`${input.model}:${input.tokensUsed}:${input.quote.retailUsd}`),
  };
  const signature = await signManagedBillingEvent(event, secret);
  const response = await fetch(`${env.HONEY_LEDGER_URL.replace(/\/+$/, "")}/managed-billing/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...event, signature }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as {
    ok?: boolean;
    event?: unknown;
    balance?: { managedHoneyBalance?: number } | null;
    error?: string;
  } | null;
  if (!response?.ok || !data?.ok) {
    throw new Error(data?.error || "Managed HONEY debit failed.");
  }
  return {
    eventId: event.eventId,
    honeyDelta: -event.honeyAmount,
    retailUsd: event.usdAmount,
    upstreamUsd: input.quote.upstreamUsd,
    markupBps: event.markupBps,
    balance: data.balance?.managedHoneyBalance ?? null,
  };
}

function quoteManagedHoney(env: Env, tokens: number): ManagedHoneyQuote {
  const tokenUnits = Math.max(1, Math.ceil(tokens)) / 1000;
  const unitUsd = positiveNumber(env.MANAGED_AGENT_USD_PER_1K_TOKENS, 0.01);
  const upstreamUsd = roundMoney(tokenUnits * unitUsd);
  const markupBps = Math.max(0, Math.round(positiveNumber(env.MANAGED_AGENT_MARKUP_BPS, 5_000)));
  const retailUsd = roundMoney(Math.max(0.01, upstreamUsd * (1 + markupBps / 10_000)));
  const honeyCreditsPerUsd = positiveNumber(env.MANAGED_HONEY_CREDITS_PER_USD, 100);
  return {
    honeyAmount: roundMoney(retailUsd * honeyCreditsPerUsd),
    retailUsd,
    upstreamUsd,
    markupBps,
    unitUsd,
  };
}

async function signedReceipt(env: Env, receipt: Omit<LedgerReceipt, "signature">): Promise<LedgerReceipt> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.HONEY_LEDGER_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalReceipt(receipt)));
  return {
    ...receipt,
    signature: [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

async function signManagedBillingEvent(event: {
  issuerId: string;
  eventId: string;
  workspaceId: string;
  agentId: string;
  kind: "credit" | "debit";
  honeyAmount: number;
  usdAmount?: number;
  provider: string;
  sku: string;
  units?: number;
  unitUsd?: number;
  markupBps?: number;
  source: string;
  timestamp: string;
  idempotencyKey?: string;
  metadataHash?: string;
}, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalManagedBillingEvent(event)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalReceipt(receipt: Omit<LedgerReceipt, "signature">) {
  return [
    receipt.issuerId,
    receipt.eventId,
    receipt.workspaceId,
    receipt.agentId,
    receipt.tokensUsed,
    receipt.model,
    receipt.source,
    receipt.timestamp,
  ].join(".");
}

function canonicalManagedBillingEvent(event: {
  issuerId: string;
  eventId: string;
  workspaceId: string;
  agentId: string;
  kind: "credit" | "debit";
  honeyAmount: number;
  usdAmount?: number;
  provider: string;
  sku: string;
  units?: number;
  unitUsd?: number;
  markupBps?: number;
  source: string;
  timestamp: string;
  idempotencyKey?: string;
  metadataHash?: string;
}) {
  return [
    event.issuerId,
    event.eventId,
    event.workspaceId,
    event.agentId,
    event.kind,
    roundMoney(event.honeyAmount),
    roundMoney(event.usdAmount ?? 0),
    event.provider,
    event.sku,
    Math.max(0, Number(event.units ?? 0) || 0),
    roundMoney(event.unitUsd ?? 0),
    Math.max(0, Math.round(Number(event.markupBps ?? 0) || 0)),
    event.source,
    event.timestamp,
    event.idempotencyKey ?? "",
    event.metadataHash ?? "",
  ].join(".");
}

function extractAssistantText(data: unknown) {
  const value = data as { choices?: Array<{ message?: { content?: string }; text?: string }> };
  return value.choices?.[0]?.message?.content ?? value.choices?.[0]?.text ?? JSON.stringify(data);
}

function extractUsageTokens(data: unknown) {
  const usage = (data as { usage?: Record<string, unknown> }).usage;
  if (!usage || typeof usage !== "object") return null;

  const total = firstPositiveNumber(usage, ["total_tokens", "totalTokens", "total", "tokens"]);
  if (total) return total;

  const input = firstPositiveNumber(usage, ["prompt_tokens", "input_tokens", "inputTokens", "promptTokens"]);
  const output = firstPositiveNumber(usage, ["completion_tokens", "output_tokens", "outputTokens", "completionTokens"]);
  const cacheRead = firstPositiveNumber(usage, ["cache_read_tokens", "cacheReadTokens", "cacheRead"]);
  const cacheWrite = firstPositiveNumber(usage, ["cache_write_tokens", "cacheWriteTokens", "cacheWrite"]);
  const reasoning = firstPositiveNumber(usage, ["reasoning_tokens", "reasoningTokens"]);
  const summed = input + output + cacheRead + cacheWrite + reasoning;
  return summed > 0 ? summed : null;
}

function firstPositiveNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
  }
  return 0;
}

function extractError(data: unknown) {
  const error = (data as { error?: string | { message?: string } }).error;
  return typeof error === "string" ? error : error?.message;
}

type RewardAuth = {
  bankrKey: string;
  workspaceId: string;
  agentId: string;
  agentName?: string;
  usesManagedHoney: boolean;
};

function parseRewardAuth(request: Request, body: GatewayRequest | null, env: Env): RewardAuth {
  const headerBankrKey = cleanSecret(request.headers.get("X-Bankr-LLM-Key") ?? undefined);
  const bodyBankrKey = cleanSecret(body?.bankrLlmKey);
  const bearer = bearerToken(request);
  const rewardKey = parseRewardKey(bearer);
  const explicitBankrKey = headerBankrKey || bodyBankrKey || rewardKey?.bankrLlmKey || cleanSecret(bearer);
  const managedBankrKey = sharedBankrKey(env);
  const bankrKey = explicitBankrKey || managedBankrKey;
  const workspaceId = cleanId(
    request.headers.get("X-Hivemind-Workspace-Id")
      ?? body?.workspaceId
      ?? rewardKey?.workspaceId
      ?? (bankrKey ? `reward-${shortHash(bankrKey)}` : ""),
  );
  const agentId = cleanId(
    request.headers.get("X-Hivemind-Agent-Id")
      ?? body?.agentId
      ?? rewardKey?.agentId
      ?? "reward-client",
  );
  const agentName = cleanId(request.headers.get("X-Hivemind-Agent-Name") ?? body?.agentName ?? rewardKey?.agentName ?? "");
  return {
    bankrKey,
    workspaceId: workspaceId || "reward-anonymous",
    agentId: agentId || "reward-client",
    usesManagedHoney: !explicitBankrKey && Boolean(managedBankrKey),
    ...(agentName ? { agentName } : {}),
  };
}

function bearerToken(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? "";
}

function parseRewardKey(token: string): { workspaceId?: string; agentId?: string; agentName?: string; bankrLlmKey?: string } | null {
  if (!token.startsWith("hive-v1.")) return null;
  const parts = token.split(".");
  if (parts.length === 3 || parts.length === 4) {
    return {
      workspaceId: parts[1],
      ...(parts.length === 4 ? { agentId: parts[2] } : {}),
      bankrLlmKey: cleanSecret(parts[parts.length - 1]),
    };
  }
  try {
    const encoded = token.slice("hive-v1.".length);
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const jsonText = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(jsonText) as { workspaceId?: string; agentId?: string; agentName?: string; bankrLlmKey?: string };
    return {
      workspaceId: parsed.workspaceId,
      agentId: parsed.agentId,
      agentName: parsed.agentName,
      bankrLlmKey: cleanSecret(parsed.bankrLlmKey),
    };
  } catch {
    return null;
  }
}

function shortHash(value: string) {
  return [...new Uint8Array(new TextEncoder().encode(value))]
    .reduce((hash, byte) => ((hash * 31) + byte) >>> 0, 0)
    .toString(16)
    .padStart(8, "0");
}

function openAIChatResponse(
  upstreamData: unknown,
  fallback: { id: string; model: string; outputText: string; tokensUsed: number; honeyDelta: number },
) {
  const upstream = upstreamData as {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices?: unknown[];
    usage?: Record<string, unknown>;
  };
  return {
    id: upstream.id ?? `chatcmpl-${fallback.id}`,
    object: upstream.object ?? "chat.completion",
    created: upstream.created ?? Math.floor(Date.now() / 1000),
    model: upstream.model ?? fallback.model,
    choices: Array.isArray(upstream.choices) && upstream.choices.length
      ? upstream.choices
      : [{ index: 0, message: { role: "assistant", content: fallback.outputText }, finish_reason: "stop" }],
    usage: {
      ...(upstream.usage ?? {}),
      total_tokens: fallback.tokensUsed,
    },
  };
}

function openAIStream(env: Env, responseBody: ReturnType<typeof openAIChatResponse>, honey: {
  id: string;
  agentId: string;
  agentName?: string;
  tokensUsed: number;
  honeyDelta: number;
  createdAt: string;
  managedHoney?: unknown;
}) {
  const text = extractAssistantText(responseBody);
  const created = Math.floor(Date.now() / 1000);
  const chunk = {
    id: responseBody.id,
    object: "chat.completion.chunk",
    created,
    model: responseBody.model,
    choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
  };
  const done = {
    id: responseBody.id,
    object: "chat.completion.chunk",
    created,
    model: responseBody.model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: responseBody.usage,
    honey: {
      ...honey,
      managedHoney: undefined,
      kind: "usage",
      source: "verified-reward-gateway",
      hiveDelta: 0,
    },
    ...(honey.managedHoney ? { managedHoney: honey.managedHoney } : {}),
  };
  return new Response([
    `data: ${JSON.stringify(chunk)}`,
    "",
    `data: ${JSON.stringify(done)}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n"), {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders(env) },
  });
}

function openAIError(env: Env, message: string, status: number) {
  return json(env, { error: { message, type: "hivemindos_reward_gateway_error" } }, status);
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function cleanId(value: string) {
  return value.trim().slice(0, 160);
}

function cleanSecret(value?: string) {
  const secret = value?.trim();
  return secret && secret.startsWith("bk_") ? secret : "";
}

function sharedBankrKey(env: Env) {
  if (env.ALLOW_SHARED_BANKR_KEY !== "true") return "";
  return cleanSecret(env.BANKR_LLM_KEY) || cleanSecret(env.BANKR_MANAGEMENT_KEY);
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function positiveInteger(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function roundMoney(value: number) {
  return Math.max(0, Math.round(value * 1_000_000) / 1_000_000);
}

function json(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}

function sse(env: Env, body: unknown, status = 200) {
  return new Response(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`, {
    status,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders(env) },
  });
}
