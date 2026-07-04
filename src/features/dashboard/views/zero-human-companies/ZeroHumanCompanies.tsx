"use client";
// Zero Human Companies — top-level presentational view. Masthead + portfolio /
// cockpit routing. Fully controlled: real colonies, agent roster and mutation
// handlers are supplied by ZeroHumanCompaniesView (which talks to the app APIs).
import React from "react";
import { Portfolio } from "./ColonyCards";
import { Cockpit, type CockpitHandlers } from "./Cockpit";
import { AgentBrowserModal, AgentMemberSettingsModal, CreateCompanyModal, EditCompanyModal, TreasurySettingsModal } from "./Modals";
import { TaskDetailModal } from "./TaskDetailModal";
import { getIssueIdentity } from "./issue-identity";
import type { Agent, CardStyle, Colony, CompanyEditForm, CompanyRevenueShareInput, CreateForm, Density, PoolAgent, Theme } from "./types";

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
  const c = tone === "honey" ? "var(--honey-2)" : "var(--fg)";
  return (
    <div style={{ textAlign: "left", padding: "0 18px", borderRight: last ? "none" : "1px solid var(--line)" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 30, fontWeight: 600, color: c, lineHeight: 1, letterSpacing: -0.8, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div className="mono-cap" style={{ color: "var(--fg-4)", marginTop: 5 }}>{label}{sub ? <span style={{ color: "var(--fg-4)", opacity: 0.7 }}> · {sub}</span> : null}</div>
    </div>
  );
}

function Masthead({
  view, companies, loading, initialLoading, onRefresh,
}: { view: "portfolio" | "cockpit"; companies: Colony[]; loading: boolean; initialLoading: boolean; onRefresh: () => void }) {
  const pendingFirstSync = initialLoading && companies.length === 0;
  const s = {
    colonies: companies.length,
    agents: companies.reduce((n, c) => n + c.agents.length, 0),
    working: companies.reduce((n, c) => n + c.agents.filter((a) => a.state === "working").length, 0),
    shipped: companies.reduce((n, c) => n + c.issues.filter((i) => i.status === "done").length, 0),
    approvals: companies.reduce((n, c) => n + c.approvals.length, 0),
    avgAlign: companies.length ? Math.round(companies.reduce((n, c) => n + c.alignment, 0) / companies.length) : 0,
  };
  const metric = (value: React.ReactNode) => pendingFirstSync ? "—" : value;
  return (
    <header style={{ position: "relative", zIndex: 2, padding: "20px 36px 16px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <HiveLogo size={40} />
          <div>
            <div className="mono-cap" style={{ color: "var(--honey-2)", whiteSpace: "nowrap" }}>HIVEMIND · AUTONOMOUS ORGS</div>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700, letterSpacing: -0.2, whiteSpace: "nowrap" }}>Zero Human Companies</div>
          </div>
        </div>
        <div style={{ textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", letterSpacing: 0.08, textTransform: "uppercase" }}>
          {pendingFirstSync ? (
            <span style={{ color: "var(--cyan-2)" }}>syncing company registry</span>
          ) : (
            <><span style={{ color: "var(--cyan-2)" }}>{s.working} agents at work</span> · {s.colonies} {s.colonies === 1 ? "company" : "companies"} · 0 humans</>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{ justifySelf: "end", display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", border: "1px solid var(--line-2)", borderRadius: 8, cursor: loading ? "default" : "pointer", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "6px 12px", textTransform: "uppercase", letterSpacing: 0.06, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "syncing…" : "↻ refresh"}
        </button>
      </div>

      {view === "portfolio" && (
        <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "end" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 46, lineHeight: 1.0, letterSpacing: -1.8 }}>
            Companies that run <span style={{ color: "var(--honey-2)", fontWeight: 600 }}>themselves.</span>
          </h1>
          <div style={{ display: "flex", gap: 0, paddingBottom: 6 }}>
            <Big n={metric(s.colonies)} label="colonies" />
            <Big n={metric(s.agents)} label="agents" sub={pendingFirstSync ? undefined : "0 humans"} />
            <Big n={metric(s.shipped)} label="shipped" />
            <Big n={metric(s.avgAlign + "%")} label="aligned" />
            <Big n={metric(s.approvals)} label="to approve" tone={!pendingFirstSync && s.approvals ? "honey" : null} last />
          </div>
        </div>
      )}
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
  error?: string | null;
  notice?: string | null;
  /** id currently mutating (approval id or company id), to disable its controls. */
  busyId: string | null;
  onRefresh: () => void;
  /** Found a company. Returns the new company id (to auto-open it) or null. */
  onCreateCompany: (form: CreateForm, crew: Agent[]) => Promise<string | null>;
  /** Edit an existing company's metadata, budgets, revenue, and member fields. */
  onEditCompany: (companyId: string, form: CompanyEditForm) => Promise<void>;
  /** Add staged crew to an existing company. */
  onAddAgents: (companyId: string, crew: Agent[]) => Promise<void>;
  onApprove: (companyId: string, approvalId: string) => void;
  onReject: (companyId: string, approvalId: string) => void;
  onFreeze: (companyId: string, frozen: boolean) => void;
  onDelete: (companyId: string) => void;
  /** Launch perpetual autonomy: decompose the apex goal + dispatch to the crew. */
  onDispatch: (companyId: string) => void;
  /** Stop perpetual autonomy (no new dispatches; in-flight work finishes). */
  onStopAutonomy: (companyId: string) => void;
  /** Record external revenue and optionally collect the HivemindOS share. */
  onRecordRevenue: (companyId: string, input: CompanyRevenueShareInput) => Promise<void>;
  theme?: Theme;
  cardStyle?: CardStyle;
  density?: Density;
  showBudget?: boolean;
}

export default function ZeroHumanCompanies({
  colonies, portfolioColonies, agentPool, initialCreateCrew, loading, initialLoading = loading, error, notice, busyId, onRefresh,
  onCreateCompany, onEditCompany, onAddAgents, onApprove, onReject, onFreeze, onDelete, onDispatch, onStopAutonomy, onRecordRevenue,
  theme = "dark", cardStyle = "detailed", density = "comfortable", showBudget = true,
}: ZeroHumanCompaniesProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<
    | { type: "create" }
    | { type: "edit"; id: string }
    | { type: "treasury"; id: string }
    | { type: "browse"; id: string }
    | { type: "edit-agent"; id: string; agentId: string }
    | { type: "task"; id: string; issueId: string }
    | null
  >(null);
  const [submitting, setSubmitting] = React.useState(false);
  const closeModal = React.useCallback(() => setModal(null), []);

  const visiblePortfolioColonies = portfolioColonies ?? colonies;
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
    onApprove: (approvalId) => onApprove(colony.id, approvalId),
    onReject: (approvalId) => onReject(colony.id, approvalId),
    onFreeze: (frozen) => onFreeze(colony.id, frozen),
    onDelete: () => onDelete(colony.id),
    onDispatch: () => onDispatch(colony.id),
    onStopAutonomy: () => onStopAutonomy(colony.id),
    onEdit: () => setModal({ type: "edit", id: colony.id }),
    onEditTreasury: () => setModal({ type: "treasury", id: colony.id }),
    onEditAgent: (agentId) => setModal({ type: "edit-agent", id: colony.id, agentId }),
    onOpenIssue: (issue) => setModal({ type: "task", id: colony.id, issueId: getIssueIdentity(issue) }),
    onRecordRevenue: (input) => void onRecordRevenue(colony.id, input),
    busyId,
  };

  return (
    <div className="zhc-root" data-theme={theme} style={{ position: "relative", minHeight: "100%", background: "var(--bg-0)", color: "var(--fg)", borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)" }}>
      {/* backdrop — subtle warm wash + hex pattern, contained to the panel */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 60% at 50% -10%, rgba(255,212,90,0.05), transparent 60%)" }} />
      <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.035, pointerEvents: "none" }}>
        <defs>
          <pattern id="zhcHex" width="48" height="55" patternUnits="userSpaceOnUse">
            <polygon points="24,1 47,14 47,40 24,53 1,40 1,14" fill="none" stroke="rgba(255,212,90,0.4)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#zhcHex)" />
      </svg>

      <div style={{ position: "relative", zIndex: 1 }}>
        <Masthead view={view} companies={visiblePortfolioColonies} loading={loading} initialLoading={initialLoading} onRefresh={onRefresh} />
        {error ? (
          <div style={{ margin: "12px 36px 0", padding: "8px 12px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)", color: "var(--danger-2)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
            {error}
          </div>
        ) : null}
        {notice && !error ? (
          <div style={{ margin: "12px 36px 0", padding: "8px 12px", borderRadius: 8, border: "1px solid color-mix(in srgb, var(--cyan) 35%, transparent)", background: "color-mix(in srgb, var(--cyan) 10%, transparent)", color: "var(--cyan-2)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
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
                No companies yet. Found one to group agents under a shared budget, kill switch, and apex goal.
              </div>
            ) : null}
          />
        ) : (
          <Cockpit
            colony={colony}
            colonies={colonies}
            showBudget={showBudget}
            theme={theme}
            onBack={() => setOpenId(null)}
            onSwitch={setOpenId}
            onAddAgents={() => setModal({ type: "browse", id: colony.id })}
            handlers={cockpitHandlers}
          />
        )}
      </div>

      {modal && modal.type === "create" && (
        <CreateCompanyModal agentPool={agentPool} initialCrew={initialCreateCrew} busy={submitting} theme={theme} onClose={closeModal} onCreate={handleCreate} />
      )}
      {modal && modal.type === "edit" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <EditCompanyModal initial={target.edit} busy={submitting} theme={theme} onClose={closeModal} onSave={(form) => handleEdit(modal.id, form)} />
        ) : null;
      })()}
      {modal && modal.type === "treasury" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <TreasurySettingsModal colony={target} busy={submitting} theme={theme} onClose={closeModal} onSave={(form) => handleEdit(modal.id, form)} />
        ) : null;
      })()}
      {modal && modal.type === "browse" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <AgentBrowserModal colony={target} agentPool={agentPool} busy={submitting} theme={theme} onClose={closeModal} onConfirm={(crew) => handleAddAgents(modal.id, crew)} />
        ) : null;
      })()}
      {modal && modal.type === "edit-agent" && (() => {
        const target = colonies.find((c) => c.id === modal.id);
        return target ? (
          <AgentMemberSettingsModal key={`${modal.id}:${modal.agentId}`} colony={target} agentId={modal.agentId} busy={submitting} theme={theme} onClose={closeModal} onSave={(form) => handleEdit(modal.id, form)} />
        ) : null;
      })()}
      {modal && modal.type === "task" && (() => {
        // Resolve from the live colonies each render so polling keeps the detail fresh.
        const target = colonies.find((c) => c.id === modal.id);
        const issue = target?.issues.find((i) => getIssueIdentity(i) === modal.issueId);
        return issue?.work ? (
          <TaskDetailModal issue={issue} colonyName={target!.name} theme={theme} onClose={closeModal} />
        ) : null;
      })()}
    </div>
  );
}
