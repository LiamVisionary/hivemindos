import { NextRequest, NextResponse } from "next/server";

import {
  HIVEMINDOS_WALLET_PAID_MODELS_NAME,
  hiveComputeRouteForHivemindosModel,
  isFreeHivemindosWalletPaidModel,
  normalizeHivemindosWalletPaidModel,
  normalizeHivemindosWalletPaidSlug,
  preferredHiveComputeModelForHivemindosModel,
  upstreamHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { proxyHiveComputeChatCompletion } from "@/lib/services/hive-compute-marketplace";
import { freeTierDeviceId } from "@/lib/services/free-tier-identity";
import { recordFreeModelAllowance } from "@/lib/services/hivemindos-free-allowance";
import { resolvePooledHivemindosModelCreditToken } from "@/lib/services/hivemindos-model-credit-vault";
import { freeModelChatCompletionsUrl } from "@/lib/services/paid-agent-cloud-client";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { executeX402Fetch, type X402FetchPolicy } from "@/lib/services/wallet/x402-agent-fetch";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";

const MODEL_CALL_TIMEOUT_MS = 600_000;
const MODEL_STATUS_TIMEOUT_MS = 8_000;

type OpenAIChatCompletionBody = {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
};

export async function GET(request: NextRequest) {
  const requestedModel = request.nextUrl.searchParams.get("model")
    || request.headers.get("x-hivemindos-wallet-model")
    || "";
  const model = normalizeHivemindosWalletPaidModel(requestedModel);
  if (!isFreeHivemindosWalletPaidModel(model)) {
    return jsonError("Free model status is only available for Swarm Sovereign Scout.", 400);
  }
  const upstreamModel = upstreamHivemindosWalletPaidModel(model);
  const target = freeModelChatCompletionsUrl(upstreamModel);
  if (!target) {
    return jsonError("The free HivemindOS model endpoint is not configured.", 424);
  }
  const deviceId = await freeTierDeviceId();
  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-HivemindOS-Free-Device": deviceId,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_STATUS_TIMEOUT_MS),
    });
    const bodyPreview = await response.text();
    const bodyJson = jsonFromText(bodyPreview);
    const next = NextResponse.json(bodyJson ?? {
      ok: response.ok,
      model: { id: upstreamModel },
      bodyPreview,
    }, { status: response.status >= 400 && response.status < 600 ? response.status : 200 });
    applyFreeModelHeaders(response, next);
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The free HivemindOS model status check failed.";
    return jsonError(message, 502);
  }
}

export async function POST(request: NextRequest) {
  const agentId = request.headers.get("x-hivemindos-wallet-agent-id")?.trim() || "";
  if (!agentId) {
    return jsonError("A local wallet agent id is required for HivemindOS Models.", 400);
  }

  const body = await request.json().catch(() => null) as OpenAIChatCompletionBody | null;
  if (!body || typeof body !== "object") {
    return jsonError("OpenAI-compatible chat completion JSON is required.", 400);
  }
  if (!Array.isArray(body.messages)) {
    return jsonError("messages must be an array.", 400);
  }

  const slug = normalizeHivemindosWalletPaidSlug(request.headers.get("x-hivemindos-wallet-model-slug"));
  const model = normalizeHivemindosWalletPaidModel(String(body.model || ""));
  const upstreamModel = upstreamHivemindosWalletPaidModel(model);
  // The free model never touches credits or wallets: it goes to the hosted
  // free-models surface, which is the authority on the daily allowance.
  if (isFreeHivemindosWalletPaidModel(model)) {
    return fetchFreeModelCompletion(body, upstreamModel, model);
  }

  const directHiveComputeModel = hiveComputeRouteForHivemindosModel(model);
  if (directHiveComputeModel) {
    const computeResponse = await fetchPreferredHiveComputeCompletion(body, directHiveComputeModel, model, request.signal);
    if (computeResponse) return computeResponse;
    return jsonError("Hive Compute is not available for that marketplace model right now.", 503);
  }

  const preferredHiveComputeModel = preferredHiveComputeModelForHivemindosModel(model);
  if (preferredHiveComputeModel) {
    const computeResponse = await fetchPreferredHiveComputeCompletion(body, preferredHiveComputeModel, model, request.signal);
    if (computeResponse) return computeResponse;
  }

  // Credits are one shared pool per install; the caller's agent/wallet id is
  // only a legacy hint for adopting pre-pool tokens.
  const creditToken = await resolvePooledHivemindosModelCreditToken(slug, [agentId]);
  const target = new URL(`/api/official-paid-agents/${slug}/chat/completions`, request.url);
  const paidBase = new URL(`/api/official-paid-agents/${slug}`, request.url).toString().replace(/\/+$/, "");
  if (creditToken) {
    return fetchWithHostedCredits(target, creditToken, body, upstreamModel, model);
  }

  const walletRecord = await loadGovernanceWallet(agentId);
  if (!walletRecord) {
    return jsonError("Add HivemindOS Models credits with card or link a local funding wallet before chatting.", 404);
  }
  const wallet = walletRecord.wallet;
  if (!wallet.enabled) {
    return jsonError("The selected HivemindOS Models funding wallet is disabled.", 403);
  }
  if (wallet.custodyMode !== "local") {
    return jsonError("HivemindOS Models require a local signing wallet so the app can settle model payments.", 403);
  }

  const vault = await getWalletSecret(agentId);
  if (!vault) {
    return jsonError("The encrypted local wallet secret is missing for this agent.", 404);
  }
  if (wallet.network !== vault.info.network) {
    return jsonError("Stored wallet network does not match the encrypted wallet vault.", 409);
  }
  const persistedAddress = wallet.vaultAddress?.trim() || wallet.walletAddress?.trim() || "";
  if (persistedAddress && persistedAddress.toLowerCase() !== vault.info.address.toLowerCase()) {
    return jsonError("Stored wallet address does not match the encrypted wallet vault.", 409);
  }

  // LLM funding is separate from the agent's general wallet provider. The
  // hosted model endpoint settles via x402, but selecting a funding wallet is
  // the user permission for model calls; it should not require or mutate the
  // agent's normal x402 spending rail.
  const policy: X402FetchPolicy = {
    enabled: wallet.enabled,
    provider: "x402",
    network: wallet.network,
    maxPaymentUsd: Number(wallet.maxPaymentUsd) > 0 ? Number(wallet.maxPaymentUsd) : 0.5,
    approvalRequiredOverUsd: Number(wallet.approvalRequiredOverUsd) || 0,
    autoPayEnabled: true,
    x402BaseUrl: paidBase,
  };

  try {
    const result = await executeX402Fetch({
      agentId,
      network: vault.info.network,
      secret: vault.secret,
      fromAddress: vault.info.address,
      url: target.toString(),
      method: "POST",
      // The target is our own /api/official-paid-agents route; self-fetches
      // 401 without the server's device token since the gate moved to src/proxy.ts.
      headers: {
        Accept: "application/json",
        ...internalApiAuthHeaders(),
      },
      body: {
        ...body,
        model: upstreamModel,
        stream: false,
      },
      policy,
      confirmation: request.headers.get("x-hivemindos-wallet-confirmation")?.trim() || undefined,
      approvalToken: request.headers.get("x-hivemindos-wallet-approval-token")?.trim() || undefined,
      approvalContext: {
        headline: `Pay for one ${HIVEMINDOS_WALLET_PAID_MODELS_NAME} model call.`,
        summary: "This pays the hosted HivemindOS Models endpoint for a single chat completion because no prepaid shared credit token is available.",
        whyNow: "The request reached the wallet-paid path and the wallet governance policy requires review before spending.",
        impact: "Approving lets this model call retry with x402 payment. Rejecting stops this paid completion and leaves the chat request unpaid.",
        requestedAction: "Approve only if this specific model call should be paid from the local funding wallet.",
        evidence: [
          `Requested model: ${model}`,
          `Upstream model: ${upstreamModel}`,
          `Funding wallet: ${agentId}`,
          `Endpoint: ${target.toString()}`,
          `Prepaid credit token: not found`,
        ],
        missingContext: [],
        source: "HivemindOS Models chat completion",
      },
      timeoutMs: MODEL_CALL_TIMEOUT_MS,
    });

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: upstreamError(result.bodyJson) || `HivemindOS Models upstream returned HTTP ${result.status}.`,
        status: result.status,
        paid: result.paid,
        amountUsd: result.amountUsd,
        paymentResponse: result.paymentResponse,
      }, { status: result.status >= 400 && result.status < 600 ? result.status : 502 });
    }

    const payload = openAiCompletionPayload(result.bodyJson, result.bodyPreview, model);
    const response = NextResponse.json(payload, {
      status: 200,
      headers: {
        "X-HivemindOS-Wallet-Paid": result.paid ? "x402" : "none",
        "X-HivemindOS-Wallet-Paid-Network": result.network,
        "X-HivemindOS-Wallet-Paid-Amount-Usd": String(result.amountUsd),
      },
    });
    if (result.paymentResponse) response.headers.set("PAYMENT-RESPONSE", result.paymentResponse);
    const creditDebitUsd = result.responseHeaders["x-hivemindos-credit-debited-usd"];
    const creditBalanceUsd = result.responseHeaders["x-hivemindos-credit-balance-usd"];
    if (creditDebitUsd) response.headers.set("X-HivemindOS-Models-Credit-Debited-Usd", creditDebitUsd);
    if (creditBalanceUsd) response.headers.set("X-HivemindOS-Models-Credit-Balance-Usd", creditBalanceUsd);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "HivemindOS Models wallet-paid request failed.";
    return jsonError(message, errorStatusFor(message));
  }
}

const FREE_ALLOWANCE_HEADERS = [
  "x-hivemindos-free-remaining-requests",
  "x-hivemindos-free-remaining-tokens",
  "x-hivemindos-free-reset-at",
  "retry-after",
];

const FREE_MODEL_CONTAINER_HEADERS = [
  "x-hivemindos-free-model-container-state",
  "x-hivemindos-free-model-warm-window-seconds",
  "x-hivemindos-free-model-last-success-at",
  "x-hivemindos-free-model-state-source",
];

function applyFreeModelHeaders(upstream: Response, next: NextResponse) {
  for (const name of FREE_ALLOWANCE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) next.headers.set(name, value);
  }
  for (const name of FREE_MODEL_CONTAINER_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) next.headers.set(name, value);
  }
  // The hosted gateway reports allowance ONLY on completion responses (there is
  // no query endpoint), so every real free call refreshes the local last-seen
  // snapshot the Scout card's usage meter reads. Fire-and-forget by design.
  void recordFreeModelAllowance({
    remainingRequests: upstream.headers.get("x-hivemindos-free-remaining-requests"),
    remainingTokens: upstream.headers.get("x-hivemindos-free-remaining-tokens"),
    resetAt: upstream.headers.get("x-hivemindos-free-reset-at"),
  });
}

async function fetchFreeModelCompletion(
  body: OpenAIChatCompletionBody,
  upstreamModel: string,
  model: string,
) {
  const target = freeModelChatCompletionsUrl(upstreamModel);
  if (!target) {
    return jsonError("The free HivemindOS model endpoint is not configured.", 424);
  }
  const deviceId = await freeTierDeviceId();
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-HivemindOS-Free-Device": deviceId,
      },
      body: JSON.stringify({
        ...body,
        model: upstreamModel,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });
    const bodyPreview = await response.text();
    const bodyJson = jsonFromText(bodyPreview);
    if (!response.ok) {
      const limited = response.status === 429;
      const next = NextResponse.json({
        ok: false,
        error: upstreamError(bodyJson) || (limited
          ? "Today's free Swarm Sovereign Scout allowance is used up. It resets daily — or pick a wallet-paid route."
          : `The free HivemindOS model returned HTTP ${response.status}.`),
        status: response.status,
        paid: "free",
        amountUsd: 0,
      }, { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
      applyFreeModelHeaders(response, next);
      return next;
    }

    const payload = openAiCompletionPayload(bodyJson, bodyPreview, model);
    const next = NextResponse.json(payload, {
      status: 200,
      headers: {
        "X-HivemindOS-Wallet-Paid": "free",
        "X-HivemindOS-Wallet-Paid-Network": "hosted",
        "X-HivemindOS-Wallet-Paid-Amount-Usd": "0",
      },
    });
    applyFreeModelHeaders(response, next);
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The free HivemindOS model request failed.";
    return jsonError(message, 502);
  }
}

async function fetchWithHostedCredits(
  target: URL,
  creditToken: string,
  body: OpenAIChatCompletionBody,
  upstreamModel: string,
  model: string,
) {
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-HivemindOS-Credit-Token": creditToken,
        ...internalApiAuthHeaders(),
      },
      body: JSON.stringify({
        ...body,
        model: upstreamModel,
        stream: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
    });
    const bodyPreview = await response.text();
    const bodyJson = jsonFromText(bodyPreview);
    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        error: upstreamError(bodyJson) || `HivemindOS Models upstream returned HTTP ${response.status}.`,
        status: response.status,
        paid: "credits",
        amountUsd: 0,
      }, { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
    }

    const payload = openAiCompletionPayload(bodyJson, bodyPreview, model);
    const next = NextResponse.json(payload, {
      status: 200,
      headers: {
        "X-HivemindOS-Wallet-Paid": "credits",
        "X-HivemindOS-Wallet-Paid-Network": "hosted",
        "X-HivemindOS-Wallet-Paid-Amount-Usd": "0",
      },
    });
    const creditDebitUsd = response.headers.get("x-hivemindos-credit-debited-usd") || "";
    const creditBalanceUsd = response.headers.get("x-hivemindos-credit-balance-usd") || "";
    if (creditDebitUsd) next.headers.set("X-HivemindOS-Models-Credit-Debited-Usd", creditDebitUsd);
    if (creditBalanceUsd) next.headers.set("X-HivemindOS-Models-Credit-Balance-Usd", creditBalanceUsd);
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : "HivemindOS Models hosted-credit request failed.";
    return jsonError(message, errorStatusFor(message));
  }
}

async function fetchPreferredHiveComputeCompletion(
  body: OpenAIChatCompletionBody,
  hiveComputeModel: string,
  publicModel: string,
  signal: AbortSignal,
) {
  try {
    const response = await proxyHiveComputeChatCompletion({
      ...body,
      model: hiveComputeModel,
      stream: false,
    }, signal);
    if (!response.ok) return null;
    const bodyPreview = await response.text();
    const bodyJson = jsonFromText(bodyPreview);
    const payload = openAiCompletionPayload(bodyJson, bodyPreview, publicModel);
    const amountUsd = response.headers.get("x-hivemindos-compute-price-usd") || "0";
    const next = NextResponse.json(payload, {
      status: 200,
      headers: {
        "X-HivemindOS-Wallet-Paid": "hive-compute",
        "X-HivemindOS-Wallet-Paid-Network": "hosted",
        "X-HivemindOS-Wallet-Paid-Amount-Usd": amountUsd,
        "X-HivemindOS-Model-Route": "hive-compute",
      },
    });
    for (const name of [
      "x-request-id",
      "x-hivemindos-compute-job-id",
      "x-hivemindos-compute-worker",
      "x-hivemindos-compute-price-usd",
    ]) {
      const value = response.headers.get(name);
      if (value) next.headers.set(name, value);
    }
    return next;
  } catch {
    return null;
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function errorStatusFor(message: string) {
  if (/PAY_X402|auto-use is off|approve/i.test(message)) return 402;
  if (/cap|budget|kill switch|frozen/i.test(message)) return 402;
  if (/wallet|provider|custody|network/i.test(message)) return 403;
  return 502;
}

function upstreamError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const message = (record.error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof record.message === "string") return record.message;
  return "";
}

function jsonFromText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function openAiCompletionPayload(payload: unknown, bodyPreview: string, model: string) {
  if (isOpenAiChatCompletion(payload)) return { ...payload, model };
  const content = completionText(payload) || bodyPreview || "";
  return {
    id: `chatcmpl_hivemindos_${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    provider: HIVEMINDOS_WALLET_PAID_MODELS_NAME,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
  };
}

function isOpenAiChatCompletion(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  return record.object === "chat.completion" && Array.isArray(record.choices);
}

function completionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const choice = first as Record<string, unknown>;
  if (typeof choice.text === "string") return choice.text;
  const message = choice.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  return "";
}
