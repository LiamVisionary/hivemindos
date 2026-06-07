import "server-only";

import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { createPublicClient, createWalletClient, formatEther, formatUnits, http, parseUnits } from "viem";
import { base, baseSepolia } from "viem/chains";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { AgentWalletBalance, AgentWalletTokenBalance } from "@/lib/types/agent-wallet";

export type SupportedWalletNetwork = "eip155:8453" | "eip155:84532" | "solana:mainnet" | "solana:devnet";

export type GeneratedWalletSecret = {
  network: SupportedWalletNetwork;
  address: string;
  secret: string;
};

export type ImportedWalletSecret = GeneratedWalletSecret & {
  importKind: "private-key" | "recovery-phrase";
};

type TokenPrice = {
  usd: number | null;
  usd_24h_change: number | null;
};

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2q3UzcezTEFoEhrCgwCbG9xDPuK";
const SOLANA_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

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
] as const;

function assertNetwork(network: string): SupportedWalletNetwork {
  if (network === "eip155:8453" || network === "eip155:84532" || network === "solana:mainnet" || network === "solana:devnet") {
    return network;
  }
  throw new Error(`Unsupported wallet network: ${network}`);
}

function evmChain(network: SupportedWalletNetwork) {
  return network === "eip155:84532" ? baseSepolia : base;
}

function evmRpc(network: SupportedWalletNetwork) {
  if (network === "eip155:84532") return process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  return process.env.BASE_RPC_URL || "https://mainnet.base.org";
}

function evmUsdc(network: SupportedWalletNetwork) {
  return network === "eip155:84532" ? BASE_SEPOLIA_USDC : BASE_USDC;
}

function solanaRpc(network: SupportedWalletNetwork) {
  if (network === "solana:devnet") return process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com";
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

function solanaUsdc(network: SupportedWalletNetwork) {
  return new PublicKey(network === "solana:devnet" ? SOLANA_DEVNET_USDC : SOLANA_USDC);
}

export function generateWallet(networkInput: string): GeneratedWalletSecret {
  const network = assertNetwork(networkInput);
  if (network.startsWith("eip155:")) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return { network, address: account.address, secret: privateKey };
  }
  const keypair = Keypair.generate();
  return {
    network,
    address: keypair.publicKey.toBase58(),
    secret: bs58.encode(keypair.secretKey),
  };
}

export function importWalletSecret(networkInput: string, secretInput: string, importKind: "private-key" | "recovery-phrase"): ImportedWalletSecret {
  const network = assertNetwork(networkInput);
  const secret = secretInput.trim();
  if (!secret) throw new Error("Wallet secret is required.");
  if (network.startsWith("eip155:")) {
    const account = importKind === "recovery-phrase"
      ? mnemonicToAccount(secret)
      : privateKeyToAccount(normalizeEvmPrivateKey(secret));
    return { network, address: account.address, secret: importKind === "private-key" ? normalizeEvmPrivateKey(secret) : secret, importKind };
  }
  if (importKind === "recovery-phrase") {
    throw new Error("Solana recovery phrase import is not available in this build. Import a Solana private key/exported secret key instead.");
  }
  const keypair = Keypair.fromSecretKey(parseSolanaSecret(secret));
  return { network, address: keypair.publicKey.toBase58(), secret: bs58.encode(keypair.secretKey), importKind };
}

export async function getWalletBalance(address: string, networkInput: string): Promise<AgentWalletBalance> {
  const network = assertNetwork(networkInput);
  if (!address.trim()) throw new Error("Wallet address is required.");
  if (network.startsWith("eip155:")) {
    const client = createPublicClient({ chain: evmChain(network), transport: http(evmRpc(network)) });
    const [tokenRaw, nativeRaw, prices] = await Promise.all([
      client.readContract({
        address: evmUsdc(network),
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }),
      client.getBalance({ address: address as `0x${string}` }),
      fetchTokenPrices(["ethereum", "usd-coin"]),
    ]);
    const tokenBalance = Number(formatUnits(tokenRaw, 6));
    const nativeBalance = Number(formatEther(nativeRaw));
    return {
      address,
      network,
      tokenSymbol: "USDC",
      tokenBalance,
      nativeBalance,
      tokens: [
        tokenRow({ symbol: "ETH", name: "Ether", balance: nativeBalance, network, price: prices.ethereum, isNative: true }),
        tokenRow({ symbol: "USDC", name: "USD Coin", balance: tokenBalance, network, price: prices["usd-coin"] }),
      ],
      fetchedAt: Date.now(),
    };
  }

  const connection = new Connection(solanaRpc(network), "confirmed");
  const owner = new PublicKey(address);
  const [tokenAccounts, lamports, prices] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { mint: solanaUsdc(network) }),
    connection.getBalance(owner),
    fetchTokenPrices(["solana", "usd-coin"]),
  ]);
  const tokenBalance = tokenAccounts.value.reduce((total, account) => {
    const amount = account.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
    return total + amount;
  }, 0);
  const nativeBalance = lamports / LAMPORTS_PER_SOL;
  return {
    address,
    network,
    tokenSymbol: "USDC",
    tokenBalance,
    nativeBalance,
    tokens: [
      tokenRow({ symbol: "SOL", name: "Solana", balance: nativeBalance, network, price: prices.solana, isNative: true }),
      tokenRow({ symbol: "USDC", name: "USD Coin", balance: tokenBalance, network, price: prices["usd-coin"] }),
    ],
    fetchedAt: Date.now(),
  };
}

export async function sendUsdc(params: {
  network: string;
  secret: string;
  fromAddress: string;
  toAddress: string;
  amountUsd: number;
}): Promise<{ signature: string }> {
  const network = assertNetwork(params.network);
  if (!Number.isFinite(params.amountUsd) || params.amountUsd <= 0) throw new Error("Amount must be greater than zero.");
  if (network.startsWith("eip155:")) {
    const account = evmAccountFromSecret(params.secret);
    if (account.address.toLowerCase() !== params.fromAddress.toLowerCase()) throw new Error("Stored key does not match wallet address.");
    const wallet = createWalletClient({ account, chain: evmChain(network), transport: http(evmRpc(network)) });
    const hash = await wallet.writeContract({
      address: evmUsdc(network),
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [params.toAddress as `0x${string}`, parseUnits(params.amountUsd.toFixed(6), 6)],
    });
    return { signature: hash };
  }

  const connection = new Connection(solanaRpc(network), "confirmed");
  const payer = Keypair.fromSecretKey(bs58.decode(params.secret));
  if (payer.publicKey.toBase58() !== params.fromAddress) throw new Error("Stored key does not match wallet address.");
  const mint = solanaUsdc(network);
  const recipient = new PublicKey(params.toAddress);
  const fromAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
  const toAta = getAssociatedTokenAddressSync(mint, recipient);
  const transaction = new Transaction();
  const toInfo = await connection.getAccountInfo(toAta);
  if (!toInfo) {
    transaction.add(createAssociatedTokenAccountInstruction(payer.publicKey, toAta, recipient, mint));
  }
  transaction.add(createTransferInstruction(fromAta, toAta, payer.publicKey, BigInt(Math.round(params.amountUsd * 1_000_000))));
  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], { commitment: "confirmed" });
  return { signature };
}

function evmAccountFromSecret(secret: string) {
  try {
    return privateKeyToAccount(normalizeEvmPrivateKey(secret));
  } catch {
    return mnemonicToAccount(secret.trim());
  }
}

function normalizeEvmPrivateKey(secret: string): `0x${string}` {
  const compact = secret.trim();
  const prefixed = compact.startsWith("0x") ? compact : `0x${compact}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(prefixed)) throw new Error("EVM private keys must be 32-byte hex.");
  return prefixed as `0x${string}`;
}

function parseSolanaSecret(secret: string): Uint8Array {
  if (secret.startsWith("[")) {
    const parsed = JSON.parse(secret) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Solana secret key JSON must be an array.");
    return Uint8Array.from(parsed.map((value) => Number(value)));
  }
  return bs58.decode(secret);
}

async function fetchTokenPrices(ids: string[]): Promise<Record<string, TokenPrice | undefined>> {
  const query = ids.map(encodeURIComponent).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${query}&vs_currencies=usd&include_24hr_change=true`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  }).catch(() => null);
  if (!response?.ok) return {};
  const data = await response.json().catch(() => null) as Record<string, TokenPrice> | null;
  return data ?? {};
}

function tokenRow(input: {
  symbol: string;
  name: string;
  balance: number;
  network: string;
  price?: TokenPrice;
  isNative?: boolean;
}): AgentWalletTokenBalance {
  const priceUsd = typeof input.price?.usd === "number" ? input.price.usd : input.symbol === "USDC" ? 1 : null;
  return {
    symbol: input.symbol,
    name: input.name,
    balance: input.balance,
    network: input.network,
    priceUsd,
    valueUsd: priceUsd == null ? null : Math.round(input.balance * priceUsd * 100) / 100,
    priceChange24hPct: typeof input.price?.usd_24h_change === "number" ? input.price.usd_24h_change : null,
    isNative: input.isNative,
  };
}
