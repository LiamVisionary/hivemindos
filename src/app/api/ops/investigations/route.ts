import { NextRequest } from "next/server";
import { z } from "zod";
import { incidentInvestigationService } from "@/lib/services/sre/server";
import { INCIDENT_SEVERITIES, INCIDENT_SOURCES } from "@/lib/services/sre/types";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const incidentInputSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  description: z.string().max(12_000).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  source: z.enum(INCIDENT_SOURCES).optional(),
  target: z.object({
    key: z.string().max(1_000).optional(),
    name: z.string().max(1_000).optional(),
    kind: z.string().max(200).optional(),
  }).strict().optional(),
  symptoms: z.array(z.string().max(4_000)).max(24).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  remediationAttempts: z.array(z.object({
    action: z.string().max(2_000),
    outcome: z.string().max(4_000),
    at: z.string().max(200).optional(),
  }).strict()).max(24).optional(),
  correlationId: z.string().max(500).optional(),
}).strict();

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("investigate"), incident: incidentInputSchema, enqueue: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal("retry"), incidentId: z.string().regex(/^[a-zA-Z0-9_-]+$/) }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "status";
    if (action === "status") return okJson(await incidentInvestigationService.status());
    if (action === "list") {
      const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
      return okJson({ incidents: await incidentInvestigationService.list(limit) });
    }
    if (action === "get") {
      const incidentId = request.nextUrl.searchParams.get("incidentId") ?? "";
      const incident = await incidentInvestigationService.read(incidentId);
      if (!incident) return errorJson("Incident not found.", 404);
      const events = await incidentInvestigationService.events(incidentId);
      return okJson({ incident, events });
    }
    return errorJson(`Unsupported investigation action: ${action}`);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read SRE investigations.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = postSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorJson("Invalid SRE investigation request.", 400, { issues: parsed.error.issues });
    if (parsed.data.action === "retry") {
      const incident = await incidentInvestigationService.retry(parsed.data.incidentId);
      return okJson({ incident }, { status: 202 });
    }
    const incident = await incidentInvestigationService.capture(parsed.data.incident, parsed.data.enqueue);
    return okJson({ incident }, { status: parsed.data.enqueue ? 202 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the SRE investigation.";
    return errorJson(message, /not found/i.test(message) ? 404 : /cannot be retried/i.test(message) ? 409 : 500);
  }
}
