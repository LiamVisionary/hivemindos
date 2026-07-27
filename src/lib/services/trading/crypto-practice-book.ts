import "server-only";

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";

import { homedir } from "@/lib/home-dir";
import { ALPACA_LIVE_ENV_NAMES, ALPACA_PAPER_ENV_NAMES } from "@/lib/services/trading/buy-stock";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import type { HyperliquidAccountStatus } from "@/lib/services/trading/hyperliquid";

export const CRYPTO_PRACTICE_REPLAY_CONFIRMATION = "CONFIRM_CRYPTO_PRACTICE_REPLAY";

export type CryptoPracticeSource = "alpaca-paper" | "hyperliquid" | "manual";
export type CryptoPracticeMarketType = "spot" | "perp";
export type CryptoPracticeSide = "long" | "short";

export type CryptoPracticeHolding = {
  id: string;
  symbol: string;
  marketType: CryptoPracticeMarketType;
  side: CryptoPracticeSide;
  quantity: number;
  notionalUsd: number;
  avgEntryPrice?: number;
  markPrice?: number;
  unrealizedPnlUsd?: number;
  source: CryptoPracticeSource;
  sourceReference?: string;
  updatedAt: string;
  stale?: boolean;
};

export type CryptoPracticeSnapshot = {
  id: string;
  source: CryptoPracticeSource;
  capturedAt: string;
  holdings: CryptoPracticeHolding[];
  accountValueUsd?: number;
  cashUsd?: number;
  walletAddress?: string;
  network?: "mainnet" | "testnet";
  stale?: boolean;
  detail: string;
};

export type CryptoPracticeBook = {
  version: 1;
  agentId: string;
  baseCurrency: "USD";
  updatedAt: string;
  targetSource: CryptoPracticeSource | "none";
  targetUpdatedAt?: string;
  targetHoldings: CryptoPracticeHolding[];
  snapshots: Partial<Record<CryptoPracticeSource, CryptoPracticeSnapshot>>;
};

export type CryptoPracticeReplayOrder = {
  sourceHoldingId: string;
  coin: string;
  marketType: CryptoPracticeMarketType;
  side: "long" | "short" | "buy" | "sell";
  notionalUsd: number;
  reduceOnly: boolean;
  supported: boolean;
  reason: string;
  missing?: string;
};

export type CryptoPracticeReplayPlan = {
  agentId: string;
  executionVenue: "hyperliquid";
  generatedAt: string;
  network?: "mainnet" | "testnet";
  orders: CryptoPracticeReplayOrder[];
  unsupported: CryptoPracticeReplayOrder[];
  totalNotionalUsd: number;
  confirmation: typeof CRYPTO_PRACTICE_REPLAY_CONFIRMATION;
  detail: string;
};

type CryptoPracticeBookStore = {
  version: 1;
  books: Record<string, CryptoPracticeBook>;
};

type AlpacaPaperCredentialsPolicy = {
  alpacaKeyEnvName?: string;
  alpacaSecretEnvName?: string;
};

const STORE_VERSION = 1;
const DEFAULT_MIN_REPLAY_NOTIONAL_USD = 1;
const COMMON_CRYPTO_SYMBOLS = new Set([
  "AAVE",
  "AVAX",
  "BCH",
  "BTC",
  "DOGE",
  "ETH",
  "HYPE",
  "LINK",
  "LTC",
  "PURR",
  "SHIB",
  "SOL",
  "UNI",
  "USDC",
  "USDT",
]);
const HYPERLIQUID_PERP_COINS = new Set(["BTC", "ETH", "SOL", "HYPE"]);
const HYPERLIQUID_SPOT_COINS: Record<string, string> = {
  BTC: "BTC/USDC",
  ETH: "ETH/USDC",
  HYPE: "HYPE",
  PURR: "PURR/USDC",
};

let writeQueue: Promise<CryptoPracticeBookStore> = Promise.resolve(emptyStore());

function storePath() {
  return process.env.HIVEMINDOS_CRYPTO_PRACTICE_BOOK_PATH || join(homedir(), ".hivemindos", "crypto-practice-book.json");
}

function emptyStore(): CryptoPracticeBookStore {
  return { version: STORE_VERSION, books: {} };
}

function emptyBook(agentId: string): CryptoPracticeBook {
  return {
    version: STORE_VERSION,
    agentId,
    baseCurrency: "USD",
    updatedAt: new Date(0).toISOString(),
    targetSource: "none",
    targetHoldings: [],
    snapshots: {},
  };
}

function numeric(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positive(value: unknown): number {
  const parsed = numeric(value);
  return parsed && parsed > 0 ? parsed : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeMarketType(value: unknown): CryptoPracticeMarketType {
  return String(value || "").trim().toLowerCase() === "perp" ? "perp" : "spot";
}

function normalizeSide(value: unknown): CryptoPracticeSide {
  return String(value || "").trim().toLowerCase() === "short" ? "short" : "long";
}

export function normalizeCryptoPracticeSymbol(value: unknown): string {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "").replace(/[-_]/g, "/");
  let base = compact;
  if (compact.includes("/")) {
    base = compact.split("/")[0] || "";
  } else {
    for (const suffix of ["USDT", "USDC", "USD"]) {
      if (compact.endsWith(suffix) && compact.length > suffix.length + 1) {
        base = compact.slice(0, -suffix.length);
        break;
      }
    }
  }
  const aliases: Record<string, string> = {
    XBT: "BTC",
    UBTC: "BTC",
    WBTC: "BTC",
    WETH: "ETH",
  };
  const symbol = aliases[base] || base;
  return COMMON_CRYPTO_SYMBOLS.has(symbol) || compact.includes("/") || /(?:USD|USDC|USDT)$/.test(compact) ? symbol : "";
}

function holdingKey(input: Pick<CryptoPracticeHolding, "symbol" | "marketType" | "side">) {
  return `${input.marketType}:${input.symbol}:${input.side}`;
}

function normalizeHolding(input: Partial<CryptoPracticeHolding> & { symbol?: unknown }): CryptoPracticeHolding | null {
  const symbol = normalizeCryptoPracticeSymbol(input.symbol);
  if (!symbol || symbol === "USDC" || symbol === "USDT") return null;
  const marketType = normalizeMarketType(input.marketType);
  const side = normalizeSide(input.side);
  const quantity = Math.abs(positive(input.quantity));
  const avgEntryPrice = positive(input.avgEntryPrice);
  const markPrice = positive(input.markPrice);
  const notionalUsd = positive(input.notionalUsd) || quantity * (markPrice || avgEntryPrice);
  if (quantity <= 0 && notionalUsd <= 0) return null;
  const updatedAt = typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : nowIso();
  const holding: CryptoPracticeHolding = {
    id: holdingKey({ symbol, marketType, side }),
    symbol,
    marketType,
    side,
    quantity,
    notionalUsd,
    source: input.source || "manual",
    updatedAt,
  };
  if (avgEntryPrice > 0) holding.avgEntryPrice = avgEntryPrice;
  if (markPrice > 0) holding.markPrice = markPrice;
  if (Number.isFinite(input.unrealizedPnlUsd)) holding.unrealizedPnlUsd = Number(input.unrealizedPnlUsd);
  if (input.sourceReference) holding.sourceReference = String(input.sourceReference);
  if (input.stale) holding.stale = true;
  return holding;
}

export function coalesceCryptoPracticeHoldings(holdings: Array<Partial<CryptoPracticeHolding> & { symbol?: unknown }>): CryptoPracticeHolding[] {
  const grouped = new Map<string, CryptoPracticeHolding[]>();
  holdings.map(normalizeHolding).filter((holding): holding is CryptoPracticeHolding => holding !== null).forEach((holding) => {
    const key = holdingKey(holding);
    grouped.set(key, [...(grouped.get(key) ?? []), holding]);
  });
  return [...grouped.values()].map((items) => {
    const first = items[0]!;
    const quantity = items.reduce((sum, item) => sum + Math.abs(item.quantity), 0);
    const notionalUsd = items.reduce((sum, item) => sum + item.notionalUsd, 0);
    const weighted = (field: "avgEntryPrice" | "markPrice") => {
      const total = items.reduce((sum, item) => sum + (item[field] ? item[field]! * Math.abs(item.quantity) : 0), 0);
      return quantity > 0 && total > 0 ? total / quantity : undefined;
    };
    const latest = items.map((item) => item.updatedAt).sort().at(-1) || nowIso();
    const next: CryptoPracticeHolding = {
      ...first,
      id: holdingKey(first),
      quantity,
      notionalUsd,
      updatedAt: latest,
      stale: items.some((item) => item.stale) || undefined,
    };
    const avgEntryPrice = weighted("avgEntryPrice");
    const markPrice = weighted("markPrice");
    if (avgEntryPrice) next.avgEntryPrice = avgEntryPrice;
    if (markPrice) next.markPrice = markPrice;
    const unrealized = items.reduce((sum, item) => sum + (Number(item.unrealizedPnlUsd) || 0), 0);
    if (unrealized) next.unrealizedPnlUsd = unrealized;
    return next;
  }).sort((left, right) => left.marketType.localeCompare(right.marketType) || left.symbol.localeCompare(right.symbol) || left.side.localeCompare(right.side));
}

export function holdingsFromAlpacaPaperPositions(positions: unknown[], capturedAt = nowIso()): CryptoPracticeHolding[] {
  return coalesceCryptoPracticeHoldings((Array.isArray(positions) ? positions : []).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    const symbol = normalizeCryptoPracticeSymbol(record.symbol);
    if (!symbol) return [];
    const quantity = positive(record.qty);
    const marketValue = positive(record.market_value);
    const currentPrice = positive(record.current_price);
    const avgEntryPrice = positive(record.avg_entry_price);
    return [{
      symbol,
      marketType: "spot",
      side: "long",
      quantity,
      notionalUsd: marketValue,
      avgEntryPrice,
      markPrice: currentPrice,
      unrealizedPnlUsd: numeric(record.unrealized_pl) ?? 0,
      source: "alpaca-paper",
      sourceReference: String(record.asset_id || record.symbol || ""),
      updatedAt: capturedAt,
    }];
  }));
}

export function holdingsFromHyperliquidStatus(status: Pick<HyperliquidAccountStatus, "positions" | "spotBalances">, capturedAt = nowIso()): CryptoPracticeHolding[] {
  const perpHoldings = (Array.isArray(status.positions) ? status.positions : []).flatMap((position) => {
    const symbol = normalizeCryptoPracticeSymbol(position.coin);
    if (!symbol || position.side === "flat" || !position.size) return [];
    return [{
      symbol,
      marketType: "perp" as const,
      side: position.side,
      quantity: Math.abs(Number(position.size) || 0),
      notionalUsd: positive(position.positionValueUsd),
      avgEntryPrice: positive(position.entryPrice),
      markPrice: position.positionValueUsd && position.size ? Math.abs(Number(position.positionValueUsd) / Number(position.size)) : undefined,
      unrealizedPnlUsd: numeric(position.unrealizedPnlUsd) ?? 0,
      source: "hyperliquid" as const,
      updatedAt: capturedAt,
    }];
  });
  const spotHoldings = (Array.isArray(status.spotBalances) ? status.spotBalances : []).flatMap((balance) => {
    const symbol = normalizeCryptoPracticeSymbol(balance.coin);
    if (!symbol || symbol === "USDC") return [];
    const quantity = positive(balance.total);
    return [{
      symbol,
      marketType: "spot" as const,
      side: "long" as const,
      quantity,
      notionalUsd: positive(balance.entryNotionalUsd),
      source: "hyperliquid" as const,
      updatedAt: capturedAt,
    }];
  });
  return coalesceCryptoPracticeHoldings([...perpHoldings, ...spotHoldings]);
}

export function buildAlpacaPaperCryptoSnapshot(input: {
  account?: Record<string, unknown>;
  positions: unknown[];
  capturedAt?: string;
  stale?: boolean;
}): CryptoPracticeSnapshot {
  const capturedAt = input.capturedAt || nowIso();
  const holdings = holdingsFromAlpacaPaperPositions(input.positions, capturedAt);
  const account = input.account ?? {};
  return {
    id: `alpaca-paper:${capturedAt}`,
    source: "alpaca-paper",
    capturedAt,
    holdings,
    accountValueUsd: positive(account.portfolio_value) || positive(account.equity),
    cashUsd: positive(account.cash),
    stale: input.stale || undefined,
    detail: holdings.length
      ? `Captured ${holdings.length} crypto paper position${holdings.length === 1 ? "" : "s"} from Alpaca paper.`
      : "Captured Alpaca paper, but no crypto positions were open.",
  };
}

export function buildHyperliquidCryptoSnapshot(status: HyperliquidAccountStatus, capturedAt = nowIso()): CryptoPracticeSnapshot {
  const holdings = holdingsFromHyperliquidStatus(status, capturedAt);
  return {
    id: `hyperliquid:${capturedAt}`,
    source: "hyperliquid",
    capturedAt,
    holdings,
    accountValueUsd: status.accountValueUsd,
    cashUsd: status.withdrawableUsd,
    walletAddress: status.walletAddress,
    network: status.network,
    detail: holdings.length
      ? `Captured ${holdings.length} Hyperliquid position${holdings.length === 1 ? "" : "s"} or spot balance${holdings.length === 1 ? "" : "s"}.`
      : "Captured Hyperliquid, but no crypto positions were open.",
  };
}

function normalizeBook(value: unknown, agentId: string): CryptoPracticeBook {
  const fallback = emptyBook(agentId);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Partial<CryptoPracticeBook>;
  const snapshots = record.snapshots && typeof record.snapshots === "object" && !Array.isArray(record.snapshots)
    ? Object.fromEntries(Object.entries(record.snapshots).filter(([, snapshot]) => snapshot && typeof snapshot === "object"))
    : {};
  return {
    version: STORE_VERSION,
    agentId,
    baseCurrency: "USD",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt,
    targetSource: record.targetSource === "alpaca-paper" || record.targetSource === "hyperliquid" || record.targetSource === "manual" ? record.targetSource : "none",
    targetUpdatedAt: typeof record.targetUpdatedAt === "string" ? record.targetUpdatedAt : undefined,
    targetHoldings: coalesceCryptoPracticeHoldings(Array.isArray(record.targetHoldings) ? record.targetHoldings : []),
    snapshots: snapshots as Partial<Record<CryptoPracticeSource, CryptoPracticeSnapshot>>,
  };
}

function normalizeStore(value: unknown): CryptoPracticeBookStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyStore();
  const record = value as Partial<CryptoPracticeBookStore>;
  const books = record.books && typeof record.books === "object" && !Array.isArray(record.books)
    ? Object.fromEntries(Object.entries(record.books).map(([agentId, book]) => [agentId, normalizeBook(book, agentId)]))
    : {};
  return { version: STORE_VERSION, books };
}

export async function readCryptoPracticeStore(): Promise<CryptoPracticeBookStore> {
  try {
    const raw = await readFile(storePath(), "utf8");
    return normalizeStore(JSON.parse(raw) as unknown);
  } catch {
    return emptyStore();
  }
}

async function writeStore(store: CryptoPracticeBookStore) {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

async function mutateBook(agentId: string, mutate: (book: CryptoPracticeBook) => CryptoPracticeBook): Promise<CryptoPracticeBook> {
  const write = async () => {
    const store = await readCryptoPracticeStore();
    const current = normalizeBook(store.books[agentId], agentId);
    const next = normalizeBook(mutate(current), agentId);
    next.updatedAt = nowIso();
    store.books[agentId] = next;
    await writeStore(store);
    return store;
  };
  writeQueue = writeQueue.catch(() => emptyStore()).then(write);
  const updatedStore = await writeQueue;
  return updatedStore.books[agentId] ?? emptyBook(agentId);
}

export async function readCryptoPracticeBook(agentId: string): Promise<CryptoPracticeBook> {
  const store = await readCryptoPracticeStore();
  return normalizeBook(store.books[agentId], agentId);
}

export async function saveCryptoPracticeSnapshot(input: {
  agentId: string;
  snapshot: CryptoPracticeSnapshot;
  replaceTarget?: boolean;
}): Promise<CryptoPracticeBook> {
  return mutateBook(input.agentId, (book) => {
    const snapshots = { ...book.snapshots, [input.snapshot.source]: input.snapshot };
    if (!input.replaceTarget) return { ...book, snapshots };
    return {
      ...book,
      snapshots,
      targetSource: input.snapshot.source,
      targetUpdatedAt: input.snapshot.capturedAt,
      targetHoldings: input.snapshot.holdings,
    };
  });
}

export async function upsertManualCryptoPracticeHolding(input: {
  agentId: string;
  holding: Partial<CryptoPracticeHolding> & { symbol?: unknown };
}): Promise<CryptoPracticeBook> {
  const holding = normalizeHolding({ ...input.holding, source: "manual", updatedAt: nowIso() });
  if (!holding) throw new Error("Choose an asset and enter a positive quantity or notional value.");
  return mutateBook(input.agentId, (book) => {
    const existing = book.targetHoldings.filter((item) => item.id !== holding.id);
    return {
      ...book,
      targetSource: "manual",
      targetUpdatedAt: holding.updatedAt,
      targetHoldings: coalesceCryptoPracticeHoldings([...existing, holding]),
    };
  });
}

export async function clearCryptoPracticeTarget(agentId: string): Promise<CryptoPracticeBook> {
  return mutateBook(agentId, (book) => ({
    ...book,
    targetSource: "none",
    targetUpdatedAt: nowIso(),
    targetHoldings: [],
  }));
}

function hyperliquidCoinForHolding(holding: CryptoPracticeHolding): string | null {
  if (holding.marketType === "perp") return HYPERLIQUID_PERP_COINS.has(holding.symbol) ? holding.symbol : null;
  return HYPERLIQUID_SPOT_COINS[holding.symbol] ?? null;
}

function orderForHoldingDelta(input: {
  holding: CryptoPracticeHolding;
  notionalUsd: number;
  increase: boolean;
  reason: string;
}): CryptoPracticeReplayOrder {
  const coin = hyperliquidCoinForHolding(input.holding);
  const unsupported = !coin
    ? `${input.holding.symbol} ${input.holding.marketType} is not mapped to a supported Hyperliquid market yet.`
    : input.holding.marketType === "spot" && input.holding.side === "short"
      ? "Spot shorts are not supported; use a perp target for short exposure."
      : "";
  let side: CryptoPracticeReplayOrder["side"];
  let reduceOnly = false;
  if (input.increase) {
    side = input.holding.marketType === "spot" ? "buy" : input.holding.side;
  } else if (input.holding.marketType === "spot") {
    side = "sell";
  } else {
    side = input.holding.side === "long" ? "short" : "long";
    reduceOnly = true;
  }
  return {
    sourceHoldingId: input.holding.id,
    coin: coin || input.holding.symbol,
    marketType: input.holding.marketType,
    side,
    notionalUsd: Number(input.notionalUsd.toFixed(2)),
    reduceOnly,
    supported: Boolean(coin) && !unsupported,
    reason: input.reason,
    missing: unsupported || undefined,
  };
}

export function planHyperliquidReplay(input: {
  agentId: string;
  book: CryptoPracticeBook;
  currentHoldings?: CryptoPracticeHolding[];
  network?: "mainnet" | "testnet";
  minNotionalUsd?: number;
}): CryptoPracticeReplayPlan {
  const minNotionalUsd = input.minNotionalUsd ?? DEFAULT_MIN_REPLAY_NOTIONAL_USD;
  const target = coalesceCryptoPracticeHoldings(input.book.targetHoldings);
  const current = coalesceCryptoPracticeHoldings(input.currentHoldings ?? []);
  const currentById = new Map(current.map((holding) => [holding.id, holding]));
  const targetById = new Map(target.map((holding) => [holding.id, holding]));
  const orders: CryptoPracticeReplayOrder[] = [];

  for (const currentHolding of current) {
    const targetHolding = targetById.get(currentHolding.id);
    const targetNotional = targetHolding?.notionalUsd ?? 0;
    const delta = currentHolding.notionalUsd - targetNotional;
    if (delta > minNotionalUsd) {
      orders.push(orderForHoldingDelta({
        holding: currentHolding,
        notionalUsd: delta,
        increase: false,
        reason: targetHolding ? `Reduce ${currentHolding.symbol} ${currentHolding.side} to match the shared practice target.` : `Close ${currentHolding.symbol} ${currentHolding.side}; it is not in the shared practice target.`,
      }));
    }
  }

  for (const targetHolding of target) {
    const currentHolding = currentById.get(targetHolding.id);
    const currentNotional = currentHolding?.notionalUsd ?? 0;
    const delta = targetHolding.notionalUsd - currentNotional;
    if (delta > minNotionalUsd) {
      orders.push(orderForHoldingDelta({
        holding: targetHolding,
        notionalUsd: delta,
        increase: true,
        reason: currentHolding ? `Increase ${targetHolding.symbol} ${targetHolding.side} to match the shared practice target.` : `Open ${targetHolding.symbol} ${targetHolding.side} from the shared practice target.`,
      }));
    }
  }

  const executable = orders.filter((order) => order.supported);
  const unsupported = orders.filter((order) => !order.supported);
  const totalNotionalUsd = executable.reduce((sum, order) => sum + order.notionalUsd, 0);
  return {
    agentId: input.agentId,
    executionVenue: "hyperliquid",
    generatedAt: nowIso(),
    network: input.network,
    orders: executable,
    unsupported,
    totalNotionalUsd: Number(totalNotionalUsd.toFixed(2)),
    confirmation: CRYPTO_PRACTICE_REPLAY_CONFIRMATION,
    detail: executable.length
      ? `Prepared ${executable.length} Hyperliquid replay order${executable.length === 1 ? "" : "s"} for ~$${totalNotionalUsd.toFixed(2)} total notional.`
      : unsupported.length
        ? "No executable Hyperliquid replay orders were prepared; review unsupported targets."
        : "Hyperliquid already matches the shared practice target within the replay threshold.",
  };
}

async function firstPresentEnv(names: Array<string | undefined>): Promise<{ name: string; value: string } | null> {
  for (const name of names) {
    const clean = name?.trim();
    if (!clean) continue;
    const value = await hiveEnvValue(clean);
    if (value) return { name: clean, value };
  }
  return null;
}

async function resolveAlpacaPaperCredentials(policy?: AlpacaPaperCredentialsPolicy) {
  const keyNames = [ALPACA_PAPER_ENV_NAMES[0], policy?.alpacaKeyEnvName, ALPACA_LIVE_ENV_NAMES[0]];
  const secretNames = [ALPACA_PAPER_ENV_NAMES[1], policy?.alpacaSecretEnvName, ALPACA_LIVE_ENV_NAMES[1]];
  const [key, secret] = await Promise.all([firstPresentEnv(keyNames), firstPresentEnv(secretNames)]);
  if (!key || !secret) {
    throw new Error(`Alpaca paper keys not found in shared hive env (${ALPACA_PAPER_ENV_NAMES.join(" / ")}).`);
  }
  return { apiKey: key.value, apiSecret: secret.value };
}

export async function fetchAlpacaPaperCryptoSnapshot(input: {
  agentId: string;
  policy?: AlpacaPaperCredentialsPolicy;
}): Promise<CryptoPracticeSnapshot> {
  const { apiKey, apiSecret } = await resolveAlpacaPaperCredentials(input.policy);
  const headers = { "APCA-API-KEY-ID": apiKey, "APCA-API-SECRET-KEY": apiSecret };
  const base = "https://paper-api.alpaca.markets";
  const [accountRes, positionsRes] = await Promise.all([
    fetch(`${base}/v2/account`, { headers, signal: AbortSignal.timeout(20_000) }),
    fetch(`${base}/v2/positions`, { headers, signal: AbortSignal.timeout(20_000) }),
  ]);
  if (!accountRes.ok) throw new Error(`Alpaca paper account fetch failed (HTTP ${accountRes.status}).`);
  if (!positionsRes.ok) throw new Error(`Alpaca paper positions fetch failed (HTTP ${positionsRes.status}).`);
  const account = (await accountRes.json().catch(() => ({}))) as Record<string, unknown>;
  const positions = (await positionsRes.json().catch(() => [])) as unknown[];
  return buildAlpacaPaperCryptoSnapshot({ account, positions });
}
