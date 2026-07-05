"use client";

import React from "react";
import { AlertTriangle, Archive, Check, CheckCircle2, ClipboardList, ExternalLink, MessageSquare, PenLine } from "lucide-react";
import { dashboardUrlForTarget } from "@/features/dashboard/dashboard-navigation";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import { isExternalHttpUrl, openExternalUrl } from "@/lib/native/open-external-url";
import { getIssueIdentity } from "./issue-identity";
import { companyIssueDiscussPrompt, issueAgeLabel, issueBlockReason } from "./issue-reason";
import { issueReviewablePreviews, type PreviewDecision } from "./preview-review";
import { Spinner } from "./primitives";
import type { Issue } from "./types";

export function isCompanyReviewIssue(issue: Issue): boolean {
  return issue.work?.status === "needs-human" || issue.status === "board_review";
}

export function openIssueOnWorkBoard(taskId: string) {
  if (typeof window === "undefined") return;
  const url = dashboardUrlForTarget({ view: "kanban", taskId }, window.location.pathname);
  window.history.pushState({ dashboardTarget: { view: "kanban", taskId } }, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const buttonBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  borderRadius: 8,
  padding: "5px 9px",
  font: "inherit",
  fontFamily: "var(--f-mono)",
  fontSize: 11,
  border: "1px solid color-mix(in srgb, var(--honey) 45%, var(--line))",
  background: "color-mix(in srgb, var(--honey) 12%, var(--bg-2))",
  color: "var(--honey-2)",
};

function stop(event: React.MouseEvent) {
  event.stopPropagation();
}

export function CompanyIssueActionButtons({
  companyName,
  issue,
  onOpenIssue,
  onResolveIssue,
  onReviewPreview,
  onDismiss,
  busy,
}: {
  companyName: string;
  issue: Issue;
  onOpenIssue?: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  /** Set aside this issue: archive its task off the board (persistent, reversible). */
  onDismiss?: (issues: Issue[]) => void;
  busy?: boolean;
}) {
  const queenChat = useQueenChat();
  const [changeMode, setChangeMode] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const taskId = issue.work?.taskId;
  // A reviewable customer-facing preview (e.g. a `/preview/<lead>` mockup) parked
  // for the operator's sign-off gets its own Approve / Request changes pair, which
  // replaces the generic "Mark Resolved" — both resume the same task, but these
  // stamp a preview-specific decision so the crew knows to send vs. revise.
  const reviewablePreviews = Boolean(onReviewPreview) && isCompanyReviewIssue(issue) ? issueReviewablePreviews(issue) : [];
  const canReviewPreview = reviewablePreviews.length > 0;
  const previewUrl = reviewablePreviews.find((preview) => preview.url)?.url;
  const showResolve = isCompanyReviewIssue(issue) && Boolean(onResolveIssue) && !canReviewPreview;
  // Shown for any review issue: a task-backed one archives; a taskless one (no
  // Work Board record to archive) falls back to hiding it from the view.
  const showDismiss = Boolean(onDismiss) && isCompanyReviewIssue(issue);
  const resolveDisabled = busy || !taskId;
  const reviewDisabled = busy || !taskId;
  const discussIssue = (event: React.MouseEvent) => {
    stop(event);
    void queenChat.sendText(companyIssueDiscussPrompt(companyName, issue));
  };
  const resolveIssue = (event: React.MouseEvent) => {
    stop(event);
    if (resolveDisabled) return;
    onResolveIssue?.(issue);
  };
  const dismissIssue = (event: React.MouseEvent) => {
    stop(event);
    if (busy) return;
    onDismiss?.([issue]);
  };
  const approvePreview = (event: React.MouseEvent) => {
    stop(event);
    if (reviewDisabled) return;
    setChangeMode(false);
    onReviewPreview?.(issue, "approve", "");
  };
  const toggleChanges = (event: React.MouseEvent) => {
    stop(event);
    setChangeMode((open) => !open);
  };
  const sendChanges = (event: React.MouseEvent) => {
    stop(event);
    const text = notes.trim();
    if (!text || reviewDisabled) return;
    onReviewPreview?.(issue, "changes", text);
    setChangeMode(false);
    setNotes("");
  };
  const openDetails = (event: React.MouseEvent) => {
    stop(event);
    onOpenIssue?.(issue);
  };
  const openBoard = (event: React.MouseEvent) => {
    stop(event);
    if (taskId) openIssueOnWorkBoard(taskId);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {onOpenIssue && issue.work ? (
          <button type="button" className="zhc-btn-ghost" onClick={openDetails} style={buttonBase}>
            <ClipboardList size={14} aria-hidden /> Issue
          </button>
        ) : null}
        {previewUrl ? (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="zhc-linkchip"
            onClick={(event) => { stop(event); if (previewUrl && isExternalHttpUrl(previewUrl)) { event.preventDefault(); void openExternalUrl(previewUrl); } }}
            style={{ ...buttonBase, textDecoration: "none" }}
          >
            <ExternalLink size={14} aria-hidden /> Open preview
          </a>
        ) : null}
        <button type="button" className="zhc-btn-ghost" onClick={discussIssue} style={buttonBase}>
          <MessageSquare size={14} aria-hidden /> Discuss
        </button>
        {taskId ? (
          <button type="button" className="zhc-btn-ghost" onClick={openBoard} style={buttonBase}>
            <ClipboardList size={14} aria-hidden /> Work Board
          </button>
        ) : null}
        {canReviewPreview ? (
          <>
            <button
              type="button"
              className="zhc-btn-ghost"
              onClick={toggleChanges}
              title="Send the crew specific changes and have them regenerate this preview for another review."
              style={{
                ...buttonBase,
                border: changeMode ? "1px solid var(--honey-2)" : buttonBase.border,
                background: changeMode ? "color-mix(in srgb, var(--honey) 22%, var(--bg-2))" : buttonBase.background,
              }}
            >
              <PenLine size={14} aria-hidden /> Request changes
            </button>
            <button
              type="button"
              onClick={approvePreview}
              disabled={reviewDisabled}
              title={taskId ? "Approve this preview and let the crew take the next step (send it to the lead)." : "This preview is not linked to a Work Board task yet."}
              style={{
                ...buttonBase,
                border: "1px solid var(--cyan)",
                background: "var(--cyan)",
                color: "var(--bg)",
                fontWeight: 700,
                cursor: reviewDisabled ? "default" : "pointer",
                opacity: reviewDisabled ? 0.6 : 1,
              }}
            >
              {busy ? <Spinner size={14} /> : <Check size={14} aria-hidden />} {busy ? "Sending" : "Approve"}
            </button>
          </>
        ) : null}
        {showResolve ? (
          <button
            type="button"
            className="zhc-btn-ghost"
            onClick={resolveIssue}
            disabled={resolveDisabled}
            title={taskId ? "Tell the Work Board this blocker is fixed and resume the same task." : "This issue is not linked to a Work Board task yet."}
            style={{
              ...buttonBase,
              border: "1px solid color-mix(in srgb, var(--cyan) 45%, var(--line))",
              background: "color-mix(in srgb, var(--cyan) 13%, var(--bg-2))",
              color: "var(--cyan-2)",
              cursor: resolveDisabled ? "default" : "pointer",
              opacity: resolveDisabled ? 0.6 : 1,
            }}
          >
            {busy ? <Spinner size={14} /> : <CheckCircle2 size={14} aria-hidden />} {busy ? "Retrying" : "Handled — retry"}
          </button>
        ) : null}
        {showDismiss ? (
          <button
            type="button"
            className="zhc-btn-ghost"
            onClick={dismissIssue}
            disabled={busy}
            title={taskId ? "Set this aside: archive its task off the board. It stops showing as an issue and stops re-escalating. Reversible from the Work Board." : "Hide this from the review list (there's no Work Board task to archive)."}
            style={{ ...buttonBase, color: "var(--fg-3)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            <Archive size={14} aria-hidden /> Dismiss
          </button>
        ) : null}
      </div>
      {canReviewPreview && changeMode ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={stop}>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="What should change? e.g. warmer tone, feature their lunch specials, drop the price to $1,200, use their real photos…"
            rows={3}
            autoFocus
            style={{
              width: "100%", boxSizing: "border-box", resize: "vertical",
              borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-2)",
              color: "var(--fg)", font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11.5,
              lineHeight: 1.5, padding: "8px 10px",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={sendChanges}
              disabled={reviewDisabled || !notes.trim()}
              style={{
                ...buttonBase,
                border: "1px solid var(--honey-2)",
                background: "var(--honey-2)",
                color: "var(--bg)",
                fontWeight: 700,
                cursor: reviewDisabled || !notes.trim() ? "default" : "pointer",
                opacity: reviewDisabled || !notes.trim() ? 0.6 : 1,
              }}
            >
              {busy ? <Spinner size={14} /> : <PenLine size={14} aria-hidden />} {busy ? "Sending" : "Send change request"}
            </button>
            <button type="button" className="zhc-btn-ghost" onClick={(event) => { stop(event); setChangeMode(false); }} style={buttonBase}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CompanyIssueSummaryCard({
  companyName,
  issue,
  onOpenIssue,
  onResolveIssue,
  onReviewPreview,
  onDismiss,
  busy,
}: {
  companyName: string;
  issue: Issue;
  onOpenIssue: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  onDismiss?: (issues: Issue[]) => void;
  busy?: boolean;
}) {
  const reason = issueBlockReason(issue);
  const status = issue.work?.status || issue.status;
  const age = issueAgeLabel(issue);
  return (
    <div
      key={getIssueIdentity(issue)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        borderRadius: 11,
        padding: "11px 12px",
        border: "1px solid color-mix(in srgb, var(--honey) 30%, var(--line))",
        background: "color-mix(in srgb, var(--honey) 7%, var(--bg-2))",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, width: "100%" }}>
        <span aria-hidden style={{ display: "inline-grid", placeItems: "center", marginTop: 2, color: "var(--danger-2)" }}>
          <AlertTriangle size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => onOpenIssue(issue)}
            title="Open the task result and deliverables"
            style={{ display: "block", textAlign: "left", width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)", overflowWrap: "anywhere" }}
          >
            {issue.title}
          </button>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
            <span>{issue.key}</span>
            <span>{status}</span>
            {issue.agent ? <span>{issue.agent}</span> : null}
            {age ? <span>{age}</span> : null}
          </span>
        </span>
      </div>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.8, lineHeight: 1.45, color: "var(--danger-2)", overflowWrap: "anywhere" }}>
        {reason || "Blocked - the crew needs a decision or an unblock from you."}
      </div>
      <div style={{ paddingLeft: 26 }}>
        <CompanyIssueActionButtons companyName={companyName} issue={issue} onOpenIssue={onOpenIssue} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} onDismiss={onDismiss} busy={busy} />
      </div>
    </div>
  );
}
