import { createPublicClient, custom, encodeFunctionData, fallback, http, parseUnits, webSocket } from "viem";
import type { Address } from "viem";
import {
  BASE_CHAIN_ID_HEX,
  BASE_HIVE_READ_RPC_URLS,
  DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
  isHiveEvmAddress,
} from "@/lib/config/hive-staking";
import { base } from "@/lib/services/wallet/base-chain";

export type BrowserEthereumProvider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export { BASE_CHAIN_ID_HEX } from "@/lib/config/hive-staking";

const HIVE_ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const HIVE_STAKE_ABI = [{
  type: "function",
  name: "stake",
  stateMutability: "nonpayable",
  inputs: [{ name: "amount", type: "uint256" }],
  outputs: [],
}] as const;

export function isEvmAddress(value: string): value is Address {
  return isHiveEvmAddress(value);
}

export function shortenEvmAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isBaseHiveTokenLike(token: { network: string; symbol: string; tokenAddress?: string; isNative?: boolean }) {
  if (token.network !== "eip155:8453" || token.isNative) return false;
  const tokenAddress = token.tokenAddress?.trim().toLowerCase();
  return tokenAddress
    ? tokenAddress === DEFAULT_BASE_HIVE_TOKEN_ADDRESS.toLowerCase()
    : token.symbol.trim().toUpperCase() === "HIVE";
}

export async function switchBrowserWalletToBase(provider: BrowserEthereumProvider) {
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID_HEX }] }).catch(async (error: unknown) => {
    const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BASE_CHAIN_ID_HEX,
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: walletHttpRpcUrls(),
        blockExplorerUrls: ["https://basescan.org"],
      }],
    });
  });
}

export async function stakeHiveWithBrowserWallet(params: {
  provider: BrowserEthereumProvider;
  walletAddress: string;
  tokenAddress: string;
  stakingAddress: string;
  amountText: string;
  decimals?: number;
  onStatus?: (message: string) => void;
}) {
  if (!isEvmAddress(params.walletAddress)) throw new Error(`Invalid wallet address: ${params.walletAddress}`);
  if (!isEvmAddress(params.tokenAddress)) throw new Error(`Invalid HIVE token address: ${params.tokenAddress}`);
  if (!isEvmAddress(params.stakingAddress)) throw new Error(`Invalid HIVE staking contract address: ${params.stakingAddress}`);

  params.onStatus?.("Connecting Base wallet...");
  const accounts = await params.provider.request({ method: "eth_requestAccounts" }) as string[];
  const from = accounts.find((account): account is `0x${string}` => isEvmAddress(account));
  if (!from) throw new Error("Wallet connected, but no EVM account was returned.");
  if (from.toLowerCase() !== params.walletAddress.toLowerCase()) {
    throw new Error(`Connected wallet is ${shortenEvmAddress(from)}. Switch to ${shortenEvmAddress(params.walletAddress)} to stake this HIVE.`);
  }

  await switchBrowserWalletToBase(params.provider);
  const amountRaw = parseUnits(params.amountText, params.decimals ?? 18);

  params.onStatus?.("Approve HIVE staking in your wallet...");
  const approvalResult = await params.provider.request({
    method: "eth_sendTransaction",
    params: [{
      from,
      to: params.tokenAddress,
      data: encodeFunctionData({
        abi: HIVE_ERC20_ABI,
        functionName: "approve",
        args: [params.stakingAddress, amountRaw],
      }),
    }],
  });
  const approveHash = typeof approvalResult === "string" ? approvalResult : "";
  if (!approveHash) throw new Error("Wallet did not return a HIVE approval transaction hash.");

  params.onStatus?.(`Approval sent (${shortenEvmAddress(approveHash)}). Waiting for confirmation...`);
  await waitForBrowserWalletReceipt(params.provider, approveHash, "approval");
  params.onStatus?.("Approval confirmed. Waiting for wallet RPC to read allowance...");
  await waitForBrowserWalletAllowance({
    provider: params.provider,
    owner: from,
    tokenAddress: params.tokenAddress,
    spender: params.stakingAddress,
    amountRaw,
  });

  params.onStatus?.("Allowance confirmed. Confirm stake in your wallet...");
  const stakeResult = await params.provider.request({
    method: "eth_sendTransaction",
    params: [{
      from,
      to: params.stakingAddress,
      data: encodeFunctionData({
        abi: HIVE_STAKE_ABI,
        functionName: "stake",
        args: [amountRaw],
      }),
    }],
  });
  const stakeHash = typeof stakeResult === "string" ? stakeResult : "";
  if (!stakeHash) throw new Error("Wallet did not return a HIVE stake transaction hash.");

  params.onStatus?.(`Stake sent (${shortenEvmAddress(stakeHash)}). Waiting for confirmation...`);
  await waitForBrowserWalletReceipt(params.provider, stakeHash, "stake");
  params.onStatus?.("Stake confirmed.");

  return {
    approveHash,
    stakeHash,
  };
}

function createHiveStakingBrowserClient(provider: BrowserEthereumProvider) {
  const readTransports = BASE_HIVE_READ_RPC_URLS.map((url) => {
    const options = { retryCount: 1, timeout: 10_000 };
    return url.startsWith("wss://") ? webSocket(url, options) : http(url, options);
  });
  return createPublicClient({
    chain: base,
    transport: fallback([custom(provider), ...readTransports], {
      rank: false,
      retryCount: 1,
    }),
  });
}

function walletHttpRpcUrls() {
  return BASE_HIVE_READ_RPC_URLS.filter((url) => url.startsWith("http"));
}

async function waitForBrowserWalletReceipt(provider: BrowserEthereumProvider, txHash: string, label: "approval" | "stake") {
  const timeoutMs = 120_000;
  const pollMs = 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }).catch(() => null);

    if (receipt && typeof receipt === "object") {
      const status = "status" in receipt ? receipt.status : undefined;
      if (receiptStatusFailed(status)) {
        throw new Error(`HIVE ${label} transaction failed.`);
      }
      return;
    }

    await sleep(pollMs);
  }

  throw new Error(`HIVE ${label} transaction is still pending. Wait for it to confirm, then refresh this page.`);
}

async function waitForBrowserWalletAllowance(params: {
  provider: BrowserEthereumProvider;
  owner: Address;
  tokenAddress: Address;
  spender: Address;
  amountRaw: bigint;
}) {
  const timeoutMs = 90_000;
  const pollMs = 2_000;
  const startedAt = Date.now();
  const client = createHiveStakingBrowserClient(params.provider);

  while (Date.now() - startedAt < timeoutMs) {
    const allowance = await client.readContract({
      address: params.tokenAddress,
      abi: HIVE_ERC20_ABI,
      functionName: "allowance",
      args: [params.owner, params.spender],
    }).catch(() => null);

    if (allowance != null && allowance >= params.amountRaw) return;
    await sleep(pollMs);
  }

  throw new Error("HIVE approval confirmed, but the wallet RPC has not returned the updated allowance yet. Refresh and press Stake again.");
}

function receiptStatusFailed(status: unknown) {
  if (status === false || status === 0 || status === BigInt(0)) return true;
  return typeof status === "string" && ["0", "0x0"].includes(status.toLowerCase());
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
