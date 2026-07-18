// guard:allow-hive-action-route - dashboard Founder Mode flow; founding a company is an operator decision made in the UI, not an agent-invocable action.
import { NextRequest } from "next/server";
import { readStoredAgentProfiles } from "@/lib/services/agent-profile-store";
import { createAgentChallenge, postAgentChallengeEntry } from "@/lib/services/agent-challenges";
import { addCompanyDirective, readCompanies, upsertCompany } from "@/lib/services/companies-store";
import { companyMembershipOwners, CompanyMembershipConflictError } from "@/lib/services/company-membership";
import { companyTemplateById, companyTemplateCatalog } from "@/lib/services/company-templates";
import { searchContextIndex } from "@/lib/services/context-index";
import { compileFounderBlueprint } from "@/lib/services/founder-blueprint";
import { recommendModelFit, type ModelFitMachine } from "@/lib/services/system/model-fit";
import type { FounderConstraints } from "@/lib/types/founder-blueprint";
import type { CompanyApprovalPolicy, CompanyMember } from "@/lib/types/company";
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
  /** Company template id from GET's catalog; seeds archetype/products/playbooks/setup keys. */
  templateId?: string;
};

/** The template catalog for pickers (no auth-sensitive content). */
export async function GET(request: NextRequest) {
  try {
    await verifyAuth(request);
    return okJson({ templates: companyTemplateCatalog() });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not list company templates.", 400);
  }
}

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
    const template = companyTemplateById(body.templateId);
    if (body.templateId && !template) return errorJson(`Unknown company template: ${body.templateId}`);
    const constraints = normalizeConstraints(body.constraints);
    const [profiles, companies] = await Promise.all([
      readStoredAgentProfiles().catch(() => []),
      readCompanies(),
    ]);
    const membershipOwners = companyMembershipOwners(companies);
    const unassignedProfiles = profiles.filter((profile) => !(membershipOwners.get(profile.id)?.length));
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
      template,
      agents: unassignedProfiles.map((profile) => ({
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
    // Founder defaults first; a template may add domain gates but can never
    // remove the base four (merge by id, template rows win only on their own ids).
    const approvalPolicies: CompanyApprovalPolicy[] = [
      { id: "founder-public-publishing", subject: "publishing customer-facing or public work", mode: "ask", source: "default" },
      { id: "founder-customer-contact", subject: "contacting customers or prospects", mode: "ask", source: "default" },
      { id: "founder-money-movement", subject: "moving money or committing paid spend", mode: "ask", source: "default" },
      { id: "founder-destructive-actions", subject: "running destructive or irreversible actions", mode: "ask", source: "default" },
    ];
    for (const policy of template?.approvalPolicies ?? []) {
      const index = approvalPolicies.findIndex((existing) => existing.id === policy.id);
      if (index >= 0) approvalPolicies[index] = policy;
      else approvalPolicies.push(policy);
    }
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
      approvalPolicies,
      // Backpressure ships ON and visible (the driver default also covers the
      // unconfigured case, but explicit config is inspectable in the UI).
      autonomyPause: template?.autonomyPause ?? { maxWaitingOnHuman: 12 },
      // Template extras: sellable catalog + the credential manifest that powers
      // the proactive setup checklist. Products stay operator-editable defaults.
      products: template?.products?.length
        ? { items: template.products, seededFrom: `template:${template.id}` }
        : undefined,
      setupEnvKeys: template?.setupKeys.map((key) => ({
        envKey: key.envKey,
        title: key.title,
        explanation: key.explanation,
        kind: key.kind,
        placeholder: key.placeholder,
        links: key.links,
        requiredForLaunch: key.requiredForLaunch,
      })),
    });
    // Playbook directives ride the normal directive rail (deduped on write) so
    // they land in every dispatched task's standing context, skills included.
    for (const directive of template?.directives ?? []) {
      await addCompanyDirective(company.id, {
        text: directive.text,
        skills: directive.skills,
        source: "inject",
      }).catch(() => undefined);
    }
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
    if (error instanceof CompanyMembershipConflictError) return errorJson(error.message, error.status);
    return errorJson(error instanceof Error ? error.message : "Founder Mode could not prepare the company.", 400);
  }
}
