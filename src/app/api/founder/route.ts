import { NextRequest } from "next/server";
import { readStoredAgentProfiles } from "@/lib/services/agent-profile-store";
import { createAgentChallenge, postAgentChallengeEntry } from "@/lib/services/agent-challenges";
import { upsertCompany } from "@/lib/services/companies-store";
import { searchContextIndex } from "@/lib/services/context-index";
import { compileFounderBlueprint } from "@/lib/services/founder-blueprint";
import { recommendModelFit, type ModelFitMachine } from "@/lib/services/system/model-fit";
import type { FounderConstraints } from "@/lib/types/founder-blueprint";
import type { CompanyMember } from "@/lib/types/company";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { localAdminPrincipal } from "@/lib/types/principal";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FounderBody = {
  action?: "compile" | "found";
  goal?: string;
  constraints?: Partial<FounderConstraints>;
  machines?: ModelFitMachine[];
};

function normalizeConstraints(input?: Partial<FounderConstraints>): FounderConstraints {
  return {
    privacy: input?.privacy === "balanced" || input?.privacy === "cloud-ok" ? input.privacy : "private-first",
    budgetTier: input?.budgetTier === "starter" || input?.budgetTier === "growth" || input?.budgetTier === "scale" ? input.budgetTier : "local-free",
    pace: input?.pace === "today" || input?.pace === "month" ? input.pace : "week",
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    const principal = auth.principal ?? localAdminPrincipal(auth.userId ?? "local-user", "fallback");
    const body = await request.json().catch(() => ({})) as FounderBody;
    const goal = body.goal?.replace(/\s+/g, " ").trim() ?? "";
    if (goal.length < 12) return errorJson("Describe the outcome in at least a short sentence.");
    const constraints = normalizeConstraints(body.constraints);
    const profiles = await readStoredAgentProfiles().catch(() => []);
    const context = await searchContextIndex({
      query: goal,
      kinds: ["skill", "tool-schema", "connected-app", "app-endpoint", "runtime"],
      limit: 30,
      includeRuntimeProviders: true,
      principal,
    });
    const blueprint = compileFounderBlueprint({
      goal,
      constraints,
      agents: profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        runtime: profile.runtime,
        model: profile.model,
        role: profile.beeRole,
        workerClass: profile.workerClass,
      })),
      contextItems: context.items,
      modelFits: recommendModelFit(Array.isArray(body.machines) ? body.machines : []),
    });
    if ((body.action ?? "compile") === "compile") return okJson({ blueprint });

    const members: CompanyMember[] = blueprint.crew
      .filter((role) => role.candidateAgentId)
      .map((role) => ({
        agentId: role.candidateAgentId!,
        roleInCompany: role.role,
        reportsTo: role.role === "Queen" ? null : blueprint.crew.find((candidate) => candidate.role === "Queen")?.candidateAgentId ?? null,
        task: role.responsibility,
      }));
    const company = await upsertCompany({
      name: blueprint.identity.name,
      ticker: blueprint.identity.ticker,
      sector: blueprint.identity.sector,
      blurb: blueprint.identity.blurb,
      charter: blueprint.identity.charter,
      agentIds: members.map((member) => member.agentId),
      members,
      dailyBudgetUsd: blueprint.budget.dailyUsd || undefined,
      monthlyBudgetUsd: blueprint.budget.monthlyUsd || undefined,
      totalBudgetUsd: blueprint.budget.firstMilestoneUsd || undefined,
      frozen: false,
      apexGoal: { ...blueprint.apexGoal, current: "0", progress: 0 },
      status: members.length ? "setup" : "paused",
      approvalPolicies: [
        { id: "founder-public-publishing", subject: "publishing customer-facing or public work", mode: "ask", source: "default" },
        { id: "founder-customer-contact", subject: "contacting customers or prospects", mode: "ask", source: "default" },
        { id: "founder-money-movement", subject: "moving money or committing paid spend", mode: "ask", source: "default" },
        { id: "founder-destructive-actions", subject: "running destructive or irreversible actions", mode: "ask", source: "default" },
      ],
    });
    const labResult = await createAgentChallenge({
      title: blueprint.lab.title,
      objective: blueprint.lab.objective,
      metricName: blueprint.lab.metricName,
      metricDirection: blueprint.lab.metricDirection,
      baselineScore: blueprint.lab.baselineScore,
      significanceThreshold: blueprint.lab.significanceThreshold,
      workBoard: `company:${company.id}`,
      createdByName: "Founder Mode",
    });
    for (const hypothesis of blueprint.lab.hypotheses) {
      await postAgentChallengeEntry({
        challengeId: labResult.challenge.id,
        type: "candidate",
        authorName: "Founder Mode",
        body: hypothesis,
        evidence: [],
      });
    }
    for (const experiment of blueprint.lab.experiments) {
      await postAgentChallengeEntry({
        challengeId: labResult.challenge.id,
        type: "run-request",
        authorName: "Founder Mode",
        body: experiment,
        evidence: [],
      });
    }
    return okJson({ blueprint, company, lab: labResult.challenge });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Founder Mode could not prepare the company.", 400);
  }
}
