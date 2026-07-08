import { useState } from "react";

import { ApprovalCard } from "@/features/approvals/ApprovalCard";
import { ApproveRejectModal } from "@/features/approvals/ApproveRejectModal";
import type { ApprovalDecision, SpendApprovalView } from "@/features/approvals/spend-approval-model";

export type ApprovalReviewCardProps = {
  approval: SpendApprovalView;
  /** Record the decision (with optional note); return true to close the modal. */
  onDecide: (decision: ApprovalDecision, note: string) => boolean | Promise<boolean>;
  /** Optional "talk it over with the Queen" affordance. */
  onDiscuss?: () => void;
  /** Optional deep context affordance, e.g. open the backing Work Board task. */
  onOpenDetails?: () => void;
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
export function ApprovalReviewCard({ approval, onDecide, onDiscuss, onOpenDetails, busy = false, error }: ApprovalReviewCardProps) {
  const [review, setReview] = useState<{ decision: ApprovalDecision; seed: string } | null>(null);
  return (
    <>
      <ApprovalCard
        approval={approval}
        busy={busy}
        onDecide={(decision) => { void onDecide(decision, ""); }}
        onReview={(decision, seed) => setReview({ decision, seed: seed ?? "" })}
        onDiscuss={onDiscuss}
        onOpenDetails={onOpenDetails}
      />
      {review ? (
        <ApproveRejectModal
          approval={approval}
          initialDecision={review.decision}
          initialNote={review.seed}
          busy={busy}
          error={error}
          onConfirm={async (nextDecision, note) => {
            const ok = await onDecide(nextDecision, note);
            if (ok) setReview(null);
          }}
          onClose={() => setReview(null)}
        />
      ) : null}
    </>
  );
}
