import "server-only";

import { createPublicClient, createWalletClient, formatEther, http, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

import { generateWallet } from "@/lib/services/wallet/chain-wallet";
import { getWalletInfo, getWalletSecret, storeWalletSecret } from "@/lib/services/wallet/local-wallet-vault";

// Same default + env overrides as chain-wallet.ts so the bot and the
// dashboard portfolio always agree on which contract is $HIVE.
const DEFAULT_BASE_HIVE = "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3";
const TREASURY_AGENT_ID = "telegram-tip-bot:treasury";
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MAX_LOG_RANGE = 2_000n; // public Base RPC rejects wide getLogs ranges

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

export type HiveTokenMeta = { address: `0x${string}`; decimals: number; symbol: string };

export type HiveDepositLog = {
  txHash: string;
  logIndex: number;
  fromAddress: string;
  amountRaw: string;
  blockNumber: string;
};

export function isEvmAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function hiveTokenAddress(): `0x${string}` {
  const candidate = process.env.HIVE_TOKEN_ADDRESS?.trim() || process.env.NEXT_PUBLIC_HIVE_TOKEN_ADDRESS?.trim() || DEFAULT_BASE_HIVE;
  if (!isEvmAddress(candidate)) throw new Error(`HIVE_TOKEN_ADDRESS is not a valid address: ${candidate}`);
  return candidate;
}

function rpcUrl() {
  return process.env.BASE_RPC_URL || "https://mainnet.base.org";
}

function publicClient() {
  return createPublicClient({ chain: base, transport: http(rpcUrl()) });
}

const metaCache = globalThis as typeof globalThis & { __hivemindTipBotTokenMeta?: HiveTokenMeta };

export async function getHiveTokenMeta(): Promise<HiveTokenMeta> {
  const address = hiveTokenAddress();
  if (metaCache.__hivemindTipBotTokenMeta?.address === address) return metaCache.__hivemindTipBotTokenMeta;
  const client = publicClient();
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address, abi: ERC20_ABI, functionName: "decimals" }),
    client.readContract({ address, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "HIVE"),
  ]);
  const meta: HiveTokenMeta = { address, decimals: Number(decimals), symbol: String(symbol) };
  metaCache.__hivemindTipBotTokenMeta = meta;
  return meta;
}

export async function ensureTreasuryWallet(): Promise<{ address: string; created: boolean }> {
  const existing = await getWalletInfo(TREASURY_AGENT_ID);
  if (existing) return { address: existing.address, created: false };
  const generated = generateWallet("eip155:8453");
  await storeWalletSecret({
    agentId: TREASURY_AGENT_ID,
    address: generated.address,
    network: generated.network,
    secret: generated.secret,
  });
  return { address: generated.address, created: true };
}

export async function getTreasuryOverview(treasuryAddress: string): Promise<{
  address: string;
  ethBalance: string;
  hiveBalanceRaw: string;
}> {
  if (!isEvmAddress(treasuryAddress)) throw new Error("Treasury address is not configured.");
  const client = publicClient();
  const meta = await getHiveTokenMeta();
  const [ethWei, hiveRaw] = await Promise.all([
    client.getBalance({ address: treasuryAddress }),
    client.readContract({ address: meta.address, abi: ERC20_ABI, functionName: "balanceOf", args: [treasuryAddress] }),
  ]);
  return { address: treasuryAddress, ethBalance: formatEther(ethWei), hiveBalanceRaw: hiveRaw.toString() };
}

export async function sendHiveFromTreasury(toAddress: string, amountRaw: bigint): Promise<{ txHash: string }> {
  if (!isEvmAddress(toAddress)) throw new Error("Recipient is not a valid Base address.");
  const record = await getWalletSecret(TREASURY_AGENT_ID);
  if (!record) throw new Error("Tip bot treasury wallet is not set up yet.");
  const account = privateKeyToAccount(record.secret as `0x${string}`);
  const meta = await getHiveTokenMeta();
  const wallet = createWalletClient({ account, chain: base, transport: http(rpcUrl()) });
  const txHash = await wallet.writeContract({
    address: meta.address,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [toAddress, amountRaw],
  });
  return { txHash };
}

// Deposits credit at head minus a confirmation depth rather than the
// "finalized" tag: finality lags Base's head by 15-25 minutes, which is
// useless deposit UX. Base runs a single sequencer with 2s blocks, so a
// small depth (default 15 ≈ 30s) is plenty for tip-sized amounts.
export async function getSafeDepositBlockNumber(confirmations: number): Promise<bigint> {
  const head = await publicClient().getBlockNumber();
  const depth = BigInt(Math.max(1, Math.floor(confirmations)));
  return head > depth ? head - depth : 0n;
}

export async function scanHiveDeposits(params: {
  treasuryAddress: string;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<HiveDepositLog[]> {
  if (!isEvmAddress(params.treasuryAddress)) throw new Error("Treasury address is not configured.");
  const client = publicClient();
  const tokenAddress = hiveTokenAddress();
  const results: HiveDepositLog[] = [];
  for (let start = params.fromBlock; start <= params.toBlock; start += MAX_LOG_RANGE + 1n) {
    const end = start + MAX_LOG_RANGE > params.toBlock ? params.toBlock : start + MAX_LOG_RANGE;
    const logs = await client.getLogs({
      address: tokenAddress,
      event: TRANSFER_EVENT,
      args: { to: params.treasuryAddress },
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs) {
      if (!log.args.from || log.args.value === undefined || log.args.value <= 0n) continue;
      results.push({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        fromAddress: log.args.from.toLowerCase(),
        amountRaw: log.args.value.toString(),
        blockNumber: log.blockNumber.toString(),
      });
    }
  }
  return results;
}

export function explorerTxUrl(txHash: string): string {
  return `https://basescan.org/tx/${txHash}`;
}
