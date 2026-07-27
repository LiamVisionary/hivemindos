#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const temp = await mkdtemp(join(tmpdir(), "hivemindos-crypto-practice-"));
process.env.HIVEMINDOS_CRYPTO_PRACTICE_BOOK_PATH = join(temp, "crypto-practice-book.json");

try {
  const {
    CRYPTO_PRACTICE_REPLAY_CONFIRMATION,
    buildAlpacaPaperCryptoSnapshot,
    buildHyperliquidCryptoSnapshot,
    clearCryptoPracticeTarget,
    planHyperliquidReplay,
    readCryptoPracticeBook,
    saveCryptoPracticeSnapshot,
    upsertManualCryptoPracticeHolding,
  } = await import("../src/lib/services/trading/crypto-practice-book.ts");
  const { listHiveActions } = await import("../src/lib/services/hive-actions/index.ts");

  const agentId = "agent:test-crypto-practice";
  const alpacaSnapshot = buildAlpacaPaperCryptoSnapshot({
    capturedAt: "2026-06-26T01:00:00.000Z",
    account: { portfolio_value: "125000", cash: "98000" },
    positions: [
      { symbol: "BTC/USD", qty: "0.5", market_value: "15000", avg_entry_price: "25000", current_price: "30000", unrealized_pl: "2500" },
      { symbol: "ETHUSD", qty: "2", market_value: "6000", avg_entry_price: "2500", current_price: "3000", unrealized_pl: "1000" },
      { symbol: "AAPL", qty: "3", market_value: "600", avg_entry_price: "190", current_price: "200" },
    ],
  });
  assert.equal(alpacaSnapshot.source, "alpaca-paper");
  assert.equal(alpacaSnapshot.holdings.length, 2, "stock positions should not enter the crypto practice book");
  assert.deepEqual(alpacaSnapshot.holdings.map((holding) => holding.symbol), ["BTC", "ETH"]);

  let book = await saveCryptoPracticeSnapshot({ agentId, snapshot: alpacaSnapshot, replaceTarget: true });
  assert.equal(book.targetSource, "alpaca-paper");
  assert.equal(book.targetHoldings.length, 2);
  assert.equal(book.snapshots["alpaca-paper"]?.accountValueUsd, 125000);

  book = await upsertManualCryptoPracticeHolding({
    agentId,
    holding: { symbol: "SOL", marketType: "perp", side: "short", quantity: 3, notionalUsd: 450, source: "manual" },
  });
  assert.equal(book.targetSource, "manual");
  assert.ok(book.targetHoldings.find((holding) => holding.id === "perp:SOL:short"));

  const emptyReplay = planHyperliquidReplay({ agentId, book, currentHoldings: [], network: "testnet" });
  assert.equal(emptyReplay.confirmation, CRYPTO_PRACTICE_REPLAY_CONFIRMATION);
  assert.equal(emptyReplay.orders.length, 3);
  assert.equal(emptyReplay.orders.find((order) => order.sourceHoldingId === "spot:BTC:long")?.coin, "BTC/USDC");
  assert.equal(emptyReplay.orders.find((order) => order.sourceHoldingId === "perp:SOL:short")?.side, "short");
  assert.equal(emptyReplay.unsupported.length, 0);

  const partialReplay = planHyperliquidReplay({
    agentId,
    book,
    currentHoldings: [{ ...book.targetHoldings.find((holding) => holding.id === "spot:BTC:long"), notionalUsd: 5000 }],
    network: "testnet",
  });
  assert.equal(partialReplay.orders.find((order) => order.sourceHoldingId === "spot:BTC:long")?.notionalUsd, 10000);

  const hyperSnapshot = buildHyperliquidCryptoSnapshot({
    ok: true,
    network: "testnet",
    walletAddress: "0x0000000000000000000000000000000000000001",
    accountValueUsd: 1000,
    withdrawableUsd: 100,
    positions: [{ coin: "SOL", side: "long", size: 1, positionValueUsd: 150, entryPrice: 150, unrealizedPnlUsd: 0 }],
    spotBalances: [{ coin: "HYPE", total: 4, hold: 0, available: 4, entryNotionalUsd: 120 }],
    openOrders: [],
    builderConfig: {},
    builderApproval: {},
    detail: "",
  });
  book = await saveCryptoPracticeSnapshot({ agentId, snapshot: hyperSnapshot, replaceTarget: false });
  assert.equal(book.targetSource, "manual", "snapshot-only sync must not wipe the shared target");
  assert.equal(book.snapshots.hyperliquid?.holdings.length, 2);

  book = await clearCryptoPracticeTarget(agentId);
  assert.equal(book.targetSource, "none");
  assert.equal(book.targetHoldings.length, 0);
  assert.equal((await readCryptoPracticeBook(agentId)).snapshots["alpaca-paper"]?.holdings.length, 2);

  const action = listHiveActions().find((item) => item.mcp?.toolName === "crypto_practice_book");
  assert.ok(action, "crypto_practice_book action should be discoverable");
  assert.equal(action.contextIndex?.route, "/api/trading/practice-book");
  assert.equal(action.confirmation?.token, CRYPTO_PRACTICE_REPLAY_CONFIRMATION);

  const service = await readFile(new URL("../src/lib/services/trading/crypto-practice-book.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../src/app/api/trading/practice-book/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/features/dashboard/views/trade/CryptoPracticeBookPanel.tsx", import.meta.url), "utf8");
  const cryptoDocs = await readFile(new URL("../docs/for-users/trading/crypto.md", import.meta.url), "utf8");
  assert.match(service, /HIVEMINDOS_CRYPTO_PRACTICE_BOOK_PATH/);
  assert.match(route, /execute-hyperliquid-replay/);
  assert.match(route, /CRYPTO_PRACTICE_REPLAY_CONFIRMATION/);
  assert.match(ui, /Save Alpaca paper target/);
  assert.match(ui, /Plan Hyperliquid replay/);
  assert.match(cryptoDocs, /Shared practice book/);

  console.log("Crypto practice book tests passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
