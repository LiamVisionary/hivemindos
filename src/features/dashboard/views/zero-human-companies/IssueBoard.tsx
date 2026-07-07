// Zero Human Companies — Linear-style issue board for a single colony.
import React from "react";
import { ChatInlineMarkdown } from "@/features/dashboard/ChatMarkdown";
import { formatPipelineUsd } from "@/features/dashboard/work-board-pipeline";
import { extractHumanAsk } from "@/features/dashboard/kanban-result-format";
import { CompanyIssueActionButtons } from "./CompanyIssueActions";
import { ConsolidatedIssueCard } from "./ConsolidatedIssueCard";
import { ISSUE_LANES } from "./data";
import { getIssueIdentity } from "./issue-identity";
import { groupIssuesByReason, issueBlockReason } from "./issue-reason";
import type { PreviewDecision } from "./preview-review";
import { PriTag, RoleGlyph, Skeleton, Spinner } from "./primitives";
import type { Agent, Colony, Issue } from "./types";

/** One-click unblock controls derived from an agent's structured `NEEDS:` ask.
 *  For a credential (`NEEDS: api-key <ENV_VAR>`) the common real cause is that
 *  the key IS set on this hub but hasn't propagated to the crew's machine (live
 *  2026-07-06), so the primary action repairs fleet sync via the tested
 *  /api/env syncMachines rail rather than asking for a key that already exists. */
function HumanAskControls({ result }: { result?: string }) {
  const ask = React.useMemo(() => extractHumanAsk(result), [result]);
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "error">("idle");
  const [detail, setDetail] = React.useState("");
  if (!ask?.input && !ask?.links.length) return null;
  const cred = ask.input?.kind === "api-key" ? ask.input.envKey : undefined;

  const repairSync = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setState("busy");
    setDetail("");
    try {
      const res = await fetch("/api/env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "syncMachines" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "Sync failed");
      setState("done");
      setDetail("Pushed your shared env to the fleet — use “Handled — retry” to re-run.");
    } catch (error) {
      setState("error");
      setDetail(error instanceof Error ? error.message : "Could not repair fleet sync.");
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {cred && (
        <div style={{ fontSize: 10.5, color: "var(--fg-3)", fontFamily: "var(--f-mono)", overflowWrap: "anywhere" }}>
          needs credential: <strong style={{ color: "var(--fg-2)" }}>{cred}</strong>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {cred && (
          <button
            type="button"
            className="zhc-btn-ghost"
            onClick={repairSync}
            disabled={state === "busy"}
            title={`If ${cred} is set on this hub but the crew's machine reports it missing, this pushes your shared env to every fleet machine.`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, padding: "4px 9px", borderRadius: 7 }}
          >
            {state === "busy" ? <Spinner size={13} /> : null}
            {state === "busy" ? "Repairing sync" : state === "done" ? "Sync repaired" : "Repair fleet sync"}
          </button>
        )}
        {ask.links.slice(0, 2).map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="zhc-btn-ghost"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 11, padding: "4px 9px", borderRadius: 7, textDecoration: "none" }}
          >
            {link.label} ↗
          </a>
        ))}
      </div>
      {detail && (
        <div style={{ fontSize: 10.5, color: state === "error" ? "var(--danger-2)" : "var(--fg-3)", overflowWrap: "anywhere" }}>{detail}</div>
      )}
    </div>
  );
}

/** Shape-matched shimmer cards for a lane whose tasks haven't loaded yet — beats
 *  flashing "empty" in every column until the Work Board fetch lands. */
function LaneSkeleton({ count }: { count: number }) {
  return (
    <div role="status" aria-label="Loading tasks" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-2)", padding: "10px 11px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Skeleton width={22} height={11} radius={4} />
            <Skeleton width={34} height={9} />
            <span style={{ flex: 1 }} />
            <Skeleton width={20} height={9} />
          </div>
          <Skeleton width="92%" height={12} />
          <Skeleton width="56%" height={12} />
        </div>
      ))}
    </div>
  );
}

function IssueCard({
  issue,
  agents,
  companyName,
  onOpen,
  onResolveIssue,
  onReviewPreview,
  onDismiss,
  busy,
}: {
  issue: Issue;
  agents: Agent[];
  companyName: string;
  onOpen?: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  onDismiss?: (issues: Issue[]) => void;
  busy?: boolean;
}) {
  const a = issue.agent;
  const stateAgent = a ? agents.find((x) => x.name === a) : null;
  // Live cards carry the real Work Board record and open the task detail;
  // demo cards have no backing task and stay inert.
  const openable = Boolean(issue.work && onOpen);
  const deliverables = issue.work?.deliverables.length ?? 0;
  const pipelineImpact = issue.pipelineImpact ?? issue.work?.pipelineImpact;
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
      className={openable ? "zhc-btn-ghost" : undefined}
      style={{
        borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-2)",
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
      {pipelineImpact ? (
        <div title={pipelineImpact.label} style={{ alignSelf: "flex-start", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger-2)", border: "1px solid color-mix(in srgb, var(--danger) 28%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)", borderRadius: 6, padding: "3px 6px", fontVariantNumeric: "tabular-nums" }}>
          {formatPipelineUsd(pipelineImpact.amountUsd)} quoted pipeline
        </div>
      ) : null}
      {blockReason && (
        <div
          className="zhc-issue-reason"
          title={blockReason}
          style={{
            fontSize: 11, lineHeight: 1.35, color: "var(--danger-2)",
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
            borderRadius: 7, padding: "5px 7px", textWrap: "pretty",
            overflowWrap: "anywhere",
          }}
        >
          <ChatInlineMarkdown text={blockReason} />
        </div>
      )}
      {issue.status === "board_review" && <HumanAskControls result={issue.work?.result} />}
      {blockReason && (
        <CompanyIssueActionButtons companyName={companyName} issue={issue} onOpenIssue={onOpen} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} onDismiss={onDismiss} busy={busy} />
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
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--live)" }} title={`${deliverables} deliverable${deliverables === 1 ? "" : "s"}`}>
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
  onRetryIssues,
  onReviewPreview,
  onDismissIssues,
  busyId,
  boardLoading = false,
}: {
  colony: Colony;
  companyName?: string;
  onOpenIssue?: (issue: Issue) => void;
  onResolveIssue?: (issue: Issue) => void;
  /** Re-queue a group of infra-blocked tasks for autonomous pickup (answer rail). */
  onRetryIssues?: (issues: Issue[]) => void;
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  onDismissIssues?: (issues: Issue[]) => void;
  busyId?: string | null;
  /** Tasks fetch still in flight — show lane skeletons instead of "empty". */
  boardLoading?: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${ISSUE_LANES.length}, minmax(178px, 1fr))`, gap: 12, minWidth: "min-content" }}>
      {ISSUE_LANES.map((lane) => {
        const items = colony.issues.filter((i) => i.status === lane.key);
        const accent = lane.key === "done" ? "var(--live)"
          : lane.key === "board_review" || lane.key === "in_review" ? "var(--honey)"
          : lane.key === "in_progress" ? "var(--fg-2)" : "var(--fg-3)";
        return (
          <div key={lane.key} style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="mono-cap" style={{ color: accent }}>{lane.label}</span>
                {boardLoading ? <Skeleton width={10} height={10} radius={3} /> : <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>{items.length}</span>}
              </div>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-4)", letterSpacing: 0.04 }}>{lane.hint}</span>
              <span style={{ height: 2, background: `color-mix(in srgb, ${accent} 45%, transparent)`, borderRadius: 999, marginTop: 4 }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 40 }}>
              {boardLoading ? (
                <LaneSkeleton count={lane.key === "in_progress" ? 2 : 1} />
              ) : (
                <>
                  {lane.key === "board_review" && onOpenIssue
                    ? groupIssuesByReason(items).map((group) =>
                      group.issues.length > 1 && group.info.consolidatable ? (
                        <ConsolidatedIssueCard key={group.signature} info={group.info} issues={group.issues} companyName={companyName} onOpenIssue={onOpenIssue} onRetryAll={onRetryIssues} onDismiss={onDismissIssues} busy={group.issues.some((issue) => issue.work?.taskId === busyId)} />
                      ) : (
                        group.issues.map((i) => (
                          <IssueCard key={getIssueIdentity(i)} issue={i} agents={colony.agents} companyName={companyName} onOpen={onOpenIssue} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} onDismiss={onDismissIssues} busy={busyId === i.work?.taskId} />
                        ))
                      ),
                    )
                    : items.map((i) => (
                      <IssueCard key={getIssueIdentity(i)} issue={i} agents={colony.agents} companyName={companyName} onOpen={onOpenIssue} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} onDismiss={onDismissIssues} busy={busyId === i.work?.taskId} />
                    ))}
                  {items.length === 0 && (
                    <div style={{ borderRadius: 10, border: "1px dashed var(--line)", padding: "14px 10px", textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>empty</div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
