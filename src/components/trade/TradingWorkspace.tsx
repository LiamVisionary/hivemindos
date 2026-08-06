"use client";

import React from "react";

import type { PortfolioAccountSnapshot, TradingAssetClass, TradingExecutionMode, TradingRiskPolicy } from "@/lib/types/trading-control";
import { TRADING_EXECUTION_MODE_META } from "@/lib/types/trading-control";
import { BIcon } from "./icons";
import { trAmt, trPct, trUsd, trUsd2 } from "./format";
import { useTradeDesk } from "./trade-context";
import { TradePlanReviewCard } from "./TradePlanReviewCard";
import { useTradingLifecycle } from "./trading-lifecycle-context";
import styles from "./TradingWorkspace.module.css";

export type TradingWorkspaceView = "trade" | "research" | "portfolio" | "plans" | "activity" | "automations";

const NAV: Array<{ id: TradingWorkspaceView; label: string; icon: Parameters<typeof BIcon>[0]["name"] }> = [
  { id: "trade", label: "Trade", icon: "trade" },
  { id: "research", label: "Research", icon: "spark" },
  { id: "portfolio", label: "Portfolio", icon: "wallet" },
  { id: "plans", label: "Plans", icon: "check" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "automations", label: "Automations", icon: "repeat" },
];

export function TradingWorkspace({
  view,
  onView,
  children,
}: {
  view: TradingWorkspaceView;
  onView: (view: TradingWorkspaceView) => void;
  children: React.ReactNode;
}) {
  const lifecycle = useTradingLifecycle();
  return (
    <div className={styles.root}>
      <nav className={styles.nav} aria-label="Trading workspace">
        {NAV.map((item) => (
          <button key={item.id} type="button" data-active={view === item.id ? "" : undefined} onClick={() => onView(item.id)}>
            <BIcon name={item.icon} size={14} />
            <span>{item.label}</span>
            {item.id === "plans" && lifecycle.overview?.plans.some((plan) => plan.status === "review") ? (
              <i aria-label="Plans awaiting review">{lifecycle.overview.plans.filter((plan) => plan.status === "review").length}</i>
            ) : null}
          </button>
        ))}
      </nav>

      {lifecycle.error ? <div className={styles.banner} role="status"><BIcon name="alert" size={14} /> {lifecycle.error}</div> : null}
      {view === "trade" ? children : null}
      {view === "research" ? <ResearchWorkspace /> : null}
      {view === "portfolio" ? <PortfolioWorkspace /> : null}
      {view === "plans" ? <PlansWorkspace /> : null}
      {view === "activity" ? <ActivityWorkspace /> : null}
      {view === "automations" ? <AutomationsWorkspace /> : null}
    </div>
  );
}

function WorkspaceHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <header className={styles.workspaceHeader}>
      <div><span>{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div>
      {action}
    </header>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className={styles.empty}><BIcon name="spark" size={19} /><strong>{title}</strong><p>{detail}</p></div>;
}

function ResearchWorkspace() {
  const desk = useTradeDesk();
  const { overview, busy, createThesis, reviseThesis } = useTradingLifecycle();
  const [query, setQuery] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [asset, setAsset] = React.useState("");
  const [summary, setSummary] = React.useState("");
  const [direction, setDirection] = React.useState<"long" | "short" | "neutral">("long");
  const [conviction, setConviction] = React.useState<"low" | "medium" | "high">("medium");
  const [invalidation, setInvalidation] = React.useState("");
  const [catalysts, setCatalysts] = React.useState("");
  const [cadence, setCadence] = React.useState(7);

  const assets = React.useMemo(() => {
    const rows = [
      ...desk.cryptoMovers.map((item) => ({ ...item, assetClass: "crypto" as const, holdingUsd: desk.cryptoPortfolio.rows.find((row) => row.sym === item.sym)?.usd ?? 0 })),
      ...desk.stockMovers.map((item) => ({ ...item, assetClass: "stock" as const, holdingUsd: desk.stockPortfolio.rows.find((row) => row.sym === item.sym)?.usd ?? 0 })),
    ];
    const needle = query.trim().toLowerCase();
    return needle ? rows.filter((row) => `${row.sym} ${row.name}`.toLowerCase().includes(needle)) : rows.slice(0, 12);
  }, [desk.cryptoMovers, desk.cryptoPortfolio.rows, desk.stockMovers, desk.stockPortfolio.rows, query]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!asset.trim() || !summary.trim()) return;
    const ok = await createThesis({
      title: title.trim() || `${asset.trim().toUpperCase()} research thesis`,
      asset: asset.trim().toUpperCase(),
      assetClass: assetClassFor(asset, desk),
      direction,
      conviction,
      summary: summary.trim(),
      invalidation: invalidation.trim() || undefined,
      catalysts: catalysts.split(",").map((item) => item.trim()).filter(Boolean),
      reviewCadenceDays: cadence,
    });
    if (ok) { setTitle(""); setAsset(""); setSummary(""); setInvalidation(""); setCatalysts(""); }
  };

  return (
    <section className={styles.workspace}>
      <WorkspaceHeader eyebrow="Asset workbench" title="Research before you route" detail="Scan live desk data, keep a durable thesis, and define what would prove it wrong." />
      <div className={styles.twoColumn}>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><h3>Markets &amp; holdings</h3><p>One search across crypto and stocks.</p></div></div>
          <label className={styles.search}><BIcon name="search" size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an asset" aria-label="Search assets" /></label>
          <div className={styles.assetList}>
            {assets.map((row) => (
              <button key={`${row.assetClass}:${row.sym}`} type="button" onClick={() => { setAsset(row.sym); setTitle(`${row.sym} research thesis`); }}>
                <span><strong>{row.sym}</strong><small>{row.name} · {row.assetClass}</small></span>
                <span><strong>{trUsd2(row.price)}</strong><small className={row.chg < 0 ? styles.negative : styles.positive}>{trPct(row.chg)} · held {trUsd(row.holdingUsd)}</small></span>
              </button>
            ))}
          </div>
        </section>

        <form className={styles.panel} onSubmit={submit}>
          <div className={styles.panelHead}><div><h3>New thesis</h3><p>Only asset and summary are required.</p></div></div>
          <div className={styles.formGrid}>
            <label><span>Asset</span><input required value={asset} onChange={(event) => setAsset(event.target.value.toUpperCase())} placeholder="BTC or NVDA" /></label>
            <label><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional clear name" /></label>
            <label className={styles.full}><span>What is the thesis?</span><textarea required rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="State the claim and the evidence you expect to see." /></label>
          </div>
          <details className={styles.details}>
            <summary>Advanced thesis settings</summary>
            <div className={styles.formGrid}>
              <label><span>Direction</span><select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="long">Long</option><option value="short">Short</option><option value="neutral">Neutral</option></select></label>
              <label><span>Conviction</span><select value={conviction} onChange={(event) => setConviction(event.target.value as typeof conviction)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
              <label className={styles.full}><span>Invalidation condition</span><input value={invalidation} onChange={(event) => setInvalidation(event.target.value)} placeholder="What would make this thesis wrong?" /></label>
              <label><span>Catalysts</span><input value={catalysts} onChange={(event) => setCatalysts(event.target.value)} placeholder="Comma separated" /></label>
              <label><span>Review every</span><select value={cadence} onChange={(event) => setCadence(Number(event.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label>
            </div>
          </details>
          <button className={styles.primary} type="submit" disabled={busy || !asset.trim() || !summary.trim()}>{busy ? "Saving…" : "Save thesis"}</button>
        </form>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}><div><h3>Thesis monitor</h3><p>Review dates, conviction, and invalidation stay attached to the asset.</p></div><span>{overview?.theses.length ?? 0}</span></div>
        {!overview?.theses.length ? <EmptyState title="No theses yet" detail="Pick an asset above and write the smallest falsifiable claim." /> : (
          <div className={styles.cardGrid}>
            {overview.theses.map((thesis) => (
              <article className={styles.infoCard} key={thesis.id}>
                <div className={styles.cardTop}><span>{thesis.asset} · {thesis.direction}</span><i data-status={thesis.status}>{thesis.status}</i></div>
                <h4>{thesis.title}</h4><p>{thesis.summary}</p>
                <dl><div><dt>Conviction</dt><dd>{thesis.conviction}</dd></div><div><dt>Next review</dt><dd>{new Date(thesis.nextReviewAt).toLocaleDateString()}</dd></div></dl>
                {thesis.invalidation ? <details className={styles.miniDetails}><summary>Invalidation</summary><p>{thesis.invalidation}</p></details> : null}
                {thesis.status === "watching" || thesis.status === "draft" ? <button type="button" className={styles.textButton} disabled={busy} onClick={() => void reviseThesis(thesis.id, { status: "invalidated", note: "Invalidated from the Trade research workspace." })}>Mark invalidated</button> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function assetClassFor(asset: string, desk: ReturnType<typeof useTradeDesk>): TradingAssetClass {
  const symbol = asset.trim().toUpperCase();
  return desk.stockMovers.some((item) => item.sym === symbol) || desk.stockPortfolio.rows.some((item) => item.sym === symbol) ? "stock" : "crypto";
}

function portfolioAccounts(desk: ReturnType<typeof useTradeDesk>): PortfolioAccountSnapshot[] {
  const capturedAt = new Date().toISOString();
  const crypto: PortfolioAccountSnapshot = {
    accountId: desk.wallet.id,
    label: desk.wallet.name,
    provider: desk.walletKind === "bankr" ? "Bankr" : "On-chain wallet",
    custody: desk.wallet.custody,
    cashUsd: 0,
    totalValueUsd: desk.cryptoPortfolio.total,
    health: desk.cryptoPortfolio.error ? "degraded" : "healthy",
    lastSyncAt: capturedAt,
    holdings: desk.cryptoPortfolio.rows.filter((row) => !row.pending).map((row) => ({
      asset: row.sym,
      assetClass: "crypto",
      quantity: row.amount,
      marketPrice: row.amount > 0 ? row.usd / row.amount : 0,
      marketValueUsd: row.usd,
      source: "Trade desk wallet portfolio",
    })),
  };
  const stockCash = desk.stockReadiness.account?.cash ?? 0;
  const stocks: PortfolioAccountSnapshot = {
    accountId: `${desk.wallet.id}:stocks`,
    label: `${desk.wallet.name} stocks`,
    provider: desk.stockReadiness.venue || "No venue",
    custody: desk.stockReadiness.venue === "alpaca" ? "Brokerage" : desk.wallet.custody,
    cashUsd: stockCash,
    totalValueUsd: desk.stockPortfolio.total,
    health: desk.stockReadiness.venueReady ? "healthy" : "degraded",
    lastSyncAt: capturedAt,
    holdings: desk.stockPortfolio.rows.filter((row) => !row.pending).map((row) => ({
      asset: row.sym,
      assetClass: "stock",
      quantity: row.shares ?? row.amount,
      marketPrice: (row.shares ?? row.amount) > 0 ? row.usd / (row.shares ?? row.amount) : 0,
      marketValueUsd: row.usd,
      source: "Trade desk stock portfolio",
    })),
  };
  return [crypto, stocks];
}

function PortfolioWorkspace() {
  const desk = useTradeDesk();
  const { overview, busy, captureSnapshot, reconcilePosition } = useTradingLifecycle();
  const [selected, setSelected] = React.useState(0);
  const [reconAsset, setReconAsset] = React.useState("");
  const [observed, setObserved] = React.useState("");
  const [tracked, setTracked] = React.useState("");
  const snapshots = overview?.snapshots ?? [];
  const snapshot = snapshots[Math.min(selected, Math.max(0, snapshots.length - 1))];
  const simulatorAccounts = Object.values(overview?.simulator.accounts ?? {});

  const reconcile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reconAsset.trim()) return;
    const ok = await reconcilePosition({
      accountId: desk.wallet.id,
      asset: reconAsset.trim().toUpperCase(),
      assetClass: assetClassFor(reconAsset, desk),
      observedQuantity: Number(observed),
      trackedQuantity: Number(tracked),
      source: "Manual Trade workspace reconciliation",
    });
    if (ok) { setReconAsset(""); setObserved(""); setTracked(""); }
  };

  return (
    <section className={styles.workspace}>
      <WorkspaceHeader
        eyebrow="Portfolio time machine"
        title="Every account, one accountable history"
        detail="Snapshots separate observed holdings from the paper simulator and preserve cost-basis context when it is available."
        action={<button type="button" className={styles.primary} disabled={busy} onClick={() => void captureSnapshot(portfolioAccounts(desk))}>{busy ? "Capturing…" : "Capture snapshot"}</button>}
      />
      <div className={styles.metrics}>
        <article><small>Observed crypto</small><strong>{trUsd2(desk.cryptoPortfolio.total)}</strong><span>{trPct(desk.cryptoPortfolio.dayPct)} today</span></article>
        <article><small>Observed stocks</small><strong>{trUsd2(desk.stockPortfolio.total)}</strong><span>{desk.stockReadiness.venue || "No venue"}</span></article>
        <article><small>Paper accounts</small><strong>{simulatorAccounts.length}</strong><span>{trUsd2(simulatorAccounts.reduce((sum, account) => sum + account.cashUsd, 0))} cash</span></article>
        <article><small>Reconciliation</small><strong>{overview?.reconciliations.filter((item) => item.status === "attention").length ?? 0}</strong><span>items need attention</span></article>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div><h3>Snapshot history</h3><p>Choose a point in time to inspect account totals and holdings.</p></div>
          {snapshots.length ? <select aria-label="Portfolio snapshot" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{snapshots.map((item, index) => <option key={item.id} value={index}>{new Date(item.capturedAt).toLocaleString()} · {item.reason}</option>)}</select> : null}
        </div>
        {!snapshot ? <EmptyState title="No snapshots yet" detail="Capture the current desk once, then event and scheduled snapshots build the timeline." /> : (
          <>
            <div className={styles.snapshotTotal}><span>Total at {new Date(snapshot.capturedAt).toLocaleString()}</span><strong>{trUsd2(snapshot.totalValueUsd)}</strong><small>{trUsd2(snapshot.cashUsd)} cash · {trUsd2(snapshot.investedValueUsd)} invested</small></div>
            <div className={styles.accountGrid}>{snapshot.accounts.map((account) => <article className={styles.infoCard} key={account.accountId}><div className={styles.cardTop}><span>{account.provider}</span><i data-status={account.health}>{account.health}</i></div><h4>{account.label}</h4><strong className={styles.bigNumber}>{trUsd2(account.totalValueUsd ?? account.cashUsd + account.holdings.reduce((sum, item) => sum + item.marketValueUsd, 0))}</strong><p>{account.custody} · {account.holdings.length} holdings · last sync {account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleTimeString() : "unknown"}</p></article>)}</div>
            <div className={styles.tableWrap}><table><thead><tr><th>Asset</th><th>Quantity</th><th>Market value</th><th>Cost basis</th><th>Unrealized P&amp;L</th></tr></thead><tbody>{snapshot.accounts.flatMap((account) => account.holdings.map((holding) => <tr key={`${account.accountId}:${holding.asset}`}><td><strong>{holding.asset}</strong><small>{account.label}</small></td><td>{trAmt(holding.asset, holding.quantity)}</td><td>{trUsd2(holding.marketValueUsd)}</td><td>{holding.costBasisUsd === undefined ? "Not supplied" : trUsd2(holding.costBasisUsd)}</td><td>{holding.unrealizedPnlUsd === undefined ? "Not supplied" : `${trUsd2(holding.unrealizedPnlUsd)} (${trPct(holding.unrealizedPnlPct ?? 0)})`}</td></tr>))}</tbody></table></div>
          </>
        )}
      </section>

      <details className={styles.panelDetails}>
        <summary>Advanced data reconciliation</summary>
        <p>Compare a provider observation with the tracked quantity. This records a discrepancy; it never edits the source account.</p>
        <form className={styles.inlineForm} onSubmit={reconcile}>
          <label><span>Asset</span><input required value={reconAsset} onChange={(event) => setReconAsset(event.target.value.toUpperCase())} placeholder="ETH" /></label>
          <label><span>Observed</span><input required inputMode="decimal" value={observed} onChange={(event) => setObserved(event.target.value)} placeholder="1.25" /></label>
          <label><span>Tracked</span><input required inputMode="decimal" value={tracked} onChange={(event) => setTracked(event.target.value)} placeholder="1.25" /></label>
          <button type="submit" className={styles.secondary} disabled={busy}>Compare</button>
        </form>
        {overview?.reconciliations.length ? <div className={styles.reconciliationList}>{overview.reconciliations.slice(0, 8).map((item) => <div key={item.id} data-status={item.status}><span><strong>{item.asset}</strong><small>{item.source}</small></span><span>{item.quantityDelta === 0 ? "Matched" : `${item.quantityDelta > 0 ? "+" : ""}${item.quantityDelta} difference`}</span></div>)}</div> : null}
      </details>
    </section>
  );
}

function PlansWorkspace() {
  const { overview, busy, approvePlan, rejectPlan, simulatePlan } = useTradingLifecycle();
  const [filter, setFilter] = React.useState("open");
  const plans = (overview?.plans ?? []).filter((plan) => filter === "all" || filter === "open" && ["review", "blocked", "approved", "submitted"].includes(plan.status) || plan.status === filter);

  const approve = async (id: string, mode: TradingExecutionMode) => {
    const plan = await approvePlan(id, "Approved from the durable Trade Plans workspace.");
    if (plan && mode === "paper") await simulatePlan(id);
  };

  return (
    <section className={styles.workspace}>
      <WorkspaceHeader eyebrow="Review queue" title="Trade Plans" detail="Nothing in this queue changes when you navigate away. Review evidence and exposure before approval." />
      <div className={styles.filterRow} role="group" aria-label="Filter trade plans">{["open", "review", "blocked", "filled", "rejected", "all"].map((item) => <button key={item} type="button" data-active={filter === item ? "" : undefined} onClick={() => setFilter(item)}>{item}</button>)}</div>
      {!plans.length ? <EmptyState title="No plans in this view" detail="Stage an order from Trade to create a persistent review item." /> : (
        <div className={styles.planGrid}>{plans.map((plan) => <TradePlanReviewCard key={plan.id} plan={plan} busy={busy} onReject={() => void rejectPlan(plan.id, "Rejected from the Trade Plans workspace.")} onApprove={() => void approve(plan.id, plan.executionMode)} />)}</div>
      )}
      {plans.some((plan) => plan.executionMode === "live" && plan.status === "approved") ? <div className={styles.banner}><BIcon name="shield" size={14} /> Approved live plans return to their original governed ticket for submission; approval alone never moves funds.</div> : null}
    </section>
  );
}

function ActivityWorkspace() {
  const desk = useTradeDesk();
  const { overview } = useTradingLifecycle();
  const entries = overview?.events ?? [];
  return (
    <section className={styles.workspace}>
      <WorkspaceHeader eyebrow="Control-plane audit" title="Activity" detail="Plan, simulation, snapshot, policy, and reconciliation events sit beside settled wallet activity." />
      <div className={styles.twoColumn}>
        <section className={styles.panel}><div className={styles.panelHead}><div><h3>Trading lifecycle</h3><p>Durable control events.</p></div><span>{entries.length}</span></div>{entries.length ? <div className={styles.eventList}>{entries.map((event) => <article key={event.id}><BIcon name={event.kind.includes("failed") ? "alert" : "activity"} size={14} /><div><strong>{event.title}</strong><p>{event.detail}</p><small>{new Date(event.at).toLocaleString()} · {event.kind}</small></div></article>)}</div> : <EmptyState title="No lifecycle activity" detail="Creating a plan or snapshot starts the audit trail." />}</section>
        <section className={styles.panel}><div className={styles.panelHead}><div><h3>Wallet &amp; brokerage</h3><p>Existing execution activity from the desk.</p></div><span>{desk.activity.length}</span></div>{desk.activity.length ? <div className={styles.eventList}>{desk.activity.map((event) => <article key={event.id}><BIcon name="trade" size={14} /><div><strong>{event.text}</strong><p>{event.via} · {event.wid}</p><small>{event.when} · {trUsd2(event.usd)}</small></div></article>)}</div> : <EmptyState title="No execution activity" detail="Submitted and settled actions will appear here." />}</section>
      </div>
    </section>
  );
}

function AutomationsWorkspace() {
  const desk = useTradeDesk();
  const { overview, brokerPacks, busy, setConfig, setAccountPolicy, saveConnection, probeConnection } = useTradingLifecycle();
  const config = overview?.config;
  const [riskDraft, setRiskDraft] = React.useState<TradingRiskPolicy | null>(null);
  const risk = riskDraft ?? config?.riskPolicy ?? null;
  if (!config || !risk) return <section className={styles.workspace}><EmptyState title="Loading controls" detail="Reading the local trading policy and account registry." /></section>;
  const accountPolicy = config.accountPolicies[desk.wallet.id];

  const enablePack = async (packId: "ccxt" | "ibkr") => {
    const definition = brokerPacks.find((item) => item.id === packId);
    await saveConnection({ id: `${desk.wallet.id}:${packId}`, packId, label: definition?.label || packId, enabled: true, readOnly: true, paper: true, settings: packId === "ccxt" ? { exchange: "coinbase" } : {} });
  };

  return (
    <section className={styles.workspace}>
      <WorkspaceHeader eyebrow="Safe defaults" title="Automations &amp; controls" detail="Beginners only need mode and snapshot cadence. Account connectors and numeric policy stay collapsed." />
      <div className={styles.twoColumn}>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><h3>Default execution mode</h3><p>Applies unless this account has an override.</p></div></div>
          <div className={styles.modeCards}>{(["research", "paper", "live"] as TradingExecutionMode[]).map((mode) => <button key={mode} type="button" data-active={config.executionMode === mode ? "" : undefined} onClick={() => void setConfig({ executionMode: mode })}><strong>{TRADING_EXECUTION_MODE_META[mode].label}</strong><span>{TRADING_EXECUTION_MODE_META[mode].detail}</span></button>)}</div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHead}><div><h3>Portfolio snapshots</h3><p>Captured lazily on the next control refresh after the cadence is due.</p></div></div>
          <label className={styles.stacked}><span>Automatic snapshot cadence</span><select value={config.snapshotCadenceMinutes} onChange={(event) => void setConfig({ snapshotCadenceMinutes: Number(event.target.value) })}><option value={15}>Every 15 minutes</option><option value={60}>Every hour</option><option value={360}>Every 6 hours</option><option value={1440}>Daily</option><option value={10080}>Weekly</option></select></label>
          <label className={styles.switch}><span><strong>Read-only acting account</strong><small>Forces research-only behavior for this wallet.</small></span><input type="checkbox" checked={Boolean(accountPolicy?.readOnly)} onChange={(event) => void setAccountPolicy({ accountId: desk.wallet.id, readOnly: event.target.checked, executionMode: accountPolicy?.executionMode })} /></label>
        </section>
      </div>

      <details className={styles.panelDetails}>
        <summary>Advanced account connectors</summary>
        <p>These first integrations are deliberately read-only or paper-only. They cannot submit orders.</p>
        <div className={styles.cardGrid}>{brokerPacks.map((pack) => {
          const connection = overview?.connections.find((item) => item.packId === pack.id);
          return <article className={styles.infoCard} key={pack.id}><div className={styles.cardTop}><span>{pack.supportedModes.join(" · ")}</span><i data-status={connection?.health || "unknown"}>{connection?.health || "not added"}</i></div><h4>{pack.label}</h4><p>{pack.summary}</p><small>{pack.setup}</small><div className={styles.cardActions}>{connection ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void probeConnection(connection.id)}>Check health</button> : <button type="button" className={styles.secondary} disabled={busy} onClick={() => void enablePack(pack.id)}>Add safely</button>}</div></article>;
        })}</div>
      </details>

      <details className={styles.panelDetails}>
        <summary>Advanced risk policy</summary>
        <p>Live mode fails closed when required context is unknown. Paper and research preserve the warning without moving funds.</p>
        <div className={styles.formGrid}>
          <RiskInput label="Max position" suffix="%" value={risk.maxPositionPct} onChange={(value) => setRiskDraft({ ...risk, maxPositionPct: value })} />
          <RiskInput label="Max concentration" suffix="%" value={risk.maxConcentrationPct} onChange={(value) => setRiskDraft({ ...risk, maxConcentrationPct: value })} />
          <RiskInput label="Max leverage" suffix="×" value={risk.maxLeverage} onChange={(value) => setRiskDraft({ ...risk, maxLeverage: value })} />
          <RiskInput label="Daily loss stop" suffix="%" value={risk.maxDailyLossPct} onChange={(value) => setRiskDraft({ ...risk, maxDailyLossPct: value })} />
          <RiskInput label="Drawdown stop" suffix="%" value={risk.maxDrawdownPct} onChange={(value) => setRiskDraft({ ...risk, maxDrawdownPct: value })} />
          <RiskInput label="Max slippage" suffix="bps" value={risk.maxSlippageBps} onChange={(value) => setRiskDraft({ ...risk, maxSlippageBps: value })} />
          <RiskInput label="Min liquidity" suffix="USD" value={risk.minLiquidityUsd} onChange={(value) => setRiskDraft({ ...risk, minLiquidityUsd: value })} />
          <RiskInput label="Quote max age" suffix="sec" value={risk.maxQuoteAgeSeconds} onChange={(value) => setRiskDraft({ ...risk, maxQuoteAgeSeconds: value })} />
          <RiskInput label="Cooldown" suffix="sec" value={risk.cooldownSeconds} onChange={(value) => setRiskDraft({ ...risk, cooldownSeconds: value })} />
          <label className={styles.full}><span>Allowed symbols <small>Leave empty for all</small></span><input value={risk.allowedSymbols.join(", ")} onChange={(event) => setRiskDraft({ ...risk, allowedSymbols: event.target.value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) })} placeholder="BTC, ETH, NVDA" /></label>
        </div>
        <div className={styles.policyChecks}><label><input type="checkbox" checked={risk.requireKnownPortfolioForLive} onChange={(event) => setRiskDraft({ ...risk, requireKnownPortfolioForLive: event.target.checked })} /> Require known portfolio exposure in live mode</label><label><input type="checkbox" checked={risk.requirePlanForLive} onChange={(event) => setRiskDraft({ ...risk, requirePlanForLive: event.target.checked })} /> Require an approved plan for live execution</label></div>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => void setConfig({ riskPolicy: risk })}>{busy ? "Saving…" : "Save risk policy"}</button>
      </details>
    </section>
  );
}

function RiskInput({ label, suffix, value, onChange }: { label: string; suffix: string; value: number; onChange: (value: number) => void }) {
  return <label><span>{label} <small>{suffix}</small></span><input type="number" min={0} step="any" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
