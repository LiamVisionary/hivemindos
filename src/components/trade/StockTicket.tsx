"use client";

/* StockTicket — the redesigned equities order ticket, wired to the REAL Alpaca /
   xStocks rail (quote + execute through /api/trading, governance + CONFIRM_BUY /
   CONFIRM_SELL enforced server-side). The Alpaca paper/live toggle is honored
   (a paper-only agent can never escalate to live — the server pins it too).

   Scope note: this rail places MARKET orders. The drop-in's market/limit toggle
   is intentionally omitted rather than shown as a non-functional control — adding
   a limit order type to the governed brokerage path (notional-vs-qty rules, GTC,
   approval) is a separate change, not part of this UI swap. */

import React from "react";
import { Badge, AssetMenu, ReviewLine } from "./primitives";
import { BIcon } from "./icons";
import { trUsd, trUsd2, trPct } from "./format";
import { useTradeDesk } from "./trade-context";
import { COMMON_ALPACA_TICKERS } from "@/features/dashboard/views/trade/trade-intents";
import { executeStockTrade, fetchStockMarket } from "@/features/dashboard/views/trade/trade-api";

const OTHER = "__other__";

export function StockTicket() {
  const desk = useTradeDesk();
  const { agentId, paper, setPaper, stockReadiness: r, onOpenView } = desk;
  const venue = r.venue;
  const isXstocks = venue === "xstocks";
  const tickerOptions = isXstocks ? (r.xstockTickers.length ? r.xstockTickers : ["AAPLx"]) : COMMON_ALPACA_TICKERS;

  const [side, setSide] = React.useState<"buy" | "sell">("buy");
  const [choice, setChoice] = React.useState(tickerOptions[0] ?? "NVDA");
  const [custom, setCustom] = React.useState("");
  const [shares, setShares] = React.useState("");
  const [usd, setUsd] = React.useState("25");
  const [price, setPrice] = React.useState<{ price: number; chg: number } | null>(null);
  const [state, setState] = React.useState<"idle" | "signing" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");

  const ticker = choice === OTHER ? custom.trim().toUpperCase() : choice;

  // Real last price + 24h change for the selected Alpaca ticker (drives the cost
  // estimate + the %-of-buying-power chips). xStocks isn't on Alpaca data.
  React.useEffect(() => {
    let ignore = false;
    if (isXstocks || !ticker) {
      // Clear asynchronously so the effect never sets state synchronously.
      Promise.resolve().then(() => { if (!ignore) setPrice(null); });
      return () => { ignore = true; };
    }
    void fetchStockMarket([ticker], paper, "24h", false).then((response) => {
      if (ignore) return;
      const row = response.ok && response.rows ? response.rows.find((x) => x.symbol === ticker) : undefined;
      setPrice(row ? { price: row.price, chg: row.change24h } : null);
    });
    return () => { ignore = true; };
  }, [ticker, isXstocks, paper]);

  const px = price?.price || 0;
  const sharesNum = Number(shares) || 0;
  const usdNum = Number(usd) || 0;
  const buyingPower = r.buyingPower;
  // Alpaca → share-count order; xStocks → USD notional swap.
  const notionalUsd = isXstocks ? usdNum : (px > 0 ? sharesNum * px : 0);
  const overBp = side === "buy" && buyingPower > 0 && notionalUsd > buyingPower;
  const canAct = Boolean(venue) && r.venueReady && Boolean(ticker) && notionalUsd > 0 && state !== "signing";

  const place = async () => {
    if (!canAct) return;
    const confirmation = r.confirmations[side];
    if (!confirmation) { setMessage("Missing confirmation token — reload the Trade tab."); setState("error"); return; }
    setState("signing");
    setMessage("");
    const response = await executeStockTrade({
      agentId, side, ticker, notionalUsd,
      confirmation, paper,
      // Buys place by NOTIONAL so the per-trade cap, rolling spend budget, and
      // live platform fee bind to the exact USD submitted — a qty order lets a
      // stale client price under-state the gated notional. Sells keep the exact
      // share count (a sell is an inflow, not budget-gated), so "sell N" is exact.
      ...(!isXstocks && side === "sell" ? { qty: sharesNum } : {}),
    });
    if (!response.ok || !response.result) { setState("error"); setMessage(response.error || "Trade failed."); return; }
    setState("done");
    setMessage(response.result.detail);
    desk.refresh();
  };

  React.useEffect(() => {
    if (state !== "done") return;
    const timer = window.setTimeout(() => { setState("idle"); setMessage(""); }, 4500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const sell = side === "sell";
  const label = state === "signing" ? "Submitting…" : state === "done" ? "Order placed"
    : !ticker ? "Pick a ticker" : !notionalUsd ? (isXstocks ? "Enter an amount" : "Enter share count")
    : isXstocks ? `${sell ? "Sell" : "Buy"} ${trUsd2(usdNum)} ${ticker}` : `${sell ? "Sell" : "Buy"} ${sharesNum} ${ticker}`;

  if (!venue) {
    return (
      <div className="tk-card">
        <div className="tk-guard"><BIcon name="alert" size={14} /><span>Stock trading is off for this wallet. Set a trading venue (Alpaca or xStocks) in its wallet settings to enable buying and selling.</span></div>
        <button type="button" className="tk-place" style={{ marginTop: 14 }} onClick={() => onOpenView("wallet")}>Open Wallets</button>
      </div>
    );
  }

  return (
    <div className="tk-card">
      <div className="tk-head">
        <div className="tk-side">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} type="button" data-active={side === s ? "" : undefined} data-sell={side === s && s === "sell" ? "" : undefined}
              onClick={() => { setSide(s); setState("idle"); setMessage(""); }}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        {venue === "alpaca" ? (
          <div className="dk-pl" role="radiogroup" aria-label="Account mode">
            <button type="button" data-active={paper ? "" : undefined} onClick={() => setPaper(true)}>Paper</button>
            <button type="button" data-active={!paper ? "" : undefined} data-live={!paper ? "" : undefined} disabled={!r.liveEnabled} onClick={() => setPaper(false)}>Live</button>
          </div>
        ) : <Badge tone="honey">xStocks · Solana</Badge>}
      </div>

      <div className="tk-leg">
        <div className="lhead"><span>Symbol</span><span className="bal">{isXstocks ? "On-chain · Jupiter" : price ? `Last ${trUsd2(px)}` : "—"}</span></div>
        <div className="tk-legrow">
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 19, letterSpacing: "-0.01em" }}>{ticker || "—"}</div>
            {price ? <div className="tk-usd" style={{ marginTop: 3, color: price.chg < 0 ? "var(--danger)" : "var(--live)" }}>{trPct(price.chg)} today</div> : null}
          </div>
          <AssetMenu value={choice === OTHER ? "Other" : choice} options={[...tickerOptions, ...(venue === "alpaca" ? [OTHER] : [])]}
            getName={(s) => (s === OTHER ? "Custom ticker" : s)} onPick={(s) => { setChoice(s); setState("idle"); }} stock />
        </div>
        {choice === OTHER ? (
          <input className="fb-field" style={{ marginTop: 10 }} placeholder="Ticker e.g. ORCL" value={custom} onChange={(e) => setCustom(e.target.value.toUpperCase())} />
        ) : null}
      </div>

      <div className="tk-leg" style={{ marginTop: 12 }}>
        <div className="lhead"><span>{isXstocks ? (sell ? "Proceeds (USD)" : "Spend (USD)") : (sell ? "Shares to sell" : "Shares to buy")}</span>
          <span className="bal">{venue === "alpaca" ? `${paper ? "Paper" : "LIVE"} · BP ${trUsd(buyingPower, true)}` : ""}</span></div>
        <div className="tk-legrow">
          {isXstocks ? (
            <input className="tk-input" inputMode="decimal" placeholder="0" value={usd}
              onChange={(e) => { setUsd(e.target.value.replace(/[^0-9.]/g, "")); setState("idle"); }} aria-label="USD amount" />
          ) : (
            <input className="tk-input" inputMode="decimal" placeholder="0" value={shares}
              onChange={(e) => { setShares(e.target.value.replace(/[^0-9.]/g, "")); setState("idle"); }} aria-label="Share count" />
          )}
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-3)" }}>{isXstocks ? "USD" : "shares"}</span>
        </div>
        <div className="tk-usd">≈ {trUsd2(notionalUsd)} at market</div>
        {!isXstocks && !sell && px > 0 ? (
          <div className="tk-chips">
            {([[0.1, "10%"], [0.25, "25%"], [0.5, "50%"]] as const).map(([p, l]) => (
              <button key={l} type="button" onClick={() => setShares(String(Math.max(0, Math.floor((buyingPower * p) / px))))}>{l} BP</button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="tk-review">
        <ReviewLine k="Order type" v="Market" />
        {!isXstocks && px > 0 ? <ReviewLine k="Est. price" v={trUsd2(px)} /> : null}
        <ReviewLine k="Est. cost" v={trUsd2(notionalUsd)} />
        {venue === "alpaca" ? <ReviewLine k="Buying power" v={trUsd(buyingPower, true)} icon="wallet" live /> : null}
        <ReviewLine k="Account" v={isXstocks ? "On-chain · xStocks" : paper ? "Paper (simulated)" : "LIVE brokerage"} />
      </div>

      {!r.venueReady && venue === "alpaca" ? (
        <div className="tk-guard">
          <BIcon name="alert" size={14} />
          <span>Alpaca {paper ? "paper" : "live"} keys aren&apos;t set ({(paper ? r.paperKeys : r.liveKeys).join(" · ")}). Add them to enable {paper ? "paper" : "LIVE"} orders.</span>
        </div>
      ) : overBp ? (
        <div className="tk-guard" data-danger><BIcon name="alert" size={14} /><span>Cost exceeds {trUsd(buyingPower)} buying power. Reduce the order or fund the account.</span></div>
      ) : null}

      <button type="button" className="tk-place" data-sell={sell && state === "idle" ? "" : undefined} data-done={state === "done" ? "" : undefined}
        disabled={!canAct || overBp} onClick={place}>
        {state === "signing" ? <BIcon name="refresh" size={15} /> : state === "done" ? <BIcon name="check" size={15} /> : null}
        {label}
      </button>
      <div className="tk-foot"><BIcon name="shield" size={12} /> {isXstocks ? "On-chain swap · signed by this wallet" : paper ? "Paper account · Alpaca sandbox" : "LIVE · Alpaca brokerage"}</div>

      {!r.venueReady && venue === "alpaca" ? (
        <div style={{ marginTop: 10, textAlign: "center" }}><button type="button" className="fw-manage" onClick={() => onOpenView("env")}>Open Env to add Alpaca keys →</button></div>
      ) : null}
      {state === "error" && message ? <p className="tk-error">{message}</p> : null}
      {state === "done" && message ? (
        <div className="tk-success">{message}
          <div style={{ marginTop: 6 }}><button type="button" className="fw-manage" onClick={() => onOpenView("wallet")}>View in Wallets · Activity →</button></div>
        </div>
      ) : null}
    </div>
  );
}
