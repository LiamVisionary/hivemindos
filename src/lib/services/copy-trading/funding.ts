import "server-only";

/* Funding-asset selection for copied BUYS. The engine mirrors the target's
   position (it always buys the same token), but it may fund that buy from
   whichever asset the acting wallet actually holds — stablecoins first, then the
   chain's native gas asset (ETH on Base, SOL on Solana). This keeps a live copy
   run working whether the wallet is USDC-funded or ETH/SOL-funded, instead of
   hard-failing on a missing USDC balance. Selection is pure so it can be
   unit-tested; the caller supplies balances + the native price. */

import type { CopyTradeNetwork, CopyTradeFundable, CopyTradeFundableAsset } from "@/lib/types/copy-trading";
import type { AgentWalletBalance } from "@/lib/types/agent-wallet";

export type FundingAsset = { symbol: string; availableUsd: number; isStable: boolean; priceUsd: number | null };
export type BuyFunding = { sellToken: string; amountHuman: number; estValueUsd: number };

type FundingStableSymbol = "USDC" | "USDT";

// Funding is executed by canonical symbol in dex-swap, so a same-symbol token at
// any other address must never be counted as spendable canonical USDC/USDT.
const FUNDING_STABLE_ADDRESSES: Record<CopyTradeNetwork, Readonly<Partial<Record<FundingStableSymbol, string>>>> = {
  "eip155:8453": {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  },
  "solana:mainnet": {
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
};

// Stable-first, then native. These symbols are what executeDexSwap resolves.
const FUNDING_PRIORITY: Record<CopyTradeNetwork, string[]> = {
  "eip155:8453": ["USDC", "USDT", "ETH"],
  "solana:mainnet": ["USDC", "USDT", "SOL"],
};

// Leave enough native behind to pay gas when we fund a buy FROM the native asset
// (and, for a USDC-funded buy, the wallet still needs a little native for gas —
// surfaced separately in the fundable summary so the user can see it).
const NATIVE_GAS_RESERVE_USD: Record<CopyTradeNetwork, number> = {
  "eip155:8453": 0.5,
  "solana:mainnet": 0.05,
};

export function copyTradeNativeSymbol(network: CopyTradeNetwork): "ETH" | "SOL" {
  return network === "solana:mainnet" ? "SOL" : "ETH";
}

export function fundingPriority(network: CopyTradeNetwork): string[] {
  return FUNDING_PRIORITY[network] ?? ["USDC"];
}

function canonicalFundingStableSymbol(
  network: CopyTradeNetwork,
  token: NonNullable<AgentWalletBalance["tokens"]>[number],
): FundingStableSymbol | null {
  const symbol = token.symbol.toUpperCase();
  if (symbol !== "USDC" && symbol !== "USDT") return null;
  const expectedAddress = FUNDING_STABLE_ADDRESSES[network][symbol];
  const actualAddress = token.tokenAddress?.trim();
  if (!expectedAddress || !actualAddress) return null;
  const matches = network === "eip155:8453"
    ? actualAddress.toLowerCase() === expectedAddress.toLowerCase()
    : actualAddress === expectedAddress;
  return matches ? symbol : null;
}

/** Pick the asset to spend for a copied buy of `usd`, sized down to what's held. */
export function selectBuyFunding(network: CopyTradeNetwork, usd: number, funds: FundingAsset[]): BuyFunding | null {
  if (!(usd > 0)) return null;
  const bySymbol = new Map(funds.map((f) => [f.symbol.toUpperCase(), f]));
  const ordered = fundingPriority(network)
    .map((sym) => bySymbol.get(sym))
    .filter((f): f is FundingAsset => Boolean(f) && (f as FundingAsset).availableUsd > 0);
  if (ordered.length === 0) return null;
  // First asset that fully covers the buy; otherwise the deepest one, sized down.
  const covering = ordered.find((f) => f.availableUsd >= usd - 0.005);
  const chosen = covering ?? [...ordered].sort((a, b) => b.availableUsd - a.availableUsd)[0]!;
  const spendUsd = Math.min(usd, chosen.availableUsd);
  const amountHuman = assetAmountForUsd(chosen, spendUsd);
  if (amountHuman == null || !(amountHuman > 0)) return null;
  return { sellToken: chosen.symbol, amountHuman, estValueUsd: spendUsd };
}

function assetAmountForUsd(asset: FundingAsset, usd: number): number | null {
  if (asset.isStable) return usd; // ~1:1 USD
  if (asset.priceUsd && asset.priceUsd > 0) return usd / asset.priceUsd;
  return null; // can't size a native leg without a price
}

/** Spendable funding assets from a wallet balance (native gas reserve applied). */
export function fundingAssetsFromBalance(
  network: CopyTradeNetwork,
  balance: Pick<AgentWalletBalance, "nativeBalance" | "tokens">,
  nativePriceUsd: number | null,
): FundingAsset[] {
  const funds: FundingAsset[] = [];
  const nativeAmount = balance.nativeBalance ?? 0;
  if (nativeAmount > 0 && nativePriceUsd && nativePriceUsd > 0) {
    const usd = nativeAmount * nativePriceUsd - (NATIVE_GAS_RESERVE_USD[network] ?? 0);
    if (usd > 0) funds.push({ symbol: copyTradeNativeSymbol(network), availableUsd: usd, isStable: false, priceUsd: nativePriceUsd });
  }
  for (const token of balance.tokens ?? []) {
    const symbol = canonicalFundingStableSymbol(network, token);
    if (!symbol) continue;
    const usd = token.valueUsd ?? token.balance ?? 0;
    if (usd > 0) funds.push({ symbol, availableUsd: usd, isStable: true, priceUsd: 1 });
  }
  return funds;
}

/** Display summary of spendable balance (raw amounts, no gas reserve) for the UI. */
export function fundableSummary(
  network: CopyTradeNetwork,
  balance: Pick<AgentWalletBalance, "nativeBalance" | "tokens">,
  nativePriceUsd: number | null,
): CopyTradeFundable {
  const assets: CopyTradeFundableAsset[] = [];
  const nativeAmount = balance.nativeBalance ?? 0;
  if (nativeAmount > 0) {
    assets.push({
      symbol: copyTradeNativeSymbol(network),
      amount: nativeAmount,
      usd: nativePriceUsd && nativePriceUsd > 0 ? nativeAmount * nativePriceUsd : 0,
    });
  }
  for (const token of balance.tokens ?? []) {
    const symbol = canonicalFundingStableSymbol(network, token);
    if (!symbol) continue;
    const amount = token.balance ?? 0;
    if (amount > 0) assets.push({ symbol, amount, usd: token.valueUsd ?? amount });
  }
  return { assets, totalUsd: assets.reduce((sum, a) => sum + (a.usd || 0), 0) };
}
