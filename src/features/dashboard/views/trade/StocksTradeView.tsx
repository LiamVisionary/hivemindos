"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import styles from "./trade.module.css";
import { COMMON_ALPACA_TICKERS } from "./trade-intents";
import {
  type StockQuote,
  type StockTradeResult,
  type StockVenue,
  type TradingReadiness,
  executeStockTrade,
  fetchTradingReadiness,
  quoteStockTrade,
} from "./trade-api";

const OTHER_TICKER = "__other__";

export function StocksTradeView({
  agentId,
  wallet,
  agentName,
  setActiveView,
}: {
  agentId: string;
  wallet: Record<string, unknown> | null;
  agentName: string;
  setActiveView?: (view: DashboardView) => void;
}) {
  const [readiness, setReadiness] = useState<TradingReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [tickerChoice, setTickerChoice] = useState("");
  const [customTicker, setCustomTicker] = useState("");
  const [amount, setAmount] = useState("25");
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [busy, setBusy] = useState<"quote" | "execute" | null>(null);
  const [result, setResult] = useState<StockTradeResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    void fetchTradingReadiness().then((data) => {
      if (ignore) return;
      setReadiness(data);
      setLoading(false);
    });
    return () => { ignore = true; };
  }, []);

  const tradeAgent = useMemo(
    () => readiness?.agents.find((entry) => entry.agentId === agentId) ?? null,
    [readiness, agentId],
  );
  const venue: StockVenue | null = (tradeAgent?.venue ?? (wallet?.tradingVenue as StockVenue | undefined)) ?? null;
  const paper = tradeAgent?.paper ?? (wallet?.alpacaPaper !== false);
  const alpacaConfigured = readiness?.venues.alpaca.configured ?? false;
  const xstockTickers = readiness?.venues.xstocks.supportedTickers ?? [];

  const tickerOptions = venue === "xstocks" ? xstockTickers : COMMON_ALPACA_TICKERS;
  // Derive a valid selection rather than resetting state in an effect: if the
  // current pick isn't in this venue's option set, fall back to the first option.
  const effectiveTickerChoice = tickerChoice && (tickerOptions.includes(tickerChoice) || tickerChoice === OTHER_TICKER)
    ? tickerChoice
    : (tickerOptions[0] ?? "");
  const ticker = effectiveTickerChoice === OTHER_TICKER ? customTicker.trim().toUpperCase() : effectiveTickerChoice;

  const notionalUsd = Number(amount) || 0;
  const canAct = Boolean(venue) && Boolean(ticker) && notionalUsd > 0 && !busy;

  const getQuote = useCallback(async () => {
    if (!canAct) return;
    setBusy("quote");
    setQuoteError("");
    setQuote(null);
    setResult(null);
    const response = await quoteStockTrade({ agentId, side, ticker, notionalUsd });
    setBusy(null);
    if (!response.ok || !response.quote) {
      setQuoteError(response.error || "Could not price this trade.");
      return;
    }
    setQuote(response.quote);
  }, [agentId, side, ticker, notionalUsd, canAct]);

  const submit = useCallback(async () => {
    if (!canAct) return;
    const confirmation = readiness?.confirmations[side];
    if (!confirmation) {
      setError("Missing confirmation token — reload the Trade tab.");
      return;
    }
    setBusy("execute");
    setError("");
    setResult(null);
    const response = await executeStockTrade({ agentId, side, ticker, notionalUsd, confirmation });
    setBusy(null);
    if (!response.ok || !response.result) {
      setError(response.error || "Trade failed.");
      return;
    }
    setResult(response.result);
    setQuote(null);
  }, [agentId, side, ticker, notionalUsd, canAct, readiness]);

  if (loading) return <div className={styles.empty}>Checking trade rails…</div>;

  if (!venue) {
    return (
      <div className={styles.card}>
        <div className={styles.warnCard}>
          Stock trading is off for <strong>{agentName}</strong>. Set a trading venue
          (Alpaca brokerage or on-chain xStocks) in this agent&apos;s wallet settings to enable buying and selling.
        </div>
        {setActiveView ? (
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={() => setActiveView("wallet")}>Open Wallets</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <div className={styles.segmented} role="tablist" aria-label="Trade side">
          {(["buy", "sell"] as const).map((value) => (
            <button key={value} type="button" data-active={side === value ? "" : undefined} onClick={() => { setSide(value); setQuote(null); setResult(null); setError(""); }}>
              {value === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        <div className={styles.field} style={{ marginTop: 14 }}>
          <span className={styles.label}>Venue</span>
          <div className={styles.actingRow}>
            <span className={styles.pill}>{venue === "alpaca" ? `Alpaca · ${paper ? "paper" : "LIVE"}` : "xStocks · Solana"}</span>
            {venue === "alpaca" && !alpacaConfigured ? <span className={`${styles.badge} ${styles.badgeSetup}`}>Set ALPACA keys</span> : null}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="trade-ticker">Ticker</label>
          <select id="trade-ticker" className={styles.select} value={effectiveTickerChoice} onChange={(event) => { setTickerChoice(event.target.value); setQuote(null); }}>
            {tickerOptions.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            {venue === "alpaca" ? <option value={OTHER_TICKER}>Other…</option> : null}
          </select>
          {venue === "alpaca" && effectiveTickerChoice === OTHER_TICKER ? (
            <input className={styles.input} placeholder="Ticker e.g. ORCL" value={customTicker} onChange={(event) => setCustomTicker(event.target.value)} />
          ) : null}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="trade-amount">{side === "buy" ? "Spend (USD)" : "Receive (USD)"}</label>
          <input id="trade-amount" className={styles.input} inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value.replace(/[^0-9.]/g, "")); setQuote(null); }} />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={getQuote} disabled={!canAct}>{busy === "quote" ? "Pricing…" : "Get quote"}</button>
        </div>
        {quoteError ? <p className={styles.error} style={{ marginTop: 8 }}>{quoteError}</p> : null}
      </div>

      <div className={styles.card}>
        <h3 className={styles.title} style={{ fontSize: 15 }}>{side === "buy" ? "Confirm buy" : "Confirm sell"}</h3>
        <p className={styles.subtitle}>
          {venue === "xstocks"
            ? "On-chain swap via Jupiter, signed by this agent's local Solana wallet."
            : paper ? "Alpaca paper trade — simulated, no real money moves." : "Alpaca LIVE brokerage order — real money."}
        </p>

        <div style={{ marginTop: 12 }}>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Action</span><span className={styles.reviewVal}>{side === "buy" ? "Buy" : "Sell"} {ticker || "—"}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>{side === "buy" ? "Spend" : "Proceeds"}</span><span className={styles.reviewVal}>${notionalUsd.toFixed(2)}</span></div>
          {quote?.priceImpactPct != null ? (
            <div className={styles.reviewLine}><span className={styles.reviewKey}>Price impact</span><span className={styles.reviewVal}>{(quote.priceImpactPct * 100).toFixed(2)}%</span></div>
          ) : null}
          {quote ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Quote</span><span className={styles.reviewVal}>{quote.detail}</span></div> : null}
        </div>

        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button
            type="button"
            className={`${styles.btn} ${side === "buy" ? styles.btnPrimary : styles.btnDanger}`}
            onClick={submit}
            disabled={!canAct}
          >
            {busy === "execute" ? "Submitting…" : side === "buy" ? `Buy ${ticker || ""}`.trim() : `Sell ${ticker || ""}`.trim()}
          </button>
        </div>

        {error ? <p className={styles.error} style={{ marginTop: 10 }}>{error}</p> : null}
        {result ? (
          <div style={{ marginTop: 10 }}>
            <p className={styles.success}>{result.detail}</p>
            <p className={styles.note} style={{ marginTop: 4 }}>Reference: <span className={styles.mono}>{result.reference}</span></p>
            {setActiveView ? (
              <div className={styles.actions}>
                <button type="button" className={styles.btn} onClick={() => setActiveView("wallet")}>View in Wallets · Activity</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
