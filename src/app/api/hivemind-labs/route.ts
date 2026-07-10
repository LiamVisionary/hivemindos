import { NextRequest } from "next/server";
import {
  createAgentChallenge,
  distillAgentChallengePlaybook,
  getAgentChallenge,
  postAgentChallengeEntry,
  readAgentChallengesState,
  recordAgentChallengeResult,
} from "@/lib/services/agent-challenges";
import { buildCapabilityPromotionDraft } from "@/lib/services/capability-promotion";
import { getCompany } from "@/lib/services/companies-store";
import { connectedAppsForFusion } from "@/lib/services/fusion/connected-apps";
import { previewLabFusionSkill, publishLabFusionSkill } from "@/lib/services/fusion/lab-skill-fusion";
import { recordOutcomeRoutingResult } from "@/lib/services/outcome-router";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const companyId = request.nextUrl.searchParams.get("companyId")?.trim();
    if (!companyId) return errorJson("companyId is required.");
    const result = await readAgentChallengesState();
    const pairs = result.state.challenges
      .map((challenge) => ({ challenge, summary: result.summaries.find((summary) => summary.id === challenge.id)! }))
      .filter((pair) => pair.challenge.workBoard === `company:${companyId}`)
      .map((pair) => ({ ...pair, promotion: buildCapabilityPromotionDraft(pair.challenge, pair.summary) }));
    return okJson({ labs: pairs, storage: result.storage });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not read Hivemind Labs.");
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "create") {
      const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
      const company = await getCompany(companyId);
      if (!company) return errorJson("Company not found.", 404);
      const objective = typeof body.objective === "string" && body.objective.trim() ? body.objective.trim() : company.apexGoal?.title?.trim();
      if (!objective) return errorJson("Set an apex goal before creating a lab.");
      const result = await createAgentChallenge({
        title: typeof body.title === "string" && body.title.trim() ? body.title : `${company.name} · outcome lab`,
        objective,
        metricName: typeof body.metricName === "string" && body.metricName.trim() ? body.metricName : company.apexGoal?.metric ?? "accepted outcomes",
        metricDirection: body.metricDirection === "decrease" ? "decrease" : "increase",
        significanceThreshold: body.significanceThreshold ?? 0,
        workBoard: `company:${company.id}`,
        createdByName: "Operator",
      });
      await postAgentChallengeEntry({ challengeId: result.challenge.id, type: "candidate", authorName: "Operator", body: `Hypothesis: a bounded experiment toward ${objective} will reveal the next best move.` });
      return okJson({ ...result, promotion: buildCapabilityPromotionDraft(result.challenge, result.summary) });
    }
    if (action === "record-result") {
      const result = await recordAgentChallengeResult({
        challengeId: body.challengeId,
        title: body.title,
        score: body.score,
        metricName: body.metricName,
        originatorName: body.originatorName ?? "Operator",
        runnerName: body.runnerName ?? "Operator",
        verifierName: body.verifierName,
        evidence: body.evidence,
        notes: body.notes,
        workBoardTaskId: body.workBoardTaskId,
      });
      const operatingLever = typeof body.operatingLever === "string" ? body.operatingLever.trim() : "";
      const failureMode = typeof body.failureMode === "string" ? body.failureMode.trim() : "";
      let promotedChallenge = result.challenge;
      let promotedSummary = result.summary;
      if (operatingLever || failureMode) {
        const distilled = await distillAgentChallengePlaybook({
          challengeId: result.challenge.id,
          levers: operatingLever ? [operatingLever] : [],
          antiPatterns: failureMode ? [failureMode] : [],
          authorName: "Operator",
        });
        promotedChallenge = distilled.challenge;
        promotedSummary = distilled.summary;
      }
      if (typeof body.provider === "string" && typeof body.model === "string" && typeof body.useCase === "string") {
        await recordOutcomeRoutingResult({
          provider: body.provider,
          model: body.model,
          useCase: body.useCase,
          accepted: body.accepted === true,
          qualityScore: typeof body.qualityScore === "number" ? body.qualityScore : undefined,
          costUsd: typeof body.costUsd === "number" ? body.costUsd : undefined,
          latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : undefined,
          proofPackId: typeof body.proofPackId === "string" ? body.proofPackId : undefined,
        });
      }
      return okJson({ ...result, challenge: promotedChallenge, summary: promotedSummary, promotion: buildCapabilityPromotionDraft(promotedChallenge, promotedSummary) });
    }
    if (action === "promotion-draft") {
      const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
      const result = await getAgentChallenge(challengeId);
      return okJson({ promotion: buildCapabilityPromotionDraft(result.challenge, result.summary) });
    }
    if (action === "fusion-preview" || action === "fusion-publish") {
      const challengeId = typeof body.challengeId === "string" ? body.challengeId : "";
      const result = await getAgentChallenge(challengeId);
      const connectedApps = await connectedAppsForFusion(request.url);
      if (action === "fusion-preview") {
        return okJson(await previewLabFusionSkill(result.challenge, result.summary, { connectedApps }));
      }
      if (body.confirmed !== true) return errorJson("Review the fused skill preview and explicitly confirm before publishing.");
      const expectedDraftHash = typeof body.expectedDraftHash === "string" ? body.expectedDraftHash : undefined;
      const published = await publishLabFusionSkill(result.challenge, result.summary, { connectedApps, confirmed: true, expectedDraftHash });
      const receiptRecorded = await postAgentChallengeEntry({
        challengeId,
        type: "playbook",
        authorName: "Operator",
        body: `Promoted this reviewed Lab method into the shared Hive skill ${published.fusion.skill.slug}.`,
        evidence: [`Hive Skill Fusion wrote ${published.fusion.skill.slug} after explicit operator confirmation.`],
      }).then(() => true).catch(() => false);
      return okJson({ ...published, receiptRecorded });
    }
    return errorJson("Use action create, record-result, promotion-draft, fusion-preview, or fusion-publish.");
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Hivemind Labs request failed.");
  }
}
