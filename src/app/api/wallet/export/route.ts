import { NextRequest, NextResponse } from "next/server";

import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import {
  classifyWalletSecret,
  dedupeWalletExportEntries,
  WALLET_SECRET_EXPORT_CONFIRMATION,
  walletSecretExportLabel,
  type WalletSecretExportEntry,
} from "@/lib/services/wallet/wallet-secret-export";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      agentIds?: string[];
      confirmation?: string;
    };
    if (body.confirmation !== WALLET_SECRET_EXPORT_CONFIRMATION) {
      return walletExportJson({
        ok: false,
        error: `Type ${WALLET_SECRET_EXPORT_CONFIRMATION} to export wallet secrets.`,
        confirmationRequired: WALLET_SECRET_EXPORT_CONFIRMATION,
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

    const exportEntries = dedupeWalletExportEntries(entries as WalletSecretExportEntry[]);
    return walletExportJson({
      ok: true,
      entries: exportEntries,
      exportedCount: exportEntries.length,
      label: walletSecretExportLabel(exportEntries),
    });
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

async function readWalletExportEntry(agentId: string): Promise<WalletSecretExportEntry | { agentId: string; missing: true }> {
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
