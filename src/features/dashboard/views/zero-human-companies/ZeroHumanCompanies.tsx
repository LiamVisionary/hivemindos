"use client";
// Zero Human Companies — top-level presentational view. Masthead + portfolio /
// cockpit routing. Fully controlled: real colonies, agent roster and mutation
// handlers are supplied by ZeroHumanCompaniesView (which talks to the app APIs).
import React from "react";
import { Upload } from "lucide-react";
import { Portfolio } from "./ColonyCards";
import { Spinner } from "./primitives";
import { Cockpit, type CockpitHandlers } from "./Cockpit";
import type { ApprovalDecision } from "@/features/approvals/spend-approval-model";
import { AgentBrowserModal, AgentMemberSettingsModal, CreateCompanyModal, EditCompanyModal, TreasurySettingsModal } from "./Modals";
import { ImportCompanyModal } from "./ImportCompanyModal";
import { companyMembershipOwners } from "@/lib/services/company-membership";
import { TaskDetailModal } from "./TaskDetailModal";
import { FounderModeModal } from "./FounderModeModal";
import { agentsAtWork } from "./data";
import { getIssueIdentity } from "./issue-identity";
import type { PreviewDecision } from "./preview-review";
import { isWorkApprovalIssue } from "./work-approval-issues";
import type { Agent, CardStyle, Colony, CompanyEditForm, CompanyImportForm, CompanyRevenueShareInput, CreateForm, Density, Issue, PoolAgent, Theme } from "./types";
import type { CompanyApprovalPolicy } from "@/lib/types/company";
import type { SkillBrowserAttachmentTarget } from "@/features/dashboard/dashboard-types";
import type { KanbanLinkedDirectory, KanbanMachineTarget } from "@/lib/types/kanban";

type SkillAttachmentBrowserOpener = (target: SkillBrowserAttachmentTarget) => void | Promise<void>;
type DirectoryPicker = (machine: KanbanMachineTarget | null, onChoose: (directory: KanbanLinkedDirectory) => void) => void | Promise<void>;

function HiveLogo({ size = 40 }: { size?: number }) {
  const W = size, H = size;
  const pts = `${W / 2},1 ${W - 1},${H / 4} ${W - 1},${(3 * H) / 4} ${W / 2},${H - 1} 1,${(3 * H) / 4} 1,${H / 4}`;
  return (
    <span style={{ position: "relative", width: W, height: H, display: "inline-grid", placeItems: "center", flexShrink: 0 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <polygon points={pts} fill="color-mix(in srgb, var(--honey) 16%, var(--bg-3))" stroke="color-mix(in srgb, var(--honey) 65%, transparent)" strokeWidth="1.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span style={{ position: "relative", color: "var(--honey-2)", fontSize: size * 0.5, lineHeight: 1 }}>♛</span>
    </span>
  );
}

function Big({ n, label, sub, tone, last }: { n: React.ReactNode; label: string; sub?: string; tone?: "honey" | null; last?: boolean }) {
  const c = tone === "honey" ? "var(--honey)" : "var(--fg)";
  return (
    <div style={{ textAlign: "left", padding: "0 20px", borderRight: last ? "none" : "1px solid var(--line)" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 30, fontWeight: 600, color: c, lineHeight: 1, letterSpacing: -0.8, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 6 }}>{label}{sub ? <span style={{ color: "var(--fg-4)", opacity: 0.7 }}> · {sub}</span> : null}</div>
    </div>
  );
}

/** Rounded pill button used in the masthead / breadcrumb control row. */
export function PillButton({
  onClick, disabled, children, title,
}: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="zhc-btn-ghost"
      style={{
        display: "inline-flex", alignItems: "center", gap: 8, background: "transparent",
        border: "1px solid var(--line-2)", borderRadius: 999, cursor: disabled ? "default" : "pointer",
        color: "var(--fg-2)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "7px 14px",
        opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/** Theme toggle pill (in-view light/dark for the ZHC panel). */
export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <PillButton onClick={onToggle} title="Toggle light / dark">
      <span style={{ fontSize: 13, lineHeight: 1 }}>{theme === "dark" ? "☼" : "☾"}</span>
      {theme === "dark" ? "Light" : "Dark"}
    </PillButton>
  );
}

function Masthead({
  companies, loading, initialLoading, onRefresh, onImport, onFounder, theme, onToggleTheme,
}: { companies: Colony[]; loading: boolean; initialLoading: boolean; onRefresh: () => void; onImport: () => void; onFounder: () => void; theme: Theme; onToggleTheme: () => void }) {
  const pendingFirstSync = initialLoading && companies.length === 0;
  const s = {
    colonies: companies.length,
    agents: companies.reduce((n, c) => n + c.agents.length, 0),
    working: companies.reduce((n, c) => n + agentsAtWork(c), 0),
    shipped: companies.reduce((n, c) => n + c.issues.filter((i) => i.status === "done").length, 0),
    approvals: companies.reduce((n, c) => n + c.approvals.length + (c.pricingProposals?.length ?? 0) + c.issues.filter(isWorkApprovalIssue).length, 0),
    avgAlign: companies.length ? Math.round(companies.reduce((n, c) => n + c.alignment, 0) / companies.length) : 0,
  };
  const metric = (value: React.ReactNode) => pendingFirstSync ? "—" : value;
  return (
    <header style={{ position: "relative", zIndex: 2, padding: "26px 40px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 24, paddingBottom: 22, borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <HiveLogo size={42} />
          <div>
            <div className="mcap" style={{ color: "var(--honey)", whiteSpace: "nowrap" }}>Hivemind · Autonomous Orgs</div>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, letterSpacing: -0.2, whiteSpace: "nowrap" }}>Zero Human Companies</div>
          </div>
        </div>
        <div style={{ textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", letterSpacing: 0.06 }}>
          {pendingFirstSync ? (
            <span style={{ color: "var(--live)", display: "inline-flex", alignItems: "center", gap: 8 }}><Spinner size={11} /> syncing company registry</span>
          ) : (
            <><span style={{ color: "var(--live)" }}>{s.working} agents at work</span> · {s.colonies} {s.colonies === 1 ? "company" : "companies"} · 0 humans</>
          )}
        </div>
        <div style={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 8 }}>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <PillButton onClick={onFounder} title="Turn one outcome into a governed company blueprint">
            ✦ Founder mode
          </PillButton>
          <PillButton onClick={onImport} title="Import an existing project as a company">
            <Upload size={13} strokeWidth={1.8} /> Import
          </PillButton>
          <PillButton onClick={onRefresh} disabled={loading} title="Refresh company registry">
            {loading ? <><Spinner size={11} /> syncing</> : "↻ refresh"}
          </PillButton>
        </div>
      </div>

      <div style={{ marginTop: 34, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 52, lineHeight: 1.0, letterSpacing: -1.8, maxWidth: 620 }}>
          Companies that run <span style={{ color: "var(--honey)" }}>themselves.</span>
        </h1>
        <div style={{ display: "flex", gap: 0 }}>
          <Big n={metric(s.colonies)} label="colonies" />
          <Big n={metric(s.agents)} label="agents" sub={pendingFirstSync ? undefined : "0 humans"} />
          <Big n={metric(s.shipped)} label="shipped" />
          <Big n={metric(s.avgAlign + "%")} label="aligned" />
          <Big n={metric(s.approvals)} label="to approve" tone={!pendingFirstSync && s.approvals ? "honey" : null} last />
        </div>
      </div>
    </header>
  );
}

export interface ZeroHumanCompaniesProps {
  colonies: Colony[];
  /** Optional subset used only for the portfolio masthead/cards. */
  portfolioColonies?: Colony[];
  agentPool: PoolAgent[];
  /** Optional founding crew already staged when opening the create-company flow. */
  initialCreateCrew?: Agent[];
  loading: boolean;
  initialLoading?: boolean;
  /** True until the first Work Board tasks fetch lands — drives the cockpit board's
   *  lane skeletons so tasks don't flash as "empty" before they arrive. */
  initialTasksLoading?: boolean;
  error?: string | null;
  notice?: string | null;
  /** id currently mutating (approval id or company id), to disable its controls. */
  busyId: string | null;
  onRefresh: () => void;
  /** Found a company. Returns the new company id (to auto-open it) or null. */
  onCreateCompany: (form: CreateForm, crew: Agent[]) => Promise<string | null>;
  /** Import an existing repository as a company. Returns the company id to open it. */
  onImportCompany: (form: CompanyImportForm) => Promise<string | null>;
  /** Edit an existing company's metadata, budgets, revenue, and member fields. */
  onEditCompany: (companyId: string, form: CompanyEditForm) => Promise<void>;
  /** Add staged crew to an existing company. */
  onAddAgents: (companyId: string, crew: Agent[]) => Promise<void>;
  /** Open the established agent-duplication flow for an identity owned by another company. */
  onDuplicateAgent?: (agentId: string) => void;
  /** Open the full AgentSettingsModal for an agent id (the cockpit's "Queen
   *  settings" uses this for the auto-seeded company Queen profile). */
  onOpenAgentSettings?: (agentId: string) => void | Promise<void>;
  onDecideApproval: (companyId: string, approvalId: string, decision: ApprovalDecision, note: string) => void | Promise<void>;
  /** Decide an approval-like Work Board issue from the shared approval surface. */
  onDecideIssueApproval: (companyId: string, issue: Issue, decision: ApprovalDecision, note: string) => void | Promise<void>;
  /** Decide a crew-raised pricing proposal (approve applies the catalog change). */
  onResolvePricing: (companyId: string, proposalId: string, decision: "approve" | "reject") => void;
  /** Save one company approval-policy row. */
  onSetApprovalPolicy: (companyId: string, policy: CompanyApprovalPolicy) => void;
  onFreeze: (companyId: string, frozen: boolean) => void;
  onDelete: (companyId: string) => void;
  /** Launch perpetual autonomy: decompose the apex goal + dispatch to the crew. */
  onDispatch: (companyId: string) => void;
  /** Stop perpetual autonomy (no new dispatches; in-flight work finishes). */
  onStopAutonomy: (companyId: string) => void;
  /** Mark a Needs-You issue fixed and resume its Work Board task. */
  onResolveIssue: (companyId: string, issue: Issue, answer?: string) => void;
  /** Re-queue a group of infra-blocked tasks for autonomous pickup (answer rail). */
  onRetryIssues?: (companyId: string, issues: Issue[]) => void;
  /** Set aside issues: archive their tasks off the board (one, or a whole group). */
  onDismissIssues: (companyId: string, issues: Issue[]) => void;
  /** Approve a customer-facing preview or send the crew change notes to regenerate it. */
  onReviewPreview?: (companyId: string, issue: Issue, decision: PreviewDecision, notes: string) => void;
  /** Record external revenue and optionally collect the HivemindOS share. */
  onRecordRevenue: (companyId: string, input: CompanyRevenueShareInput) => Promise<void>;
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
  chooseDirectoryForMachine?: DirectoryPicker;
  defaultDirectoryMachine?: KanbanMachineTarget | null;
  theme?: Theme;
  cardStyle?: CardStyle;
  density?: Density;
  showBudget?: boolean;
}

export default function ZeroHumanCompanies({
  colonies, portfolioColonies, agentPool, initialCreateCrew, loading, initialLoading = loading, initialTasksLoading = false, error, notice, busyId, onRefresh,
  onCreateCompany, onImportCompany, onEditCompany, onAddAgents, onDuplicateAgent, onOpenAgentSettings, onDecideApproval, onDecideIssueApproval, onResolvePricing, onSetApprovalPolicy, onFreeze, onDelete, onDispatch, onStopAutonomy, onResolveIssue, onRetryIssues, onDismissIssues, onReviewPreview, onRecordRevenue,
  openSkillAttachmentBrowser,
  chooseDirectoryForMachine,
  defaultDirectoryMachine,
  theme = "dark", cardStyle = "detailed", density = "comfortable", showBudget = true,
}: ZeroHumanCompaniesProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<
    | { type: "create" }
    | { type: "founder" }
    | { type: "import" }
    | { type: "edit"; id: string }
    | { type: "treasury"; id: string }
    | { type: "browse"; id: string }
    | { type: "edit-agent"; id: string; agentId: string }
    | { type: "task"; id: string; issueId: string }
    | null
  >(null);
  const [submitting, setSubmitting] = React.useState(false);
  const closeModal = React.useCallback(() => setModal(null), []);

  // In-view light/dark for this panel. Defaults to the global dashboard theme
  // (which flows in via `theme`); the toggle pill sets a local override. When the
  // global theme changes we drop the override during render (the React-recommended
  // "adjust state when a prop changes" pattern) so the panel never drifts from the
  // app's chosen theme.
  const [themeOverride, setThemeOverride] = React.useState<Theme | null>(null);
  const [lastGlobalTheme, setLastGlobalTheme] = React.useState<Theme>(theme);
  if (theme !== lastGlobalTheme) {
    setLastGlobalTheme(theme);
    setThemeOverride(null);
  }
  const themeState: Theme = themeOverride ?? theme;
  const toggleTheme = React.useCallback(() => {
    setThemeOverride((prev) => ((prev ?? theme) === "dark" ? "light" : "dark"));
  }, [theme]);

  const visiblePortfolioColonies = portfolioColonies ?? colonies;
  const membershipOwners = React.useMemo(() => companyMembershipOwners(
    colonies.map((entry) => ({
      id: entry.id,
      name: entry.name,
      agentIds: entry.agents.map((agent) => agent.id).filter((agentId): agentId is string => Boolean(agentId)),
    })),
  ), [colonies]);
  const unassignedAgentPool = React.useMemo(
    () => agentPool.filter((agent) => !(membershipOwners.get(agent.id)?.length)),
    [agentPool, membershipOwners],
  );
  const duplicateFromPicker = React.useCallback((agentId: string) => {
    setModal(null);
    onDuplicateAgent?.(agentId);
  }, [onDuplicateAgent]);
  const colony = openId ? colonies.find((c) => c.id === openId) ?? null : null;
  const view: "portfolio" | "cockpit" = colony ? "cockpit" : "portfolio";

  const handleCreate = async (form: CreateForm, crew: Agent[]) => {
    setSubmitting(true);
    try {
      const newId = await onCreateCompany(form, crew);
      setModal(null);
      if (newId) setOpenId(newId);
    } finally {
      setSubmitting(false);
    }
  };
  const handleImport = async (form: CompanyImportForm) => {
    setSubmitting(true);
    try {
      const importedId = await onImportCompany(form);
      setModal(null);
      if (importedId) setOpenId(importedId);
      return importedId;
    } finally {
      setSubmitting(false);
    }
  };
  const handleEdit = async (id: string, form: CompanyEditForm) => {
    setSubmitting(true);
    try {
      await onEditCompany(id, form);
      setModal(null);
    } finally {
      setSubmitting(false);
    }
  };
  const handleAddAgents = async (id: string, crew: Agent[]) => {
    setSubmitting(true);
    try {
      await onAddAgents(id, crew);
      setModal(null);
    } finally {
      setSubmitting(false);
    }
  };

  const cockpitHandlers: CockpitHandlers | null = colony && {
    onDecideApproval: (approvalId, decision, note) => onDecideApproval(colony.id, approvalId, decision, note),
    onDecideIssueApproval: (issue, decision, note) => onDecideIssueApproval(colony.id, issue, decision, note),
    onResolvePricing: (proposalId, decision) => onResolvePricing(colony.id, proposalId, decision),
    onSetApprovalPolicy: (policy) => onSetApprovalPolicy(colony.id, policy),
    onFreeze: (frozen) => onFreeze(colony.id, frozen),
    onDelete: () => onDelete(colony.id),
    onDispatch: () => onDispatch(colony.id),
    onStopAutonomy: () => onStopAutonomy(colony.id),
    onEdit: () => setModal({ type: "edit", id: colony.id }),
    onEditTreasury: () => setModal({ type: "treasury", id: colony.id }),
    onEditAgent: (agentId) => setModal({ type: "edit-agent", id: colony.id, agentId }),
    onOpenAgentSettings,
    onOpenIssue: (issue) => setModal({ type: "task", id: colony.id, issueId: getIssueIdentity(issue) }),
    onResolveIssue: (issue, answer) => onResolveIssue(colony.id, issue, answer),
    onRetryIssues: onRetryIssues ? (issues) => onRetryIssues(colony.id, issues) : undefined,
    onDismissIssues: (issues) => onDismissIssues(colony.id, issues),
    onReviewPreview: onReviewPreview ? (issue, decision, notes) => onReviewPreview(colony.id, issue, decision, notes) : undefined,
    onRecordRevenue: (input) => void onRecordRevenue(colony.id, input),
    busyId,
  };

  return (
    <div className="zhc-root frfade" data-theme={themeState} style={{ position: "relative", width: "100%", minWidth: 0, maxWidth: "100%", minHeight: "100%", background: "var(--bg)", color: "var(--fg)", borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)" }}>
      {/* backdrop — subtle warm wash + hex pattern, contained to the panel */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 60% at 50% -10%, color-mix(in srgb, var(--honey) 6%, transparent), transparent 60%)" }} />
      <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.06, pointerEvents: "none" }}>
        <defs>
          <pattern id="zhcHex" width="48" height="55" patternUnits="userSpaceOnUse">
            <polygon points="24,1 47,14 47,40 24,53 1,40 1,14" fill="none" stroke="var(--honey-line)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#zhcHex)" />
      </svg>

      <div style={{ position: "relative", zIndex: 1 }}>
        {view === "portfolio" && (
          <Masthead companies={visiblePortfolioColonies} loading={loading} initialLoading={initialLoading} onRefresh={onRefresh} onImport={() => setModal({ type: "import" })} onFounder={() => setModal({ type: "founder" })} theme={themeState} onToggleTheme={toggleTheme} />
        )}
        {error ? (
          <div style={{ margin: "12px 40px 0", padding: "8px 12px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
            {error}
          </div>
        ) : null}
        {notice && !error ? (
          <div style={{ margin: "12px 40px 0", padding: "8px 12px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--live) 35%, transparent)", background: "color-mix(in srgb, var(--live) 10%, transparent)", color: "var(--live)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
            {notice}
          </div>
        ) : null}

        {view === "portfolio" || !colony || !cockpitHandlers ? (
          <Portfolio
            colonies={visiblePortfolioColonies}
            density={density}
            showBudget={showBudget}
            cardStyle={cardStyle}
            showCreate={!initialLoading || colonies.length > 0}
            loading={initialLoading && colonies.length === 0}
            onOpen={setOpenId}
            onCreate={() => setModal({ type: "create" })}
            emptyHint={!loading && colonies.length === 0 ? (
              <div style={{ marginBottom: 18, fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.6 }}>
                No companies yet. Found one to group agents under a shared budget, kill switch, and apex goal, or import an existing project to track its systems.
              </div>
            ) : null}
          />
        ) : (
          <Cockpit
            colony={colony}
            colonies={colonies}
            showBudget={showBudget}
            theme={themeState}
            onToggleTheme={toggleTheme}
            onRefresh={onRefresh}
            refreshing={loading}
            initialTasksLoading={initialTasksLoading}
            onBack={() => setOpenId(null)}
            onSwitch={setOpenId}
            onAddAgents={() => setModal({ type: "browse", id: colony.id })}
            openSkillAttachmentBrowser={openSkillAttachmentBrowser}
            handlers={cockpitHandlers}
          />
        )}
      </div>

      {modal && modal.type === "create" && (
        <CreateCompanyModal agentPool={agentPool} initialCrew={initialCreateCrew} busy={submitting} theme={themeState} membershipOwners={membershipOwners} onDuplicateAgent={onDuplicateAgent ? duplicateFromPicker : undefined} onClose={closeModal} onCreate={handleCreate} />
      )}
      {modal && modal.type === "founder" && (
        <FounderModeModal
          agentPool={unassignedAgentPool}
          theme={themeState}
          onClose={closeModal}
          onCreated={(companyId) => {
            setModal(null);
            setOpenId(companyId);
            onRefresh();
          }}
        />
      )}
      {modal && modal.type === "import" && (
        <ImportCompanyModal
          busy={submitting}
          theme={themeState}
          chooseDirectoryForMachine={chooseDirectoryForMachine}
          defaultDirectoryMachine={defaultDirectoryMachine}
          onClose={closeModal}
          onImport={handleImport}
        />
      )}
      {modal && modal.type === "edit" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <EditCompanyModal initial={target.edit} busy={submitting} theme={themeState} onClose={closeModal} onSave={(form) => handleEdit(modal.id, form)} />
        ) : null;
      })()}
      {modal && modal.type === "treasury" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <TreasurySettingsModal colony={target} busy={submitting} theme={themeState} onClose={closeModal} onSave={(form) => handleEdit(modal.id, form)} />
        ) : null;
      })()}
      {modal && modal.type === "browse" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <AgentBrowserModal colony={target} agentPool={agentPool} busy={submitting} theme={themeState} membershipOwners={membershipOwners} onDuplicateAgent={onDuplicateAgent ? duplicateFromPicker : undefined} onClose={closeModal} onConfirm={(crew) => handleAddAgents(modal.id, crew)} />
        ) : null;
      })()}
      {modal && modal.type === "edit-agent" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <AgentMemberSettingsModal key={`${modal.id}:${modal.agentId}`} colony={target} agentId={modal.agentId} busy={submitting} theme={themeState} onClose={closeModal} onSave={(form) => handleEdit(modal.id, form)} />
        ) : null;
      })()}
      {modal && modal.type === "task" && (() => {
        // Resolve from the live colonies each render so polling keeps the detail fresh.
        const target = colonies.find((c) => c.id === modal.id);
        const issue = target?.issues.find((i) => getIssueIdentity(i) === modal.issueId);
        const apex = target?.apex;
        const metricLine = apex?.metric
          ? `${apex.metric}${apex.target ? ` → target ${apex.target}` : ""}${apex.current ? ` (current ${apex.current})` : ""}`
          : undefined;
        return issue?.work ? (
          <TaskDetailModal
            issue={issue}
            colonyName={target!.name}
            companyId={target!.id}
            apexGoal={apex?.title}
            metric={metricLine}
            theme={themeState}
            onClose={closeModal}
            onResolveIssue={(item, answer) => onResolveIssue(target!.id, item, answer)}
            onReviewPreview={onReviewPreview ? (item, decision, notes) => onReviewPreview(target!.id, item, decision, notes) : undefined}
            busy={busyId === issue.work?.taskId}
          />
        ) : null;
      })()}
    </div>
  );
}
