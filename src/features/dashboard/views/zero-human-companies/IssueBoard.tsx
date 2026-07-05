// Zero Human Companies — Linear-style issue board for a single colony.
import React from "react";
import { CompanyIssueActionButtons } from "./CompanyIssueActions";
import { ConsolidatedIssueCard } from "./ConsolidatedIssueCard";
import { ISSUE_LANES } from "./data";
import { getIssueIdentity } from "./issue-identity";
import { groupIssuesByReason, issueBlockReason } from "./issue-reason";
import type { PreviewDecision } from "./preview-review";
import { PriTag, RoleGlyph } from "./primitives";
import type { Agent, Colony, Issue } from "./types";

function IssueCard({
  issue,
  agents,
  companyName,
  onOpen,
  onResolveIssue,
  onReviewPreview,
  busy,
}: {
  issue: Issue;
  agents: Agent[];
  companyName: string;
  onOpen?: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  busy?: boolean;
}) {
  const a = issue.agent;
  const stateAgent = a ? agents.find((x) => x.name === a) : null;
  // Live cards carry the real Work Board record and open the task detail;
  // demo cards have no backing task and stay inert.
  const openable = Boolean(issue.work && onOpen);
  const deliverables = issue.work?.deliverables.length ?? 0;
  // "Needs you" cards surface WHY they're blocked inline, so the human sees the
  // reason (e.g. an API limit) without opening the task.
  const blockReason = issue.status === "board_review" ? issueBlockReason(issue) : "";
  return (
    <div
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? () => onOpen!(issue) : undefined}
      onKeyDown={openable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen!(issue); } } : undefined}
      title={openable ? "Open the task result and deliverables" : undefined}
      style={{
        borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)",
        padding: "10px 11px", display: "flex", flexDirection: "column", gap: 8,
        cursor: openable ? "pointer" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <PriTag pri={issue.pri} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{issue.key}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{issue.pts} pt</span>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.35, color: "var(--fg)", fontWeight: 500, textWrap: "pretty" }}>{issue.title}</div>
      {blockReason && (
        <div
          title={blockReason}
          style={{
            fontSize: 11, lineHeight: 1.35, color: "var(--danger-2)",
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
            borderRadius: 7, padding: "5px 7px", textWrap: "pretty",
            overflowWrap: "anywhere",
          }}
        >
          {blockReason}
        </div>
      )}
      {blockReason && (
        <CompanyIssueActionButtons companyName={companyName} issue={issue} onOpenIssue={onOpen} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} busy={busy} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 1 }}>
        {a ? (
          <>
            <RoleGlyph role={stateAgent ? stateAgent.role : "Engineer"} size={18} />
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>{a}</span>
          </>
        ) : (
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>unassigned</span>
        )}
        <span style={{ flex: 1 }} />
        {deliverables > 0 && (
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--cyan-2)" }} title={`${deliverables} deliverable${deliverables === 1 ? "" : "s"}`}>
            ⎘ {deliverables}
          </span>
        )}
        {openable && <span aria-hidden style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>↗</span>}
      </div>
    </div>
  );
}

export function IssueBoard({
  colony,
  companyName = colony.name,
  onOpenIssue,
  onResolveIssue,
  onReviewPreview,
  busyId,
}: {
  colony: Colony;
  companyName?: string;
  onOpenIssue?: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  busyId?: string | null;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${ISSUE_LANES.length}, minmax(168px, 1fr))`, gap: 12, minWidth: "min-content" }}>
      {ISSUE_LANES.map((lane) => {
        const items = colony.issues.filter((i) => i.status === lane.key);
        const accent = lane.key === "done" ? "var(--cyan-2)"
          : lane.key === "board_review" ? "var(--honey-2)"
          : lane.key === "in_review" ? "var(--honey)" : "var(--fg-3)";
        return (
          <div key={lane.key} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="mono-cap" style={{ color: accent }}>{lane.label}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>{items.length}</span>
              </div>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-4)", letterSpacing: 0.04 }}>{lane.hint}</span>
              <span style={{ height: 2, background: `color-mix(in srgb, ${accent} 45%, transparent)`, borderRadius: 999, marginTop: 4 }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 40 }}>
              {lane.key === "board_review" && onOpenIssue
                ? groupIssuesByReason(items).map((group) =>
                  group.issues.length > 1 && group.info.consolidatable ? (
                    <ConsolidatedIssueCard key={group.signature} info={group.info} issues={group.issues} companyName={companyName} onOpenIssue={onOpenIssue} />
                  ) : (
                    group.issues.map((i) => (
                      <IssueCard key={getIssueIdentity(i)} issue={i} agents={colony.agents} companyName={companyName} onOpen={onOpenIssue} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} busy={busyId === i.work?.taskId} />
                    ))
                  ),
                )
                : items.map((i) => (
                  <IssueCard key={getIssueIdentity(i)} issue={i} agents={colony.agents} companyName={companyName} onOpen={onOpenIssue} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} busy={busyId === i.work?.taskId} />
                ))}
              {items.length === 0 && (
                <div style={{ borderRadius: 10, border: "1px dashed var(--line)", padding: "14px 10px", textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>empty</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
