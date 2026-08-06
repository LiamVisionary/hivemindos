import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tradePanel = await readFile(new URL("../src/features/dashboard/views/trade/TradePanel.tsx", import.meta.url), "utf8");
const tradeView = await readFile(new URL("../src/components/trade/TradeView.tsx", import.meta.url), "utf8");
const tradeSurfaces = await readFile(new URL("../src/components/trade/surfaces.tsx", import.meta.url), "utf8");
const tradeContext = await readFile(new URL("../src/components/trade/trade-context.tsx", import.meta.url), "utf8");
const tradeStyles = await readFile(new URL("../src/components/trade/trade-desk.css", import.meta.url), "utf8");
const dashboardApp = await readFile(new URL("../src/features/dashboard/DashboardApp.tsx", import.meta.url), "utf8");
const personalWalletClient = await readFile(new URL("../src/lib/native/personal-wallets.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  tradePanel,
  /const refreshed = await Promise\.all\(list\.map/,
  "Trade route must not refresh every personal wallet before becoming usable",
);

const cachedSnapshotIndex = tradePanel.indexOf("publishCryptoSnapshot(cachedTokens");
const liveBalanceAwaitIndex = tradePanel.indexOf("Promise.all([liveBalancePromise");
assert.ok(cachedSnapshotIndex >= 0, "Trade route should publish its persisted crypto snapshot immediately");
assert.ok(liveBalanceAwaitIndex >= 0, "Trade route should refresh the acting wallet in the background");
assert.ok(
  cachedSnapshotIndex < liveBalanceAwaitIndex,
  "Persisted crypto holdings must render before the acting wallet live refresh settles",
);

assert.match(
  tradeView,
  /const contentLoading = !isOptions && !isPrediction && !isLiquidity && \(loading \|\| \(isStock && stockLoading\)\)/,
  "Only asset segments backed by the deferred portfolio reads should wait for stock or wallet data",
);

assert.match(
  dashboardApp,
  /import\("@\/features\/dashboard\/views\/WalletPanel"\),\s*\n\s*\(\) => import\("@\/features\/dashboard\/views\/trade\/TradePanel"\)/,
  "Trade's lazy chunk should warm immediately after Wallets during dashboard idle time",
);

assert.match(tradeContext, /stockRefreshing: boolean;/, "Stock refreshes should remain visible over stale data");
assert.match(tradeContext, /activityRefreshing: boolean;/, "Activity refreshes should remain visible over stale data");
assert.match(tradeView, /const dataRefreshing = isStock \? stockRefreshing : refreshing;/, "The active portfolio and market cards should use their own refresh state");
assert.match(tradeView, /<PortfolioCard pf=\{pf\} isStock=\{isStock\} refreshing=\{dataRefreshing\}/, "Portfolio cards should expose their refresh state");
assert.match(tradeView, /<MoversCard movers=\{movers\} isStock=\{isStock\} refreshing=\{dataRefreshing\}/, "Market cards should expose their refresh state");
assert.match(tradeView, /refreshing=\{activityRefreshing\}/, "Activity surfaces should expose their refresh state");
assert.match(tradeSurfaces, /role="status" aria-label=\{label\}/, "Corner refresh spinners should be announced accessibly");
assert.match(tradeSurfaces, /<BIcon name="spinner" size=\{14\} spin \/>/, "Corner refresh indicators should reuse the established animated Trade spinner");
assert.match(tradeStyles, /\.dk-refresh-indicator\s*\{/, "Trade refresh indicators should have shared corner placement");
assert.match(
  personalWalletClient,
  /export async function persistPersonalWalletRecords/,
  "Personal wallet refreshes should have a shared durable write-through client",
);
assert.match(
  tradePanel,
  /persistPersonalWalletRecords\(\[refreshedWallet\], vaultPath\)/,
  "Trade should persist the acting wallet's successful live balance refresh",
);

console.log("trade route performance contract passed");
