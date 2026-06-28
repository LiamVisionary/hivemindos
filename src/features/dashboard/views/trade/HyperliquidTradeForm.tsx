"use client";

/* HyperliquidTradeForm — the full Hyperliquid rail (perps + spot, market / limit
   / TP-SL triggers, advanced actions, account status) plus the shared practice
   book. Extracted from the original CryptoTradeView so the redesigned Trade desk
   can embed it as a first-class capability without re-skinning the whole rail.
   Behaviour is unchanged — same trade-api calls + confirmations. */

import { useCallback, useEffect, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import styles from "./trade.module.css";
import { playTradeSuccessSound } from "@/components/trade/trade-sound";
import { CryptoPracticeBookPanel } from "./CryptoPracticeBookPanel";
import {
  type HyperliquidAccountStatus,
  type HyperliquidActionName,
  type HyperliquidMarketType,
  type HyperliquidOrderType,
  type HyperliquidQuote,
  type HyperliquidSide,
  approveHyperliquidBuilder,
  executeHyperliquidTrade,
  fetchHyperliquidStatus,
  quoteHyperliquidTrade,
  runHyperliquidAction,
} from "./trade-api";

export function HyperliquidTradeForm({ agentId, agentName, isEvmWallet, setActiveView }: {
  agentId: string;
  agentName: string;
  isEvmWallet: boolean;
  setActiveView?: (view: DashboardView) => void;
}) {
  const [coin, setCoin] = useState("BTC");
  const [marketType, setMarketType] = useState<HyperliquidMarketType>("perp");
  const [side, setSide] = useState<HyperliquidSide>("long");
  const [orderType, setOrderType] = useState<HyperliquidOrderType>("market");
  const [timeInForce, setTimeInForce] = useState<"Gtc" | "Ioc" | "Alo">("Gtc");
  const [triggerPx, setTriggerPx] = useState("");
  const [triggerType, setTriggerType] = useState<"tp" | "sl">("tp");
  const [triggerIsMarket, setTriggerIsMarket] = useState(true);
  const [clientOrderId, setClientOrderId] = useState("");
  const [notional, setNotional] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [advancedAction, setAdvancedAction] = useState<HyperliquidActionName>("cancel");
  const [orderId, setOrderId] = useState("");
  const [cloid, setCloid] = useState("");
  const [leverage, setLeverage] = useState("3");
  const [marginDeltaUsd, setMarginDeltaUsd] = useState("");
  const [transferType, setTransferType] = useState<"usd-class" | "usd-send" | "spot-send" | "withdraw">("usd-class");
  const [transferAmount, setTransferAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [spotToken, setSpotToken] = useState("");
  const [toPerp, setToPerp] = useState(true);
  const [twapMinutes, setTwapMinutes] = useState("5");
  const [twapId, setTwapId] = useState("");
  const [status, setStatus] = useState<HyperliquidAccountStatus | null>(null);
  const [quote, setQuote] = useState<HyperliquidQuote | null>(null);
  const [busy, setBusy] = useState<"status" | "quote" | "approve" | "trade" | "advanced" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const notionalUsd = Number(notional) || 0;
  const limit = Number(limitPrice) || 0;
  const trigger = Number(triggerPx) || 0;
  const canQuote = isEvmWallet && notionalUsd > 0 && (orderType === "market" || limit > 0 || (orderType === "trigger" && trigger > 0 && (triggerIsMarket || limit > 0))) && !busy;
  const needsBuilderApproval = Boolean(quote?.builder && quote.builderApproval.configured && !quote.builderApproval.approved);
  const marketChoices = marketType === "perp" ? ["BTC", "ETH", "SOL", "HYPE"] : ["HYPE", "PURR/USDC", "BTC/USDC", "ETH/USDC"];

  const refreshStatus = useCallback(async () => {
    if (!isEvmWallet) return;
    setBusy("status");
    setError("");
    const response = await fetchHyperliquidStatus(agentId);
    setBusy(null);
    if (!response.ok || !response.status) {
      setError(response.error || "Could not load Hyperliquid status.");
      return;
    }
    setStatus(response.status);
  }, [agentId, isEvmWallet]);

  useEffect(() => {
    let ignore = false;
    if (!isEvmWallet) return () => { ignore = true; };
    void fetchHyperliquidStatus(agentId).then((response) => {
      if (ignore) return;
      if (response.ok && response.status) {
        setStatus(response.status);
        return;
      }
      setError(response.error || "Could not load Hyperliquid status.");
    });
    return () => { ignore = true; };
  }, [agentId, isEvmWallet]);

  const clearDraft = () => {
    setQuote(null);
    setSuccess("");
  };

  const changeMarketType = (next: HyperliquidMarketType) => {
    setMarketType(next);
    setCoin(next === "perp" ? "BTC" : "HYPE");
    setSide(next === "perp" ? "long" : "buy");
    setReduceOnly(false);
    clearDraft();
  };

  const getQuote = async () => {
    if (!canQuote) return;
    setBusy("quote");
    setError("");
    setSuccess("");
    const response = await quoteHyperliquidTrade({
      agentId,
      coin,
      marketType,
      side,
      orderType,
      notionalUsd,
      limitPrice: orderType === "limit" || (orderType === "trigger" && !triggerIsMarket) ? limit : undefined,
      timeInForce,
      triggerPx: orderType === "trigger" ? trigger : undefined,
      triggerType: orderType === "trigger" ? triggerType : undefined,
      triggerIsMarket: orderType === "trigger" ? triggerIsMarket : undefined,
      grouping: orderType === "trigger" ? "normalTpsl" : "na",
      clientOrderId: clientOrderId.trim() || undefined,
      reduceOnly,
      slippageBps,
    });
    setBusy(null);
    if (!response.ok || !response.quote) {
      setError(response.error || "Could not quote this Hyperliquid order.");
      return;
    }
    setQuote(response.quote);
  };

  const approveBuilder = async () => {
    setBusy("approve");
    setError("");
    setSuccess("");
    const response = await approveHyperliquidBuilder(agentId);
    setBusy(null);
    if (!response.ok || !response.result) {
      setError(response.error || "Builder approval failed.");
      return;
    }
    setSuccess(response.result.detail);
    await refreshStatus();
    await getQuote();
  };

  const submit = async () => {
    if (!canQuote) return;
    if (needsBuilderApproval) {
      setError("Approve the configured builder fee before placing this order.");
      return;
    }
    setBusy("trade");
    setError("");
    setSuccess("");
    const response = await executeHyperliquidTrade({
      agentId,
      coin,
      marketType,
      side,
      orderType,
      notionalUsd,
      limitPrice: orderType === "limit" || (orderType === "trigger" && !triggerIsMarket) ? limit : undefined,
      timeInForce,
      triggerPx: orderType === "trigger" ? trigger : undefined,
      triggerType: orderType === "trigger" ? triggerType : undefined,
      triggerIsMarket: orderType === "trigger" ? triggerIsMarket : undefined,
      grouping: orderType === "trigger" ? "normalTpsl" : "na",
      clientOrderId: clientOrderId.trim() || undefined,
      reduceOnly,
      slippageBps,
    });
    setBusy(null);
    if (!response.ok || !response.result) {
      setError(response.error || "Hyperliquid order failed.");
      return;
    }
    setQuote(null);
    setSuccess(response.result.detail);
    playTradeSuccessSound();
    await refreshStatus();
  };

  const runAdvanced = async () => {
    setBusy("advanced");
    setError("");
    setSuccess("");
    const action = advancedAction === "cancel-by-cloid" && !cloid.trim() ? "cancel" : advancedAction;
    const response = await runHyperliquidAction({
      action,
      agentId,
      coin,
      marketType,
      side,
      assetId: undefined,
      orderId: orderId.trim() || undefined,
      cloid: cloid.trim() || undefined,
      leverage: Number(leverage) || undefined,
      marginMode: "cross",
      marginDeltaUsd: Number(marginDeltaUsd) || undefined,
      transferType,
      amount: Number(transferAmount) || undefined,
      amountUsd: Number(transferAmount) || undefined,
      destination: destination.trim() || undefined,
      token: spotToken.trim() || undefined,
      toPerp,
      twapMinutes: Number(twapMinutes) || undefined,
      twapId: twapId.trim() || undefined,
      notionalUsd,
      size: undefined,
      reduceOnly,
      twapRandomize: true,
    });
    setBusy(null);
    if (!response.ok) { setError(response.error || "Hyperliquid action failed."); return; }
    setSuccess(response.result?.detail || response.status?.detail || "Hyperliquid action submitted.");
    await refreshStatus();
  };

  if (!isEvmWallet) {
    return (
      <div className={styles.warnCard} style={{ marginTop: 12 }}>
        Hyperliquid trading requires a local EVM wallet. {setActiveView ? <button type="button" className={styles.btn} style={{ marginLeft: 8, padding: "4px 10px" }} onClick={() => setActiveView("wallet")}>Open Wallets</button> : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-market-type">Type</label>
          <select id="hyperliquid-market-type" className={styles.select} value={marketType} onChange={(event) => changeMarketType(event.target.value as HyperliquidMarketType)}>
            <option value="perp">Perps</option>
            <option value="spot">Spot</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-market">Market</label>
          <select id="hyperliquid-market" className={styles.select} value={coin} onChange={(event) => { setCoin(event.target.value); clearDraft(); }}>
            {marketChoices.map((symbol) => <option key={symbol} value={symbol}>{marketType === "perp" ? `${symbol}-PERP` : symbol}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-side">Side</label>
          <select id="hyperliquid-side" className={styles.select} value={side} onChange={(event) => { setSide(event.target.value as HyperliquidSide); clearDraft(); }}>
            {marketType === "perp" ? (
              <>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </>
            ) : (
              <>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </>
            )}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-type">Order</label>
          <select id="hyperliquid-type" className={styles.select} value={orderType} onChange={(event) => { setOrderType(event.target.value as HyperliquidOrderType); clearDraft(); }}>
            <option value="market">Market IOC</option>
            <option value="limit">Limit GTC</option>
            <option value="trigger">TP / SL trigger</option>
          </select>
        </div>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hyperliquid-notional">Notional (USD)</label>
          <input id="hyperliquid-notional" className={styles.input} inputMode="decimal" value={notional} onChange={(event) => { setNotional(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
        </div>
      </div>

      <div className={styles.fieldRow}>
        {orderType === "limit" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-limit">Limit price</label>
            <input id="hyperliquid-limit" className={styles.input} inputMode="decimal" value={limitPrice} onChange={(event) => { setLimitPrice(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
          </div>
        ) : orderType === "trigger" ? (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-trigger">Trigger price</label>
              <input id="hyperliquid-trigger" className={styles.input} inputMode="decimal" value={triggerPx} onChange={(event) => { setTriggerPx(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-trigger-type">Trigger</label>
              <select id="hyperliquid-trigger-type" className={styles.select} value={triggerType} onChange={(event) => { setTriggerType(event.target.value as "tp" | "sl"); clearDraft(); }}>
                <option value="tp">Take profit</option>
                <option value="sl">Stop loss</option>
              </select>
            </div>
            {!triggerIsMarket ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hyperliquid-trigger-limit">Limit price</label>
                <input id="hyperliquid-trigger-limit" className={styles.input} inputMode="decimal" value={limitPrice} onChange={(event) => { setLimitPrice(event.target.value.replace(/[^0-9.]/g, "")); clearDraft(); }} />
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-slippage">Market slippage</label>
            <select id="hyperliquid-slippage" className={styles.select} value={slippageBps} onChange={(event) => { setSlippageBps(Number(event.target.value)); clearDraft(); }}>
              <option value={25}>0.25%</option>
              <option value={50}>0.50%</option>
              <option value={100}>1.00%</option>
            </select>
          </div>
        )}
        {orderType !== "market" ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-tif">Time in force</label>
            <select id="hyperliquid-tif" className={styles.select} value={timeInForce} onChange={(event) => { setTimeInForce(event.target.value as "Gtc" | "Ioc" | "Alo"); clearDraft(); }}>
              <option value="Gtc">GTC</option>
              <option value="Ioc">IOC</option>
              <option value="Alo">Post only</option>
            </select>
          </div>
        ) : null}
        {orderType === "trigger" ? (
          <label className={styles.checkboxLine}>
            <input type="checkbox" checked={triggerIsMarket} onChange={(event) => { setTriggerIsMarket(event.target.checked); clearDraft(); }} />
            Market on trigger
          </label>
        ) : null}
        <label className={styles.checkboxLine}>
          <input type="checkbox" checked={reduceOnly} disabled={marketType === "spot"} onChange={(event) => { setReduceOnly(event.target.checked); clearDraft(); }} />
          Reduce only
        </label>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="hyperliquid-cloid">Client order ID</label>
        <input id="hyperliquid-cloid" className={styles.input} value={clientOrderId} placeholder="Optional 0x… client id" onChange={(event) => { setClientOrderId(event.target.value.trim()); clearDraft(); }} />
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={refreshStatus} disabled={busy != null}>{busy === "status" ? "Refreshing..." : "Refresh status"}</button>
        <button type="button" className={styles.btn} onClick={getQuote} disabled={!canQuote}>{busy === "quote" ? "Quoting..." : "Get quote"}</button>
        {needsBuilderApproval ? (
          <button type="button" className={styles.btn} onClick={approveBuilder} disabled={busy != null}>{busy === "approve" ? "Approving..." : "Approve builder"}</button>
        ) : null}
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit} disabled={!canQuote || !quote || needsBuilderApproval}>{busy === "trade" ? "Trading..." : "Confirm & trade"}</button>
      </div>

      <p className={styles.note} style={{ marginTop: 8 }}>Signs locally from {agentName}. Server policy controls wallet, cap, builder address, and builder fee.</p>

      <div className={styles.card} style={{ marginTop: 10, background: "transparent" }}>
        <div className={styles.groupTitle}>Advanced</div>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="hyperliquid-advanced-action">Action</label>
            <select
              id="hyperliquid-advanced-action"
              className={styles.select}
              value={advancedAction}
              onChange={(event) => {
                const next = event.target.value as HyperliquidActionName;
                setAdvancedAction(next);
                if (["usd-class", "usd-send", "spot-send", "withdraw"].includes(next)) setTransferType(next as "usd-class" | "usd-send" | "spot-send" | "withdraw");
              }}
            >
              <option value="open-orders">Open orders</option>
              <option value="order-status">Order status</option>
              <option value="cancel">Cancel order</option>
              <option value="cancel-by-cloid">Cancel client order</option>
              <option value="leverage">Set leverage</option>
              <option value="margin">Adjust isolated margin</option>
              <option value="usd-class">Move USDC spot/perps</option>
              <option value="usd-send">Send USDC</option>
              <option value="withdraw">Withdraw USDC</option>
              <option value="spot-send">Send spot asset</option>
              <option value="twap-order">Place TWAP</option>
              <option value="twap-cancel">Cancel TWAP</option>
            </select>
          </div>
          {["order-status", "cancel", "twap-cancel"].includes(advancedAction) ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-order-id">Order / TWAP ID</label>
              <input id="hyperliquid-order-id" className={styles.input} inputMode="numeric" value={advancedAction === "twap-cancel" ? twapId : orderId} onChange={(event) => advancedAction === "twap-cancel" ? setTwapId(event.target.value.replace(/[^0-9]/g, "")) : setOrderId(event.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          ) : null}
          {advancedAction === "cancel-by-cloid" ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-cancel-cloid">Client order ID</label>
              <input id="hyperliquid-cancel-cloid" className={styles.input} value={cloid} onChange={(event) => setCloid(event.target.value.trim())} />
            </div>
          ) : null}
          {advancedAction === "leverage" ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-leverage">Leverage</label>
              <input id="hyperliquid-leverage" className={styles.input} inputMode="numeric" value={leverage} onChange={(event) => setLeverage(event.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          ) : null}
          {advancedAction === "margin" ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-margin">Margin delta USD</label>
              <input id="hyperliquid-margin" className={styles.input} inputMode="decimal" value={marginDeltaUsd} onChange={(event) => setMarginDeltaUsd(event.target.value.replace(/[^0-9.-]/g, ""))} />
            </div>
          ) : null}
        </div>

        {["usd-class", "usd-send", "spot-send", "withdraw"].includes(advancedAction) ? (
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-transfer-amount">Amount</label>
              <input id="hyperliquid-transfer-amount" className={styles.input} inputMode="decimal" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
            {advancedAction === "usd-class" ? (
              <label className={styles.checkboxLine}>
                <input type="checkbox" checked={toPerp} onChange={(event) => setToPerp(event.target.checked)} />
                To perps
              </label>
            ) : (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hyperliquid-destination">Destination</label>
                <input id="hyperliquid-destination" className={styles.input} value={destination} onChange={(event) => setDestination(event.target.value.trim())} />
              </div>
            )}
            {advancedAction === "spot-send" ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hyperliquid-spot-token">Spot token</label>
                <input id="hyperliquid-spot-token" className={styles.input} value={spotToken} placeholder="Token id from Hyperliquid" onChange={(event) => setSpotToken(event.target.value.trim())} />
              </div>
            ) : null}
          </div>
        ) : null}

        {advancedAction === "twap-order" ? (
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hyperliquid-twap-minutes">Minutes</label>
              <input id="hyperliquid-twap-minutes" className={styles.input} inputMode="numeric" value={twapMinutes} onChange={(event) => setTwapMinutes(event.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          </div>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={runAdvanced} disabled={busy != null}>{busy === "advanced" ? "Submitting..." : "Run advanced action"}</button>
        </div>
      </div>

      {status ? (
        <div className={styles.card} style={{ marginTop: 10, background: "transparent" }}>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Account value</span><span className={styles.reviewVal}>{status.accountValueUsd == null ? "Unavailable" : `$${status.accountValueUsd.toFixed(2)}`}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Open orders</span><span className={styles.reviewVal}>{status.openOrders.length}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Builder</span><span className={styles.reviewVal}>{status.builderConfig.configured ? status.builderApproval.detail : status.builderConfig.missing.join(" ")}</span></div>
          {status.positions.slice(0, 3).map((position) => (
            <div className={styles.reviewLine} key={position.coin}>
              <span className={styles.reviewKey}>{position.coin}</span>
              <span className={styles.reviewVal}>{position.side} {Math.abs(position.size).toPrecision(6)}{position.unrealizedPnlUsd == null ? "" : ` · PnL $${position.unrealizedPnlUsd.toFixed(2)}`}</span>
            </div>
          ))}
          {status.spotBalances.slice(0, 3).map((balance) => (
            <div className={styles.reviewLine} key={`spot-${balance.coin}`}>
              <span className={styles.reviewKey}>{balance.coin}</span>
              <span className={styles.reviewVal}>{balance.available.toPrecision(6)} available</span>
            </div>
          ))}
        </div>
      ) : null}

      <CryptoPracticeBookPanel agentId={agentId} isEvmWallet={isEvmWallet} />

      {quote ? (
        <div className={styles.card} style={{ marginTop: 10, background: "transparent" }}>
          <div className={styles.groupTitle}>Quote</div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Order</span><span className={styles.reviewVal}>{quote.order.marketType} {quote.order.side} {quote.order.size} {quote.order.coin} at {quote.order.price}</span></div>
          {quote.order.triggerPx ? <div className={styles.reviewLine}><span className={styles.reviewKey}>Trigger</span><span className={styles.reviewVal}>{quote.order.triggerType?.toUpperCase()} at {quote.order.triggerPx}</span></div> : null}
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Notional</span><span className={styles.reviewVal}>${quote.order.notionalUsd.toFixed(2)}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Network</span><span className={styles.reviewVal}>{quote.network}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Builder fee</span><span className={styles.reviewVal}>{quote.builder ? `${(quote.builder.f / 10).toFixed(1).replace(/\.0$/, "")} bps` : "Disabled"}</span></div>
          <p className={styles.note} style={{ marginTop: 8 }}>{quote.detail}</p>
        </div>
      ) : null}

      {error ? <p className={styles.error} style={{ marginTop: 10 }}>{error}</p> : null}
      {success ? (
        <div style={{ marginTop: 10 }}>
          <p className={styles.success}>{success}</p>
          {setActiveView ? <div className={styles.actions}><button type="button" className={styles.btn} onClick={() => setActiveView("wallet")}>View in Wallets · Activity</button></div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default HyperliquidTradeForm;
