import { NextRequest } from "next/server";

import { deriveWalletForAdditionalChain, isRecoveryPhraseSecret } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret, listWalletInfos, storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { writeWalletRecord } from "@/lib/services/obsidian/wallet-ledger";
import { refreshWalletVaultBackup } from "@/lib/services/wallet/wallet-vault-backup";
import { createDefaultAgentWallet } from "@/lib/utils/agent-wallet";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { RECOVERY_PHRASE_PERSONAL_WALLET_SUFFIX, chainLabelForNetwork, recoveryPhraseAccountIndexFromWalletId } from "@/lib/utils/personal-wallet-grouping";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extend an already-imported wallet onto another chain by deriving the new
 *  per-chain record from a secret the local vault already holds (the recovery
 *  phrase, or the same-family private key). No seed re-entry required — this is
 *  how wallets imported before a chain was supported (e.g. Robinhood Chain)
 *  gain it later. */
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      network?: string;
      name?: string;
      vaultPath?: string;
    };
    const agentId = body.agentId?.trim();
    const network = body.network?.trim();
    if (!agentId) return errorJson("agentId is required");
    if (!network) return errorJson("network is required");

    // Group root: per-chain records live at `<root>:<network-slug>`, so an
    // account id and the grouped wallet id resolve to the same family.
    const root = agentId.replace(RECOVERY_PHRASE_PERSONAL_WALLET_SUFFIX, "");
    const records = (await listWalletInfos({ agentIdPrefix: root }))
      .filter((record) => record.agentId === root || record.agentId.startsWith(`${root}:`));
    if (!records.length) {
      return errorJson("No locally stored keys were found for this wallet. Reimport it with its seed phrase or private key first.", 404);
    }

    const label = chainLabelForNetwork(network);
    const existing = records.find((record) => record.network === network);
    if (existing) return okJson({ wallet: existing, label, alreadyExists: true });

    const sources: Array<{ info: (typeof records)[number]; secret: string }> = [];
    for (const record of records) {
      const stored = await getWalletSecret(record.agentId).catch(() => null);
      if (stored?.secret) sources.push({ info: record, secret: stored.secret });
    }
    if (!sources.length) {
      return errorJson("This wallet's stored keys could not be read from the local vault. Reimport it to add chains.", 404);
    }
    const targetIsEvm = network.startsWith("eip155:");
    const source = sources.find((candidate) => isRecoveryPhraseSecret(candidate.secret))
      ?? sources.find((candidate) => candidate.info.network.startsWith("eip155:") === targetIsEvm)
      ?? sources[0];

    const derived = deriveWalletForAdditionalChain(network, {
      network: source.info.network,
      secret: source.secret,
      accountIndex: recoveryPhraseAccountIndexFromWalletId(root),
    });
    const walletName = body.name?.trim() || source.info.name || "My wallet";
    const newAgentId = `${root}:${derived.network.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
    const info = await storeWalletSecret({
      agentId: newAgentId,
      name: walletName,
      address: derived.address,
      network: derived.network,
      secret: derived.secret,
    });
    if (root.startsWith("user:")) {
      await writeWalletRecord({
        vaultPath: body.vaultPath,
        agentId: info.agentId,
        agentName: `${walletName} ${label}`,
        wallet: {
          ...createDefaultAgentWallet(info.agentId),
          enabled: false,
          provider: "manual",
          walletAddress: info.address,
          network: info.network,
          tokenSymbol: primaryTokenSymbol(info.network),
          custodyMode: info.custodyMode,
          updatedAt: Date.now(),
        },
      });
    }
    const vaultSync = await refreshWalletVaultBackup(body.vaultPath).then(
      (status) => ({ ok: true, status }),
      (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Encrypted wallet vault sync failed." }),
    );
    return okJson({ wallet: info, label, importKind: derived.importKind, vaultSync });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to add the chain to this wallet.");
  }
}

function primaryTokenSymbol(network: string): string {
  if (network === "eip155:4663") return "USDG";
  return network.startsWith("solana:") ? "SOL" : "ETH";
}
