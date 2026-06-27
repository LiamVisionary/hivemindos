"use client";
// Zero Human Companies — live container.
// Fetches real app data (companies + spend rollups, pending spend approvals,
// the agent roster, and the kanban board) and maps it into the Colony view
// model. Every mutation (found company, staff crew, approve/deny, freeze,
// disband) writes back through the existing app APIs, then refreshes.
import "./theme.css";

import React from "react";
import type { Company, CompanyMember, CompanyRevenue, CompanySpendRollup } from "@/lib/types/company";
import ZeroHumanCompanies from "./ZeroHumanCompanies";
import {
  applyDemoEdit,
  createDemoColony,
  DEMO_AGENT_POOL,
  DEMO_COLONIES,
  DEMO_CREATE_SEED_CREW,
} from "./zhc-demo-data";
import { buildColony, toPoolAgents, type AgentLite, type ApprovalRow, type KanbanTaskLite } from "./mappers";
import type { Agent, Colony, CompanyEditForm, CompanyMemberEdit, CreateForm, GovEvent, PoolAgent } from "./types";

type CompanyEntry = { company: Company; rollup: CompanySpendRollup };

const POLL_MS = 15_000;
const USE_ZHC_DEMO_DATA = true;

async function postCompanies(body: Record<string, unknown>): Promise<{ ok: boolean; company?: Company; error?: string }> {
  const res = await fetch("/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: "Bad response" }));
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

function ZeroHumanCompaniesDemoView({ theme = "dark" }: { theme?: "dark" | "light" } = {}) {
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

  const decideApproval = React.useCallback((companyId: string, approvalId: string, decision: "approved" | "denied") => {
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
            text: `${approval.agent}'s ${approval.kind} request was ${decision}: ${approval.title}.`,
            agent: "human",
            since: "now",
          },
          ...colony.governance,
        ].slice(0, 5),
      };
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
      onEditCompany={handleEditCompany}
      onAddAgents={handleAddAgents}
      onApprove={(companyId, approvalId) => decideApproval(companyId, approvalId, "approved")}
      onReject={(companyId, approvalId) => decideApproval(companyId, approvalId, "denied")}
      onFreeze={handleFreeze}
      onDelete={(companyId) => setColonies((current) => current.filter((colony) => colony.id !== companyId))}
      onDispatch={handleDispatch}
      onStopAutonomy={handleStopAutonomy}
      theme={theme}
    />
  );
}

function ZeroHumanCompaniesLiveView({ theme = "dark" }: { theme?: "dark" | "light" } = {}) {
  const [data, setData] = React.useState<CompanyEntry[]>([]);
  const [agents, setAgents] = React.useState<AgentLite[]>([]);
  const [approvals, setApprovals] = React.useState<ApprovalRow[]>([]);
  const [tasks, setTasks] = React.useState<KanbanTaskLite[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const companiesRes = await fetch("/api/companies", { cache: "no-store" });
      const companiesJson = await companiesRes.json().catch(() => ({}));
      if (companiesJson.ok) {
        setData(Array.isArray(companiesJson.companies) ? companiesJson.companies : []);
        setError(null);
      } else if (companiesRes.status === 401) {
        setNotice(null);
        setError("Dashboard authentication required.");
      } else if (companiesJson.error) {
        setNotice(null);
        setError(companiesJson.error);
      }
      setLoading(false);

      const [approvalsResult, agentsResult, kanbanResult] = await Promise.allSettled([
        fetch("/api/wallet/approvals?status=pending", { cache: "no-store" }),
        fetch("/api/obsidian/agents", { cache: "no-store" }),
        fetch("/api/kanban?include_boards=false", { cache: "no-store" }),
      ]);

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
            assignee: typeof t.assignee === "string" ? t.assignee : null,
            priority: typeof t.priority === "string" ? t.priority : undefined,
            skills: Array.isArray(t.skills) ? (t.skills as string[]) : undefined,
            deliverables: Array.isArray(t.deliverables) ? (t.deliverables as KanbanTaskLite["deliverables"]) : undefined,
            loop: t.loop && typeof t.loop === "object" ? (t.loop as KanbanTaskLite["loop"]) : undefined,
            loopReceipts: Array.isArray(t.loopReceipts) ? (t.loopReceipts as KanbanTaskLite["loopReceipts"]) : undefined,
            createdAt: typeof t.createdAt === "number" ? t.createdAt : undefined,
            updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : undefined,
            completedAt: typeof t.completedAt === "number" ? t.completedAt : undefined,
          })));
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
        // Scope the board's tasks to this company by member id OR display name.
        const idents = new Set<string>();
        for (const id of company.agentIds ?? []) {
          idents.add(id);
          const profile = agentsById.get(id);
          if (profile?.name) idents.add(profile.name);
        }
        const companyTasks = tasks.filter((t) => t.assignee && idents.has(t.assignee));
        out.push(buildColony({
          company,
          rollup: entry.rollup ?? { companyId: company.id, memberCount: company.agentIds?.length ?? 0, dailySpentUsd: 0, monthlySpentUsd: 0, totalSpentUsd: 0, dailyRemainingUsd: null, monthlyRemainingUsd: null, totalRemainingUsd: null },
          approvals: approvalsByCompany.get(company.id) ?? [],
          agentsById,
          tasks: companyTasks,
        }));
      } catch {
        // Skip a malformed record rather than blanking the whole portfolio.
      }
    }
    return out;
  }, [data, agentsById, approvalsByCompany, tasks]);

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
      const result = await postCompanies({
        action: "upsert",
        id: companyId,
        name: form.name,
        ticker: form.ticker || undefined,
        sector: form.sector || undefined,
        charter: form.charter ?? "",
        blurb: form.blurb ?? "",
        dailyBudgetUsd: form.dailyBudgetUsd && form.dailyBudgetUsd > 0 ? form.dailyBudgetUsd : 0,
        monthlyBudgetUsd: form.monthlyBudgetUsd && form.monthlyBudgetUsd > 0 ? form.monthlyBudgetUsd : 0,
        totalBudgetUsd: form.totalBudgetUsd && form.totalBudgetUsd > 0 ? form.totalBudgetUsd : 0,
        frozen: form.frozen === true,
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

  const decideApproval = React.useCallback(async (approvalId: string, decision: "approved" | "denied") => {
    setBusyId(approvalId);
    try {
      const res = await fetch("/api/wallet/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: approvalId, decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok && json.error) setError(json.error);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

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
        setNotice(
          live > 0
            ? `Launched ${n} ${plan} task${n === 1 ? "" : "s"} to ${live} online agent${live === 1 ? "" : "s"} — autonomy is running; it keeps working until you stop it.`
            : `Queued ${n} ${plan} task${n === 1 ? "" : "s"}. Autonomy is on — work starts as soon as a member agent comes online.`,
        );
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const handleStopAutonomy = React.useCallback(async (companyId: string) => {
    setBusyId(companyId);
    setNotice(null);
    try {
      const result = await postCompanies({ action: "stop-autonomy", id: companyId });
      if (!result.ok) setError(result.error || "Could not stop autonomy.");
      else { setError(null); setNotice("Autonomy stopped — in-flight tasks finish, no new work will be dispatched."); }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  return (
    <ZeroHumanCompanies
      colonies={colonies}
      agentPool={agentPool}
      loading={loading || refreshing}
      initialLoading={loading}
      error={error}
      notice={notice}
      busyId={busyId}
      onRefresh={() => void refresh()}
      onCreateCompany={handleCreateCompany}
      onEditCompany={handleEditCompany}
      onAddAgents={handleAddAgents}
      onApprove={(_companyId, approvalId) => void decideApproval(approvalId, "approved")}
      onReject={(_companyId, approvalId) => void decideApproval(approvalId, "denied")}
      onFreeze={(companyId, frozen) => void handleFreeze(companyId, frozen)}
      onDelete={(companyId) => void handleDelete(companyId)}
      onDispatch={(companyId) => void handleDispatch(companyId)}
      onStopAutonomy={(companyId) => void handleStopAutonomy(companyId)}
      theme={theme}
    />
  );
}

export function ZeroHumanCompaniesView({ theme = "dark" }: { theme?: "dark" | "light" } = {}) {
  return USE_ZHC_DEMO_DATA ? <ZeroHumanCompaniesDemoView theme={theme} /> : <ZeroHumanCompaniesLiveView theme={theme} />;
}
