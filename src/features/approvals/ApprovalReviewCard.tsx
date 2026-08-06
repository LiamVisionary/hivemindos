import { useState } from "react";

import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { ApproveRejectModal } from "@/features/approvals/ApproveRejectModal";
import type { ApprovalActionCopy, ApprovalDecision, SpendApprovalView } from "@/features/approvals/spend-approval-model";

export type ApprovalReviewCardProps = {
  approval: SpendApprovalView;
  /** Record the decision (with optional note); return true to close the modal. */
  onDecide: (decision: ApprovalDecision, note: string, makeStanding?: boolean) => boolean | Promise<boolean>;
  /** Optional standing-rule capture in the note modal (see ApproveRejectModal). */
  noteMode?: { standingLabel: string; standingHint: string };
  /** Decision-specific language and answer requirements (for example, a buyer reply). */
  actionCopy?: ApprovalActionCopy;
  /** Optional "talk it over with the Queen" affordance. */
  onDiscuss?: () => void;
  /** Optional deep context affordance, e.g. open the backing Work Board task. */
  onOpenDetails?: () => void;
  /** Optional quiet dismissal that does not approve or reject the action. */
  onIgnore?: () => void | Promise<void>;
  busy?: boolean;
  error?: string;
};

/**
 * One pending approval as a self-contained review unit: the shared ApprovalCard
 * plus the shared ApproveRejectModal it opens. Drop it anywhere the same
 * human-in-the-loop decision surface is wanted — the Zero Human Companies
 * approvals section and the Alerts "Review first" queue both use this, so the
 * card, the modal, and the note flow stay identical (DRY).
 */
export function ApprovalReviewCard({ approval, onDecide, noteMode, actionCopy, onDiscuss, onOpenDetails, onIgnore, busy = false, error }: ApprovalReviewCardProps) {
  const [review, setReview] = useState<{ decision: ApprovalDecision; seed: string } | null>(null);
  return (
    <>
      <ApprovalCard
        approval={approval}
        busy={busy}
        actionCopy={actionCopy}
        onDecide={(decision) => {
          if (decision === "approved" && actionCopy?.requireApproveNote) {
            setReview({ decision, seed: "" });
            return;
          }
          void onDecide(decision, "");
        }}
        onReview={(decision, seed) => setReview({ decision, seed: seed ?? "" })}
        onDiscuss={onDiscuss}
        onOpenDetails={onOpenDetails}
        onIgnore={onIgnore}
      />
      {review ? (
        <ApproveRejectModal
          approval={approval}
          initialDecision={review.decision}
          initialNote={review.seed}
          noteMode={noteMode}
          actionCopy={actionCopy}
          busy={busy}
          error={error}
          onConfirm={async (nextDecision, note, makeStanding) => {
            const ok = await onDecide(nextDecision, note, makeStanding);
            if (ok) setReview(null);
          }}
          onClose={() => setReview(null)}
        />
      ) : null}
    </>
  );
}
