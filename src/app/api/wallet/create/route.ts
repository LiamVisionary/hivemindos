import { NextRequest, NextResponse } from "next/server";
import { generateWallet } from "@/lib/services/wallet/chain-wallet";
import { storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { refreshWalletVaultBackup } from "@/lib/services/wallet/wallet-vault-backup";
import { requireAuth } from "@/lib/utils/server-auth";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as {
      agentId?: string;
      network?: string;
      vaultPath?: string;
    };
    const agentId = body.agentId?.trim();
    if (!agentId) return NextResponse.json({ ok: false, error: "agentId is required" }, { status: 400 });
    const wallet = generateWallet(body.network || "eip155:8453");
    const info = await storeWalletSecret({ agentId, address: wallet.address, network: wallet.network, secret: wallet.secret });
    const vaultSync = await refreshWalletVaultBackup(body.vaultPath).then(
      (status) => ({ ok: true, status }),
      (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : "Encrypted wallet vault sync failed." }),
    );
    return NextResponse.json({ ok: true, wallet: info, vaultSync });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed to create wallet" }, { status: 500 });
  }
}
