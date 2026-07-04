"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, MessageSquare } from "lucide-react";
import { dashboardUrlForTarget } from "@/features/dashboard/dashboard-navigation";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import { getIssueIdentity } from "./issue-identity";
import { companyIssueDiscussPrompt, issueAgeLabel, issueBlockReason } from "./issue-reason";
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
  busy,
}: {
  companyName: string;
  issue: Issue;
  onOpenIssue?: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
  busy?: boolean;
}) {
  const queenChat = useQueenChat();
  const taskId = issue.work?.taskId;
  const showResolve = isCompanyReviewIssue(issue) && Boolean(onResolveIssue);
  const resolveDisabled = busy || !taskId;
  const discussIssue = (event: React.MouseEvent) => {
    stop(event);
    void queenChat.sendText(companyIssueDiscussPrompt(companyName, issue));
  };
  const resolveIssue = (event: React.MouseEvent) => {
    stop(event);
    if (resolveDisabled) return;
    onResolveIssue?.(issue);
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
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {onOpenIssue && issue.work ? (
        <button type="button" onClick={openDetails} style={buttonBase}>
          <ClipboardList size={14} aria-hidden /> Issue
        </button>
      ) : null}
      <button type="button" onClick={discussIssue} style={buttonBase}>
        <MessageSquare size={14} aria-hidden /> Discuss
      </button>
      {taskId ? (
        <button type="button" onClick={openBoard} style={buttonBase}>
          <ClipboardList size={14} aria-hidden /> Work Board
        </button>
      ) : null}
      {showResolve ? (
        <button
          type="button"
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
          <CheckCircle2 size={14} aria-hidden /> {busy ? "Resuming..." : "Mark Resolved"}
        </button>
      ) : null}
    </div>
  );
}

export function CompanyIssueSummaryCard({
  companyName,
  issue,
  onOpenIssue,
  onResolveIssue,
  busy,
}: {
  companyName: string;
  issue: Issue;
  onOpenIssue: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
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
        <CompanyIssueActionButtons companyName={companyName} issue={issue} onOpenIssue={onOpenIssue} onResolveIssue={onResolveIssue} busy={busy} />
      </div>
    </div>
  );
}
