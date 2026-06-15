import { encodeFunctionData, parseUnits } from "viem";
import { DEFAULT_BASE_HIVE_TOKEN_ADDRESS } from "@/lib/services/hive-staking";

export type BrowserEthereumProvider = {
  request: (input: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export const BASE_CHAIN_ID_HEX = "0x2105";

const HIVE_ERC20_APPROVE_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
}] as const;

const HIVE_STAKE_ABI = [{
  type: "function",
  name: "stake",
  stateMutability: "nonpayable",
  inputs: [{ name: "amount", type: "uint256" }],
  outputs: [],
}] as const;

export function isEvmAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
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
        rpcUrls: ["https://mainnet.base.org"],
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
  const approveHash = await params.provider.request({
    method: "eth_sendTransaction",
    params: [{
      from,
      to: params.tokenAddress,
      data: encodeFunctionData({
        abi: HIVE_ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [params.stakingAddress, amountRaw],
      }),
    }],
  });

  params.onStatus?.(`Approval sent${typeof approveHash === "string" ? ` (${shortenEvmAddress(approveHash)})` : ""}. Confirm stake...`);
  const stakeHash = await params.provider.request({
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

  return {
    approveHash: typeof approveHash === "string" ? approveHash : "",
    stakeHash: typeof stakeHash === "string" ? stakeHash : "",
  };
}
