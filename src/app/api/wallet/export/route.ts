import { NextRequest, NextResponse } from "next/server";

import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_CONFIRMATION = "EXPORT_WALLET_SECRET";

type WalletExportEntry = {
  agentId: string;
  address: string;
  network: string;
  kind: "private-key" | "recovery-phrase";
  secret: string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      agentIds?: string[];
      confirmation?: string;
    };
    if (body.confirmation !== EXPORT_CONFIRMATION) {
      return walletExportJson({
        ok: false,
        error: `Type ${EXPORT_CONFIRMATION} to export wallet secrets.`,
        confirmationRequired: EXPORT_CONFIRMATION,
      }, 400);
    }

    const agentIds = uniqueStrings([
      body.agentId,
      ...(Array.isArray(body.agentIds) ? body.agentIds : []),
    ].map((agentId) => agentId?.trim()).filter((agentId): agentId is string => Boolean(agentId)));
    if (!agentIds.length) return walletExportJson({ ok: false, error: "agentId is required" }, 400);

    const entries = await Promise.all(agentIds.map(readWalletExportEntry));
    const missing = entries.filter((entry): entry is { agentId: string; missing: true } => "missing" in entry);
    if (missing.length) {
      return walletExportJson({
        ok: false,
        error: missing.length === 1
          ? "No local wallet secret exists for this wallet."
          : `No local wallet secret exists for ${missing.length} selected wallets.`,
        missingAgentIds: missing.map((entry) => entry.agentId),
      }, 404);
    }

    return walletExportJson({ ok: true, entries: entries as WalletExportEntry[] });
  } catch (error) {
    return walletExportJson({
      ok: false,
      error: error instanceof Error ? error.message : "Wallet secret export failed.",
    }, 500);
  }
}

function walletExportJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readWalletExportEntry(agentId: string): Promise<WalletExportEntry | { agentId: string; missing: true }> {
  const stored = await getWalletSecret(agentId);
  if (!stored) return { agentId, missing: true };
  return {
    agentId,
    address: stored.info.address,
    network: stored.info.network,
    kind: classifyWalletSecret(stored.secret),
    secret: stored.secret,
  };
}

function classifyWalletSecret(secret: string): WalletExportEntry["kind"] {
  const normalized = secret.trim();
  if (!normalized.startsWith("0x") && normalized.split(/\s+/).length >= 12) return "recovery-phrase";
  return "private-key";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
