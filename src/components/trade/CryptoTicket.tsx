"use client";

/* CryptoTicket — the redesigned Buy / Sell / Swap order ticket, wired to the
   REAL rails:
     • user / agent wallets → the local DEX swap rail (0x on Base / Jupiter on
       Solana) with a live quote, the hard $10 per-swap cap, and CONFIRM_SWAP.
     • the Bankr-managed wallet → the Bankr natural-language rail (prepare→
       confirm→execute), since it signs on Bankr's own wallet, not a local key.
   No demo numbers: the receive estimate + rate come from a live swap quote. */

import React from "react";
import { Badge, AssetMenu, ChainMenu, ReviewLine } from "./primitives";
import { BIcon } from "./icons";
import { trUsd, trUsd2, trAmt } from "./format";
import { useTradeDesk } from "./trade-context";
import { playTradeSuccessSound } from "./trade-sound";
import { quoteDex, runDexSwap, prepareCapability, executeCapability, type RailResult } from "./rails";
import type { DexSwapQuote } from "@/features/dashboard/views/trade/trade-api";

type Side = "buy" | "sell" | "swap";

export function CryptoTicket() {
  const desk = useTradeDesk();
  const { agentId, walletKind, wallet, swapTokens, cryptoBalances, cryptoPortfolio, swapMaxUsd, onOpenView, network, walletChains, onSelectChain } = desk;
  // Per-token held value (USD) keyed by symbol, shown in the token dropdown in
  // the user's display currency. Sourced from the same portfolio the positions
  // panel uses, so amounts and values agree.
  const usdBySymbol = React.useMemo(
    () => Object.fromEntries((cryptoPortfolio?.rows ?? []).map((row) => [row.sym, row.usd])),
    [cryptoPortfolio],
  );
  const logoBySymbol = React.useMemo(
    () => Object.fromEntries((cryptoPortfolio?.rows ?? []).map((row) => [row.sym, row.logoUrl])),
    [cryptoPortfolio],
  );
  const useBankr = walletKind === "bankr";
  const tokens = swapTokens.length >= 2 ? swapTokens : ["USDC", "ETH"];
  const nonUsdc = tokens.filter((t) => t !== "USDC");
  // Every asset the ACTING wallet actually holds (positive balance), so you can
  // pay with what you own — not just the curated swap list. Pay menu = held
  // first, then the curated tradable set as a fallback; receive menu = the
  // curated set, plus any held token so a holding is selectable on both legs.
  const heldTokens = Object.keys(cryptoBalances).filter((s) => (cryptoBalances[s] || 0) > 0);
  const payOptions = Array.from(new Set([...heldTokens, ...tokens]));
  const recvOptions = Array.from(new Set([...tokens, ...heldTokens]));

  const [side, setSide] = React.useState<Side>("buy");
  const [pay, setPay] = React.useState("USDC");
  const [recv, setRecv] = React.useState(nonUsdc[0] ?? "ETH");
  const [amt, setAmt] = React.useState("");
  const [quote, setQuote] = React.useState<DexSwapQuote | null>(null);
  const [quoting, setQuoting] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "signing" | "done" | "error">("idle");
  const [result, setResult] = React.useState<RailResult | null>(null);

  // Preset pay/recv for the buy/sell legs (buy = USDC→token, sell = token→USDC).
  // These are overridable defaults, not locks — the asset menus still offer every
  // held token. Done on the side click — no effect needed (derive-on-event).
  const changeSide = (s: Side) => {
    setSide(s); setState("idle"); setResult(null); setQuote(null);
    if (s === "buy") { setPay("USDC"); if (recv === "USDC") setRecv(nonUsdc[0] ?? "ETH"); }
    if (s === "sell") { setRecv("USDC"); if (pay === "USDC") setPay(nonUsdc[0] ?? "ETH"); }
  };

  const amtNum = Number(amt) || 0;
  const bal = cryptoBalances[pay] || 0;

  // Live swap quote (price is wallet-agnostic, so we quote for Bankr too). The
  // ref guards against an out-of-order older response overwriting a newer one.
  // State is only set asynchronously (inside the debounce) so the effect never
  // triggers a cascading synchronous render; stale quotes are cleared in the
  // input handlers instead.
  const quoteSeq = React.useRef(0);
  React.useEffect(() => {
    if (!amtNum || pay === recv) return;
    const seq = ++quoteSeq.current;
    let active = true;
    const timer = window.setTimeout(async () => {
      setQuoting(true);
      const response = await quoteDex({ agentId, sellToken: pay, buyToken: recv, amountHuman: amtNum, network });
      if (!active || seq !== quoteSeq.current) return;
      setQuoting(false);
      setQuote(response.ok && response.quote ? response.quote : null);
    }, 450);
    return () => { active = false; window.clearTimeout(timer); };
  }, [agentId, pay, recv, amtNum, network]);

  const payUsd = quote ? quote.valueUsd : 0;
  const recvAmt = quote ? quote.buyAmount : 0;
  const rate = quote && quote.sellAmount ? quote.buyAmount / quote.sellAmount : 0;
  // Per-token USD unit price from the wallet's OWN priced portfolio (value ÷
  // balance). This lets us value the sell leg even when there's no swap quote —
  // e.g. the amount is over the rail's $10 cap, or 0x has thin liquidity for the
  // pair — both of which throw and null the quote, leaving payUsd at 0.
  const unitUsd = (sym: string) => {
    const held = cryptoBalances[sym] || 0;
    const valued = usdBySymbol[sym] || 0;
    return held > 0 && valued > 0 ? valued / held : 0;
  };
  // Sell-leg value: the live quote's USD when we have it (authoritative), else the
  // portfolio-priced estimate so the user always sees what their amount is worth.
  const payUsdEstimate = payUsd || unitUsd(pay) * amtNum;
  const overCap = !useBankr && payUsdEstimate > swapMaxUsd;
  const overWalletCap = useBankr && wallet.cap != null && payUsdEstimate > wallet.cap;

  const setPct = (p: number) => { setAmt(String(+(bal * p).toFixed(pay === "ETH" || pay === "cbBTC" || pay === "BTC" ? 6 : 2))); setState("idle"); setQuote(null); };
  const flip = () => { setSide("swap"); setPay(recv); setRecv(pay); setAmt(""); setQuote(null); setState("idle"); };

  const place = async () => {
    if (!amtNum || state === "signing") return;
    if (pay === recv) { setResult({ ok: false, error: "Pick two different assets." }); setState("error"); return; }
    if (overCap) { setResult({ ok: false, error: `This rail caps swaps at ${trUsd(swapMaxUsd)}. Reduce the amount.` }); setState("error"); return; }
    setState("signing");
    setResult(null);
    let outcome: RailResult;
    if (useBankr) {
      // Bankr signs on its own wallet — route the order as a natural-language
      // intent through the proven Bankr prepare→confirm→execute flow.
      const prompt = side === "swap" ? `swap ${amtNum} ${pay} to ${recv}`
        : side === "buy" ? `buy ${trUsd2(payUsd || amtNum)} of ${recv} with ${pay}`
        : `sell ${amtNum} ${pay} for ${recv}`;
      const prepared = await prepareCapability({ agentId, intent: "trade", wallet: desk.walletConfig ?? undefined, prompt });
      outcome = prepared.ok && prepared.prepared
        ? await executeCapability(prepared.prepared, { intentId: "trade", amountUsd: payUsd })
        : { ok: false, error: prepared.error || "Could not prepare this Bankr order." };
    } else {
      outcome = await runDexSwap({ agentId, sellToken: pay, buyToken: recv, amountHuman: amtNum });
    }
    setResult(outcome);
    setState(outcome.ok ? "done" : "error");
    if (outcome.ok) { playTradeSuccessSound(); setAmt(""); setQuote(null); desk.refresh(); }
  };

  React.useEffect(() => {
    if (state !== "done") return;
    const timer = window.setTimeout(() => { setState("idle"); setResult(null); }, 4000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const sell = side === "sell";
  const label = state === "signing" ? (useBankr ? "Routing…" : "Signing…")
    : state === "done" ? "Order filled"
    : !amtNum ? "Enter an amount"
    : side === "buy" ? `Buy ${recv}` : side === "sell" ? `Sell ${pay}` : `Swap ${pay} → ${recv}`;

  return (
    <div className="tk-card">
      <div className="tk-head">
        <div className="tk-side">
          {(["buy", "sell", "swap"] as Side[]).map((s) => (
            <button key={s} type="button" data-active={side === s ? "" : undefined} data-sell={side === s && s === "sell" ? "" : undefined}
              onClick={() => changeSide(s)}>{s[0].toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ChainMenu value={network} options={walletChains} onPick={onSelectChain} />
          <Badge tone="live"><span className="fr-dot live" style={{ color: "var(--live)" }} /> {useBankr ? "Bankr" : "Live"}</Badge>
        </div>
      </div>

      <div className="tk-leg">
        <div className="lhead"><span>{sell ? "You sell" : "You pay"}</span><span className="bal">Balance {trAmt(pay, bal)} {pay}</span></div>
        <div className="tk-legrow">
          <input className="tk-input" inputMode="decimal" placeholder="0" value={amt}
            onChange={(e) => { setAmt(e.target.value.replace(/[^0-9.]/g, "")); setState("idle"); setResult(null); setQuote(null); }} aria-label="Amount to pay" />
          <AssetMenu value={pay} options={payOptions} balances={cryptoBalances} values={usdBySymbol} logos={logoBySymbol}
            onPick={(s) => { if (s !== recv) { setPay(s); setState("idle"); setQuote(null); } }} />
        </div>
        <div className="tk-usd">{payUsdEstimate > 0 ? `≈ ${trUsd2(payUsdEstimate)}` : quoting ? "pricing…" : "≈ —"}</div>
        <div className="tk-chips">
          {([[0.25, "25%"], [0.5, "50%"], [1, "Max"]] as const).map(([p, l]) => (
            <button key={l} type="button" onClick={() => setPct(p)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="tk-mid">
        <button type="button" className="tk-swap" onClick={flip} aria-label="Flip assets">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3" /></svg>
        </button>
        <span className="rate">{rate ? `1 ${pay} = ${rate.toLocaleString(undefined, { maximumFractionDigits: rate < 1 ? 6 : 4 })} ${recv}` : "—"}</span>
      </div>

      <div className="tk-leg">
        <div className="lhead"><span>You receive</span><span className="bal">≈ market</span></div>
        <div className="tk-legrow">
          <input className="tk-input" readOnly value={recvAmt ? trAmt(recv, recvAmt) : ""} placeholder="0" aria-label="Estimated received" />
          <AssetMenu value={recv} options={recvOptions} balances={cryptoBalances} values={usdBySymbol} logos={logoBySymbol} onPick={(s) => { if (s !== pay) { setRecv(s); setState("idle"); setQuote(null); } }} />
        </div>
        <div className="tk-usd">{quote ? `≈ ${trUsd2(payUsd)}` : "≈ —"}</div>
      </div>

      <div className="tk-review">
        <ReviewLine k="Route" v={useBankr ? "Bankr" : network.includes("solana") ? "Jupiter · Solana" : "0x · Base"} icon="repeat" />
        <ReviewLine k="Price impact" v={quote && quote.detail ? quote.detail : "—"} />
        {!useBankr ? <ReviewLine k="Per-swap cap" v={trUsd(swapMaxUsd)} /> : null}
        <ReviewLine k="Settles to" v={wallet.name} icon="wallet" live />
      </div>

      {overCap ? (
        <div className="tk-guard" data-danger>
          <BIcon name="alert" size={14} />
          <span>{payUsdEstimate > 0 ? trUsd(payUsdEstimate) : "This swap"} exceeds the {trUsd(swapMaxUsd)} per-swap cap on the local rail. Reduce the amount.</span>
        </div>
      ) : overWalletCap ? (
        <div className="tk-guard">
          <BIcon name="shield" size={14} />
          <span>{trUsd(payUsd)} exceeds this wallet&apos;s {trUsd(wallet.cap!)} per-trade guardrail. The hive will request your approval before signing.</span>
        </div>
      ) : null}

      <button type="button" className="tk-place" data-sell={sell && state === "idle" ? "" : undefined} data-done={state === "done" ? "" : undefined}
        disabled={(!amtNum && state === "idle") || state === "signing" || overCap} onClick={place}>
        {state === "signing" ? <BIcon name="spinner" size={15} spin /> : state === "done" ? <BIcon name="check" size={15} /> : null}
        {label}
      </button>
      <div className="tk-foot"><BIcon name="shield" size={12} /> {useBankr ? "Routed through the Bankr trading wallet" : "Signs locally from your governed wallet"}</div>

      {state === "error" && result?.error ? <p className="tk-error">{result.error}</p> : null}
      {state === "done" && result?.ok ? (
        <div className="tk-success">
          {result.message || "Order filled."}
          {result.reference ? <div style={{ marginTop: 4, color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11 }}>Ref: {result.reference}</div> : null}
          <div style={{ marginTop: 6 }}><button type="button" className="fw-manage" onClick={() => onOpenView("wallet")}>View in Wallets · Activity →</button></div>
        </div>
      ) : null}
    </div>
  );
}
