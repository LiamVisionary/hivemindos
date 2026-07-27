import { errorJson, okJson } from "@/lib/utils/api-response";
import {
  executeQuantResearchRun,
  getQuantResearchRun,
  listQuantResearchRuns,
} from "@/lib/services/quant-research/runner";
import {
  QUANT_RESEARCH_POLICY,
  QUANT_RESEARCH_ROLE_MATRIX,
} from "@/lib/services/quant-research/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "list";
  try {
    if (action === "policy") {
      return okJson({
        policy: QUANT_RESEARCH_POLICY,
        roles: QUANT_RESEARCH_ROLE_MATRIX,
      });
    }
    if (action === "list") {
      return okJson({ runs: await listQuantResearchRuns() });
    }
    if (action === "get") {
      const runId = url.searchParams.get("runId")?.trim();
      if (!runId) return errorJson("runId is required.", 400);
      const run = await getQuantResearchRun(runId);
      return run ? okJson({ run }) : errorJson("Quant research run not found.", 404);
    }
    return errorJson(`Unknown quant research action "${action}".`, 400);
  } catch (error) {
    return errorJson(
      error instanceof Error ? error.message : "Quant research request failed.",
      500,
    );
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return errorJson("Expected a JSON object.", 400);
    }
    body = value as Record<string, unknown>;
  } catch {
    return errorJson("Expected a valid JSON body.", 400);
  }
  const action = typeof body.action === "string" ? body.action : "run";
  if (action !== "run") {
    return errorJson(`POST action "${action}" is not supported.`, 400);
  }
  const runRequest = body.request && typeof body.request === "object"
    ? body.request
    : body;
  const runId = typeof body.runId === "string" ? body.runId : undefined;
  try {
    const run = await executeQuantResearchRun(runRequest, { runId });
    return okJson({ run });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Quant research run failed.";
    const invalidRequest = /required|must|disabled|research.only|independent|duplicate|between/i.test(message);
    return errorJson(message, invalidRequest ? 400 : 500);
  }
}
