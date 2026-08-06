import { useEffect, useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import approvalStyles from "@/features/approvals/approvals.module.css";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { APPROVAL_RISK_LABEL, type ApprovalActionCopy, type ApprovalDecision, type SpendApprovalView } from "@/features/approvals/spend-approval-model";
import { ReasoningTrailView } from "@/features/reasoning/ReasoningTrailView";

const cls = createStyleClass(approvalStyles);

export type ApproveRejectModalProps = {
  approval: SpendApprovalView;
  /** Which action the human reached for; sets the note framing. */
  initialDecision?: ApprovalDecision;
  /** Pre-fill the note (e.g. a spending-cap template from the caret menu). */
  initialNote?: string;
  /**
   * Optional standing-rule capture (Marketplace): renders a "This time only /
   * Save as standing rule" choice under the note; the pick rides back as the
   * third onConfirm argument. Absent ⇒ today's UI, untouched.
   */
  noteMode?: { standingLabel: string; standingHint: string };
  actionCopy?: ApprovalActionCopy;
  busy?: boolean;
  error?: string;
  onConfirm: (decision: ApprovalDecision, note: string, makeStanding?: boolean) => void;
  onClose: () => void;
};

/**
 * The shared approve/reject dialog. Both the Zero Human Companies approvals
 * section and the Alerts "Review first" queue open this exact modal, so an agent
 * gets the same human-in-the-loop decision surface — with an optional note that
 * rides along (a change request on reject, a caveat/condition on approve).
 */
export function ApproveRejectModal({ approval, initialDecision = "approved", initialNote = "", noteMode, actionCopy, busy = false, error, onConfirm, onClose }: ApproveRejectModalProps) {
  const [note, setNote] = useState(initialNote);
  const [makeStanding, setMakeStanding] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const noteId = useId();

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => noteRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [busy, onClose]);

  const rejectFramed = initialDecision === "denied";
  return (
    <div
      className={cls("approvalsRoot", "modalBackdrop")}
      role="dialog"
      aria-modal="true"
      aria-label="Review request"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div ref={dialogRef} className={cls("modal")} onClick={(event) => event.stopPropagation()}>
        <div className={cls("modalHead")}>
          <p className={cls("modalEyebrow")}>Review request</p>
          <button type="button" className={cls("closeBtn")} aria-label="Close" onClick={onClose} disabled={busy}>
            <X aria-hidden="true" width={16} height={16} />
          </button>
        </div>

        <h2 className={cls("modalTitle")}>{approval.title}</h2>
        <div className={cls("modalMeta")}>
          <span>Requested by <b>{approval.agent}</b></span>
          <span>· {approval.kind}</span>
          <span>· {APPROVAL_RISK_LABEL[approval.risk]}</span>
          {approval.amountUsd != null ? <span>· <b>${approval.amountUsd.toFixed(2)}</b> {approval.asset ?? "USDC"}</span> : null}
        </div>
        {approval.reason ? <p className={cls("modalReason")}>{approval.reason}</p> : null}
        <ReasoningTrailView trail={approval.explanation} tone="approval" />

        <div>
          <label className={cls("noteLabel")} htmlFor={noteId}>
            {rejectFramed
              ? actionCopy?.rejectNoteLabel ?? "What should change? (optional)"
              : actionCopy?.approveNoteLabel ?? "Add a condition or note (optional)"}
          </label>
          <textarea
            ref={noteRef}
            id={noteId}
            className={cls("noteInput")}
            placeholder={rejectFramed
              ? actionCopy?.rejectPlaceholder ?? "e.g. Cheaper provider, or cap it at $20 first…"
              : actionCopy?.approvePlaceholder ?? "e.g. Approved — keep it under $40 and log the run…"}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
          />
          <p className={cls("noteHint")}>{actionCopy?.noteHint ?? `The note is sent back to ${approval.agent} with your decision.`}</p>
          {noteMode ? (
            <div role="radiogroup" aria-label="How the note applies" style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {[
                { standing: false, label: "This time only", hint: "Applies to this decision alone." },
                { standing: true, label: noteMode.standingLabel, hint: noteMode.standingHint },
              ].map((option) => (
                <button
                  key={String(option.standing)}
                  type="button"
                  role="radio"
                  aria-checked={makeStanding === option.standing}
                  disabled={busy || (option.standing && !note.trim())}
                  title={option.standing && !note.trim() ? "Write the rule in the note first." : option.hint}
                  onClick={() => setMakeStanding(option.standing)}
                  style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: "pointer",
                    border: `1px solid ${makeStanding === option.standing ? "currentColor" : "color-mix(in srgb, currentColor 25%, transparent)"}`,
                    background: makeStanding === option.standing ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
                    color: "inherit", opacity: option.standing && !note.trim() ? 0.5 : 1,
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <p className={cls("modalError")}>{error}</p> : null}

        <div className={cls("modalActions")}>
          <button
            type="button"
            className={cls("btn", "btnDanger")}
            onClick={() => onConfirm("denied", note, noteMode ? makeStanding && Boolean(note.trim()) : undefined)}
            disabled={busy}
          >
            {busy ? <span className={cls("spinner")} aria-hidden="true" /> : <X aria-hidden="true" />}
            {actionCopy?.rejectLabel ?? "Reject"}
          </button>
          <button
            type="button"
            className={cls("btn", "btnPrimary")}
            onClick={() => onConfirm("approved", note, noteMode ? makeStanding && Boolean(note.trim()) : undefined)}
            disabled={busy || Boolean(actionCopy?.requireApproveNote && !note.trim())}
          >
            {busy ? <span className={cls("spinner")} aria-hidden="true" /> : <Check aria-hidden="true" />}
            {actionCopy?.approveLabel ?? "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
