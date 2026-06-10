import { NextRequest, NextResponse } from "next/server";
import { generateWallet } from "@/lib/services/wallet/chain-wallet";
import { storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { writeWalletRecord } from "@/lib/services/obsidian/wallet-ledger";
import { refreshWalletVaultBackup } from "@/lib/services/wallet/wallet-vault-backup";
import { createDefaultAgentWallet } from "@/lib/utils/agent-wallet";
import { requireAuth } from "@/lib/utils/server-auth";

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
    if (!agentId) return NextResponse.json({ ok: false, error: "agentId is required" }, { status: 400 });
    const wallet = generateWallet(body.network || "eip155:8453");
    const info = await storeWalletSecret({ agentId, address: wallet.address, network: wallet.network, secret: wallet.secret });
    if (agentId.startsWith("user:")) {
      const now = Date.now();
      await writeWalletRecord({
        vaultPath: body.vaultPath,
        agentId: info.agentId,
        agentName: body.name?.trim() || `My ${info.network.startsWith("solana:") ? "Solana" : "Base"} wallet`,
        wallet: {
          ...createDefaultAgentWallet(info.agentId),
          enabled: false,
          provider: "manual",
          walletAddress: info.address,
          network: info.network,
          tokenSymbol: info.network.startsWith("solana:") ? "SOL" : "ETH",
          custodyMode: info.custodyMode,
          updatedAt: now,
        },
      });
    }
    const vaultSync = await refreshWalletVaultBackup(body.vaultPath).then(
      (status) => ({ ok: true, status }),
      (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Encrypted wallet vault sync failed." }),
    );
    return NextResponse.json({ ok: true, wallet: info, vaultSync });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to create wallet" }, { status: 500 });
  }
}
