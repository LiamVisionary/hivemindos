import { NextRequest, NextResponse } from "next/server";
import { generateRecoveryPhraseWallets, generateWallet } from "@/lib/services/wallet/chain-wallet";
import { storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { writeWalletRecord } from "@/lib/services/obsidian/wallet-ledger";
import { refreshWalletVaultBackup } from "@/lib/services/wallet/wallet-vault-backup";
import { createDefaultAgentWallet, normalizeAgentWalletPermissions } from "@/lib/utils/agent-wallet";
import { requireAuth } from "@/lib/utils/server-auth";

type VaultSyncResult =
  | { ok: true; status: Awaited<ReturnType<typeof refreshWalletVaultBackup>> }
  | { ok: false; error: string };

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      network?: string;
      name?: string;
      agentPermissions?: unknown;
      createKind?: "single-network" | "multi-chain";
      vaultPath?: string;
    };
    const agentId = body.agentId?.trim();
    if (!agentId) return NextResponse.json({ ok: false, error: "agentId is required" }, { status: 400 });

    if (body.createKind === "multi-chain") {
      const generatedWallets = generateRecoveryPhraseWallets();
      const wallets: Awaited<ReturnType<typeof storeWalletSecret>>[] = [];
      const walletName = body.name?.trim() || "My wallet";
      for (const wallet of generatedWallets) {
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
          agentName: generatedWallets.length > 1
            ? `${walletName} ${generatedWallets[index]?.label || (wallet.network.startsWith("solana:") ? "Solana" : "Base")}`
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
      const vaultSync = await refreshWalletVaultBackupStatus(body.vaultPath);
      return NextResponse.json({
        ok: true,
        wallets: wallets.map((wallet, index) => ({
          ...wallet,
          label: generatedWallets[index]?.label,
          derivationPath: generatedWallets[index]?.derivationPath,
        })),
        wallet: wallets[0],
        createKind: "multi-chain",
        vaultSync,
      });
    }

    const wallet = generateWallet(body.network || "eip155:8453");
    const singleWalletName = body.name?.trim() || `My ${walletNetworkLabel(wallet.network)} wallet`;
    const info = await storeWalletSecret({ agentId, name: singleWalletName, address: wallet.address, network: wallet.network, secret: wallet.secret });
    const now = Date.now();
    const personalWallet = agentId.startsWith("user:");
    await writeWalletRecord({
      vaultPath: body.vaultPath,
      agentId: info.agentId,
      agentName: singleWalletName,
      wallet: {
        ...createDefaultAgentWallet(info.agentId),
        name: singleWalletName,
        agentPermissions: personalWallet ? undefined : normalizeAgentWalletPermissions(body.agentPermissions),
        enabled: false,
        provider: personalWallet ? "manual" : "x402",
        walletAddress: info.address,
        network: info.network,
        tokenSymbol: primaryTokenSymbol(info.network),
        custodyMode: info.custodyMode,
        updatedAt: now,
      },
    });
    const vaultSync = await refreshWalletVaultBackupStatus(body.vaultPath);
    return NextResponse.json({ ok: true, wallet: info, vaultSync });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to create wallet" }, { status: 500 });
  }
}

function refreshWalletVaultBackupStatus(vaultPath?: string): Promise<VaultSyncResult> {
  return refreshWalletVaultBackup(vaultPath).then(
    (status) => ({ ok: true, status }),
    (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Encrypted wallet vault sync failed." }),
  );
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
