"use client";
// Zero Human Companies — live container.
// Fetches real app data (companies + spend rollups, pending spend approvals,
// the agent roster, and the kanban board) and maps it into the Colony view
// model. Every mutation (found company, staff crew, approve/deny, freeze,
// disband) writes back through the existing app APIs, then refreshes.
import "./theme.css";

import React from "react";
import type { Company, CompanyApprovalPolicy, CompanyMember, CompanyRevenue, CompanySpendRollup } from "@/lib/types/company";
import ZeroHumanCompanies from "./ZeroHumanCompanies";
import {
  applyDemoEdit,
  createDemoColony,
  DEMO_AGENT_POOL,
  DEMO_COLONIES,
  DEMO_CREATE_SEED_CREW,
} from "./zhc-demo-data";
import { buildColony, toPoolAgents, type AgentLite, type ApprovalRow, type KanbanTaskLite } from "./mappers";
import { resolvedIssueAnswer, retryDelegationIssueAnswer } from "./issue-resume";
import { issuePreviewUrl, previewReviewAnswer, type PreviewDecision } from "./preview-review";
import type { Agent, Colony, CompanyEditForm, CompanyImportForm, CompanyMemberEdit, CompanyRevenueShareInput, CreateForm, GovEvent, Issue, PoolAgent } from "./types";
import type { CompanyRevenueRollup } from "@/lib/types/company-revenue";
import type { SkillBrowserAttachmentTarget } from "@/features/dashboard/dashboard-types";
import type { KanbanLinkedDirectory, KanbanMachineTarget } from "@/lib/types/kanban";

type CompanyEntry = { company: Company; rollup: CompanySpendRollup; revenueShare?: CompanyRevenueRollup };
type SkillAttachmentBrowserOpener = (target: SkillBrowserAttachmentTarget) => void | Promise<void>;
type DirectoryPicker = (machine: KanbanMachineTarget | null, onChoose: (directory: KanbanLinkedDirectory) => void) => void | Promise<void>;
type ImportCompanyResponse = { ok?: boolean; error?: string; company?: Company; updatedExisting?: boolean };

const POLL_MS = 15_000;
const NOTICE_AUTO_DISMISS_MS = 5_000;
const USE_ZHC_DEMO_DATA = false;

async function postCompanies(body: Record<string, unknown>): Promise<{ ok: boolean; company?: Company; error?: string }> {
  const res = await fetch("/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: "Bad response" }));
}

async function postCompanyRunRecord(companyId: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`/api/companies/${encodeURIComponent(companyId)}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function memberEditFromAgent(agent: Agent): CompanyMemberEdit {
  return {
    agentId: agent.id ?? agent.name,
    name: agent.name,
    role: agent.role,
    companyCap: agent._cap,
    task: agent.task,
    state: agent.state,
    reportsTo: agent.reportsTo,
    runtime: agent.runtime,
    model: agent.model,
  };
}

function ZeroHumanCompaniesDemoView({
  theme = "dark",
  openSkillAttachmentBrowser,
  chooseDirectoryForMachine,
  defaultDirectoryMachine,
}: {
  theme?: "dark" | "light";
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
  chooseDirectoryForMachine?: DirectoryPicker;
  defaultDirectoryMachine?: KanbanMachineTarget | null;
} = {}) {
  const [colonies, setColonies] = React.useState<Colony[]>(DEMO_COLONIES);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const portfolioColonies = colonies;

  const replaceColony = React.useCallback((companyId: string, updater: (colony: Colony) => Colony) => {
    setColonies((current) => current.map((colony) => (colony.id === companyId ? updater(colony) : colony)));
  }, []);

  const handleCreateCompany = React.useCallback(async (form: CreateForm, crew: Agent[]): Promise<string | null> => {
    const next = createDemoColony(form, crew);
    setColonies((current) => [next, ...current]);
    return next.id;
  }, []);

  const handleImportCompany = React.useCallback(async (form: CompanyImportForm): Promise<string | null> => {
    const name = form.companyName?.trim() || "Imported Company";
    const next: Colony = {
      ...createDemoColony({
        name,
        ticker: form.ticker,
        sector: form.sector || "Imported Product",
        apexTitle: form.apexGoalTitle || `Keep ${name}'s existing product operations visible and healthy`,
      }, []),
      importedOperations: {
        source: "repo",
        importedAt: new Date().toISOString(),
        lastDiscoveredAt: new Date().toISOString(),
        projectPath: form.repoPath,
        workflows: [],
        schedules: [],
        services: [],
        scripts: [],
      },
    };
    setColonies((current) => [next, ...current]);
    return next.id;
  }, []);

  const handleEditCompany = React.useCallback(async (companyId: string, form: CompanyEditForm): Promise<void> => {
    replaceColony(companyId, (colony) => applyDemoEdit(colony, form));
  }, [replaceColony]);

  const handleAddAgents = React.useCallback(async (companyId: string, crew: Agent[]): Promise<void> => {
    replaceColony(companyId, (colony) => {
      const existingIds = new Set(colony.agents.map((agent) => agent.id).filter(Boolean));
      const queen = colony.agents.find((agent) => agent.role === "Queen");
      const additions = crew
        .filter((agent) => agent.id && !existingIds.has(agent.id))
        .map((agent) => ({
          ...agent,
          reportsTo: agent.role === "Queen" ? null : queen?.name ?? null,
          state: agent.state === "ready" ? "working" as const : agent.state,
        }));
      if (additions.length === 0) return colony;
      return applyDemoEdit(colony, {
        ...colony.edit,
        members: [...(colony.edit.members ?? []), ...additions.map(memberEditFromAgent)],
      });
    });
  }, [replaceColony]);

  const decideApproval = React.useCallback((companyId: string, approvalId: string, decision: "approved" | "denied", note?: string) => {
    setBusyId(approvalId);
    replaceColony(companyId, (colony) => {
      const approval = colony.approvals.find((item) => item.id === approvalId);
      if (!approval) return colony;
      const eventKind: GovEvent["kind"] = decision === "approved" ? "patch" : "alert";
      return {
        ...colony,
        approvals: colony.approvals.filter((item) => item.id !== approvalId),
        governance: [
          {
            kind: eventKind,
            text: `${approval.agent}'s ${approval.kind} request was ${decision}: ${approval.title}.${note?.trim() ? ` Note: ${note.trim()}` : ""}`,
            agent: "human",
            since: "now",
          },
          ...colony.governance,
        ].slice(0, 5),
      };
    });
    setBusyId(null);
  }, [replaceColony]);

  const setDemoApprovalPolicy = React.useCallback((companyId: string, policy: CompanyApprovalPolicy) => {
    setBusyId(`approval-policy:${policy.id}`);
    replaceColony(companyId, (colony) => {
      const current = colony.approvalPolicies ?? [];
      const byId = new Map(current.map((entry) => [entry.id, entry]));
      byId.set(policy.id, policy);
      return { ...colony, approvalPolicies: [...byId.values()] };
    });
    setBusyId(null);
  }, [replaceColony]);

  const handleFreeze = React.useCallback((companyId: string, frozen: boolean) => {
    setBusyId(companyId);
    replaceColony(companyId, (colony) => ({
      ...colony,
      frozen,
      status: frozen ? "paused" : colony.status === "paused" ? "shipping" : colony.status,
      agents: colony.agents.map((agent) => ({ ...agent, state: frozen ? "blocked" : agent.state })),
      edit: { ...colony.edit, frozen, status: frozen ? "paused" : colony.edit.status },
    }));
    setBusyId(null);
  }, [replaceColony]);

  const handleDispatch = React.useCallback((companyId: string) => {
    setBusyId(companyId);
    replaceColony(companyId, (colony) => ({
      ...colony,
      autonomy: true,
      lastDispatchedAt: Date.now(),
      workBlock: { ...colony.workBlock, state: "active" },
      governance: [
        { kind: "reflect" as const, text: "Regent decomposed the apex goal and re-dispatched the active work block.", agent: "Regent", since: "now" },
        ...colony.governance,
      ].slice(0, 5),
    }));
    setBusyId(null);
  }, [replaceColony]);

  const handleStopAutonomy = React.useCallback((companyId: string) => {
    setBusyId(companyId);
    replaceColony(companyId, (colony) => ({ ...colony, autonomy: false }));
    setBusyId(null);
  }, [replaceColony]);

  const handleResolveIssue = React.useCallback((companyId: string, issue: Issue) => {
    const taskId = issue.work?.taskId;
    setBusyId(taskId ?? issue.key);
    replaceColony(companyId, (colony) => ({
      ...colony,
      issues: colony.issues.map((item) => {
        const same = (taskId && item.work?.taskId === taskId) || item.key === issue.key;
        return same
          ? { ...item, status: "todo" as const, work: item.work ? { ...item.work, status: "ready", body: `${item.work.body ?? ""}\n\n${resolvedIssueAnswer(item)}`.trim() } : item.work }
          : item;
      }),
      governance: [
        { kind: "reflect" as const, text: `Human handled the blocker on ${issue.title}; the task is back in the queue to retry.`, agent: "human", since: "now" },
        ...colony.governance,
      ].slice(0, 5),
    }));
    setBusyId(null);
  }, [replaceColony]);

  const handleRetryIssues = React.useCallback((companyId: string, issues: Issue[]) => {
    const keys = new Set(issues.map((issue) => issue.work?.taskId ?? issue.key));
    setBusyId(issues[0]?.work?.taskId ?? issues[0]?.key ?? companyId);
    replaceColony(companyId, (colony) => ({
      ...colony,
      issues: colony.issues.map((item) =>
        keys.has(item.work?.taskId ?? item.key)
          ? { ...item, status: "todo" as const, work: item.work ? { ...item.work, status: "ready", body: `${item.work.body ?? ""}\n\n${retryDelegationIssueAnswer(item)}`.trim() } : item.work }
          : item,
      ),
      governance: [
        { kind: "reflect" as const, text: `Human re-queued ${issues.length} infrastructure-blocked task${issues.length === 1 ? "" : "s"} for another autonomous attempt.`, agent: "human", since: "now" },
        ...colony.governance,
      ].slice(0, 5),
    }));
    setBusyId(null);
  }, [replaceColony]);

  const handleDismissIssues = React.useCallback((companyId: string, issues: Issue[]) => {
    const keys = new Set(issues.map((issue) => issue.work?.taskId ?? issue.key));
    setBusyId(issues[0]?.work?.taskId ?? issues[0]?.key ?? companyId);
    replaceColony(companyId, (colony) => ({
      ...colony,
      issues: colony.issues.filter((item) => !keys.has(item.work?.taskId ?? item.key)),
      governance: [
        { kind: "reflect" as const, text: `Human dismissed ${issues.length} issue${issues.length === 1 ? "" : "s"} — set aside off the board.`, agent: "human", since: "now" },
        ...colony.governance,
      ].slice(0, 5),
    }));
    setBusyId(null);
  }, [replaceColony]);

  const handleRecordRevenue = React.useCallback(async (companyId: string, input: CompanyRevenueShareInput): Promise<void> => {
    replaceColony(companyId, (colony) => {
      const current = colony.revenueShare ?? {
        companyId,
        eventCount: 0,
        totalRevenueUsd: 0,
        shareQuotedUsd: 0,
        shareCollectedUsd: 0,
        sharePendingUsd: 0,
        shareFailedUsd: 0,
        shareUnavailableUsd: 0,
      };
      const fee = Math.max(0.01, Math.round(input.amountUsd * 0.01 * 100) / 100);
      return {
        ...colony,
        revenueShare: {
          ...current,
          eventCount: current.eventCount + 1,
          totalRevenueUsd: Math.round((current.totalRevenueUsd + input.amountUsd) * 100) / 100,
          shareQuotedUsd: Math.round((current.shareQuotedUsd + fee) * 100) / 100,
          shareCollectedUsd: input.collectFee ? Math.round((current.shareCollectedUsd + fee) * 100) / 100 : current.shareCollectedUsd,
          sharePendingUsd: input.collectFee ? current.sharePendingUsd : Math.round((current.sharePendingUsd + fee) * 100) / 100,
          lastRevenueAt: new Date().toISOString(),
        },
      };
    });
  }, [replaceColony]);

  return (
    <ZeroHumanCompanies
      colonies={colonies}
      portfolioColonies={portfolioColonies}
      agentPool={DEMO_AGENT_POOL}
      initialCreateCrew={DEMO_CREATE_SEED_CREW}
      loading={false}
      initialLoading={false}
      error={null}
      notice={null}
      busyId={busyId}
      onRefresh={() => setColonies(DEMO_COLONIES)}
      onCreateCompany={handleCreateCompany}
      onImportCompany={handleImportCompany}
      onEditCompany={handleEditCompany}
      onAddAgents={handleAddAgents}
      onDecideApproval={(companyId, approvalId, decision, note) => decideApproval(companyId, approvalId, decision, note)}
      onResolvePricing={(companyId, proposalId) =>
        replaceColony(companyId, (colony) => ({
          ...colony,
          pricingProposals: (colony.pricingProposals ?? []).filter((proposal) => proposal.id !== proposalId),
        }))
      }
      onSetApprovalPolicy={setDemoApprovalPolicy}
      onFreeze={handleFreeze}
      onDelete={(companyId) => setColonies((current) => current.filter((colony) => colony.id !== companyId))}
      onDispatch={handleDispatch}
      onStopAutonomy={handleStopAutonomy}
      onResolveIssue={(companyId, issue) => handleResolveIssue(companyId, issue)}
      onRetryIssues={(companyId, issues) => handleRetryIssues(companyId, issues)}
      onDismissIssues={(companyId, issues) => handleDismissIssues(companyId, issues)}
      onRecordRevenue={handleRecordRevenue}
      openSkillAttachmentBrowser={openSkillAttachmentBrowser}
      chooseDirectoryForMachine={chooseDirectoryForMachine}
      defaultDirectoryMachine={defaultDirectoryMachine}
      theme={theme}
    />
  );
}

function ZeroHumanCompaniesLiveView({
  theme = "dark",
  openSkillAttachmentBrowser,
  chooseDirectoryForMachine,
  defaultDirectoryMachine,
}: {
  theme?: "dark" | "light";
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
  chooseDirectoryForMachine?: DirectoryPicker;
  defaultDirectoryMachine?: KanbanMachineTarget | null;
} = {}) {
  const [data, setData] = React.useState<CompanyEntry[]>([]);
  const [agents, setAgents] = React.useState<AgentLite[]>([]);
  const [approvals, setApprovals] = React.useState<ApprovalRow[]>([]);
  const [tasks, setTasks] = React.useState<KanbanTaskLite[]>([]);
  const [loading, setLoading] = React.useState(true);
  // Companies come back from their own fetch and flip `loading` false BEFORE the
  // separate Work Board tasks fetch lands — so the cockpit renders with every
  // lane empty for a beat. Track the first tasks fetch on its own so the board
  // can show skeletons (not a wall of "empty") until real tasks arrive.
  const [tasksLoaded, setTasksLoaded] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [noticeRevision, setNoticeRevision] = React.useState(0);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // "Hide locally" fallback for dismissed issues that have NO backing Work Board
  // task to archive — keyed by issue.key. Task-backed dismisses archive for real;
  // this only holds the ones there's nothing to persist against. Resets on reload.
  const [dismissedIssueKeys, setDismissedIssueKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  // The companies API reports the autonomy driver's health alongside the list.
  // A launched company with a dead driver looks "running" while dispatching
  // nothing — that gap stranded the Website Outreach Agency for ~7h once, so
  // surface it loudly. (The same GET also self-heals: the route restarts the
  // driver, so a persistent warning means restarting is genuinely failing.)
  const [driverWarning, setDriverWarning] = React.useState<string | null>(null);

  const showNotice = React.useCallback((message: string) => {
    setNotice(message);
    setNoticeRevision((revision) => revision + 1);
  }, []);

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice, noticeRevision]);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      // Fire the company list and the Work Board / approvals / agents fetches
      // concurrently — they have no dependency, and running them in series
      // (companies THEN kanban) doubled the load time, so the board sat empty
      // for the sum of both round trips instead of the slower single one.
      const companiesPromise = fetch("/api/companies", { cache: "no-store" });
      const auxPromise = Promise.allSettled([
        fetch("/api/wallet/approvals?status=pending", { cache: "no-store" }),
        fetch("/api/obsidian/agents", { cache: "no-store" }),
        fetch("/api/kanban?include_boards=false", { cache: "no-store" }),
      ]);
      const companiesRes = await companiesPromise;
      const companiesJson = await companiesRes.json().catch(() => ({}));
      if (companiesJson.ok) {
        setData(Array.isArray(companiesJson.companies) ? companiesJson.companies : []);
        setError(null);
        const driver = companiesJson.driver as { status?: string } | undefined;
        const anyAutonomous = (Array.isArray(companiesJson.companies) ? companiesJson.companies : []).some(
          (entry: { company?: { autonomy?: boolean; frozen?: boolean } }) => entry?.company?.autonomy && !entry?.company?.frozen,
        );
        setDriverWarning(
          driver && driver.status !== "running" && anyAutonomous
            ? "Autonomy driver is not running on this machine — launched companies are not dispatching work. A restart was requested automatically; if this warning persists across refreshes, check the dashboard server logs."
            : null,
        );
      } else if (companiesRes.status === 401) {
        setNotice(null);
        setError("Dashboard authentication required.");
      } else if (companiesJson.error) {
        setNotice(null);
        setError(companiesJson.error);
      }
      setLoading(false);

      const [approvalsResult, agentsResult, kanbanResult] = await auxPromise;

      if (approvalsResult.status === "fulfilled") {
        const approvalsJson = await approvalsResult.value.json().catch(() => ({}));
        if (approvalsJson.ok && Array.isArray(approvalsJson.approvals)) setApprovals(approvalsJson.approvals);
      }

      if (agentsResult.status === "fulfilled") {
        const agentsJson = await agentsResult.value.json().catch(() => ({}));
        if (agentsJson.ok && Array.isArray(agentsJson.agents)) {
          setAgents(agentsJson.agents.map((a: Record<string, unknown>) => ({
            id: String(a.id ?? a.agentId ?? ""),
            name: typeof a.name === "string" && a.name ? a.name : String(a.id ?? a.agentId ?? "agent"),
            runtime: typeof a.runtime === "string" ? a.runtime : undefined,
            provider: typeof a.provider === "string" ? a.provider : undefined,
            model: typeof a.model === "string" ? a.model : undefined,
            beeRole: typeof a.beeRole === "string" ? a.beeRole : undefined,
            workerClass: typeof a.workerClass === "string" ? a.workerClass : undefined,
          })).filter((a: AgentLite) => a.id));
        }
      }

      if (kanbanResult.status === "fulfilled") {
        const kanbanJson = await kanbanResult.value.json().catch(() => ({}));
        const boardTasks = kanbanJson?.board?.tasks;
        if (Array.isArray(boardTasks)) {
          setTasks(boardTasks.map((t: Record<string, unknown>) => ({
            id: String(t.id ?? ""),
            title: typeof t.title === "string" ? t.title : "",
            body: typeof t.body === "string" ? t.body : undefined,
            result: typeof t.result === "string" ? t.result : undefined,
            status: typeof t.status === "string" ? t.status : "ideas",
            source: typeof t.source === "string" ? t.source : undefined,
            assignee: typeof t.assignee === "string" ? t.assignee : null,
            priority: typeof t.priority === "string" ? t.priority : undefined,
            skills: Array.isArray(t.skills) ? (t.skills as string[]) : undefined,
            deliverables: Array.isArray(t.deliverables) ? (t.deliverables as KanbanTaskLite["deliverables"]) : undefined,
            loop: t.loop && typeof t.loop === "object" ? (t.loop as KanbanTaskLite["loop"]) : undefined,
            loopReceipts: Array.isArray(t.loopReceipts) ? (t.loopReceipts as KanbanTaskLite["loopReceipts"]) : undefined,
            targetMachine: t.targetMachine && typeof t.targetMachine === "object" ? (t.targetMachine as KanbanTaskLite["targetMachine"]) : undefined,
            createdAt: typeof t.createdAt === "number" ? t.createdAt : undefined,
            updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : undefined,
            completedAt: typeof t.completedAt === "number" ? t.completedAt : undefined,
          })));
          // Tasks are only genuinely loaded on a SUCCESSFUL kanban fetch that
          // returned a task array. This used to live in `finally`, which flipped
          // it even when the kanban fetch rejected or returned a non-array — which
          // happens under load (the very case that makes the load slow). That
          // killed the board/issues loading skeletons and flashed "empty" until a
          // later poll landed, so tasks appeared to "pop in" with no loading state.
          setTasksLoaded(true);
        }
      }
    } catch {
      setNotice(null);
      setError("Could not reach the companies API.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const agentsById = React.useMemo(() => {
    const map = new Map<string, AgentLite>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const agentPool: PoolAgent[] = React.useMemo(() => toPoolAgents(agents), [agents]);

  // Resolve each approval to a company (explicit companyId, else by membership).
  const companyByAgent = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const { company } of data) for (const id of company.agentIds ?? []) map.set(id, company.id);
    return map;
  }, [data]);

  const approvalsByCompany = React.useMemo(() => {
    const map = new Map<string, ApprovalRow[]>();
    for (const a of approvals) {
      const companyId = a.companyId || companyByAgent.get(a.agentId);
      if (!companyId) continue;
      const list = map.get(companyId) ?? [];
      list.push(a);
      map.set(companyId, list);
    }
    return map;
  }, [approvals, companyByAgent]);

  const colonies: Colony[] = React.useMemo(() => {
    const out: Colony[] = [];
    for (const entry of data) {
      const company = entry?.company;
      if (!company || typeof company.id !== "string") continue;
      try {
        // Scope the board strictly to work THIS company dispatched: every company
        // dispatch stamps `company:{id}:{runId}` as the task source, so that prefix
        // is the authoritative and sufficient link. We deliberately do NOT fall
        // back to assignee identity — a member agent (e.g. the Queen) also runs
        // unrelated work from other sources (loop evals, ad-hoc chats), and matching
        // by assignee dragged all of that history onto the company board/deliverables
        // (seen live 2026-07-02: 11 stray tasks). Source-only keeps it clean.
        const sourcePrefix = `company:${company.id}:`;
        const companyTasks = tasks.filter((t) => t.source?.startsWith(sourcePrefix));
        const colony = buildColony({
          company,
          rollup: entry.rollup ?? { companyId: company.id, memberCount: company.agentIds?.length ?? 0, dailySpentUsd: 0, monthlySpentUsd: 0, totalSpentUsd: 0, dailyRemainingUsd: null, monthlyRemainingUsd: null, totalRemainingUsd: null },
          approvals: approvalsByCompany.get(company.id) ?? [],
          agentsById,
          tasks: companyTasks,
          revenueShare: entry.revenueShare,
        });
        // Drop issues the human hid locally (dismisses with no task to archive).
        out.push(
          dismissedIssueKeys.size
            ? { ...colony, issues: colony.issues.filter((issue) => !dismissedIssueKeys.has(issue.work?.taskId ?? issue.key)) }
            : colony,
        );
      } catch {
        // Skip a malformed record rather than blanking the whole portfolio.
      }
    }
    return out;
  }, [data, agentsById, approvalsByCompany, tasks, dismissedIssueKeys]);

  // ── mutations ──────────────────────────────────────────────────────────
  const membersFromCrew = React.useCallback((crew: Agent[], queenId: string | null): CompanyMember[] => {
    return crew
      .filter((a) => a.id)
      .map((a) => ({
        agentId: a.id!,
        companyCap: a._cap,
        roleInCompany: a.role,
        reportsTo: a.role === "Queen" ? null : queenId,
        task: a.task && !a.task.startsWith("Idle") ? a.task : undefined,
      }));
  }, []);

  const membersFromEdit = React.useCallback((members: CompanyEditForm["members"] = []): CompanyMember[] => {
    const ids = new Set(members.map((member) => member.agentId).filter(Boolean));
    const hasQueen = members.some((member) => member.role === "Queen");
    const queen = members.find((member) => member.role === "Queen") ?? members[0];
    const queenId = queen?.agentId ?? null;
    return members
      .filter((member) => member.agentId)
      .map((member) => {
        const isQueen = member.role === "Queen" || (!hasQueen && member.agentId === queenId);
        return {
          agentId: member.agentId,
          companyCap: member.companyCap && member.companyCap > 0 ? member.companyCap : undefined,
          roleInCompany: isQueen ? "Queen" : member.role,
          reportsTo: isQueen
            ? null
            : member.reportsTo && ids.has(member.reportsTo)
              ? member.reportsTo
              : queenId,
          task: member.task?.trim() || undefined,
          state: member.state || undefined,
        };
      });
  }, []);

  const handleCreateCompany = React.useCallback(async (form: CreateForm, crew: Agent[]): Promise<string | null> => {
    const queen = crew.find((a) => a.role === "Queen") ?? crew[0];
    const queenId = queen?.id ?? null;
    const members = membersFromCrew(crew, queenId);
    const dailyBudgetUsd = members.reduce((n, m) => n + (m.companyCap || 0), 0);
    const apexGoal = (form.apexTitle || form.apexMetric || form.apexTarget)
      ? { title: form.apexTitle || form.apexMetric || "Apex goal", metric: form.apexMetric || undefined, target: form.apexTarget || undefined, current: "0", progress: 0, unit: form.metricUnit }
      : undefined;
    const result = await postCompanies({
      action: "upsert",
      name: form.name,
      ticker: form.ticker || undefined,
      sector: form.sector || undefined,
      apexGoal,
      members,
      dailyBudgetUsd: dailyBudgetUsd > 0 ? dailyBudgetUsd : undefined,
    });
    if (!result.ok) { setError(result.error || "Could not create company."); return null; }
    await refresh();
    return result.company?.id ?? null;
  }, [membersFromCrew, refresh]);

  const handleImportCompany = React.useCallback(async (form: CompanyImportForm): Promise<string | null> => {
    setBusyId("import-company");
    setNotice(null);
    try {
      const res = await fetch("/api/companies/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          repoPath: form.repoPath,
          companyName: form.companyName,
          ticker: form.ticker,
          sector: form.sector,
          apexGoalTitle: form.apexGoalTitle,
          companyId: form.companyId,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ImportCompanyResponse;
      if (!res.ok || json.ok === false || !json.company?.id) {
        setError(json.error || "Could not import company.");
        return null;
      }
      setError(null);
      showNotice(json.updatedExisting ? `${json.company.name} systems refreshed.` : `${json.company.name} imported with repository systems attached.`);
      await refresh();
      return json.company.id;
    } finally {
      setBusyId(null);
    }
  }, [refresh, showNotice]);

  const handleEditCompany = React.useCallback(async (companyId: string, form: CompanyEditForm): Promise<void> => {
    setBusyId(companyId);
    try {
      const apexGoal = {
        title: form.apexTitle || undefined,
        metric: form.apexMetric || undefined,
        target: form.apexTarget || undefined,
        unit: form.metricUnit,
        current: form.apexCurrent || undefined,
        progress: form.apexProgress,
      };
      const revenue: CompanyRevenue = {
        kind: form.revenueKind || undefined,
        label: form.revenueLabel || "",
        value: form.revenueValue || "",
        target: form.revenueTarget || null,
        mau: form.revenueMau || undefined,
        pct: form.revenuePct,
        delta: form.revenueDelta || null,
        up: form.revenueUp !== false,
        isApex: form.revenueIsApex === true,
      };
      // null (not undefined) so clearing the threshold removes the config server-side.
      const autonomyPause = form.autonomyPauseMax && form.autonomyPauseMax > 0
        ? {
            maxWaitingOnHuman: form.autonomyPauseMax,
            countMode: form.autonomyPauseMode ?? "all",
            deliverableKinds: form.autonomyPauseMode === "deliverable-kinds" ? form.autonomyPauseKinds : undefined,
          }
        : null;
      const result = await postCompanies({
        action: "upsert",
        id: companyId,
        name: form.name,
        ticker: form.ticker || undefined,
        sector: form.sector || undefined,
        charter: form.charter ?? "",
        blurb: form.blurb ?? "",
        projectId: form.projectId ?? "",
        analyticsProvider: form.analyticsProvider || undefined,
        analyticsConfig:
          form.analyticsProjectId || form.analyticsHost
            ? { projectId: form.analyticsProjectId || undefined, host: form.analyticsHost || undefined }
            : undefined,
        dailyBudgetUsd: form.dailyBudgetUsd && form.dailyBudgetUsd > 0 ? form.dailyBudgetUsd : 0,
        monthlyBudgetUsd: form.monthlyBudgetUsd && form.monthlyBudgetUsd > 0 ? form.monthlyBudgetUsd : 0,
        totalBudgetUsd: form.totalBudgetUsd && form.totalBudgetUsd > 0 ? form.totalBudgetUsd : 0,
        frozen: form.frozen === true,
        autonomyPause,
        status: form.status ?? "",
        alignment: form.alignment ?? "",
        apexGoal,
        revenue,
        members: membersFromEdit(form.members),
      });
      if (!result.ok) setError(result.error || "Could not save changes.");
      else setError(null);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [membersFromEdit, refresh]);

  const handleAddAgents = React.useCallback(async (companyId: string, crew: Agent[]): Promise<void> => {
    // Server-authoritative additive merge — no read-merge-write race. reportsTo is
    // left null; the org chart recomputes it to the company's Queen on render.
    const additions = membersFromCrew(crew, null);
    if (additions.length === 0) return;
    setBusyId(companyId);
    try {
      const result = await postCompanies({ action: "add-members", id: companyId, members: additions });
      if (!result.ok) setError(result.error || "Could not add agents.");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [membersFromCrew, refresh]);

  const decideApproval = React.useCallback(async (approvalId: string, decision: "approved" | "denied", note?: string) => {
    setBusyId(approvalId);
    try {
      const res = await fetch("/api/wallet/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approvalId, decision, note: note?.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok && json.error) setError(json.error);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const resolvePricing = React.useCallback(async (companyId: string, proposalId: string, decision: "approve" | "reject") => {
    setBusyId(proposalId);
    try {
      const result = await postCompanies({ action: "resolve-pricing", id: companyId, proposalId, decision });
      if (!result.ok) {
        setError(result.error || "Could not resolve the pricing request.");
      } else {
        showNotice(
          decision === "approve"
            ? "New price applied to the catalog — the crew quotes it from the next dispatch."
            : "Pricing request rejected — the crew keeps the current price and learns the decision.",
        );
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh, showNotice]);

  const setApprovalPolicy = React.useCallback(async (companyId: string, policy: CompanyApprovalPolicy) => {
    setBusyId(`approval-policy:${policy.id}`);
    try {
      const result = await postCompanies({ action: "set-approval-policy", id: companyId, approvalPolicy: policy });
      if (!result.ok) {
        setError(result.error || "Could not save the approval policy.");
      } else {
        setError(null);
        showNotice("Approval policy saved - the crew reads it on the next dispatch.");
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh, showNotice]);

  const handleFreeze = React.useCallback(async (companyId: string, frozen: boolean) => {
    setBusyId(companyId);
    try {
      const result = await postCompanies({ action: frozen ? "freeze" : "unfreeze", id: companyId });
      if (!result.ok) setError(result.error || "Could not update the kill switch.");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const handleDelete = React.useCallback(async (companyId: string) => {
    setBusyId(companyId);
    try {
      const result = await postCompanies({ action: "delete", id: companyId });
      if (!result.ok && result.error) setError(result.error);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const handleDispatch = React.useCallback(async (companyId: string) => {
    setBusyId(companyId);
    setNotice(null);
    try {
      // Send the live fleet so the engine can route to (and execute on) the
      // company's online member agents; the server filters it to members.
      let fleetSnapshot: unknown[] = [];
      try {
        const fres = await fetch("/api/fleet/discover?fresh=1&includeSnapshots=0", { cache: "no-store" });
        const fjson = await fres.json().catch(() => ({}));
        if (Array.isArray(fjson?.machines)) fleetSnapshot = fjson.machines;
      } catch { /* offline fleet → tasks queue as pending */ }

      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dispatch-goal", id: companyId, fleetSnapshot }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) {
        setError(json.error || "Could not launch work toward the goal.");
      } else {
        setError(null);
        const d = json.dispatch ?? {};
        const n = d.taskCount ?? 0;
        const live = d.dispatchableMembers ?? 0;
        const plan = d.planner === "llm" ? "AI-planned" : "auto-planned";
        showNotice(
          live > 0
            ? `Launched ${n} ${plan} task${n === 1 ? "" : "s"} to ${live} online agent${live === 1 ? "" : "s"} — autonomy is running; it keeps working until you stop it.`
            : `Queued ${n} ${plan} task${n === 1 ? "" : "s"}. Autonomy is on — work starts as soon as a member agent comes online.`,
        );
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh, showNotice]);

  const handleStopAutonomy = React.useCallback(async (companyId: string) => {
    setBusyId(companyId);
    setNotice(null);
    try {
      const result = await postCompanies({ action: "stop-autonomy", id: companyId });
      if (!result.ok) setError(result.error || "Could not stop autonomy.");
      else { setError(null); showNotice("Autonomy stopped — in-flight tasks finish, no new work will be dispatched."); }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh, showNotice]);

  const handleResolveIssue = React.useCallback(async (companyId: string, issue: Issue) => {
    const taskId = issue.work?.taskId;
    if (!taskId) {
      setError("This issue does not have a Work Board task to resume.");
      return;
    }
    const companyName = data.find((entry) => entry.company?.id === companyId)?.company?.name ?? "Company";
    setBusyId(taskId);
    setNotice(null);
    try {
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "answer",
          taskId,
          answer: resolvedIssueAnswer(issue),
          author: "dashboard",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not mark this issue resolved.");
      } else {
        void postCompanyRunRecord(companyId, {
          action: "settle-proposal",
          idempotencyKey: `task-human:${taskId}`,
          status: "applied",
          decision: "Human marked the blocker handled and resumed the task.",
          decidedBy: "human",
          evidence: [resolvedIssueAnswer(issue)],
        });
        setError(null);
        showNotice(
          json.pickupScheduled
            ? `${companyName}: marked resolved. ${issue.agent || "The agent"} is picking the task back up now.`
            : `${companyName}: marked resolved. The task is back in the Work Board queue.`,
        );
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [data, refresh, showNotice]);

  const handleRetryIssues = React.useCallback(async (companyId: string, issues: Issue[]) => {
    const taskIds = issues.map((issue) => issue.work?.taskId).filter((id): id is string => Boolean(id));
    if (taskIds.length === 0) {
      setError("These issues have no Work Board tasks to re-run.");
      return;
    }
    const companyName = data.find((entry) => entry.company?.id === companyId)?.company?.name ?? "Company";
    setBusyId(taskIds[0]);
    setNotice(null);
    try {
      // Same `answer` rail as Mark Resolved, one POST per task: the retry note
      // stamps into the body, the task returns to Ready, and pickup is scheduled.
      // Zero-human boards have no hand-move, so this IS the re-run mechanism.
      const results = await Promise.all(
        issues.map((issue) => {
          const taskId = issue.work?.taskId;
          if (!taskId) return Promise.resolve({ ok: false, pickupScheduled: false });
          return fetch("/api/kanban", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "answer",
              taskId,
              answer: retryDelegationIssueAnswer(issue),
              author: "dashboard",
            }),
          })
            .then(async (res) => {
              const json = await res.json().catch(() => ({}));
              return { ok: res.ok && json.ok === true, pickupScheduled: json.pickupScheduled === true };
            })
            .catch(() => ({ ok: false, pickupScheduled: false }));
        }),
      );
      const ok = results.filter((result) => result.ok).length;
      const pickingUp = results.filter((result) => result.ok && result.pickupScheduled).length;
      if (ok === 0) {
        setError("Could not re-queue these tasks — check the dashboard server logs.");
      } else {
        for (const issue of issues) {
          const taskId = issue.work?.taskId;
          if (!taskId) continue;
          void postCompanyRunRecord(companyId, {
            action: "create-proposal",
            kind: "human-input",
            status: "applied",
            title: `Retry requested: ${issue.title}`,
            sourceTaskId: taskId,
            idempotencyKey: `task-retry:${taskId}:${Date.now()}`,
            risk: "low",
            decision: "Human requested another autonomous attempt.",
            decidedBy: "human",
            evidence: [retryDelegationIssueAnswer(issue)],
          });
        }
        setError(null);
        const failNote = ok < taskIds.length ? ` (${taskIds.length - ok} failed to re-queue)` : "";
        showNotice(
          pickingUp > 0
            ? `${companyName}: re-queued ${ok} task${ok === 1 ? "" : "s"} — ${pickingUp === ok ? "the crew is picking them back up now" : `${pickingUp} picking up now, the rest on the next sweep`}.${failNote}`
            : `${companyName}: re-queued ${ok} task${ok === 1 ? "" : "s"} for the next dispatch sweep.${failNote}`,
        );
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [data, refresh, showNotice]);

  const handleDismissIssues = React.useCallback(async (companyId: string, issues: Issue[]) => {
    if (issues.length === 0) return;
    const companyName = data.find((entry) => entry.company?.id === companyId)?.company?.name ?? "Company";
    // Hide every dismissed issue locally and IMMEDIATELY, keyed the same way the
    // colonies memo filters (`work.taskId ?? key`). This is what makes the click
    // always take effect: task-backed issues are also archived below, but the
    // local hide is what survives a mid-flight background poll or a driver
    // re-escalation that would otherwise re-surface the card and make the button
    // look broken. Resets on reload — if the archive fails, the issue returns.
    setDismissedIssueKeys((prev) => {
      const next = new Set(prev);
      for (const issue of issues) next.add(issue.work?.taskId ?? issue.key);
      return next;
    });
    const taskIds = issues.map((issue) => issue.work?.taskId).filter((id): id is string => Boolean(id));
    if (taskIds.length === 0) {
      setError(null);
      showNotice(`${companyName}: hid ${issues.length} issue${issues.length === 1 ? "" : "s"} from this view.`);
      return;
    }
    setBusyId(taskIds[0]);
    setNotice(null);
    try {
      // Set aside = archive the underlying task(s): they leave needs-human, stop
      // showing as issues, and stop re-escalating. Reversible from the Work Board.
      const results = await Promise.all(
        taskIds.map((taskId) =>
          fetch("/api/kanban", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId, status: "archived" }),
          }).then((res) => res.ok).catch(() => false),
        ),
      );
      const ok = results.filter(Boolean).length;
      const taskless = issues.length - taskIds.length;
      if (ok === 0) {
        setError("Could not archive these issues off the board — they'll return on reload.");
      } else {
        for (const issue of issues) {
          const taskId = issue.work?.taskId;
          if (!taskId) continue;
          void postCompanyRunRecord(companyId, {
            action: "settle-proposal",
            idempotencyKey: `task-human:${taskId}`,
            status: "rejected",
            decision: "Human dismissed this issue from the company board.",
            decidedBy: "human",
            evidence: [issue.title],
          });
        }
        setError(null);
        const hidNote = taskless > 0 ? ` (${taskless} hidden locally)` : "";
        showNotice(`${companyName}: dismissed ${ok} issue${ok === 1 ? "" : "s"} — archived off the board.${hidNote}`);
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [data, refresh, showNotice]);

  const handleReviewPreview = React.useCallback(async (companyId: string, issue: Issue, decision: PreviewDecision, notes: string) => {
    const taskId = issue.work?.taskId;
    if (!taskId) {
      setError("This preview has no Work Board task to route your review to.");
      return;
    }
    const companyName = data.find((entry) => entry.company?.id === companyId)?.company?.name ?? "Company";
    const who = issue.agent || "the crew";
    setBusyId(taskId);
    setNotice(null);
    try {
      // Same `answer` rail as Mark Resolved: stamp the decision into the parked
      // task and the same agent resumes — send it, or revise and re-submit.
      const res = await fetch("/api/kanban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "answer",
          taskId,
          answer: previewReviewAnswer(issue, decision, notes, issuePreviewUrl(issue)),
          author: "dashboard",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not send your preview review to the crew.");
      } else {
        const previewUrl = issuePreviewUrl(issue);
        void postCompanyRunRecord(companyId, {
          action: "create-proposal",
          kind: "preview-review",
          status: decision === "approve" ? "applied" : "rejected",
          title: decision === "approve" ? `Preview approved: ${issue.title}` : `Preview changes requested: ${issue.title}`,
          sourceTaskId: taskId,
          idempotencyKey: `preview-review:${taskId}:${decision}:${Date.now()}`,
          risk: "medium",
          proposedChange: {
            decision,
            previewUrl,
            notes: notes.trim() || undefined,
          },
          links: previewUrl ? [{ label: "Preview", url: previewUrl }] : undefined,
          decision: decision === "approve" ? "Human approved the customer-facing preview." : "Human requested changes before customer-facing use.",
          decidedBy: "human",
          evidence: [previewReviewAnswer(issue, decision, notes, previewUrl)],
        });
        void postCompanyRunRecord(companyId, {
          action: "settle-proposal",
          idempotencyKey: `task-human:${taskId}`,
          status: "applied",
          decision: decision === "approve" ? "Preview approved and task resumed." : "Change request sent and task resumed.",
          decidedBy: "human",
        });
        setError(null);
        const soon = json.pickupScheduled ? "now" : "on the next pickup";
        showNotice(
          decision === "approve"
            ? `${companyName}: preview approved. ${who} is taking the next step ${soon}.`
            : `${companyName}: change request sent. ${who} is revising the preview ${soon}.`,
        );
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [data, refresh, showNotice]);

  const handleRecordRevenue = React.useCallback(async (companyId: string, input: CompanyRevenueShareInput): Promise<void> => {
    setBusyId(companyId);
    setNotice(null);
    try {
      const res = await fetch("/api/company-revenue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record",
          companyId,
          amountUsd: input.amountUsd,
          source: input.source,
          collectFee: input.collectFee,
          collectingAgentId: input.collectingAgentId,
          confirmation: input.collectFee ? "COLLECT_COMPANY_REVENUE_FEE" : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) {
        setError(json.error || "Could not record company revenue.");
      } else {
        setError(null);
        const record = json.record as { amountUsd?: number; fee?: { amountUsd?: number; status?: string } } | undefined;
        const amount = typeof record?.amountUsd === "number" ? `$${record.amountUsd.toFixed(2)}` : "Revenue";
        const fee = typeof record?.fee?.amountUsd === "number" ? `$${record.fee.amountUsd.toFixed(2)}` : "share";
        showNotice(record?.fee?.status === "collected"
          ? `${amount} recorded. HivemindOS share collected: ${fee}.`
          : `${amount} recorded. HivemindOS share pending: ${fee}.`);
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh, showNotice]);

  return (
    <ZeroHumanCompanies
      colonies={colonies}
      agentPool={agentPool}
      loading={loading || refreshing}
      initialLoading={loading}
      initialTasksLoading={!tasksLoaded}
      error={error ?? driverWarning}
      notice={notice}
      busyId={busyId}
      onRefresh={() => void refresh()}
      onCreateCompany={handleCreateCompany}
      onImportCompany={handleImportCompany}
      onEditCompany={handleEditCompany}
      onAddAgents={handleAddAgents}
      onDecideApproval={(_companyId, approvalId, decision, note) => void decideApproval(approvalId, decision, note)}
      onResolvePricing={(companyId, proposalId, decision) => void resolvePricing(companyId, proposalId, decision)}
      onSetApprovalPolicy={(companyId, policy) => void setApprovalPolicy(companyId, policy)}
      onFreeze={(companyId, frozen) => void handleFreeze(companyId, frozen)}
      onDelete={(companyId) => void handleDelete(companyId)}
      onDispatch={(companyId) => void handleDispatch(companyId)}
      onStopAutonomy={(companyId) => void handleStopAutonomy(companyId)}
      onResolveIssue={(companyId, issue) => void handleResolveIssue(companyId, issue)}
      onRetryIssues={(companyId, issues) => void handleRetryIssues(companyId, issues)}
      onDismissIssues={(companyId, issues) => void handleDismissIssues(companyId, issues)}
      onReviewPreview={(companyId, issue, decision, notes) => void handleReviewPreview(companyId, issue, decision, notes)}
      onRecordRevenue={handleRecordRevenue}
      openSkillAttachmentBrowser={openSkillAttachmentBrowser}
      chooseDirectoryForMachine={chooseDirectoryForMachine}
      defaultDirectoryMachine={defaultDirectoryMachine}
      theme={theme}
    />
  );
}

export function ZeroHumanCompaniesView({
  theme = "dark",
  openSkillAttachmentBrowser,
  chooseDirectoryForMachine,
  defaultDirectoryMachine,
}: {
  theme?: "dark" | "light";
  openSkillAttachmentBrowser?: SkillAttachmentBrowserOpener;
  chooseDirectoryForMachine?: DirectoryPicker;
  defaultDirectoryMachine?: KanbanMachineTarget | null;
} = {}) {
  return USE_ZHC_DEMO_DATA
    ? <ZeroHumanCompaniesDemoView theme={theme} openSkillAttachmentBrowser={openSkillAttachmentBrowser} chooseDirectoryForMachine={chooseDirectoryForMachine} defaultDirectoryMachine={defaultDirectoryMachine} />
    : <ZeroHumanCompaniesLiveView theme={theme} openSkillAttachmentBrowser={openSkillAttachmentBrowser} chooseDirectoryForMachine={chooseDirectoryForMachine} defaultDirectoryMachine={defaultDirectoryMachine} />;
}
