import { Check, MessageSquare, X } from "lucide-react";

import approvalStyles from "@/features/approvals/approvals.module.css";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { SpendApprovalView } from "@/features/approvals/spend-approval-model";

const cls = createStyleClass(approvalStyles);

export type ApprovalCardProps = {
  approval: SpendApprovalView;
  /** Reach for the shared approve/reject modal, pre-framed to this intent. */
  onApprove: () => void;
  onReject: () => void;
  /** Optional "talk it over" affordance (opens the Queen chat with context). */
  onDiscuss?: () => void;
  busy?: boolean;
};

/**
 * One pending spend-approval, rendered identically wherever the queue appears
 * (Zero Human Companies approvals, Alerts "Review first"). Approve/Reject open
 * the shared ApproveRejectModal so a note/change can ride with the decision.
 */
export function ApprovalCard({ approval, onApprove, onReject, onDiscuss, busy = false }: ApprovalCardProps) {
  return (
    <div className={cls("approvalsRoot", "card", approval.risk)}>
      <div className={cls("cardTop")}>
        <span className={cls("riskBadge")}>{approval.kind}</span>
        <span className={cls("reqBy")}>req. {approval.agent}</span>
      </div>
      <div className={cls("cardTitle")}>{approval.title}</div>
      <div className={cls("cardActions")}>
        <button type="button" className={cls("btn", "btnPrimary")} onClick={onApprove} disabled={busy}>
          {busy ? <span className={cls("spinner")} aria-hidden="true" /> : <Check aria-hidden="true" />}
          Approve
        </button>
        <button type="button" className={cls("btn", "btnDanger")} onClick={onReject} disabled={busy}>
          <X aria-hidden="true" />
          Reject
        </button>
        {onDiscuss ? (
          <button type="button" className={cls("iconBtn")} onClick={onDiscuss} disabled={busy} aria-label="Discuss" title="Discuss with the Queen">
            <MessageSquare aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
