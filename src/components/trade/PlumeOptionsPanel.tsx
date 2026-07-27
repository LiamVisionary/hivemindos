"use client";

import React from "react";

import type {
  PlumeMarketStatus,
  PlumeOffer,
  PlumeOptionKind,
  PlumeOptionsSnapshot,
  PlumePosition,
} from "@/lib/config/plume-options";
import type {
  PlumeActionReview,
  PlumeOptionAction,
  PlumeOptionActionName,
} from "@/lib/services/trading/plume-options-domain";
import styles from "./PlumeOptionsPanel.module.css";
import { useTradeDesk } from "./trade-context";

type PanelMode = "browse" | "write" | "positions";
type Symbol = "TSLA" | "AMD";

type ReviewPayload = PlumeActionReview & {
  marketAddress: string;
  spendUsd: number;
  approvalSymbol?: string;
  approvalDecimals?: number;
  approvalAmountAtomic?: string;
  reviewFingerprint: string;
};

type ResponsePayload = {
  ok?: boolean;
  snapshot?: PlumeOptionsSnapshot;
  review?: ReviewPayload;
  result?: { explorerUrl?: string; transactionHash?: string };
  error?: string;
};

const ACTION_LABELS: Record<PlumeOptionActionName, string> = {
  write: "Write options",
  buy: "Buy option",
  cancel: "Cancel offer",
  "buy-to-close": "Buy to close",
  exercise: "Exercise",
  settle: "Settle series",
  "settle-worthless": "Settle worthless",
  redeem: "Redeem payout",
  reclaim: "Reclaim collateral",
};

// ── formatting helpers ────────────────────────────────────────────────────
function num(value: number | string | null | undefined, digits = 4) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(parsed);
}

function usd(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(parsed);
}

function dateLabel(expirySeconds: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(expirySeconds * 1_000));
}

function daysBetween(fromSeconds: number, toSeconds: number) {
  return Math.round((toSeconds - fromSeconds) / 86_400);
}

function relativeTime(iso: string | null, nowSeconds: number) {
  if (!iso) return null;
  const then = Math.floor(new Date(iso).getTime() / 1_000);
  if (!Number.isFinite(then)) return null;
  const delta = Math.max(0, nowSeconds - then);
  if (delta < 60) return "updated just now";
  if (delta < 3_600) return `updated ${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `updated ${Math.floor(delta / 3_600)}h ago`;
  return `updated ${Math.floor(delta / 86_400)}d ago`;
}

function shortAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function nextExpiry(days: number) {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(20, 0, 0, 0);
  return Math.floor(date.getTime() / 1_000);
}

type Tone = { label: string; color: string; bg: string; border: string };

function moneyness(kind: PlumeOptionKind, spot: number | null, strike: number): Tone {
  if (spot == null) return { label: "Spot unavailable", color: "var(--fg-3)", bg: "transparent", border: "var(--line-2)" };
  const itm = kind === "call" ? spot > strike : spot < strike;
  return itm
    ? { label: "In the money", color: "var(--live)", bg: "var(--live-soft)", border: "color-mix(in srgb,var(--live) 35%,transparent)" }
    : { label: "Out of the money", color: "var(--fg-3)", bg: "transparent", border: "var(--line-2)" };
}

// ── shared inline style fragments (ported from the design) ────────────────
const kicker: React.CSSProperties = { font: "500 10px var(--f-mono)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--fg-3)" };
const microLabel: React.CSSProperties = { font: "9px var(--f-mono)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--fg-4)" };
const badgeBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, font: "600 11px var(--f-body)", whiteSpace: "nowrap" };

function Badge({ tone, children }: { tone: "live" | "warning" | "secondary"; children: React.ReactNode }) {
  const map: Record<string, React.CSSProperties> = {
    live: { background: "var(--live-soft)", color: "var(--live)", border: "1px solid color-mix(in srgb,var(--live) 35%,transparent)" },
    warning: { background: "var(--warning-soft)", color: "var(--warning)", border: "1px solid var(--honey-line)" },
    secondary: { background: "transparent", color: "var(--fg-3)", border: "1px solid var(--line-2)" },
  };
  return <span style={{ ...badgeBase, ...map[tone] }}>{children}</span>;
}

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span style={{ position: "relative", width: 10, height: 10, flex: "0 0 auto", display: "inline-grid", placeItems: "center" }}>
      {pulse ? <span style={{ position: "absolute", inset: -3, borderRadius: 99, background: color, opacity: .25 }} className={styles.anim} /> : null}
      <span style={{ width: 8, height: 8, borderRadius: 99, background: color }} />
    </span>
  );
}

function OptionsSkeleton() {
  return (
    <section aria-label="Discovering Plume option markets" role="status" style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 8 }}>
      <span className={styles.skel} style={{ width: "34%", height: 44 }} />
      <span className={styles.skel} style={{ width: "100%", height: 84, borderRadius: 14 }} />
      <span className={styles.skel} style={{ width: "100%", height: 120, borderRadius: 14 }} />
      <div className={styles.offerGrid}>
        {[0, 1, 2].map((i) => <span key={i} className={styles.skel} style={{ height: 250, borderRadius: 14 }} />)}
      </div>
    </section>
  );
}

// ── attention band model (derived across ALL markets) ─────────────────────
type AttentionItem = {
  key: string;
  tone: "warning" | "live";
  tag: string;
  tagColor: string;
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
};

export function PlumeOptionsPanel() {
  const desk = useTradeDesk();
  const [snapshot, setSnapshot] = React.useState<PlumeOptionsSnapshot | null>(null);
  const [mode, setMode] = React.useState<PanelMode>("browse");
  const [symbol, setSymbol] = React.useState<Symbol>("TSLA");
  const [kind, setKind] = React.useState<PlumeOptionKind>("call");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [pendingAction, setPendingAction] = React.useState<PlumeOptionAction | null>(null);
  const [review, setReview] = React.useState<ReviewPayload | null>(null);
  const [attested, setAttested] = React.useState(false);
  const [writeAmount, setWriteAmount] = React.useState("1");
  const [strike, setStrike] = React.useState("200");
  const [premium, setPremium] = React.useState("5");
  const [offerAmounts, setOfferAmounts] = React.useState<Record<string, string>>({});
  const [expiryOptions] = React.useState(() => [3, 7, 14, 29].map((days) => ({ days, value: nextExpiry(days) })));
  const [expiry, setExpiry] = React.useState(() => expiryOptions[1].value);
  const [nowSeconds] = React.useState(() => Math.floor(Date.now() / 1_000));

  React.useEffect(() => {
    const controller = new AbortController();
    const query = desk.agentId ? `?agentId=${encodeURIComponent(desk.agentId)}` : "";
    fetch(`/api/trading/plume${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as ResponsePayload;
        if (!response.ok || !payload.ok || !payload.snapshot) throw new Error(payload.error || "Plume markets are unavailable.");
        setError("");
        setSnapshot(payload.snapshot);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Plume markets are unavailable.");
      });
    return () => controller.abort();
  }, [desk.agentId, reloadKey]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/trading/plume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as ResponsePayload;
    if (!response.ok || !payload.ok) throw new Error(payload.error || "The Plume action failed.");
    return payload;
  }

  async function prepare(action: PlumeOptionAction) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await post({ mode: "prepare", agentId: desk.agentId, action });
      if (!payload.review) throw new Error("The server did not return an option review.");
      setPendingAction(action);
      setReview(payload.review);
      setAttested(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Plume action could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!pendingAction || !review) return;
    setBusy(true);
    setError("");
    try {
      const payload = await post({
        mode: "execute",
        agentId: desk.agentId,
        action: pendingAction,
        confirmation: review.confirmation,
        reviewFingerprint: review.reviewFingerprint,
        jurisdictionAttestation: attested,
      });
      setNotice(payload.result?.transactionHash
        ? `The option action was confirmed on testnet: ${shortAddress(payload.result.transactionHash)}`
        : "The option action was confirmed on testnet.");
      setPendingAction(null);
      setReview(null);
      setAttested(false);
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The Plume action could not be executed.");
    } finally {
      setBusy(false);
    }
  }

  function focusMarket(target: Symbol, targetKind: PlumeOptionKind) {
    setSymbol(target);
    setKind(targetKind);
    setMode("positions");
  }

  if (!snapshot && !error) return <OptionsSkeleton />;
  if (!snapshot) {
    return (
      <section className={`${styles.card} ${styles.anim}`} aria-live="polite" style={{ padding: "40px 28px", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <span style={kicker}>Plume options · testnet</span>
        <h2 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 24, letterSpacing: "-.02em" }}>Market discovery is unavailable.</h2>
        <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 13 }}>{error}</p>
        <button type="button" className={`${styles.btn} ${styles.btnOutline}`} onClick={() => { setError(""); setReloadKey((value) => value + 1); }}>Try again</button>
      </section>
    );
  }

  const testnet = snapshot.status.testnet;
  const source = snapshot.status.source;
  const allMarkets = testnet.markets;
  const marketOf = (sym: string, k: PlumeOptionKind): PlumeMarketStatus | undefined => allMarkets.find((m) => m.symbol === sym && m.kind === k);
  const selectedMarket = marketOf(symbol, kind);
  const spot = selectedMarket?.spotPrice != null ? Number(selectedMarket.spotPrice) : null;
  const offers = snapshot.offers.filter((offer) => offer.symbol === symbol && offer.kind === kind);
  const positions = snapshot.positions.filter((position) => position.symbol === symbol && position.kind === kind);
  const canExecute = Boolean(testnet.executionEnabled && snapshot.wallet?.canSign && desk.agentId);
  const restricted = source.jurisdictionRestrictions.join(", ");
  const now = nowSeconds;

  const availableSymbols = Array.from(new Set(allMarkets.map((m) => m.symbol))) as Symbol[];

  // Needs-your-attention: the next safe action across every market the wallet
  // touches. Every item drives the same real prepare/execute review flow.
  const attention: AttentionItem[] = [];
  for (const p of snapshot.positions) {
    const key = `${p.marketAddress}:${p.seriesId}`;
    const holder = Number(p.holderBalance) || 0;
    const writerUnassigned = Number(p.writerUnassigned) || 0;
    const reclaimable = Number(p.writerReclaimable) || 0;
    const expired = p.expiry <= now;
    const title = `${p.symbol} ${usd(p.strikePrice)} ${p.kind}`;
    if (!p.settled && !expired && holder > 0 && p.expiry - now <= 3 * 86_400) {
      const days = Math.max(0, daysBetween(now, p.expiry));
      attention.push({
        key: `${key}:exercise`, tone: "warning", tag: days <= 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`, tagColor: "var(--warning)",
        title, body: `You hold ${num(p.holderBalance)} options. Decide whether to exercise before they expire, or let them settle.`,
        actionLabel: "Exercise",
        onAction: () => { focusMarket(p.symbol as Symbol, p.kind); void prepare({ action: "exercise", symbol: p.symbol, kind: p.kind, seriesId: p.seriesId, amount: p.holderBalance }); },
      });
    }
    if (expired && !p.settled) {
      attention.push({
        key: `${key}:settle`, tone: "warning", tag: "Awaiting settlement", tagColor: "var(--warning)",
        title, body: "This series has expired and can be settled against the earliest valid oracle round.",
        actionLabel: "Settle",
        onAction: () => { focusMarket(p.symbol as Symbol, p.kind); void prepare({ action: "settle", symbol: p.symbol, kind: p.kind, seriesId: p.seriesId }); },
      });
    }
    if (p.settled && holder > 0) {
      attention.push({
        key: `${key}:redeem`, tone: "live", tag: "Payout ready", tagColor: "var(--live)",
        title, body: `${num(p.holderBalance)} settled options are ready to redeem for their cash payout.`,
        actionLabel: "Redeem",
        onAction: () => { focusMarket(p.symbol as Symbol, p.kind); void prepare({ action: "redeem", symbol: p.symbol, kind: p.kind, seriesId: p.seriesId, amount: p.holderBalance }); },
      });
    }
    if (reclaimable > 0 || (p.settled && writerUnassigned > 0)) {
      attention.push({
        key: `${key}:reclaim`, tone: "live", tag: "Collateral ready", tagColor: "var(--live)",
        title, body: `${num(reclaimable || writerUnassigned)} of released collateral is ready to reclaim to your wallet.`,
        actionLabel: "Reclaim",
        onAction: () => { focusMarket(p.symbol as Symbol, p.kind); void prepare({ action: "reclaim", symbol: p.symbol, kind: p.kind, seriesId: p.seriesId }); },
      });
    }
  }
  const attentionOff = !snapshot.wallet?.canSign || !desk.agentId;

  const contextLabel = `${symbol} · ${kind === "call" ? "covered calls" : "cash-secured puts"} · spot ${spot != null ? usd(spot) : "—"}`;
  const spotUpdated = relativeTime(selectedMarket?.spotUpdatedAt ?? null, now);

  // Write summary (real, from the current form inputs + market status).
  const writeAmountNum = Number(writeAmount) || 0;
  const strikeNum = Number(strike) || 0;
  const premiumNum = Number(premium) || 0;
  const lockLabel = kind === "call" ? `${num(writeAmountNum)} ${symbol}` : `${num(strikeNum * writeAmountNum)} USDG`;
  const collectLabel = `${num(premiumNum * writeAmountNum)} USDG`;
  const assignedIf = kind === "call"
    ? `${symbol} settles above ${usd(strikeNum)}`
    : `${symbol} settles below ${usd(strikeNum)}`;
  const locked = Number(selectedMarket?.lockedAmount);
  const maxCollateral = Number(selectedMarket?.maxCollateral);
  const capacityPct = Number.isFinite(locked) && Number.isFinite(maxCollateral) && maxCollateral > 0
    ? Math.min(100, Math.round((locked / maxCollateral) * 100))
    : 0;
  const collateralBody = kind === "call"
    ? "Your stock tokens stay locked until the offer is cancelled or the obligation is closed, assigned, or settled. Nothing can be spent beyond this collateral."
    : "Put collateral is strike-scaled USDG. Plume rounds up so the maximum payout stays fully covered — you can never owe more than you locked.";

  return (
    <section aria-labelledby="plume-options-title" style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 4 }}>

      {/* Compact status header */}
      <section style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 28, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...kicker, marginBottom: 10 }}>Plume protocol · Robinhood Chain testnet</div>
          <h1 id="plume-options-title" style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 38, letterSpacing: "-.03em", lineHeight: 1 }}>Options</h1>
          <p style={{ margin: "11px 0 0", maxWidth: 560, color: "var(--fg-2)", fontSize: 13.5, lineHeight: 1.6 }}>Fully collateralized covered calls and cash-secured puts. Browse offers, write your own, and manage every position from your governed local wallet.</p>
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          {testnet.health === "verified" && testnet.executionEnabled
            ? <Badge tone="live">Testnet · execution verified</Badge>
            : <Badge tone="warning">Testnet · read-only while degraded</Badge>}
          <Badge tone="warning">Mainnet · rollout pending</Badge>
          <Badge tone="secondary">No platform fee · keys stay local</Badge>
        </div>
      </section>

      {/* Market context bar */}
      <section className={styles.card} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap", padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
          <div className={styles.seg}>
            {availableSymbols.map((sym) => (
              <button type="button" key={sym} className={styles.tab} data-on={symbol === sym ? "1" : "0"} onClick={() => setSymbol(sym)}>{sym}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ ...microLabel, letterSpacing: ".1em" }}>Spot price</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
              <strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 26, letterSpacing: "-.02em" }}>{spot != null ? usd(spot) : "Unavailable"}</strong>
              {spotUpdated ? <span style={{ font: "500 11px var(--f-mono)", color: "var(--fg-3)" }}>{spotUpdated}</span> : null}
            </span>
          </div>
        </div>
        <div className={styles.seg}>
          <button type="button" className={styles.tab} data-on={kind === "call" ? "1" : "0"} onClick={() => setKind("call")}>Covered calls</button>
          <button type="button" className={styles.tab} data-on={kind === "put" ? "1" : "0"} onClick={() => setKind("put")}>Cash-secured puts</button>
        </div>
      </section>

      {/* Needs your attention */}
      <section className={`${styles.card} ${styles.anim}`} style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 22px", borderBottom: "1px solid var(--line)" }}>
          <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15, letterSpacing: "-.01em" }}>Needs your attention</span>
          <span style={{ ...microLabel, letterSpacing: ".08em" }}>across all markets</span>
          <span style={{ marginLeft: "auto" }}>
            {attention.length === 0
              ? <Badge tone="live">All clear</Badge>
              : <Badge tone="warning">{attention.length} item{attention.length > 1 ? "s" : ""}</Badge>}
          </span>
        </div>
        {attention.length > 0 ? (
          <div>
            {attention.map((item) => (
              <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
                <Dot color={item.tone === "warning" ? "var(--warning)" : "var(--live)"} pulse={item.tone === "warning"} />
                <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <strong style={{ font: "600 14px var(--f-body)", letterSpacing: "-.01em" }}>{item.title}</strong>
                    <span style={{ font: "500 9.5px var(--f-mono)", letterSpacing: ".06em", textTransform: "uppercase", color: item.tagColor }}>{item.tag}</span>
                  </div>
                  <p style={{ margin: "4px 0 0", color: "var(--fg-2)", fontSize: 12.5, lineHeight: 1.55 }}>{item.body}</p>
                </div>
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!canExecute || busy} onClick={item.onAction}>{item.actionLabel}</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 22 }}>
            <Dot color="var(--live)" />
            <div>
              <strong style={{ font: "600 14px var(--f-body)" }}>All clear</strong>
              <p style={{ margin: "3px 0 0", color: "var(--fg-3)", fontSize: 12.5 }}>
                {attentionOff
                  ? "Connect a local EVM signer to surface expiring positions, redeemable payouts, and reclaimable collateral."
                  : "No expiring positions, redeemable payouts, or reclaimable collateral right now."}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Safety + status bands (real gating) */}
      {testnet.issues.length ? (
        <div className={styles.card} style={{ padding: "13px 18px", borderColor: "var(--honey-line)", background: "var(--warning-soft)", color: "var(--warning)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}>
          <Dot color="var(--warning)" /><span><strong>Execution paused.</strong> {testnet.issues.join(" ")}</span>
        </div>
      ) : null}
      {!snapshot.wallet?.canSign ? (
        <div className={styles.card} style={{ padding: "13px 18px", borderColor: "var(--honey-line)", background: "var(--warning-soft)", color: "var(--warning)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}>
          <Dot color="var(--warning)" /><span><strong>Local EVM signer required.</strong> Select or import a local EVM wallet — the same address signs against Robinhood Chain testnet; no key leaves this device.</span>
        </div>
      ) : null}
      {notice ? (
        <div className={styles.card} style={{ padding: "13px 18px", borderColor: "color-mix(in srgb,var(--live) 35%,transparent)", background: "color-mix(in srgb,var(--live) 9%,transparent)", color: "var(--live)", fontSize: 12.5, display: "flex", alignItems: "center", gap: 10 }}>
          <Dot color="var(--live)" />{notice}
        </div>
      ) : null}
      {error && !review ? (
        <div className={styles.card} style={{ padding: "13px 18px", borderColor: "color-mix(in srgb,var(--danger) 35%,transparent)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12.5 }} role="alert">{error}</div>
      ) : null}

      {/* Mode tabs */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 2 }}>
        <div className={styles.seg}>
          <button type="button" className={styles.tab} data-on={mode === "browse" ? "1" : "0"} onClick={() => setMode("browse")}>Browse offers</button>
          <button type="button" className={styles.tab} data-on={mode === "write" ? "1" : "0"} onClick={() => setMode("write")}>Write options</button>
          <button type="button" className={styles.tab} data-on={mode === "positions" ? "1" : "0"} onClick={() => setMode("positions")}>My positions</button>
        </div>
        <span style={{ font: "500 11px var(--f-mono)", color: "var(--fg-4)" }}>{contextLabel}</span>
      </div>

      {/* BROWSE */}
      {mode === "browse" ? (
        <section className={styles.anim}>
          {offers.length > 0 ? (
            <div className={styles.offerGrid}>
              {offers.map((offer: PlumeOffer) => {
                const offerKey = `${offer.marketAddress}:${offer.offerId}`;
                const strikeVal = Number(offer.strikePrice);
                const premiumVal = Number(offer.premiumPerOption);
                const m = moneyness(kind, spot, strikeVal);
                const be = kind === "call" ? strikeVal + premiumVal : strikeVal - premiumVal;
                const diff = spot != null ? spot - strikeVal : null;
                const selectedAmount = offerAmounts[offerKey] ?? offer.remaining;
                const days = daysBetween(now, offer.expiry);
                return (
                  <article key={offerKey} className={`${styles.card} ${styles.offer}`} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 15 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ ...microLabel, letterSpacing: ".1em" }}>{symbol} {kind.toUpperCase()} · offer #{offer.offerId}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
                          <strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 30, letterSpacing: "-.03em" }}>{usd(strikeVal)}</strong>
                          <span style={{ fontSize: 11, color: "var(--fg-3)" }}>strike</span>
                        </div>
                      </div>
                      <span style={{ padding: "3px 10px", borderRadius: 999, font: "600 11px var(--f-body)", background: m.bg, color: m.color, border: `1px solid ${m.border}`, whiteSpace: "nowrap" }}>{m.label}</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, font: "500 11px var(--f-mono)", color: "var(--fg-3)" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 99, background: m.color, flex: "0 0 auto" }} />
                      {diff != null ? `Spot ${usd(spot)} · ${diff >= 0 ? "+" : "−"}${usd(Math.abs(diff))} vs strike` : "Spot unavailable"}
                    </div>

                    <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 12.5, lineHeight: 1.6 }}>
                      {kind === "call" ? `Right to buy ${symbol} at ${usd(strikeVal)} any time before expiry.` : `Right to sell ${symbol} at ${usd(strikeVal)} any time before expiry.`}
                    </p>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
                      <div style={{ padding: "10px 12px", background: "var(--panel-2)" }}><div style={microLabel}>Premium</div><div style={{ marginTop: 4, font: "500 13px var(--f-body)", color: "var(--honey)" }}>{num(offer.premiumPerOption)} USDG</div></div>
                      <div style={{ padding: "10px 12px", background: "var(--panel-2)" }}><div style={microLabel}>Break-even</div><div style={{ marginTop: 4, font: "500 13px var(--f-body)" }}>{usd(be)}</div></div>
                      <div style={{ padding: "10px 12px", background: "var(--panel-2)" }}><div style={microLabel}>Expires</div><div style={{ marginTop: 4, font: "500 13px var(--f-body)" }}>{days <= 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</div></div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, ...microLabel, letterSpacing: ".05em" }}>
                      <span>{num(offer.remaining)} available</span><span>{dateLabel(offer.expiry)}</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, paddingTop: 3 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 96 }}>
                        <span style={microLabel}>Amount</span>
                        <input className={styles.field} type="number" min="0.000001" max={offer.remaining} step="0.1" value={selectedAmount} onChange={(event) => setOfferAmounts((current) => ({ ...current, [offerKey]: event.target.value }))} />
                      </label>
                      <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: "1 1 auto" }} disabled={!canExecute || busy} onClick={() => void prepare({ action: "buy", symbol: offer.symbol, kind: offer.kind, offerId: offer.offerId, amount: selectedAmount })}>Review buy</button>
                      {offer.ownedByWallet ? <button type="button" className={`${styles.btn} ${styles.btnOutline}`} disabled={!canExecute || busy} onClick={() => void prepare({ action: "cancel", symbol: offer.symbol, kind: offer.kind, offerId: offer.offerId, amount: selectedAmount })}>Cancel</button> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.card} style={{ padding: "56px 24px", textAlign: "center" }}>
              <strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 19 }}>No open offers</strong>
              <p style={{ maxWidth: 460, margin: "9px auto 0", color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.6 }}>No active {symbol} {kind} offers were found in the pinned contracts. Switch the underlying or option type, or write your own offer.</p>
            </div>
          )}
        </section>
      ) : null}

      {/* WRITE */}
      {mode === "write" ? (
        <section className={`${styles.anim} ${styles.writeGrid}`}>
          <div className={styles.card} style={{ padding: 26, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingBottom: 14, borderBottom: "1px solid var(--line)" }}>
              <span style={{ ...microLabel, letterSpacing: ".09em", fontSize: 10, color: "var(--fg-3)" }}>{kind === "call" ? "Covered call" : "Cash-secured put"}</span>
              <strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 26, letterSpacing: "-.03em" }}>{symbol}</strong>
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-2)" }}>Option amount</span><input className={styles.field} type="number" min="0.000001" step="0.1" value={writeAmount} onChange={(event) => setWriteAmount(event.target.value)} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-2)" }}>Strike price (USD)</span><input className={styles.field} type="number" min="0.01" step="0.01" value={strike} onChange={(event) => setStrike(event.target.value)} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-2)" }}>Premium per option (USDG)</span><input className={styles.field} type="number" min="0.000001" step="0.01" value={premium} onChange={(event) => setPremium(event.target.value)} /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 7 }}><span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-2)" }}>Expiry</span>
              <select className={styles.field} value={expiry} onChange={(event) => setExpiry(Number(event.target.value))}>
                {expiryOptions.map((option) => <option key={option.days} value={option.value}>{option.days} days · {dateLabel(option.value)}</option>)}
              </select>
            </label>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} style={{ height: 42, marginTop: 4 }} disabled={!canExecute || busy} onClick={() => void prepare({ action: "write", symbol, kind, strikePrice: strike, expiry, amount: writeAmount, premiumPerOption: premium })}>Review write</button>
          </div>
          <div className={styles.card} style={{ padding: 26, display: "flex", flexDirection: "column", gap: 16, background: "var(--panel-2)" }}>
            <span style={{ ...microLabel, letterSpacing: ".09em", fontSize: 10, color: "var(--fg-3)" }}>What you&apos;re committing</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--fg-2)", fontSize: 12.5 }}>You lock (collateral)</span><strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 19, letterSpacing: "-.02em" }}>{lockLabel}</strong></div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--fg-2)", fontSize: 12.5 }}>You collect now</span><strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 19, letterSpacing: "-.02em", color: "var(--honey)" }}>{collectLabel}</strong></div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}><span style={{ color: "var(--fg-2)", fontSize: 12.5 }}>Assigned if</span><strong style={{ font: "500 13px var(--f-body)" }}>{assignedIf}</strong></div>
            </div>
            <div style={{ height: 1, background: "var(--line)" }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                <span style={{ ...microLabel, color: "var(--fg-3)" }}>Contract capacity</span>
                <span style={{ font: "500 11px var(--f-mono)", color: "var(--fg-3)" }}>{Number.isFinite(locked) && Number.isFinite(maxCollateral) ? `${num(locked)} / ${num(maxCollateral)} ${selectedMarket?.collateralUnit ?? ""}` : `${capacityPct}%`}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: "var(--line-2)", overflow: "hidden" }}>
                <div style={{ width: `${capacityPct}%`, height: "100%", borderRadius: 99, background: "var(--honey)", transition: "width .3s" }} />
              </div>
            </div>
            <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 12, lineHeight: 1.65 }}>{collateralBody}</p>
          </div>
        </section>
      ) : null}

      {/* POSITIONS */}
      {mode === "positions" ? (
        <section className={styles.anim} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {positions.length > 0 ? positions.map((position: PlumePosition) => {
            const positionKey = `${position.marketAddress}:${position.seriesId}`;
            const expired = position.expiry <= now;
            const holder = Number(position.holderBalance) || 0;
            const writerUnassigned = Number(position.writerUnassigned) || 0;
            const reclaimable = Number(position.writerReclaimable) || 0;
            const closable = Math.min(holder, writerUnassigned);
            const status: Tone = position.settled
              ? { label: "Settled", color: "var(--fg-3)", bg: "transparent", border: "var(--line-2)" }
              : expired
                ? { label: "Awaiting settlement", color: "var(--warning)", bg: "var(--warning-soft)", border: "var(--honey-line)" }
                : position.expiry - now <= 3 * 86_400
                  ? { label: "Expiring soon", color: "var(--warning)", bg: "var(--warning-soft)", border: "var(--honey-line)" }
                  : { label: "Open", color: "var(--live)", bg: "var(--live-soft)", border: "color-mix(in srgb,var(--live) 35%,transparent)" };
            const expiryText = position.settled ? `Settled · ${dateLabel(position.expiry)}` : expired ? `Expired ${dateLabel(position.expiry)}` : `Expires ${dateLabel(position.expiry)}`;

            type Btn = { label: string; primary: boolean; run: () => void; disabled?: boolean };
            const buttons: Btn[] = [];
            if (!expired && holder > 0) buttons.push({ label: "Exercise", primary: true, run: () => void prepare({ action: "exercise", symbol: position.symbol, kind: position.kind, seriesId: position.seriesId, amount: position.holderBalance }) });
            if (!expired && closable > 0) buttons.push({ label: "Buy to close", primary: buttons.length === 0, run: () => void prepare({ action: "buy-to-close", symbol: position.symbol, kind: position.kind, seriesId: position.seriesId, amount: String(closable) }) });
            if (expired && !position.settled) buttons.push({ label: "Settle", primary: buttons.length === 0, run: () => void prepare({ action: "settle", symbol: position.symbol, kind: position.kind, seriesId: position.seriesId }) });
            if (expired && !position.settled && now > position.expiry + 86_400) buttons.push({ label: "Fallback settlement", primary: false, run: () => void prepare({ action: "settle-worthless", symbol: position.symbol, kind: position.kind, seriesId: position.seriesId }) });
            if (position.settled && holder > 0) buttons.push({ label: "Redeem payout", primary: buttons.length === 0, run: () => void prepare({ action: "redeem", symbol: position.symbol, kind: position.kind, seriesId: position.seriesId, amount: position.holderBalance }) });
            if (reclaimable > 0 || (position.settled && writerUnassigned > 0)) buttons.push({ label: "Reclaim collateral", primary: buttons.length === 0, run: () => void prepare({ action: "reclaim", symbol: position.symbol, kind: position.kind, seriesId: position.seriesId }) });

            return (
              <article key={positionKey} className={styles.card} style={{ padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span style={{ padding: "3px 10px", borderRadius: 999, font: "600 11px var(--f-body)", background: status.bg, color: status.color, border: `1px solid ${status.border}` }}>{status.label}</span>
                    <strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 20, letterSpacing: "-.02em" }}>{position.symbol} · {usd(position.strikePrice)} {position.kind.toUpperCase()}</strong>
                  </div>
                  <span style={{ ...microLabel, letterSpacing: ".05em" }}>{expiryText}</span>
                </div>
                <div style={{ display: "flex", gap: 26, flexWrap: "wrap", margin: "16px 0 4px" }}>
                  <div><div style={microLabel}>Holder</div><div style={{ marginTop: 4, font: "500 14px var(--f-body)" }}>{num(position.holderBalance)}</div></div>
                  <div><div style={microLabel}>Writer open</div><div style={{ marginTop: 4, font: "500 14px var(--f-body)" }}>{num(position.writerUnassigned)}</div></div>
                  <div><div style={microLabel}>Assigned</div><div style={{ marginTop: 4, font: "500 14px var(--f-body)" }}>{num(position.writerAssigned)}</div></div>
                  <div><div style={microLabel}>Reclaimable</div><div style={{ marginTop: 4, font: "500 14px var(--f-body)" }}>{num(position.writerReclaimable)}</div></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", paddingTop: 14, marginTop: 6, borderTop: "1px solid var(--line)" }}>
                  {buttons.map((btn) => (
                    <button key={btn.label} type="button" className={`${styles.btn} ${btn.primary ? styles.btnPrimary : styles.btnOutline}`} disabled={!canExecute || busy || btn.disabled} onClick={btn.run}>{btn.label}</button>
                  ))}
                  <a href={`${testnet.explorerUrl}/address/${position.marketAddress}`} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", font: "500 11px var(--f-mono)", color: "var(--fg-3)" }}>View contract ↗</a>
                </div>
              </article>
            );
          }) : (
            <div className={styles.card} style={{ padding: "56px 24px", textAlign: "center" }}>
              <strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 19 }}>No active positions</strong>
              <p style={{ maxWidth: 460, margin: "9px auto 0", color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.6 }}>The acting wallet has no {symbol} {kind} holder balance, writer obligation, or reclaimable collateral.</p>
            </div>
          )}
        </section>
      ) : null}

      {/* Footer trust line */}
      <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap", padding: "20px 2px 0", borderTop: "1px solid var(--line)", marginTop: 6 }}>
        <p style={{ maxWidth: 600, margin: 0, color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.6 }}>Testnet execution uses the pinned Plume contracts and your wallet&apos;s encrypted local signer. HivemindOS adds no platform fee. Mainnet stays fail-closed until its registry and audit are public and reviewed.</p>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <a href={source.docsUrl} target="_blank" rel="noreferrer" className={`${styles.btn} ${styles.btnOutline}`}>Read Plume docs ↗</a>
          <a href={source.registryUrl} target="_blank" rel="noreferrer" className={`${styles.btn} ${styles.btnOutline}`}>Review pinned registry ↗</a>
        </div>
      </footer>

      {/* Review + attest safety gate */}
      {review && pendingAction ? (
        <div role="dialog" aria-modal="true" aria-labelledby="po-review-title" style={{ position: "fixed", inset: 0, zIndex: 120, display: "grid", placeItems: "center", padding: 24, background: "color-mix(in srgb,#05070b 78%,transparent)", backdropFilter: "blur(8px)" }}>
          <div className={styles.anim} style={{ width: "min(540px,100%)", maxHeight: "calc(100vh - 48px)", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--line-2)", borderRadius: 16, padding: 30, boxShadow: "0 34px 90px -38px rgba(0,0,0,.9)" }}>
            <div style={{ ...kicker, letterSpacing: ".11em" }}>Authoritative action review</div>
            <h3 id="po-review-title" style={{ margin: "9px 0 0", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 28, letterSpacing: "-.03em" }}>{ACTION_LABELS[review.action]}</h3>
            <p style={{ margin: "9px 0 0", color: "var(--fg-2)", fontSize: 13, lineHeight: 1.6 }}>{review.summary}</p>
            <dl style={{ margin: "20px 0", border: "1px solid var(--line)", borderRadius: 11, overflow: "hidden" }}>
              <ReviewRow term="Network" value="Robinhood Chain testnet (46630)" first />
              <ReviewRow term="Contract" value={shortAddress(review.marketAddress)} mono />
              {review.spendUsd > 0 ? <ReviewRow term="Approx. locked / spent" value={usd(review.spendUsd)} /> : null}
              {review.collateralAtomic && review.approvalDecimals != null ? <ReviewRow term="Collateral approval" value={`${num((Number(review.collateralAtomic) / 10 ** review.approvalDecimals).toString())} ${review.approvalSymbol ?? ""}`} /> : null}
              {review.seriesId ? <ReviewRow term="Series" value={shortAddress(review.seriesId)} mono /> : null}
              <ReviewRow term="Required confirmation" value={review.confirmation} mono accent />
            </dl>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: 14, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 11, cursor: "pointer", color: "var(--fg-2)", fontSize: 11.5, lineHeight: 1.55 }}>
              <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} style={{ marginTop: 2, accentColor: "var(--honey)", width: 15, height: 15 }} />
              <span>I confirm I am not located in a Plume-restricted jurisdiction ({restricted}) and understand this uses testnet assets.</span>
            </label>
            {error ? <p style={{ margin: "12px 0 0", color: "var(--danger)", fontSize: 11.5, lineHeight: 1.4 }} role="alert">{error}</p> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 20 }}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy} onClick={() => { setReview(null); setPendingAction(null); setAttested(false); }}>Back</button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!canExecute || !attested || busy} onClick={() => void execute()}>
                {busy ? <><span className={styles.spinner} /> Confirming…</> : `Confirm ${ACTION_LABELS[review.action]}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewRow({ term, value, mono, accent, first }: { term: string; value: string; mono?: boolean; accent?: boolean; first?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12, padding: "12px 14px", borderTop: first ? undefined : "1px solid var(--line)" }}>
      <dt style={microLabel}>{term}</dt>
      <dd style={{ margin: 0, textAlign: "right", font: `500 11.5px ${mono ? "var(--f-mono)" : "var(--f-body)"}`, color: accent ? "var(--honey)" : "var(--fg)" }}>{value}</dd>
    </div>
  );
}

export default PlumeOptionsPanel;
