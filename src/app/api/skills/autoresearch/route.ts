import { NextRequest } from "next/server";
import { maybeEnqueueSkillAutoresearch, proposeSkillAutoresearch, skillAutoresearchStatus } from "@/lib/services/skills/skill-autoresearch";
import type { SkillAutoresearchBackendPreference } from "@/lib/services/skills/skill-autoresearch-policy";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  try {
    return okJson(await skillAutoresearchStatus({
      skillSlug: request.nextUrl.searchParams.get("skillSlug") ?? undefined,
      repoRoot: request.nextUrl.searchParams.get("repoRoot") ?? undefined,
      benchmarkCommand: request.nextUrl.searchParams.get("benchmarkCommand") ?? undefined,
      backendPreference: backendPreference(request.nextUrl.searchParams.get("backendPreference")),
    }));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;
  try {
    const body = normalizeBody(await request.json().catch(() => ({})));
    const action = typeof body.action === "string" ? body.action : "scan";
    if (action === "status") return okJson(await skillAutoresearchStatus(requestInput(body)));
    if (action === "scan") {
      const result = body.enqueue === true
        ? await maybeEnqueueSkillAutoresearch({ skillSlug: stringValue(body.skillSlug), vaultPath: stringValue(body.vaultPath) })
        : await skillAutoresearchStatus(requestInput(body));
      return okJson(result);
    }
    if (action === "propose") {
      const skillSlug = stringValue(body.skillSlug);
      if (!skillSlug) return errorJson("skillSlug is required.", 400);
      const result = await proposeSkillAutoresearch({ ...requestInput(body), skillSlug });
      return okJson({ proposal: result.proposal, proposals: result.file.proposals, plan: result.plan, backend: result.backend });
    }
    return errorJson(`Unsupported skill autoresearch action: ${action}`, 400);
  } catch (error) {
    return routeError(error);
  }
}

function requestInput(body: Record<string, unknown>) {
  return {
    skillSlug: stringValue(body.skillSlug),
    targetPath: stringValue(body.targetPath),
    symptom: stringValue(body.symptom),
    repoRoot: stringValue(body.repoRoot),
    benchmarkCommand: stringValue(body.benchmarkCommand),
    backendPreference: backendPreference(body.backendPreference),
    companyIds: Array.isArray(body.companyIds) ? body.companyIds.filter((value): value is string => typeof value === "string") : undefined,
    vaultPath: stringValue(body.vaultPath),
  };
}

function backendPreference(value: unknown): SkillAutoresearchBackendPreference | undefined {
  return value === "auto" || value === "evo" || value === "hivemind-native" ? value : undefined;
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function routeError(error: unknown) {
  return errorJson(error instanceof Error ? error.message : "Skill autoresearch failed.", 400);
}
