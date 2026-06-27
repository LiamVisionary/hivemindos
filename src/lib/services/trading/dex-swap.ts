import "server-only";

import net from "node:net";
import { formatUnits, parseUnits } from "viem";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { base58 } from "@scure/base";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { executeEvmZeroExSwap, readErc20Decimals, type ZeroExSwapQuote } from "@/lib/services/wallet/chain-wallet";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";
import { evaluateSpend, resolveSpendGovernance, shouldEvaluateSpend } from "@/lib/services/wallet/spend-governance";
import {
  assertTradingPlatformFeeReady,
  collectTradingPlatformFee,
  platformFeeDetail,
  platformFeeReceiptDetail,
  quoteTradingPlatformFee,
  type PlatformFeeCollection,
  type PlatformFeeQuote,
} from "@/lib/services/wallet/platform-fees";

/**
 * Local DEX swap rail: trade FROM the user's own (imported/local) wallet by
 * signing locally. Base (EVM) routes through the 0x v2 (Permit2) aggregator;
 * Solana routes through Jupiter. The aggregator's API only quotes — the selected
 * wallet signs + pays. Every swap is hard-capped at MAX_SWAP_USD on the sell
 * side, passes the shared spend-governance chokepoint, and needs CONFIRM_SWAP.
 */

// This network's Node fetch needs a wider happy-eyeballs window or 0x/Base RPC
// connects time out (undici autoSelectFamily 250ms default < the TCP handshake).
(net as unknown as { setDefaultAutoSelectFamilyAttemptTimeout?: (ms: number) => void })
  .setDefaultAutoSelectFamilyAttemptTimeout?.(3000);

export const SWAP_CONFIRMATION = "CONFIRM_SWAP";
export const MAX_SWAP_USD = 10;

const ZEROX_BASE = process.env.ZEROX_API_BASE || "https://api.0x.org";
const JUPITER_BASE = process.env.JUPITER_API_BASE || "https://lite-api.jup.ag";
const BASE_CHAIN_ID = 8453;
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const DEFAULT_SLIPPAGE_BPS = 100; // 1%

type BaseToken = { address: string; decimals: number; symbol: string; stable?: boolean };
const BASE_TOKENS: Record<string, BaseToken> = {
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, symbol: "USDC", stable: true },
  USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, symbol: "USDT", stable: true },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
  ETH: { address: NATIVE_ETH, decimals: 18, symbol: "ETH" },
  HIVE: { address: "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3", decimals: 18, symbol: "HIVE" },
};

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
type SolToken = { mint: string; decimals: number; symbol: string; stable?: boolean };
const SOL_TOKENS: Record<string, SolToken> = {
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9, symbol: "SOL" },
  USDC: { mint: SOLANA_USDC_MINT, decimals: 6, symbol: "USDC", stable: true },
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, symbol: "USDT", stable: true },
};

export const SWAP_TOKENS_BASE = Object.keys(BASE_TOKENS);
export const SWAP_TOKENS_SOLANA = Object.keys(SOL_TOKENS);

export type DexSwapInput = {
  agentId: string;
  network: string;
  fromAddress: string;
  secret?: string;
  sellToken: string;
  buyToken: string;
  amountHuman: number;
  slippageBps?: number;
  confirmation?: string;
  approvalToken?: string;
};

export type DexSwapQuote = {
  sell: string;
  buy: string;
  sellAmount: number;
  buyAmount: number;
  valueUsd: number;
  platformFee?: PlatformFeeQuote;
  detail: string;
};

export type DexSwapResult = {
  ok: true;
  network: string;
  sell: string;
  buy: string;
  sellAmount: number;
  buyAmount: number;
  valueUsd: number;
  reference: string;
  approvalReference?: string;
  platformFee?: PlatformFeeCollection;
  detail: string;
};

function isSolanaNetwork(network: string) {
  return network.startsWith("solana");
}

function solanaRpc() {
  return process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

function slippageFor(input: DexSwapInput) {
  return input.slippageBps && input.slippageBps > 0 ? input.slippageBps : DEFAULT_SLIPPAGE_BPS;
}

/** Governance chokepoint shared by both chains (kill switch, budgets, approval). */
async function swapGovernance(agentId: string, valueUsd: number, target: string, approvalToken?: string): Promise<{ companyId?: string }> {
  const governance = await resolveSpendGovernance(agentId);
  if (governance && (await shouldEvaluateSpend(governance.wallet, MAX_SWAP_USD))) {
    const decision = await evaluateSpend({
      wallet: governance.wallet,
      agentName: governance.agentName,
      kind: "trade",
      asset: "USDC",
      amountUsd: valueUsd,
      target,
      approvalToken,
    });
    if (decision.decision !== "allow") throw new Error(decision.reason);
    return { companyId: decision.companyId };
  }
  return {};
}

async function recordSwap(input: DexSwapInput, companyId: string | undefined, valueUsd: number, label: string) {
  await appendSpend({
    agentId: input.agentId,
    companyId,
    kind: "trade",
    asset: "USDC",
    amountUsd: valueUsd,
    target: shortTarget(label),
    status: "executed",
  }).catch(() => {});
}

// ---- Base (0x v2 / Permit2) ------------------------------------------------

async function resolveBaseToken(input: string): Promise<BaseToken> {
  const raw = input.trim();
  const known = BASE_TOKENS[raw.toUpperCase()];
  if (known) return known;
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    const byAddress = Object.values(BASE_TOKENS).find((token) => token.address.toLowerCase() === raw.toLowerCase());
    if (byAddress) return byAddress;
    const decimals = await readErc20Decimals("eip155:8453", raw);
    return { address: raw, decimals, symbol: `${raw.slice(0, 6)}…${raw.slice(-4)}` };
  }
  throw new Error(`Unknown token "${input}". Use ${SWAP_TOKENS_BASE.join(", ")}, or a 0x token address.`);
}

async function zeroExFetch(path: string): Promise<Record<string, unknown>> {
  const key = await hiveEnvValue("ZEROX_API_KEY");
  if (!key) throw new Error("Base swaps need ZEROX_API_KEY. Add it with `hive-env-add ZEROX_API_KEY`.");
  const response = await fetch(`${ZEROX_BASE}${path}`, {
    headers: { "0x-api-key": key, "0x-version": "v2" },
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) throw new Error(`0x API error (HTTP ${response.status}): ${(data as { reason?: string })?.reason || "request failed"}.`);
  return data;
}

async function baseSellUsd(sell: BaseToken, sellAtomic: bigint): Promise<number> {
  if (sell.stable) return Number(formatUnits(sellAtomic, sell.decimals));
  const usdc = BASE_TOKENS.USDC;
  const price = await zeroExFetch(`/swap/permit2/price?chainId=${BASE_CHAIN_ID}&sellToken=${sell.address}&buyToken=${usdc.address}&sellAmount=${sellAtomic.toString()}`);
  return Number((price as { buyAmount?: string }).buyAmount || "0") / 10 ** usdc.decimals;
}

async function prepareBaseLeg(input: DexSwapInput) {
  const sell = await resolveBaseToken(input.sellToken);
  const buy = await resolveBaseToken(input.buyToken);
  if (sell.address.toLowerCase() === buy.address.toLowerCase()) throw new Error("Pick two different tokens.");
  if (!(input.amountHuman > 0)) throw new Error("Enter an amount greater than zero.");
  const sellAtomic = parseUnits(input.amountHuman.toFixed(sell.decimals), sell.decimals);
  const valueUsd = await baseSellUsd(sell, sellAtomic);
  if (valueUsd > MAX_SWAP_USD + 0.01) throw new Error(`This swap is ~$${valueUsd.toFixed(2)} — over the $${MAX_SWAP_USD} cap for this wallet.`);
  return { sell, buy, sellAtomic, valueUsd, slippageBps: slippageFor(input) };
}

async function quoteBaseSwap(input: DexSwapInput): Promise<DexSwapQuote> {
  const { sell, buy, sellAtomic, valueUsd, slippageBps } = await prepareBaseLeg(input);
  const price = await zeroExFetch(`/swap/permit2/price?chainId=${BASE_CHAIN_ID}&sellToken=${sell.address}&buyToken=${buy.address}&sellAmount=${sellAtomic.toString()}&slippageBps=${slippageBps}`);
  if (!(price as { liquidityAvailable?: boolean }).liquidityAvailable) throw new Error("No route/liquidity for this pair right now.");
  const buyAmount = Number((price as { buyAmount?: string }).buyAmount || "0") / 10 ** buy.decimals;
  const platformFee = await quoteTradingPlatformFee({ source: "dex-swap", network: input.network, amountUsd: valueUsd });
  return {
    sell: sell.symbol,
    buy: buy.symbol,
    sellAmount: input.amountHuman,
    buyAmount,
    valueUsd,
    platformFee,
    detail: `Swap ${input.amountHuman} ${sell.symbol} → ~${buyAmount.toPrecision(6)} ${buy.symbol} on Base via 0x (≤${(slippageBps / 100).toFixed(2)}% slippage).${platformFeeDetail(platformFee)}`,
  };
}

async function executeBaseSwap(input: DexSwapInput): Promise<DexSwapResult> {
  if (input.confirmation !== SWAP_CONFIRMATION) throw new Error(`Swaps need confirmation. Type ${SWAP_CONFIRMATION} to approve up to $${MAX_SWAP_USD}.`);
  if (!input.secret) throw new Error("No local wallet key is available to sign the swap.");
  const { sell, buy, sellAtomic, valueUsd, slippageBps } = await prepareBaseLeg(input);
  const label = `dex:${sell.symbol}->${buy.symbol}`;
  const { companyId } = await swapGovernance(input.agentId, valueUsd, label, input.approvalToken);
  await assertTradingPlatformFeeReady({ source: "dex-swap", network: input.network, amountUsd: valueUsd });

  const quote = await zeroExFetch(`/swap/permit2/quote?chainId=${BASE_CHAIN_ID}&sellToken=${sell.address}&buyToken=${buy.address}&sellAmount=${sellAtomic.toString()}&slippageBps=${slippageBps}&taker=${input.fromAddress}`);
  if (!(quote as { liquidityAvailable?: boolean }).liquidityAvailable || !(quote as { transaction?: unknown }).transaction) {
    throw new Error("No executable route for this swap right now.");
  }

  const { approvalHash, swapHash } = await executeEvmZeroExSwap({
    network: input.network,
    secret: input.secret,
    fromAddress: input.fromAddress,
    sellToken: sell.address,
    quote: quote as unknown as ZeroExSwapQuote,
  });

  const buyAmount = Number((quote as { buyAmount?: string }).buyAmount || "0") / 10 ** buy.decimals;
  const platformFee = await collectTradingPlatformFee({
    agentId: input.agentId,
    network: input.network,
    secret: input.secret,
    fromAddress: input.fromAddress,
    amountUsd: valueUsd,
    source: "dex-swap",
    companyId,
  });
  await recordSwap(input, companyId, valueUsd, label);
  return {
    ok: true,
    network: input.network,
    sell: sell.symbol,
    buy: buy.symbol,
    sellAmount: input.amountHuman,
    buyAmount,
    valueUsd,
    reference: swapHash,
    approvalReference: approvalHash,
    platformFee,
    detail: `Swapped ${input.amountHuman} ${sell.symbol} → ~${buyAmount.toPrecision(6)} ${buy.symbol}. Tx ${swapHash}.${platformFeeReceiptDetail(platformFee)}`,
  };
}

// ---- Solana (Jupiter) ------------------------------------------------------

async function resolveSolanaToken(input: string): Promise<SolToken> {
  const raw = input.trim();
  const known = SOL_TOKENS[raw.toUpperCase()];
  if (known) return known;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) {
    const byMint = Object.values(SOL_TOKENS).find((token) => token.mint === raw);
    if (byMint) return byMint;
    const mint = await getMint(new Connection(solanaRpc(), "confirmed"), new PublicKey(raw));
    return { mint: raw, decimals: mint.decimals, symbol: `${raw.slice(0, 4)}…${raw.slice(-4)}` };
  }
  throw new Error(`Unknown token "${input}". Use ${SWAP_TOKENS_SOLANA.join(", ")}, or a Solana mint address.`);
}

type JupiterQuote = { outAmount?: string; priceImpactPct?: string; [k: string]: unknown };

async function jupiterQuote(inputMint: string, outputMint: string, amountAtomic: string, slippageBps: number): Promise<JupiterQuote> {
  const url = `${JUPITER_BASE}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountAtomic}&slippageBps=${slippageBps}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Jupiter quote failed (HTTP ${response.status}).`);
  const quote = (await response.json()) as JupiterQuote;
  if (!quote?.outAmount) throw new Error("Jupiter returned no route for this swap (insufficient liquidity?).");
  return quote;
}

async function solanaSellUsd(sell: SolToken, sellAtomic: bigint): Promise<number> {
  if (sell.stable) return Number(formatUnits(sellAtomic, sell.decimals));
  const quote = await jupiterQuote(sell.mint, SOLANA_USDC_MINT, sellAtomic.toString(), DEFAULT_SLIPPAGE_BPS);
  return Number(quote.outAmount || "0") / 1e6;
}

async function prepareSolanaLeg(input: DexSwapInput) {
  const sell = await resolveSolanaToken(input.sellToken);
  const buy = await resolveSolanaToken(input.buyToken);
  if (sell.mint === buy.mint) throw new Error("Pick two different tokens.");
  if (!(input.amountHuman > 0)) throw new Error("Enter an amount greater than zero.");
  const sellAtomic = parseUnits(input.amountHuman.toFixed(sell.decimals), sell.decimals);
  const valueUsd = await solanaSellUsd(sell, sellAtomic);
  if (valueUsd > MAX_SWAP_USD + 0.01) throw new Error(`This swap is ~$${valueUsd.toFixed(2)} — over the $${MAX_SWAP_USD} cap for this wallet.`);
  return { sell, buy, sellAtomic, valueUsd, slippageBps: slippageFor(input) };
}

async function quoteSolanaSwap(input: DexSwapInput): Promise<DexSwapQuote> {
  const { sell, buy, sellAtomic, valueUsd, slippageBps } = await prepareSolanaLeg(input);
  const quote = await jupiterQuote(sell.mint, buy.mint, sellAtomic.toString(), slippageBps);
  const buyAmount = Number(quote.outAmount || "0") / 10 ** buy.decimals;
  const platformFee = await quoteTradingPlatformFee({ source: "dex-swap", network: input.network, amountUsd: valueUsd });
  return {
    sell: sell.symbol,
    buy: buy.symbol,
    sellAmount: input.amountHuman,
    buyAmount,
    valueUsd,
    platformFee,
    detail: `Swap ${input.amountHuman} ${sell.symbol} → ~${buyAmount.toPrecision(6)} ${buy.symbol} on Solana via Jupiter (≤${(slippageBps / 100).toFixed(2)}% slippage).${platformFeeDetail(platformFee)}`,
  };
}

async function executeSolanaSwap(input: DexSwapInput): Promise<DexSwapResult> {
  if (input.confirmation !== SWAP_CONFIRMATION) throw new Error(`Swaps need confirmation. Type ${SWAP_CONFIRMATION} to approve up to $${MAX_SWAP_USD}.`);
  if (!input.secret) throw new Error("No local Solana wallet key is available to sign the swap.");
  const { sell, buy, sellAtomic, valueUsd, slippageBps } = await prepareSolanaLeg(input);
  const label = `dex:${sell.symbol}->${buy.symbol}`;
  const { companyId } = await swapGovernance(input.agentId, valueUsd, label, input.approvalToken);
  await assertTradingPlatformFeeReady({ source: "dex-swap", network: input.network, amountUsd: valueUsd });

  const quote = await jupiterQuote(sell.mint, buy.mint, sellAtomic.toString(), slippageBps);
  const keypair = Keypair.fromSecretKey(base58.decode(input.secret));
  if (keypair.publicKey.toBase58() !== input.fromAddress) throw new Error("Stored key does not match wallet address.");

  const swapResponse = await fetch(`${JUPITER_BASE}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: keypair.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      // Use the quote's fixed slippageBps (1%) as the binding min-out — dynamic
      // slippage recomputes a tighter bound that fails simulation on deep pairs.
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "high" } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const swapJson = (await swapResponse.json().catch(() => null)) as { swapTransaction?: string; error?: string } | null;
  if (!swapResponse.ok || !swapJson?.swapTransaction) {
    throw new Error(`Jupiter swap build failed (HTTP ${swapResponse.status}): ${swapJson?.error || "no transaction returned"}.`);
  }

  const tx = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(swapJson.swapTransaction, "base64")));
  tx.sign([keypair]);
  const connection = new Connection(solanaRpc(), "confirmed");
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");

  const buyAmount = Number(quote.outAmount || "0") / 10 ** buy.decimals;
  const platformFee = await collectTradingPlatformFee({
    agentId: input.agentId,
    network: input.network,
    secret: input.secret,
    fromAddress: input.fromAddress,
    amountUsd: valueUsd,
    source: "dex-swap",
    companyId,
  });
  await recordSwap(input, companyId, valueUsd, label);
  return {
    ok: true,
    network: input.network,
    sell: sell.symbol,
    buy: buy.symbol,
    sellAmount: input.amountHuman,
    buyAmount,
    valueUsd,
    reference: signature,
    platformFee,
    detail: `Swapped ${input.amountHuman} ${sell.symbol} → ~${buyAmount.toPrecision(6)} ${buy.symbol}. Tx ${signature}.${platformFeeReceiptDetail(platformFee)}`,
  };
}

// ---- Dispatch by network ----------------------------------------------------

export async function quoteDexSwap(input: DexSwapInput): Promise<DexSwapQuote> {
  return isSolanaNetwork(input.network) ? quoteSolanaSwap(input) : quoteBaseSwap(input);
}

export async function executeDexSwap(input: DexSwapInput): Promise<DexSwapResult> {
  return isSolanaNetwork(input.network) ? executeSolanaSwap(input) : executeBaseSwap(input);
}
