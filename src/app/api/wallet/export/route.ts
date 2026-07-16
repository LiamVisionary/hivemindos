import { NextRequest, NextResponse } from "next/server";

import { deriveEvmAccountFromRecoveryPhrase } from "@/lib/services/wallet/chain-wallet";
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
  const { address, network } = stored.info;
  const kind = classifyWalletSecret(stored.secret);

  // A recovery-phrase-derived EVM wallet stores the SHARED seed phrase, not a
  // per-address secret — every account (index 0..N) of that phrase exports the
  // identical phrase, and importing it lands on Account 1, not this wallet.
  // Export the account's own private key instead so the exported secret maps
  // to exactly `address`. The vault stores only the address, so recover the
  // index by scanning (deriveEvmAccountFromRecoveryPhrase).
  if (kind === "recovery-phrase" && network.startsWith("eip155:")) {
    let derived: ReturnType<typeof deriveEvmAccountFromRecoveryPhrase> = null;
    try {
      derived = deriveEvmAccountFromRecoveryPhrase(stored.secret, address);
    } catch {
      derived = null;
    }
    if (derived) {
      return {
        agentId,
        address,
        network,
        kind: "private-key",
        secret: derived.privateKey,
        accountIndex: derived.accountIndex,
        derivationPath: derived.derivationPath,
      };
    }
    // Index unknown (e.g. an externally derived address at a non-standard path):
    // fall back to the phrase, but warn loudly that it may not map to this wallet.
    return {
      agentId,
      address,
      network,
      kind: "recovery-phrase",
      secret: stored.secret,
      derivationNote: `Could not determine which recovery-phrase account derives ${address}. Importing this phrase defaults to Account 1, which may NOT be this wallet — confirm the imported address matches ${address} before using it.`,
    };
  }

  return {
    agentId,
    address,
    network,
    kind,
    secret: stored.secret,
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
