import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { generateWallet } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret, storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { refreshWalletVaultBackup } from "@/lib/services/wallet/wallet-vault-backup";
import {
  VENICE_WALLET_VAULT_PREFIX,
  checkVeniceWalletBalance,
  topUpVeniceBalance,
} from "@/lib/services/venice";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VeniceWalletBody = {
  action?: "create" | "balance" | "top-up";
  network?: string;
  walletVaultId?: string;
  amountUsd?: number | string;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as VeniceWalletBody;
  try {
    if (body.action === "create") {
      const wallet = generateWallet(body.network || "eip155:8453");
      const vaultId = `${VENICE_WALLET_VAULT_PREFIX}${randomBytes(6).toString("hex")}`;
      const info = await storeWalletSecret({ agentId: vaultId, address: wallet.address, network: wallet.network, secret: wallet.secret });
      await refreshWalletVaultBackup().catch(() => undefined);
      return NextResponse.json({ ok: true, wallet: { vaultId: info.agentId, address: info.address, network: info.network, kind: "venice" } });
    }
    const vaultId = body.walletVaultId?.trim();
    if (!vaultId) return NextResponse.json({ ok: false, error: "walletVaultId is required." }, { status: 400 });
    const record = await getWalletSecret(vaultId);
    if (!record) return NextResponse.json({ ok: false, error: `No local wallet found for "${vaultId}".` }, { status: 404 });
    const binding = { vaultId, address: record.info.address, network: record.info.network, secret: record.secret };
    if (body.action === "top-up") {
      const amountUsd = Number(body.amountUsd);
      const result = await topUpVeniceBalance(binding, amountUsd);
      return NextResponse.json(result);
    }
    const balance = await checkVeniceWalletBalance(binding);
    return NextResponse.json({ ok: true, address: binding.address, network: binding.network, ...balance });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Venice wallet action failed." }, { status: 400 });
  }
}
