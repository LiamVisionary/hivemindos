import { NextRequest, NextResponse } from "next/server";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { executeX402Fetch, type X402FetchPolicy } from "@/lib/services/wallet/x402-agent-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      policy?: Partial<AgentWalletConfig>;
      confirmation?: string;
    };
    const agentId = body.agentId?.trim();
    const url = body.url?.trim();
    if (!agentId) return NextResponse.json({ ok: false, error: "agentId is required" }, { status: 400 });
    if (!url) return NextResponse.json({ ok: false, error: "url is required" }, { status: 400 });

    const stored = await getWalletSecret(agentId);
    if (!stored) return NextResponse.json({ ok: false, error: "No local wallet exists for this agent." }, { status: 404 });

    const policy = normalizePolicy(body.policy, stored.info.network);
    const result = await executeX402Fetch({
      agentId,
      network: stored.info.network,
      secret: stored.secret,
      url,
      method: body.method,
      headers: body.headers,
      body: body.body,
      policy,
      confirmation: body.confirmation,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "x402 request failed" }, { status: 400 });
  }
}

function normalizePolicy(policy: Partial<AgentWalletConfig> | undefined, network: string): X402FetchPolicy {
  const provider = policy?.provider === "veil" && policy.veilAutoPrivateX402 === false
    ? "x402"
    : policy?.provider ?? "manual";
  return {
    enabled: Boolean(policy?.enabled),
    provider,
    network: policy?.network || network,
    maxPaymentUsd: positiveMoney(policy?.maxPaymentUsd, 0.5),
    approvalRequiredOverUsd: positiveMoney(policy?.approvalRequiredOverUsd, 0),
    autoPayEnabled: Boolean(policy?.autoPayEnabled),
    x402BaseUrl: policy?.x402BaseUrl ?? "",
  };
}

function positiveMoney(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
