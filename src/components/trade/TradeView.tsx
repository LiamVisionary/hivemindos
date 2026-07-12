"use client";

/* TradeView — the redesigned Trade desk ("The Desk"), composed from real data
   provided by TradePanel through TradeDeskProvider. No nav shelf or chat pill:
   the dashboard already renders the global AppNavShelf + hive chat around the
   view, so this fills the route body only. */

import React from "react";
import Image from "next/image";
import { chainBadgeSrc, chainKeyForNetwork, chainLabelForNetwork } from "@/lib/utils/personal-wallet-grouping";
import "./trade-desk.css";
import { setDisplayCurrency } from "./format";
import { useTradeDesk } from "./trade-context";
import { BIcon } from "./icons";
import { CurrencyMenu } from "./primitives";
import { CryptoTicket } from "./CryptoTicket";
import { StockTicket } from "./StockTicket";
import { CapabilityRail } from "./CapabilityRail";
import { PortfolioCard, MoversCard, PositionsPanel, ActivityPanel, ActivityView } from "./surfaces";
import { DeskSkeleton, ActivitySkeleton } from "./skeletons";
import { walletKindIcon } from "./icons";

function DeskHeader() {
  const desk = useTradeDesk();
  const { wallet, hasActingWallet, currency, fxRates, setCurrency, onChangeWallet } = desk;
  const actingChainIcon = chainBadgeSrc(chainKeyForNetwork(wallet.network));
  const actingChainLabel = chainLabelForNetwork(wallet.network);
  return (
    <header style={{ padding: "18px 30px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 11, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" }}>Trade</span>
        <span style={{ fontSize: 12.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>buy, sell &amp; swap — through governed wallets</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <CurrencyMenu currency={currency} rates={fxRates} onCurrency={setCurrency} />
        <span className="dk-hdiv" aria-hidden="true" />
        <span style={{ fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--f-mono)", letterSpacing: ".04em", textTransform: "uppercase" }}>Acting wallet</span>
        <button type="button" className="dk-acting" onClick={onChangeWallet}>
          <span className="av" title={actingChainLabel || undefined}>
            {hasActingWallet && actingChainIcon
              ? <Image src={actingChainIcon} alt="" width={20} height={20} />
              : <BIcon name={walletKindIcon(wallet.kind)} size={17} />}
          </span>
          <span className="meta">
            <b>{hasActingWallet ? wallet.name : "Select a wallet"}</b>
            {hasActingWallet ? <small>{wallet.addr} · {wallet.custody}</small> : <small>none yet</small>}
          </span>
          <span className="chg">Change</span>
        </button>
      </div>
    </header>
  );
}

export function TradeView() {
  const desk = useTradeDesk();
  // Set the active display currency + real FX table before any child formats.
  setDisplayCurrency(desk.currency, desk.fxRates);

  const [segment, setSegment] = React.useState<"crypto" | "stocks">("crypto");
  const [view, setView] = React.useState<"trade" | "history">("trade");
  const [histFilter, setHistFilter] = React.useState<"crypto" | "stocks" | "all">("crypto");
  const isStock = segment === "stocks";
  const { loading, refreshing, stockLoading, stockRefreshing, activityLoading, activityRefreshing, paper, setPaper, hasActingWallet } = desk;
  const contentLoading = loading || (isStock && stockLoading);
  const dataRefreshing = isStock ? stockRefreshing : refreshing;
  const pf = isStock ? desk.stockPortfolio : desk.cryptoPortfolio;
  const movers = isStock ? desk.stockMovers : desk.cryptoMovers;

  return (
    <div className="fr-root" data-fr-theme={desk.theme === "light" ? "light" : undefined} style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>
      <DeskHeader />
      <div className="fr-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        <div className="dk-wrap">
          {view === "history" ? (
            activityLoading ? <ActivitySkeleton /> : (
              <ActivityView items={desk.activity} filter={histFilter} refreshing={activityRefreshing} onFilter={setHistFilter} onBack={() => setView("trade")} />
            )
          ) : (
            <>
              <div className="dk-toprow">
                <div className="dk-seg">
                  <button type="button" data-active={!isStock ? "" : undefined} onClick={() => setSegment("crypto")}><BIcon name="trade" size={15} /> Crypto</button>
                  <button type="button" data-active={isStock ? "" : undefined} onClick={() => setSegment("stocks")}><BIcon name="activity" size={15} /> Stocks</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {isStock && desk.stockReadiness.venue === "alpaca" ? (
                    <div className="dk-pl" role="radiogroup" aria-label="Account mode">
                      <button type="button" data-active={paper ? "" : undefined} onClick={() => setPaper(true)}>Paper</button>
                      <button type="button" data-active={!paper ? "" : undefined} data-live={!paper ? "" : undefined} disabled={!desk.stockReadiness.liveEnabled} onClick={() => setPaper(false)}>Live</button>
                    </div>
                  ) : null}
                  <span className="dk-marketpill">
                    {contentLoading || (!isStock && refreshing)
                      ? <><span className="fr-dot" style={{ color: "var(--fg-4)" }} /> Syncing…</>
                      : <><span className="fr-dot live" style={{ color: "var(--live)" }} /> {isStock ? <>US market · {paper ? "paper" : "live"}</> : <>Markets live · on-chain · {tradeNetworkLabel(desk.network)}</>}</>}
                  </span>
                </div>
              </div>

              {!hasActingWallet ? (
                <div className="dk-panel" style={{ textAlign: "center", padding: "40px 24px" }}>
                  <p style={{ color: "var(--fg-2)", fontSize: 13.5, margin: "0 0 14px" }}>No wallet to trade with yet. Create or import one in the Wallets tab, then come back to trade.</p>
                  <button type="button" className="tk-place" style={{ maxWidth: 220, margin: "0 auto" }} onClick={() => desk.onOpenView("wallet")}>Open Wallets</button>
                </div>
              ) : contentLoading ? (
                <DeskSkeleton />
              ) : (
                <>
                  <div className="dk-hero">
                    <PortfolioCard pf={pf} isStock={isStock} refreshing={dataRefreshing} win={isStock ? "30d" : "24h"} />
                    <MoversCard movers={movers} isStock={isStock} refreshing={dataRefreshing} />
                  </div>

                  <div className="dk-grid">
                    <div className="tk">
                      {isStock ? <StockTicket /> : (
                        <>
                          <CryptoTicket key={desk.network} />
                          {/* The capability rail is the long-tail CRYPTO actions
                              (swap, bridge, perps, send…); it doesn't apply to the
                              stocks segment, so it's crypto-only. */}
                          <CapabilityRail />
                        </>
                      )}
                    </div>
                    <div className="dk-col">
                      <PositionsPanel pf={pf} isStock={isStock} />
                      <ActivityPanel
                        items={desk.activity.filter((a) => a.src === (isStock ? "stocks" : "crypto"))}
                        refreshing={activityRefreshing}
                        onViewAll={() => { setHistFilter(isStock ? "stocks" : "crypto"); setView("history"); }}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function tradeNetworkLabel(network: string): string {
  if (network.includes("solana")) return "Solana";
  if (network === "eip155:4663") return "Robinhood Chain";
  return "Base";
}

export default TradeView;
