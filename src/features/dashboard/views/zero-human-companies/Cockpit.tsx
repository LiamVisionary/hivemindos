"use client";
// Zero Human Companies — single colony cockpit (tabbed).
import React from "react";
import { Settings2 } from "lucide-react";
import { STATE_COLOR, Ring, RoleGlyph, StatusPill, BurnBar, SectionLabel, Panel, Spinner, Skeleton, alignColor } from "./primitives";
import { IssueBoard } from "./IssueBoard";
import { agentsAtWork, STATUS_TONE } from "./data";
import { CompanyIssueSummaryCard, isCompanyReviewIssue } from "./CompanyIssueActions";
import { SetupBlockerBand } from "./SetupBlockerBand";
import { EmailQaBand } from "./EmailQaBand";
import { ConsolidatedIssueCard } from "./ConsolidatedIssueCard";
import { groupIssuesByReason } from "./issue-reason";
import type { PreviewDecision } from "./preview-review";
import { DeliverableCard } from "./DeliverableCard";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { ProductsPanel } from "./ProductsPanel";
import { CompanyKnowledgePanel } from "./CompanyKnowledgePanel";
import { CommsPanel } from "./CommsPanel";
import { CompanyRunsPanel } from "./CompanyRunsPanel";
import { collectCompanyDeliverables, partitionByOutput, dispatchedAgo } from "./company-deliverables";
import { outputSpecForCompany, type CompanyProfile, type OutputSpec } from "./company-output-spec";
import type { Agent, Approval, Colony, CompanyRevenueShareInput, Issue } from "./types";
import type { CompanyPricingProposal } from "@/lib/types/company";
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

/** Solid honey / ghost / danger action button, matched to the design handoff. */
function actBtn(kind: "primary" | "ghost" | "danger", disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1, padding: "7px 0", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.06, textTransform: "uppercase",
    opacity: disabled ? 0.55 : 1,
  };
  if (kind === "primary") return { ...base, border: "1px solid var(--btn-line)", background: "var(--btn-bg)", color: "var(--btn-fg)" };
  if (kind === "danger") return { ...base, border: "1px solid var(--danger-soft)", background: "color-mix(in srgb, var(--danger) 12%, transparent)", color: "var(--danger)" };
  return { ...base, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)" };
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
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
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

function AgentNode({ agent: a, head, onEdit }: { agent: Agent; head?: boolean; flat?: boolean; onEdit?: () => void }) {
  const sc = STATE_COLOR[a.state] || "var(--fg-4)";
  const overBudget = a.budgetPct >= 80;
  const barColor = overBudget ? "var(--danger)" : "var(--honey)";
  const capLabel = a._cap ? `$${a._cap}/day` : "uncapped";
  return (
    <div
      onClick={onEdit}
      title={onEdit ? `Edit ${a.name}` : undefined}
      className={onEdit ? "zhc-btn-ghost" : undefined}
      style={{
        position: "relative", display: "flex", gap: 11, alignItems: "flex-start",
        padding: head ? 12 : 11, borderRadius: 12, cursor: onEdit ? "pointer" : "default",
        border: head ? "1px solid var(--honey-line)" : "1px solid var(--line)",
        background: head ? "var(--honey-soft)" : "var(--panel-2)",
      }}
    >
      <RoleGlyph role={a.role} size={head ? 34 : 28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: head ? 14 : 13, fontWeight: 700 }}>{a.name}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: head ? "var(--honey)" : "var(--live)", textTransform: "uppercase", letterSpacing: 0.06 }}>{head ? "Queen · CEO" : a.role}</span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--f-mono)", fontSize: 9.5, color: sc, textTransform: "uppercase" }}>
            <span className={"dot" + (a.state === "working" ? " live" : "")} style={{ color: sc }} />{a.state}
          </span>
          {onEdit ? (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              aria-label={`Edit ${a.name}`}
              title={`Edit ${a.name}`}
              style={{ width: 26, height: 26, flexShrink: 0, display: "inline-grid", placeItems: "center", cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: 7, background: "transparent", color: "var(--fg-4)" }}
            >
              <Settings2 size={13} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--fg-3)", marginTop: 4, textWrap: "pretty" }}>{a.task}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 6, background: "color-mix(in srgb, var(--fg) 4%, transparent)", padding: "2px 6px" }}>{a.runtime}</span>
          <span style={{ flex: "1 1 120px", minWidth: 80, height: 8, borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--panel-hi)", overflow: "hidden" }} aria-label={`${a.budgetPct}% of daily cap used`}>
            <span style={{ display: "block", width: a.budgetPct + "%", height: "100%", minWidth: a.budgetPct > 0 ? 3 : 0, background: barColor }} />
          </span>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap", fontFamily: "var(--f-mono)", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: overBudget ? "var(--danger)" : "var(--honey)" }}>{a.budgetPct}%</span>
            <span style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{capLabel}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Hero: apex ring + money side by side ────────────────────────────────────
function Hero({ colony: c }: { colony: Colony }) {
  const fresh = c.status === "setup";
  const ac = alignColor(c.alignment, fresh);
  const drifting = !fresh && c.alignment < 55;
  const r = c.revenue;
  const revColor = r && !r.up ? "var(--danger)" : "var(--live)";
  const burnPct = c.burn.cap > 0 ? Math.min(100, Math.round((c.burn.today / c.burn.cap) * 100)) : 0;
  const burnColor = burnPct >= 85 ? "var(--danger)" : burnPct >= 65 ? "var(--honey)" : "var(--fg-2)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, alignItems: "stretch" }}>
      {/* apex */}
      <Panel style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <Ring pct={fresh ? 0 : c.alignment} size={96} stroke={7} color={ac}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 28, fontWeight: 600, lineHeight: 1, color: "var(--fg)" }}>{fresh ? "—" : c.alignment}</div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 8, color: "var(--fg-4)", letterSpacing: 0.1, marginTop: 3 }}>ALIGNED</div>
          </div>
        </Ring>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mcap" style={{ color: "var(--fg-4)", marginBottom: 6 }}>apex goal · board mandate</div>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.15, textWrap: "balance" }}>{c.apex.title}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 11, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>{c.apex.metric}</span>
            <span style={{ fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{c.apex.current}</span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>→ target {c.apex.target}</span>
          </div>
          {fresh ? (
            <div style={{ marginTop: 9, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", lineHeight: 1.4 }}>Bootstrapping — the Queen is drafting the first work block. Alignment tracks once work begins.</div>
          ) : drifting ? (
            <div style={{ marginTop: 9, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--danger)", lineHeight: 1.4 }}>⚠ drift — {100 - c.alignment}% of active work is unlinked to this goal.</div>
          ) : null}
        </div>
      </Panel>
      {/* money */}
      <Panel style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="mcap" style={{ color: "var(--fg-4)" }}>{r ? r.label : "internal · cost center"}</span>
            <span style={{ flex: 1 }} />
            {r?.delta && <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600, color: revColor }}>{r.up ? "▲" : "▼"} {r.delta}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "var(--f-display)", fontSize: 30, fontWeight: 600, letterSpacing: -1, color: r ? revColor : "var(--fg-2)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{r ? r.value : "—"}</span>
            {r?.target && (
              <span style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 500, color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: "var(--fg-4)", fontWeight: 400 }}>/ </span>{r.target}
              </span>
            )}
            {r?.kind === "users" && r.mau && (
              <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: "var(--fg-2)", fontWeight: 600 }}>{r.mau}</span> MAU
              </span>
            )}
          </div>
        </div>
        <div style={{ height: 1, background: "var(--line)" }} />
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              <span className="mcap" style={{ color: "var(--fg-4)" }}>spend today</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 600, color: burnColor, fontVariantNumeric: "tabular-nums" }}>${c.burn.today}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}><span style={{ color: "var(--fg-4)", fontWeight: 400 }}>/ </span>{c.burn.cap > 0 ? `$${c.burn.cap}` : "∞"}</span>
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>runway ~{c.burn.runway}d</span>
          </div>
          <div style={{ height: 4, borderRadius: 999, background: "var(--line-2)", overflow: "hidden" }}>
            <div style={{ width: burnPct + "%", height: "100%", background: burnColor, transition: "width 500ms ease" }} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

// ── Approvals ──────────────────────────────────────────────────────────────
function ApprovalCard({ ap, onApprove, onReject, busy }: { ap: Approval; onApprove: () => void; onReject: () => void; busy: boolean }) {
  const riskColor: Record<string, string> = { high: "var(--danger)", med: "var(--honey)", low: "var(--live)" };
  const rc = riskColor[ap.risk] ?? "var(--live)";
  return (
    <div style={{ borderRadius: 12, border: `1px solid color-mix(in srgb, ${rc} 32%, var(--line))`, background: "var(--panel-2)", padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, color: rc, textTransform: "uppercase", letterSpacing: 0.06, border: `1px solid color-mix(in srgb, ${rc} 40%, transparent)`, borderRadius: 4, padding: "1px 5px" }}>{ap.kind}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>req. {ap.agent}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500, lineHeight: 1.4, textWrap: "pretty", flex: 1 }}>{ap.title}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 5 }}>
        <button disabled={busy} onClick={onApprove} style={actBtn("primary", busy)}>{busy ? <Spinner size={11} /> : "approve"}</button>
        <button disabled={busy} onClick={onReject} style={actBtn("ghost", busy)}>reject</button>
      </div>
    </div>
  );
}

/** A crew-raised price-change request: approve applies it to the shared-brain catalog. */
function PricingProposalCard({ proposal, onApprove, onReject, busy }: { proposal: CompanyPricingProposal; onApprove: () => void; onReject: () => void; busy: boolean }) {
  const up = proposal.proposedAmountUsd > proposal.currentAmountUsd;
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--honey-line)", background: "var(--panel-2)", padding: "14px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, color: "var(--honey)", textTransform: "uppercase", letterSpacing: 0.06, border: "1px solid var(--honey-line)", borderRadius: 4, padding: "1px 5px" }}>pricing change</span>
        <span style={{ flex: 1 }} />
        {proposal.proposedBy && <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>req. {proposal.proposedBy}</span>}
      </div>
      <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500, lineHeight: 1.4, textWrap: "pretty" }}>
        {proposal.productName}:{" "}
        <span style={{ fontFamily: "var(--f-mono)", textDecoration: "line-through", color: "var(--fg-4)" }}>${proposal.currentAmountUsd.toLocaleString("en-US")}</span>{" "}
        {up ? "▲" : "▼"} <span style={{ fontFamily: "var(--f-mono)", color: up ? "var(--honey)" : "var(--live)" }}>${proposal.proposedAmountUsd.toLocaleString("en-US")}</span>
      </div>
      {proposal.why && (
        <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45, textWrap: "pretty", flex: 1 }}>{proposal.why}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button disabled={busy} onClick={onApprove} style={actBtn("primary", busy)} title="Apply the new price to the shared-brain catalog">{busy ? <Spinner size={11} /> : "approve new price"}</button>
        <button disabled={busy} onClick={onReject} style={actBtn("ghost", busy)} title="Keep the current price; the crew learns the decision">reject</button>
      </div>
    </div>
  );
}

// ── Governance + activity ────────────────────────────────────────────────
function GovernanceFeed({ colony }: { colony: Colony }) {
  const icon: Record<string, string> = { patch: "⊘", reflect: "✸", escalate: "↑", alert: "⚠" };
  const color: Record<string, string> = { patch: "var(--live)", reflect: "var(--honey)", escalate: "var(--honey)", alert: "var(--danger)" };
  const lbl: Record<string, string> = { patch: "archetype patch", reflect: "self-improvement", escalate: "escalation", alert: "audit alert" };
  return (
    <Panel>
      <SectionLabel>recursive governance</SectionLabel>
      {colony.governance.length === 0 ? (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)", padding: "8px 0" }}>No governance events yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {colony.governance.map((g, i) => (
            <div key={`${g.kind}-${g.agent}-${g.since}-${i}`} style={{ display: "flex", gap: 10 }}>
              <span style={{ width: 22, height: 22, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 6, background: `color-mix(in srgb, ${color[g.kind]} 14%, transparent)`, color: color[g.kind], fontSize: 12 }}>{icon[g.kind]}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mcap" style={{ color: color[g.kind] }}>{lbl[g.kind]}</span>
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
  React.useEffect(() => {
    if (lines.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, [lines]);
  return (
    <Panel pad={0} style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot live" style={{ color: "var(--live)" }} />
        <span className="mcap" style={{ color: "var(--fg-3)" }}>live activity</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>recent events</span>
      </div>
      <div style={{ padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 7 }}>
        {lines.length === 0 ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>No recent activity recorded.</div>
        ) : lines.map((l, i) => (
          <div key={`${i}-${l}`} style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.5, whiteSpace: "pre-wrap", color: i === (tick % lines.length) ? "var(--live)" : "var(--fg-3)", opacity: i === (tick % lines.length) ? 1 : 0.7, transition: "color 300ms, opacity 300ms" }}>{l}</div>
        ))}
      </div>
    </Panel>
  );
}

/**
 * The honey "needs you" strip above the tabs. One row per thing that actually
 * wants a human: spend/contract approvals and work the crew blocked on. Each row
 * jumps to its tab. Renders nothing when there's nothing to act on.
 */
function NeedsStrip({ colony: c, onGoToApprovals, onGoToIssues }: {
  colony: Colony; onGoToApprovals: () => void; onGoToIssues: () => void;
}) {
  const approvals = c.approvals;
  const blocked = React.useMemo(() => c.issues.filter(isCompanyReviewIssue), [c.issues]);
  const needs = approvals.length + blocked.length;
  if (needs === 0) return null;
  const rowTone: Record<string, { bg: string; bd: string; color: string }> = {
    high: { bg: "var(--row-blocked-bg)", bd: "var(--row-blocked-bd)", color: "var(--danger)" },
    med: { bg: "var(--row-access-bg)", bd: "var(--row-access-bd)", color: "var(--honey)" },
    low: { bg: "var(--row-live-bg)", bd: "var(--row-live-bd)", color: "var(--live)" },
  };
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--need-bd)", background: "var(--need-bg)", padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        <span aria-hidden style={{ fontSize: 14, color: "var(--honey)" }}>⚑</span>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--honey)" }}>{needs === 1 ? "1 thing needs you" : `${needs} things need you`}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>the crew handles the rest on its own</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {approvals.map((a) => {
          const t = rowTone[a.risk] ?? rowTone.low;
          return (
            <button key={a.id} type="button" onClick={onGoToApprovals} className="zhc-btn-ghost" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", borderRadius: 12, padding: "12px 14px", font: "inherit", color: "inherit", border: `1px solid ${t.bd}`, background: t.bg }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, color: t.color, textTransform: "uppercase", letterSpacing: 0.06, border: `1px solid ${t.bd}`, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>{a.kind}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{a.title}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>requested by {a.agent} · awaiting your decision</span>
              </span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--honey)", flexShrink: 0 }}>Review →</span>
            </button>
          );
        })}
        {blocked.map((b) => (
          <button key={b.work?.taskId ?? b.key} type="button" onClick={onGoToIssues} className="zhc-btn-ghost" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", borderRadius: 12, padding: "12px 14px", font: "inherit", color: "inherit", border: "1px solid var(--row-blocked-bd)", background: "var(--row-blocked-bg)" }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", letterSpacing: 0.06, border: "1px solid var(--danger-soft)", borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>blocked</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{b.title}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>{b.agent ?? "the crew"} is blocked · needs your input to resume</span>
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--honey)", flexShrink: 0 }}>View →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function IssuesLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading company issues" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-2)", padding: "12px 13px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Skeleton width={62} height={16} radius={999} />
            <Skeleton width={48} height={10} />
            <span style={{ flex: 1 }} />
            <Skeleton width={72} height={10} />
          </div>
          <Skeleton width={index === 1 ? "74%" : "88%"} height={13} />
          <Skeleton width={index === 2 ? "42%" : "58%"} height={11} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Skeleton width={88} height={24} radius={8} />
            <Skeleton width={104} height={24} radius={8} />
          </div>
        </div>
      ))}
    </div>
  );
}

function IssuesPanel({ colony: c, onOpenIssue, onResolveIssue, onRetryIssues, onReviewPreview, onDismissIssues, busyId, loading = false }: {
  colony: Colony; onOpenIssue: (issue: Issue) => void; onResolveIssue: (issue: Issue) => void; onRetryIssues?: (issues: Issue[]) => void; onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void; onDismissIssues: (issues: Issue[]) => void; busyId: string | null; loading?: boolean;
}) {
  const reviewIssues = c.issues.filter(isCompanyReviewIssue);
  const activeIssues = c.issues.filter((issue) => issue.status !== "done");
  return (
    <Panel>
      <SectionLabel right={loading ? (
        <span role="status" aria-label="Loading issue counts" style={{ display: "inline-flex", alignItems: "center" }}>
          <Skeleton width={108} height={10} />
        </span>
      ) : (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{reviewIssues.length} need{reviewIssues.length === 1 ? "s" : ""} you · {activeIssues.length} active</span>
      )}>
        issues · needs you
      </SectionLabel>
      <SetupBlockerBand companyId={c.id} />
      <EmailQaBand key={c.id} companyId={c.id} />
      {loading ? (
        <IssuesLoadingSkeleton />
      ) : reviewIssues.length === 0 ? (
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

/**
 * Company profile signal for the output spec. Identity (sector/name/blurb/apex)
 * decides the PRODUCT kind; activity + issue titles feed ONLY outreach detection.
 */
function companyProfileSignal(c: Colony): CompanyProfile {
  const activityText = [...(c.activity ?? []), ...c.issues.map((i) => i.title)].filter(Boolean).join(" ");
  return { sector: c.sector, name: c.name, blurb: c.blurb, apexTitle: c.apex.title, apexMetric: c.apex.metric, activityText };
}

/** Shape-matched shimmer cards for the deliverables grid while tasks load. */
function DeliverablesLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading deliverables" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
      {[0, 1].map((i) => (
        <div key={i} style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-2)", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Skeleton width={20} height={20} radius={6} />
            <Skeleton width={i === 0 ? "52%" : "40%"} height={13} />
          </div>
          <Skeleton width="100%" height={116} radius={10} />
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <Skeleton width="78%" height={10} />
            <Skeleton width="44%" height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DeliverablesPanel({ colony: c, spec, theme = "dark", loading = false }: { colony: Colony; spec: OutputSpec; theme?: "dark" | "light"; loading?: boolean }) {
  const [showLog, setShowLog] = React.useState(false);
  const all = React.useMemo(() => collectCompanyDeliverables(c), [c]);
  const { primary, worklog } = React.useMemo(() => partitionByOutput(all, spec), [all, spec]);
  const rejectedRefs = React.useMemo(
    () => new Set((c.directives ?? []).filter((d) => d.source === "reject" && d.deliverableRef).map((d) => d.deliverableRef as string)),
    [c.directives],
  );

  return (
    <Panel>
      <SectionLabel right={loading ? (
        <span role="status" aria-label="Loading deliverable count" style={{ display: "inline-flex", alignItems: "center" }}>
          <Skeleton width={52} height={10} />
        </span>
      ) : (
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{primary.length} item{primary.length === 1 ? "" : "s"}</span>
      )}>
        {spec.primaryLabel}
      </SectionLabel>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: -4, marginBottom: 14 }}>{spec.primaryBlurb}</div>

      {loading ? (
        <DeliverablesLoadingSkeleton />
      ) : primary.length === 0 ? (
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

function CapabilityStat({ value, label, danger }: { value: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: danger ? "var(--danger)" : "var(--fg)" }}>{value}</div>
      <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function CapabilityCapitalPanel({ colony: c, openSkillAttachmentBrowser }: { colony: Colony; openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener }) {
  const cc = c.capabilityCapital;
  const gatePct = cc.evalGates > 0 ? Math.round((cc.passedEvalGates / cc.evalGates) * 100) : 0;
  return (
    <Panel>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>company veteran layer</span>}>learning · capability capital</SectionLabel>
      <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 44, fontWeight: 600, letterSpacing: -1.2, color: "var(--honey)" }}>{cc.score}</span>
          <span className="mcap" style={{ color: "var(--fg-4)" }}>capability score</span>
        </div>
        <div style={{ flex: 1, minWidth: 200, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 14 }}>
          <CapabilityStat value={cc.learningAssets} label="artifacts" />
          <CapabilityStat value={cc.evalGates ? `${gatePct}%` : "—"} label="eval pass" />
          <CapabilityStat value={cc.experiments} label="experiments" />
          <CapabilityStat value={cc.antiPatterns} label="anti-patterns" danger />
          <CapabilityStat value={`${cc.modelIndependence}%`} label="model-indep" />
        </div>
      </div>
      {cc.notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 4 }}>
          {cc.notes.map((note) => (
            <div key={note} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ width: 20, height: 20, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 6, background: "var(--honey-soft)", color: "var(--honey)", fontSize: 11 }}>✦</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-2)" }}>{note}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
        <CompanyKnowledgePanel colony={c} openSkillAttachmentBrowser={openSkillAttachmentBrowser} embedded />
      </div>
    </Panel>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-2)", padding: "16px" }}>
      <div className="mcap" style={{ color: "var(--fg-4)" }}>{label}</div>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginTop: 8, letterSpacing: -0.6 }}>{value}</div>
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
    handlers.onRecordRevenue({ amountUsd, source, collectFee, collectingAgentId: collectFee ? effectiveAgentId : undefined });
    setAmount("");
  };
  const field: React.CSSProperties = { minWidth: 0, height: 34, borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg)", padding: "0 10px", fontFamily: "var(--f-mono)", fontSize: 12, outline: "none" };

  return (
    <Panel>
      <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey)" }}>policy share</span>}>record external revenue</SectionLabel>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
        <MiniMetric label="recorded revenue" value={money(rollup?.totalRevenueUsd)} />
        <MiniMetric label="share collected" value={money(rollup?.shareCollectedUsd)} />
        <MiniMetric label="share pending" value={money(rollup?.sharePendingUsd)} />
        <MiniMetric label="events" value={String(rollup?.eventCount ?? 0)} />
      </div>
      <form onSubmit={submit} style={{ marginTop: 16, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", alignItems: "center" }}>
        <input aria-label="Revenue amount USD" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$ amount received" style={field} />
        <select aria-label="Revenue source" value={source} onChange={(e) => setSource(e.target.value as CompanyRevenueShareInput["source"])} style={{ ...field, cursor: "pointer" }}>
          <option value="manual">Manual</option>
          <option value="stripe">Stripe</option>
          <option value="invoice">Invoice</option>
          <option value="x402">x402</option>
          <option value="marketplace">Marketplace</option>
          <option value="other">Other</option>
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={collectFee} onChange={(e) => setCollectFee(e.target.checked)} style={{ accentColor: "var(--honey)" }} />
            collect
          </label>
          <select aria-label="Collecting agent wallet" disabled={!collectFee || c.agents.length === 0} value={effectiveAgentId} onChange={(e) => setCollectingAgentId(e.target.value)} style={{ ...field, flex: 1, cursor: "pointer", opacity: collectFee ? 1 : 0.5 }}>
            {c.agents.length === 0 ? <option value="">No agent wallet</option> : null}
            {c.agents.map((agent) => (
              <option key={agent.id ?? agent.name} value={agent.id ?? ""}>{agent.name}</option>
            ))}
          </select>
        </div>
        <button disabled={!canSubmit || busy} style={{ height: 34, minWidth: 150, padding: "0 13px", borderRadius: 8, cursor: !canSubmit || busy ? "not-allowed" : "pointer", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.06, border: "1px solid var(--btn-line)", background: !canSubmit || busy ? "var(--panel-hi)" : "var(--btn-bg)", color: !canSubmit || busy ? "var(--fg-4)" : "var(--btn-fg)", opacity: busy ? 0.6 : 1 }}>
          {busy ? <Spinner size={12} /> : collectFee ? "Record + collect" : "Record"}
        </button>
      </form>
    </Panel>
  );
}

/** The left "treasury" column of the Ops tab: burn, per-agent caps, revenue, kill switch. */
function TreasuryColumn({ colony: c, handlers }: { colony: Colony; handlers: CockpitHandlers }) {
  const busy = handlers.busyId === c.id;
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel>
        <SectionLabel right={
          <button onClick={handlers.onEditTreasury} title="Configure treasury" className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "1px solid var(--honey-line)", borderRadius: 8, background: "var(--honey-soft)", color: "var(--honey)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, padding: "5px 11px", textTransform: "uppercase", letterSpacing: 0.06 }}>
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
                  <span style={{ flex: "0 1 130px", minWidth: 80, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{a.name}</span>
                  <span style={{ flex: "1 1 120px", minWidth: 120, height: 8, borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--panel-hi)", overflow: "hidden" }} aria-label={`${a.name} used ${a.budgetPct}% of daily cap`}>
                    <span style={{ display: "block", width: a.budgetPct + "%", minWidth: a.budgetPct > 0 ? 3 : 0, height: "100%", background: over ? "var(--danger)" : "var(--honey)" }} />
                  </span>
                  <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "baseline", gap: 5, fontFamily: "var(--f-mono)", fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: over ? "var(--danger)" : "var(--honey)" }}>{a.budgetPct}%</span>
                    <span style={{ fontSize: 9.5, color: "var(--fg-4)" }}>{cap}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <RevenueSharePanel colony={c} handlers={handlers} />

      {/* kill switch + disband */}
      <Panel style={c.frozen ? { borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", background: "color-mix(in srgb, var(--danger) 7%, var(--panel))" } : undefined}>
        <SectionLabel color={c.frozen ? "var(--danger)" : "var(--fg-3)"}>kill switch · human override</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6 }}>
            {c.frozen
              ? "❄️ Frozen — every member agent's spend is blocked across all rails until you unfreeze."
              : "Freezing halts all spend for every agent in this company immediately. Use it to stop a runaway colony."}
          </div>
          <button disabled={busy} onClick={() => handlers.onFreeze(!c.frozen)} style={{ padding: "8px 16px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, letterSpacing: 0.06, textTransform: "uppercase", border: `1px solid color-mix(in srgb, ${c.frozen ? "var(--live)" : "var(--danger)"} 50%, transparent)`, background: `color-mix(in srgb, ${c.frozen ? "var(--live)" : "var(--danger)"} 14%, transparent)`, color: c.frozen ? "var(--live)" : "var(--danger)", opacity: busy ? 0.5 : 1 }}>
            {busy ? <Spinner size={12} /> : c.frozen ? "Unfreeze company" : "Freeze company"}
          </button>
          {confirmDelete ? (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <button disabled={busy} onClick={handlers.onDelete} style={{ padding: "8px 14px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", border: "1px solid color-mix(in srgb, var(--danger) 55%, transparent)", background: "color-mix(in srgb, var(--danger) 20%, transparent)", color: "var(--danger)", opacity: busy ? 0.5 : 1 }}>{busy ? <><Spinner size={12} /> Disbanding</> : "confirm disband"}</button>
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

function KStat({ n, label, tone, last }: { n: number; label: string; tone?: "honey" | "live" | null; last?: boolean }) {
  const c = tone === "honey" ? "var(--honey)" : tone === "live" ? "var(--live)" : "var(--fg)";
  return (
    <div style={{ textAlign: "left", minWidth: 64, padding: "0 16px", borderRight: last ? "none" : "1px solid var(--line)" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 600, color: c, lineHeight: 1, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

/** Small pill button for the breadcrumb row (back / theme / refresh). */
function CrumbPill({ onClick, disabled, children, title }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", border: "1px solid var(--line-2)", borderRadius: 999, cursor: disabled ? "default" : "pointer", color: "var(--fg-2)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "7px 13px", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

// ── The cockpit ────────────────────────────────────────────────────────────
export function Cockpit({
  colony: c, colonies, showBudget, onBack, onSwitch, onAddAgents, openSkillAttachmentBrowser, handlers,
  theme = "dark", onToggleTheme, onRefresh, refreshing = false, initialTasksLoading = false,
}: {
  colony: Colony; colonies: Colony[]; showBudget: boolean;
  onBack: () => void; onSwitch: (id: string) => void; onAddAgents: () => void;
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
  handlers: CockpitHandlers; theme?: "dark" | "light";
  onToggleTheme?: () => void; onRefresh?: () => void; refreshing?: boolean;
  /** True until the first Work Board tasks fetch lands — shows board lane skeletons. */
  initialTasksLoading?: boolean;
}) {
  const wb = c.workBlock;
  const wbPct = wb.total > 0 ? Math.round((wb.done / wb.total) * 100) : 0;
  const [tab, setTab] = React.useState("board");

  // The output spec decides what THIS company's deliverables are (its sites /
  // books / clips) vs. work log, and its outreach / product labels.
  const spec = React.useMemo(() => outputSpecForCompany(companyProfileSignal(c)), [c]);

  const rejectedDeliverableTitles = React.useMemo(
    () => new Set((c.directives ?? []).filter((d) => d.source === "reject" && d.deliverableRef).map((d) => d.deliverableRef as string)),
    [c.directives],
  );
  const deliverableCount = React.useMemo(
    () => collectCompanyDeliverables(c).filter((x) => spec.classOf(x.classified) === "primary" && !rejectedDeliverableTitles.has(x.classified.title)).length,
    [c, spec, rejectedDeliverableTitles],
  );
  const needsYouIssueCount = c.issues.filter(isCompanyReviewIssue).length;
  const activeIssueCount = c.issues.filter((issue) => issue.status !== "done").length;
  const pricingProposals = c.pricingProposals ?? [];
  const approveCount = c.approvals.length + pricingProposals.length;

  const tabs: { key: string; label: string; badge?: number | null; badgeLoading?: boolean; tone?: "danger" }[] = [
    { key: "board", label: "Board" },
    { key: "issues", label: "Issues", badge: activeIssueCount || null, badgeLoading: initialTasksLoading && activeIssueCount === 0, tone: needsYouIssueCount ? "danger" : undefined },
    { key: "deliverables", label: spec.primaryLabel, badge: deliverableCount || null },
    { key: "comms", label: spec.commsLabel || "Comms" },
    // Only companies that sell fixed products carry a catalog.
    ...(c.products ? [{ key: "products", label: "Products", badge: c.products.items.length || null }] : []),
    { key: "team", label: "Team" },
    { key: "analytics", label: "Analytics" },
    { key: "learning", label: "Learning", badge: c.capabilityCapital.distillationQueue || null },
    { key: "approvals", label: "Approvals", badge: approveCount || null },
    { key: "runs", label: "Runs" },
    { key: "ops", label: "Ops" },
  ];
  const active = tabs.some((x) => x.key === tab) ? tab : "board";

  return (
    <div style={{ padding: "22px 40px 60px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* breadcrumb + switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <CrumbPill onClick={onBack} title="Back to all companies">← all companies</CrumbPill>
        <span style={{ flex: 1 }} />
        {onToggleTheme && (
          <CrumbPill onClick={onToggleTheme} title="Toggle light / dark">
            <span style={{ fontSize: 13, lineHeight: 1 }}>{theme === "dark" ? "☼" : "☾"}</span>{theme === "dark" ? "Light" : "Dark"}
          </CrumbPill>
        )}
        {onRefresh && (
          <CrumbPill onClick={onRefresh} disabled={refreshing} title="Refresh company registry">
            {refreshing ? <><Spinner size={11} /> syncing</> : "↻ refresh"}
          </CrumbPill>
        )}
        <div style={{ display: "flex", gap: 6, overflowX: "auto", maxWidth: 420 }} className="frsc">
          {colonies.map((x) => (
            <button key={x.id} onClick={() => onSwitch(x.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", background: x.id === c.id ? "var(--panel-2)" : "transparent", border: `1px solid ${x.id === c.id ? "var(--line-2)" : "var(--line)"}`, borderRadius: 8, cursor: "pointer", padding: "6px 11px", fontFamily: "var(--f-mono)", fontSize: 10.5, color: x.id === c.id ? "var(--fg)" : "var(--fg-3)" }}>
              <span className={"dot" + (x.status === "shipping" || x.status === "review" ? " live" : "")} style={{ color: STATUS_TONE[x.status].dot }} />{x.ticker}
            </button>
          ))}
        </div>
      </div>

      {/* identity header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
        <RoleGlyph role="Queen" size={54} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: 34, fontWeight: 600, letterSpacing: -1, lineHeight: 1 }}>{c.name}</h1>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)", padding: "2px 7px", border: "1px solid var(--line)", borderRadius: 5 }}>{c.ticker}</span>
            <StatusPill status={c.status} />
            <button onClick={handlers.onEdit} title="Edit company details" className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid var(--line-2)", borderRadius: 8, cursor: "pointer", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 10.5, padding: "4px 10px", textTransform: "uppercase", letterSpacing: 0.06 }}>
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
          <KStat n={agentsAtWork(c)} label="at work" tone="live" />
          <KStat n={approveCount} label="to approve" tone={approveCount ? "honey" : null} last />
        </div>
      </div>

      <Hero colony={c} />

      <NeedsStrip colony={c} onGoToApprovals={() => setTab("approvals")} onGoToIssues={() => setTab("issues")} />

      {/* segmented section control */}
      <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", alignSelf: "flex-start", flexWrap: "wrap" }} className="frsc">
        {tabs.map((x) => {
          const on = x.key === active;
          return (
            <button key={x.key} onClick={() => setTab(x.key)} className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", border: "1px solid " + (on ? "var(--line-2)" : "transparent"), background: on ? "var(--panel-2)" : "transparent", color: on ? "var(--fg)" : "var(--fg-3)", borderRadius: 8, padding: "7px 14px", fontFamily: "var(--f-display)", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.06, textTransform: "uppercase" }}>
              {x.label}
              {x.badge ? (
                <span style={{ display: "inline-grid", placeItems: "center", minWidth: 17, height: 17, padding: "0 5px", borderRadius: 999, background: x.tone === "danger" ? "var(--danger)" : "var(--honey)", color: "var(--bg)", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700 }}>{x.badge}</span>
              ) : x.badgeLoading ? (
                <span role="status" aria-label={`Loading ${x.label} count`} style={{ display: "inline-grid", placeItems: "center", minWidth: 17, height: 17 }}>
                  <Skeleton width={17} height={17} radius={999} />
                </span>
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
                  <span className="mcap" style={{ color: running ? "var(--live)" : "var(--honey)", display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {running ? <span className="dot live" style={{ color: "var(--live)" }} /> : null}
                    {running ? "autonomous · running" : "autonomous execution"}
                  </span>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 5, lineHeight: 1.5 }}>
                    {c.frozen
                      ? "Company is frozen — unfreeze it in Ops to run autonomously."
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
                  <button disabled={busy} onClick={handlers.onStopAutonomy} style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", padding: "9px 16px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, letterSpacing: 0.04, border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg-2)", opacity: busy ? 0.6 : 1 }}>
                    {busy ? <><Spinner size={13} /> Stopping</> : <><span style={{ width: 9, height: 9, background: "var(--honey)", borderRadius: 2, display: "inline-block" }} /> Stop autonomy</>}
                  </button>
                ) : (
                  <button disabled={launchDisabled} onClick={handlers.onDispatch} style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", padding: "9px 16px", borderRadius: 9, cursor: launchDisabled ? "not-allowed" : "pointer", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, letterSpacing: 0.04, border: "1px solid var(--honey-line)", background: launchDisabled ? "var(--panel-2)" : "var(--btn-bg)", color: launchDisabled ? "var(--fg-4)" : "var(--btn-fg)", opacity: launchDisabled ? 0.6 : 1 }}>
                    {busy ? <><Spinner size={13} /> Launching</> : launchedAgo ? "▶ Re-launch autonomy" : "▶ Launch autonomous work"}
                  </button>
                )}
              </div>
            );
          })()}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span className="mcap" style={{ color: "var(--fg-4)", whiteSpace: "nowrap" }}>active work block · {wb.state}</span>
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
          <div style={{ height: 5, borderRadius: 999, background: "var(--line-2)", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ width: wbPct + "%", height: "100%", background: "var(--live)", transition: "width 600ms ease" }} />
          </div>
          <div style={{ overflowX: "auto", paddingBottom: 4 }} className="frsc">
            <IssueBoard colony={c} companyName={c.name} boardLoading={initialTasksLoading} onOpenIssue={handlers.onOpenIssue} onResolveIssue={handlers.onResolveIssue} onRetryIssues={handlers.onRetryIssues} onReviewPreview={handlers.onReviewPreview} onDismissIssues={handlers.onDismissIssues} busyId={handlers.busyId} />
          </div>
        </Panel>
      )}

      {active === "issues" && <IssuesPanel colony={c} onOpenIssue={handlers.onOpenIssue} onResolveIssue={handlers.onResolveIssue} onRetryIssues={handlers.onRetryIssues} onReviewPreview={handlers.onReviewPreview} onDismissIssues={handlers.onDismissIssues} busyId={handlers.busyId} loading={initialTasksLoading} />}

      {active === "deliverables" && <DeliverablesPanel colony={c} spec={spec} theme={theme} loading={initialTasksLoading} />}

      {active === "comms" && <CommsPanel colony={c} spec={spec} theme={theme} />}

      {active === "products" && (
        <ProductsPanel colony={c} pendingProposals={pricingProposals} onGoToApprovals={() => setTab("approvals")} />
      )}

      {active === "analytics" && <AnalyticsPanel colony={c} />}

      {active === "learning" && <CapabilityCapitalPanel colony={c} openSkillAttachmentBrowser={openSkillAttachmentBrowser} />}

      {active === "runs" && <CompanyRunsPanel companyId={c.id} />}

      {active === "team" && (
        <Panel>
          <SectionLabel right={
            <button onClick={onAddAgents} className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "1px solid var(--honey-line)", borderRadius: 8, background: "var(--honey-soft)", color: "var(--honey)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, padding: "5px 11px", textTransform: "uppercase", letterSpacing: 0.06 }}>+ add agent</button>
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
          <SectionLabel right={approveCount > 0 ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey)" }}>{approveCount} waiting</span> : null}>needs your approval · human-in-the-loop</SectionLabel>
          {pricingProposals.length > 0 && (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", marginBottom: c.approvals.length ? 16 : 0 }}>
              {pricingProposals.map((proposal) => (
                <PricingProposalCard key={proposal.id} proposal={proposal} busy={handlers.busyId === proposal.id} onApprove={() => handlers.onResolvePricing(proposal.id, "approve")} onReject={() => handlers.onResolvePricing(proposal.id, "reject")} />
              ))}
            </div>
          )}
          {approveCount === 0 ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "20px 0" }}>✓ nothing pending — the colony is self-governing within policy.</div>
          ) : c.approvals.length === 0 ? null : (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {c.approvals.map((ap) => (
                <ApprovalCard key={ap.id} ap={ap} busy={handlers.busyId === ap.id} onApprove={() => handlers.onApprove(ap.id)} onReject={() => handlers.onReject(ap.id)} />
              ))}
            </div>
          )}
        </Panel>
      )}

      {active === "ops" && (
        showBudget ? (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", alignItems: "start" }}>
            <TreasuryColumn colony={c} handlers={handlers} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <GovernanceFeed colony={c} />
              <ActivityTicker colony={c} />
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
            <GovernanceFeed colony={c} />
            <ActivityTicker colony={c} />
          </div>
        )
      )}
    </div>
  );
}
