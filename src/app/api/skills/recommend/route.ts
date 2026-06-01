import { NextRequest, NextResponse } from "next/server";
import { getBrainSkillInventory } from "@/lib/services/obsidian/brain-skills";
import { remoteSkillProviders } from "@/lib/services/fleet/remote-skill-providers";
import { appendSkillAnalyticsEvent, recommendSkills, SKILL_PACKS } from "@/lib/services/skills/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { query?: string; vaultPath?: string; limit?: number };
    const query = body.query?.trim();
    if (!query) throw new Error("Provide a query or task description.");
    const inventory = await getBrainSkillInventory(body.vaultPath, await remoteSkillProviders(request));
    const skills = [
      ...inventory.shared.map((skill) => ({ ...skill, providerLabel: skill.providerLabel || "Shared brain" })),
      ...inventory.providers.flatMap((provider) => provider.skills.map((skill) => ({ ...skill, providerLabel: provider.label }))),
    ];
    const recommendations = recommendSkills({ query, skills, packs: SKILL_PACKS, limit: body.limit });
    await Promise.all(recommendations.slice(0, 5).map((recommendation) => appendSkillAnalyticsEvent({
      skillSlug: recommendation.skillSlug,
      event: "recommended",
      taskSource: "api",
      note: recommendation.reason,
    }).catch(() => undefined)));
    return NextResponse.json({ ok: true, recommendations });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not recommend skills." }, { status: 400 });
  }
}
