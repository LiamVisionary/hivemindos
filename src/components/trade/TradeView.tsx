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
import { PlumeOptionsPanel } from "./PlumeOptionsPanel";
import { PredictionMarketsPanel } from "./PredictionMarketsPanel";
import { LiquidityRangeManagerPanel } from "./LiquidityRangeManagerPanel";
import { CapabilityRail } from "./CapabilityRail";
import { PortfolioCard, MoversCard, PositionsPanel, ActivityPanel } from "./surfaces";
import { DeskSkeleton } from "./skeletons";
import { walletKindIcon } from "./icons";
import { ExecutionModeControl, TradingLifecycleProvider } from "./trading-lifecycle-context";
import { TradingWorkspace, type TradingWorkspaceView } from "./TradingWorkspace";

function DeskHeader() {
  const desk = useTradeDesk();
  const { wallet, hasActingWallet, currency, fxRates, setCurrency, onChangeWallet } = desk;
  const actingChainIcon = chainBadgeSrc(chainKeyForNetwork(wallet.network));
  const actingChainLabel = chainLabelForNetwork(wallet.network);
  return (
    <header className="dk-desk-header" style={{ padding: "18px 30px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
      <div className="dk-desk-title" style={{ display: "flex", alignItems: "baseline", gap: 11, minWidth: 0 }}>
        <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" }}>Trade</span>
        <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>trade assets, manage liquidity, options &amp; prediction markets — through governed rails</span>
      </div>
      <div className="dk-desk-controls" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <ExecutionModeControl />
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
  return <TradingLifecycleProvider><TradeViewContent /></TradingLifecycleProvider>;
}

function TradeViewContent() {
  const desk = useTradeDesk();
  // Set the active display currency + real FX table before any child formats.
  setDisplayCurrency(desk.currency, desk.fxRates);

  const [segment, setSegment] = React.useState<"crypto" | "stocks" | "liquidity" | "options" | "prediction">("crypto");
  const [workspace, setWorkspace] = React.useState<TradingWorkspaceView>("trade");
  const isStock = segment === "stocks";
  const isOptions = segment === "options";
  const isPrediction = segment === "prediction";
  const isLiquidity = segment === "liquidity";
  const { loading, refreshing, stockLoading, stockRefreshing, activityRefreshing, paper, hasActingWallet } = desk;
  const contentLoading = !isOptions && !isPrediction && !isLiquidity && (loading || (isStock && stockLoading));
  const dataRefreshing = isStock ? stockRefreshing : refreshing;
  const pf = isStock ? desk.stockPortfolio : desk.cryptoPortfolio;
  const movers = isStock ? desk.stockMovers : desk.cryptoMovers;

  React.useEffect(() => {
    void Promise.resolve().then(() => {
      if (desk.initialDraft?.assetClass === "stock") setSegment("stocks");
      if (desk.initialDraft?.assetClass === "token") setSegment("crypto");
    });
  }, [desk.initialDraft?.requestId, desk.initialDraft?.assetClass]);

  return (
    <div className="fr-root" data-fr-theme={desk.theme === "light" ? "light" : undefined} style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>
      <DeskHeader />
      <div className="fr-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        <div className="dk-wrap">
          <TradingWorkspace view={workspace} onView={setWorkspace}>
            <>
              <div className="dk-toprow">
                <div className="dk-seg">
                  <button type="button" data-active={segment === "crypto" ? "" : undefined} onClick={() => setSegment("crypto")}><BIcon name="trade" size={15} /> Crypto</button>
                  <button type="button" data-active={isStock ? "" : undefined} onClick={() => setSegment("stocks")}><BIcon name="activity" size={15} /> Stocks</button>
                  <button type="button" data-active={isLiquidity ? "" : undefined} onClick={() => setSegment("liquidity")}><BIcon name="repeat" size={15} /> Liquidity</button>
                  <button type="button" data-active={isOptions ? "" : undefined} onClick={() => setSegment("options")}><BIcon name="spark" size={15} /> Options</button>
                  <button type="button" data-active={isPrediction ? "" : undefined} onClick={() => setSegment("prediction")}><BIcon name="activity" size={15} /> Prediction</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="dk-marketpill">
                    {isLiquidity
                      ? <><span className="fr-dot live" style={{ color: "var(--live)" }} /> Base · Uniswap v3 · shadow only</>
                      : isPrediction
                      ? <><span className="fr-dot live" style={{ color: "var(--live)" }} /> Public data · paper native</>
                      : isOptions
                      ? <><span className="fr-dot" style={{ color: "var(--honey)" }} /> Plume · testnet · governed</>
                      : contentLoading || (!isStock && refreshing)
                      ? <><span className="fr-dot" style={{ color: "var(--fg-4)" }} /> Syncing…</>
                      : <><span className="fr-dot live" style={{ color: "var(--live)" }} /> {isStock ? <>US market · {paper ? "paper" : "live"}</> : <>Markets live · on-chain · {tradeNetworkLabel(desk.network)}</>}</>}
                  </span>
                </div>
              </div>

              {isLiquidity ? (
                <LiquidityRangeManagerPanel agentId={desk.agentId} walletAddress={desk.wallet.fullAddress} />
              ) : isPrediction ? (
                <PredictionMarketsPanel />
              ) : isOptions ? (
                <PlumeOptionsPanel />
              ) : !hasActingWallet ? (
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
                        onViewAll={() => setWorkspace("activity")}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          </TradingWorkspace>
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
