import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  createUsePodSolanaConnection,
  resolveUsePodDepositAccounts,
  USEPOD_DEPOSIT_PROGRAM_ID,
  USEPOD_DEPOSIT_USDC_MINT,
} from "@/lib/services/usepod/deposit-recipient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DepositTransactionBody = {
  amountUsdc?: string;
  depositCode?: string;
  depositor?: string;
};

function parseUsdcMicros(value = "") {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d{1,6})?$/.test(trimmed)) throw new Error("Enter a USDC amount with up to 6 decimals.");
  const [whole, fraction = ""] = trimmed.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micros <= 0n) throw new Error("Amount must be greater than 0 USDC.");
  return micros;
}

function parseDepositCode(value = "") {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]{16}$/.test(trimmed)) throw new Error("UsePod funding reference must be 16 hex characters.");
  return Uint8Array.from(trimmed.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function u64Le(value: bigint) {
  const buffer = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return buffer;
}

function anchorDiscriminator(name: string) {
  return new Uint8Array(createHash("sha256").update(`global:${name}`).digest().subarray(0, 8));
}

function concatBytes(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as DepositTransactionBody;
    const depositCode = parseDepositCode(body.depositCode);
    const amountMicros = parseUsdcMicros(body.amountUsdc);
    const depositor = new PublicKey(body.depositor ?? "");
    const connection = createUsePodSolanaConnection();
    const depositAccounts = await resolveUsePodDepositAccounts(connection);

    const depositorAta = getAssociatedTokenAddressSync(USEPOD_DEPOSIT_USDC_MINT, depositor);
    const data = concatBytes([
      anchorDiscriminator("deposit_usdc"),
      depositCode,
      u64Le(amountMicros),
    ]);
    const instruction = new TransactionInstruction({
      programId: USEPOD_DEPOSIT_PROGRAM_ID,
      keys: [
        { pubkey: depositorAta, isSigner: false, isWritable: true },
        { pubkey: depositAccounts.recipientTokenAccount, isSigner: false, isWritable: true },
        { pubkey: depositAccounts.config, isSigner: false, isWritable: false },
        { pubkey: depositor, isSigner: true, isWritable: false },
        { pubkey: USEPOD_DEPOSIT_USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    });
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({
      feePayer: depositor,
      blockhash,
      lastValidBlockHeight,
    }).add(instruction);

    return NextResponse.json({
      ok: true,
      transactionBase64: transaction.serialize({ requireAllSignatures: false }).toString("base64"),
      amountMicros: amountMicros.toString(),
      currency: "USDC",
      network: "Solana mainnet-beta",
      recipientAddress: depositAccounts.recipientTokenAccount.toBase58(),
      programId: USEPOD_DEPOSIT_PROGRAM_ID.toBase58(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : "";
    return NextResponse.json({
      ok: false,
      error: message || "Could not prepare the UsePod deposit transaction.",
    }, { status: 400 });
  }
}
