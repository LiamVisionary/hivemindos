"use client";

import { useState } from "react";
import { BellRing, ExternalLink } from "lucide-react";

import { ApprovalReviewCard } from "@/features/approvals/ApprovalReviewCard";
import type { MarketplaceDecision } from "@/lib/services/marketplace/marketplace-types";

import { MARKETPLACE_NOTE_MODE, marketplaceDecisionActionCopy, marketplaceDecisionToView } from "./marketplace-approval-model";
import { useMarketplaceDesk } from "./marketplace-context";
import { Panel } from "./primitives";

/**
 * The Decisions tab: every pending marketplace approval rendered through the
 * shared ApprovalReviewCard (same surface as ZHC/Alerts), with a listing
 * photo-strip composed above listing approvals and the standing-rule note
 * mode wired in.
 */

function DecisionCard({ decision }: { decision: MarketplaceDecision }) {
  const desk = useMarketplaceDesk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {decision.preview?.photoPaths.length ? (
        <div style={{ display: "flex", gap: 6, padding: "0 2px 8px", overflowX: "auto" }}>
          {decision.preview.photoPaths.slice(0, 6).map((path) => (
            // eslint-disable-next-line @next/next/no-img-element -- photo bytes come from the pinned marketplace photo route.
            <img
              key={path}
              src={`/api/marketplace/photo?path=${encodeURIComponent(path)}`}
              alt={decision.preview?.title ?? "Listing photo"}
              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }}
              loading="lazy"
            />
          ))}
        </div>
      ) : null}
      <ApprovalReviewCard
        approval={marketplaceDecisionToView(decision)}
        noteMode={MARKETPLACE_NOTE_MODE}
        actionCopy={marketplaceDecisionActionCopy(decision)}
        busy={busy}
        error={error}
        onIgnore={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const result = await desk.ignoreDecision(decision.id);
            if (!result.ok) setError(result.error ?? "Could not ignore the decision.");
          } finally {
            setBusy(false);
          }
        }}
        onDecide={async (verdict, note, makeStanding) => {
          setBusy(true);
          setError(undefined);
          try {
            const result = await desk.decideDecision(decision.id, verdict, note, Boolean(makeStanding));
            if (!result.ok) {
              setError(result.error ?? "Could not record the decision.");
              return false;
            }
            return true;
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export function DecisionsPanel() {
  const desk = useMarketplaceDesk();
  const pending = desk.decisions.filter((decision) => decision.status === "pending");
  if (!pending.length) {
    return (
      <Panel pad="34px 30px" style={{ textAlign: "center" }}>
        <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 13.5 }}>
          Nothing needs you. The agent handles routine buyer chat on its own and only parks real decisions here.
        </p>
      </Panel>
    );
  }
  if (desk.onNavigate) {
    return (
      <Panel pad="26px 28px" style={{ maxWidth: 720 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <p style={{ margin: 0, color: "var(--fg)", fontSize: 15, fontWeight: 600 }}>
              {pending.length === 1 ? "1 marketplace decision needs you" : `${pending.length} marketplace decisions need you`}
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.5 }}>
              Alerts is the single review queue for marketplace decisions, spend approvals, and other agent requests.
            </p>
          </div>
          <button
            type="button"
            onClick={() => desk.onNavigate?.({ view: "notifications" })}
            style={{ justifySelf: "start", display: "inline-flex", alignItems: "center", gap: 7, border: 0, borderRadius: 9, padding: "9px 13px", background: "var(--honey)", color: "var(--honey-ink)", fontWeight: 650 }}
          >
            Review in Alerts <ExternalLink aria-hidden width={14} height={14} />
          </button>
        </div>
      </Panel>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      {pending.map((decision) => (
        <DecisionCard key={decision.id} decision={decision} />
      ))}
    </div>
  );
}

/** Compact "N things need you" banner above the catalog (ZHC NeedsStrip pattern). */
export function DecisionsStrip() {
  const desk = useMarketplaceDesk();
  const pending = desk.decisions.filter((decision) => decision.status === "pending");
  if (!pending.length || desk.activeTab === "decisions") return null;
  return (
    <button
      type="button"
      onClick={() => desk.onNavigate ? desk.onNavigate({ view: "notifications" }) : desk.selectTab("decisions")}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        padding: "11px 15px", marginBottom: 16, borderRadius: 12, cursor: "pointer",
        border: "1px solid var(--honey-line)", background: "var(--honey-soft)", color: "var(--honey)",
        fontSize: 13, fontWeight: 600, fontFamily: "var(--f-body)",
      }}
    >
      <BellRing aria-hidden width={15} height={15} />
      {pending.length === 1 ? "1 decision needs you" : `${pending.length} decisions need you`}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11.5, fontWeight: 500, color: "color-mix(in srgb, var(--honey) 75%, var(--fg))" }}>
        {desk.onNavigate ? "Review in Alerts" : pending[0].title}
      </span>
    </button>
  );
}
