"use client";

import React from "react";

import type { TradePlan } from "@/lib/types/trading-control";
import { TRADING_EXECUTION_MODE_META } from "@/lib/types/trading-control";
import { BIcon } from "./icons";
import { trUsd2 } from "./format";

export function TradePlanReviewCard({
  plan,
  busy,
  onApprove,
  onReject,
  onStartNew,
}: {
  plan: TradePlan;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onStartNew?: () => void;
}) {
  const proposal = plan.proposal;
  const portfolio = proposal.portfolio;
  const projectedValue = (portfolio?.currentAssetValueUsd ?? 0) + (proposal.side === "sell" ? -proposal.notionalUsd : proposal.notionalUsd);
  const quoteAgeSeconds = proposal.quote ? Math.max(0, Math.round((Date.parse(plan.risk.evaluatedAt) - Date.parse(proposal.quote.capturedAt)) / 1_000)) : null;
  const canReview = plan.status === "review";
  const blocked = plan.risk.decision === "block";
  const complete = ["filled", "submitted", "reconciled"].includes(plan.status);
  const action = plan.executionMode === "live" ? "Approve & submit" : plan.executionMode === "paper" ? "Approve & simulate" : "Approve plan";

  return (
    <section className="tl-review" aria-label="Trade plan review">
      <div className="tl-review-head">
        <div>
          <span className="tl-eyebrow">Persistent trade plan</span>
          <h3>{plan.title}</h3>
        </div>
        <span className="tl-status" data-status={plan.status}>{plan.status}</span>
      </div>

      <div className="tl-summary-grid">
        <span><small>Mode</small><strong>{TRADING_EXECUTION_MODE_META[plan.executionMode].label}</strong></span>
        <span><small>Order</small><strong>{proposal.side} · {proposal.orderType}</strong></span>
        <span><small>Amount</small><strong>{trUsd2(proposal.notionalUsd)}</strong></span>
        <span><small>Venue</small><strong>{proposal.venue || "Not selected"}</strong></span>
      </div>

      <div className="tl-exposure">
        <div><small>Before exposure</small><strong>{portfolio ? trUsd2(portfolio.currentAssetValueUsd) : "Unknown"}</strong></div>
        <BIcon name="repeat" size={15} />
        <div><small>After estimate</small><strong>{portfolio ? trUsd2(Math.max(0, projectedValue)) : "Unknown"}</strong></div>
      </div>

      <div className="tl-risk-list" aria-label="Risk checks">
        {plan.risk.checks.map((check) => (
          <div key={check.id} data-risk={check.status}>
            <BIcon name={check.status === "pass" ? "check" : "alert"} size={13} />
            <span><strong>{check.label}</strong><small>{check.detail}</small></span>
          </div>
        ))}
      </div>

      <details className="tl-details">
        <summary>Quote, fees &amp; evidence</summary>
        <dl>
          <div><dt>Quote age</dt><dd>{quoteAgeSeconds === null ? "Unknown" : `${quoteAgeSeconds}s`}</dd></div>
          <div><dt>Slippage bound</dt><dd>{proposal.quote?.slippageBps === undefined ? "Unknown" : `${proposal.quote.slippageBps} bps`}</dd></div>
          <div><dt>Estimated fees</dt><dd>{proposal.quote?.feeUsd === undefined ? "Unknown" : trUsd2(proposal.quote.feeUsd)}</dd></div>
          <div><dt>Source</dt><dd>{proposal.quote?.source || proposal.source || "Manual"}</dd></div>
        </dl>
        {plan.thesis ? <p><strong>Thesis:</strong> {plan.thesis}</p> : null}
        {plan.evidence.length ? <p><strong>Evidence:</strong> {plan.evidence.join(" · ")}</p> : null}
        {plan.missingContext.length ? <p><strong>Missing context:</strong> {plan.missingContext.join(" · ")}</p> : null}
      </details>

      {complete && plan.execution ? <p className="tl-outcome"><BIcon name="check" size={14} /> {plan.execution.detail}</p> : null}
      {plan.status === "rejected" ? <p className="tl-outcome">This plan was rejected. Create a fresh plan to change the order.</p> : null}

      {canReview ? (
        <div className="tl-review-actions">
          <button type="button" className="tl-secondary" disabled={busy} onClick={onReject}>Reject</button>
          <button type="button" className="tk-place" disabled={busy || blocked} onClick={onApprove}>
            {busy ? <BIcon name="spinner" size={15} spin /> : null}
            {blocked ? "Blocked by risk policy" : action}
          </button>
        </div>
      ) : null}
      {!canReview && onStartNew ? <button type="button" className="tl-secondary tl-new-plan" disabled={busy} onClick={onStartNew}>Start a new plan</button> : null}
    </section>
  );
}
