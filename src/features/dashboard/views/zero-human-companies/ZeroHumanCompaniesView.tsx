"use client";
// Zero Human Companies — live container.
// Fetches real app data (companies + spend rollups, pending spend approvals,
// the agent roster, and the kanban board) and maps it into the Colony view
// model. Every mutation (found company, staff crew, approve/deny, freeze,
// disband) writes back through the existing app APIs, then refreshes.
import "./theme.css";

import React from "react";
import type { Company, CompanyMember, CompanySpendRollup } from "@/lib/types/company";
import ZeroHumanCompanies from "./ZeroHumanCompanies";
import { buildColony, toPoolAgents, type AgentLite, type ApprovalRow, type KanbanTaskLite } from "./mappers";
import type { Agent, Colony, CreateForm, PoolAgent } from "./types";

type CompanyEntry = { company: Company; rollup: CompanySpendRollup };

const POLL_MS = 15_000;

async function postCompanies(body: Record<string, unknown>): Promise<{ ok: boolean; company?: Company; error?: string }> {
  const res = await fetch("/api/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: "Bad response" }));
}

export function ZeroHumanCompaniesView() {
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
      const [companiesRes, approvalsRes, agentsRes, kanbanRes] = await Promise.all([
        fetch("/api/companies", { cache: "no-store" }),
        fetch("/api/wallet/approvals?status=pending", { cache: "no-store" }),
        fetch("/api/obsidian/agents", { cache: "no-store" }),
        fetch("/api/kanban?include_boards=false", { cache: "no-store" }),
      ]);

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

      const approvalsJson = await approvalsRes.json().catch(() => ({}));
      if (approvalsJson.ok && Array.isArray(approvalsJson.approvals)) setApprovals(approvalsJson.approvals);

      const agentsJson = await agentsRes.json().catch(() => ({}));
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

      const kanbanJson = await kanbanRes.json().catch(() => ({}));
      const boardTasks = kanbanJson?.board?.tasks;
      if (Array.isArray(boardTasks)) {
        setTasks(boardTasks.map((t: Record<string, unknown>) => ({
          id: String(t.id ?? ""),
          title: typeof t.title === "string" ? t.title : "",
          status: typeof t.status === "string" ? t.status : "ideas",
          assignee: typeof t.assignee === "string" ? t.assignee : null,
          priority: typeof t.priority === "string" ? t.priority : undefined,
          skills: Array.isArray(t.skills) ? (t.skills as string[]) : undefined,
          createdAt: typeof t.createdAt === "number" ? t.createdAt : undefined,
          updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : undefined,
          completedAt: typeof t.completedAt === "number" ? t.completedAt : undefined,
        })));
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

  const handleEditCompany = React.useCallback(async (companyId: string, form: CreateForm): Promise<void> => {
    // Identity + apex-goal edit only — crew, budget, and tracked progress are
    // preserved (upsert merges; omitted fields keep their existing values).
    setBusyId(companyId);
    try {
      const existing = data.find((e) => e.company.id === companyId)?.company;
      // Always send apexGoal: when all three fields are blank the store normalizes
      // it to undefined (clears the goal); otherwise we keep the tracked
      // current/progress so editing the wording doesn't reset the metric.
      const apexGoal = {
        title: form.apexTitle || undefined,
        metric: form.apexMetric || undefined,
        target: form.apexTarget || undefined,
        unit: form.metricUnit,
        current: existing?.apexGoal?.current,
        progress: existing?.apexGoal?.progress,
      };
      const result = await postCompanies({
        action: "upsert",
        id: companyId,
        name: form.name,
        ticker: form.ticker || undefined,
        sector: form.sector || undefined,
        apexGoal,
      });
      if (!result.ok) setError(result.error || "Could not save changes.");
      else setError(null);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [data, refresh]);

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
    />
  );
}
