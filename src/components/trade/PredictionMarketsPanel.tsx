"use client";

import React from "react";

import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import type {
  PredictionComplementArbitrageQuote,
  PredictionEvent,
  PredictionMarket,
  PredictionOrderBook,
  PredictionOutcome,
  PredictionPaperOrder,
  PredictionPricePoint,
  PredictionTraderProfile,
} from "@/lib/services/trading/prediction-markets";
import styles from "./PredictionMarketsPanel.module.css";

type Mode = "markets" | "arbitrage" | "traders" | "weather";
type ApiPayload = {
  ok?: boolean;
  events?: PredictionEvent[];
  book?: PredictionOrderBook;
  history?: PredictionPricePoint[];
  trader?: PredictionTraderProfile;
  order?: PredictionPaperOrder;
  probability?: number;
  quotes?: PredictionComplementArbitrageQuote[];
  error?: string;
};

const PAPER_LEDGER_KEY = "trade.prediction.paperLedger.v1";

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortAddress(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function parseLedger(raw: string): PredictionPaperOrder[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is PredictionPaperOrder => Boolean(item && typeof item === "object")) : [];
  } catch {
    return [];
  }
}

async function api(url: string, init?: RequestInit): Promise<ApiPayload> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as ApiPayload;
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Prediction-market request failed.");
  return payload;
}

function PriceLine({ points }: { points: PredictionPricePoint[] }) {
  if (points.length < 2) return <div className={styles.emptyChart}>Price history is not available for this outcome yet.</div>;
  const sampled = points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 80)) === 0).slice(-80);
  const coordinates = sampled.map((point, index) => {
    const x = sampled.length === 1 ? 0 : index / (sampled.length - 1) * 100;
    const y = 36 - point.price * 34;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg className={styles.chart} viewBox="0 0 100 38" preserveAspectRatio="none" role="img" aria-label="Outcome price history">
      <polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MarketExplorer({
  events,
  selectedMarket,
  selectedOutcome,
  book,
  history,
  loading,
  onSelectMarket,
  onSelectOutcome,
}: {
  events: PredictionEvent[];
  selectedMarket: PredictionMarket | null;
  selectedOutcome: PredictionOutcome | null;
  book: PredictionOrderBook | null;
  history: PredictionPricePoint[];
  loading: boolean;
  onSelectMarket: (market: PredictionMarket) => void;
  onSelectOutcome: (outcome: PredictionOutcome) => void;
}) {
  return (
    <div className={styles.explorer}>
      <section className={styles.marketList} aria-label="Prediction markets">
        {loading ? Array.from({ length: 6 }, (_, index) => <span className={styles.skeleton} key={index} />) : null}
        {!loading && !events.length ? <p className={styles.empty}>No active markets matched that search.</p> : null}
        {events.flatMap((event) => event.markets.slice(0, 4).map((market) => (
          <button
            type="button"
            className={styles.marketRow}
            data-active={selectedMarket?.id === market.id ? "" : undefined}
            onClick={() => onSelectMarket(market)}
            key={market.id}
          >
            <span>
              <b>{market.title}</b>
              <small>{event.title !== market.title ? event.title : market.category || "Prediction market"}</small>
            </span>
            <span className={styles.odds}>{market.outcomes[0] ? pct(market.outcomes[0].price) : "—"}</span>
            <small className={styles.volume}>${compact(market.volume24h)} 24h</small>
          </button>
        )))}
      </section>

      <section className={styles.marketDetail}>
        {!selectedMarket ? <p className={styles.empty}>Select a market to inspect its price, depth, and paper trade.</p> : (
          <>
            <div className={styles.detailHeading}>
              <div>
                <span className={styles.eyebrow}>Polymarket · public data</span>
                <h2>{selectedMarket.title}</h2>
              </div>
              <a href={selectedMarket.url} target="_blank" rel="noreferrer">Resolution rules ↗</a>
            </div>
            <div className={styles.outcomes}>
              {selectedMarket.outcomes.map((outcome) => (
                <button type="button" key={outcome.id} data-active={selectedOutcome?.id === outcome.id ? "" : undefined} onClick={() => onSelectOutcome(outcome)}>
                  <span>{outcome.label}</span><b>{pct(outcome.price)}</b>
                </button>
              ))}
            </div>
            <PriceLine points={history} />
            <div className={styles.marketStats}>
              <span><small>24h volume</small><b>{usd(selectedMarket.volume24h)}</b></span>
              <span><small>Liquidity</small><b>{usd(selectedMarket.liquidity)}</b></span>
              <span><small>Best bid</small><b>{book?.bids[0] ? pct(book.bids[0].price) : "—"}</b></span>
              <span><small>Best ask</small><b>{book?.asks[0] ? pct(book.asks[0].price) : "—"}</b></span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function PredictionMarketsPanel() {
  const [mode, setMode] = React.useState<Mode>("markets");
  const [query, setQuery] = React.useState("");
  const [events, setEvents] = React.useState<PredictionEvent[]>([]);
  const [selectedMarket, setSelectedMarket] = React.useState<PredictionMarket | null>(null);
  const [selectedOutcome, setSelectedOutcome] = React.useState<PredictionOutcome | null>(null);
  const [book, setBook] = React.useState<PredictionOrderBook | null>(null);
  const [history, setHistory] = React.useState<PredictionPricePoint[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [paperAmount, setPaperAmount] = React.useState("25");
  const [paperSide, setPaperSide] = React.useState<"buy" | "sell">("buy");
  const [paperBusy, setPaperBusy] = React.useState(false);
  const [savedLedger, rememberLedger] = useRememberedDashboardValue(PAPER_LEDGER_KEY, "[]");
  const ledger = React.useMemo(() => parseLedger(savedLedger), [savedLedger]);
  const [traderAddress, setTraderAddress] = React.useState("");
  const [trader, setTrader] = React.useState<PredictionTraderProfile | null>(null);
  const [traderBusy, setTraderBusy] = React.useState(false);
  const [forecast, setForecast] = React.useState("72");
  const [low, setLow] = React.useState("70");
  const [high, setHigh] = React.useState("74");
  const [uncertainty, setUncertainty] = React.useState("2");
  const [weatherProbability, setWeatherProbability] = React.useState<number | null>(null);
  const [arbitrageBankroll, setArbitrageBankroll] = React.useState("100");
  const [arbitrageQuotes, setArbitrageQuotes] = React.useState<PredictionComplementArbitrageQuote[]>([]);
  const [arbitrageBusy, setArbitrageBusy] = React.useState(false);

  const loadEvents = React.useCallback((search = "") => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ action: "events", limit: "12" });
    if (search.trim()) params.set("q", search.trim());
    api(`/api/trading/prediction?${params}`)
      .then((payload) => {
        const nextEvents = payload.events ?? [];
        setEvents(nextEvents);
        const nextMarket = nextEvents.flatMap((event) => event.markets)[0] ?? null;
        const nextOutcome = nextMarket?.outcomes[0] ?? null;
        setSelectedMarket(nextMarket);
        setSelectedOutcome(nextOutcome);
        setDetailLoading(Boolean(nextOutcome));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Markets are unavailable."))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    void Promise.resolve().then(() => loadEvents());
  }, [loadEvents]);

  React.useEffect(() => {
    if (!selectedOutcome || !/^\d{10,}$/.test(selectedOutcome.id)) {
      return;
    }
    let active = true;
    Promise.all([
      api(`/api/trading/prediction?action=book&outcomeId=${encodeURIComponent(selectedOutcome.id)}`),
      api(`/api/trading/prediction?action=history&outcomeId=${encodeURIComponent(selectedOutcome.id)}`),
    ]).then(([bookPayload, historyPayload]) => {
      if (!active) return;
      setBook(bookPayload.book ?? null);
      setHistory(historyPayload.history ?? []);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Market detail is unavailable.");
    }).finally(() => {
      if (active) setDetailLoading(false);
    });
    return () => { active = false; };
  }, [selectedOutcome]);

  const chooseMarket = (market: PredictionMarket) => {
    setSelectedMarket(market);
    setSelectedOutcome(market.outcomes[0] ?? null);
    setBook(null);
    setHistory([]);
    setDetailLoading(Boolean(market.outcomes[0]));
  };

  const chooseOutcome = (outcome: PredictionOutcome) => {
    setSelectedOutcome(outcome);
    setBook(null);
    setHistory([]);
    setDetailLoading(true);
  };

  async function paperTrade() {
    if (!selectedMarket || !selectedOutcome) return;
    setPaperBusy(true);
    setError("");
    try {
      const payload = await api("/api/trading/prediction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "paper-order",
          market: selectedMarket,
          outcome: selectedOutcome,
          side: paperSide,
          notionalUsd: Number(paperAmount),
          book,
        }),
      });
      if (!payload.order) throw new Error("The server did not return a paper fill.");
      rememberLedger(JSON.stringify([payload.order, ...ledger].slice(0, 100)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Paper order failed.");
    } finally {
      setPaperBusy(false);
    }
  }

  async function inspectTrader() {
    setTraderBusy(true);
    setError("");
    try {
      const payload = await api(`/api/trading/prediction?action=trader&address=${encodeURIComponent(traderAddress.trim())}`);
      setTrader(payload.trader ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Trader analysis failed.");
    } finally {
      setTraderBusy(false);
    }
  }

  async function calculateWeather() {
    setError("");
    try {
      const payload = await api("/api/trading/prediction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "weather-probability",
          forecast: Number(forecast),
          low: low.trim() ? Number(low) : undefined,
          high: high.trim() ? Number(high) : undefined,
          uncertainty: Number(uncertainty),
        }),
      });
      setWeatherProbability(payload.probability ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Weather scenario failed.");
    }
  }

  async function scanArbitrage() {
    setArbitrageBusy(true);
    setError("");
    try {
      const payload = await api("/api/trading/prediction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "btc-complement-arbitrage",
          bankrollUsd: Number(arbitrageBankroll),
        }),
      });
      setArbitrageQuotes(payload.quotes ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Arbitrage paper scan failed.");
    } finally {
      setArbitrageBusy(false);
    }
  }

  const paperExposure = ledger.reduce((sum, order) => sum + (order.side === "buy" ? order.notionalUsd : -order.notionalUsd), 0);

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Prediction intelligence</span>
          <h1>Read the odds. Test the thesis.</h1>
          <p>Live public market data, paper execution, wallet intelligence, and weather probability—without handing a local client live-trading authority.</p>
        </div>
        <div className={styles.modeTabs}>
          <button type="button" data-active={mode === "markets" ? "" : undefined} onClick={() => setMode("markets")}>Markets</button>
          <button type="button" data-active={mode === "arbitrage" ? "" : undefined} onClick={() => setMode("arbitrage")}>Arbitrage</button>
          <button type="button" data-active={mode === "traders" ? "" : undefined} onClick={() => setMode("traders")}>Traders</button>
          <button type="button" data-active={mode === "weather" ? "" : undefined} onClick={() => setMode("weather")}>Weather</button>
        </div>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {mode === "markets" ? (
        <>
          <form className={styles.search} onSubmit={(event) => { event.preventDefault(); loadEvents(query); }}>
            <label htmlFor="prediction-search">Search active markets</label>
            <div><input id="prediction-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Fed, bitcoin, elections, weather…" /><button type="submit">Search</button></div>
          </form>
          <MarketExplorer
            events={events}
            selectedMarket={selectedMarket}
            selectedOutcome={selectedOutcome}
            book={book}
            history={history}
            loading={loading || detailLoading}
            onSelectMarket={chooseMarket}
            onSelectOutcome={chooseOutcome}
          />
          <div className={styles.bottomGrid}>
            <section className={styles.paper}>
              <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Paper ticket</span><h2>Simulate the order</h2></div><span className={styles.safeBadge}>No live funds</span></div>
              <p>{selectedOutcome ? `${selectedOutcome.label} at ${pct(selectedOutcome.price)}` : "Select an outcome first."}</p>
              <div className={styles.ticketRow}>
                <span className={styles.sideToggle}><button type="button" data-active={paperSide === "buy" ? "" : undefined} onClick={() => setPaperSide("buy")}>Buy</button><button type="button" data-active={paperSide === "sell" ? "" : undefined} onClick={() => setPaperSide("sell")}>Sell</button></span>
                <label>Notional USD<input inputMode="decimal" value={paperAmount} onChange={(event) => setPaperAmount(event.target.value)} /></label>
                <button type="button" className={styles.primary} onClick={() => void paperTrade()} disabled={!selectedOutcome || paperBusy}>{paperBusy ? "Filling…" : "Paper fill"}</button>
              </div>
              <small>Uses the best visible quote plus 10 bps modeled slippage. It never signs or submits a CLOB order.</small>
            </section>
            <section className={styles.ledger}>
              <div className={styles.cardHeading}><div><span className={styles.eyebrow}>Practice book</span><h2>{usd(paperExposure)} net exposure</h2></div><span>{ledger.length} fills</span></div>
              {ledger.length ? ledger.slice(0, 4).map((order) => (
                <article key={order.id}><span><b>{order.side.toUpperCase()} {order.outcome}</b><small>{order.title}</small></span><span><b>{usd(order.notionalUsd)}</b><small>@ {pct(order.fillPrice)}</small></span></article>
              )) : <p className={styles.empty}>Your paper fills will persist with the dashboard state.</p>}
            </section>
          </div>
        </>
      ) : null}

      {mode === "arbitrage" ? (
        <section className={styles.toolCard}>
          <div className={styles.cardHeading}>
            <div>
              <span className={styles.eyebrow}>BTC paired paper lab</span>
              <h2>Does Up + Down survive execution?</h2>
            </div>
            <span className={styles.safeBadge}>No live funds</span>
          </div>
          <p>
            Scans the current 5-minute and 15-minute BTC markets. Both books arrive in one batch,
            the model buys equal shares only, walks at most 25% of displayed ask depth, and charges
            the market&apos;s fee curve on both legs.
          </p>
          <div className={styles.toolForm}>
            <input
              aria-label="Paper bankroll in USD"
              inputMode="decimal"
              value={arbitrageBankroll}
              onChange={(event) => setArbitrageBankroll(event.target.value)}
              placeholder="Paper bankroll in USD"
            />
            <button type="button" onClick={() => void scanArbitrage()} disabled={arbitrageBusy}>
              {arbitrageBusy ? <><span className={styles.spinner} aria-hidden="true" />Scanning books</> : "Scan live books"}
            </button>
          </div>
          {arbitrageQuotes.length ? (
            <div className={styles.arbitrageGrid}>
              {arbitrageQuotes.map((quote) => (
                <article className={styles.arbitrageCard} data-decision={quote.decision} key={`${quote.marketId}:${quote.observedAt}`}>
                  <div className={styles.cardHeading}>
                    <div>
                      <span className={styles.eyebrow}>{quote.intervalMinutes}-minute market</span>
                      <h3>{quote.outcomeLabels[0]} + {quote.outcomeLabels[1]}</h3>
                    </div>
                    <span>{quote.decision === "paper-filled" ? "Paper fill" : "Rejected"}</span>
                  </div>
                  <div className={styles.arbitrageMetrics}>
                    <span><small>Executable asks</small><b>{quote.bestAsks.map((price) => price == null ? "—" : price.toFixed(3)).join(" + ")}</b></span>
                    <span><small>Ask sum</small><b>{quote.bestCombinedAsk == null ? "—" : quote.bestCombinedAsk.toFixed(3)}</b></span>
                    <span><small>Raw gap</small><b>{quote.rawEdgePerShare == null ? "—" : pct(quote.rawEdgePerShare)}</b></span>
                    <span><small>Two-leg fees</small><b>{quote.takerFeePerShare == null ? "—" : quote.takerFeePerShare.toFixed(4)}</b></span>
                    <span><small>Net edge</small><b>{quote.netEdgePerShare == null ? "—" : pct(quote.netEdgePerShare)}</b></span>
                    <span><small>Book skew</small><b>{quote.snapshotSkewMs == null ? "—" : `${quote.snapshotSkewMs.toFixed(0)} ms`}</b></span>
                  </div>
                  {quote.paperFill ? (
                    <div className={styles.arbitrageFill}>
                      <span><small>Paired shares</small><b>{quote.paperFill.shares.toFixed(2)}</b></span>
                      <span><small>Capital</small><b>{usd(quote.paperFill.capitalUsd)}</b></span>
                      <span><small>Locked payout</small><b>{usd(quote.paperFill.payoutUsd)}</b></span>
                      <span><small>Paper P&amp;L</small><b>{usd(quote.paperFill.pnlUsd)} · {pct(quote.paperFill.roi)}</b></span>
                    </div>
                  ) : null}
                  <p>{quote.reason}</p>
                </article>
              ))}
            </div>
          ) : <p className={styles.empty}>Run a scan to test executable paired asks—not the displayed midpoint prices.</p>}
          <p className={styles.sourceLine}>
            Maker orders can avoid taker fees, but two resting orders are not locked arbitrage: one leg can fill while the other never does.
          </p>
        </section>
      ) : null}

      {mode === "traders" ? (
        <section className={styles.toolCard}>
          <span className={styles.eyebrow}>Public wallet intelligence</span>
          <h2>Inspect a Polymarket trader</h2>
          <p>Group public positions and up to 500 recent activity records by market. Metrics describe the observed sample, not skill or identity.</p>
          <div className={styles.toolForm}><input value={traderAddress} onChange={(event) => setTraderAddress(event.target.value)} placeholder="0x…" /><button type="button" onClick={() => void inspectTrader()} disabled={traderBusy}>{traderBusy ? "Inspecting…" : "Inspect trader"}</button></div>
          {trader ? (
            <>
              <div className={styles.metricGrid}>
                <span><small>Observed trades</small><b>{trader.metrics.tradeCount}</b></span>
                <span><small>Markets</small><b>{trader.metrics.marketCount}</b></span>
                <span><small>Observed notional</small><b>{usd(trader.metrics.totalNotionalUsd)}</b></span>
                <span><small>Open value</small><b>{usd(trader.metrics.currentValueUsd)}</b></span>
                <span><small>Open P&amp;L</small><b>{usd(trader.metrics.cashPnlUsd)}</b></span>
                <span><small>Largest concentration</small><b>{trader.metrics.largestPositionPercent.toFixed(1)}%</b></span>
              </div>
              <p className={styles.sourceLine}>{shortAddress(trader.address)} · public Data API · results may be incomplete</p>
            </>
          ) : null}
        </section>
      ) : null}

      {mode === "weather" ? (
        <section className={styles.toolCard}>
          <span className={styles.eyebrow}>Weather scenario lab</span>
          <h2>Turn a forecast into a bucket probability</h2>
          <p>Model a normally distributed forecast and compare the resulting probability with a prediction-market price. This is a scenario tool, not a meteorological forecast.</p>
          <div className={styles.weatherGrid}>
            <label>Forecast<input inputMode="decimal" value={forecast} onChange={(event) => setForecast(event.target.value)} /></label>
            <label>Bucket low<input inputMode="decimal" value={low} onChange={(event) => setLow(event.target.value)} /></label>
            <label>Bucket high<input inputMode="decimal" value={high} onChange={(event) => setHigh(event.target.value)} /></label>
            <label>Uncertainty σ<input inputMode="decimal" value={uncertainty} onChange={(event) => setUncertainty(event.target.value)} /></label>
          </div>
          <button type="button" className={styles.primary} onClick={() => void calculateWeather()}>Calculate scenario</button>
          {weatherProbability != null ? <div className={styles.weatherResult}><small>Modeled probability</small><b>{pct(weatherProbability)}</b><span>Fair-value price: {weatherProbability.toFixed(3)}</span></div> : null}
        </section>
      ) : null}

      <footer className={styles.boundary}>
        Public reads and paper fills are native here. A live prediction order still uses the governed prepare → confirm → execute capability rail and remains subject to venue eligibility.
      </footer>
    </section>
  );
}

export default PredictionMarketsPanel;
