import type { PickableWallet } from "../trade/WalletSelectModal";

const CREDIT_PAYMENT_TOKEN_SYMBOLS = new Set(["USDC", "ETH", "HIVE", "USDT", "WETH"]);

export const MIN_CREDIT_PAYMENT_TOKEN_VALUE_USD = 1;

export type CreditPaymentTokenOption = {
  id: string;
  symbol: string;
  label: string;
  balance: number;
  valueUsd: number | null;
};

export function walletAddressForPickable(pickable: PickableWallet): string {
  const wallet = pickable.wallet as unknown as Record<string, unknown>;
  return String(wallet.walletAddress || wallet.vaultAddress || wallet.address || "").trim();
}

function nullableMoneyValue(value: unknown): number | null {
  const raw = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.replace(/[$,\s]/g, ""))
      : NaN;
  return Number.isFinite(raw) ? Math.max(0, raw) : null;
}

function walletUsdcBalanceUsdFromTokens(tokens: unknown, network = ""): number | null {
  if (!Array.isArray(tokens)) return null;
  for (const token of tokens) {
    if (!token || typeof token !== "object") continue;
    const row = token as Record<string, unknown>;
    if (String(row.symbol || "").trim().toUpperCase() !== "USDC") continue;
    const tokenNetwork = String(row.network || "").trim();
    if (tokenNetwork && network && tokenNetwork !== network) continue;
    return nullableMoneyValue(row.balance) ?? nullableMoneyValue(row.valueUsd);
  }
  return null;
}

function walletUsdcBalanceUsdFromRecord(record: unknown, network = ""): number | null {
  if (!record || typeof record !== "object") return null;
  return walletUsdcBalanceUsdFromTokens((record as Record<string, unknown>).tokens, network);
}

function walletRecordMatchesPickable(record: Record<string, unknown>, pickable: PickableWallet): boolean {
  const recordId = String(record.id || record.agentId || "").trim();
  if (recordId && recordId === pickable.id) return true;
  const recordAddress = String(record.address || record.walletAddress || record.vaultAddress || "").trim().toLowerCase();
  const recordNetwork = String(record.network || "").trim();
  const pickableAddress = walletAddressForPickable(pickable).toLowerCase();
  const pickableNetwork = pickable.wallet.network;
  return Boolean(recordAddress && pickableAddress && recordAddress === pickableAddress && recordNetwork === pickableNetwork);
}

function walletRecordForPickable(pickable: PickableWallet | null, walletRecords: Array<Record<string, unknown>>): Record<string, unknown> | null {
  if (!pickable) return null;
  return walletRecords.find((candidate) => walletRecordMatchesPickable(candidate, pickable)) ?? null;
}

export function walletUsdcBalanceUsdForPickable(pickable: PickableWallet | null, walletRecords: Array<Record<string, unknown>>): number | null {
  if (!pickable) return null;
  const direct = walletUsdcBalanceUsdFromRecord(pickable.wallet, pickable.wallet.network);
  if (direct !== null) return direct;
  return walletUsdcBalanceUsdFromRecord(walletRecordForPickable(pickable, walletRecords), pickable.wallet.network);
}

export function creditPaymentTokenOptionsForPickable(pickable: PickableWallet | null, walletRecords: Array<Record<string, unknown>>): CreditPaymentTokenOption[] {
  if (!pickable) return [];
  const record = walletRecordForPickable(pickable, walletRecords);
  const tokenRows = Array.isArray((record as Record<string, unknown> | null)?.tokens)
    ? ((record as { tokens: unknown[] }).tokens)
    : Array.isArray((pickable.wallet as unknown as Record<string, unknown>).tokens)
      ? ((pickable.wallet as unknown as { tokens: unknown[] }).tokens)
      : [];
  const options = new Map<string, CreditPaymentTokenOption>();
  for (const token of tokenRows) {
    if (!token || typeof token !== "object") continue;
    const row = token as Record<string, unknown>;
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const tokenAddress = String(row.tokenAddress || "").trim();
    const id = CREDIT_PAYMENT_TOKEN_SYMBOLS.has(symbol) ? symbol : tokenAddress;
    const balance = nullableMoneyValue(row.balance) ?? 0;
    const indexedValueUsd = nullableMoneyValue(row.valueUsd);
    const valueUsd = ["USDC", "USDT"].includes(symbol) && balance > 0
      ? balance
      : indexedValueUsd;
    if (!id || !symbol || balance <= 0) continue;
    if (!CREDIT_PAYMENT_TOKEN_SYMBOLS.has(symbol) && !tokenAddress) continue;
    if (valueUsd === null || valueUsd < MIN_CREDIT_PAYMENT_TOKEN_VALUE_USD) continue;
    options.set(id, {
      id,
      symbol,
      label: symbol,
      balance,
      valueUsd,
    });
  }
  return [...options.values()].sort((left, right) => {
    if (left.symbol === "USDC") return -1;
    if (right.symbol === "USDC") return 1;
    return (right.valueUsd ?? 0) - (left.valueUsd ?? 0);
  });
}

export function formatTokenAmount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2).replace(/\.00$/, "")}k`;
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}
