import { NextRequest, NextResponse } from "next/server";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { resolveGovernedWalletAccess } from "@/lib/services/wallet/spend-governance";
import { executeX402Fetch, normalizeX402Policy } from "@/lib/services/wallet/x402-agent-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      actingAgentId?: string;
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      policy?: Partial<AgentWalletConfig>;
      confirmation?: string;
      companyTaskId?: string;
    };
    const requestedWalletId = body.agentId?.trim();
    const url = body.url?.trim();
    if (!requestedWalletId) return NextResponse.json({ ok: false, error: "agentId is required" }, { status: 400 });
    if (!url) return NextResponse.json({ ok: false, error: "url is required" }, { status: 400 });

    const isPersonalWallet = requestedWalletId.startsWith("user:");
    const access = isPersonalWallet
      ? null
      : await resolveGovernedWalletAccess(requestedWalletId, body.actingAgentId?.trim() || undefined);
    if (!isPersonalWallet && !access) {
      return NextResponse.json({ ok: false, error: body.actingAgentId ? "This agent is not attached to that wallet." : "No governed wallet record exists for this wallet." }, { status: body.actingAgentId ? 403 : 404 });
    }
    const walletId = access?.walletId ?? requestedWalletId;

    const stored = await getWalletSecret(walletId);
    if (!stored) return NextResponse.json({ ok: false, error: "No local wallet exists for this agent." }, { status: 404 });

    // Personal (`user:`) wallets never auto-spend: force auto-pay off so x402
    // always needs an explicit confirmation. An explicit pay-from-my-wallet
    // still works; the no-human auto path does not.
    const policy = normalizeX402Policy({
      ...body.policy,
      ...(access?.wallet ?? {}),
      autoPayEnabled: access?.permissionMode === "autonomous" && access.wallet.enabled,
    }, stored.info.network, isPersonalWallet || !body.actingAgentId?.trim());
    const result = await executeX402Fetch({
      agentId: walletId,
      network: stored.info.network,
      secret: stored.secret,
      fromAddress: stored.info.address,
      url,
      method: body.method,
      headers: body.headers,
      body: body.body,
      policy,
      confirmation: body.confirmation,
      companyTaskId: body.companyTaskId?.trim() || undefined,
      approvalContext: {
        summary: "This is a generic x402 paid HTTP request from the wallet API.",
        whyNow: "The endpoint requested payment and the wallet governance policy requires review before spending.",
        impact: "Approving lets the request retry with an x402 payment. Rejecting keeps the paid HTTP call blocked.",
        requestedAction: "Approve only if this URL, method, and amount are expected.",
        evidence: [
          `URL: ${url}`,
          `Method: ${body.method || "GET"}`,
          `Wallet: ${walletId}`,
          `Network: ${stored.info.network}`,
        ],
        source: "Wallet x402 API",
      },
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "x402 request failed" }, { status: 400 });
  }
}
