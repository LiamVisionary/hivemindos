import "server-only";

import {
  companyRunsOnThisMachine,
  companySpendRollup,
  localCompanyMachineKey,
  readCompanies,
} from "@/lib/services/companies-store";
import {
  companyRevenueRollup,
  readCompanyRevenueLedger,
  type CompanyRevenueRollup,
} from "@/lib/services/company-revenue-share";
import {
  readCompanyMemory,
  type CompanyMemoryKind,
  type CompanyMemoryRecord,
} from "@/lib/services/company-memory";
import { readConnectionsPayload } from "@/lib/services/integrations/provider-connections";
import { readCompanyEmailThreads } from "@/lib/services/agent-mailboxes";
import type { Company } from "@/lib/types/company";

/**
 * The "how's the business doing?" digest — the honest, per-company daily report
 * the Queen reads back by voice ("check my hive brain" / "how are my companies")
 * and the daily brief writer folds into DAILY-BRIEF.md.
 *
 * MULTI-TENANT BY CONSTRUCTION: every source it reads (readCompanies, the
 * revenue ledger, company-memory, the spend ledger) is scoped to THIS machine's
 * local store (~/.hivemindos + the local user's vault). So it only ever reports
 * on the operator's OWN companies — another user on their own machine gets their
 * own portfolio, never this one's. No company ids are hardcoded.
 *
 * It composes existing rollups rather than inventing a parallel metric store, so
 * it stays truthful to the same numbers the dashboard shows — including $0 when
 * a company hasn't earned yet (a pre-existing reality: checkout/payment isn't
 * wired for the current companies, so revenue is genuinely zero, not missing).
 */

const H24_MS = 24 * 60 * 60 * 1000;
const D7_MS = 7 * H24_MS;
/** Read enough recent memory to cover a 7-day window without scanning huge histories. */
const ACTIVITY_MEMORY_LIMIT = 600;
const EMAIL_THREAD_CAP = 50;

export type CompanyActivity = {
  windowHours: number;
  total: number;
  byKind: Partial<Record<CompanyMemoryKind, number>>;
  latest: Array<{ at: number; kind: CompanyMemoryKind; title: string; agent?: string }>;
};

export type CompanyEmailSummary = {
  configured: boolean;
  providerCount: number;
  threadCount: number;
  truncated: boolean;
  detail: string;
};

export type CompanyDailyKpis = {
  id: string;
  name: string;
  ticker?: string;
  sector?: string;
  frozen: boolean;
  autonomy: boolean;
  /** Whether THIS machine's driver owns the company (vs. a replicated fleet peer). */
  runsHere: boolean;
  apexGoal?: {
    title: string;
    metric?: string;
    target?: string;
    current?: string;
    progress?: number;
    unit?: string;
  };
  revenue: CompanyRevenueRollup;
  spend: {
    dailyUsd: number;
    monthlyUsd: number;
    totalUsd: number;
    dailyRemainingUsd: number | null;
    monthlyRemainingUsd: number | null;
  };
  memberCount: number;
  activity24h: CompanyActivity;
  activity7d: CompanyActivity;
  /** Present only when includeEmail is set (reading inboxes is a network hop). */
  email?: CompanyEmailSummary;
};

export type HiveDailyReportIntegration = {
  key: string;
  label: string;
  connected: boolean;
  verified: boolean;
  account?: string;
};

export type HiveDailyReport = {
  generatedAt: string;
  machineKey: string;
  companyCount: number;
  companies: CompanyDailyKpis[];
  /** Which user integrations are connected (empty unless includeIntegrations). */
  integrations: HiveDailyReportIntegration[];
  /** True when the operator has no companies — callers should stay silent. */
  empty: boolean;
};

export type BuildHiveDailyReportOptions = {
  /** Read each company's inboxes for a thread count (network hop; off by default). */
  includeEmail?: boolean;
  /** Verify connected integrations (network hop; off in the voice hot path). */
  includeIntegrations?: boolean;
  /** Only companies whose autonomy this machine owns (default: all local companies). */
  onlyLocalMachine?: boolean;
  now?: number;
};

function summarizeActivity(records: CompanyMemoryRecord[], sinceMs: number, windowHours: number): CompanyActivity {
  const inWindow = records.filter((record) => record.at >= sinceMs);
  const byKind: Partial<Record<CompanyMemoryKind, number>> = {};
  for (const record of inWindow) byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
  const latest = [...inWindow]
    .sort((a, b) => b.at - a.at)
    .slice(0, 5)
    .map((record) => ({ at: record.at, kind: record.kind, title: record.title, agent: record.agent }));
  return { windowHours, total: inWindow.length, byKind, latest };
}

async function buildCompanyKpis(
  company: Company,
  revenueRecords: Awaited<ReturnType<typeof readCompanyRevenueLedger>>,
  opts: { includeEmail: boolean; now: number },
): Promise<CompanyDailyKpis> {
  const memberCount = company.agentIds?.length ?? 0;
  const [revenue, spend, memory, email] = await Promise.all([
    companyRevenueRollup(company.id, revenueRecords),
    companySpendRollup(company, memberCount, opts.now),
    readCompanyMemory(company.id, { limit: ACTIVITY_MEMORY_LIMIT }),
    opts.includeEmail && memberCount > 0
      ? readCompanyEmailThreads({ agentIds: company.agentIds, totalLimit: EMAIL_THREAD_CAP }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    id: company.id,
    name: company.name,
    ticker: company.ticker,
    sector: company.sector,
    frozen: Boolean(company.frozen),
    autonomy: Boolean(company.autonomy),
    runsHere: companyRunsOnThisMachine(company),
    apexGoal: company.apexGoal
      ? {
          title: company.apexGoal.title,
          metric: company.apexGoal.metric,
          target: company.apexGoal.target,
          current: company.apexGoal.current,
          progress: company.apexGoal.progress,
          unit: company.apexGoal.unit,
        }
      : undefined,
    revenue,
    spend: {
      dailyUsd: spend.dailySpentUsd,
      monthlyUsd: spend.monthlySpentUsd,
      totalUsd: spend.totalSpentUsd,
      dailyRemainingUsd: spend.dailyRemainingUsd,
      monthlyRemainingUsd: spend.monthlyRemainingUsd,
    },
    memberCount,
    activity24h: summarizeActivity(memory, opts.now - H24_MS, 24),
    activity7d: summarizeActivity(memory, opts.now - D7_MS, 24 * 7),
    email: email
      ? {
          configured: email.configured,
          providerCount: email.providers.filter((provider) => provider.connected).length,
          threadCount: email.threads.length,
          truncated: email.truncated,
          detail: email.detail,
        }
      : undefined,
  };
}

export async function buildHiveDailyReport(options: BuildHiveDailyReportOptions = {}): Promise<HiveDailyReport> {
  const now = options.now ?? Date.now();
  const includeEmail = options.includeEmail ?? false;
  const includeIntegrations = options.includeIntegrations ?? false;

  const allCompanies = await readCompanies();
  const companies = options.onlyLocalMachine
    ? allCompanies.filter((company) => companyRunsOnThisMachine(company))
    : allCompanies;

  const [revenueRecords, integrations] = await Promise.all([
    readCompanyRevenueLedger().catch(() => []),
    includeIntegrations ? readIntegrations() : Promise.resolve([] as HiveDailyReportIntegration[]),
  ]);

  const kpis = await Promise.all(
    companies.map((company) => buildCompanyKpis(company, revenueRecords, { includeEmail, now })),
  );

  return {
    generatedAt: new Date(now).toISOString(),
    machineKey: localCompanyMachineKey(),
    companyCount: kpis.length,
    companies: kpis,
    integrations,
    empty: kpis.length === 0,
  };
}

async function readIntegrations(): Promise<HiveDailyReportIntegration[]> {
  try {
    const payload = await readConnectionsPayload();
    return payload.providers.map((provider) => ({
      key: provider.key,
      label: provider.label,
      connected: provider.connected,
      verified: provider.verified,
      account: provider.account,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────── formatting ───────────────────────────

function usd(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return `$${rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function apexLine(kpis: CompanyDailyKpis): string | null {
  const goal = kpis.apexGoal;
  if (!goal?.title && !goal?.metric) return null;
  const label = goal?.metric || goal?.title || "apex goal";
  const target = goal?.target ? ` → target ${goal.target}` : "";
  const current = goal?.current ? `, at ${goal.current}` : "";
  const pct = typeof goal?.progress === "number" ? ` (${goal.progress}%)` : "";
  return `${label}${target}${current}${pct}`;
}

function activityPhrase(activity: CompanyActivity): string {
  const done = activity.byKind["task-completed"] ?? 0;
  const blocked = activity.byKind["task-blocked"] ?? 0;
  const dispatched = activity.byKind["dispatch"] ?? 0;
  const metrics = activity.byKind["metric"] ?? 0;
  const parts: string[] = [];
  if (done) parts.push(`${done} done`);
  if (blocked) parts.push(`${blocked} blocked`);
  if (dispatched) parts.push(`${dispatched} dispatched`);
  if (metrics) parts.push(`${metrics} metric update${metrics === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "no logged activity";
}

/** Compact, read-aloud digest for the voice brain context (kept short by design). */
export function formatHiveDailyReportVoiceDigest(report: HiveDailyReport): string {
  if (report.empty) return "";
  const lines: string[] = [
    "Business digest (this report covers ONLY the operator's own companies):",
  ];
  for (const company of report.companies) {
    const bits: string[] = [];
    const apex = apexLine(company);
    if (apex) bits.push(apex);
    bits.push(`revenue ${usd(company.revenue.totalRevenueUsd)} (${company.revenue.eventCount} event${company.revenue.eventCount === 1 ? "" : "s"})`);
    bits.push(`last 24h: ${activityPhrase(company.activity24h)}`);
    if (company.frozen) bits.push("FROZEN");
    const tag = company.ticker ? ` (${company.ticker})` : "";
    lines.push(`- ${company.name}${tag}: ${bits.join("; ")}.`);
  }
  const connected = report.integrations.filter((i) => i.connected);
  if (connected.length) {
    lines.push(`Connected integrations: ${connected.map((i) => `${i.label}${i.verified ? " ✓" : " (unverified)"}`).join(", ")}.`);
  }
  return lines.join("\n");
}

/** Fuller markdown for the daily brief file and the /api/hive-daily-report?format=text surface. */
export function formatHiveDailyReportText(report: HiveDailyReport): string {
  const date = report.generatedAt.slice(0, 10);
  if (report.empty) {
    return `## Business — ${date}\nNo companies configured on this machine yet.\n`;
  }
  const lines: string[] = [`## Business — ${date}`, ""];
  for (const company of report.companies) {
    const tag = company.ticker ? ` (${company.ticker})` : "";
    const flags = [company.frozen ? "frozen" : null, company.autonomy ? "autonomous" : null, company.runsHere ? null : "runs elsewhere"]
      .filter(Boolean)
      .join(", ");
    lines.push(`### ${company.name}${tag}${flags ? ` — ${flags}` : ""}`);
    const apex = apexLine(company);
    if (apex) lines.push(`- Goal: ${apex}`);
    const rev = company.revenue;
    lines.push(
      `- Revenue: ${usd(rev.totalRevenueUsd)} across ${rev.eventCount} event${rev.eventCount === 1 ? "" : "s"}` +
        (rev.lastRevenueAt ? ` (last ${rev.lastRevenueAt.slice(0, 10)})` : ""),
    );
    lines.push(`- Spend: ${usd(company.spend.dailyUsd)} today / ${usd(company.spend.monthlyUsd)} this month`);
    lines.push(`- Last 24h: ${activityPhrase(company.activity24h)} · last 7d: ${activityPhrase(company.activity7d)}`);
    if (company.email) {
      lines.push(
        company.email.configured
          ? `- Email: ${company.email.threadCount}${company.email.truncated ? "+" : ""} recent thread${company.email.threadCount === 1 ? "" : "s"} across ${company.email.providerCount} provider${company.email.providerCount === 1 ? "" : "s"}`
          : `- Email: ${company.email.detail}`,
      );
    }
    const recent = company.activity24h.latest[0];
    if (recent) lines.push(`- Latest: ${recent.title}${recent.agent ? ` (${recent.agent})` : ""}`);
    lines.push("");
  }
  const connected = report.integrations.filter((i) => i.connected);
  if (report.integrations.length) {
    lines.push(
      connected.length
        ? `Connected integrations: ${connected.map((i) => `${i.label}${i.account ? ` (${i.account})` : ""}${i.verified ? "" : " — unverified"}`).join(", ")}.`
        : "Connected integrations: none.",
    );
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
