import "server-only";

import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";

const USEPOD_BOND_PROGRAM_ID = new PublicKey("BBAdcqUkg68JXNiPQ1HR1wujfZuayyK3eQTQSYAh6FSW");
const USEPOD_BOND_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const BOND_DEPOSIT_DISCRIMINATOR = new Uint8Array([184, 148, 250, 169, 224, 213, 34, 126]);

export type UsePodBondPostResult =
  | { status: "posted"; signature: string; balanceUsdc: number }
  | { status: "needs-funds"; balanceUsdc: number; requiredUsdc: number };

function connection() {
  return new Connection(process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com", "confirmed");
}

function associatedTokenAddress(owner: PublicKey, mint = USEPOD_BOND_USDC_MINT) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function configAddress() {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("config")], USEPOD_BOND_PROGRAM_ID)[0];
}

async function escrowOwner(rpc: Connection) {
  const account = await rpc.getAccountInfo(configAddress());
  if (!account) throw new Error("UsePod bond program config was not found on Solana.");
  return new PublicKey(account.data.slice(8, 40));
}

function depositCodeBytes(depositCode: string) {
  if (depositCode.startsWith("POD-BOND-")) {
    const shortId = depositCode.slice("POD-BOND-".length);
    if (!/^[A-Za-z0-9]{8}$/.test(shortId)) {
      throw new Error("UsePod bond deposit code is invalid.");
    }
    return new Uint8Array(Array.from(shortId).map((char) => char.charCodeAt(0)));
  }
  if (!/^[0-9a-fA-F]{16}$/.test(depositCode)) {
    throw new Error("UsePod bond deposit code is invalid.");
  }
  return new Uint8Array(Array.from({ length: 8 }, (_, index) => parseInt(depositCode.slice(index * 2, index * 2 + 2), 16)));
}

function u64Le(value: bigint) {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, value, true);
  return new Uint8Array(buffer);
}

export function bondDepositCodeFromEnrollmentCode(enrollmentCode?: string) {
  const shortId = enrollmentCode?.replace(/^POD-ENROLL-/, "").trim() ?? "";
  return /^[A-Za-z0-9]{8}$/.test(shortId) ? `POD-BOND-${shortId}` : "";
}

export async function getUsePodBondUsdcBalance(address: string) {
  const rpc = connection();
  const owner = new PublicKey(address);
  const ata = associatedTokenAddress(owner);
  if (!await rpc.getAccountInfo(ata)) return 0;
  return (await rpc.getTokenAccountBalance(ata)).value.uiAmount ?? 0;
}

export async function postUsePodOperatorBond(params: {
  fromAddress: string;
  secret: string;
  amountUsdc: number;
  depositCode: string;
}): Promise<UsePodBondPostResult> {
  const rpc = connection();
  const payer = Keypair.fromSecretKey(bs58.decode(params.secret));
  if (payer.publicKey.toBase58() !== params.fromAddress) throw new Error("Stored provider wallet key does not match the payout wallet address.");

  const balanceUsdc = await getUsePodBondUsdcBalance(params.fromAddress);
  if (balanceUsdc < params.amountUsdc) {
    return { status: "needs-funds", balanceUsdc, requiredUsdc: params.amountUsdc };
  }

  const escrow = await escrowOwner(rpc);
  const sourceAta = associatedTokenAddress(payer.publicKey);
  const escrowAta = associatedTokenAddress(escrow);
  const data = new Uint8Array([
    ...BOND_DEPOSIT_DISCRIMINATOR,
    ...depositCodeBytes(params.depositCode),
    ...u64Le(BigInt(Math.round(params.amountUsdc * 1_000_000))),
  ]);
  const transaction = new Transaction();
  transaction.add(new TransactionInstruction({
    programId: USEPOD_BOND_PROGRAM_ID,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: escrowAta, isSigner: false, isWritable: true },
      { pubkey: configAddress(), isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: USEPOD_BOND_USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  }));
  const signature = await sendAndConfirmTransaction(rpc, transaction, [payer], { commitment: "confirmed" });
  return { status: "posted", signature, balanceUsdc };
}
