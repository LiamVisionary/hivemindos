"use client";

/* StockTicket — the redesigned equities order ticket, wired to the REAL stock
   rail (quote + execute through /api/trading, governance + CONFIRM_BUY /
   CONFIRM_SELL enforced server-side). The Alpaca paper/live toggle is honored
   (a paper-only agent can never escalate to live — the server pins it too).

   Market orders stay the beginner default. Alpaca limit, stop, and stop-limit
   settings live inside a collapsed Advanced order section. Every order becomes
   a durable Trade Plan before paper simulation or live submission. */

import React from "react";
import { Badge, AssetMenu, ReviewLine } from "./primitives";
import { BIcon } from "./icons";
import { trUsd, trUsd2, trPct } from "./format";
import { useTradeDesk } from "./trade-context";
import { COMMON_ALPACA_TICKERS } from "@/features/dashboard/views/trade/trade-intents";
import { executeStockTrade, fetchStockMarket, quoteStockTrade } from "@/features/dashboard/views/trade/trade-api";
import { playTradeSuccessSound } from "./trade-sound";
import { TradePlanReviewCard } from "./TradePlanReviewCard";
import { useTradePlanFlow } from "./trading-lifecycle-context";

const OTHER = "__other__";

export function StockTicket() {
  const desk = useTradeDesk();
  const { agentId, paper, setPaper, stockReadiness: r, stockPortfolio, onOpenView, onChangeWallet, onEnableStockVenue, walletKind, isSolanaWallet, network } = desk;
  // Held value (USD) per ticker, shown in the ticker dropdown in the user's
  // display currency (populated only for tickers the user actually holds).
  const usdByTicker = React.useMemo(
    () => Object.fromEntries((stockPortfolio?.rows ?? []).map((row) => [row.sym, row.usd])),
    [stockPortfolio],
  );
  const venue = r.venue;
  const isXstocks = venue === "xstocks";
  const isRobinhoodChain = venue === "robinhood-chain";
  const isRobinhoodAgentic = venue === "robinhood-agentic";
  const isUsdSizedVenue = isXstocks || isRobinhoodChain || isRobinhoodAgentic;
  const tickerOptions = React.useMemo(() => isXstocks
    ? (r.xstockTickers.length ? r.xstockTickers : ["AAPLx"])
    : isRobinhoodChain
      ? (r.robinhoodTickers.length ? r.robinhoodTickers : ["AAPL"])
      : COMMON_ALPACA_TICKERS, [isRobinhoodChain, isXstocks, r.robinhoodTickers, r.xstockTickers]);

  const [side, setSide] = React.useState<"buy" | "sell">("buy");
  const [choice, setChoice] = React.useState(tickerOptions[0] ?? "NVDA");
  const [custom, setCustom] = React.useState("");
  const [shares, setShares] = React.useState("");
  const [usd, setUsd] = React.useState("25");
  const [price, setPrice] = React.useState<{ price: number; chg: number } | null>(null);
  const [state, setState] = React.useState<"idle" | "reviewing" | "signing" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("");
  const [orderType, setOrderType] = React.useState<"market" | "limit" | "stop" | "stop_limit">("market");
  const [timeInForce, setTimeInForce] = React.useState<"day" | "gtc" | "ioc" | "fok">("day");
  const [limitPrice, setLimitPrice] = React.useState("");
  const [stopPrice, setStopPrice] = React.useState("");
  const planFlow = useTradePlanFlow();

  // Inline "Enable stock trading" flow — flips this card to a venue config form
  // (defaulting to Alpaca / Paper) instead of bouncing to the Wallets tab. Once
  // saved, the venue persists on the acting wallet and this guard unmounts as
  // the real order ticket renders.
  const [enableOpen, setEnableOpen] = React.useState(false);
  const [enVenue, setEnVenue] = React.useState<"alpaca" | "robinhood-agentic" | "xstocks" | "robinhood-chain">("alpaca");
  const [enPaper, setEnPaper] = React.useState(true);
  const [enSaving, setEnSaving] = React.useState(false);
  const [enError, setEnError] = React.useState("");
  const importedDraft = desk.initialDraft?.assetClass === "stock" ? desk.initialDraft : null;
  const appliedDraftRef = React.useRef("");
  const sizedDraftRef = React.useRef("");

  React.useEffect(() => {
    if (!importedDraft) return;
    void Promise.resolve().then(() => {
      const key = importedDraft.requestId || JSON.stringify(importedDraft);
      if (appliedDraftRef.current === key) return;
      appliedDraftRef.current = key;
      if (importedDraft.side === "buy" || importedDraft.side === "sell") setSide(importedDraft.side);
      const asset = importedDraft.asset?.trim().toUpperCase();
      if (asset) {
        if (tickerOptions.includes(asset)) setChoice(asset);
        else { setChoice(OTHER); setCustom(asset); }
      }
      if (importedDraft.amountUsd !== undefined) setUsd(String(importedDraft.amountUsd));
      if (importedDraft.quantity !== undefined) setShares(String(importedDraft.quantity));
      setMessage("Imported from X as a draft. Review the live quote, wallet, venue, and confirmation before submitting.");
      setState("idle");
    });
  }, [importedDraft, tickerOptions]);

  const enable = async () => {
    setEnSaving(true);
    setEnError("");
    const result = await onEnableStockVenue({ venue: enVenue, paper: enPaper });
    if (!result.ok) { setEnError(result.error || "Couldn't enable stock trading."); setEnSaving(false); return; }
    // Success: leave the spinner up — the venue flip re-renders this ticket into
    // its tradable state (the `!venue` guard below stops matching), unmounting us.
  };

  const ticker = choice === OTHER ? custom.trim().toUpperCase() : choice;

  // Real last price + 24h change for the selected Alpaca ticker (drives the cost
  // estimate + the %-of-buying-power chips). On-chain stock-token venues are not
  // on Alpaca data.
  React.useEffect(() => {
    let ignore = false;
    if (isUsdSizedVenue || !ticker) {
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
  }, [ticker, isUsdSizedVenue, paper]);

  const px = price?.price || 0;
  const sharesNum = Number(shares) || 0;
  const usdNum = Number(usd) || 0;
  const buyingPower = r.buyingPower;
  // Alpaca -> share-count order; on-chain stock-token venues -> USD notional.
  const advancedReferencePrice = orderType === "limit" || orderType === "stop_limit" ? Number(limitPrice) || 0 : orderType === "stop" ? Number(stopPrice) || 0 : px;
  const notionalUsd = isUsdSizedVenue ? usdNum : (advancedReferencePrice > 0 ? sharesNum * advancedReferencePrice : 0);
  const overBp = side === "buy" && buyingPower > 0 && notionalUsd > buyingPower;
  const canAct = Boolean(venue) && r.venueReady && Boolean(ticker) && notionalUsd > 0 && state !== "signing" && state !== "reviewing";
  const resetPlan = () => { planFlow.clear(); setMessage(""); setState("idle"); };

  React.useEffect(() => {
    if (planFlow.mode === "live") setPaper(false);
    else setPaper(true);
  }, [planFlow.mode, setPaper]);

  React.useEffect(() => {
    if (!importedDraft?.amountUsd || isUsdSizedVenue || px <= 0) return;
    const key = `${importedDraft.requestId || JSON.stringify(importedDraft)}:${ticker}:${px}`;
    if (sizedDraftRef.current === key) return;
    sizedDraftRef.current = key;
    setShares(String(Number((importedDraft.amountUsd / px).toFixed(6))));
  }, [importedDraft, isUsdSizedVenue, px, ticker]);

  const stagePlan = async () => {
    if (!canAct) return;
    setState("reviewing");
    setMessage("");
    const effectiveOrderType = venue === "alpaca" ? orderType : "market";
    const quote = await quoteStockTrade({
      agentId,
      side,
      ticker,
      notionalUsd,
      paper: planFlow.mode !== "live",
      ...(!isUsdSizedVenue && (side === "sell" || effectiveOrderType !== "market") ? { qty: sharesNum } : {}),
      orderType: effectiveOrderType,
      timeInForce,
      ...(limitPrice ? { limitPrice: Number(limitPrice) } : {}),
      ...(stopPrice ? { stopPrice: Number(stopPrice) } : {}),
    });
    if (!quote.ok || !quote.quote) {
      setState("error");
      setMessage(quote.error || "The venue could not review this order.");
      return;
    }
    const currentAssetValueUsd = stockPortfolio.rows.find((row) => row.sym === ticker)?.usd ?? 0;
    const created = await planFlow.stage({
      title: `${side === "buy" ? "Buy" : "Sell"} ${ticker} via ${venue}`,
      proposal: {
        accountId: `${desk.wallet.id}:stocks`,
        agentId,
        assetClass: "stock",
        asset: ticker,
        side,
        orderType: effectiveOrderType,
        timeInForce,
        quantity: isUsdSizedVenue ? undefined : sharesNum,
        notionalUsd,
        estimatedPrice: px || advancedReferencePrice,
        limitPrice: limitPrice ? Number(limitPrice) : undefined,
        stopPrice: stopPrice ? Number(stopPrice) : undefined,
        venue: venue || undefined,
        network: isRobinhoodChain ? network : undefined,
        source: "HivemindOS Trade stock ticket",
        quote: {
          capturedAt: new Date().toISOString(),
          source: quote.quote.venue,
          slippageBps: quote.quote.priceImpactPct === undefined ? undefined : quote.quote.priceImpactPct * 100,
          feeUsd: quote.quote.platformFee?.amountUsd,
          detail: quote.quote.detail,
        },
        portfolio: {
          totalValueUsd: Math.max(stockPortfolio.total, r.account?.portfolioValue ?? 0),
          currentAssetValueUsd,
          dailyPnlPct: stockPortfolio.dayPct,
        },
      },
      evidence: [quote.quote.detail, `Account health: ${r.venueReady ? "ready" : "not ready"}`],
      missingContext: [
        ...(quote.quote.priceImpactPct === undefined ? ["Venue did not provide a numeric slippage bound"] : []),
        ...(!stockPortfolio.total && !(r.account?.portfolioValue ?? 0) ? ["Portfolio exposure is unknown"] : []),
      ],
    });
    setState(created ? "idle" : "error");
    if (!created) setMessage(planFlow.error || "The trade plan could not be staged.");
  };

  const executeLive = async (planId: string) => {
    const confirmation = r.confirmations[side];
    if (!confirmation) { setMessage("Missing confirmation token — reload the Trade tab."); setState("error"); return { ok: false, error: "Missing confirmation token." }; }
    setState("signing");
    setMessage("");
    const response = await executeStockTrade({
      agentId, side, ticker, notionalUsd,
      confirmation, paper: false, planId,
      orderType: venue === "alpaca" ? orderType : "market",
      timeInForce,
      ...(limitPrice ? { limitPrice: Number(limitPrice) } : {}),
      ...(stopPrice ? { stopPrice: Number(stopPrice) } : {}),
      // Buys place by NOTIONAL so the per-trade cap, rolling spend budget, and
      // live platform fee bind to the exact USD submitted — a qty order lets a
      // stale client price under-state the gated notional. Sells keep the exact
      // share count (a sell is an inflow, not budget-gated), so "sell N" is exact.
      ...(!isUsdSizedVenue && (side === "sell" || orderType !== "market") ? { qty: sharesNum } : {}),
    });
    if (!response.ok || !response.result) { setState("error"); setMessage(response.error || "Trade failed."); return { ok: false, error: response.error || "Trade failed." }; }
    setState("done");
    setMessage(response.result.detail);
    playTradeSuccessSound();
    // Alpaca orders queue before they fill — show the position as pending right
    // away (with this confirmation), instead of waiting for the open-order list
    // to catch up. On-chain swaps are instant, so just refresh.
    if ((venue === "alpaca" || venue === "robinhood-agentic") && response.result.reference) {
      desk.onOptimisticStockOrder({ orderId: response.result.reference, ticker, notionalUsd, side });
    } else {
      desk.refresh();
    }
    return { ok: true };
  };

  const approvePlan = async () => {
    const next = await planFlow.approveAndContinue(executeLive);
    if (next?.executionMode !== "live" && next?.execution) {
      setState("done");
      setMessage(next.execution.detail);
      playTradeSuccessSound();
    }
    if (planFlow.error) { setState("error"); setMessage(planFlow.error); }
  };

  React.useEffect(() => {
    if (state !== "done") return;
    const timer = window.setTimeout(() => { setState("idle"); setMessage(""); }, 4500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const sell = side === "sell";
  const label = state === "reviewing" ? "Building plan…" : state === "signing" ? "Submitting approved plan…" : state === "done" ? "Plan completed"
    : !ticker ? "Pick a ticker" : !notionalUsd ? (isUsdSizedVenue ? "Enter an amount" : "Enter share count")
    : `Review ${sell ? "sell" : "buy"} plan`;

  if (!venue) {
    // Bankr is a synthetic pickable with no governed ledger record, so there's
    // nothing to enable a venue on — steer to a personal/agent wallet instead.
    if (walletKind === "bankr") {
      return (
        <div className="tk-card">
          <div className="tk-guard"><BIcon name="alert" size={14} /><span>Stock trading isn&apos;t available for the Bankr wallet — it has no governed ledger. Pick a personal or agent wallet to trade equities.</span></div>
          <button type="button" className="tk-place" style={{ marginTop: 14 }} onClick={onChangeWallet}>Change wallet</button>
        </div>
      );
    }

    if (!enableOpen) {
      return (
      <div className="tk-card">
          <div className="tk-guard"><BIcon name="alert" size={14} /><span>Stock trading is off for this wallet. Turn it on with Alpaca, Robinhood Agentic brokerage, xStocks, or Robinhood Chain Stock Tokens.</span></div>
          <button type="button" className="tk-place" style={{ marginTop: 14 }} onClick={() => { setEnableOpen(true); setEnError(""); }}>Enable Stock Trading</button>
        </div>
      );
    }

    return (
      <div className="tk-card">
        <div className="tk-leg">
          <div className="lhead"><span>Trading venue</span><span className="bal">How orders are placed</span></div>
          <div className="dk-pl" role="radiogroup" aria-label="Trading venue" style={{ marginTop: 8 }}>
            <button type="button" data-active={enVenue === "alpaca" ? "" : undefined} disabled={enSaving} onClick={() => setEnVenue("alpaca")}>Alpaca</button>
            <button type="button" data-active={enVenue === "robinhood-agentic" ? "" : undefined} disabled={enSaving} onClick={() => setEnVenue("robinhood-agentic")}>Robinhood</button>
            <button type="button" data-active={enVenue === "xstocks" ? "" : undefined} disabled={enSaving} onClick={() => setEnVenue("xstocks")}>xStocks</button>
            <button type="button" data-active={enVenue === "robinhood-chain" ? "" : undefined} disabled={enSaving} onClick={() => setEnVenue("robinhood-chain")}>Robinhood Chain</button>
          </div>
        </div>

        {enVenue === "alpaca" ? (
          <div className="tk-leg" style={{ marginTop: 12 }}>
            <div className="lhead"><span>Account mode</span><span className="bal">Keys load from shared hive env</span></div>
            <div className="dk-pl" role="radiogroup" aria-label="Account mode" style={{ marginTop: 8 }}>
              <button type="button" data-active={enPaper ? "" : undefined} disabled={enSaving} onClick={() => setEnPaper(true)}>Paper</button>
              <button type="button" data-active={!enPaper ? "" : undefined} data-live={!enPaper ? "" : undefined} disabled={enSaving} onClick={() => setEnPaper(false)}>Live</button>
            </div>
            <div className="tk-usd" style={{ marginTop: 8 }}>{enPaper ? "Paper is simulated — no real money. You can switch to LIVE later." : "LIVE places real brokerage orders once Alpaca live keys are set."}</div>
          </div>
        ) : enVenue === "robinhood-agentic" ? (
          <div className="tk-leg" style={{ marginTop: 12 }}>
            <div className="lhead"><span>Robinhood Agentic</span><span className="bal">Official brokerage MCP</span></div>
            <div className="tk-usd" style={{ marginTop: 8 }}>Places long-equity orders in the dedicated Robinhood Agentic account after Robinhood review and HivemindOS confirmation. Connect Robinhood in Integrations first.</div>
          </div>
        ) : enVenue === "xstocks" ? (
          <div className="tk-leg" style={{ marginTop: 12 }}>
            <div className="lhead"><span>xStocks · Solana</span><span className="bal">On-chain via Jupiter</span></div>
            <div className="tk-usd" style={{ marginTop: 8 }}>Swaps USDC → verified xStock tokens on Solana.{isSolanaWallet ? "" : " This wallet isn't on Solana mainnet, so on-chain buys will be rejected — pick a Solana wallet."}</div>
          </div>
        ) : (
          <div className="tk-leg" style={{ marginTop: 12 }}>
            <div className="lhead"><span>Robinhood Chain</span><span className="bal">USDG via 0x</span></div>
            <div className="tk-usd" style={{ marginTop: 8 }}>Swaps USDG ↔ canonical Robinhood Stock Tokens on chain ID 4663. Requires a Robinhood Chain wallet with USDG and ETH gas.</div>
          </div>
        )}

        {enError ? <div className="tk-guard" data-danger style={{ marginTop: 12 }}><BIcon name="alert" size={14} /><span>{enError}</span></div> : null}

        <button type="button" className="tk-place" style={{ marginTop: 14 }} disabled={enSaving} onClick={enable}>
          {enSaving ? <BIcon name="spinner" size={15} spin /> : null}
          {enSaving ? "Enabling…" : enVenue === "alpaca" ? `Enable Alpaca (${enPaper ? "Paper" : "Live"})` : enVenue === "robinhood-agentic" ? "Enable Robinhood Agentic" : enVenue === "xstocks" ? "Enable xStocks" : "Enable Robinhood Chain"}
        </button>
        {!enSaving ? (
          <div style={{ marginTop: 10, textAlign: "center" }}><button type="button" className="fw-manage" onClick={() => { setEnableOpen(false); setEnError(""); }}>Cancel</button></div>
        ) : null}
        <div className="tk-foot"><BIcon name="shield" size={12} /> Turns on trading (and spending) for this wallet — change it anytime in Wallet settings.</div>
      </div>
    );
  }

  return (
    <div className="tk-card">
      {importedDraft ? <div className="tk-guard"><BIcon name="shield" size={14} /><span>Imported X order draft · nothing has executed. Verify every field and use this rail&apos;s separate confirmation.</span></div> : null}
      <div className="tk-head">
        <div className="tk-side">
          {(["buy", "sell"] as const).map((s) => (
            <button key={s} type="button" data-active={side === s ? "" : undefined} data-sell={side === s && s === "sell" ? "" : undefined}
              onClick={() => { setSide(s); resetPlan(); }}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        <Badge tone={planFlow.mode === "live" ? "live" : "honey"}>{planFlow.mode === "research" ? "Research-only" : planFlow.mode === "paper" ? "Paper simulator" : "Live · governed"}</Badge>
      </div>

      <div className="tk-leg">
        <div className="lhead"><span>Symbol</span><span className="bal">{isRobinhoodAgentic ? "Brokerage · MCP" : isRobinhoodChain ? "On-chain · 4663" : isXstocks ? "On-chain · Jupiter" : price ? `Last ${trUsd2(px)}` : "—"}</span></div>
        <div className="tk-legrow">
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 19, letterSpacing: "-0.01em" }}>{ticker || "—"}</div>
            {price ? <div className="tk-usd" style={{ marginTop: 3, color: price.chg < 0 ? "var(--danger)" : "var(--live)" }}>{trPct(price.chg)} today</div> : null}
          </div>
          <AssetMenu value={choice === OTHER ? "Other" : choice} options={[...tickerOptions, ...((venue === "alpaca" || isRobinhoodAgentic) ? [OTHER] : [])]} values={usdByTicker}
            getName={(s) => (s === OTHER ? "Custom ticker" : s)} onPick={(s) => { setChoice(s); resetPlan(); }} stock />
        </div>
        {choice === OTHER ? (
          <input className="fb-field" style={{ marginTop: 10 }} placeholder="Ticker e.g. ORCL" value={custom} onChange={(e) => { setCustom(e.target.value.toUpperCase()); resetPlan(); }} />
        ) : null}
      </div>

      <div className="tk-leg" style={{ marginTop: 12 }}>
        <div className="lhead"><span>{isUsdSizedVenue ? (sell ? "Proceeds (USD)" : "Spend (USD)") : (sell ? "Shares to sell" : "Shares to buy")}</span>
          <span className="bal">{venue === "alpaca" ? `${paper ? "Paper" : "LIVE"} · BP ${trUsd(buyingPower, true)}` : ""}</span></div>
        <div className="tk-legrow">
          {isUsdSizedVenue ? (
            <input className="tk-input" inputMode="decimal" placeholder="0" value={usd}
              onChange={(e) => { setUsd(e.target.value.replace(/[^0-9.]/g, "")); resetPlan(); }} aria-label="USD amount" />
          ) : (
            <input className="tk-input" inputMode="decimal" placeholder="0" value={shares}
              onChange={(e) => { setShares(e.target.value.replace(/[^0-9.]/g, "")); resetPlan(); }} aria-label="Share count" />
          )}
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-3)" }}>{isUsdSizedVenue ? "USD" : "shares"}</span>
        </div>
        <div className="tk-usd">≈ {trUsd2(notionalUsd)} at market</div>
        {!isXstocks && !sell && px > 0 ? (
          <div className="tk-chips">
            {([[0.1, "10%"], [0.25, "25%"], [0.5, "50%"]] as const).map(([p, l]) => (
              <button key={l} type="button" onClick={() => { setShares(String(Math.max(0, Math.floor((buyingPower * p) / px)))); resetPlan(); }}>{l} BP</button>
            ))}
          </div>
        ) : null}
      </div>

      {venue === "alpaca" ? (
        <details className="tk-advanced">
          <summary>Advanced order</summary>
          <div className="tk-advanced-grid">
            <label><span>Order type</span><select value={orderType} onChange={(event) => { setOrderType(event.target.value as typeof orderType); resetPlan(); }}><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option><option value="stop_limit">Stop limit</option></select></label>
            <label><span>Time in force</span><select value={timeInForce} onChange={(event) => { setTimeInForce(event.target.value as typeof timeInForce); resetPlan(); }}><option value="day">Day</option><option value="gtc">Good until canceled</option><option value="ioc">Immediate or cancel</option><option value="fok">Fill or kill</option></select></label>
            {orderType === "limit" || orderType === "stop_limit" ? <label><span>Limit price</span><input inputMode="decimal" value={limitPrice} onChange={(event) => { setLimitPrice(event.target.value.replace(/[^0-9.]/g, "")); resetPlan(); }} placeholder={px ? String(px) : "0.00"} /></label> : null}
            {orderType === "stop" || orderType === "stop_limit" ? <label><span>Stop price</span><input inputMode="decimal" value={stopPrice} onChange={(event) => { setStopPrice(event.target.value.replace(/[^0-9.]/g, "")); resetPlan(); }} placeholder={px ? String(px) : "0.00"} /></label> : null}
          </div>
        </details>
      ) : null}

      <div className="tk-review">
        <ReviewLine k="Order type" v={venue === "alpaca" ? `${orderType.replace("_", " ")} · ${timeInForce}` : "Market"} />
        {!isXstocks && px > 0 ? <ReviewLine k="Est. price" v={trUsd2(px)} /> : null}
        <ReviewLine k="Est. cost" v={trUsd2(notionalUsd)} />
        {venue === "alpaca" ? <ReviewLine k="Buying power" v={trUsd(buyingPower, true)} icon="wallet" live /> : null}
        <ReviewLine k="Account" v={isRobinhoodAgentic ? "Robinhood Agentic brokerage" : isRobinhoodChain ? "On-chain · Robinhood Chain" : isXstocks ? "On-chain · xStocks" : planFlow.mode === "live" ? "LIVE brokerage" : planFlow.mode === "paper" ? "Paper simulator" : "Research-only"} />
      </div>

      {!r.venueReady && venue === "robinhood-chain" ? (
        <div className="tk-guard">
          <BIcon name="alert" size={14} />
          <span>{network === "eip155:4663" ? (r.robinhoodReason || "Robinhood Chain stock-token routing is unavailable right now.") : "Pick a Robinhood Chain wallet before trading Stock Tokens."}</span>
        </div>
      ) : !r.venueReady && venue === "robinhood-agentic" ? (
        <div className="tk-guard">
          <BIcon name="alert" size={14} />
          <span>{r.robinhoodAgenticReason || "Connect Robinhood and choose the dedicated Agentic account before trading."}</span>
        </div>
      ) : !r.venueReady && venue === "alpaca" ? (
        <div className="tk-guard">
          <BIcon name="alert" size={14} />
          <span>Alpaca {paper ? "paper" : "live"} keys aren&apos;t set ({(paper ? r.paperKeys : r.liveKeys).join(" · ")}). Add them to enable {paper ? "paper" : "LIVE"} orders.</span>
        </div>
      ) : overBp ? (
        <div className="tk-guard" data-danger><BIcon name="alert" size={14} /><span>Cost exceeds {trUsd(buyingPower)} buying power. Reduce the order or fund the account.</span></div>
      ) : null}

      <button type="button" className="tk-place" data-sell={sell && state === "idle" ? "" : undefined} data-done={state === "done" ? "" : undefined}
        disabled={!canAct || overBp || Boolean(planFlow.plan) || planFlow.busy} onClick={stagePlan}>
        {state === "reviewing" || state === "signing" ? <BIcon name="spinner" size={15} spin /> : state === "done" ? <BIcon name="check" size={15} /> : null}
        {label}
      </button>
      <div className="tk-foot"><BIcon name="shield" size={12} /> Stage → review → approve {planFlow.mode === "live" ? "→ governed submission" : planFlow.mode === "paper" ? "→ virtual fill" : "only"}</div>

      {planFlow.plan ? <TradePlanReviewCard plan={planFlow.plan} busy={planFlow.busy || state === "signing"} onReject={() => void planFlow.reject()} onApprove={() => void approvePlan()} onStartNew={() => { planFlow.clear(); setState("idle"); setMessage(""); }} /> : null}

      {!r.venueReady && venue === "alpaca" ? (
        <div style={{ marginTop: 10, textAlign: "center" }}><button type="button" className="fw-manage" onClick={() => onOpenView("env")}>Open Env to add Alpaca keys →</button></div>
      ) : null}
      {!r.venueReady && venue === "robinhood-agentic" ? (
        <div style={{ marginTop: 10, textAlign: "center" }}><button type="button" className="fw-manage" onClick={() => onOpenView("integrations")}>Open Integrations to connect Robinhood →</button></div>
      ) : null}
      {state === "error" && message ? <p className="tk-error">{message}</p> : null}
      {planFlow.error ? <p className="tk-error">{planFlow.error}</p> : null}
      {state === "done" && message ? (
        <div className="tk-success">{message}
          <div style={{ marginTop: 6 }}><button type="button" className="fw-manage" onClick={() => onOpenView("wallet")}>View in Wallets · Activity →</button></div>
        </div>
      ) : null}
    </div>
  );
}
