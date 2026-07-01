import { NextRequest, NextResponse } from "next/server";

import {
  HIVEMINDOS_WALLET_PAID_MODELS_NAME,
  normalizeHivemindosWalletPaidModel,
  normalizeHivemindosWalletPaidSlug,
  upstreamHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { getHivemindosModelCreditToken } from "@/lib/services/hivemindos-model-credit-vault";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { executeX402Fetch, type X402FetchPolicy } from "@/lib/services/wallet/x402-agent-fetch";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";

const MODEL_CALL_TIMEOUT_MS = 600_000;

type OpenAIChatCompletionBody = {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
};

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

  const walletRecord = await loadGovernanceWallet(agentId);
  if (!walletRecord) {
    return jsonError("Create an agent wallet before using HivemindOS Models.", 404);
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

  const slug = normalizeHivemindosWalletPaidSlug(request.headers.get("x-hivemindos-wallet-model-slug"));
  const creditToken = await getHivemindosModelCreditToken(agentId, slug).catch(() => "");
  const target = new URL(`/api/official-paid-agents/${slug}/chat/completions`, request.url);
  const paidBase = new URL(`/api/official-paid-agents/${slug}`, request.url).toString().replace(/\/+$/, "");
  const model = normalizeHivemindosWalletPaidModel(String(body.model || ""));
  const upstreamModel = upstreamHivemindosWalletPaidModel(model);
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
      headers: {
        Accept: "application/json",
        ...(creditToken ? { "X-HivemindOS-Credit-Token": creditToken } : {}),
      },
      body: {
        ...body,
        model: upstreamModel,
        stream: false,
      },
      policy,
      skipPaymentDiscovery: Boolean(creditToken),
      confirmation: request.headers.get("x-hivemindos-wallet-confirmation")?.trim() || undefined,
      approvalToken: request.headers.get("x-hivemindos-wallet-approval-token")?.trim() || undefined,
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
