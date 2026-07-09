import "server-only";

import { randomUUID } from "crypto";

import { readCompanyAnalyticsSummary } from "@/lib/services/company-analytics";
import { readCompanyEmailThreads } from "@/lib/services/agent-mailboxes";
import { readCompanySalesContentEvents, upsertSalesContentEvents, appendSalesContentEvent } from "@/lib/services/sales-content/event-store";
import { salesContentMatrixGaps, salesContentSource, salesContentSourceRuntimeStatuses } from "@/lib/services/sales-content/source-matrix";
import {
  buildSalesContentDispatchContext,
  dedupeEvents,
  deriveSalesContentEvents,
  planSalesContentActions,
  scoreSalesContentSignals,
} from "@/lib/services/sales-content/signal-engine";
import type {
  SalesContentEvent,
  SalesContentEventKind,
  SalesContentMachineResult,
  SalesContentSourceId,
} from "@/lib/services/sales-content/types";
import type { Company } from "@/lib/types/company";

export type ReadSalesContentMachineOptions = {
  refresh?: boolean;
  now?: Date;
  analyticsRangeDays?: number;
};

const EVENT_KINDS: readonly SalesContentEventKind[] = [
  "company.product_catalog_ready",
  "company.product_catalog_missing",
  "mail.thread_sent",
  "mail.thread_queued",
  "mail.reply_received",
  "analytics.conversion",
  "analytics.traffic_signal",
  "analytics.unconfigured",
  "crm.deal_stalled",
  "conversation.objection",
  "creative.asset_ready",
  "social.topic_signal",
  "work.deliverable_ready",
] as const;

function sourceIdOf(value: unknown): SalesContentSourceId {
  const id = typeof value === "string" ? value.trim() : "";
  return salesContentSource(id as SalesContentSourceId)?.id ?? "company-profile";
}

function eventKindOf(value: unknown): SalesContentEventKind {
  const kind = typeof value === "string" ? value.trim() : "";
  return EVENT_KINDS.includes(kind as SalesContentEventKind) ? (kind as SalesContentEventKind) : "work.deliverable_ready";
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function confidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.75;
  return Math.max(0, Math.min(1, n));
}

function analyticsDiagnostic(result: Awaited<ReturnType<typeof readCompanyAnalyticsSummary>> | null) {
  if (!result) return undefined;
  if (result.state === "live") return { ok: true as const, state: result.state, providerLabel: result.providerLabel };
  if (result.state === "credential-missing") return { ok: true as const, state: result.state, providerLabel: result.providerLabel };
  if (result.state === "error") return { ok: false as const, state: result.state, providerLabel: result.providerLabel, error: result.error };
  return { ok: true as const, state: result.state };
}

function isSalesContentCompany(company: Company, events: readonly SalesContentEvent[]): boolean {
  if (events.length > 0) return true;
  return /\b(sales|revenue|outreach|agency|lead|leads|customer|deal|pipeline|book|booking|client|marketing|content|creative|ads?)\b/i.test(
    [company.name, company.sector, company.blurb, company.charter, company.apexGoal?.title, company.apexGoal?.metric]
      .filter(Boolean)
      .join(" "),
  );
}

export async function readSalesContentMachine(
  company: Company,
  opts: ReadSalesContentMachineOptions = {},
): Promise<SalesContentMachineResult> {
  const now = opts.now ?? new Date();
  const refresh = opts.refresh !== false;
  const persistedBefore = await readCompanySalesContentEvents(company.id);

  const mail = refresh
    ? await readCompanyEmailThreads({
        agentIds: company.agentIds ?? [],
        companyId: company.id,
        projectId: company.projectId,
        totalLimit: 80,
      }).catch(() => null)
    : null;
  const analytics = refresh
    ? await readCompanyAnalyticsSummary(company, { rangeDays: opts.analyticsRangeDays ?? 30 }).catch(() => null)
    : null;

  const derived = refresh ? deriveSalesContentEvents(company, { mail, analytics, now }) : [];
  const companyEvents = refresh
    ? (await upsertSalesContentEvents(company.id, derived)).events
    : persistedBefore;
  const events = dedupeEvents(companyEvents);
  const sources = salesContentSourceRuntimeStatuses({ company, mail, analytics });
  const gaps = salesContentMatrixGaps(sources);
  const signals = scoreSalesContentSignals(company, events);
  const actions = planSalesContentActions(company, signals);
  const dispatchContext = buildSalesContentDispatchContext({ signals, actions, gaps });

  return {
    companyId: company.id,
    generatedAt: now.toISOString(),
    sources,
    events,
    signals,
    actions,
    gaps,
    dispatchContext,
    diagnostics: {
      persistedEventCount: persistedBefore.length,
      derivedEventCount: derived.length,
      mail: mail ? { configured: mail.configured, detail: mail.detail, truncated: mail.truncated } : undefined,
      analytics: analyticsDiagnostic(analytics),
    },
  };
}

export async function buildStoredSalesContentDispatchContext(company: Company): Promise<string> {
  const events = await readCompanySalesContentEvents(company.id).catch(() => []);
  const sources = salesContentSourceRuntimeStatuses({ company });
  const gaps = salesContentMatrixGaps(sources);
  const signals = scoreSalesContentSignals(company, events);
  const actions = planSalesContentActions(company, signals);
  return buildSalesContentDispatchContext({
    signals,
    actions,
    gaps: isSalesContentCompany(company, events) ? gaps : [],
  });
}

export async function recordSalesContentEvent(
  company: Company,
  input: Record<string, unknown>,
): Promise<{ event: SalesContentEvent; events: SalesContentEvent[] }> {
  const now = new Date();
  const sourceId = sourceIdOf(input.sourceId);
  const kind = eventKindOf(input.kind);
  const event: SalesContentEvent = {
    id: text(input.id, `manual-${randomUUID()}`),
    companyId: company.id,
    sourceId,
    kind,
    occurredAt: text(input.occurredAt, now.toISOString()),
    title: text(input.title, "Sales/content event"),
    summary: text(input.summary, "Manual sales/content signal recorded."),
    confidence: confidence(input.confidence),
    entity: {
      type: "unknown",
      id: text((input.entity as Record<string, unknown> | undefined)?.id),
      label: text((input.entity as Record<string, unknown> | undefined)?.label),
    },
    evidence: Array.isArray(input.evidence)
      ? input.evidence.map((entry) => text(entry)).filter(Boolean).slice(0, 12)
      : ["manual entry"],
    payload: { manual: true },
  };
  const result = await appendSalesContentEvent(event);
  return { event, events: result.events };
}
