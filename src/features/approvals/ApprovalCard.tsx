import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardList, EyeOff, MessageSquare, X } from "lucide-react";

import approvalStyles from "@/features/approvals/approvals.module.css";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { ApprovalActionCopy, ApprovalDecision, SpendApprovalView } from "@/features/approvals/spend-approval-model";
import { ReasoningTrailView } from "@/features/reasoning/ReasoningTrailView";

const cls = createStyleClass(approvalStyles);

type MenuKind = "approve" | "reject";

export type ApprovalCardProps = {
  approval: SpendApprovalView;
  /** Primary split-button click: decide right away, no note. */
  onDecide: (decision: ApprovalDecision) => void;
  /** Caret menu item: open the shared modal, optionally seeding the note. */
  onReview: (decision: ApprovalDecision, noteSeed?: string) => void;
  /** Optional "talk it over" affordance (opens the Queen chat with context). */
  onDiscuss?: () => void;
  /** Optional deeper context affordance, e.g. the backing task detail modal. */
  onOpenDetails?: () => void;
  /** Optional quiet dismissal that does not approve or reject the action. */
  onIgnore?: () => void | Promise<void>;
  actionCopy?: ApprovalActionCopy;
  busy?: boolean;
};

/**
 * One pending spend-approval, rendered identically wherever the queue appears
 * (Zero Human Companies approvals, Alerts "Review first"). Each decision is a
 * segmented split-button: the primary side decides immediately, the caret opens
 * an "Approve but… / Reject and…" menu whose items carry a note/condition into
 * the shared ApproveRejectModal. Every item maps to the real approvals backend
 * (approve/reject + optional note) — nothing here is a placeholder.
 */
export function ApprovalCard({ approval, onDecide, onReview, onDiscuss, onOpenDetails, onIgnore, actionCopy, busy = false }: ApprovalCardProps) {
  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const reason = approval.reason?.trim();
  const showReason = Boolean(reason) && !approval.title.trim().toLowerCase().startsWith(reason?.toLowerCase() ?? "");
  // Long asks fold to two lines by default so a 40-card backlog stays scannable.
  const reasonLong = Boolean(reason && reason.length > 150);
  const amount = approval.amountUsd != null ? `$${approval.amountUsd.toFixed(2)} ${approval.asset ?? "USDC"}` : null;
  const targetIsUrl = approval.target ? /^https?:\/\//i.test(approval.target) : false;

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const pick = (decision: ApprovalDecision, seed?: string) => {
    setMenu(null);
    onReview(decision, seed);
  };

  return (
    <div ref={rootRef} className={cls("approvalsRoot", "card", approval.risk)}>
      <div className={cls("cardTop")}>
        <span className={cls("riskBadge")}>{approval.kind}</span>
        <span className={cls("reqBy")}>req. {approval.agent}</span>
      </div>
      <div className={cls("cardTitle")}>{approval.title}</div>
      {showReason ? (
        <div className={cls("reasonWrap")}>
          <p className={cls("cardReason", reasonLong && !reasonOpen ? "cardReasonClamp" : undefined)}>{reason}</p>
          {reasonLong ? (
            <button
              type="button"
              className={cls("inlineToggle")}
              onClick={() => setReasonOpen((open) => !open)}
              aria-expanded={reasonOpen}
            >
              {reasonOpen ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
      {amount || approval.target ? (
        <div className={cls("cardContext")}>
          {amount ? <span className={cls("contextPill")}>{amount}</span> : null}
          {approval.target ? (
            targetIsUrl ? (
              <a className={cls("targetLink")} href={approval.target} target="_blank" rel="noreferrer">Open target</a>
            ) : (
              <span className={cls("contextPill")}>{approval.target}</span>
            )
          ) : null}
        </div>
      ) : null}
      {approval.explanation ? (
        <>
          <button
            type="button"
            className={cls("trailToggle")}
            onClick={() => setTrailOpen((open) => !open)}
            aria-expanded={trailOpen}
          >
            {trailOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            {trailOpen ? "Hide reasoning" : "Why this needs you"}
          </button>
          {trailOpen ? <ReasoningTrailView trail={approval.explanation} tone="approval" compact /> : null}
        </>
      ) : null}
      {onOpenDetails ? (
        <button type="button" className={cls("detailsButton")} onClick={onOpenDetails} disabled={busy}>
          <ClipboardList aria-hidden="true" /> Details
        </button>
      ) : null}

      <div className={cls("cardActions")}>
        <div className={cls("split")}>
          <button
            type="button"
            className={cls("btn", "btnPrimary", "splitMain")}
            onClick={() => onDecide("approved")}
            disabled={busy}
          >
            {busy ? <span className={cls("spinner")} aria-hidden="true" /> : <Check aria-hidden="true" />}
            {actionCopy?.approveLabel ?? "Approve"}
          </button>
          <button
            type="button"
            className={cls("btnPrimary", "splitCaret")}
            onClick={() => setMenu((prev) => (prev === "approve" ? null : "approve"))}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menu === "approve"}
            aria-label="More approve options"
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </div>

        <div className={cls("split")}>
          <button
            type="button"
            className={cls("btn", "btnDanger", "splitMain")}
            onClick={() => onDecide("denied")}
            disabled={busy}
          >
            <X aria-hidden="true" />
            {actionCopy?.rejectLabel ?? "Reject"}
          </button>
          <button
            type="button"
            className={cls("btnDanger", "splitCaret")}
            onClick={() => setMenu((prev) => (prev === "reject" ? null : "reject"))}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={menu === "reject"}
            aria-label="More reject options"
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </div>

        {onIgnore ? (
          <button
            type="button"
            className={cls("btn", "btnQuiet")}
            onClick={() => { void onIgnore(); }}
            disabled={busy}
            title="Remove this decision without approving it and keep it from resurfacing"
          >
            <EyeOff aria-hidden="true" />
            Ignore
          </button>
        ) : null}

        {onDiscuss ? (
          <button
            type="button"
            className={cls("iconBtn")}
            onClick={onDiscuss}
            disabled={busy}
            aria-label="Discuss"
            title="Discuss with the Queen"
          >
            <MessageSquare aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {menu === "approve" ? (
        <div className={cls("menu")} role="menu" aria-label="Approve options">
          <p className={cls("menuLabel")}>{actionCopy?.approveLabel ?? "Approve"} with…</p>
          <button type="button" role="menuitem" className={cls("menuItem")} onClick={() => pick("approved")}>
            Leave a note or condition
          </button>
          <button
            type="button"
            role="menuitem"
            className={cls("menuItem")}
            onClick={() => pick("approved", "Approved — cap this spend at $")}
          >
            Set a spending cap
          </button>
        </div>
      ) : null}

      {menu === "reject" ? (
        <div className={cls("menu", "menuDanger")} role="menu" aria-label="Reject options">
          <p className={cls("menuLabel")}>{actionCopy?.rejectLabel ?? "Reject"} and…</p>
          <button type="button" role="menuitem" className={cls("menuItem")} onClick={() => pick("denied")}>
            Send back for changes
          </button>
        </div>
      ) : null}
    </div>
  );
}
