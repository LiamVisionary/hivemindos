// guard:allow-hive-action-route - authenticated per-company policy/usage surface; the dynamic id is not exposed through generic Hive action invocation.
import { NextRequest } from "next/server";

import {
  FRONTIER_LAB_DEFAULT_POLICY,
  FRONTIER_LAB_STAGE_PROFILES,
  evaluateFrontierLabCapacity,
  evaluateFrontierLabStageTransition,
  normalizeFrontierLabPolicy,
} from "@/lib/frontier-lab";
import { earnedScaleStageTransitionBlock } from "@/lib/earned-scale";
import { readCompanyIntelligenceSnapshot } from "@/lib/services/company-intelligence-usage";
import { getCompany, setCompanyFrontierLabPolicy } from "@/lib/services/companies-store";
import { readEarnedScaleInsights } from "@/lib/services/earned-scale-insights";
import { openAiOAuthConfigured } from "@/lib/services/openai-oauth";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function frontierLabPayload(company: NonNullable<Awaited<ReturnType<typeof getCompany>>>) {
  const policy = normalizeFrontierLabPolicy(company.frontierLab);
  const snapshot = await readCompanyIntelligenceSnapshot(company.id, policy);
  const configuredAgentIdentities = new Set((company.agentIds ?? []).map((id) => id.trim()).filter(Boolean)).size;
  const capacity = evaluateFrontierLabCapacity({
    policy,
    dispatchableMembers: configuredAgentIdentities,
    activeTasks: snapshot.activeReservations,
    settledTokens: snapshot.settledTokens,
    reservedTokens: snapshot.reservedTokens,
  });
  const oauthConfigured = await openAiOAuthConfigured().catch(() => false);
  const earnedScale = await readEarnedScaleInsights({ companyId: company.id, policy, snapshot });
  const stages = Object.values(FRONTIER_LAB_STAGE_PROFILES).map((profile) => ({
    ...profile,
    transition: governedStageTransition(policy.stage, profile.stage, {
      settledTasks: snapshot.settledTasks,
      completedTasks: snapshot.completedTasks,
    }, earnedScale.scaleCurve),
  }));
  return {
    policy,
    defaults: FRONTIER_LAB_DEFAULT_POLICY,
    snapshot,
    capacity,
    stages,
    earnedScale,
    readiness: {
      openAiOAuthConfigured: oauthConfigured,
      nativeHierarchicalExecution: company.execution?.engine !== "aeon" && company.process !== "sequential" && company.process !== "graph",
      independentReviewerStaffed: configuredAgentIdentities >= 2,
    },
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const companyId = (await context.params).id?.trim();
  if (!companyId) return errorJson("Company id is required.");
  const company = await getCompany(companyId);
  if (!company) return errorJson("Company not found.", 404);
  try {
    return okJson(await frontierLabPayload(company));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read Frontier Lab state.", 500);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const companyId = (await context.params).id?.trim();
  if (!companyId) return errorJson("Company id is required.");
  const company = await getCompany(companyId);
  if (!company) return errorJson("Company not found.", 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorJson("A Frontier Lab policy object is required.");

  try {
    const current = normalizeFrontierLabPolicy(company.frontierLab);
    const next = normalizeFrontierLabPolicy(body);
    const snapshot = await readCompanyIntelligenceSnapshot(company.id, current);
    const transition = evaluateFrontierLabStageTransition(current.stage, next.stage, {
      settledTasks: snapshot.settledTasks,
      completedTasks: snapshot.completedTasks,
    });
    if (!transition.allowed) return errorJson(transition.reason ?? "The requested scale stage is not yet earned.", 409);
    const earnedScale = await readEarnedScaleInsights({ companyId: company.id, policy: current, snapshot });
    const earnedScaleBlock = earnedScaleStageTransitionBlock(current.stage, next.stage, earnedScale.scaleCurve);
    if (earnedScaleBlock) return errorJson(earnedScaleBlock, 409);
    if (next.enabled && (company.execution?.engine === "aeon" || company.process === "sequential" || company.process === "graph")) {
      return errorJson("Frontier Lab currently requires the native hierarchical Hivemind execution process so every task can be attributed and budgeted.", 409);
    }
    if (next.enabled && new Set((company.agentIds ?? []).map((id) => id.trim()).filter(Boolean)).size < 2) {
      return errorJson("Staff at least two distinct company agent identities before enabling Frontier Lab so every task can receive independent review.", 409);
    }
    if (next.enabled && !(await openAiOAuthConfigured().catch(() => false))) {
      return errorJson("Connect OpenAI OAuth before enabling Frontier Lab. It will not fall back to OpenRouter, Claude, or an API-key provider.", 409);
    }
    const updated = await setCompanyFrontierLabPolicy(company.id, next);
    if (!updated) return errorJson("Company not found.", 404);
    return okJson(await frontierLabPayload(updated));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not update Frontier Lab.", 400);
  }
}

function governedStageTransition(
  current: "pilot" | "team" | "frontier",
  target: "pilot" | "team" | "frontier",
  evidence: { settledTasks: number; completedTasks: number },
  scaleCurve: Awaited<ReturnType<typeof readEarnedScaleInsights>>["scaleCurve"],
) {
  const completionGate = evaluateFrontierLabStageTransition(current, target, evidence);
  if (!completionGate.allowed) return completionGate;
  const earnedScaleBlock = earnedScaleStageTransitionBlock(current, target, scaleCurve);
  return earnedScaleBlock ? { ...completionGate, allowed: false, reason: earnedScaleBlock } : completionGate;
}
