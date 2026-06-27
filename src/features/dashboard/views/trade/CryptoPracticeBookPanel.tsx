"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./trade.module.css";
import {
  type CryptoPracticeBook,
  type CryptoPracticeHolding,
  type CryptoPracticeMarketType,
  type CryptoPracticeReplayPlan,
  type CryptoPracticeSide,
  clearCryptoPracticeTarget,
  executeCryptoPracticeReplay,
  fetchCryptoPracticeBook,
  planCryptoPracticeReplay,
  saveManualCryptoPracticeHolding,
  snapshotAlpacaPaperPracticeBook,
  snapshotHyperliquidPracticeBook,
} from "./trade-api";

const MANUAL_ASSETS = ["BTC", "ETH", "SOL", "HYPE", "PURR"] as const;

type BusyState = "load" | "alpaca" | "hyperliquid" | "manual" | "clear" | "plan" | "execute" | null;

function money(value: number | undefined) {
  return `$${(Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function amount(value: number | undefined) {
  const parsed = Number(value) || 0;
  if (parsed >= 1) return parsed.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return parsed.toPrecision(4).replace(/\.?0+$/, "");
}

function sourceLabel(source: CryptoPracticeBook["targetSource"]) {
  if (source === "alpaca-paper") return "Alpaca paper";
  if (source === "hyperliquid") return "Hyperliquid";
  if (source === "manual") return "Manual";
  return "No target";
}

function holdingLabel(holding: CryptoPracticeHolding) {
  return `${holding.marketType === "perp" ? "Perp" : "Spot"} · ${holding.side}`;
}

export function CryptoPracticeBookPanel({ agentId, isEvmWallet }: {
  agentId: string;
  isEvmWallet: boolean;
}) {
  const [book, setBook] = useState<CryptoPracticeBook | null>(null);
  const [plan, setPlan] = useState<CryptoPracticeReplayPlan | null>(null);
  const [busy, setBusy] = useState<BusyState>("load");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [symbol, setSymbol] = useState<(typeof MANUAL_ASSETS)[number]>("BTC");
  const [marketType, setMarketType] = useState<CryptoPracticeMarketType>("spot");
  const [side, setSide] = useState<CryptoPracticeSide>("long");
  const [notional, setNotional] = useState("");
  const [quantity, setQuantity] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    const response = await fetchCryptoPracticeBook(agentId);
    setBusy(null);
    if (!response.ok || !response.book) {
      setError(response.error || "Could not load the shared practice book.");
      return;
    }
    setBook(response.book);
  }, [agentId]);

  useEffect(() => {
    let ignore = false;
    void fetchCryptoPracticeBook(agentId).then((response) => {
      if (ignore) return;
      setBusy(null);
      if (!response.ok || !response.book) {
        setError(response.error || "Could not load the shared practice book.");
        return;
      }
      setBook(response.book);
    });
    return () => { ignore = true; };
  }, [agentId]);

  const snapshots = useMemo(() => Object.values(book?.snapshots ?? {}).filter(Boolean), [book]);
  const executableOrders = plan?.orders ?? [];
  const unsupportedOrders = plan?.unsupported ?? [];

  const run = async <T extends { ok: boolean; error?: string; book?: CryptoPracticeBook }>(
    state: BusyState,
    action: () => Promise<T>,
    fallback: string,
    done: (response: T) => string,
  ) => {
    setBusy(state);
    setError("");
    setSuccess("");
    const response = await action();
    setBusy(null);
    if (!response.ok || !response.book) {
      setError(response.error || fallback);
      return;
    }
    setBook(response.book);
    setPlan(null);
    setSuccess(done(response));
  };

  const captureAlpaca = () => run(
    "alpaca",
    () => snapshotAlpacaPaperPracticeBook(agentId),
    "Could not capture Alpaca paper.",
    (response) => response.snapshot?.detail || "Saved Alpaca paper crypto positions as the shared target.",
  );

  const captureHyperliquid = (replaceTarget: boolean) => run(
    "hyperliquid",
    () => snapshotHyperliquidPracticeBook(agentId, replaceTarget),
    "Could not capture Hyperliquid.",
    (response) => replaceTarget
      ? response.snapshot?.detail || "Saved Hyperliquid positions as the shared target."
      : response.snapshot?.detail || "Synced Hyperliquid status without replacing the shared target.",
  );

  const saveManual = () => run(
    "manual",
    () => saveManualCryptoPracticeHolding({
      agentId,
      symbol,
      marketType,
      side,
      notionalUsd: Number(notional) || 0,
      quantity: Number(quantity) || 0,
    }),
    "Could not save the manual target.",
    () => `Saved ${symbol} ${marketType} ${side} to the shared target.`,
  );

  const clearTarget = () => run(
    "clear",
    () => clearCryptoPracticeTarget(agentId),
    "Could not clear the shared target.",
    () => "Cleared the shared practice target.",
  );

  const buildPlan = async () => {
    setBusy("plan");
    setError("");
    setSuccess("");
    const response = await planCryptoPracticeReplay(agentId);
    setBusy(null);
    if (!response.ok || !response.plan || !response.book) {
      setError(response.error || "Could not plan the Hyperliquid replay.");
      return;
    }
    setBook(response.book);
    setPlan(response.plan);
    setSuccess(response.plan.detail);
  };

  const executePlan = async () => {
    setBusy("execute");
    setError("");
    setSuccess("");
    const response = await executeCryptoPracticeReplay(agentId);
    setBusy(null);
    if (!response.ok) {
      setError(response.error || "Replay failed before all orders were submitted.");
      return;
    }
    if (response.book) setBook(response.book);
    if (response.plan) setPlan(response.plan);
    setSuccess(response.message || "Replay orders submitted.");
  };

  const targetHoldings = book?.targetHoldings ?? [];

  return (
    <div className={styles.practiceBook}>
      <div className={styles.practiceHead}>
        <div>
          <div className={styles.groupTitle}>Shared Practice Book</div>
          <p className={styles.note}>
            Local target holdings for practice continuity. Alpaca paper and Hyperliquid stay separate accounts; this book is the bridge between them.
          </p>
        </div>
        <span className={styles.pill}>{sourceLabel(book?.targetSource ?? "none")}</span>
      </div>

      <div className={styles.practiceActions}>
        <button type="button" className={styles.btn} onClick={captureAlpaca} disabled={busy != null}>
          {busy === "alpaca" ? "Capturing..." : "Save Alpaca paper target"}
        </button>
        <button type="button" className={styles.btn} onClick={() => captureHyperliquid(false)} disabled={busy != null || !isEvmWallet}>
          {busy === "hyperliquid" ? "Syncing..." : "Sync Hyperliquid"}
        </button>
        <button type="button" className={styles.btn} onClick={() => captureHyperliquid(true)} disabled={busy != null || !isEvmWallet}>
          Use Hyperliquid as target
        </button>
        <button type="button" className={styles.btn} onClick={load} disabled={busy != null}>
          {busy === "load" ? "Loading..." : "Refresh"}
        </button>
      </div>

      {targetHoldings.length ? (
        <div className={styles.practiceTable} aria-label="Shared practice target holdings">
          <div className={styles.practiceRowHead}>
            <span>Target</span>
            <span>Qty</span>
            <span>Notional</span>
            <span>Source</span>
          </div>
          {targetHoldings.map((holding) => (
            <div className={styles.practiceRow} key={holding.id}>
              <span><strong>{holding.symbol}</strong><small>{holdingLabel(holding)}</small></span>
              <span>{amount(holding.quantity)}</span>
              <span>{money(holding.notionalUsd)}</span>
              <span>{sourceLabel(holding.source)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty} style={{ padding: "12px 0" }}>No shared target yet. Capture Alpaca paper, sync Hyperliquid as target, or add a manual target.</p>
      )}

      {snapshots.length ? (
        <div className={styles.practiceSnapshots}>
          {snapshots.map((snapshot) => (
            <span className={styles.pill} key={snapshot.id}>
              {sourceLabel(snapshot.source)} · {snapshot.holdings.length} holding{snapshot.holdings.length === 1 ? "" : "s"}
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.practiceManual}>
        <div className={styles.field}>
          <label className={styles.label}>Asset</label>
          <select className={styles.select} value={symbol} onChange={(event) => setSymbol(event.target.value as (typeof MANUAL_ASSETS)[number])}>
            {MANUAL_ASSETS.map((asset) => <option key={asset} value={asset}>{asset}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Book</label>
          <select
            className={styles.select}
            value={marketType}
            onChange={(event) => {
              const next = event.target.value as CryptoPracticeMarketType;
              setMarketType(next);
              if (next === "spot") setSide("long");
            }}
          >
            <option value="spot">Spot</option>
            <option value="perp">Perp</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Side</label>
          <select className={styles.select} value={side} onChange={(event) => setSide(event.target.value as CryptoPracticeSide)} disabled={marketType === "spot"}>
            <option value="long">{marketType === "spot" ? "Long" : "Long"}</option>
            {marketType === "perp" ? <option value="short">Short</option> : null}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Notional USD</label>
          <input className={styles.input} inputMode="decimal" value={notional} onChange={(event) => setNotional(event.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Quantity</label>
          <input className={styles.input} inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
      </div>

      <div className={styles.practiceActions}>
        <button type="button" className={styles.btn} onClick={saveManual} disabled={busy != null || (!Number(notional) && !Number(quantity))}>
          {busy === "manual" ? "Saving..." : "Save manual target"}
        </button>
        <button type="button" className={styles.btn} onClick={buildPlan} disabled={busy != null || !isEvmWallet || !targetHoldings.length}>
          {busy === "plan" ? "Planning..." : "Plan Hyperliquid replay"}
        </button>
        <button type="button" className={styles.btnDanger} onClick={clearTarget} disabled={busy != null || !targetHoldings.length}>
          {busy === "clear" ? "Clearing..." : "Clear target"}
        </button>
      </div>

      {plan ? (
        <div className={styles.practicePlan}>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Replay orders</span><span className={styles.reviewVal}>{executableOrders.length}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Total notional</span><span className={styles.reviewVal}>{money(plan.totalNotionalUsd)}</span></div>
          <div className={styles.reviewLine}><span className={styles.reviewKey}>Network</span><span className={styles.reviewVal}>{plan.network || "Current Hyperliquid policy"}</span></div>
          {executableOrders.map((order, index) => (
            <div className={styles.reviewLine} key={`${order.sourceHoldingId}-${index}`}>
              <span className={styles.reviewKey}>{order.coin}</span>
              <span className={styles.reviewVal}>{order.marketType} {order.side} {money(order.notionalUsd)}{order.reduceOnly ? " · reduce only" : ""}</span>
            </div>
          ))}
          {unsupportedOrders.map((order, index) => (
            <p className={styles.error} key={`unsupported-${order.sourceHoldingId}-${index}`}>{order.missing}</p>
          ))}
          {executableOrders.length ? (
            <div className={styles.actions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={executePlan} disabled={busy != null}>
                {busy === "execute" ? "Submitting..." : "Confirm & replay on Hyperliquid"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
      {success ? <p className={styles.success}>{success}</p> : null}
    </div>
  );
}
