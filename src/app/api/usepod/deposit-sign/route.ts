import { NextRequest, NextResponse } from "next/server";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createUsePodSolanaConnection } from "@/lib/services/usepod/deposit-recipient";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DepositSignBody = {
  walletVaultId?: string;
  transactionBase64?: string;
};

// Signs a prepared UsePod deposit transaction with a locally-held Solana wallet
// (encrypted vault custody) so funding works without a browser wallet extension.
// The transaction must have been built by /api/usepod/deposit-transaction with
// this wallet's address as the depositor.
export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => ({})) as DepositSignBody;
  try {
    const vaultId = body.walletVaultId?.trim();
    if (!vaultId) return NextResponse.json({ ok: false, error: "walletVaultId is required." }, { status: 400 });
    if (!body.transactionBase64?.trim()) return NextResponse.json({ ok: false, error: "transactionBase64 is required." }, { status: 400 });
    const record = await getWalletSecret(vaultId);
    if (!record) return NextResponse.json({ ok: false, error: `No local wallet found for "${vaultId}".` }, { status: 404 });
    if (!record.info.network.startsWith("solana:")) {
      return NextResponse.json({ ok: false, error: "UsePod deposits need a Solana wallet; this wallet is on another network." }, { status: 400 });
    }
    const keypair = Keypair.fromSecretKey(bs58.decode(record.secret));
    const transaction = Transaction.from(Buffer.from(body.transactionBase64, "base64"));
    if (transaction.feePayer?.toBase58() !== keypair.publicKey.toBase58()) {
      return NextResponse.json({ ok: false, error: "The prepared transaction's depositor does not match this wallet." }, { status: 400 });
    }
    transaction.partialSign(keypair);
    const connection = createUsePodSolanaConnection();
    const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
    return NextResponse.json({ ok: true, signature, address: record.info.address });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not sign and send the UsePod deposit." }, { status: 400 });
  }
}
