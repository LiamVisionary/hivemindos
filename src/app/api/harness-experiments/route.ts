import { NextRequest } from "next/server";

import {
  createHarnessExperiment,
  decideHarnessExperiment,
  getHarnessExperiment,
  listHarnessExperiments,
  recordHarnessRun,
} from "@/lib/services/evaluation/harness-experiments";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (id) return okJson({ experiment: await getHarnessExperiment(id) });
    return okJson(await listHarnessExperiments({
      limit: request.nextUrl.searchParams.get("limit"),
      decision: request.nextUrl.searchParams.get("decision"),
    }));
  } catch (error) {
    return harnessError(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = objectValue(await request.json().catch(() => ({})));
    const action = typeof body.action === "string" ? body.action : "create";
    if (action === "create") return okJson({ experiment: await createHarnessExperiment(body) });
    if (action === "record-run") {
      return okJson({
        experiment: await recordHarnessRun(requiredId(body.experimentId), body.run),
      });
    }
    if (action === "decide") {
      return okJson({
        experiment: await decideHarnessExperiment({
          experimentId: requiredId(body.experimentId),
          decision: body.decision,
          evidence: body.evidence,
          retirementCondition: body.retirementCondition,
        }),
      });
    }
    if (action === "get") return okJson({ experiment: await getHarnessExperiment(requiredId(body.id)) });
    if (action === "list") return okJson(await listHarnessExperiments(body));
    return errorJson(`Unsupported harness experiment action: ${action}`, 400);
  } catch (error) {
    return harnessError(error);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Harness experiment id is required.");
  return value.trim();
}

function harnessError(error: unknown) {
  const message = error instanceof Error ? error.message : "Harness experiment request failed.";
  return errorJson(message, /not found/i.test(message) ? 404 : 400);
}
