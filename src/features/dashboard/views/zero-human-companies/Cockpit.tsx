"use client";
// Zero Human Companies — single colony cockpit (tabbed).
import React from "react";
import { Settings2 } from "lucide-react";
import { STATE_COLOR, Ring, RoleGlyph, StatusPill, BurnBar, SectionLabel, Panel, Spinner, Skeleton, SkeletonText } from "./primitives";
import { IssueBoard } from "./IssueBoard";
import { agentsAtWork, STATUS_TONE } from "./data";
import { CompanyIssueSummaryCard, isCompanyReviewIssue } from "./CompanyIssueActions";
import { SetupBlockerBand } from "./SetupBlockerBand";
import { EmailQaBand } from "./EmailQaBand";
import { ConsolidatedIssueCard } from "./ConsolidatedIssueCard";
import { EmailThreadModal } from "./EmailThreadModal";
import { groupIssuesByReason } from "./issue-reason";
import type { PreviewDecision } from "./preview-review";
import { DeliverableCard } from "./DeliverableCard";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { ProductsPanel } from "./ProductsPanel";
import { CompanyKnowledgePanel } from "./CompanyKnowledgePanel";
import { classifyDeliverable, deliverableHref, type ClassifiedDeliverable } from "./deliverables-model";
import { outputSpecForCompany, type CompanyProfile, type OutputSpec } from "./company-output-spec";
import type { Agent, Approval, Colony, CompanyRevenueShareInput, Issue } from "./types";
import type { CompanyPricingProposal } from "@/lib/types/company";
import type { CompanyEmailDirection, CompanyEmailThread, CompanyEmailThreadsResult, CompanyMailbox, MailProviderSummary } from "@/lib/services/agent-mailboxes";
import type { SkillBrowserAttachmentTarget } from "@/features/dashboard/dashboard-types";

type SkillAttachmentBrowserOpener = (target: SkillBrowserAttachmentTarget) => void | Promise<void>;

export type CockpitHandlers = {
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  /** Human decision on a crew-raised pricing proposal (approve applies the catalog change). */
  onResolvePricing: (proposalId: string, decision: "approve" | "reject") => void;
  onFreeze: (frozen: boolean) => void;
  onDelete: () => void;
  /** Launch perpetual autonomy: decompose the apex goal + dispatch to the crew. */
  onDispatch: () => void;
  /** Stop perpetual autonomy (no new dispatches; in-flight work finishes). */
  onStopAutonomy: () => void;
  /** Open the full company editor. */
  onEdit: () => void;
  /** Open the treasury-only editor. */
  onEditTreasury: () => void;
  /** Open one member agent's company settings. */
  onEditAgent: (agentId: string) => void;
  /** Open a board card's underlying Work Board task (result + deliverables). */
  onOpenIssue: (issue: Issue) => void;
  /** Human fixed the blocker; answer the Needs-You task so it resumes. */
  onResolveIssue: (issue: Issue) => void;
  /** Re-queue a group of infra-blocked tasks for autonomous pickup (answer rail). */
  onRetryIssues?: (issues: Issue[]) => void;
  /** Set aside issues: archive their tasks off the board (persistent, reversible).
   *  Pass a single-item array for one issue, or the whole chain for a group. */
  onDismissIssues: (issues: Issue[]) => void;
  /** Approve a customer-facing preview, or send the crew change notes to regenerate it. */
  onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void;
  /** Record external company revenue and optionally collect the platform share. */
  onRecordRevenue: (input: CompanyRevenueShareInput) => void;
  /** Approval/company id currently mutating, to disable its controls. */
  busyId: string | null;
};

function dispatchedAgo(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Org chart ────────────────────────────────────────────────────────────
function OrgChart({ colony, wide, onEditAgent }: { colony: Colony; wide?: boolean; onEditAgent?: (agentId: string) => void }) {
  const queen = colony.agents.find((a) => a.role === "Queen");
  const reports = colony.agents.filter((a) => a.role !== "Queen");
  const editFor = (agent: Agent) => {
    const agentId = agent.id;
    return agentId ? () => onEditAgent?.(agentId) : undefined;
  };
  if (wide) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {queen && <AgentNode agent={queen} head onEdit={editFor(queen)} />}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {reports.map((a) => <AgentNode key={a.id ?? a.name} agent={a} flat onEdit={editFor(a)} />)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {queen && <AgentNode agent={queen} head onEdit={editFor(queen)} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 14, borderLeft: "1px solid var(--line-2)", marginLeft: 18 }}>
        {reports.map((a) => <AgentNode key={a.id ?? a.name} agent={a} onEdit={editFor(a)} />)}
      </div>
    </div>
  );
}

function AgentNode({ agent: a, head, flat, onEdit }: { agent: Agent; head?: boolean; flat?: boolean; onEdit?: () => void }) {
  const sc = STATE_COLOR[a.state] || "var(--fg-4)";
  const overBudget = a.budgetPct >= 80;
  const budgetTone = overBudget ? "var(--danger-2)" : "var(--honey-2)";
  const capLabel = a._cap ? `$${a._cap}/day cap` : "uncapped";
  return (
    <div style={{
      position: "relative", display: "flex", gap: 11, alignItems: "flex-start",
      padding: head ? "12px 12px" : "10px 11px", borderRadius: 12,
      border: head ? "1px solid color-mix(in srgb, var(--honey) 34%, transparent)" : "1px solid var(--line)",
      background: head ? "color-mix(in srgb, var(--honey) 8%, var(--bg-2))" : "var(--bg-2)",
    }}>
      {!head && !flat && <span style={{ position: "absolute", left: -14, top: 22, width: 12, height: 1, background: "var(--line-2)" }} />}
      <RoleGlyph role={a.role} size={head ? 34 : 28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: head ? 14 : 13, fontWeight: 700 }}>{a.name}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: head ? "var(--honey-2)" : "var(--cyan-2)", textTransform: "uppercase", letterSpacing: 0.06 }}>{head ? "Queen · CEO" : a.role}</span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--f-mono)", fontSize: 9.5, color: sc, textTransform: "uppercase" }}>
            <span className={"dot" + (a.state === "working" ? " live" : "")} style={{ color: sc }} />{a.state}
          </span>
          {onEdit ? (
            <button
              onClick={onEdit}
              aria-label={`Edit ${a.name}`}
              title={`Edit ${a.name}`}
              style={{ width: 28, height: 28, flexShrink: 0, display: "inline-grid", placeItems: "center", cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: 8, background: "transparent", color: "var(--fg-4)" }}
            >
              <Settings2 size={14} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--fg-3)", marginTop: 4, textWrap: "pretty" }}>{a.task}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 6, background: "color-mix(in srgb, var(--fg) 5%, transparent)", padding: "2px 6px" }}>{a.runtime}</span>
          <span style={{ flex: "1 1 120px", minWidth: 120, maxWidth: 180, height: 8, borderRadius: 999, border: "1px solid color-mix(in srgb, var(--fg) 14%, transparent)", background: "color-mix(in srgb, var(--fg) 11%, var(--bg-3))", overflow: "hidden" }} aria-label={`${a.budgetPct}% of daily cap used`}>
            <span style={{ display: "block", width: a.budgetPct + "%", height: "100%", minWidth: a.budgetPct > 0 ? 3 : 0, background: overBudget ? "var(--danger)" : "var(--honey-2)", boxShadow: a.budgetPct > 0 ? `0 0 8px ${budgetTone}` : undefined }} />
          </span>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap", fontFamily: "var(--f-mono)", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: budgetTone }}>{a.budgetPct}% used</span>
            <span style={{ fontSize: 9.5, color: "var(--fg-3)" }}>{capLabel}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Apex strip ─────────────────────────────────────────────────────────────
function ApexStrip({ colony: c }: { colony: Colony }) {
  const fresh = c.status === "setup";
  const alignColor = fresh ? "var(--fg-3)" : c.alignment >= 75 ? "var(--cyan)" : c.alignment >= 55 ? "var(--honey)" : "var(--danger)";
  const drifting = !fresh && c.alignment < 55;
  return (
    <Panel style={{ display: "flex", alignItems: "center", gap: 22, borderColor: drifting ? "color-mix(in srgb, var(--danger) 38%, transparent)" : "var(--line)", background: drifting ? "color-mix(in srgb, var(--danger) 7%, var(--panel-bg))" : "var(--panel-bg)" }}>
      <Ring pct={c.alignment} size={76} stroke={6} color={alignColor}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 600, lineHeight: 1, color: "var(--fg)" }}>{c.alignment}</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 7.5, color: "var(--fg-4)", letterSpacing: 0.08 }}>ALIGNED</div>
        </div>
      </Ring>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono-cap" style={{ color: "var(--fg-4)", marginBottom: 6 }}>apex goal · board mandate</div>
        <div style={{ fontFamily: "var(--f-display)", fontSize: 21, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.15, textWrap: "balance" }}>{c.apex.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>{c.apex.metric}</span>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 600, color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{c.apex.current}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>→ target {c.apex.target}</span>
        </div>
      </div>
      {fresh ? (
        <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 4px 0 18px", borderLeft: "1px solid var(--line)", maxWidth: 180 }}>
          <span className="mono-cap" style={{ color: "var(--fg-3)" }}>bootstrapping</span>
          <span style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 6, lineHeight: 1.4 }}>Queen is drafting the first work block. Alignment starts tracking once work begins.</span>
        </div>
      ) : drifting ? (
        <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 4px 0 18px", borderLeft: "1px solid var(--line)", maxWidth: 180 }}>
          <span className="mono-cap" style={{ color: "var(--danger-2)" }}>⚠ drift detected</span>
          <span style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 6, lineHeight: 1.4 }}>{100 - c.alignment}% of active work is unlinked to this goal.</span>
        </div>
      ) : null}
    </Panel>
  );
}

// ── Approvals ──────────────────────────────────────────────────────────────
function btn(color: string, solid: boolean, disabled?: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "6px 0", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.06, textTransform: "uppercase",
    border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
    background: solid ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
    color, opacity: disabled ? 0.5 : 1,
  };
}

function ApprovalCard({ ap, onApprove, onReject, busy }: { ap: Approval; onApprove: () => void; onReject: () => void; busy: boolean }) {
  const riskColor: Record<string, string> = { high: "var(--danger)", med: "var(--honey)", low: "var(--cyan)" };
  return (
    <div style={{ borderRadius: 11, border: `1px solid color-mix(in srgb, ${riskColor[ap.risk]} 30%, var(--line))`, background: "var(--bg-2)", padding: "13px 14px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, color: riskColor[ap.risk], textTransform: "uppercase", letterSpacing: 0.06, border: `1px solid color-mix(in srgb, ${riskColor[ap.risk]} 40%, transparent)`, borderRadius: 4, padding: "1px 5px" }}>{ap.kind}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>req. {ap.agent}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500, lineHeight: 1.4, textWrap: "pretty", flex: 1 }}>{ap.title}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button disabled={busy} onClick={onApprove} style={btn("var(--cyan)", true, busy)}>{busy ? <Spinner size={11} /> : "approve"}</button>
        <button disabled={busy} onClick={onReject} style={btn("var(--fg-3)", false, busy)}>reject</button>
      </div>
    </div>
  );
}

/** A crew-raised price-change request: approve applies it to the shared-brain catalog. */
function PricingProposalCard({ proposal, onApprove, onReject, busy }: { proposal: CompanyPricingProposal; onApprove: () => void; onReject: () => void; busy: boolean }) {
  const up = proposal.proposedAmountUsd > proposal.currentAmountUsd;
  return (
    <div style={{ borderRadius: 11, border: "1px solid color-mix(in srgb, var(--honey) 30%, var(--line))", background: "var(--bg-2)", padding: "13px 14px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, color: "var(--honey-2)", textTransform: "uppercase", letterSpacing: 0.06, border: "1px solid color-mix(in srgb, var(--honey) 40%, transparent)", borderRadius: 4, padding: "1px 5px" }}>pricing change</span>
        <span style={{ flex: 1 }} />
        {proposal.proposedBy && <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>req. {proposal.proposedBy}</span>}
      </div>
      <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500, lineHeight: 1.4, textWrap: "pretty" }}>
        {proposal.productName}:{" "}
        <span style={{ fontFamily: "var(--f-mono)", textDecoration: "line-through", color: "var(--fg-4)" }}>${proposal.currentAmountUsd.toLocaleString("en-US")}</span>{" "}
        → <span style={{ fontFamily: "var(--f-mono)", color: up ? "var(--honey-2)" : "var(--cyan)" }}>${proposal.proposedAmountUsd.toLocaleString("en-US")}</span>
      </div>
      {proposal.why && (
        <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45, marginTop: 7, textWrap: "pretty", flex: 1 }}>{proposal.why}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button disabled={busy} onClick={onApprove} style={btn("var(--cyan)", true, busy)} title="Apply the new price to the shared-brain catalog">{busy ? <Spinner size={11} /> : "approve new price"}</button>
        <button disabled={busy} onClick={onReject} style={btn("var(--fg-3)", false, busy)} title="Keep the current price; the crew learns the decision">reject</button>
      </div>
    </div>
  );
}

// ── Governance + activity ────────────────────────────────────────────────
function GovernanceFeed({ colony }: { colony: Colony }) {
  const icon: Record<string, string> = { patch: "⊘", reflect: "✸", escalate: "↑", alert: "⚠" };
  const color: Record<string, string> = { patch: "var(--cyan-2)", reflect: "var(--honey-2)", escalate: "var(--honey)", alert: "var(--danger-2)" };
  const lbl: Record<string, string> = { patch: "archetype patch", reflect: "self-improvement", escalate: "escalation", alert: "audit alert" };
  return (
    <Panel>
      <SectionLabel>recursive governance</SectionLabel>
      {colony.governance.length === 0 ? (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)", padding: "8px 0" }}>No governance events yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {colony.governance.map((g, i) => (
            <div key={`${g.kind}-${g.agent}-${g.since}-${i}`} style={{ display: "flex", gap: 10 }}>
              <span style={{ width: 22, height: 22, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 6, background: `color-mix(in srgb, ${color[g.kind]} 14%, transparent)`, color: color[g.kind], fontSize: 12 }}>{icon[g.kind]}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono-cap" style={{ color: color[g.kind] }}>{lbl[g.kind]}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{g.agent} · {g.since}</span>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--fg-2)", marginTop: 3, textWrap: "pretty" }}>{g.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ActivityTicker({ colony }: { colony: Colony }) {
  const [tick, setTick] = React.useState(0);
  const lines = colony.activity;
  // Re-subscribe whenever the activity content changes (not just its length).
  React.useEffect(() => {
    if (lines.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, [lines]);
  return (
    <Panel pad={0} style={{ overflow: "hidden" }}>
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot live" style={{ color: "var(--cyan)" }} />
        <span className="mono-cap" style={{ color: "var(--fg-3)" }}>live activity</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>recent events</span>
      </div>
      <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
        {lines.length === 0 ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>No recent activity recorded.</div>
        ) : lines.map((l, i) => (
          <div key={`${i}-${l}`} style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.5, whiteSpace: "pre", color: i === (tick % lines.length) ? "var(--cyan-2)" : "var(--fg-3)", opacity: i === (tick % lines.length) ? 1 : 0.7, transition: "color 300ms, opacity 300ms" }}>{l}</div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * Everything the company has produced, newest first — deliverable links plus
 * the task that made them. This is the "where do I see the actual work" surface;
 * each row opens the full task detail (result text, receipts, brief).
 */
/**
 * The always-visible "don't miss this" strip above the tabs. Collects the things
 * that actually want a human: work the crew blocked on you, spend awaiting
 * approval, and customer-facing previews ready to review before they go out. If
 * there's nothing to act on, it renders nothing.
 */
/**
 * Top-of-cockpit summary. Instead of listing every blocked issue (which spammed
 * the header with one card per needs-human task), it collapses to at most three
 * compact rows: money to approve, a single "there are X issues" tile, and a
 * single "you have X deliverables" tile — each a button that jumps to its tab.
 * Issues + deliverables sit side-by-side (2 columns) when both have items, and a
 * lone category auto-expands to full width.
 */
function ReviewStrip({ colony: c, deliverableCount, deliverableLabel, onGoToIssues, onGoToDeliverables, onGoToApprovals }: {
  colony: Colony; deliverableCount: number; deliverableLabel: string;
  onGoToIssues: () => void; onGoToDeliverables: () => void; onGoToApprovals: () => void;
}) {
  const issueCount = c.issues.filter(isCompanyReviewIssue).length;
  const previewCount = React.useMemo(
    () => collectCompanyDeliverables(c).filter((x) => x.classified.reviewable).length,
    [c],
  );
  const approvals = c.approvals.length;
  const hasIssues = issueCount > 0;
  const hasDeliverables = deliverableCount > 0;
  if (!hasIssues && !hasDeliverables && approvals === 0) return null;

  const needsAction = hasIssues || approvals > 0 || previewCount > 0;
  const tile = (accent: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 12, width: "100%", minWidth: 0, textAlign: "left", cursor: "pointer",
    borderRadius: 12, padding: "13px 15px", font: "inherit", color: "inherit",
    border: `1px solid color-mix(in srgb, ${accent} 30%, var(--line))`,
    background: `color-mix(in srgb, ${accent} 7%, var(--bg-2))`,
  });
  const label = deliverableLabel.trim().toLowerCase() || "deliverables";

  return (
    <div style={{ borderRadius: 14, border: "1px solid color-mix(in srgb, var(--honey) 40%, transparent)", background: "color-mix(in srgb, var(--honey) 6%, var(--bg-1))", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span aria-hidden style={{ fontSize: 14 }}>{needsAction ? "⚑" : "◆"}</span>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--honey-2)", letterSpacing: 0.02 }}>{needsAction ? "Needs your review" : "At a glance"}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>the crew handles the rest on its own</span>
      </div>

      {approvals > 0 && (
        <button type="button" onClick={onGoToApprovals} style={{ ...tile("var(--honey)"), marginBottom: 8 }}>
          <span aria-hidden style={{ fontSize: 16 }}>💳</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{approvals} spend approval{approvals === 1 ? "" : "s"} waiting</span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>An agent wants to spend money — approve or deny.</span>
          </span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--honey-2)", flexShrink: 0 }}>Review →</span>
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: hasIssues && hasDeliverables ? "1fr 1fr" : "1fr", gap: 8 }}>
        {hasIssues && (
          <button type="button" onClick={onGoToIssues} style={tile("var(--danger)")}>
            <span aria-hidden style={{ fontSize: 16 }}>⚠️</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{issueCount === 1 ? "There is 1 issue" : `There are ${issueCount} issues`}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>The crew is blocked and needs your input.</span>
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--honey-2)", flexShrink: 0 }}>View →</span>
          </button>
        )}
        {hasDeliverables && (
          <button type="button" onClick={onGoToDeliverables} style={tile("var(--live)")}>
            <span aria-hidden style={{ fontSize: 16 }}>📦</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>You have {deliverableCount} {label}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>{previewCount > 0 ? `${previewCount} ready for your review before they go out.` : "Shipped by the crew — open to browse."}</span>
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--honey-2)", flexShrink: 0 }}>View →</span>
          </button>
        )}
      </div>
    </div>
  );
}

function IssuesPanel({ colony: c, onOpenIssue, onResolveIssue, onRetryIssues, onReviewPreview, onDismissIssues, busyId }: {
  colony: Colony; onOpenIssue: (issue: Issue) => void; onResolveIssue: (issue: Issue) => void; onRetryIssues?: (issues: Issue[]) => void; onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void; onDismissIssues: (issues: Issue[]) => void; busyId: string | null;
}) {
  const reviewIssues = c.issues.filter(isCompanyReviewIssue);
  const activeIssues = c.issues.filter((issue) => issue.status !== "done");
  return (
    <Panel>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{reviewIssues.length} need{reviewIssues.length === 1 ? "s" : ""} you · {activeIssues.length} active</span>}>
        issues
      </SectionLabel>
      <SetupBlockerBand companyId={c.id} />
      <EmailQaBand key={c.id} companyId={c.id} />
      {reviewIssues.length === 0 ? (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "20px 0" }}>No unresolved issues — the crew can keep moving on its own.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groupIssuesByReason(reviewIssues).map((group) =>
            group.issues.length > 1 && group.info.consolidatable ? (
              <ConsolidatedIssueCard key={group.signature} info={group.info} issues={group.issues} companyName={c.name} onOpenIssue={onOpenIssue} onRetryAll={onRetryIssues} onDismiss={onDismissIssues} busy={group.issues.some((issue) => issue.work?.taskId === busyId)} />
            ) : (
              group.issues.map((issue) => (
                <CompanyIssueSummaryCard
                  key={issue.work?.taskId ?? issue.key}
                  companyName={c.name}
                  issue={issue}
                  onOpenIssue={onOpenIssue}
                  onResolveIssue={onResolveIssue}
                  onReviewPreview={onReviewPreview}
                  onDismiss={onDismissIssues}
                  busy={busyId === issue.work?.taskId}
                />
              ))
            ),
          )}
        </div>
      )}
    </Panel>
  );
}

type CardCtx = { classified: ClassifiedDeliverable; machineName?: string; key: string };

/**
 * Company profile signal for the output spec. Identity (sector/name/blurb/apex)
 * decides the PRODUCT kind; activity + issue titles feed ONLY outreach detection
 * (the Comms tab) — task titles like "social media" or "booking system" describe
 * activities and would otherwise mislabel a website agency as a media company.
 */
function companyProfileSignal(c: Colony): CompanyProfile {
  const activityText = [...(c.activity ?? []), ...c.issues.map((i) => i.title)].filter(Boolean).join(" ");
  return { sector: c.sector, name: c.name, blurb: c.blurb, apexTitle: c.apex.title, apexMetric: c.apex.metric, activityText };
}

/** Split deliverables into headline outputs / comms / the collapsed work log for a company. */
function partitionByOutput(all: CardCtx[], spec: OutputSpec) {
  const primary: CardCtx[] = [];
  const comms: CardCtx[] = [];
  const worklog: CardCtx[] = [];
  for (const x of all) {
    const bucket = spec.classOf(x.classified);
    if (bucket === "primary") primary.push(x);
    else if (bucket === "comms") comms.push(x);
    else worklog.push(x);
  }
  return { primary, comms, worklog };
}

/** Flatten every company deliverable, classify, and dedupe by target (preferring the useful copy). */
function collectCompanyDeliverables(c: Colony): CardCtx[] {
  const bySort = [...c.issues].sort((a, b) => (b.work?.completedAt ?? b.work?.updatedAt ?? 0) - (a.work?.completedAt ?? a.work?.updatedAt ?? 0));
  const seen = new Map<string, CardCtx>();
  for (const issue of bySort) {
    const work = issue.work;
    if (!work) continue;
    for (const d of work.deliverables) {
      // The dedupe key (resolved target) is also a stable, unique React key — the
      // extractor reuses one deliverable.id when two tasks reference the same file.
      const key = (deliverableHref(d) || d.path || d.label || d.id || "").replace(/\/+$/, "").toLowerCase();
      const ctx: CardCtx = { classified: classifyDeliverable(d), machineName: work.machineName, key };
      const existing = seen.get(key);
      if (!existing) seen.set(key, ctx);
      else if (existing.classified.category === "internal" && ctx.classified.category !== "internal") seen.set(key, ctx);
    }
  }
  return [...seen.values()];
}

function DeliverablesPanel({ colony: c, spec, theme = "dark" }: { colony: Colony; spec: OutputSpec; theme?: "dark" | "light" }) {
  const [showLog, setShowLog] = React.useState(false);
  const all = React.useMemo(() => collectCompanyDeliverables(c), [c]);
  const { primary, worklog } = React.useMemo(() => partitionByOutput(all, spec), [all, spec]);
  const rejectedRefs = React.useMemo(
    () => new Set((c.directives ?? []).filter((d) => d.source === "reject" && d.deliverableRef).map((d) => d.deliverableRef as string)),
    [c.directives],
  );

  return (
    <Panel>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{primary.length} item{primary.length === 1 ? "" : "s"}</span>}>
        {spec.primaryLabel}
      </SectionLabel>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: -4, marginBottom: 14 }}>{spec.primaryBlurb}</div>

      {primary.length === 0 ? (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "8px 0 14px", lineHeight: 1.5 }}>{spec.emptyHint}</div>
      ) : (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {primary.map((x) => (
            <DeliverableCard key={x.key} item={x.classified} machineName={x.machineName} theme={theme} companyId={c.id} initiallyRejected={rejectedRefs.has(x.classified.title)} layout="hero" />
          ))}
        </div>
      )}

      {worklog.length > 0 && (
        <div style={{ marginTop: 22, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <button type="button" onClick={() => setShowLog((v) => !v)} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", padding: 0, textAlign: "left" }}>
            {showLog ? "▾" : "▸"} Work log · {worklog.length} file{worklog.length === 1 ? "" : "s"} <span style={{ opacity: 0.7 }}>— notes, trackers, and scratch the crew used to get here (not deliverables)</span>
          </button>
          {showLog && (
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))", marginTop: 12 }}>
              {worklog.map((x) => (
                <DeliverableCard key={x.key} item={x.classified} machineName={x.machineName} theme={theme} companyId={c.id} initiallyRejected={rejectedRefs.has(x.classified.title)} layout="card" />
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

const EMAIL_DIRECTION_META: Record<CompanyEmailDirection, { glyph: string; label: string; color: string }> = {
  outbound: { glyph: "↑", label: "sent", color: "var(--cyan-2)" },
  inbound: { glyph: "↓", label: "reply", color: "var(--honey-2)" },
  mixed: { glyph: "↕", label: "thread", color: "var(--fg-2)" },
  queued: { glyph: "⏸", label: "queued", color: "var(--fg-3)" },
};

/** One outreach thread: who's on the other end, subject, preview, provenance. */
function EmailThreadCard({ thread, onOpen }: { thread: CompanyEmailThread; onOpen?: (thread: CompanyEmailThread) => void }) {
  const dir = EMAIL_DIRECTION_META[thread.direction] ?? EMAIL_DIRECTION_META.mixed;
  const who = thread.correspondents.length > 0 ? thread.correspondents.join(", ") : "—";
  const when = dispatchedAgo(thread.updatedAt);
  const openable = Boolean(onOpen);
  return (
    <div
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? () => onOpen!(thread) : undefined}
      onKeyDown={openable ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen!(thread); } } : undefined}
      title={openable ? "Open this email" : undefined}
      style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8, cursor: openable ? "pointer" : undefined }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span title={dir.label} aria-label={dir.label} style={{ flexShrink: 0, display: "inline-grid", placeItems: "center", width: 20, height: 20, borderRadius: 6, background: `color-mix(in srgb, ${dir.color} 16%, transparent)`, color: dir.color, fontSize: 12, fontWeight: 700 }}>{dir.glyph}</span>
        <span title={who} style={{ flex: 1, minWidth: 0, fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
        <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: 0.04, textTransform: "uppercase", color: "var(--fg-4)", border: "1px solid var(--line)", borderRadius: 5, padding: "1px 5px" }}>{thread.providerLabel}</span>
        {when && <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{when}</span>}
      </div>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, color: "var(--fg)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{thread.subject}</div>
      {thread.preview && (
        <div style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{thread.preview}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
        <span title={thread.inboxAddress} style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✉ {thread.inboxAddress}</span>
        <span>· {thread.messageCount} msg{thread.messageCount === 1 ? "" : "s"}</span>
        {thread.attachmentCount > 0 && <span>· 📎 {thread.attachmentCount}</span>}
        {(thread.links?.length ?? 0) > 0 && <span>· 🔗 {thread.links!.length}</span>}
        {openable && <span style={{ marginLeft: "auto" }}>open ↗</span>}
      </div>
    </div>
  );
}

/** Compact per-provider status chips (AgentMail / Cloudflare Inbox) so an
 *  empty or partial Emails tab explains which providers are wired. */
function MailProviderStrip({ providers }: { providers: MailProviderSummary[] }) {
  if (providers.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
      {providers.map((p) => {
        const color = p.connected ? "var(--cyan-2)" : "var(--fg-4)";
        const summary = p.connected ? (p.threadCount > 0 ? `${p.threadCount} thread${p.threadCount === 1 ? "" : "s"}` : p.inboxCount > 0 ? `${p.inboxCount} inbox${p.inboxCount === 1 ? "" : "es"}` : "connected") : "not connected";
        return (
          <span key={p.id} title={p.note || summary} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 9px" }}>
            <span className={"dot" + (p.connected && p.threadCount > 0 ? " live" : "")} style={{ color }} />
            {p.label}
            <span style={{ color: "var(--fg-4)" }}>· {summary}</span>
          </span>
        );
      })}
    </div>
  );
}

/** One agent mailbox in the roster view — clickable to focus its threads. Issue
 *  mailboxes (undeployed / blocked) get a danger accent so they read as attention. */
function AgentMailboxCard({ mailbox, agentName, onOpen }: { mailbox: CompanyMailbox; agentName?: string; onOpen: () => void }) {
  const issue = mailbox.status === "issue";
  const statusColor = issue ? "var(--danger-2)" : mailbox.threadCount > 0 ? "var(--cyan-2)" : "var(--fg-4)";
  const statusLabel = issue ? "needs attention" : mailbox.threadCount > 0 ? `${mailbox.threadCount} thread${mailbox.threadCount === 1 ? "" : "s"}` : "ready";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${mailbox.address}`}
      style={{
        textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8, padding: "13px 14px", borderRadius: 12,
        border: `1px solid ${issue ? "color-mix(in srgb, var(--danger) 42%, transparent)" : "var(--line)"}`,
        background: issue ? "color-mix(in srgb, var(--danger) 7%, var(--bg-2))" : "var(--bg-2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden style={{ fontSize: 15 }}>{issue ? "⚠️" : "✉️"}</span>
        <span title={agentName || mailbox.agentId} style={{ flex: 1, minWidth: 0, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentName || mailbox.agentId || "Shared inbox"}</span>
        <span style={{ flexShrink: 0, fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: 0.04, textTransform: "uppercase", color: "var(--fg-4)", border: "1px solid var(--line)", borderRadius: 5, padding: "1px 5px" }}>{mailbox.providerLabel}</span>
      </div>
      <span title={mailbox.address} style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mailbox.address}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 10, color: statusColor }}>
        <span className={"dot" + (!issue && mailbox.threadCount > 0 ? " live" : "")} style={{ color: statusColor }} />
        {statusLabel}
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--fg-4)" }}>open →</span>
      </div>
      {issue && mailbox.detail && (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--danger-2)", lineHeight: 1.4 }}>{mailbox.detail}</span>
      )}
    </button>
  );
}

/** A company member agent that has no mailbox on any provider — a soft issue card. */
function NoMailboxCard({ agentName }: { agentName: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "13px 14px", borderRadius: 12, border: "1px dashed var(--line-2)", background: "var(--bg-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden style={{ fontSize: 15, opacity: 0.7 }}>📭</span>
        <span title={agentName} style={{ flex: 1, minWidth: 0, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentName}</span>
      </div>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.4 }}>No mailbox yet — provision one from this agent&apos;s settings to give it outreach email.</span>
    </div>
  );
}

/** "Showing <address> ✕" chip when the all-mail list is focused on one mailbox. */
function MailFilterChip({ address, onClear }: { address: string; onClear: () => void }) {
  return (
    <div style={{ display: "flex", marginBottom: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", border: "1px solid var(--line-2)", borderRadius: 999, padding: "4px 6px 4px 11px", background: "var(--bg-2)" }}>
        <span style={{ color: "var(--fg-4)" }}>showing</span>
        <span title={address} style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✉ {address}</span>
        <button type="button" onClick={onClear} aria-label="Clear mailbox filter" title="Clear filter" style={{ display: "inline-grid", placeItems: "center", width: 18, height: 18, cursor: "pointer", border: "none", borderRadius: 999, background: "var(--bg-3)", color: "var(--fg-3)", fontSize: 11 }}>✕</button>
      </span>
    </div>
  );
}

/** Centered icon + copy used for every non-thread state of the Emails tab. */
function EmailsPlaceholder({ icon, title, body, tone = "muted" }: { icon: string; title: string; body: string; tone?: "muted" | "warn" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "34px 16px", textAlign: "center" }}>
      <span aria-hidden style={{ fontSize: 30 }}>{icon}</span>
      <span style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 600, color: tone === "warn" ? "var(--danger-2)" : "var(--fg-2)" }}>{title}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", maxWidth: 448, lineHeight: 1.55 }}>{body}</span>
    </div>
  );
}

/** Shape-matched skeleton for the thread grid while mail loads. */
function EmailsLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading email threads" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg-2)", padding: 14, display: "flex", flexDirection: "column", gap: 11 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Skeleton width={30} height={30} radius={8} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Skeleton width="58%" height={11} />
              <Skeleton width="38%" height={9} />
            </div>
          </div>
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}

type CompanyEmailsResponse = CompanyEmailThreadsResult & { ok?: boolean; error?: string };

/**
 * Comms tab for outreach companies. Streams the crew's real email threads across
 * every mail provider (AgentMail, Cloudflare Agentic Inbox) via
 * /api/companies/{id}/emails — lazily, since this only mounts when the Emails tab
 * is open, so it never touches the hot companies-list path. A per-provider status
 * strip plus honest, distinct empty states (provider not connected, no mailboxes
 * yet, mailboxes-live-but-no-threads, load error) keep an empty tab legible. A
 * segmented toggle switches between "All mail" (the merged thread list, default)
 * and "Mailboxes" — a roster of the crew's agent mailboxes where broken/undeployed
 * ones surface as attention cards; clicking a mailbox focuses the all-mail list on
 * its threads. Any comms-classified board deliverables are still shown below.
 */
function CommsPanel({ colony: c, spec, theme = "dark" }: { colony: Colony; spec: OutputSpec; theme?: "dark" | "light" }) {
  const all = React.useMemo(() => collectCompanyDeliverables(c), [c]);
  const commsDeliverables = React.useMemo(() => partitionByOutput(all, spec).comms, [all, spec]);
  const rejectedRefs = React.useMemo(
    () => new Set((c.directives ?? []).filter((d) => d.source === "reject" && d.deliverableRef).map((d) => d.deliverableRef as string)),
    [c.directives],
  );

  const [data, setData] = React.useState<CompanyEmailThreadsResult | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);
  const [openThread, setOpenThread] = React.useState<CompanyEmailThread | null>(null);

  React.useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(c.id)}/emails`, { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as CompanyEmailsResponse;
        if (ignore) return;
        if (!res.ok || payload.ok === false) throw new Error(payload.error || "Could not load email threads.");
        setData(payload);
        setError("");
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Could not load email threads.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [c.id, nonce]);

  const threads = data?.threads ?? [];
  const mailboxes = React.useMemo(() => data?.mailboxes ?? [], [data]);
  const [view, setView] = React.useState<"all" | "mailboxes">("all");
  const [focusAddress, setFocusAddress] = React.useState<string | null>(null);

  const agentNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const a of c.agents) if (a.id) map.set(a.id, a.name);
    return map;
  }, [c.agents]);

  // Company member agents with no mailbox on any provider → surfaced as issue cards.
  const agentsWithoutMailbox = React.useMemo(() => {
    const withMailbox = new Set(mailboxes.map((m) => m.agentId).filter((id): id is string => Boolean(id)));
    return c.agents.filter((a) => a.id && !withMailbox.has(a.id));
  }, [c.agents, mailboxes]);

  const mailboxCount = mailboxes.length + (data?.configured ? agentsWithoutMailbox.length : 0);
  const issueCount = mailboxes.filter((m) => m.status === "issue").length + (data?.configured ? agentsWithoutMailbox.length : 0);
  const openMailbox = (address: string) => { setFocusAddress(address); setView("all"); };
  const shownThreads = focusAddress ? threads.filter((t) => t.inboxAddress.trim().toLowerCase() === focusAddress.trim().toLowerCase()) : threads;
  const showToggle = Boolean(data) && (mailboxCount > 0 || threads.length > 0);

  return (
    <Panel>
      <SectionLabel
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{spec.commsBlurb}</span>
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              disabled={loading}
              title="Refresh email threads"
              aria-label="Refresh email threads"
              style={{ display: "inline-grid", placeItems: "center", width: 24, height: 24, cursor: loading ? "default" : "pointer", border: "1px solid var(--line-2)", borderRadius: 7, background: "transparent", color: "var(--fg-4)", opacity: loading ? 0.5 : 1, fontSize: 12 }}
            >
              {loading ? <Spinner size={12} /> : "↻"}
            </button>
          </span>
        }
      >
        {spec.commsLabel}
      </SectionLabel>

      {data && <MailProviderStrip providers={data.providers} />}

      {showToggle && (
        <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-1)", alignSelf: "flex-start", marginBottom: 14 }}>
          {([["all", "All mail", threads.length], ["mailboxes", "Mailboxes", mailboxCount]] as const).map(([key, label, count]) => {
            const on = view === key;
            const badge = key === "mailboxes" && issueCount > 0 ? issueCount : count || null;
            const badgeIssue = key === "mailboxes" && issueCount > 0;
            return (
              <button key={key} type="button" onClick={() => setView(key)} style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", border: "1px solid " + (on ? "var(--line-2)" : "transparent"), background: on ? "var(--bg-3)" : "transparent", color: on ? "var(--fg)" : "var(--fg-3)", borderRadius: 7, padding: "6px 12px", fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 600, letterSpacing: 0.08, textTransform: "uppercase" }}>
                {label}
                {badge ? (
                  <span style={{ display: "inline-grid", placeItems: "center", minWidth: 16, height: 16, padding: "0 5px", borderRadius: 999, background: badgeIssue ? "var(--danger)" : "var(--honey-2)", color: "var(--bg-0)", fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 700 }}>{badge}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {loading && !data ? (
        <EmailsLoadingSkeleton />
      ) : error ? (
        <EmailsPlaceholder icon="⚠️" title="Couldn't load email threads" body={error} tone="warn" />
      ) : view === "mailboxes" ? (
        mailboxCount > 0 ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>
                {mailboxes.length} mailbox{mailboxes.length === 1 ? "" : "es"}{issueCount > 0 ? ` · ${issueCount} need${issueCount === 1 ? "s" : ""} attention` : ""} · click one to see its mail
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" onClick={() => { setView("all"); setFocusAddress(null); }} style={{ cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 8, padding: "5px 11px", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>View all mail →</button>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
              {mailboxes.map((mb) => (
                <AgentMailboxCard key={`${mb.provider}:${mb.address}`} mailbox={mb} agentName={mb.agentId ? agentNameById.get(mb.agentId) : undefined} onOpen={() => openMailbox(mb.address)} />
              ))}
              {data?.configured && agentsWithoutMailbox.map((a) => (
                <NoMailboxCard key={`nomailbox:${a.id ?? a.name}`} agentName={a.name} />
              ))}
            </div>
          </>
        ) : (
          <EmailsPlaceholder
            icon={data?.configured ? "📭" : "🔌"}
            title={data?.configured ? "No mailboxes provisioned yet" : "No mail provider connected"}
            body={data?.detail || "Provision a mailbox from an agent's settings to give this crew outreach email."}
          />
        )
      ) : shownThreads.length > 0 ? (
        <>
          {focusAddress && <MailFilterChip address={focusAddress} onClear={() => setFocusAddress(null)} />}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
            {shownThreads.map((t) => (
              <EmailThreadCard key={t.id} thread={t} onOpen={setOpenThread} />
            ))}
          </div>
          {!focusAddress && data?.detail && (
            <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{data.detail}</div>
          )}
        </>
      ) : focusAddress ? (
        <>
          <MailFilterChip address={focusAddress} onClear={() => setFocusAddress(null)} />
          <EmailsPlaceholder icon="📭" title="No threads in this mailbox yet" body={`${focusAddress} hasn't exchanged any email yet. Clear the filter to see all mail.`} />
        </>
      ) : (
        <EmailsPlaceholder
          icon={data?.configured ? "📭" : "🔌"}
          title={data?.configured ? "No email threads here yet" : "No mail provider connected"}
          body={data?.detail || "This company runs outreach, but no live threads have landed on the board yet."}
        />
      )}

      {commsDeliverables.length > 0 && (
        <div style={{ marginTop: threads.length > 0 ? 22 : 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginBottom: 12 }}>Also referenced on the board</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {commsDeliverables.map((x) => (
              <DeliverableCard key={x.key} item={x.classified} machineName={x.machineName} theme={theme} companyId={c.id} initiallyRejected={rejectedRefs.has(x.classified.title)} layout="card" />
            ))}
          </div>
        </div>
      )}

      {openThread && (
        <EmailThreadModal
          thread={openThread}
          companyId={c.id}
          companyName={c.name}
          onClose={() => setOpenThread(null)}
          onCorrected={() => { setOpenThread(null); setNonce((n) => n + 1); }}
        />
      )}
    </Panel>
  );
}

function CapabilityCapitalPanel({
  colony: c,
  openSkillAttachmentBrowser,
}: {
  colony: Colony;
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
}) {
  const cc = c.capabilityCapital;
  const gatePct = cc.evalGates > 0 ? Math.round((cc.passedEvalGates / cc.evalGates) * 100) : 0;
  const stats = [
    { label: "learning assets", value: cc.learningAssets },
    { label: "workflows", value: cc.workflowAssets },
    { label: "experiments", value: cc.experiments },
    { label: "frontier", value: cc.frontierCandidates },
    { label: "avoid", value: cc.antiPatterns },
    { label: "distill", value: cc.distillationQueue },
  ];
  return (
    <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(300px, 420px) minmax(0, 1fr)", alignItems: "start" }}>
      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>company veteran layer</span>}>capability capital</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Ring pct={cc.score} size={94} stroke={7} color={cc.score >= 70 ? "var(--cyan)" : cc.score >= 35 ? "var(--honey)" : "var(--fg-4)"}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 600, lineHeight: 1 }}>{cc.score}</div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 8, color: "var(--fg-4)", letterSpacing: 0.08 }}>CAPITAL</div>
            </div>
          </Ring>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 600, letterSpacing: -0.25 }}>Private learning loop</div>
            <div style={{ marginTop: 7, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6 }}>
              Work, evals, receipts, artifacts, and avoided failure modes compound here so the company can swap models without losing its operating memory.
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 18 }}>
          <MiniMetric label="model independence" value={`${cc.modelIndependence}%`} />
          <MiniMetric label="14d learning velocity" value={String(cc.learningVelocity)} />
          <MiniMetric label="eval pass rate" value={cc.evalGates ? `${gatePct}%` : "none"} />
          <MiniMetric label="assets per $1" value={cc.spendEfficiency == null ? "n/a" : String(cc.spendEfficiency)} />
        </div>
      </Panel>

      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--cyan-2)" }}>evo-style search</span>}>learning assets · eval frontier</SectionLabel>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          {stats.map((item) => (
            <div key={item.label} style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "11px 12px" }}>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 600, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{item.value}</div>
              <div className="mono-cap" style={{ color: "var(--fg-4)", marginTop: 6 }}>{item.label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {cc.notes.map((note) => (
            <div key={note} style={{ display: "flex", gap: 9, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", lineHeight: 1.5 }}>
              <span style={{ color: note.includes("No ") || note.includes("Launch ") ? "var(--honey-2)" : "var(--cyan-2)" }}>•</span>
              <span>{note}</span>
            </div>
          ))}
        </div>
      </Panel>
      <CompanyKnowledgePanel colony={c} openSkillAttachmentBrowser={openSkillAttachmentBrowser} />
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "10px 11px" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="mono-cap" style={{ color: "var(--fg-4)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

function money(value?: number): string {
  return `$${Math.max(0, Number(value) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function RevenueSharePanel({ colony: c, handlers }: { colony: Colony; handlers: CockpitHandlers }) {
  const busy = handlers.busyId === c.id;
  const [amount, setAmount] = React.useState("");
  const [source, setSource] = React.useState<CompanyRevenueShareInput["source"]>("manual");
  const [collectFee, setCollectFee] = React.useState(true);
  const [collectingAgentId, setCollectingAgentId] = React.useState(c.agents[0]?.id ?? "");
  const amountUsd = Number(amount);
  const rollup = c.revenueShare;
  const firstAgentId = c.agents.find((agent) => agent.id)?.id ?? "";
  const effectiveAgentId = c.agents.some((agent) => agent.id === collectingAgentId) ? collectingAgentId : firstAgentId;
  const canSubmit = Number.isFinite(amountUsd) && amountUsd > 0 && (!collectFee || Boolean(effectiveAgentId));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    handlers.onRecordRevenue({
      amountUsd,
      source,
      collectFee,
      collectingAgentId: collectFee ? effectiveAgentId : undefined,
    });
    setAmount("");
  };

  return (
    <Panel>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey-2)" }}>policy share</span>}>revenue share</SectionLabel>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
        <MiniMetric label="recorded revenue" value={money(rollup?.totalRevenueUsd)} />
        <MiniMetric label="share collected" value={money(rollup?.shareCollectedUsd)} />
        <MiniMetric label="share pending" value={money(rollup?.sharePendingUsd)} />
        <MiniMetric label="events" value={String(rollup?.eventCount ?? 0)} />
      </div>
      <form onSubmit={submit} style={{ marginTop: 16, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", alignItems: "center" }}>
        <input
          aria-label="Revenue amount USD"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.00"
          style={{ minWidth: 0, height: 34, borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg)", padding: "0 10px", fontFamily: "var(--f-mono)", fontSize: 12 }}
        />
        <select
          aria-label="Revenue source"
          value={source}
          onChange={(event) => setSource(event.target.value as CompanyRevenueShareInput["source"])}
          style={{ minWidth: 0, height: 34, borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg)", padding: "0 10px", fontFamily: "var(--f-mono)", fontSize: 12 }}
        >
          <option value="manual">Manual</option>
          <option value="stripe">Stripe</option>
          <option value="invoice">Invoice</option>
          <option value="x402">x402</option>
          <option value="marketplace">Marketplace</option>
          <option value="other">Other</option>
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={collectFee} onChange={(event) => setCollectFee(event.target.checked)} />
            collect
          </label>
          <select
            aria-label="Collecting agent wallet"
            disabled={!collectFee || c.agents.length === 0}
            value={effectiveAgentId}
            onChange={(event) => setCollectingAgentId(event.target.value)}
            style={{ flex: 1, minWidth: 0, height: 34, borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--bg-2)", color: "var(--fg)", padding: "0 10px", fontFamily: "var(--f-mono)", fontSize: 12, opacity: collectFee ? 1 : 0.5 }}
          >
            {c.agents.length === 0 ? <option value="">No agent wallet</option> : null}
            {c.agents.map((agent) => (
              <option key={agent.id ?? agent.name} value={agent.id ?? ""}>{agent.name}</option>
            ))}
          </select>
        </div>
        <button
          disabled={!canSubmit || busy}
          style={{ height: 34, minWidth: 150, padding: "0 13px", borderRadius: 8, cursor: !canSubmit || busy ? "not-allowed" : "pointer", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.06, border: "1px solid color-mix(in srgb, var(--honey) 45%, transparent)", background: !canSubmit || busy ? "var(--bg-3)" : "var(--honey-2)", color: !canSubmit || busy ? "var(--fg-4)" : "var(--bg-0)", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? <Spinner size={12} /> : collectFee ? "Record + collect" : "Record"}
        </button>
      </form>
    </Panel>
  );
}

function TreasurySection({ colony: c, handlers }: { colony: Colony; handlers: CockpitHandlers }) {
  const busy = handlers.busyId === c.id;
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(280px, 360px) minmax(0,1fr)", alignItems: "start" }}>
        <Panel>
          <SectionLabel right={
            <button
              onClick={handlers.onEditTreasury}
              title="Configure treasury"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "1px solid color-mix(in srgb, var(--honey) 45%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--honey) 12%, transparent)", color: "var(--honey-2)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, padding: "5px 11px", textTransform: "uppercase", letterSpacing: 0.06 }}
            >
              <Settings2 size={13} strokeWidth={1.8} /> Configure
            </button>
          }>treasury · USDC burn</SectionLabel>
          <BurnBar today={c.burn.today} cap={c.burn.cap} week={c.burn.week} runway={c.burn.runway} />
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.6 }}>
            Per-agent daily caps enforced at dispatch. Work pauses before overspend — never after the invoice.
          </div>
        </Panel>
        <Panel>
          <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>% of daily cap used</span>}>per-agent caps</SectionLabel>
          {c.agents.length === 0 ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>No agents on this company yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {c.agents.map((a) => {
                const over = a.budgetPct >= 80;
                const cap = a._cap ? `$${a._cap}/day` : "uncapped";
                return (
                  <div key={a.id ?? a.name} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <RoleGlyph role={a.role} size={22} />
                    <span style={{ flex: "0 1 140px", minWidth: 92, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{a.name}</span>
                    <span style={{ flex: "1 1 150px", minWidth: 130, height: 8, borderRadius: 999, border: "1px solid color-mix(in srgb, var(--fg) 14%, transparent)", background: "color-mix(in srgb, var(--fg) 11%, var(--bg-3))", overflow: "hidden" }} aria-label={`${a.name} used ${a.budgetPct}% of daily cap`}>
                      <span style={{ display: "block", width: a.budgetPct + "%", minWidth: a.budgetPct > 0 ? 3 : 0, height: "100%", background: over ? "var(--danger)" : "var(--honey-2)" }} />
                    </span>
                    <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "baseline", gap: 5, fontFamily: "var(--f-mono)", fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: over ? "var(--danger-2)" : "var(--honey-2)" }}>{a.budgetPct}% used</span>
                      <span style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{cap}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <RevenueSharePanel colony={c} handlers={handlers} />

      {/* kill switch + disband — the company's hard governance controls */}
      <Panel style={c.frozen ? { borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", background: "color-mix(in srgb, var(--danger) 7%, var(--bg-1))" } : undefined}>
        <SectionLabel color={c.frozen ? "var(--danger-2)" : "var(--fg-3)"}>kill switch · human override</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6 }}>
            {c.frozen
              ? "❄️ Frozen — every member agent's spend is blocked across all rails until you unfreeze."
              : "Freezing halts all spend for every agent in this company immediately. Use it to stop a runaway colony."}
          </div>
          <button
            disabled={busy}
            onClick={() => handlers.onFreeze(!c.frozen)}
            style={{
              padding: "8px 16px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, letterSpacing: 0.06, textTransform: "uppercase",
              border: `1px solid color-mix(in srgb, ${c.frozen ? "var(--cyan)" : "var(--danger)"} 50%, transparent)`,
              background: `color-mix(in srgb, ${c.frozen ? "var(--cyan)" : "var(--danger)"} 14%, transparent)`,
              color: c.frozen ? "var(--cyan-2)" : "var(--danger-2)", opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? <Spinner size={12} /> : c.frozen ? "Unfreeze company" : "Freeze company"}
          </button>
          {confirmDelete ? (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <button disabled={busy} onClick={handlers.onDelete} style={{ padding: "8px 14px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", border: "1px solid color-mix(in srgb, var(--danger) 55%, transparent)", background: "color-mix(in srgb, var(--danger) 20%, transparent)", color: "var(--danger-2)", opacity: busy ? 0.5 : 1 }}>confirm disband</button>
              <button onClick={() => setConfirmDelete(false)} style={{ padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)" }}>cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, textTransform: "uppercase", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-4)" }}>Disband</button>
          )}
        </div>
      </Panel>
    </div>
  );
}

function KStat({ n, label, tone, last }: { n: number; label: string; tone?: "honey" | null; last?: boolean }) {
  const c = tone === "honey" ? "var(--honey-2)" : "var(--fg)";
  return (
    <div style={{ textAlign: "left", minWidth: 64, padding: "0 16px", borderRight: last ? "none" : "1px solid var(--line)" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 600, color: c, lineHeight: 1, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div className="mono-cap" style={{ color: "var(--fg-4)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

// ── The cockpit ────────────────────────────────────────────────────────────
export function Cockpit({
  colony: c, colonies, showBudget, onBack, onSwitch, onAddAgents, openSkillAttachmentBrowser, handlers, theme = "dark", initialTasksLoading = false,
}: {
  colony: Colony; colonies: Colony[]; showBudget: boolean;
  onBack: () => void; onSwitch: (id: string) => void; onAddAgents: () => void;
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
  handlers: CockpitHandlers; theme?: "dark" | "light";
  /** True until the first Work Board tasks fetch lands — shows board lane skeletons. */
  initialTasksLoading?: boolean;
}) {
  const wb = c.workBlock;
  const wbPct = wb.total > 0 ? Math.round((wb.done / wb.total) * 100) : 0;
  const [tab, setTab] = React.useState("board");

  // The output spec decides what THIS company's deliverables are (its sites /
  // books / clips) vs. work log, and whether it runs outreach (→ Comms tab).
  const spec = React.useMemo(() => outputSpecForCompany(companyProfileSignal(c)), [c]);

  // Badge the headline-output count so it matches the panel — the raw per-task
  // total double-counts shared files and buries the product in scratch/log files.
  // Rejected deliverables are recorded as `reject` directives (matched by title,
  // same contract the panel uses) and must not keep drawing the badge's attention.
  const rejectedDeliverableTitles = React.useMemo(
    () => new Set((c.directives ?? []).filter((d) => d.source === "reject" && d.deliverableRef).map((d) => d.deliverableRef as string)),
    [c.directives],
  );
  const deliverableCount = React.useMemo(
    () =>
      collectCompanyDeliverables(c).filter(
        (x) => spec.classOf(x.classified) === "primary" && !rejectedDeliverableTitles.has(x.classified.title),
      ).length,
    [c, spec, rejectedDeliverableTitles],
  );
  const issueCount = c.issues.filter(isCompanyReviewIssue).length;
  const pricingProposals = c.pricingProposals ?? [];
  const tabs: { key: string; label: string; badge?: number | null; tone?: "danger" }[] = [
    { key: "board", label: "Board" },
    { key: "issues", label: "Issues", badge: issueCount || null, tone: "danger" },
    { key: "deliverables", label: spec.primaryLabel, badge: deliverableCount || null },
    ...(spec.comms ? [{ key: "comms", label: spec.commsLabel }] : []),
    // Only companies that sell fixed products carry a catalog (repo-seeded or
    // human-set in the shared brain) — no catalog, no Products tab.
    ...(c.products ? [{ key: "products", label: "Products", badge: c.products.items.length || null }] : []),
    { key: "analytics", label: "Analytics" },
    { key: "learning", label: "Learning", badge: c.capabilityCapital.distillationQueue || null },
    { key: "team", label: "Team" },
    { key: "approvals", label: "Approvals", badge: c.approvals.length + pricingProposals.length || null },
    { key: "governance", label: "Governance" },
    ...(showBudget ? [{ key: "treasury", label: "Treasury" }] : []),
  ];
  const active = tabs.some((x) => x.key === tab) ? tab : "board";

  return (
    <div style={{ padding: "22px 36px 56px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* breadcrumb + switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", border: "1px solid var(--line-2)", borderRadius: 8, cursor: "pointer", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "6px 11px" }}>← all companies</button>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }} className="scrollbar-thin">
          {colonies.map((x) => (
            <button key={x.id} onClick={() => onSwitch(x.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", background: x.id === c.id ? "var(--bg-3)" : "transparent", border: `1px solid ${x.id === c.id ? "var(--line-2)" : "var(--line)"}`, borderRadius: 8, cursor: "pointer", padding: "5px 10px", fontFamily: "var(--f-mono)", fontSize: 10.5, color: x.id === c.id ? "var(--fg)" : "var(--fg-4)" }}>
              <span className="dot" style={{ color: STATUS_TONE[x.status].dot }} />{x.ticker}
            </button>
          ))}
        </div>
      </div>

      {/* identity header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
        <RoleGlyph role="Queen" size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: 34, fontWeight: 600, letterSpacing: -1, lineHeight: 1 }}>{c.name}</h1>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)", padding: "2px 7px", border: "1px solid var(--line)", borderRadius: 5 }}>{c.ticker}</span>
            <StatusPill status={c.status} />
            <button
              onClick={handlers.onEdit}
              title="Edit company details"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid var(--line-2)", borderRadius: 8, cursor: "pointer", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 10.5, padding: "4px 10px", textTransform: "uppercase", letterSpacing: 0.06 }}
            >
              ✎ edit
            </button>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 9, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
            <span>{c.sector}</span><span style={{ opacity: 0.5 }}>·</span>
            <span>founded {c.founded}</span><span style={{ opacity: 0.5 }}>·</span>
            <span>{c.agents.length} agents · 0 humans</span>
            {c.runtimeMix.length > 0 && <><span style={{ opacity: 0.5 }}>·</span><span>{c.runtimeMix.join(" / ")}</span></>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, paddingTop: 2 }}>
          <KStat n={c.issues.filter((i) => i.status === "done").length} label="shipped" />
          <KStat n={agentsAtWork(c)} label="at work" />
          <KStat n={c.approvals.length + pricingProposals.length} label="to approve" tone={c.approvals.length + pricingProposals.length ? "honey" : null} last />
        </div>
      </div>

      <ApexStrip colony={c} />

      <ReviewStrip colony={c} deliverableCount={deliverableCount} deliverableLabel={spec.primaryLabel} onGoToIssues={() => setTab("issues")} onGoToDeliverables={() => setTab("deliverables")} onGoToApprovals={() => setTab("approvals")} />

      {/* segmented section control */}
      <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg-1)", alignSelf: "flex-start", flexWrap: "wrap" }}>
        {tabs.map((x) => {
          const on = x.key === active;
          return (
            <button key={x.key} onClick={() => setTab(x.key)} style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", border: "1px solid " + (on ? "var(--line-2)" : "transparent"), background: on ? "var(--bg-3)" : "transparent", color: on ? "var(--fg)" : "var(--fg-3)", borderRadius: 8, padding: "7px 14px", fontFamily: "var(--f-display)", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.1, textTransform: "uppercase", transition: "background 140ms ease, color 140ms ease" }}>
              {x.label}
              {x.badge ? (
                <span style={{ display: "inline-grid", placeItems: "center", minWidth: 17, height: 17, padding: "0 5px", borderRadius: 999, background: x.tone === "danger" ? "var(--danger)" : "var(--honey-2)", color: "var(--bg-0)", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700 }}>{x.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {active === "board" && (
        <Panel>
          {/* autonomous-execution CTA: decompose the apex goal + dispatch to the crew */}
          {(() => {
            const busy = handlers.busyId === c.id;
            const launchedAgo = dispatchedAgo(c.lastDispatchedAt);
            const noGoal = !c.hasApexGoal;
            const running = Boolean(c.autonomy) && !c.frozen;
            const launchDisabled = busy || c.frozen || c.agents.length === 0 || noGoal;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <span className="mono-cap" style={{ color: running ? "var(--cyan-2)" : "var(--honey-2)", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {running ? <span className="dot live" style={{ color: "var(--cyan)" }} /> : null}
                    {running ? "autonomous · running" : "autonomous execution"}
                  </span>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 5, lineHeight: 1.5 }}>
                    {c.frozen
                      ? "Company is frozen — unfreeze it in Treasury to run autonomously."
                      : c.agents.length === 0
                        ? "Staff the company first, then launch it toward the apex goal."
                        : noGoal
                          ? "Set an apex goal for this company before launching work."
                          : running
                            ? "The crew keeps pursuing this goal on its own — re-dispatching whenever the board goes idle — until you stop it. Spend stays within the company budget."
                            : "Launch the crew to pursue this goal autonomously, continuously, until you stop it. Online agents run the work; spend stays within the company budget."}
                    {launchedAgo ? <span style={{ color: "var(--fg-4)" }}> · last dispatched {launchedAgo}</span> : null}
                  </div>
                </div>
                {running ? (
                  <button
                    disabled={busy}
                    onClick={handlers.onStopAutonomy}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
                      padding: "9px 16px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer",
                      fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, letterSpacing: 0.06,
                      border: "1px solid color-mix(in srgb, var(--warn) 50%, transparent)",
                      background: "color-mix(in srgb, var(--warn) 14%, transparent)",
                      color: "var(--warn)", opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy ? <><Spinner size={13} /> Stopping</> : "■ Stop autonomy"}
                  </button>
                ) : (
                  <button
                    disabled={launchDisabled}
                    onClick={handlers.onDispatch}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
                      padding: "9px 16px", borderRadius: 9, cursor: launchDisabled ? "not-allowed" : "pointer",
                      fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, letterSpacing: 0.06,
                      border: "1px solid color-mix(in srgb, var(--honey) 50%, transparent)",
                      background: launchDisabled ? "var(--bg-3)" : "var(--honey-2)",
                      color: launchDisabled ? "var(--fg-4)" : "var(--bg-0)", opacity: launchDisabled ? 0.6 : 1,
                    }}
                  >
                    {busy ? <><Spinner size={13} /> Launching</> : launchedAgo ? "▶ Re-launch autonomy" : "▶ Launch autonomous work"}
                  </button>
                )}
              </div>
            );
          })()}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span className="mono-cap" style={{ color: "var(--fg-4)", whiteSpace: "nowrap" }}>active work block · {wb.state}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>single-active · forces focus</span>
              </div>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 19, fontWeight: 600, letterSpacing: -0.4, marginTop: 4 }}>{wb.name}</div>
            </div>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
              {initialTasksLoading ? (
                <>
                  <Skeleton width={52} height={22} radius={5} />
                  <Skeleton width={38} height={9} />
                </>
              ) : (
                <>
                  <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 600, color: "var(--fg)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{wb.done}<span style={{ color: "var(--fg-4)", fontSize: 15 }}>/{wb.total}</span></div>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", marginTop: 3 }}>eta {wb.eta}</div>
                </>
              )}
            </div>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ width: wbPct + "%", height: "100%", background: "var(--cyan)", transition: "width 600ms ease" }} />
          </div>
          <div style={{ overflowX: "auto", paddingBottom: 4 }} className="scrollbar-thin">
            <IssueBoard colony={c} companyName={c.name} boardLoading={initialTasksLoading} onOpenIssue={handlers.onOpenIssue} onResolveIssue={handlers.onResolveIssue} onRetryIssues={handlers.onRetryIssues} onReviewPreview={handlers.onReviewPreview} onDismissIssues={handlers.onDismissIssues} busyId={handlers.busyId} />
          </div>
        </Panel>
      )}

      {active === "issues" && <IssuesPanel colony={c} onOpenIssue={handlers.onOpenIssue} onResolveIssue={handlers.onResolveIssue} onRetryIssues={handlers.onRetryIssues} onReviewPreview={handlers.onReviewPreview} onDismissIssues={handlers.onDismissIssues} busyId={handlers.busyId} />}

      {active === "deliverables" && <DeliverablesPanel colony={c} spec={spec} theme={theme} />}

      {active === "comms" && <CommsPanel colony={c} spec={spec} theme={theme} />}

      {active === "products" && (
        <ProductsPanel colony={c} pendingProposals={pricingProposals} onGoToApprovals={() => setTab("approvals")} />
      )}

      {active === "analytics" && <AnalyticsPanel colony={c} />}

      {active === "learning" && <CapabilityCapitalPanel colony={c} openSkillAttachmentBrowser={openSkillAttachmentBrowser} />}

      {active === "team" && (
        <Panel>
          <SectionLabel right={
            <button onClick={onAddAgents} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "1px solid color-mix(in srgb, var(--honey) 45%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--honey) 12%, transparent)", color: "var(--honey-2)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, padding: "5px 11px", textTransform: "uppercase", letterSpacing: 0.06 }}>+ add agent</button>
          }>org · {c.agents.length} agents · reports → Queen</SectionLabel>
          {c.agents.length === 0 ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "16px 0" }}>No agents yet — use “+ add agent” to staff this company from your roster.</div>
          ) : (
            <OrgChart colony={c} wide onEditAgent={handlers.onEditAgent} />
          )}
        </Panel>
      )}

      {active === "approvals" && (
        <Panel>
          <SectionLabel right={c.approvals.length + pricingProposals.length > 0 ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey-2)" }}>{c.approvals.length + pricingProposals.length} waiting</span> : null}>needs your approval · human-in-the-loop</SectionLabel>
          {pricingProposals.length > 0 && (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", marginBottom: c.approvals.length ? 16 : 0 }}>
              {pricingProposals.map((proposal) => (
                <PricingProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  busy={handlers.busyId === proposal.id}
                  onApprove={() => handlers.onResolvePricing(proposal.id, "approve")}
                  onReject={() => handlers.onResolvePricing(proposal.id, "reject")}
                />
              ))}
            </div>
          )}
          {c.approvals.length === 0 && pricingProposals.length === 0 ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "20px 0" }}>✓ nothing pending — the colony is self-governing within policy.</div>
          ) : c.approvals.length === 0 ? null : (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {c.approvals.map((ap) => (
                <ApprovalCard
                  key={ap.id}
                  ap={ap}
                  busy={handlers.busyId === ap.id}
                  onApprove={() => handlers.onApprove(ap.id)}
                  onReject={() => handlers.onReject(ap.id)}
                />
              ))}
            </div>
          )}
        </Panel>
      )}

      {active === "governance" && (
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
          <GovernanceFeed colony={c} />
          <ActivityTicker colony={c} />
        </div>
      )}

      {active === "treasury" && <TreasurySection colony={c} handlers={handlers} />}
    </div>
  );
}
