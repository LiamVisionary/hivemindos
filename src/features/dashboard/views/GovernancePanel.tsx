"use client";

import { useCallback, useEffect, useState } from "react";

import fleetStyles from "@/app/fleet.module.css";
import { Button } from "@/components/ui/button";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { Company, CompanySpendRollup } from "@/lib/types/company";
import type { SpendApprovalRequest } from "@/lib/services/wallet/spend-approvals";

const fleetClass = createStyleClass(fleetStyles);

type CompanyWithRollup = { company: Company; rollup: CompanySpendRollup };
type AgentOption = { id: string; name: string };

const cardClass = "grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4";
const rowCardClass = "grid gap-2 rounded-md border border-[rgba(148,163,184,0.12)] bg-[rgba(2,6,23,0.5)] p-3";
const inputClass = "w-full rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.55)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[rgba(94,234,212,0.4)]";
const labelClass = "mb-1 block text-[11px] uppercase tracking-[0.06em] text-[var(--muted)]";
const muted = "text-xs leading-5 text-[var(--muted)]";

function money(value: number | null | undefined): string {
  if (value == null) return "∞";
  return `$${value.toFixed(2)}`;
}

function budgetLine(label: string, spent: number, remaining: number | null): string {
  if (remaining == null) return `${label}: ${money(spent)} spent (no cap)`;
  return `${label}: ${money(spent)} spent · ${money(remaining)} left`;
}

export function GovernancePanel() {
  const [companies, setCompanies] = useState<CompanyWithRollup[]>([]);
  const [approvals, setApprovals] = useState<SpendApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [charter, setCharter] = useState("");
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  const [total, setTotal] = useState("");

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [manage, setManage] = useState<{ companyId: string; companyName: string; selected: Set<string> } | null>(null);
  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));

  const refresh = useCallback(async () => {
    try {
      const [companiesRes, approvalsRes] = await Promise.all([
        fetch("/api/companies", { cache: "no-store" }),
        fetch("/api/wallet/approvals?status=pending", { cache: "no-store" }),
      ]);
      const companiesJson = await companiesRes.json().catch(() => ({}));
      const approvalsJson = await approvalsRes.json().catch(() => ({}));
      if (companiesJson.ok) {
        setCompanies(companiesJson.companies ?? []);
        setError(null);
      } else if (companiesRes.status === 401) {
        setError("Dashboard authentication required.");
      }
      if (approvalsJson.ok) setApprovals(approvalsJson.approvals ?? []);
      const agentsRes = await fetch("/api/obsidian/agents", { cache: "no-store" });
      const agentsJson = await agentsRes.json().catch(() => ({}));
      if (agentsJson.ok && Array.isArray(agentsJson.agents)) {
        setAgents(agentsJson.agents.map((a: { id: string; name?: string }) => ({ id: a.id, name: a.name || a.id })));
      }
    } catch {
      setError("Could not reach the governance API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  const postCompany = useCallback(async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok && json.error) setError(json.error);
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const createCompany = useCallback(async () => {
    if (!name.trim()) return;
    await postCompany({
      action: "upsert",
      name: name.trim(),
      charter: charter.trim() || undefined,
      dailyBudgetUsd: Number(daily) || 0,
      monthlyBudgetUsd: Number(monthly) || 0,
      totalBudgetUsd: Number(total) || 0,
    }, "create");
    setName(""); setCharter(""); setDaily(""); setMonthly(""); setTotal("");
  }, [name, charter, daily, monthly, total, postCompany]);

  const openManage = useCallback((company: Company) => {
    setManage({ companyId: company.id, companyName: company.name, selected: new Set(company.agentIds ?? []) });
  }, []);

  const toggleManaged = useCallback((agentId: string) => {
    setManage((current) => {
      if (!current) return current;
      const selected = new Set(current.selected);
      if (selected.has(agentId)) selected.delete(agentId);
      else selected.add(agentId);
      return { ...current, selected };
    });
  }, []);

  const saveManaged = useCallback(async () => {
    if (!manage) return;
    await postCompany({ action: "set-agents", id: manage.companyId, agentIds: [...manage.selected] }, manage.companyId);
    setManage(null);
  }, [manage, postCompany]);

  const decide = useCallback(async (id: string, decision: "approved" | "denied") => {
    setBusy(id);
    try {
      await fetch("/api/wallet/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return (
    <section className={fleetClass("taskPanel", "tabPanel")}>
      <div className={fleetClass("taskPanelHeader")}>
        <div>
          <p className="eyebrow">Zero Human Company</p>
          <h2>Companies, budgets &amp; approvals</h2>
          <p>Companies group agents under one budget and a kill switch. Approvals are spends paused for your sign-off.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => void refresh()}>Refresh</Button>
      </div>

      <div className="mt-4 grid gap-4">
        {error ? <p className="text-xs text-[var(--rose-2,#fb7185)]">{error}</p> : null}

        {/* Approvals inbox */}
        <div className={cardClass}>
          <p className="eyebrow">Pending approvals ({approvals.length})</p>
          {loading ? <p className={muted}>Loading…</p> : null}
          {!loading && approvals.length === 0 ? <p className={muted}>No spends are waiting for approval.</p> : null}
          {approvals.map((approval) => (
            <div key={approval.id} className={`${rowCardClass} md:flex md:items-start md:justify-between`}>
              <div className="grid gap-0.5">
                <strong className="text-sm text-[var(--foreground)]">
                  {money(approval.amountUsd)} {approval.asset} · {approval.kind}
                </strong>
                <span className={muted}>{approval.agentName ?? approval.agentId}{approval.target ? ` → ${approval.target}` : ""}</span>
                <span className={muted}>{approval.reason}</span>
              </div>
              <div className="mt-2 flex gap-2 md:mt-0">
                <Button size="sm" disabled={busy === approval.id} onClick={() => void decide(approval.id, "approved")}>Approve</Button>
                <Button variant="outline" size="sm" disabled={busy === approval.id} onClick={() => void decide(approval.id, "denied")}>Deny</Button>
              </div>
            </div>
          ))}
        </div>

        {/* Companies */}
        <div className={cardClass}>
          <p className="eyebrow">Companies ({companies.length})</p>
          {!loading && companies.length === 0 ? (
            <p className={muted}>No companies yet. Create one below, then use &ldquo;Manage agents&rdquo; to staff it.</p>
          ) : null}
          {companies.map(({ company, rollup }) => (
            <div key={company.id} className={`${rowCardClass} md:flex md:items-start md:justify-between`}>
              <div className="grid gap-0.5">
                <strong className="text-sm text-[var(--foreground)]">
                  {company.name}
                  {company.frozen ? <span className="ml-2 text-[var(--rose-2,#fb7185)]">❄️ FROZEN</span> : null}
                </strong>
                <span className={muted}>
                  {rollup.memberCount} agent{rollup.memberCount === 1 ? "" : "s"}
                  {company.agentIds?.length ? `: ${company.agentIds.map((id) => agentNameById.get(id) ?? id).join(", ")}` : ""}
                </span>
                {company.charter ? <span className={muted}>{company.charter}</span> : null}
                <span className={muted}>{budgetLine("Daily", rollup.dailySpentUsd, rollup.dailyRemainingUsd)}</span>
                <span className={muted}>{budgetLine("Monthly", rollup.monthlySpentUsd, rollup.monthlyRemainingUsd)}</span>
                <span className={muted}>{budgetLine("Total", rollup.totalSpentUsd, rollup.totalRemainingUsd)}</span>
              </div>
              <div className="mt-2 flex gap-2 md:mt-0">
                <Button variant="secondary" size="sm" disabled={busy === company.id} onClick={() => openManage(company)}>Manage agents</Button>
                <Button
                  variant={company.frozen ? "default" : "destructive"}
                  size="sm"
                  disabled={busy === company.id}
                  onClick={() => void postCompany({ action: company.frozen ? "unfreeze" : "freeze", id: company.id }, company.id)}
                >
                  {company.frozen ? "Unfreeze" : "Freeze"}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy === company.id} onClick={() => void postCompany({ action: "delete", id: company.id }, company.id)}>Delete</Button>
              </div>
            </div>
          ))}

          {/* New company form */}
          <div className={rowCardClass}>
            <strong className="text-sm text-[var(--foreground)]">New company</strong>
            <div>
              <label className={labelClass} htmlFor="company-name">Name</label>
              <input id="company-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support Desk Co" />
            </div>
            <div>
              <label className={labelClass} htmlFor="company-charter">Charter (optional)</label>
              <input id="company-charter" className={inputClass} value={charter} onChange={(e) => setCharter(e.target.value)} placeholder="What this company is for" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="company-daily">Daily budget</label>
                <input id="company-daily" className={inputClass} type="number" min="0" step="0.01" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelClass} htmlFor="company-monthly">Monthly budget</label>
                <input id="company-monthly" className={inputClass} type="number" min="0" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelClass} htmlFor="company-total">Total budget</label>
                <input id="company-total" className={inputClass} type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <Button size="sm" disabled={!name.trim() || busy === "create"} onClick={() => void createCompany()}>
                {busy === "create" ? "Creating…" : "Create company"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Manage agents modal */}
      {manage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setManage(null)}
        >
          <div
            className="grid max-h-[80vh] w-full max-w-lg gap-3 overflow-hidden rounded-lg border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.98)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="eyebrow">Manage agents</p>
              <h3 className="text-base font-semibold text-[var(--foreground)]">{manage.companyName}</h3>
              <p className={muted}>Pick which agents belong to this company. Their spend rolls up to its budget and kill switch.</p>
            </div>
            <div className="grid max-h-[48vh] gap-2 overflow-y-auto pr-1">
              {agents.length === 0 ? <p className={muted}>No agents found.</p> : null}
              {agents.map((agent) => {
                const checked = manage.selected.has(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleManaged(agent.id)}
                    className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition ${checked ? "border-[rgba(94,234,212,0.45)] bg-[rgba(20,184,166,0.10)]" : "border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.5)] hover:border-[rgba(94,234,212,0.3)]"}`}
                  >
                    <span className="grid gap-0.5">
                      <strong className="text-sm text-[var(--foreground)]">{agent.name}</strong>
                      <span className="font-mono text-[10px] text-[var(--muted)]">{agent.id}</span>
                    </span>
                    <span className={`text-sm ${checked ? "text-[var(--accent-strong)]" : "text-[var(--muted)]"}`}>{checked ? "✓ Member" : "Add"}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-[rgba(148,163,184,0.12)] pt-3">
              <span className={muted}>{manage.selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setManage(null)}>Cancel</Button>
                <Button size="sm" disabled={busy === manage.companyId} onClick={() => void saveManaged()}>
                  {busy === manage.companyId ? "Saving…" : "Save members"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
