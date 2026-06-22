"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import styles from "./trade.module.css";
import { COMMON_ALPACA_TICKERS } from "./trade-intents";
import {
  type AlpacaPortfolio,
  type StockQuote,
  type StockTradeResult,
  type StockVenue,
  type TradingReadiness,
  executeStockTrade,
  fetchStockPortfolio,
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
  // Paper toggle defaults ON: the safe simulated sandbox. Only a live-enabled
  // agent can turn it off (server enforces this too — see resolveEffectivePaper).
  const [paperToggle, setPaperToggle] = useState(true);
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [busy, setBusy] = useState<"quote" | "execute" | null>(null);
  const [result, setResult] = useState<StockTradeResult | null>(null);
  const [error, setError] = useState("");
  const [portfolio, setPortfolio] = useState<AlpacaPortfolio | null>(null);
  const [portfolioBusy, setPortfolioBusy] = useState(false);
  const [portfolioError, setPortfolioError] = useState("");

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
  // Live brokerage is reachable only when the persisted wallet opted in.
  const liveEnabled = tradeAgent?.liveEnabled ?? (wallet?.alpacaPaper === false);
  // Effective account mode: paper-only agents are pinned to paper regardless of the toggle.
  const paper = liveEnabled ? paperToggle : true;

  const alpaca = readiness?.venues.alpaca;
  const paperConfigured = alpaca?.paper.configured ?? false;
  const liveConfigured = alpaca?.live.configured ?? false;
  const paperKeys = alpaca?.paper.keys ?? ["ALPACA_PAPER_API_KEY_ID", "ALPACA_PAPER_API_SECRET_KEY"];
  const liveKeys = alpaca?.live.keys ?? ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"];
  const xstockTickers = readiness?.venues.xstocks.supportedTickers ?? [];
  // Alpaca needs the mode-correct keys; xStocks is keyless (signs from the agent's Solana wallet).
  const venueReady = venue === "alpaca" ? (paper ? paperConfigured : liveConfigured) : true;

  const tickerOptions = venue === "xstocks" ? xstockTickers : COMMON_ALPACA_TICKERS;
  // Derive a valid selection rather than resetting state in an effect: if the
  // current pick isn't in this venue's option set, fall back to the first option.
  const effectiveTickerChoice = tickerChoice && (tickerOptions.includes(tickerChoice) || tickerChoice === OTHER_TICKER)
    ? tickerChoice
    : (tickerOptions[0] ?? "");
  const ticker = effectiveTickerChoice === OTHER_TICKER ? customTicker.trim().toUpperCase() : effectiveTickerChoice;

  const notionalUsd = Number(amount) || 0;
  const canAct = Boolean(venue) && venueReady && Boolean(ticker) && notionalUsd > 0 && !busy;

  const applyPortfolioResponse = useCallback((response: Awaited<ReturnType<typeof fetchStockPortfolio>>) => {
    if (!response.ok) {
      setPortfolio(null);
      setPortfolioError(response.error || "Could not load the portfolio.");
      return;
    }
    setPortfolioError("");
    setPortfolio(response.portfolio ?? null);
  }, []);

  // Manual refresh (button / post-trade) — shows the busy state. Safe to set
  // state synchronously here because it runs from an event, not an effect.
  const refreshPortfolio = useCallback(async () => {
    if (venue !== "alpaca" || !venueReady) return;
    setPortfolioBusy(true);
    const response = await fetchStockPortfolio(agentId, paper);
    setPortfolioBusy(false);
    applyPortfolioResponse(response);
  }, [agentId, paper, venue, venueReady, applyPortfolioResponse]);

  // Auto-load when the agent or paper/live mode changes. State is only ever set
  // asynchronously (in the resolution or a deferred microtask) so the effect
  // never triggers a cascading synchronous render.
  useEffect(() => {
    let ignore = false;
    if (venue !== "alpaca" || !venueReady) {
      Promise.resolve().then(() => { if (!ignore) setPortfolio(null); });
      return () => { ignore = true; };
    }
    void fetchStockPortfolio(agentId, paper).then((response) => {
      if (!ignore) applyPortfolioResponse(response);
    });
    return () => { ignore = true; };
  }, [agentId, paper, venue, venueReady, applyPortfolioResponse]);

  const getQuote = useCallback(async () => {
    if (!canAct) return;
    setBusy("quote");
    setQuoteError("");
    setQuote(null);
    setResult(null);
    const response = await quoteStockTrade({ agentId, side, ticker, notionalUsd, paper });
    setBusy(null);
    if (!response.ok || !response.quote) {
      setQuoteError(response.error || "Could not price this trade.");
      return;
    }
    setQuote(response.quote);
  }, [agentId, side, ticker, notionalUsd, paper, canAct]);

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
    const response = await executeStockTrade({ agentId, side, ticker, notionalUsd, confirmation, paper });
    setBusy(null);
    if (!response.ok || !response.result) {
      setError(response.error || "Trade failed.");
      return;
    }
    setResult(response.result);
    setQuote(null);
    void refreshPortfolio();
  }, [agentId, side, ticker, notionalUsd, paper, canAct, readiness, refreshPortfolio]);

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

  const setupKeys = paper ? paperKeys : liveKeys;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
              {venue === "alpaca" && !venueReady ? <span className={`${styles.badge} ${styles.badgeSetup}`}>Set Alpaca {paper ? "paper" : "live"} keys</span> : null}
            </div>
          </div>

          {venue === "alpaca" ? (
            <div className={styles.switchRow}>
              <div className={styles.switchLabel}>
                <span className={styles.switchTitle}>Paper trading {paper ? "on" : "off"}</span>
                <span className={styles.switchHint}>
                  {paper
                    ? "Simulated orders against your Alpaca paper account — no real money moves."
                    : "LIVE brokerage — real orders with real money."}
                  {!liveEnabled ? " This agent is paper-only; enable live in its wallet settings to go live." : ""}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={paper}
                aria-label="Toggle paper trading"
                className={styles.switch}
                data-on={paper ? "" : undefined}
                disabled={!liveEnabled || Boolean(busy)}
                onClick={() => { setPaperToggle((on) => !on); setQuote(null); setResult(null); setError(""); }}
              >
                <span className={styles.switchThumb} />
              </button>
            </div>
          ) : null}

          {venue === "alpaca" && !venueReady ? (
            <div className={styles.warnCard} style={{ marginTop: 8 }}>
              Alpaca {paper ? "paper" : "live"} isn&apos;t set up. Add{" "}
              {setupKeys.map((key, index) => (
                <span key={key}>{index > 0 ? " and " : ""}<span className={styles.mono}>{key}</span></span>
              ))}{" "}
              to the shared env to enable {paper ? "paper (simulated)" : "LIVE brokerage"} orders.
              {paper ? " (Alpaca issues separate keys for paper vs live.)" : ""}
              {setActiveView ? <> <button type="button" className={styles.btn} style={{ marginLeft: 8, padding: "4px 10px" }} onClick={() => setActiveView("env")}>Open Env</button></> : null}
            </div>
          ) : null}

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
            {venue === "alpaca" ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Account</span><span className={styles.reviewVal}>{paper ? "Paper (simulated)" : "LIVE brokerage"}</span></div> : null}
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

      {venue === "alpaca" ? (
        <div className={styles.card}>
          <div className={styles.headerRow}>
            <div>
              <h3 className={styles.title} style={{ fontSize: 15 }}>{paper ? "Paper portfolio" : "Live portfolio"}</h3>
              <p className={styles.subtitle}>
                {paper ? "Your Alpaca paper account — simulated balances and positions." : "Your Alpaca live brokerage account."}
              </p>
            </div>
            <button type="button" className={styles.btn} style={{ padding: "6px 12px" }} onClick={() => void refreshPortfolio()} disabled={portfolioBusy || !venueReady}>
              {portfolioBusy ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {!venueReady ? (
            <p className={styles.note} style={{ marginTop: 8 }}>Add the Alpaca {paper ? "paper" : "live"} keys above to load this portfolio.</p>
          ) : portfolioError ? (
            <p className={styles.error} style={{ marginTop: 8 }}>{portfolioError}</p>
          ) : portfolio ? (
            <>
              <div className={styles.accountGrid}>
                <div className={styles.accountStat}><span className={styles.accountStatVal}>${portfolio.account.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span className={styles.accountStatKey}>Portfolio value</span></div>
                <div className={styles.accountStat}><span className={styles.accountStatVal}>${portfolio.account.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span className={styles.accountStatKey}>Equity</span></div>
                <div className={styles.accountStat}><span className={styles.accountStatVal}>${portfolio.account.cash.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span className={styles.accountStatKey}>Cash</span></div>
                <div className={styles.accountStat}><span className={styles.accountStatVal}>${portfolio.account.buyingPower.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span><span className={styles.accountStatKey}>Buying power</span></div>
              </div>
              {portfolio.positions.length > 0 ? (
                <div className={styles.posTable}>
                  <div className={styles.posHead}>
                    <span>Position</span>
                    <span className={styles.num}>Qty</span>
                    <span className={styles.num}>Market value</span>
                    <span className={styles.num}>Unrealized P/L</span>
                  </div>
                  {portfolio.positions.map((position) => {
                    const up = position.unrealizedPlUsd >= 0;
                    return (
                      <div key={position.symbol} className={styles.posRow}>
                        <span className={styles.posSym}>{position.symbol}</span>
                        <span className={styles.num}>{position.qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                        <span className={styles.num}>${position.marketValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        <span className={`${styles.num} ${up ? styles.gain : styles.loss}`}>
                          {up ? "+" : "−"}${Math.abs(position.unrealizedPlUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })} ({(position.unrealizedPlPct * 100).toFixed(2)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={styles.note} style={{ marginTop: 10 }}>No open positions in this {paper ? "paper" : "live"} account yet.</p>
              )}
              <p className={styles.note} style={{ marginTop: 10 }}>Account status: <span className={styles.mono}>{portfolio.account.status}</span></p>
            </>
          ) : (
            <p className={styles.note} style={{ marginTop: 8 }}>Loading portfolio…</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
