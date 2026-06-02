import "server-only";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { USEPOD_ONCHAIN_PROGRAM_ID, USEPOD_SOLANA_USDC_MINT } from "@/lib/config/usepod-features";

export const USEPOD_DEPOSIT_PROGRAM_ID = new PublicKey(USEPOD_ONCHAIN_PROGRAM_ID);
export const USEPOD_DEPOSIT_USDC_MINT = new PublicKey(USEPOD_SOLANA_USDC_MINT);

const SOLANA_MAINNET_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

let cachedDepositAccounts: Promise<UsePodDepositAccounts> | null = null;

export type UsePodDepositAccounts = {
  config: PublicKey;
  escrowWallet: PublicKey;
  recipientTokenAccount: PublicKey;
};

export function createUsePodSolanaConnection() {
  return new Connection(SOLANA_MAINNET_RPC, "confirmed");
}

export function usePodDepositConfigAddress() {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("config")], USEPOD_DEPOSIT_PROGRAM_ID)[0];
}

export async function resolveUsePodDepositAccounts(connection = createUsePodSolanaConnection()) {
  if (cachedDepositAccounts) return cachedDepositAccounts;
  cachedDepositAccounts = (async (): Promise<UsePodDepositAccounts> => {
    const config = usePodDepositConfigAddress();
    const configAccount = await connection.getAccountInfo(config);
    if (!configAccount) throw new Error("UsePod program config was not found on Solana mainnet.");
    if (configAccount.data.length < 40) throw new Error("UsePod program config is too short to contain a USDC receiver.");
    const escrowWallet = new PublicKey(configAccount.data.subarray(8, 40));
    return {
      config,
      escrowWallet,
      recipientTokenAccount: getAssociatedTokenAddressSync(USEPOD_DEPOSIT_USDC_MINT, escrowWallet, true),
    };
  })().catch((error) => {
    cachedDepositAccounts = null;
    throw error;
  });
  return cachedDepositAccounts;
}

export async function resolveUsePodUsdcRecipientAddress() {
  const accounts = await resolveUsePodDepositAccounts();
  return accounts.recipientTokenAccount.toBase58();
}
