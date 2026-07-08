"use client";

// Zero Human Companies — one card for a class of identical blockers. When many
// tasks are stuck for the SAME systemic reason (e.g. every delegate machine is
// offline), the board would otherwise show N near-identical "Needs you" cards.
// This collapses them into a single card with the real reason, a count, a
// "Discuss all" that asks the Queen to fix the whole class at once, and an
// expandable list of the underlying tasks (each opens its task detail to act).
import React from "react";
import { AlertTriangle, Archive, ChevronDown, ChevronRight, MessageSquare, RotateCcw } from "lucide-react";
import { CollapsibleReasoningTrail } from "@/features/reasoning/ReasoningTrailView";
import { useQueenChat } from "@/features/queen-voice/queen-chat-store";
import { issueAgeLabel, issueGroupReasoningTrail, type IssueReasonInfo } from "./issue-reason";
import { Spinner } from "./primitives";
import type { Issue } from "./types";

export function ConsolidatedIssueCard({
  info,
  issues,
  companyName,
  onOpenIssue,
  onRetryAll,
  onDismiss,
  busy = false,
}: {
  info: IssueReasonInfo;
  issues: Issue[];
  companyName: string;
  onOpenIssue: (issue: Issue) => void;
  /** Re-queue every task in this group for autonomous pickup (the Work Board
   *  `answer` rail — zero-human boards have no hand-move). The primary action
   *  for systemic infra blockers: a collector blip or dispatch race resolves by
   *  re-running, not by a human doing the work. */
  onRetryAll?: (issues: Issue[]) => void;
  /** Set aside issues: archive their tasks off the board. Pass the whole chain to
   *  dismiss all at once, or a single-item array to dismiss one. */
  onDismiss?: (issues: Issue[]) => void;
  /** True while a task in this group is being re-queued/archived. */
  busy?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const queenChat = useQueenChat();
  const reasoning = issueGroupReasoningTrail(info, issues);

  const discussClass = () => {
    void queenChat.sendText(
      [
        `${issues.length} Work Board tasks for the ${companyName} company are all blocked for the same reason: ${info.reason}`,
        ``,
        `Tasks: ${issues.slice(0, 20).map((issue) => issue.title).join("; ")}${issues.length > 20 ? " …" : ""}`,
        ``,
        `Tell me the root cause and the single action that unblocks all of them at once (e.g. bring a machine/collector back online, or clear the capacity gate) — don't answer per task.`,
      ].join("\n"),
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 9,
        borderRadius: 11,
        padding: "11px 12px",
        border: "1px solid color-mix(in srgb, var(--danger) 30%, var(--line))",
        background: "color-mix(in srgb, var(--danger) 7%, var(--bg-2))",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span aria-hidden style={{ marginTop: 1, color: "var(--danger-2)" }}>
          <AlertTriangle size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{info.label}</span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--danger-2)", border: "1px solid color-mix(in srgb, var(--danger) 40%, var(--line))", borderRadius: 999, padding: "1px 7px" }}>
              {issues.length} tasks blocked
            </span>
          </span>
          <span style={{ display: "block", marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 10.8, lineHeight: 1.45, color: "var(--danger-2)", overflowWrap: "anywhere" }}>{info.reason}</span>
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 26 }}>
        {onRetryAll ? (
          <button
            type="button"
            className="zhc-btn-ghost"
            onClick={() => onRetryAll(issues)}
            disabled={busy}
            title={`Put all ${issues.length} tasks back in the queue for autonomous pickup. Right move when the blocker was infrastructure (machine unreachable, capacity, a dispatch race) — the crew re-attempts the same work.`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "wait" : "pointer", borderRadius: 8, padding: "5px 9px",
              font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11,
              border: "1px solid color-mix(in srgb, var(--honey) 45%, var(--line))",
              background: "color-mix(in srgb, var(--honey) 12%, var(--bg-2))", color: "var(--honey-2)",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? <Spinner size={14} /> : <RotateCcw size={14} aria-hidden />} Re-run all {issues.length}
          </button>
        ) : null}
        <button
          type="button"
          className="zhc-btn-ghost"
          onClick={discussClass}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", borderRadius: 8, padding: "5px 9px",
            font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11,
            border: "1px solid color-mix(in srgb, var(--honey) 45%, var(--line))",
            background: "color-mix(in srgb, var(--honey) 12%, var(--bg-2))", color: "var(--honey-2)",
          }}
        >
          <MessageSquare size={14} aria-hidden /> Discuss all
        </button>
        <button
          type="button"
          className="zhc-btn-ghost"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", borderRadius: 8, padding: "5px 9px",
            font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11, border: "1px solid var(--line)", background: "transparent", color: "var(--fg-3)",
          }}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {open ? "Hide tasks" : `Show ${issues.length} tasks`}
        </button>
        {onDismiss ? (
          <button
            type="button"
            className="zhc-btn-ghost"
            onClick={() => onDismiss(issues)}
            title={`Set aside all ${issues.length} tasks in this group — archive them off the board so they stop showing as issues and stop re-escalating. Reversible from the Work Board.`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", borderRadius: 8, padding: "5px 9px",
              font: "inherit", fontFamily: "var(--f-mono)", fontSize: 11, border: "1px solid var(--line)", background: "transparent", color: "var(--fg-3)",
            }}
          >
            <Archive size={14} aria-hidden /> Dismiss all {issues.length}
          </button>
        ) : null}
      </div>

      <div style={{ paddingLeft: 26 }}>
        <CollapsibleReasoningTrail trail={reasoning} tone="issue" />
      </div>

      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 26 }}>
          {issues.map((issue) => {
            const age = issueAgeLabel(issue);
            return (
              <div
                key={issue.work?.taskId ?? issue.key}
                style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg-2)" }}
              >
                <button
                  type="button"
                  className="zhc-btn-ghost"
                  onClick={() => onOpenIssue(issue)}
                  title="Open this task's result and deliverables"
                  style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "7px 9px", font: "inherit" }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11.8, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issue.title}</span>
                  <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
                    {issue.key}
                    {issue.agent ? ` · ${issue.agent}` : ""}
                    {age ? ` · ${age}` : ""}
                  </span>
                </button>
                {onDismiss ? (
                  <button
                    type="button"
                    className="zhc-btn-ghost"
                    onClick={() => onDismiss([issue])}
                    title="Dismiss just this one — archive its task off the board."
                    aria-label="Dismiss this issue"
                    style={{ display: "grid", placeItems: "center", flexShrink: 0, width: 26, height: 26, marginRight: 5, borderRadius: 7, cursor: "pointer", background: "transparent", border: "1px solid transparent", color: "var(--fg-4)" }}
                  >
                    <Archive size={13} aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
