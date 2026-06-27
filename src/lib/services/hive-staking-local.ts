import "server-only";

import { createWalletClient, http, parseUnits } from "viem";
import type { Hash } from "viem";
import { validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS, DEFAULT_BASE_HIVE_TOKEN_ADDRESS } from "@/lib/config/hive-staking";
import { isEvmAddress } from "@/lib/services/hive-staking-client";
import { createHiveStakingPublicClient, HIVE_ERC20_ABI, HIVE_STAKE_VAULT_ABI } from "@/lib/services/hive-staking";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { base } from "@/lib/services/wallet/base-chain";

const EVM_RECOVERY_PATH = "m/44'/60'/0'/0/0";

export async function hiveStakingWriteContractAddress(): Promise<`0x${string}`> {
  const candidate = await hiveEnvValue("HIVE_STAKING_CONTRACT_ADDRESS")
    || await hiveEnvValue("NEXT_PUBLIC_HIVE_STAKING_CONTRACT_ADDRESS")
    || DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS;
  if (!isEvmAddress(candidate)) throw new Error("HIVE staking contract address is not configured.");
  return candidate;
}

export async function hiveWriteTokenAddress(): Promise<`0x${string}`> {
  const candidate = await hiveEnvValue("HIVE_TOKEN_ADDRESS")
    || await hiveEnvValue("NEXT_PUBLIC_HIVE_TOKEN_ADDRESS")
    || DEFAULT_BASE_HIVE_TOKEN_ADDRESS;
  if (!isEvmAddress(candidate)) throw new Error("HIVE token address is not configured.");
  return candidate;
}

async function hiveBaseRpcUrl() {
  return await hiveEnvValue("BASE_RPC_URL") || "https://mainnet.base.org";
}

export async function stakeHiveFromLocalWallet(input: {
  secret: string;
  fromAddress: string;
  amountHive: string;
  tokenAddress?: string;
  stakingAddress?: string;
}) {
  if (!isEvmAddress(input.fromAddress)) throw new Error("Wallet address is not a valid Base address.");

  const account = evmAccountFromLocalSecret(input.secret);
  if (account.address.toLowerCase() !== input.fromAddress.toLowerCase()) {
    throw new Error("Stored wallet key does not match the selected staking wallet.");
  }

  const tokenAddress = input.tokenAddress ? validateAddress(input.tokenAddress, "HIVE token") : await hiveWriteTokenAddress();
  const stakingAddress = input.stakingAddress ? validateAddress(input.stakingAddress, "HIVE staking contract") : await hiveStakingWriteContractAddress();
  const rpcUrl = await hiveBaseRpcUrl();
  const publicClient = createHiveStakingPublicClient(rpcUrl);
  const tokenDecimals = Number(await publicClient.readContract({
    address: tokenAddress,
    abi: HIVE_ERC20_ABI,
    functionName: "decimals",
  }).catch(() => 18));
  const amountRaw = parseHiveStakeAmount(input.amountHive, tokenDecimals);
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl),
  });

  const approveHash = await wallet.writeContract({
    address: tokenAddress,
    abi: HIVE_ERC20_ABI,
    functionName: "approve",
    args: [stakingAddress, amountRaw],
  });
  await waitForHiveTransactionReceipt(publicClient, approveHash, "approval");
  await waitForHiveAllowance({ publicClient, owner: account.address, tokenAddress, spender: stakingAddress, amountRaw });

  const stakeHash = await wallet.writeContract({
    address: stakingAddress,
    abi: HIVE_STAKE_VAULT_ABI,
    functionName: "stake",
    args: [amountRaw],
  });
  await waitForHiveTransactionReceipt(publicClient, stakeHash, "stake");

  return { approveHash, stakeHash };
}

export function evmAccountFromLocalSecret(secret: string) {
  const privateKey = maybeNormalizeEvmPrivateKey(secret);
  if (privateKey) return privateKeyToAccount(privateKey);
  return mnemonicToAccount(normalizeRecoveryPhrase(secret), { path: EVM_RECOVERY_PATH });
}

function maybeNormalizeEvmPrivateKey(secret: string): `0x${string}` | null {
  const compact = secret.trim();
  const prefixed = compact.startsWith("0x") ? compact : `0x${compact}`;
  return /^0x[a-fA-F0-9]{64}$/.test(prefixed) ? prefixed as `0x${string}` : null;
}

function normalizeRecoveryPhrase(secret: string) {
  const mnemonic = secret.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(mnemonic, englishWordlist)) {
    throw new Error("Stored Base signer must be an EVM private key or recovery phrase.");
  }
  return mnemonic;
}

function validateAddress(value: string, label: string): `0x${string}` {
  if (!isEvmAddress(value)) throw new Error(`${label} address is invalid.`);
  return value;
}

function parseHiveStakeAmount(amountHive: string, decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Invalid HIVE token decimals: ${decimals}`);
  let amountRaw: bigint;
  try {
    amountRaw = parseUnits(amountHive.trim(), decimals);
  } catch {
    throw new Error("Stake amount must be a valid HIVE amount.");
  }
  if (amountRaw <= 0n) throw new Error("Stake amount must be greater than zero.");
  return amountRaw;
}

async function waitForHiveTransactionReceipt(
  publicClient: ReturnType<typeof createHiveStakingPublicClient>,
  hash: Hash,
  label: "approval" | "stake",
) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  if (receipt.status !== "success") throw new Error(`HIVE ${label} transaction failed.`);
}

async function waitForHiveAllowance(params: {
  publicClient: ReturnType<typeof createHiveStakingPublicClient>;
  owner: `0x${string}`;
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amountRaw: bigint;
}) {
  const timeoutMs = 90_000;
  const pollMs = 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const allowance = await params.publicClient.readContract({
      address: params.tokenAddress,
      abi: HIVE_ERC20_ABI,
      functionName: "allowance",
      args: [params.owner, params.spender],
    }).catch(() => null);
    if (allowance != null && allowance >= params.amountRaw) return;
    await sleep(pollMs);
  }

  throw new Error("HIVE approval confirmed, but the Base RPC has not returned the updated allowance yet. Try again after the approval is visible.");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
