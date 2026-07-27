"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";

import { ApprovalReviewCard } from "@/features/approvals/ApprovalReviewCard";
import type { MarketplaceDecision } from "@/lib/services/marketplace/marketplace-types";

import { MARKETPLACE_NOTE_MODE, marketplaceDecisionToView } from "./marketplace-approval-model";
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
        busy={busy}
        error={error}
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
      onClick={() => desk.selectTab("decisions")}
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
        {pending[0].title}
      </span>
    </button>
  );
}
