import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const {
  DISPLAY_CURRENCY_STATE_KEY,
  displayCurrencyAmountFromUsd,
  formatDisplayCurrencyFromUsd,
  normalizeDisplayCurrency,
} = await import(new URL("../src/lib/services/display-currency.ts", import.meta.url));
const { fetchWalletTokenUsdPrice } = await import(new URL("../src/lib/services/wallet/token-price-client.ts", import.meta.url));

assert.equal(DISPLAY_CURRENCY_STATE_KEY, "display.currency");
assert.equal(normalizeDisplayCurrency("EUR", { USD: 1, EUR: 0.92 }), "EUR");
assert.equal(normalizeDisplayCurrency("EUR", { USD: 1 }), "USD", "missing live rates must fall back to USD rather than guessing");
const converted = displayCurrencyAmountFromUsd(10, "EUR", { USD: 1, EUR: 0.92 });
assert.equal(converted?.currency, "EUR");
assert.ok(Math.abs((converted?.amount ?? 0) - 9.2) < Number.EPSILON * 10);
assert.equal(displayCurrencyAmountFromUsd(Number.NaN, "EUR", { USD: 1, EUR: 0.92 }), null);
assert.match(formatDisplayCurrencyFromUsd(10, "EUR", { USD: 1, EUR: 0.92 }), /9[.,]20/);
assert.equal(await fetchWalletTokenUsdPrice("ETH", async () => new Response(JSON.stringify({
  ok: true,
  rows: [{ symbol: "ETH", price: 1770.22 }],
}), { status: 200 })), 1770.22, "the send modal must recover a live ETH quote when the wallet snapshot has none");
assert.equal(await fetchWalletTokenUsdPrice("ETH", async () => new Response(JSON.stringify({ ok: true, rows: [] }), { status: 200 })), null);

const displayCurrencyHookSource = readFileSync(join(root, "src/lib/services/use-display-currency.ts"), "utf8");
assert.match(displayCurrencyHookSource, /useRememberedDashboardValue\(DISPLAY_CURRENCY_STATE_KEY, "USD"\)/, "display currency must persist through dashboard state");
assert.match(displayCurrencyHookSource, /kind: "fx"/, "display currency must use the live FX route");
assert.match(displayCurrencyHookSource, /cachedFxRates/, "view changes must reuse already-loaded rates instead of briefly converting in USD");
assert.match(displayCurrencyHookSource, /ready: preferenceReady && ratesReady/, "consumers must know when both the preference and rates are hydrated");

const rememberedValueHookSource = readFileSync(join(root, "src/lib/services/use-remembered-dashboard-value.ts"), "utf8");
assert.match(rememberedValueHookSource, /return \[value, remember, hydrated\] as const/, "remembered values must expose hydration without changing existing two-value consumers");

const walletTokenPriceHookSource = readFileSync(join(root, "src/lib/services/wallet/use-wallet-token-usd-price.ts"), "utf8");
assert.match(walletTokenPriceHookSource, /fetchWalletTokenUsdPrice\(symbol\)/, "the token-price hook must fetch a live fallback when the wallet snapshot has no quote");

const tradePanelSource = readFileSync(join(root, "src/features/dashboard/views/trade/TradePanel.tsx"), "utf8");
assert.match(tradePanelSource, /const \{ currency, fxRates, setCurrency \} = useDisplayCurrency\(\)/, "Trade must set the shared display currency preference");
assert.doesNotMatch(tradePanelSource, /const \[currency, setCurrency\] = useState\("USD"\)/, "Trade currency must not reset when its view remounts");

const walletViewSource = readFileSync(join(root, "src/components/wallets-drop-in/WalletsView.tsx"), "utf8");
assert.match(walletViewSource, /useWalletTokenUsdPrice\(sendSym, sourceAsset\?\.priceUsd\)/, "send estimate must resolve missing token quotes through the shared live-price hook");
assert.match(walletViewSource, /formatDisplayCurrencyFromUsd\(sendAmount \* resolvedPriceUsd, displayCurrency, displayCurrencyRates\)/, "send estimate must use the resolved live USD price");
assert.match(walletViewSource, /aria-live="polite"/, "send estimate must announce live amount changes accessibly");
assert.match(walletViewSource, /\{fiatEstimate\} \{displayCurrency\}/, "send estimate must identify the user's selected currency");
assert.match(walletViewSource, /!displayCurrencyReady/, "the modal must not flash a USD estimate before the saved currency hydrates");
assert.match(walletViewSource, /className="fw-fundfoot fw-sendfoot"/, "the send row needs its own alignment contract");
assert.doesNotMatch(walletViewSource, /"Send to " \+ selected\.wallet\.name/, "the action must not grow or wrap with a destination wallet name");

const walletStyles = readFileSync(join(root, "src/components/wallets-drop-in/wallets.css"), "utf8");
assert.match(walletStyles, /\.fw-sendfoot \{[^}]*align-items: flex-start/, "asset, amount, and action controls must share the same top edge");
assert.match(walletStyles, /\.fw-sendfoot \.fw-asset-btn,[^{]*\.fw-sendfoot \.fw-amount-entry > \.fb-field,[^{]*\.fw-sendfoot > \.fw-save \{[^}]*height: 38px/, "send controls must share one explicit height");
assert.match(walletStyles, /\.fw-sendfoot > \.fw-save \{[^}]*white-space: nowrap/, "the send action must stay on one line");

console.log("Wallet display-currency checks passed.");
