import { NextRequest, NextResponse } from "next/server";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { VEIL_CASH_NETWORK, VEIL_CASH_X402_CONFIRMATION } from "@/lib/config/veil-cash";
import { callVeilMcpTool } from "@/lib/services/wallet/veil-mcp";
import { veilEnvValue } from "@/lib/services/wallet/veil-cli";
import { type X402FetchPolicy } from "@/lib/services/wallet/x402-agent-fetch";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type VeilX402Body = {
  agentId?: string;
  provider?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  policy?: Partial<AgentWalletConfig>;
  confirmation?: string;
  payerIndex?: string;
  forceFresh?: boolean;
};

type VeilMcpX402Result = {
  action?: string;
  success?: boolean;
  settled?: boolean;
  reused?: boolean;
  drainedDust?: boolean;
  status?: number;
  url?: string;
  maxPayment?: string;
  requiredAmount?: string;
  requiredAmountAtomic?: string;
  candidates?: Array<{
    payerIndex?: string;
    payerAddress?: string;
    usdc?: string;
    usdcAtomic?: string;
    fundedFor?: string | null;
  }>;
  message?: string;
  receipt?: {
    payerAddress?: string;
    payerIndex?: string;
    amount?: string;
    amountAtomic?: string;
    relayTransactionHash?: string;
    paymentTransactionHash?: string;
  };
  payerAddress?: string;
  payerIndex?: string;
  amount?: string;
  amountAtomic?: string;
  relayTransactionHash?: string;
  relayBlockNumber?: string;
  paymentTransactionHash?: string;
  body?: unknown;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as VeilX402Body;
    const validation = validateBody(body);
    if (validation) return validation;

    const policy = normalizePolicy(body.policy);
    const veilKey = await veilEnvValue("VEIL_KEY");
    if (!veilKey) return sendError("VEIL_KEY is not configured in the server environment. Run Veil setup before private x402 payments.", 424);

    let result = await callVeilMcpTool<VeilMcpX402Result>("veil_pay_x402", {
      url: body.url!.trim(),
      method: normalizeMethod(body.method),
      body: body.body,
      headers: body.headers,
      maxPayment: policy.maxPaymentUsd.toFixed(6).replace(/\.?0+$/, ""),
      payerIndex: body.payerIndex,
      forceFresh: body.forceFresh === true,
      confirm: true,
    });

    if (result.action === "reuse_available") {
      const payerIndex = reusableX402PayerIndex(result);
      if (!payerIndex) {
        return NextResponse.json({
          ok: false,
          reuseAvailable: true,
          privateX402: result,
          error: result.message ?? "A funded x402 payer is available, but no reusable payer index was returned.",
        }, { status: 409 });
      }
      result = await callVeilMcpTool<VeilMcpX402Result>("veil_pay_x402", {
        url: body.url!.trim(),
        method: normalizeMethod(body.method),
        body: body.body,
        headers: body.headers,
        maxPayment: policy.maxPaymentUsd.toFixed(6).replace(/\.?0+$/, ""),
        payerIndex,
        confirm: true,
      });
    }
    if (result.success === false) {
      return sendError(result.message ?? "Veil private x402 payment was not submitted.");
    }

    return NextResponse.json({
      ok: true,
      privateX402: {
        resource: result.url ?? body.url,
        amountUsd: Number(result.amount ?? result.receipt?.amount ?? 0),
        payerAddress: result.payerAddress ?? result.receipt?.payerAddress,
        payerIndex: result.payerIndex ?? result.receipt?.payerIndex,
        privateWithdraw: {
          transactionHash: result.relayTransactionHash ?? result.receipt?.relayTransactionHash ?? "",
          blockNumber: numberValue(result.relayBlockNumber),
          amount: result.amount ?? result.receipt?.amount ?? "",
          recipient: result.payerAddress ?? result.receipt?.payerAddress ?? "",
        },
        paymentTransactionHash: result.paymentTransactionHash ?? result.receipt?.paymentTransactionHash ?? "",
        settled: result.settled === true,
        reused: result.reused === true,
        drainedDust: result.drainedDust === true,
        x402: {
          status: result.status,
          amountUsd: Number(result.amount ?? result.receipt?.amount ?? 0),
          paid: result.settled === true,
          body: result.body,
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: privateX402ErrorMessage(error) }, { status: 400 });
  }
}

function validateBody(body: VeilX402Body) {
  if (!body.agentId?.trim()) return sendError("agentId is required");
  if (!body.url?.trim()) return sendError("url is required");
  if (body.provider !== "veil" && body.policy?.provider !== "veil") return sendError("Set this agent's payment provider to Veil Cash before private x402 payments.");
  if (body.confirmation !== VEIL_CASH_X402_CONFIRMATION) return sendError(`Type ${VEIL_CASH_X402_CONFIRMATION} to confirm this private x402 payment.`);
  if (body.payerIndex != null && !/^\d+$/.test(body.payerIndex)) return sendError("payerIndex must be a non-negative integer string.");
  return null;
}

function normalizePolicy(policy: Partial<AgentWalletConfig> | undefined): X402FetchPolicy {
  if (policy?.network && policy.network !== VEIL_CASH_NETWORK) {
    throw new Error("Veil private x402 payments are only supported on Base mainnet.");
  }
  return {
    enabled: Boolean(policy?.enabled),
    provider: "x402",
    network: VEIL_CASH_NETWORK,
    maxPaymentUsd: positiveMoney(policy?.maxPaymentUsd, 0.5),
    approvalRequiredOverUsd: positiveMoney(policy?.approvalRequiredOverUsd, 0),
    autoPayEnabled: true,
    x402BaseUrl: policy?.x402BaseUrl ?? "",
  };
}

function normalizeMethod(method: string | undefined) {
  return method?.toUpperCase() === "POST" ? "POST" : "GET";
}

function positiveMoney(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function numberValue(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function reusableX402PayerIndex(result: VeilMcpX402Result) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const candidate = candidates.find((item) => typeof item?.payerIndex === "string" && /^\d+$/.test(item.payerIndex));
  return candidate?.payerIndex ?? "";
}

function privateX402ErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Veil private x402 payment failed.";
  if (message === "VEIL_MCP_MISSING") return "Veil MCP is not installed. Run Setup Veil to install @veil-cash/mcp before private x402 payments.";
  if (message === "VEIL_CLI_MISSING" || /ENOENT/.test(message)) return "Veil CLI is not installed. Run Setup Veil before private x402 payments.";
  return message.replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
}

function sendError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
