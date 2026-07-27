// guard:allow-hive-action-route - per-company run/proposal ledger written by company services and the dashboard; the dynamic [id] segment is not addressable by the Hive action invoke surface.
import { NextRequest } from "next/server";

import {
  appendCompanyRunEvent,
  createCompanyProposal,
  finishCompanyRun,
  listCompanyRuns,
  requestCompanyRunReplay,
  settleCompanyProposal,
  settleCompanyProposalByIdempotencyKey,
  startCompanyRun,
} from "@/lib/services/company-runs";
import { getCompany } from "@/lib/services/companies-store";
import type {
  CompanyProposalKind,
  CompanyProposalRisk,
  CompanyProposalStatus,
  CompanyRunKind,
} from "@/lib/types/company-runs";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const companyId = (await context.params).id?.trim();
  if (!companyId) return errorJson("Company id is required.");
  const company = await getCompany(companyId);
  if (!company) return errorJson("Company not found.", 404);

  const ledger = await listCompanyRuns(companyId, {
    runLimit: numberParam(request.nextUrl.searchParams.get("runLimit"), 80),
    proposalLimit: numberParam(request.nextUrl.searchParams.get("proposalLimit"), 120),
    status: proposalStatusParam(request.nextUrl.searchParams.get("status")),
  });
  return okJson({ runs: ledger.runs, proposals: ledger.proposals, updatedAt: ledger.updatedAt });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const companyId = (await context.params).id?.trim();
  if (!companyId) return errorJson("Company id is required.");
  const company = await getCompany(companyId);
  if (!company) return errorJson("Company not found.", 404);

  const body = normalizeBody(await request.json().catch(() => ({})));
  const action = stringOf(body.action) ?? "create-proposal";
  try {
    if (action === "start-run") {
      const run = await startCompanyRun(companyId, {
        id: stringOf(body.id),
        kind: runKindOf(body.kind),
        title: stringOf(body.title) ?? "Company run",
        summary: stringOf(body.summary),
        actor: stringOf(body.actor),
        parentRunId: stringOf(body.parentRunId),
        replayOfRunId: stringOf(body.replayOfRunId),
        sourceTaskId: stringOf(body.sourceTaskId),
        flowRunId: stringOf(body.flowRunId),
        input: recordOf(body.input),
        evidence: stringArrayOf(body.evidence),
      });
      return okJson({ run });
    }
    if (action === "finish-run") {
      const run = await finishCompanyRun(companyId, stringOf(body.runId), {
        status: finishStatusOf(body.status),
        summary: stringOf(body.summary),
        output: recordOf(body.output),
        evidence: stringArrayOf(body.evidence),
      });
      if (!run) return errorJson("Company run not found.", 404);
      return okJson({ run });
    }
    if (action === "append-event") {
      const run = await appendCompanyRunEvent(companyId, stringOf(body.runId), {
        kind: stringOf(body.kind) ?? "event",
        title: stringOf(body.title) ?? "Event recorded",
        detail: stringOf(body.detail),
        taskId: stringOf(body.taskId),
        proposalId: stringOf(body.proposalId),
        data: recordOf(body.data),
      });
      if (!run) return errorJson("Company run not found.", 404);
      return okJson({ run });
    }
    if (action === "settle-proposal") {
      const input = {
        status: settledStatusOf(body.status),
        decision: stringOf(body.decision),
        decidedBy: stringOf(body.decidedBy) ?? "dashboard",
        summary: stringOf(body.summary),
        evidence: stringArrayOf(body.evidence),
      };
      const proposal = stringOf(body.id)
        ? await settleCompanyProposal(companyId, stringOf(body.id), input)
        : await settleCompanyProposalByIdempotencyKey(companyId, stringOf(body.idempotencyKey), input);
      if (!proposal) return errorJson("Company proposal not found.", 404);
      return okJson({ proposal });
    }
    if (action === "request-replay") {
      const proposal = await requestCompanyRunReplay({
        companyId,
        runId: stringOf(body.runId) ?? "",
        title: stringOf(body.title),
        summary: stringOf(body.summary),
        requestedBy: stringOf(body.requestedBy) ?? "dashboard",
      });
      return okJson({ proposal });
    }

    const proposal = await createCompanyProposal(companyId, {
      id: stringOf(body.id),
      kind: proposalKindOf(body.kind),
      status: proposalStatusOf(body.status),
      title: stringOf(body.title) ?? "Company proposal",
      summary: stringOf(body.summary),
      runId: stringOf(body.runId),
      sourceTaskId: stringOf(body.sourceTaskId),
      idempotencyKey: stringOf(body.idempotencyKey),
      risk: riskOf(body.risk),
      proposedChange: recordOf(body.proposedChange),
      evidence: stringArrayOf(body.evidence),
      links: linksOf(body.links),
      createdBy: stringOf(body.createdBy) ?? "dashboard",
      decision: stringOf(body.decision),
      decidedBy: stringOf(body.decidedBy),
    });
    return okJson({ proposal });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Company run request failed.", 400);
  }
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOf(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringArrayOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(stringOf).filter((item): item is string => Boolean(item));
  return items.length ? items : undefined;
}

function numberParam(value: string | null, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function proposalStatusParam(value: string | null): CompanyProposalStatus | "all" | undefined {
  if (value === "all") return "all";
  return proposalStatusOf(value);
}

function runKindOf(value: unknown): CompanyRunKind {
  const text = stringOf(value);
  if (text === "dispatch" || text === "flow" || text === "task-outcome" || text === "pricing" || text === "preview-review" || text === "deliverable-review" || text === "revenue" || text === "replay" || text === "manual") {
    return text;
  }
  return "manual";
}

function proposalKindOf(value: unknown): CompanyProposalKind {
  const text = stringOf(value);
  if (text === "pricing-change" || text === "human-input" || text === "preview-review" || text === "deliverable-redirect" || text === "revenue-share" || text === "replay" || text === "manual") {
    return text;
  }
  return "manual";
}

function proposalStatusOf(value: unknown): CompanyProposalStatus | undefined {
  const text = stringOf(value);
  if (text === "pending" || text === "approved" || text === "rejected" || text === "applied" || text === "superseded") return text;
  return undefined;
}

function settledStatusOf(value: unknown): Exclude<CompanyProposalStatus, "pending"> {
  const status = proposalStatusOf(value);
  return status && status !== "pending" ? status : "applied";
}

function finishStatusOf(value: unknown) {
  const text = stringOf(value);
  if (text === "completed" || text === "blocked" || text === "failed" || text === "canceled") return text;
  return "completed";
}

function riskOf(value: unknown): CompanyProposalRisk | undefined {
  const text = stringOf(value);
  if (text === "low" || text === "medium" || text === "high") return text;
  return undefined;
}

function linksOf(value: unknown): { label: string; url: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const label = stringOf(raw.label);
      const url = stringOf(raw.url);
      return label && url ? { label, url } : null;
    })
    .filter(Boolean) as { label: string; url: string }[];
  return links.length ? links : undefined;
}
