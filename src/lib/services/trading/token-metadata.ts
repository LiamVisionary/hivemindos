import "server-only";

import { getMint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { optionalEnv } from "@/lib/config/env";
import { ROBINHOOD_CHAIN } from "@/lib/config/robinhood-chain";
import { readErc20Decimals } from "@/lib/services/wallet/chain-wallet";
import type { TradeTokenMetadata } from "@/lib/types/trading-token";

type IndexedToken = {
  address_hash?: string;
  decimals?: string;
  icon_url?: string | null;
  name?: string;
  symbol?: string;
  type?: string;
};

type DexScreenerPair = {
  chainId?: string;
  liquidity?: { usd?: number };
  baseToken?: { address?: string; name?: string; symbol?: string };
  info?: { imageUrl?: string };
};

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const TOKEN_DISCOVERY_NETWORKS = {
  "eip155:8453": { kind: "evm", label: "Base", blockscout: "https://base.blockscout.com", dexScreener: "base" },
  "eip155:4663": { kind: "evm", label: "Robinhood Chain", blockscout: ROBINHOOD_CHAIN.explorerUrl, dexScreener: null },
  "solana:mainnet": { kind: "solana", label: "Solana", blockscout: null, dexScreener: "solana" },
} as const;

export async function resolveTradeTokenMetadata(networkInput: string, addressInput: string): Promise<TradeTokenMetadata> {
  const network = networkInput.trim() as keyof typeof TOKEN_DISCOVERY_NETWORKS;
  const address = addressInput.trim();
  const capability = TOKEN_DISCOVERY_NETWORKS[network];
  if (!capability) throw new Error("Token-address discovery supports Base, Robinhood Chain, and Solana mainnet.");

  if (network === "eip155:8453" || network === "eip155:4663") {
    if (!EVM_ADDRESS_RE.test(address)) throw new Error(`Enter a complete 0x token address on ${capability.label}.`);
    return resolveEvmMetadata(network, address, TOKEN_DISCOVERY_NETWORKS[network]);
  }
  if (!SOLANA_MINT_RE.test(address)) throw new Error("Enter a complete Solana token mint address.");
  return resolveSolanaMetadata(network, address, TOKEN_DISCOVERY_NETWORKS[network]);
}

async function resolveEvmMetadata(
  network: "eip155:8453" | "eip155:4663",
  address: string,
  capability: (typeof TOKEN_DISCOVERY_NETWORKS)["eip155:8453" | "eip155:4663"],
): Promise<TradeTokenMetadata> {
  const [decimals, indexed, market] = await Promise.all([
    readErc20Decimals(network, address).catch(() => null),
    fetchJson<IndexedToken>(`${capability.blockscout}/api/v2/tokens/${encodeURIComponent(address)}`),
    capability.dexScreener ? fetchDexScreenerToken(capability.dexScreener, address) : Promise.resolve(null),
  ]);
  if (decimals == null) throw new Error(`No ERC-20 token was found at this address on ${capability.label}.`);

  const symbol = cleanLabel(indexed?.symbol) || cleanLabel(market?.symbol) || shortAddress(address);
  const name = cleanLabel(indexed?.name) || cleanLabel(market?.name) || symbol;
  return {
    network,
    address,
    symbol,
    name,
    iconUrl: safeImageUrl(indexed?.icon_url) || market?.iconUrl || null,
  };
}

async function resolveSolanaMetadata(
  network: "solana:mainnet",
  address: string,
  capability: (typeof TOKEN_DISCOVERY_NETWORKS)["solana:mainnet"],
): Promise<TradeTokenMetadata> {
  const connection = new Connection(optionalEnv("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com", "confirmed");
  const [mint, market] = await Promise.all([
    getMint(connection, new PublicKey(address)).catch(() => null),
    fetchDexScreenerToken(capability.dexScreener, address),
  ]);
  if (!mint) throw new Error("No SPL token mint was found at this address on Solana.");
  const symbol = cleanLabel(market?.symbol) || shortAddress(address);
  const name = cleanLabel(market?.name) || symbol;
  return { network, address, symbol, name, iconUrl: market?.iconUrl || null };
}

async function fetchDexScreenerToken(chainId: "base" | "solana", address: string) {
  const pairs = await fetchJson<DexScreenerPair[]>(
    `https://api.dexscreener.com/token-pairs/v1/${chainId}/${encodeURIComponent(address)}`,
  );
  if (!Array.isArray(pairs)) return null;
  const normalizedAddress = chainId === "base" ? address.toLowerCase() : address;
  const matches = pairs
    .filter((pair) => {
      const candidate = pair.baseToken?.address?.trim() || "";
      return (chainId === "base" ? candidate.toLowerCase() : candidate) === normalizedAddress;
    })
    .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
  const pair = matches.find((candidate) => safeImageUrl(candidate.info?.imageUrl)) ?? matches[0];
  if (!pair) return null;
  return {
    symbol: cleanLabel(pair.baseToken?.symbol),
    name: cleanLabel(pair.baseToken?.name),
    iconUrl: safeImageUrl(pair.info?.imageUrl),
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null) as Promise<T | null>;
}

function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
