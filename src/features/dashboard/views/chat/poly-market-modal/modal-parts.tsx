// src/components/poly-modal/modal-parts.tsx
// Small building blocks for the modal body.
"use client";

import { pctf, type EnrichedRung } from "./poly-data";

export function AttrRow({ nm, amt }: { nm: string; amt: number }) {
  const up = amt >= 0;
  const w = `${Math.min((Math.abs(amt) / 5.5) * 50, 50)}%`;
  return (
    <div className="mm-row">
      <span className="nm">{nm}</span>
      <span className={`amt ${up ? "up" : "dn"}`}>{up ? "+" : "−"}{Math.abs(amt).toFixed(1)}pp</span>
      <div className="track">
        <span style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, background: "var(--line-2)" }} />
        <span style={{ position: "absolute", top: 0, bottom: 0, width: w, ...(up ? { left: "50%", background: "var(--cyan)" } : { right: "50%", background: "var(--danger)" }) }} />
      </div>
    </div>
  );
}

export function LadderRow({ best, r }: { best: EnrichedRung[]; r: EnrichedRung }) {
  const bet = best.some((b) => b.thr === r.thr);
  const txt = r.call === "no" ? "BET NO" : r.call === "yes" ? "BET YES" : "SKIP";
  const price = r.call === "no" ? `${r.no}¢` : r.call === "yes" ? `${r.yes}¢` : "—";
  return (
    <div className={`mm-lr ${bet ? "bet" : ""}`}>
      <span className="thr">{r.thr}</span>
      <span className="lbar">
        <span className="f" style={{ width: `${r.pct}%` }} />
        <span className="s" style={{ left: `${r.sim}%` }} />
      </span>
      <span className="num crowd">{r.pct}%</span>
      <span className="num sim">{r.sim}%</span>
      <span className={`call ${r.call}`}>
        {bet ? <span className="star">★</span> : null}
        {txt}
        {r.call !== "skip" ? <em>{price}</em> : null}
      </span>
    </div>
  );
}

export function BestBet({ r, rank }: { r: EnrichedRung; rank: number }) {
  const side = r.call === "yes" ? "YES" : "NO";
  const price = r.call === "yes" ? r.yes : r.no;
  return (
    <div className={`mm-bb ${rank === 1 ? "top" : ""}`}>
      <div className="r1"><span className="thr">{r.thr}</span><span className="rk">{rank === 1 ? "★ top" : `#${rank}`}</span></div>
      <span className="side"><span className="tag">{side}</span> at <b>{price}¢</b></span>
      <div className="stats">
        <span className="x"><span className="n ho">{pctf(r.ev)}</span><span className="k">exp. value</span></span>
        <span className="x"><span className="n cy">{r.edge}pp</span><span className="k">edge</span></span>
        <span className="x"><span className="n">{r.vol}</span><span className="k">24h vol</span></span>
      </div>
    </div>
  );
}
