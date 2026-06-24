import { NextRequest, NextResponse } from "next/server";
import {
  B20_FACTORY_ADDRESS,
  B20_ISSUER_CHAIN_ID,
  B20_ISSUER_CHAIN_NAME,
  B20_ISSUER_CONFIRMATION,
  B20_ISSUER_NETWORK,
  buildB20IssuerDraftMessage,
  buildLiveB20IssuerDraft,
  collectB20IssuerDetails,
  executeB20IssuerDraft,
  parseB20IssuerDraftMessage,
  type B20IssuerConversationMessage,
  type B20IssuerDetails,
} from "@/lib/services/crypto/b20-issuer-proof";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type B20IssuerProofBody = {
  action?: "draft" | "create";
  agentId?: string;
  deployerAddress?: string;
  messages?: B20IssuerConversationMessage[];
  details?: Partial<B20IssuerDetails>;
  draft?: unknown;
  draftMessage?: string;
  confirmation?: string;
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    ok: true,
    network: B20_ISSUER_NETWORK,
    chainId: B20_ISSUER_CHAIN_ID,
    chainName: B20_ISSUER_CHAIN_NAME,
    factory: B20_FACTORY_ADDRESS,
    confirmation: B20_ISSUER_CONFIRMATION,
    note: "POST action draft to build a read-only B20 issuer proof. POST action create with that exact draft and B20_CREATE confirmation to sign from the encrypted local agent wallet.",
  });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as B20IssuerProofBody;
    const action = body.action ?? "draft";
    if (action === "create") return createB20(body);
    return draftB20(body);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "B20 issuer proof request failed.",
    }, { status: 400 });
  }
}

async function draftB20(body: B20IssuerProofBody) {
  const agentId = body.agentId?.trim();
  const deployerAddress = body.deployerAddress?.trim() || (agentId ? (await getWalletInfo(agentId))?.address : "");
  if (body.details) {
    const draft = await buildLiveB20IssuerDraft(body.details as B20IssuerDetails, {
      agentId: agentId || "",
      deployer: deployerAddress || "",
    });
    return NextResponse.json({ ok: true, draft, message: buildB20IssuerDraftMessage(draft) });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const collected = collectB20IssuerDetails({ messages, deployerAddress });
  if (!collected.ok) {
    return NextResponse.json({ ok: false, missing: collected.missing, partial: collected.partial, message: collected.message }, { status: 422 });
  }
  const draft = await buildLiveB20IssuerDraft(collected.details, {
    agentId: agentId || "",
    deployer: deployerAddress || "",
  });
  return NextResponse.json({ ok: true, draft, message: buildB20IssuerDraftMessage(draft) });
}

async function createB20(body: B20IssuerProofBody) {
  if (body.confirmation !== B20_ISSUER_CONFIRMATION) {
    return NextResponse.json({ ok: false, error: `B20 creation requires ${B20_ISSUER_CONFIRMATION} confirmation.` }, { status: 400 });
  }
  const draft = body.draftMessage
    ? parseB20IssuerDraftMessage(body.draftMessage)
    : isB20IssuerDraft(body.draft) ? body.draft : null;
  if (!draft) return NextResponse.json({ ok: false, error: "A valid B20 issuer proof draft is required." }, { status: 400 });
  const signer = await getWalletSecret(draft.agentId);
  if (!signer) return NextResponse.json({ ok: false, error: "No encrypted local signer exists for this agent." }, { status: 404 });

  const result = await executeB20IssuerDraft({ draft, secret: signer.secret, confirmation: B20_ISSUER_CONFIRMATION });
  return NextResponse.json(result.ok ? { ok: true, result } : { ok: false, result }, { status: result.ok ? 200 : 400 });
}

function isB20IssuerDraft(value: unknown): value is Parameters<typeof executeB20IssuerDraft>[0]["draft"] {
  return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 1);
}
