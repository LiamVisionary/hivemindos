"use client";

/* surfaces.tsx — the read-only desk surfaces, all fed REAL data via the context:
   the portfolio hero (value + 24h + real value-history sparkline + allocation),
   the market-movers strip (live prices + 24h + real price-history sparklines),
   the positions table, the recent-activity panel, and the full activity view. */

import React from "react";
import { Badge, Coin, Spark, tokenColor } from "./primitives";
import { BIcon, activityIcon, walletKindIcon } from "./icons";
import { trUsd, trUsd2, trMoney, trPct, trAmt } from "./format";
import { useTradeDesk, type DeskPortfolio, type DeskMover, type DeskActivity } from "./trade-context";

// ── portfolio hero ───────────────────────────────────────────────────────────
export function PortfolioCard({ pf, isStock, win = "24h" }: { pf: DeskPortfolio; isStock: boolean; win?: "24h" | "7d" | "30d" }) {
  const up = pf.dayChange >= 0;
  const total = pf.total || 0;
  const [barHi, setBarHi] = React.useState<number | null>(null);
  const { refresh } = useTradeDesk();
  // A failed live read (set upstream) is shown as an error + Refresh, never as a
  // confident $0.00 — which would be indistinguishable from a real empty wallet.
  const failed = Boolean(pf.error);
  const segColor = (sym: string) => tokenColor(sym);
  const visible = pf.rows.filter((row) => row.usd > 0);
  const pctOf = (usd: number) => (total > 0 ? (usd / total) * 100 : 0);
  const segs = visible.map((row, i) => {
    const pct = pctOf(row.usd);
    const priorPct = visible.slice(0, i).reduce((sum, r) => sum + pctOf(r.usd), 0);
    return { id: row.id, sym: row.sym, amount: isStock ? (row.shares ?? 0) : row.amount, usd: row.usd, pct, left: priorPct + pct / 2 };
  });
  return (
    <div className="dk-pf">
      <span className="lbl"><BIcon name="trade" size={13} /> {isStock ? "Stock portfolio" : "Crypto portfolio"} · acting wallet</span>
      <span className="big">{failed && total === 0 ? "—" : trUsd2(total)}</span>
      {failed ? (
        <span className="dk-pf-err">
          <BIcon name="trade" size={13} />
          <span>{total > 0 ? `Couldn't refresh — showing last known. ${pf.error}` : pf.error}</span>
          <button type="button" onClick={refresh}>Refresh</button>
        </span>
      ) : (
        <span className="delta" style={{ color: up ? "var(--live)" : "var(--danger)" }}>
          <BIcon name={up ? "promote" : "trade"} size={13} />
          <b>{(up ? "+" : "") + trUsd2(Math.abs(pf.dayChange))}</b>
          <span style={{ color: "var(--fg-3)" }}>· {trPct(pf.dayPct)} today</span>
        </span>
      )}
      <div className="spark"><Spark data={pf.history} w={440} h={56} up={up} win={win} /></div>
      {segs.length ? (
        <div className="dk-alloc" style={{ position: "relative" }}>
          <div className="bar" onMouseLeave={() => setBarHi(null)}>
            {segs.map((s, i) => (
              <i key={s.id} style={{ width: Math.max(1.5, s.pct) + "%", background: segColor(s.sym) }} onMouseEnter={() => setBarHi(i)} />
            ))}
          </div>
          {barHi != null && segs[barHi] ? (
            <div className="dk-bartip" style={{ left: segs[barHi].left + "%" }}>
              <span className="bt-h"><i style={{ background: segColor(segs[barHi].sym) }} /><b>{segs[barHi].sym}</b></span>
              <span className="bt-a">{trAmt(segs[barHi].sym, segs[barHi].amount)} {isStock ? "sh" : segs[barHi].sym}</span>
              <span className="bt-u">{trUsd2(segs[barHi].usd)} · {segs[barHi].pct.toFixed(0)}%</span>
            </div>
          ) : null}
          <div className="leg">
            {segs.slice(0, 5).map((s) => (
              <span key={s.id}><i style={{ background: segColor(s.sym) }} />{s.sym} <b>{s.pct.toFixed(0)}%</b></span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── market movers ────────────────────────────────────────────────────────────
export function MoversCard({ movers, isStock }: { movers: DeskMover[]; isStock: boolean }) {
  return (
    <div className="dk-mov">
      <h3>Market movers</h3>
      <div className="sub">{isStock ? "US equities · IEX" : "Top tokens · live"}</div>
      {movers.length ? movers.map((m) => {
        const up = m.chg >= 0;
        const fmt = (v: number) => (v >= 1 ? trUsd2(v) : trMoney(v, 4));
        return (
          <div className="dk-movrow" key={m.sym}>
            <span className="nm"><Coin sym={m.sym} size={28} stock={isStock} /><span style={{ minWidth: 0 }}><b>{m.sym}</b><small>{m.name}</small></span></span>
            <Spark data={m.history} w={96} h={26} up={up} fmt={fmt} win="24h" />
            <span className="pr"><b>{fmt(m.price)}</b><small className={up ? "dk-up" : "dk-down"}>{trPct(m.chg)}</small></span>
          </div>
        );
      }) : <div className="dk-mov-empty">Live market data is unavailable right now.</div>}
    </div>
  );
}

// ── positions ────────────────────────────────────────────────────────────────
export function PositionsPanel({ pf, isStock }: { pf: DeskPortfolio; isStock: boolean }) {
  return (
    <div className="dk-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3>Positions</h3>
        <Badge>{pf.rows.length} held</Badge>
      </div>
      <div className="dk-pos">
        <div className="dk-poshead"><span>Asset</span><span className="r">{isStock ? "Shares" : "Amount"}</span><span className="r">Value</span><span className="r">24h</span></div>
        {pf.rows.length ? pf.rows.map((row) => {
          const up = row.chg >= 0;
          return (
            <div className="dk-posrow" key={row.id}>
              <span className="a"><Coin sym={row.sym} size={28} stock={isStock} /><span style={{ minWidth: 0 }}><b>{row.sym}</b><small>{row.name}</small></span></span>
              <span className="v r">{isStock ? (row.shares ?? 0) : trAmt(row.sym, row.amount)}</span>
              <span className="v r">{trUsd(row.usd, true)}</span>
              <span className={"chg " + (up ? "dk-up" : "dk-down")}>{trPct(row.chg)}</span>
            </div>
          );
        }) : <div className="dk-emptyrow">No open positions in this wallet yet.</div>}
      </div>
    </div>
  );
}

// ── activity ─────────────────────────────────────────────────────────────────
function WalletChip({ wid }: { wid: string }) {
  const desk = useTradeDesk();
  const actor = desk.actors[wid];
  if (!actor) return null;
  const isAgent = actor.kind === "agent";
  return (
    <span className="dk-wchip" data-agent={isAgent ? "" : undefined} title={isAgent ? "Executed by agent " + actor.name : "From " + actor.name}>
      <BIcon name={walletKindIcon(actor.kind)} size={11} />{actor.name}
    </span>
  );
}

export function ActivityPanel({ items, onViewAll }: { items: DeskActivity[]; onViewAll: () => void }) {
  return (
    <div className="dk-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3>Recent activity</h3>
        <button type="button" className="fw-manage" onClick={onViewAll}>View all →</button>
      </div>
      <div className="dk-act">
        {items.length ? items.slice(0, 5).map((it) => (
          <div className="dk-actrow" key={it.id}>
            <span className="ic"><BIcon name={activityIcon(it.kind)} size={15} /></span>
            <span className="tx"><b>{it.text}</b><small style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>{it.kind} · {it.via}<WalletChip wid={it.wid} /></small></span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <Badge tone={it.state === "open" ? "honey" : it.state === "failed" ? "danger" : "live"}>{it.state}</Badge>
              <span className="when">{it.when}</span>
            </span>
          </div>
        )) : <div className="dk-emptyrow">No activity yet.</div>}
      </div>
    </div>
  );
}

const HIST_SRC: Record<string, { label: string; color: string }> = {
  crypto: { label: "Crypto", color: "var(--honey)" },
  stocks: { label: "Stocks", color: "#5fa8f0" },
};

export function ActivityView({ items, filter, onFilter, onBack }: {
  items: DeskActivity[]; filter: "crypto" | "stocks" | "all"; onFilter: (f: "crypto" | "stocks" | "all") => void; onBack: () => void;
}) {
  const rows = React.useMemo(() => {
    const list = filter === "all" ? items : items.filter((x) => x.src === filter);
    return [...list].sort((a, b) => a.hrs - b.hrs);
  }, [items, filter]);

  const groups = React.useMemo(() => {
    const g: Record<string, DeskActivity[]> = { Today: [], Yesterday: [], Earlier: [] };
    rows.forEach((row) => { g[row.hrs < 24 ? "Today" : row.hrs < 48 ? "Yesterday" : "Earlier"].push(row); });
    return Object.entries(g).filter(([, v]) => v.length);
  }, [rows]);

  const showSrc = filter === "all";
  return (
    <div className="dk-histwrap">
      <div className="dk-histhead">
        <div className="dk-histtitle">
          <button type="button" className="tk-back" onClick={onBack} aria-label="Back to trading">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <div><h2>Activity</h2><p>{rows.length} events through your wallets</p></div>
        </div>
        <div className="dk-seg" role="tablist" aria-label="Activity source">
          <button type="button" role="tab" data-active={filter === "crypto" ? "" : undefined} onClick={() => onFilter("crypto")}><BIcon name="trade" size={15} /> Crypto</button>
          <button type="button" role="tab" data-active={filter === "stocks" ? "" : undefined} onClick={() => onFilter("stocks")}><BIcon name="activity" size={15} /> Stocks</button>
          <button type="button" role="tab" data-active={filter === "all" ? "" : undefined} onClick={() => onFilter("all")}><BIcon name="network" size={15} /> All</button>
        </div>
      </div>

      <div className="dk-panel">
        {groups.map(([day, list]) => (
          <React.Fragment key={day}>
            <div className="dk-daylabel">{day}</div>
            {list.map((it) => (
              <div className="dk-histrow" key={it.id}>
                <span className="ic"><BIcon name={activityIcon(it.kind)} size={16} /></span>
                <span className="tx">
                  <b>{it.text}</b>
                  <small>
                    {it.kind} · {it.via}
                    <WalletChip wid={it.wid} />
                    {showSrc ? <span className="dk-srcchip"><i style={{ background: HIST_SRC[it.src].color }} />{HIST_SRC[it.src].label}</span> : null}
                  </small>
                </span>
                <span className="val">{trUsd(it.usd, true)}</span>
                <span className="meta">
                  <Badge tone={it.state === "open" ? "honey" : it.state === "failed" ? "danger" : "live"}>{it.state}</Badge>
                  <span className="when">{it.when}</span>
                </span>
              </div>
            ))}
          </React.Fragment>
        ))}
        {!rows.length ? <div className="dk-empty">No activity yet.</div> : null}
      </div>
    </div>
  );
}
