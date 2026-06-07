// src/components/poly-modal/PolyMarketModal.tsx
// Compact, controlled modal for the MiroShark poly market run.
// Pinned header (the loud "sim's call" + the top pick) and a pinned footer CTA
// frame a scrollable body. Esc / backdrop click close it.
"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ModalChart } from "./modal-chart";
import { AttrRow, LadderRow, BestBet } from "./modal-parts";
import { buildPolyMarketModalData, pctf } from "./poly-data";
import type { MiroSharkPolymarketDetailData } from "@/lib/types/miroshark-polymarket";
import styles from "./poly-modal.module.css";

export interface PolyMarketModalProps {
  detail?: MiroSharkPolymarketDetailData;
  marketUrl?: string;
  marketTitle?: string;
  open?: boolean;
  onClose?: () => void;
  onOpenMarket?: () => void;
  runId?: string;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function logoText(market: string) {
  const first = market.match(/[A-Za-z0-9]+/)?.[0] ?? "Miro";
  return first.length <= 6 ? first : first.slice(0, 6);
}

export function PolyMarketModal({ detail, marketTitle, marketUrl, open = true, onClose, onOpenMarket, runId }: PolyMarketModalProps = {}) {
  const data = useMemo(() => buildPolyMarketModalData(detail, { market: marketTitle, marketUrl }), [detail, marketTitle, marketUrl]);
  const facTotal = useMemo(() => data.facs.reduce((a, f) => a + (f.count ?? 0), 0), [data.facs]);
  const top = data.best[0];
  const noCount = data.ladder.filter((r) => r.call === "no").length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.root} onClick={onClose}>
      <div className="mm-modal" role="dialog" aria-modal="true" aria-label="Poly market run" onClick={(e) => e.stopPropagation()}>

        {/* ── pinned header ── */}
        <div className="mm-head">
          <div className="mm-bar">
            <div className="mm-logo"><span>{logoText(data.run.market)}</span></div>
            <div className="mm-titles">
              <h1>{data.run.market}</h1>
              <div className="meta">
                {data.run.vol ? <><span className="vol">{data.run.vol} vol</span><span className="d" /></> : null}
                <span>{data.run.outcomes} thresholds</span><span className="d" />
                {data.run.resolves ? <><span>resolves {data.run.resolves}</span><span className="d" /></> : null}
                <span>MiroShark · {runId || "sim_8472"}</span>
              </div>
            </div>
            <button className="mm-x" aria-label="Close" onClick={onClose}><CloseIcon /></button>
          </div>

          <div className="mm-callout">
            <div className="mm-verdict">
              <span className="lbl">{data.callout.label}</span>
              <span className="hl">{data.callout.headline}</span>
              <span className="sub">{data.callout.subhead || `${noCount} of ${data.run.outcomes} rungs lean NO`}</span>
            </div>
            <div className="mm-pick">
              <span className="tp">★ top pick</span>
              <span className="big">{(top?.call ?? "skip").toUpperCase()} · {top?.thr ?? "report"} <em>{top ? `${top.call === "yes" ? top.yes : top.no}¢` : "ready"}</em></span>
              <span className="ev">{top ? <><b>{pctf(top.ev)}</b> EV · {top.edge >= 0 ? "+" : ""}{top.edge}pp edge</> : "Open the report for the full read"}</span>
            </div>
          </div>

          <div className="mm-rule">
            <b>Read it:</b>
            <span>{data.readRule}</span>
          </div>
        </div>

        {/* ── scrollable body ── */}
        <div className="mm-body">

          <section className="mm-sec">
            <div className="sh"><span className="t">Best bets</span><span className="h">ranked by expected value</span></div>
            <div className="mm-best">
              {data.best.map((r, i) => <BestBet r={r} rank={i + 1} key={r.thr} />)}
            </div>
            {data.best.length ? null : <p className="mm-empty">MiroShark did not return ranked bet rows for this run.</p>}
          </section>

          {data.ladder.length ? (
            <section className="mm-sec">
              <div className="sh"><span className="t">Implied distribution</span><span className="h">P(cap clears threshold)</span></div>
              <ModalChart rows={data.ladder} />
              <div className="mm-chart-foot">
                <span className="it mkt"><i />crowd&apos;s price</span>
                <span className="it mdl"><i />miroshark fair</span>
                <span className="it" style={{ color: "var(--danger-2)" }}><span className="sw" />gap = edge</span>
              </div>
            </section>
          ) : null}

          {data.ladder.length ? (
            <section className="mm-sec">
              <div className="sh"><span className="t">Full ladder · {data.run.outcomes} rungs</span><span className="h">crowd vs sim</span></div>
              <div className="mm-ladder">
                <div className="mm-lh"><span>Threshold</span><span>crowd ▸ sim</span><span className="r">crowd</span><span className="r">sim</span><span>call</span></div>
                {data.ladder.map((r) => <LadderRow best={data.best} r={r} key={r.thr} />)}
              </div>
            </section>
          ) : (
            <section className="mm-sec">
              <div className="sh"><span className="t">Structured ladder</span><span className="h">not returned</span></div>
              <p className="mm-empty">This MiroShark run returned report text without threshold-level Polymarket rows. The completed card still contains the full report.</p>
            </section>
          )}

          <section className="mm-sec">
            <div className="sh"><span className="t">Why &amp; who</span><span className="h">{(data.run.agents ?? facTotal) || "sim"} agents</span></div>
            <div className="mm-2">
              <div className="mm-mini">
                <span className="mh">Why YES is rich</span>
                {(data.attr.items ?? []).map((it) => <AttrRow key={it.name} nm={it.name} amt={it.amount} />)}
                {data.attr.base != null || data.attr.net != null ? (
                  <div className="mm-net"><span>{data.attr.baseLabel ?? "Crowd"} {data.attr.base ?? "?"}% → {data.attr.netLabel ?? "Sim"}</span><b>{data.attr.net ?? "?"}%</b></div>
                ) : <p className="mm-empty">MiroShark did not return factor attribution for this run.</p>}
              </div>
              <div className="mm-mini">
                <span className="mh">Agent consensus</span>
                <div className="mm-facs">
                  {data.facs.map((f) => (
                    <div className="mm-fac" key={f.name}>
                      <div className="ft"><span className="dotc" style={{ background: f.color ?? "var(--fg-2)" }} /><span className="nm">{f.name}</span>{f.count != null ? <span className="ct">{f.count}</span> : null}</div>
                      <span className="v">{f.value}</span>
                    </div>
                  ))}
                </div>
                {data.facs.length ? <div className="mm-cons-foot"><span>{facTotal || data.run.agents || "sim"} agents</span>{data.run.conf != null ? <span>conf <b>{data.run.conf}%</b></span> : null}</div> : <p className="mm-empty">Consensus cohorts were not included in the returned detail payload.</p>}
              </div>
            </div>
          </section>

          <section className="mm-sec">
            <div className="sh"><span className="t">Before you bet</span><span className="h">what can go wrong</span></div>
            <div className="mm-risk">
              {data.risks.map((risk) => (
                <div className="mm-rk" key={`${risk.label}-${risk.value}`}>
                  <span className="k">{risk.label}</span>
                  {risk.level ? <span className={`lv ${risk.level}`}><span className="d" />{risk.value}</span> : <span className="v">{risk.value}</span>}
                  {risk.detail ? <span className="s">{risk.detail}</span> : null}
                </div>
              ))}
              {data.risks.length ? null : <p className="mm-empty">No separate risk rows were returned.</p>}
            </div>
          </section>

          <p className="mm-note">{data.note}</p>
        </div>

        {/* ── pinned footer ── */}
        <div className="mm-foot">
          <span className="legend">Top pick — <b>{top ? `${top.call.toUpperCase()} on ${top.thr}` : "report ready"}</b>{top ? ` at ${top.call === "yes" ? top.yes : top.no}¢` : ""}</span>
          <button className="mm-btn ghost" disabled={!data.marketUrl && !onOpenMarket} onClick={onOpenMarket}>Open market ↗</button>
          <button className="mm-btn primary" disabled={!data.marketUrl && !onOpenMarket} onClick={onOpenMarket}>{top ? `View top pick · ${top.call.toUpperCase()} ${top.thr}` : "View market"}</button>
        </div>

      </div>
    </div>,
    document.body,
  );
}
