import { NextRequest } from "next/server";

import { importRecoveryPhraseWallets, importWalletSecret } from "@/lib/services/wallet/chain-wallet";
import { storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { writeWalletRecord } from "@/lib/services/obsidian/wallet-ledger";
import { refreshWalletVaultBackup } from "@/lib/services/wallet/wallet-vault-backup";
import { createDefaultAgentWallet } from "@/lib/utils/agent-wallet";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      network?: string;
      name?: string;
      secret?: string;
      importKind?: "private-key" | "recovery-phrase";
      importTarget?: "single-network" | "multi-chain";
      accountIndex?: number;
      vaultPath?: string;
    };
    const agentId = body.agentId?.trim();
    if (!agentId) return errorJson("agentId is required");
    if (body.importTarget === "multi-chain" && body.importKind !== "recovery-phrase") {
      return errorJson("Multi-chain import requires a recovery phrase.");
    }
    if (body.importKind === "recovery-phrase") {
      const accountIndex = Number(body.accountIndex ?? 0);
      const importedWallets = importRecoveryPhraseWallets(body.secret || "", accountIndex);
      const wallets: Awaited<ReturnType<typeof storeWalletSecret>>[] = [];
      const walletName = body.name?.trim() || "My wallet";
      for (const wallet of importedWallets) {
        wallets.push(await storeWalletSecret({
          agentId: `${agentId}:${wallet.network.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`,
          name: walletName,
          address: wallet.address,
          network: wallet.network,
          secret: wallet.secret,
        }));
      }
      if (agentId.startsWith("user:")) {
        const now = Date.now();
        await Promise.all(wallets.map((wallet, index) => writeWalletRecord({
          vaultPath: body.vaultPath,
          agentId: wallet.agentId,
          agentName: importedWallets.length > 1
            ? `${walletName} ${importedWallets[index]?.label || (wallet.network.startsWith("solana:") ? "Solana" : "Base")}`
            : walletName,
          wallet: {
            ...createDefaultAgentWallet(wallet.agentId),
            enabled: false,
            provider: "manual",
            walletAddress: wallet.address,
            network: wallet.network,
            tokenSymbol: primaryTokenSymbol(wallet.network),
            custodyMode: wallet.custodyMode,
            updatedAt: now,
          },
        })));
      }
      const vaultSync = await refreshWalletVaultBackup(body.vaultPath).then(
        (status) => ({ ok: true, status }),
        (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Encrypted wallet vault sync failed." }),
      );
      return okJson({
        wallets: wallets.map((wallet, index) => ({
          ...wallet,
          label: importedWallets[index]?.label,
          derivationPath: importedWallets[index]?.derivationPath,
        })),
        wallet: wallets[0],
        importKind: "recovery-phrase",
        accountIndex,
        vaultSync,
      });
    }

    const imported = importWalletSecret(body.network || "eip155:8453", body.secret || "", body.importKind || "private-key");
    const singleWalletName = body.name?.trim() || `My ${walletNetworkLabel(imported.network)} wallet`;
    const info = await storeWalletSecret({
      agentId,
      name: singleWalletName,
      address: imported.address,
      network: imported.network,
      secret: imported.secret,
    });
    if (agentId.startsWith("user:")) {
      const now = Date.now();
      await writeWalletRecord({
        vaultPath: body.vaultPath,
        agentId: info.agentId,
        agentName: singleWalletName,
        wallet: {
          ...createDefaultAgentWallet(info.agentId),
          enabled: false,
          provider: "manual",
          walletAddress: info.address,
          network: info.network,
          tokenSymbol: primaryTokenSymbol(info.network),
          custodyMode: info.custodyMode,
          updatedAt: now,
        },
      });
    }
    const vaultSync = await refreshWalletVaultBackup(body.vaultPath).then(
      (status) => ({ ok: true, status }),
      (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Encrypted wallet vault sync failed." }),
    );
    return okJson({ wallet: info, importKind: imported.importKind, vaultSync });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Failed to import wallet.");
  }
}

function walletNetworkLabel(network: string): string {
  if (network === "eip155:4663") return "Robinhood Chain";
  if (network.startsWith("solana:")) return "Solana";
  if (network === "eip155:84532") return "Base Sepolia";
  return "Base";
}

function primaryTokenSymbol(network: string): string {
  if (network === "eip155:4663") return "USDG";
  return network.startsWith("solana:") ? "SOL" : "ETH";
}
