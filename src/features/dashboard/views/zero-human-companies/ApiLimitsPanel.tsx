"use client";

import React from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { Panel, Skeleton, Spinner } from "./primitives";
import type { CompanyApiBudget, CompanyIntegrationLimit, GcpApiDailyCap } from "@/lib/types/company";
import { companyApiBudgetScopeKey } from "@/lib/services/company-api-budget";
import type { ConnectionProviderKey } from "@/lib/types/integrations";
import styles from "./api-limits.module.css";

type ConnectorSummary = {
  key: ConnectionProviderKey;
  label: string;
  detail: string;
  operations: Array<{ id: string; label: string; description: string }>;
};

type UsageRecord = {
  id: string;
  providerKey: ConnectionProviderKey;
  operationId?: string;
  requestCount: number;
  amountUsd: number;
  status: "reserved" | "observed";
  source: string;
  createdAt: string;
};

type UsageSnapshot = {
  dailyRequests: number;
  monthlyRequests: number;
  dailySpendUsd: number;
  monthlySpendUsd: number;
  series: Array<{ date: string; requests: number; spendUsd: number }>;
  byProvider: Array<{
    providerKey: ConnectionProviderKey;
    dailyRequests: number;
    monthlyRequests: number;
    dailySpendUsd: number;
    monthlySpendUsd: number;
    dailyRequestLimit?: number;
    monthlyRequestLimit?: number;
    dailySpendLimitUsd?: number;
    monthlySpendLimitUsd?: number;
  }>;
  recent: UsageRecord[];
};

type GcpProject = { projectId: string; projectNumber: string; name: string; lifecycleState?: string };
type GcpBillingAccount = { name: string; displayName: string; open: boolean };
type GcpService = { name: string; title: string };
type GcpMetric = { metric: string; displayName?: string; unit: string; limitName: string; effectiveValue?: number | null };
type GcpBillingInfo = { projectId: string; billingAccountName: string; billingEnabled: boolean };

type LimitsPayload = {
  ok: boolean;
  error?: string;
  connected: boolean;
  apiBudgets: CompanyApiBudget[];
  integrationLimits: CompanyIntegrationLimit[];
  usage: UsageSnapshot;
  connectors: ConnectorSummary[];
  projects: GcpProject[];
  billingAccounts: GcpBillingAccount[];
  enabledServices: GcpService[];
  billingInfo: GcpBillingInfo | null;
  metrics: GcpMetric[];
  discoveryErrors: string[];
};

type MetricDraft = GcpMetric & { enabled: boolean; value: string; skuUnitCostUsd: string; freeMonthlyCalls: string };
type ChartMode = "requests" | "spend";

const EMPTY_USAGE: UsageSnapshot = {
  dailyRequests: 0,
  monthlyRequests: 0,
  dailySpendUsd: 0,
  monthlySpendUsd: 0,
  series: [],
  byProvider: [],
  recent: [],
};

function usd(value: number, digits = 2): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits });
}

function integer(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

async function responseJson<T>(response: Response): Promise<T & { ok?: boolean; error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function chartPoints(values: number[], width: number, height: number, pad: number): string {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((value, index) => `${(pad + index * step).toFixed(1)},${(height - pad - (value / max) * (height - pad * 2)).toFixed(1)}`)
    .join(" ");
}

function UsageChart({ series }: { series: UsageSnapshot["series"] }) {
  const [mode, setMode] = React.useState<ChartMode>("requests");
  const width = 760;
  const height = 178;
  const pad = 10;
  const values = series.map((point) => mode === "requests" ? point.requests : point.spendUsd);
  const points = chartPoints(values, width, height, pad);
  const area = `${pad},${height - pad} ${points} ${width - pad},${height - pad}`;
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <Panel>
      <div className={styles.chartShell}>
        <div className={styles.chartHeader}>
          <div>
            <h3 className={styles.sectionTitle}>30-day usage</h3>
            <p className={styles.sectionCopy}>{mode === "requests" ? `${integer(total)} reserved or observed calls` : `${usd(total, 4)} reserved or observed spend`}</p>
          </div>
          <div className={styles.segmented} aria-label="Chart metric">
            <button type="button" className={`${styles.segment} ${mode === "requests" ? styles.segmentActive : ""}`} onClick={() => setMode("requests")}>Requests</button>
            <button type="button" className={`${styles.segment} ${mode === "spend" ? styles.segmentActive : ""}`} onClick={() => setMode("spend")}>Spend</button>
          </div>
        </div>
        {series.length ? (
          <>
            <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Daily ${mode} for the last 30 UTC days`} preserveAspectRatio="none">
              {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={height * ratio} y2={height * ratio} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
              <defs>
                <linearGradient id={`api-limit-${mode}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={mode === "requests" ? "var(--live)" : "var(--honey-2)"} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={mode === "requests" ? "var(--live)" : "var(--honey-2)"} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={area} fill={`url(#api-limit-${mode})`} />
              <polyline points={points} fill="none" stroke={mode === "requests" ? "var(--live)" : "var(--honey-2)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {series.map((point, index) => {
                const max = Math.max(1, ...values);
                const x = pad + index * ((width - pad * 2) / Math.max(1, series.length - 1));
                const y = height - pad - (values[index] / max) * (height - pad * 2);
                return <circle key={point.date} cx={x} cy={y} r="4" fill="transparent"><title>{formatDate(point.date)}: {mode === "requests" ? integer(point.requests) : usd(point.spendUsd, 4)}</title></circle>;
              })}
            </svg>
            <div className={styles.axisLabels}>
              <span>{formatDate(series[0].date)}</span>
              <span>{formatDate(series[Math.floor(series.length / 2)].date)}</span>
              <span>{formatDate(series[series.length - 1].date)}</span>
            </div>
          </>
        ) : <div className={styles.empty}>Usage will appear after the company reserves or reports its first integration call.</div>}
      </div>
    </Panel>
  );
}

function saturation(row: UsageSnapshot["byProvider"][number]): { pct: number; label: string } {
  const ratios = [
    row.dailyRequestLimit ? { pct: row.dailyRequests / row.dailyRequestLimit * 100, label: `${integer(row.dailyRequests)} / ${integer(row.dailyRequestLimit)} calls today` } : null,
    row.monthlyRequestLimit ? { pct: row.monthlyRequests / row.monthlyRequestLimit * 100, label: `${integer(row.monthlyRequests)} / ${integer(row.monthlyRequestLimit)} calls this month` } : null,
    row.dailySpendLimitUsd ? { pct: row.dailySpendUsd / row.dailySpendLimitUsd * 100, label: `${usd(row.dailySpendUsd, 4)} / ${usd(row.dailySpendLimitUsd)} today` } : null,
    row.monthlySpendLimitUsd ? { pct: row.monthlySpendUsd / row.monthlySpendLimitUsd * 100, label: `${usd(row.monthlySpendUsd, 4)} / ${usd(row.monthlySpendLimitUsd)} this month` } : null,
  ].filter((value): value is { pct: number; label: string } => Boolean(value));
  return ratios.sort((a, b) => b.pct - a.pct)[0] ?? { pct: 0, label: `${integer(row.monthlyRequests)} calls · ${usd(row.monthlySpendUsd, 4)} this month` };
}

function ProviderBreakdown({ usage, connectors }: { usage: UsageSnapshot; connectors: ConnectorSummary[] }) {
  const names = new Map(connectors.map((connector) => [connector.key, connector.label]));
  return (
    <Panel>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.sectionTitle}>Provider saturation</h3>
          <p className={styles.sectionCopy}>The closest provider-wide cap determines each bar.</p>
        </div>
      </div>
      <div className={styles.providerList}>
        {usage.byProvider.length ? usage.byProvider.map((row) => {
          const used = saturation(row);
          const tone = used.pct >= 90 ? "var(--danger)" : used.pct >= 70 ? "var(--honey)" : "var(--live)";
          return (
            <div key={row.providerKey} className={styles.providerRow}>
              <div className={styles.rowHead}>
                <div>
                  <div className={styles.rowTitle}>{names.get(row.providerKey) ?? row.providerKey}</div>
                  <div className={styles.rowMeta}>{used.label}</div>
                </div>
                <div className={styles.rowValue}>{used.pct > 0 ? `${Math.min(999, Math.round(used.pct))}%` : "uncapped"}</div>
              </div>
              <div className={styles.track}><div className={styles.trackFill} style={{ width: `${Math.min(100, used.pct)}%`, background: tone }} /></div>
            </div>
          );
        }) : <div className={styles.empty}>No provider usage or local limits yet.</div>}
      </div>
    </Panel>
  );
}

function RecentUsage({ usage, connectors }: { usage: UsageSnapshot; connectors: ConnectorSummary[] }) {
  const names = new Map(connectors.map((connector) => [connector.key, connector.label]));
  return (
    <Panel>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.sectionTitle}>Recent usage</h3>
          <p className={styles.sectionCopy}>Preflight reservations and observations reported by external meters.</p>
        </div>
      </div>
      <div className={styles.recentList}>
        {usage.recent.length ? usage.recent.slice(0, 8).map((record) => (
          <div key={record.id} className={styles.recentRow}>
            <div className={styles.recentIdentity}>
              <span className={`${styles.usageDot} ${record.status === "observed" ? styles.usageObserved : styles.usageReserved}`} aria-hidden="true" />
              <div>
                <div className={styles.rowTitle}>{names.get(record.providerKey) ?? record.providerKey} · {record.operationId ?? "all operations"}</div>
                <div className={styles.rowMeta}>{record.status === "observed" ? "Observed" : "Reserved"} by {record.source} · {new Date(record.createdAt).toLocaleString()}</div>
              </div>
            </div>
            <div className={styles.recentTotals}>
              <span>{integer(record.requestCount)} request{record.requestCount === 1 ? "" : "s"}</span>
              <span>{usd(record.amountUsd, 4)}</span>
            </div>
          </div>
        )) : <div className={styles.empty}>No usage has been reserved or reported for this company yet.</div>}
      </div>
    </Panel>
  );
}

function valueOrEmpty(value?: number): string {
  return value === undefined ? "" : String(value);
}

function IntegrationLimitsEditor({ companyId, data, onReload }: { companyId: string; data: LimitsPayload; onReload: () => Promise<unknown> }) {
  const firstProvider = data.connectors[0]?.key ?? "google-cloud";
  const [editingId, setEditingId] = React.useState("");
  const [providerKey, setProviderKey] = React.useState<ConnectionProviderKey>(firstProvider);
  const [operationId, setOperationId] = React.useState("");
  const [dailyRequests, setDailyRequests] = React.useState("");
  const [monthlyRequests, setMonthlyRequests] = React.useState("");
  const [dailySpend, setDailySpend] = React.useState("");
  const [monthlySpend, setMonthlySpend] = React.useState("");
  const [mutation, setMutation] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [messageError, setMessageError] = React.useState(false);
  const connector = data.connectors.find((entry) => entry.key === providerKey) ?? data.connectors[0];

  function clearEditor() {
    setEditingId("");
    setOperationId("");
    setDailyRequests("");
    setMonthlyRequests("");
    setDailySpend("");
    setMonthlySpend("");
    setMessage("");
    setMessageError(false);
  }

  function edit(limit: CompanyIntegrationLimit) {
    setEditingId(limit.id);
    setProviderKey(limit.providerKey);
    setOperationId(limit.operationId ?? "");
    setDailyRequests(valueOrEmpty(limit.dailyRequestLimit));
    setMonthlyRequests(valueOrEmpty(limit.monthlyRequestLimit));
    setDailySpend(valueOrEmpty(limit.dailySpendLimitUsd));
    setMonthlySpend(valueOrEmpty(limit.monthlySpendLimitUsd));
    setMessage("");
    setMessageError(false);
  }

  async function save() {
    setMutation("save");
    setMessage("");
    setMessageError(false);
    try {
      const numeric = (value: string) => value.trim() ? Number(value) : undefined;
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-integration-limit",
          id: companyId,
          integrationLimit: {
            id: editingId || undefined,
            providerKey,
            operationId: operationId || undefined,
            dailyRequestLimit: numeric(dailyRequests),
            monthlyRequestLimit: numeric(monthlyRequests),
            dailySpendLimitUsd: numeric(dailySpend),
            monthlySpendLimitUsd: numeric(monthlySpend),
          },
        }),
      });
      const payload = await responseJson<Record<string, unknown>>(response);
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not save the integration limit.");
      clearEditor();
      setMessage("Integration limit saved. Company-aware calls will reserve against it before execution.");
      await onReload();
    } catch (reason) {
      setMessageError(true);
      setMessage(reason instanceof Error ? reason.message : "Could not save the integration limit.");
    } finally {
      setMutation("");
    }
  }

  async function remove(limitId: string) {
    setMutation(`remove:${limitId}`);
    setMessage("");
    setMessageError(false);
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove-integration-limit", id: companyId, limitId }),
      });
      const payload = await responseJson<Record<string, unknown>>(response);
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not remove the integration limit.");
      if (editingId === limitId) clearEditor();
      setMessage("Integration limit removed. Historical usage remains available in the chart.");
      await onReload();
    } catch (reason) {
      setMessageError(true);
      setMessage(reason instanceof Error ? reason.message : "Could not remove the integration limit.");
    } finally {
      setMutation("");
    }
  }

  const names = new Map(data.connectors.map((entry) => [entry.key, entry.label]));
  const operationNames = new Map(data.connectors.flatMap((entry) => entry.operations.map((operation) => [`${entry.key}:${operation.id}`, operation.label] as const)));

  return (
    <Panel>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.sectionTitle}>Local integration preflight limits</h3>
          <p className={styles.sectionCopy}>Provider-wide and operation-specific rows stack. Every applicable row must allow the reservation.</p>
        </div>
        {editingId ? <button type="button" className={styles.button} onClick={clearEditor}>New limit</button> : null}
      </div>
      <div className={styles.editorGrid}>
        <label className={styles.field}>
          <span className={styles.label}>Provider</span>
          <select className={styles.select} value={providerKey} onChange={(event) => { setProviderKey(event.target.value as ConnectionProviderKey); setOperationId(""); setEditingId(""); }}>
            {data.connectors.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Scope</span>
          <select className={styles.select} value={operationId} onChange={(event) => { setOperationId(event.target.value); setEditingId(""); }}>
            <option value="">All {connector?.label ?? "provider"} operations</option>
            {(connector?.operations ?? []).map((operation) => <option key={operation.id} value={operation.id}>{operation.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Daily requests</span>
          <input className={styles.input} type="number" min="1" step="1" inputMode="numeric" value={dailyRequests} onChange={(event) => setDailyRequests(event.target.value)} placeholder="Unlimited" />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Monthly requests</span>
          <input className={styles.input} type="number" min="1" step="1" inputMode="numeric" value={monthlyRequests} onChange={(event) => setMonthlyRequests(event.target.value)} placeholder="Unlimited" />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Daily spend · USD</span>
          <input className={styles.input} type="number" min="0.0001" step="0.01" inputMode="decimal" value={dailySpend} onChange={(event) => setDailySpend(event.target.value)} placeholder="Unlimited" />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Monthly spend · USD</span>
          <input className={styles.input} type="number" min="0.0001" step="0.01" inputMode="decimal" value={monthlySpend} onChange={(event) => setMonthlySpend(event.target.value)} placeholder="Unlimited" />
        </label>
      </div>
      <div className={styles.buttonRow} style={{ marginTop: 13 }}>
        <button type="button" className={styles.buttonPrimary} disabled={mutation === "save" || !data.connectors.length} onClick={() => void save()}>
          {mutation === "save" ? <Spinner size={11} /> : <ShieldCheck size={13} />} {editingId ? "Update limit" : "Save limit"}
        </button>
        <span className={styles.sectionCopy}>Leave a field blank to keep that dimension unlimited.</span>
      </div>
      {message ? <div className={messageError ? styles.error : styles.note} style={{ marginTop: 12 }}>{message}</div> : null}
      <div className={styles.divider} />
      <div className={styles.savedList}>
        {data.integrationLimits.length ? data.integrationLimits.map((limit) => (
          <div key={limit.id} className={styles.savedRow}>
            <div className={styles.rowHead}>
              <div>
                <div className={styles.rowTitle}>{names.get(limit.providerKey) ?? limit.providerKey} · {limit.operationId ? operationNames.get(`${limit.providerKey}:${limit.operationId}`) ?? limit.operationId : "all operations"}</div>
                <div className={styles.rowMeta}>{[
                  limit.dailyRequestLimit ? `${integer(limit.dailyRequestLimit)}/day` : null,
                  limit.monthlyRequestLimit ? `${integer(limit.monthlyRequestLimit)}/month` : null,
                  limit.dailySpendLimitUsd ? `${usd(limit.dailySpendLimitUsd)}/day` : null,
                  limit.monthlySpendLimitUsd ? `${usd(limit.monthlySpendLimitUsd)}/month` : null,
                ].filter(Boolean).join(" · ")}</div>
              </div>
              <div className={styles.buttonRow}>
                <button type="button" className={styles.button} onClick={() => edit(limit)}>Edit</button>
                <button type="button" className={styles.buttonDanger} disabled={mutation === `remove:${limit.id}`} onClick={() => void remove(limit.id)} aria-label={`Remove ${names.get(limit.providerKey) ?? limit.providerKey} limit`}>
                  {mutation === `remove:${limit.id}` ? <Spinner size={11} /> : <Trash2 size={12} />} Remove
                </button>
              </div>
            </div>
          </div>
        )) : <div className={styles.empty}>No local integration limits. Add a provider-wide ceiling or target one operation.</div>}
      </div>
    </Panel>
  );
}

function budgetForScope(payload: LimitsPayload, projectRef: string, service: string): CompanyApiBudget | undefined {
  return payload.apiBudgets.find(
    (budget) => budget.provider === "gcp" && budget.service === service &&
      (budget.projectId === projectRef || budget.projectNumber === projectRef),
  );
}

function metricDrafts(payload: LimitsPayload, projectRef: string, service: string): MetricDraft[] {
  const saved = budgetForScope(payload, projectRef, service);
  const savedByMetric = new Map((saved?.dailyCaps ?? []).map((cap) => [cap.metric, cap]));
  return payload.metrics.map((metric) => {
    const cap = savedByMetric.get(metric.metric);
    return {
      ...metric,
      enabled: Boolean(cap),
      value: cap ? String(cap.value) : "",
      skuUnitCostUsd: cap?.skuUnitCostUsd === undefined ? "" : String(cap.skuUnitCostUsd),
      freeMonthlyCalls: cap?.freeMonthlyCalls === undefined ? "" : String(cap.freeMonthlyCalls),
    };
  });
}

function GcpGuardrailEditor({ companyId, data, onReload }: { companyId: string; data: LimitsPayload; onReload: (projectId?: string, service?: string) => Promise<LimitsPayload> }) {
  const [projectId, setProjectId] = React.useState("");
  const [projectNumber, setProjectNumber] = React.useState("");
  const [service, setService] = React.useState("");
  const [billingAccount, setBillingAccount] = React.useState("");
  const [monthlyCeiling, setMonthlyCeiling] = React.useState("");
  const [drafts, setDrafts] = React.useState<MetricDraft[]>([]);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [messageError, setMessageError] = React.useState(false);
  const [raisedFields, setRaisedFields] = React.useState<string[]>([]);

  function seed(payload: LimitsPayload, selectedProject: string, selectedService: string) {
    const saved = budgetForScope(payload, selectedProject, selectedService);
    setDrafts(metricDrafts(payload, selectedProject, selectedService));
    setMonthlyCeiling(saved ? String(saved.monthlyCeilingUsd) : "");
    setBillingAccount(saved?.billingAccount || payload.billingInfo?.billingAccountName || payload.billingAccounts.find((account) => account.open)?.name || "");
  }

  async function discover(nextProject: string, nextService = "") {
    setBusy("discover");
    setMessage("");
    setMessageError(false);
    try {
      const payload = await onReload(nextProject, nextService);
      if (nextService) seed(payload, nextProject, nextService);
      else {
        setDrafts([]);
        setBillingAccount(payload.billingInfo?.billingAccountName || payload.billingAccounts.find((account) => account.open)?.name || "");
      }
    } catch (reason) {
      setMessageError(true);
      setMessage(reason instanceof Error ? reason.message : "Google Cloud discovery failed.");
    } finally {
      setBusy("");
    }
  }

  function selectProject(nextId: string) {
    const project = data.projects.find((entry) => entry.projectId === nextId);
    setProjectId(nextId);
    setProjectNumber(project?.projectNumber ?? "");
    setService("");
    setMonthlyCeiling("");
    setDrafts([]);
    setRaisedFields([]);
    if (nextId) void discover(nextId);
  }

  function selectService(nextService: string) {
    setService(nextService);
    setRaisedFields([]);
    if (projectId && nextService) void discover(projectId, nextService);
    else setDrafts([]);
  }

  function editSaved(budget: CompanyApiBudget) {
    setProjectId(budget.projectId);
    setProjectNumber(budget.projectNumber);
    setService(budget.service);
    setBillingAccount(budget.billingAccount);
    setMonthlyCeiling(String(budget.monthlyCeilingUsd));
    setRaisedFields([]);
    void discover(budget.projectId || budget.projectNumber, budget.service);
  }

  function updateDraft(metric: string, patch: Partial<MetricDraft>) {
    setDrafts((current) => current.map((draft) => draft.metric === metric ? { ...draft, ...patch } : draft));
  }

  const enabledDrafts = drafts.filter((draft) => draft.enabled);
  const worstCase = enabledDrafts.reduce((sum, draft) => {
    const daily = Number(draft.value);
    const cost = Number(draft.skuUnitCostUsd);
    const free = Number(draft.freeMonthlyCalls) || 0;
    if (!Number.isFinite(daily) || daily < 0 || !Number.isFinite(cost) || cost < 0) return sum;
    return sum + Math.max(0, daily * 30 - free) * cost;
  }, 0);
  const pricedCaps = enabledDrafts.filter((draft) => draft.skuUnitCostUsd.trim()).length;

  async function apply(confirmRaise = false) {
    setBusy(confirmRaise ? "confirm" : "apply");
    setMessage("");
    setMessageError(false);
    try {
      if (!projectId || !service || !billingAccount) throw new Error("Choose a project, enabled API, and billing account.");
      const monthlyCeilingUsd = Number(monthlyCeiling);
      if (!Number.isFinite(monthlyCeilingUsd) || monthlyCeilingUsd <= 0) throw new Error("Set a positive monthly billing budget.");
      if (!enabledDrafts.length) throw new Error("Select at least one provider-enforced daily quota cap.");
      const dailyCaps: GcpApiDailyCap[] = enabledDrafts.map((draft) => {
        const value = Number(draft.value);
        if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) throw new Error(`${draft.displayName || draft.metric} needs a non-negative whole-number daily cap.`);
        const cap: GcpApiDailyCap = { metric: draft.metric, unit: draft.unit, value };
        if (draft.skuUnitCostUsd.trim()) {
          const cost = Number(draft.skuUnitCostUsd);
          if (!Number.isFinite(cost) || cost < 0) throw new Error(`${draft.displayName || draft.metric} has an invalid unit cost.`);
          cap.skuUnitCostUsd = cost;
        }
        if (draft.freeMonthlyCalls.trim()) {
          const free = Number(draft.freeMonthlyCalls);
          if (!Number.isFinite(free) || free < 0 || !Number.isInteger(free)) throw new Error(`${draft.displayName || draft.metric} has an invalid free monthly allowance.`);
          cap.freeMonthlyCalls = free;
        }
        return cap;
      });
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/api-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gcp", projectId, projectNumber, service, billingAccount, monthlyCeilingUsd, dailyCaps, confirmRaise }),
      });
      const payload = await responseJson<{ apply?: { errors?: string[] }; raisedFields?: string[]; requiresConfirmRaise?: boolean }>(response);
      if (response.status === 409 && payload.requiresConfirmRaise) {
        setRaisedFields(payload.raisedFields ?? []);
        setMessageError(false);
        setMessage("This edit raises an existing guardrail. Review the increases, then confirm explicitly.");
        return;
      }
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not apply the Google Cloud guardrail.");
      setRaisedFields([]);
      const applyErrors = payload.apply?.errors ?? [];
      setMessageError(applyErrors.length > 0);
      setMessage(applyErrors.length > 0 ? `Saved locally, but Google reported: ${applyErrors.join("; ")}` : "Daily quotas and the monthly billing budget were applied to Google Cloud.");
      const refreshed = await onReload(projectId, service);
      seed(refreshed, projectId, service);
    } catch (reason) {
      setMessageError(true);
      setMessage(reason instanceof Error ? reason.message : "Could not apply the Google Cloud guardrail.");
    } finally {
      setBusy("");
    }
  }

  return (
    <Panel>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.sectionTitle}>Google Cloud provider guardrails</h3>
          <p className={styles.sectionCopy}>Daily consumer-quota overrides throttle at Google. Monthly Cloud Billing budgets alert at 50%, 90%, and 100%; Google budgets do not hard-stop billing.</p>
        </div>
        <span className={`${styles.pill} ${data.connected ? styles.pillLive : styles.pillWarn}`}>{data.connected ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{data.connected ? "OAuth ready" : "Connect in Integrations"}</span>
      </div>

      {data.apiBudgets.length ? (
        <div className={styles.savedList} style={{ marginBottom: 16 }}>
          {data.apiBudgets.map((budget) => (
            <div key={companyApiBudgetScopeKey(budget)} className={styles.savedRow}>
              <div className={styles.rowHead}>
                <div>
                  <div className={styles.rowTitle}>{budget.service}</div>
                  <div className={styles.rowMeta}>{budget.projectId} · {budget.dailyCaps.length} daily caps · {usd(budget.monthlyCeilingUsd)}/month alerts</div>
                  <div className={styles.rowMeta} style={{ color: budget.appliedError ? "var(--danger)" : budget.appliedAt ? "var(--live)" : "var(--honey)" }}>{budget.appliedError || (budget.appliedAt ? `Applied ${new Date(budget.appliedAt).toLocaleString()}` : "Saved, not yet applied")}</div>
                </div>
                <button type="button" className={styles.button} disabled={!data.connected} onClick={() => editSaved(budget)}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!data.connected ? <div className={styles.note}>Connect Google Cloud from the Integrations view to discover projects, enabled APIs, quota metrics, and linked billing accounts. Saved provider-side guardrails remain listed above.</div> : (
        <>
          <div className={styles.editorGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Google Cloud project</span>
              <select className={styles.select} value={projectId} onChange={(event) => selectProject(event.target.value)}>
                <option value="">Choose a project</option>
                {projectId && !data.projects.some((project) => project.projectId === projectId) ? <option value={projectId}>{projectId} · saved project</option> : null}
                {data.projects.filter((project) => !project.lifecycleState || project.lifecycleState === "ACTIVE").map((project) => <option key={project.projectId} value={project.projectId}>{project.name} · {project.projectId}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Enabled API</span>
              <select className={styles.select} value={service} disabled={!projectId || busy === "discover"} onChange={(event) => selectService(event.target.value)}>
                <option value="">Choose an enabled API</option>
                {service && !data.enabledServices.some((entry) => entry.name === service) ? <option value={service}>{service} · saved API</option> : null}
                {data.enabledServices.map((entry) => <option key={entry.name} value={entry.name}>{entry.title} · {entry.name}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Linked billing account</span>
              <select className={styles.select} value={billingAccount} disabled={!projectId} onChange={(event) => setBillingAccount(event.target.value)}>
                <option value="">Choose a billing account</option>
                {billingAccount && !data.billingAccounts.some((account) => account.name === billingAccount) ? <option value={billingAccount}>{billingAccount} · saved account</option> : null}
                {data.billingAccounts.map((account) => <option key={account.name} value={account.name}>{account.displayName} · {account.open ? "open" : "closed"}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Monthly alert budget · USD</span>
              <input className={styles.input} type="number" min="1" step="1" inputMode="decimal" value={monthlyCeiling} onChange={(event) => setMonthlyCeiling(event.target.value)} placeholder="50" />
            </label>
          </div>

          {busy === "discover" ? <div className={styles.note} style={{ marginTop: 13 }}><Spinner size={11} /> Discovering provider configuration…</div> : null}
          {data.discoveryErrors.length ? <div className={styles.error} style={{ marginTop: 13 }}>{data.discoveryErrors.join(" · ")}</div> : null}
          {service && !busy && drafts.length === 0 ? <div className={styles.empty} style={{ marginTop: 13 }}>Google reported no overridable per-day quota metrics for this API.</div> : null}

          {drafts.length ? (
            <>
              <div className={styles.divider} />
              <div className={styles.metricList}>
                {drafts.map((draft) => (
                  <div key={draft.metric} className={styles.metricRow}>
                    <label className={styles.checkLabel}>
                      <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft(draft.metric, { enabled: event.target.checked })} />
                      <span>
                        <span className={styles.rowTitle}>{draft.displayName || draft.metric}</span>
                        <span className={styles.rowMeta} style={{ display: "block" }}>{draft.metric} · {draft.unit}{draft.effectiveValue != null ? ` · current effective ${integer(draft.effectiveValue)}` : ""}</span>
                      </span>
                    </label>
                    {draft.enabled ? (
                      <div className={styles.metricControls}>
                        <label className={styles.field}><span className={styles.label}>Daily cap</span><input className={styles.input} type="number" min="0" step="1" inputMode="numeric" value={draft.value} onChange={(event) => updateDraft(draft.metric, { value: event.target.value })} placeholder="0 blocks all" /></label>
                        <label className={styles.field}><span className={styles.label}>USD / call</span><input className={styles.input} type="number" min="0" step="0.0001" inputMode="decimal" value={draft.skuUnitCostUsd} onChange={(event) => updateDraft(draft.metric, { skuUnitCostUsd: event.target.value })} placeholder="Optional" /></label>
                        <label className={styles.field}><span className={styles.label}>Free / month</span><input className={styles.input} type="number" min="0" step="1" inputMode="numeric" value={draft.freeMonthlyCalls} onChange={(event) => updateDraft(draft.metric, { freeMonthlyCalls: event.target.value })} placeholder="0" /></label>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className={styles.summaryStrip} style={{ marginTop: 12 }}>
                <div>
                  <div className={styles.label}>Worst-case 30-day estimate</div>
                  <div className={styles.sectionCopy}>{pricedCaps}/{enabledDrafts.length} selected caps have unit prices. Free monthly calls are subtracted before cost.</div>
                </div>
                <div className={styles.summaryValue}>{pricedCaps ? usd(worstCase, 2) : "Add unit prices"}</div>
              </div>
            </>
          ) : null}

          {raisedFields.length ? (
            <div className={styles.note} style={{ marginTop: 13 }}>
              <div>These values are being raised: {raisedFields.join("; ")}</div>
              <div className={styles.buttonRow} style={{ marginTop: 9 }}>
                <button type="button" className={styles.buttonPrimary} disabled={busy === "confirm"} onClick={() => void apply(true)}>{busy === "confirm" ? <Spinner size={11} /> : <ShieldCheck size={12} />} Confirm raise</button>
                <button type="button" className={styles.button} onClick={() => { setRaisedFields([]); setMessage(""); }}>Cancel</button>
              </div>
            </div>
          ) : null}
          {message ? <div className={messageError ? styles.error : styles.note} style={{ marginTop: 13 }}>{message}</div> : null}
          <div className={styles.buttonRow} style={{ marginTop: 13 }}>
            <button type="button" className={styles.buttonPrimary} disabled={busy === "apply" || busy === "confirm" || !projectId || !service} onClick={() => void apply(false)}>
              {busy === "apply" ? <Spinner size={11} /> : <Activity size={13} />} Apply to Google Cloud
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

export function ApiLimitsPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [data, setData] = React.useState<LimitsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");

  const limitsUrl = React.useCallback((projectId = "", service = "") => {
    const query = new URLSearchParams();
    if (projectId) query.set("projectId", projectId);
    if (service) query.set("service", service);
    return `/api/companies/${encodeURIComponent(companyId)}/api-budget${query.size ? `?${query}` : ""}`;
  }, [companyId]);

  const load = React.useCallback(async (projectId = "", service = "") => {
    const response = await fetch(limitsUrl(projectId, service), { cache: "no-store" });
    const payload = await responseJson<LimitsPayload>(response);
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not load API limits.");
    setData({ ...payload, usage: payload.usage ?? EMPTY_USAGE });
    return payload;
  }, [limitsUrl]);

  React.useEffect(() => {
    let alive = true;
    void fetch(limitsUrl(), { cache: "no-store" })
      .then(async (response) => {
        const payload = await responseJson<LimitsPayload>(response);
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "Could not load API limits.");
        if (alive) setData({ ...payload, usage: payload.usage ?? EMPTY_USAGE });
      })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load API limits."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [limitsUrl]);

  if (loading) {
    return (
      <Panel><div role="status" aria-label="Loading API limits" className={styles.root}>
        <Skeleton width={250} height={28} /><div className={styles.kpis}>{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} height={82} radius={12} />)}</div><Skeleton height={260} radius={14} />
      </div></Panel>
    );
  }
  if (!data) {
    return <Panel><div className={styles.error}><AlertTriangle size={14} /> {error || "API limits are unavailable."}</div></Panel>;
  }

  const guardrailCount = data.integrationLimits.length + data.apiBudgets.length;
  return (
    <div className={styles.root}>
      <Panel>
        <div className={styles.hero}>
          <div className={styles.heroCopy}>
            <h2 className={styles.title}>API & integration guardrails</h2>
            <p className={styles.subtitle}>Control request volume and estimated spend for {companyName}. Local limits are reserved before company-aware connector calls; Google Cloud daily quotas are enforced by Google, while its monthly budget sends threshold alerts.</p>
          </div>
          <div className={styles.statusRow}>
            <span className={`${styles.pill} ${data.connected ? styles.pillLive : styles.pillWarn}`}><span className="dot" /> Google Cloud {data.connected ? "connected" : "not connected"}</span>
            <button type="button" className={styles.button} disabled={busy === "refresh"} onClick={() => { setBusy("refresh"); void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Refresh failed.")).finally(() => setBusy("")); }}>
              {busy === "refresh" ? <Spinner size={11} /> : <RefreshCw size={12} />} Refresh
            </button>
          </div>
        </div>
        {error ? <div className={styles.error} style={{ marginTop: 14 }}>{error}</div> : null}
        <div className={styles.divider} />
        <div className={styles.kpis}>
          <div className={styles.kpi}><div className={styles.kpiValue}>{integer(data.usage.dailyRequests)}</div><div className={styles.kpiLabel}>requests today</div></div>
          <div className={styles.kpi}><div className={styles.kpiValue}>{integer(data.usage.monthlyRequests)}</div><div className={styles.kpiLabel}>requests this month</div></div>
          <div className={styles.kpi}><div className={styles.kpiValue}>{usd(data.usage.dailySpendUsd, 4)}</div><div className={styles.kpiLabel}>spend today</div></div>
          <div className={styles.kpi}><div className={styles.kpiValue}>{usd(data.usage.monthlySpendUsd, 4)}</div><div className={styles.kpiLabel}>spend this month</div></div>
          <div className={styles.kpi}><div className={styles.kpiValue}>{guardrailCount}</div><div className={styles.kpiLabel}>active guardrails</div></div>
        </div>
      </Panel>

      <div className={styles.twoColumn}>
        <UsageChart series={data.usage.series} />
        <ProviderBreakdown usage={data.usage} connectors={data.connectors} />
      </div>

      <RecentUsage usage={data.usage} connectors={data.connectors} />

      <IntegrationLimitsEditor companyId={companyId} data={data} onReload={() => load()} />

      <GcpGuardrailEditor companyId={companyId} data={data} onReload={load} />
    </div>
  );
}
