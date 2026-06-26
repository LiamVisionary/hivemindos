import "server-only";

import { createHmac } from "crypto";
import type { BinaryLike } from "crypto";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import bs58 from "bs58";
import { concat, createPublicClient, createWalletClient, fallback, formatEther, formatUnits, http, maxUint256, numberToHex, parseUnits, size, webSocket } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import type { AgentWalletBalance, AgentWalletTokenBalance } from "@/lib/types/agent-wallet";
import { base, baseSepolia } from "@/lib/services/wallet/base-chain";

export type SupportedWalletNetwork = "eip155:8453" | "eip155:84532" | "solana:mainnet" | "solana:devnet";

export type GeneratedWalletSecret = {
  network: SupportedWalletNetwork;
  address: string;
  secret: string;
};

export type ImportedWalletSecret = GeneratedWalletSecret & {
  importKind: "private-key" | "recovery-phrase";
};

export type RecoveryPhraseWalletSecret = ImportedWalletSecret & {
  label: string;
  derivationPath: string;
};

type TokenPrice = {
  usd: number | null;
  usd_24h_change: number | null;
  imageUrl?: string | null;
  name?: string | null;
  symbol?: string | null;
};

type DexScreenerPair = {
  chainId?: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  info?: { imageUrl?: string };
};

type BlockscoutTokenBalance = {
  token?: {
    address_hash?: string;
    decimals?: string;
    exchange_rate?: string | null;
    icon_url?: string | null;
    name?: string;
    reputation?: string;
    symbol?: string;
    type?: string;
  };
  value?: string;
};

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_USDT = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";
const BASE_HIVE = "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3";
const SOLANA_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const EVM_RECOVERY_PATH = "m/44'/60'/0'/0/0";
const SOLANA_RECOVERY_PATH = "m/44'/501'/0'/0'";
const HARDENED_OFFSET = 0x80000000;
const MAX_DEXSCREENER_TOKEN_QUOTE_HYDRATIONS = 50;
const ETH_ICON_URL = "https://assets.coingecko.com/coins/images/279/large/ethereum.png";
const SOL_ICON_URL = "https://assets.coingecko.com/coins/images/4128/large/solana.png";
const USDC_ICON_URL = "https://assets.coingecko.com/coins/images/6319/large/usdc.png";
const SOLANA_TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];

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
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
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
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
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

function envRpcUrls(value: string | undefined) {
  return (value || "")
    .split(/[,\s]+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function evmReadRpcUrls(network: SupportedWalletNetwork) {
  if (network === "eip155:84532") {
    return uniqueStrings([
      ...envRpcUrls(process.env.BASE_SEPOLIA_RPC_URL),
      "https://sepolia.base.org",
    ]);
  }
  return uniqueStrings([
    ...envRpcUrls(process.env.BASE_RPC_URL),
    "https://mainnet.base.org",
    "https://base.api.pocket.network",
    "https://base-rpc.publicnode.com",
    "https://1rpc.io/base",
    "wss://base-rpc.publicnode.com",
  ]);
}

function evmReadTransport(network: SupportedWalletNetwork) {
  return fallback(
    evmReadRpcUrls(network).map((url) => url.startsWith("wss://")
      ? webSocket(url, { retryCount: 1, timeout: 8_000 })
      : http(url, { retryCount: 1, timeout: 8_000 })),
    { retryCount: 0 },
  );
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

async function fetchSolanaTokenAccountsByOwner(connection: Connection, owner: PublicKey) {
  const rows: Awaited<ReturnType<Connection["getParsedTokenAccountsByOwner"]>>["value"] = [];
  for (const programId of SOLANA_TOKEN_PROGRAMS) {
    const result = await retrySolanaRpc(() => connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(programId) }));
    rows.push(...result.value);
  }
  return rows;
}

async function retrySolanaRpc<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("429")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 700));
    return await operation();
  }
}

function knownEvmTokenAddresses(network: SupportedWalletNetwork) {
  if (network !== "eip155:8453") return [evmUsdc(network)];
  return uniqueEvmAddresses([
    BASE_USDC,
    BASE_USDT,
    BASE_HIVE,
    process.env.HIVE_TOKEN_ADDRESS?.trim(),
    process.env.NEXT_PUBLIC_HIVE_TOKEN_ADDRESS?.trim(),
  ]);
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

export function importRecoveryPhraseWallets(secretInput: string): RecoveryPhraseWalletSecret[] {
  const mnemonic = normalizeMnemonic(secretInput);
  const evmAccount = mnemonicToAccount(mnemonic, { path: EVM_RECOVERY_PATH });
  const solanaKeypair = solanaKeypairFromMnemonic(mnemonic, SOLANA_RECOVERY_PATH);
  return [
    {
      label: "Base",
      network: "eip155:8453",
      address: evmAccount.address,
      secret: mnemonic,
      importKind: "recovery-phrase",
      derivationPath: EVM_RECOVERY_PATH,
    },
    {
      label: "Solana",
      network: "solana:mainnet",
      address: solanaKeypair.publicKey.toBase58(),
      secret: bs58.encode(solanaKeypair.secretKey),
      importKind: "recovery-phrase",
      derivationPath: SOLANA_RECOVERY_PATH,
    },
  ];
}

export function generateRecoveryPhraseWallets(): RecoveryPhraseWalletSecret[] {
  return importRecoveryPhraseWallets(generateMnemonic(englishWordlist));
}

export async function getWalletBalance(address: string, networkInput: string): Promise<AgentWalletBalance> {
  const network = assertNetwork(networkInput);
  if (!address.trim()) throw new Error("Wallet address is required.");
  if (network.startsWith("eip155:")) {
    const client = createPublicClient({ chain: evmChain(network), transport: evmReadTransport(network) });
    const [tokenRaw, nativeRaw, prices, indexedTokens] = await Promise.all([
      client.readContract({
        address: evmUsdc(network),
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }),
      client.getBalance({ address: address as `0x${string}` }),
      fetchTokenPrices(["ethereum", "usd-coin"]),
      fetchEvmIndexedTokenBalances(address, network),
    ]);
    const tokenBalance = Number(formatUnits(tokenRaw, 6));
    const nativeBalance = Number(formatEther(nativeRaw));
    const nativeToken = tokenRow({
      symbol: "ETH",
      name: "Ether",
      balance: nativeBalance,
      network,
      price: prices.ethereum,
      isNative: true,
      iconUrl: ETH_ICON_URL,
    });
    const fallbackUsdc = tokenRow({
      symbol: "USDC",
      name: "USD Coin",
      balance: tokenBalance,
      network,
      price: prices["usd-coin"],
      tokenAddress: evmUsdc(network),
      iconUrl: USDC_ICON_URL,
    });
    const hydratedIndexedTokens = await hydrateEvmIndexedTokenQuotes(indexedTokens, network);
    const indexedOrFallbackTokens = [
      ...hydratedIndexedTokens.filter((token) => !tokenAddressEquals(token, evmUsdc(network))),
      fallbackUsdc,
    ];
    const knownTokens = await fetchKnownEvmTokenBalances(address, network, indexedOrFallbackTokens);
    const tokens = mergeTokenRows([
      nativeToken,
      ...indexedOrFallbackTokens,
      ...knownTokens,
    ]);
    return {
      address,
      network,
      tokenSymbol: "USDC",
      tokenBalance,
      nativeBalance,
      totalValueUsd: totalTokenValueUsd(tokens),
      tokens,
      fetchedAt: Date.now(),
    };
  }

  const connection = new Connection(solanaRpc(network), "confirmed");
  const owner = new PublicKey(address);
  const [tokenAccounts, lamports, prices] = await Promise.all([
    fetchSolanaTokenAccountsByOwner(connection, owner),
    connection.getBalance(owner),
    fetchTokenPrices(["solana", "usd-coin"]),
  ]);
  const usdcMint = solanaUsdc(network).toBase58();
  const nativeBalance = lamports / LAMPORTS_PER_SOL;
  const tokenBalance = tokenAccounts.reduce((total, account) => {
    const info = account.account.data.parsed.info;
    return String(info.mint || "") === usdcMint ? total + Number(info.tokenAmount?.uiAmount ?? 0) : total;
  }, 0);
  const solanaTokenPrices = await fetchDexScreenerTokenPrices(
    uniqueStrings(tokenAccounts.map((account) => String(account.account.data.parsed.info.mint || ""))),
    "solana",
  );
  const splTokens = tokenAccounts.flatMap((account): AgentWalletTokenBalance[] => {
    const info = account.account.data.parsed.info;
    const mint = String(info.mint || "");
    const amount = Number(info.tokenAmount?.uiAmount ?? 0);
    if (!mint || amount <= 0) return [];
    const isUsdc = mint === solanaUsdc(network).toBase58();
    const tokenPrice = isUsdc ? prices["usd-coin"] : solanaTokenPrices[mint];
    return [tokenRow({
      symbol: isUsdc ? "USDC" : tokenPrice?.symbol || shortenAddress(mint),
      name: isUsdc ? "USD Coin" : tokenPrice?.name || mint,
      balance: amount,
      network,
      price: tokenPrice,
      tokenAddress: mint,
      iconUrl: isUsdc ? USDC_ICON_URL : tokenPrice?.imageUrl,
    })];
  });
  const tokens = mergeTokenRows([
    tokenRow({
      symbol: "SOL",
      name: "Solana",
      balance: nativeBalance,
      network,
      price: prices.solana,
      isNative: true,
      iconUrl: SOL_ICON_URL,
    }),
    ...splTokens,
    ...(splTokens.some((token) => token.tokenAddress === solanaUsdc(network).toBase58()) ? [] : [
      tokenRow({
        symbol: "USDC",
        name: "USD Coin",
        balance: tokenBalance,
        network,
        price: prices["usd-coin"],
        tokenAddress: solanaUsdc(network).toBase58(),
        iconUrl: USDC_ICON_URL,
      }),
    ]),
  ]);
  return {
    address,
    network,
    tokenSymbol: "USDC",
    tokenBalance,
    nativeBalance,
    totalValueUsd: totalTokenValueUsd(tokens),
    tokens,
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
    const publicClient = createPublicClient({ chain: evmChain(network), transport: evmReadTransport(network) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") throw new Error("USDC transfer reverted on-chain.");
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

/** Read an ERC-20 token's decimals on-chain (for tokens outside the curated map). */
export async function readErc20Decimals(networkInput: string, tokenAddress: string): Promise<number> {
  const network = assertNetwork(networkInput);
  if (!network.startsWith("eip155:")) throw new Error("ERC-20 decimals are EVM-only.");
  const client = createPublicClient({ chain: evmChain(network), transport: http(evmRpc(network)) });
  const decimals = await client.readContract({ address: tokenAddress as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" });
  return Number(decimals);
}

export type ZeroExSwapQuote = {
  transaction: { to: string; data: string; value?: string; gas?: string };
  permit2?: { eip712?: { types: unknown; domain: unknown; message: unknown; primaryType: string } } | null;
  issues?: { allowance?: { spender: string; actual?: string } | null } | null;
};

/**
 * Sign and submit a 0x v2 (Permit2) swap from a local EVM wallet. When 0x reports
 * an allowance issue, sets a one-time MAX ERC-20 approval to the Permit2 contract
 * (so future swaps of that token skip the approval tx entirely — Permit2 still
 * gates every actual transfer on the per-swap signature below). Then signs the
 * Permit2 EIP-712 message and appends [uint256 len][signature] to the swap
 * calldata as 0x v2 requires. Returns the on-chain tx hash(es).
 */
export async function executeEvmZeroExSwap(params: {
  network: string;
  secret: string;
  fromAddress: string;
  sellToken: string;
  quote: ZeroExSwapQuote;
}): Promise<{ approvalHash?: string; swapHash: string }> {
  const network = assertNetwork(params.network);
  if (!network.startsWith("eip155:")) throw new Error("0x swaps require an EVM (Base) wallet.");
  const account = evmAccountFromSecret(params.secret);
  if (account.address.toLowerCase() !== params.fromAddress.toLowerCase()) throw new Error("Stored key does not match wallet address.");
  const chain = evmChain(network);
  const transport = http(evmRpc(network));
  const wallet = createWalletClient({ account, chain, transport });
  const publicClient = createPublicClient({ chain, transport });

  // 1. One-time MAX ERC-20 approval to the Permit2 spender (only when 0x reports
  //    the current allowance is insufficient). Permit2 still requires the signed
  //    permit below for each transfer, so an unlimited approval here stays safe.
  let approvalHash: string | undefined;
  const allowanceIssue = params.quote.issues?.allowance;
  if (allowanceIssue?.spender) {
    approvalHash = await wallet.writeContract({
      address: params.sellToken as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [allowanceIssue.spender as `0x${string}`, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash as `0x${string}` });
  }

  // 2. Sign the Permit2 message (when present) and append it to the calldata.
  let data = params.quote.transaction.data as `0x${string}`;
  const eip712 = params.quote.permit2?.eip712;
  if (eip712) {
    const signature = await wallet.signTypedData({ account, ...(eip712 as object) } as unknown as Parameters<typeof wallet.signTypedData>[0]);
    data = concat([data, numberToHex(size(signature), { size: 32, signed: false }), signature]);
  }

  // 3. Submit the swap.
  const swapHash = await wallet.sendTransaction({
    to: params.quote.transaction.to as `0x${string}`,
    data,
    value: BigInt(params.quote.transaction.value || "0"),
    ...(params.quote.transaction.gas ? { gas: BigInt(params.quote.transaction.gas) } : {}),
  });
  await publicClient.waitForTransactionReceipt({ hash: swapHash });
  return { approvalHash, swapHash };
}

function evmAccountFromSecret(secret: string) {
  try {
    return privateKeyToAccount(normalizeEvmPrivateKey(secret));
  } catch {
    return mnemonicToAccount(secret.trim());
  }
}

function normalizeMnemonic(secret: string) {
  const mnemonic = secret.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(mnemonic, englishWordlist)) throw new Error("Recovery phrase is not a valid 12-word BIP39 phrase.");
  return mnemonic;
}

function solanaKeypairFromMnemonic(mnemonic: string, path: string) {
  const seed = mnemonicToSeedSync(mnemonic);
  const derivedSeed = deriveEd25519Seed(seed, path);
  return Keypair.fromSeed(derivedSeed);
}

function deriveEd25519Seed(seed: Uint8Array, path: string) {
  const segments = path.split("/");
  if (segments[0] !== "m") throw new Error(`Unsupported Solana derivation path: ${path}`);
  const master = hmacSha512(new TextEncoder().encode("ed25519 seed"), seed);
  let key = master.subarray(0, 32);
  let chainCode = master.subarray(32);
  for (const segment of segments.slice(1)) {
    if (!segment.endsWith("'")) throw new Error("Solana recovery phrase derivation requires hardened path segments.");
    const index = Number(segment.slice(0, -1));
    if (!Number.isSafeInteger(index) || index < 0) throw new Error(`Invalid Solana derivation path segment: ${segment}`);
    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, index + HARDENED_OFFSET);
    const digest = hmacSha512(chainCode, data);
    key = digest.subarray(0, 32);
    chainCode = digest.subarray(32);
  }
  return new Uint8Array(key);
}

function hmacSha512(key: Uint8Array, data: Uint8Array) {
  return new Uint8Array(createHmac("sha512", key as unknown as BinaryLike).update(data as unknown as BinaryLike).digest());
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

async function fetchEvmIndexedTokenBalances(address: string, network: SupportedWalletNetwork): Promise<AgentWalletTokenBalance[]> {
  if (network !== "eip155:8453") return [];
  const data = await fetchJsonWithTimeout<BlockscoutTokenBalance[] | { items?: BlockscoutTokenBalance[] }>(
    `https://base.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}/token-balances`,
    8000,
  );
  const rows = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return rows.flatMap((row): AgentWalletTokenBalance[] => {
    const token = row.token;
    if (!token || token.type !== "ERC-20") return [];
    if (isLikelySpamToken(token)) return [];
    const rawValue = row.value || "0";
    const decimals = Number(token.decimals ?? 18);
    const balance = formatRawTokenAmount(rawValue, decimals);
    if (balance <= 0) return [];
    const priceUsd = parseNullableNumber(token.exchange_rate);
    return [tokenRow({
      symbol: token.symbol || shortenAddress(token.address_hash || ""),
      name: token.name || token.symbol || token.address_hash || "Token",
      balance,
      network,
      price: priceUsd == null ? undefined : { usd: priceUsd, usd_24h_change: null },
      tokenAddress: token.address_hash,
      iconUrl: token.icon_url,
    })];
  });
}

function isLikelySpamToken(token: NonNullable<BlockscoutTokenBalance["token"]>) {
  const text = `${token.symbol ?? ""} ${token.name ?? ""}`.toLowerCase();
  if (!text.trim()) return false;
  const spamPatterns = [
    /\bvisit\s+to\s+claim\b/,
    /\bclaim\s+(?:on|at|now|your)\b/,
    /\bairdrop\b/,
    /\bt\.me\/\S+/,
    /\btelegram\b/,
    /\bdiscord\.gg\b/,
    /\bbit\.ly\b/,
    /\bswap-[a-z0-9.-]+/i,
    /\b(?:https?:\/\/|www\.)\S+/,
    /\.(?:com|org|net|xyz|io|app|top|site|click|lol|vip)\b/,
    /✅/,
  ];
  return spamPatterns.some((pattern) => pattern.test(text));
}

async function fetchKnownEvmTokenBalances(
  address: string,
  network: SupportedWalletNetwork,
  indexedTokens: AgentWalletTokenBalance[],
): Promise<AgentWalletTokenBalance[]> {
  const client = createPublicClient({ chain: evmChain(network), transport: evmReadTransport(network) });
  const indexedAddresses = new Set(indexedTokens.map((token) => token.tokenAddress?.toLowerCase()).filter(Boolean));
  const tokenAddresses = knownEvmTokenAddresses(network).filter((tokenAddress) => !indexedAddresses.has(tokenAddress.toLowerCase()));
  const prices = await fetchDexScreenerTokenPrices(tokenAddresses);
  const rows = await Promise.all(tokenAddresses.map(async (tokenAddress): Promise<AgentWalletTokenBalance | null> => {
    const contractAddress = tokenAddress as `0x${string}`;
    const readTokenState = () => Promise.all([
      client.readContract({ address: contractAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [address as `0x${string}`] }),
      client.readContract({ address: contractAddress, abi: ERC20_ABI, functionName: "decimals" }),
      client.readContract({ address: contractAddress, abi: ERC20_ABI, functionName: "symbol" }).catch(() => shortenAddress(tokenAddress)),
      client.readContract({ address: contractAddress, abi: ERC20_ABI, functionName: "name" }).catch(() => shortenAddress(tokenAddress)),
    ]);
    // Retry once before substituting zeros: public RPC rate limits surface
    // as transient read failures here, and a faked zero balance silently
    // drops a token the wallet actually holds (e.g. HIVE) from the list.
    const [balanceRaw, decimals, symbol, name] = await readTokenState().catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return readTokenState().catch(() => [0n, 18, shortenAddress(tokenAddress), shortenAddress(tokenAddress)] as const);
    });
    const balance = Number(formatUnits(balanceRaw, Number(decimals)));
    if (balance <= 0) return null;
    return tokenRow({
      symbol: String(symbol),
      name: String(name),
      balance,
      network,
      price: prices[tokenAddress.toLowerCase()],
      tokenAddress,
    });
  }));
  return rows.filter((row): row is AgentWalletTokenBalance => Boolean(row));
}

async function hydrateEvmIndexedTokenQuotes(tokens: AgentWalletTokenBalance[], network: SupportedWalletNetwork) {
  if (network !== "eip155:8453") return tokens;
  const quoteAddresses = uniqueStrings(tokens
    .map((token) => token.tokenAddress)
    .filter((address): address is string => typeof address === "string"))
    .filter((address, index, addresses) => {
      const token = tokens.find((candidate) => candidate.tokenAddress?.toLowerCase() === address.toLowerCase());
      const needsQuote = token?.valueUsd == null || token.priceUsd == null || !token.iconUrl;
      return Boolean(needsQuote) && index < MAX_DEXSCREENER_TOKEN_QUOTE_HYDRATIONS && addresses.indexOf(address) === index;
    });
  if (!quoteAddresses.length) return tokens;
  const prices = await fetchDexScreenerTokenPrices(quoteAddresses);
  return tokens.map((token) => {
    const tokenAddress = token.tokenAddress?.toLowerCase();
    const price = tokenAddress ? prices[tokenAddress] : undefined;
    if (!price) return token;
    const priceUsd = typeof price.usd === "number" ? price.usd : token.priceUsd;
    return {
      ...token,
      priceUsd,
      valueUsd: typeof priceUsd === "number" ? Math.round(token.balance * priceUsd * 100) / 100 : token.valueUsd,
      priceChange24hPct: typeof price.usd_24h_change === "number" ? price.usd_24h_change : token.priceChange24hPct,
      iconUrl: token.iconUrl ?? price.imageUrl,
    };
  });
}

async function fetchTokenPrices(ids: string[]): Promise<Record<string, TokenPrice | undefined>> {
  const query = ids.map(encodeURIComponent).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${query}&vs_currencies=usd&include_24hr_change=true`;
  const data = await fetchJsonWithTimeout<Record<string, TokenPrice>>(url, 6000);
  return data ?? {};
}

async function fetchDexScreenerTokenPrices(addresses: string[], chainId: "base" | "solana" = "base"): Promise<Record<string, TokenPrice | undefined>> {
  const normalizedAddresses = uniqueStrings(addresses.map((address) => normalizeDexScreenerAddress(address, chainId)));
  const pairs = (await Promise.all(chunkArray(normalizedAddresses, 30).map(async (chunk) => (
    await fetchJsonWithTimeout<DexScreenerPair[]>(
      `https://api.dexscreener.com/tokens/v1/${chainId}/${chunk.map(encodeURIComponent).join(",")}`,
      6000,
    ) ?? []
  )))).flat();
  const unresolved = normalizedAddresses.filter((address) => !selectDexScreenerPairForAddress(pairs, address, chainId));
  const fallbackPairs = (await Promise.all(unresolved.map(async (address) => (
    await fetchJsonWithTimeout<DexScreenerPair[]>(
      `https://api.dexscreener.com/token-pairs/v1/${chainId}/${encodeURIComponent(address)}`,
      5000,
    ) ?? []
  )))).flat();
  const allPairs = [...pairs, ...fallbackPairs];
  const entries = normalizedAddresses.map((address): readonly [string, TokenPrice] | null => {
    const pair = selectDexScreenerPairForAddress(allPairs, address, chainId);
    const priceUsd = parseNullableNumber(pair?.priceUsd);
    const imageUrl = pair?.info?.imageUrl ?? null;
    if (priceUsd == null && !imageUrl) return null;
    const matchedToken = normalizeDexScreenerAddress(pair?.baseToken?.address ?? "", chainId) === address ? pair?.baseToken : pair?.quoteToken;
    return [address, {
      usd: priceUsd,
      usd_24h_change: parseNullableNumber(pair?.priceChange?.h24),
      imageUrl,
      name: matchedToken?.name ?? null,
      symbol: matchedToken?.symbol ?? null,
    }] as const;
  });
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, TokenPrice] => entry !== null));
}

function selectDexScreenerPairForAddress(pairs: DexScreenerPair[], address: string, chainId: "base" | "solana") {
  const normalizedAddress = normalizeDexScreenerAddress(address, chainId);
  const exactPairs = pairs.filter((candidate) => (
    candidate.chainId === chainId
    && (
      normalizeDexScreenerAddress(candidate.baseToken?.address ?? "", chainId) === normalizedAddress
      || normalizeDexScreenerAddress(candidate.quoteToken?.address ?? "", chainId) === normalizedAddress
    )
  ));
  return exactPairs.find((pair) => pair.info?.imageUrl)
    ?? exactPairs.find((pair) => parseNullableNumber(pair.priceUsd) != null)
    ?? exactPairs[0];
}

function normalizeDexScreenerAddress(address: string, chainId: "base" | "solana") {
  const trimmed = address.trim();
  return chainId === "base" ? trimmed.toLowerCase() : trimmed;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).catch(() => null);
    if (!response?.ok) return null;
    return await response.json().catch(() => null) as T | null;
  } finally {
    clearTimeout(timeout);
  }
}

function tokenRow(input: {
  symbol: string;
  name: string;
  balance: number;
  network: string;
  price?: TokenPrice;
  isNative?: boolean;
  tokenAddress?: string;
  iconUrl?: string | null;
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
    tokenAddress: input.tokenAddress,
    iconUrl: input.iconUrl ?? input.price?.imageUrl,
  };
}

function mergeTokenRows(tokens: AgentWalletTokenBalance[]) {
  const byToken = new Map<string, AgentWalletTokenBalance>();
  for (const token of tokens) {
    const key = token.isNative ? `${token.network}:native` : `${token.network}:${(token.tokenAddress || token.symbol).toLowerCase()}`;
    const existing = byToken.get(key);
    if (!existing) {
      byToken.set(key, token);
      continue;
    }
    byToken.set(key, {
      ...existing,
      balance: existing.balance + token.balance,
      valueUsd: existing.valueUsd == null || token.valueUsd == null ? existing.valueUsd ?? token.valueUsd ?? null : existing.valueUsd + token.valueUsd,
    });
  }
  return [...byToken.values()]
    .filter((token) => token.balance > 0 || token.isNative)
    .sort((left, right) => {
      const valueDelta = (right.valueUsd ?? -1) - (left.valueUsd ?? -1);
      if (valueDelta !== 0) return valueDelta;
      if (left.isNative !== right.isNative) return left.isNative ? -1 : 1;
      return left.symbol.localeCompare(right.symbol);
    });
}

function tokenAddressEquals(token: AgentWalletTokenBalance, address: string) {
  return token.tokenAddress?.toLowerCase() === address.toLowerCase();
}

function totalTokenValueUsd(tokens: AgentWalletTokenBalance[]) {
  const quoted = tokens
    .map((token) => token.valueUsd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!quoted.length) return null;
  return Math.round(quoted.reduce((total, value) => total + value, 0) * 100) / 100;
}

function parseNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRawTokenAmount(rawValue: string, decimals: number) {
  try {
    return Number(formatUnits(BigInt(rawValue), Number.isFinite(decimals) ? decimals : 18));
  } catch {
    return 0;
  }
}

function shortenAddress(address: string) {
  if (!address) return "Token";
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function uniqueEvmAddresses(values: Array<string | null | undefined>) {
  const byAddress = new Map<string, string>();
  for (const value of values) {
    const address = value?.trim();
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
    const key = address.toLowerCase();
    if (!byAddress.has(key)) byAddress.set(key, address);
  }
  return [...byAddress.values()];
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}
