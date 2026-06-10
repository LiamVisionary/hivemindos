import { NextResponse } from "next/server";
import { getBrainSkillInventory, writeSkillsReadme } from "@/lib/services/obsidian/brain-skills";
import { appendSkillAnalyticsEvent, getSkillPacks, installSkillPack } from "@/lib/services/skills/skill-os";
import { invalidateCachedCall } from "@/lib/services/async-cache";
import { SHARED_BRAIN_CACHE_PREFIX } from "@/lib/services/obsidian/brain-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const packs = await getSkillPacks();
  return NextResponse.json({ ok: true, packs });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { packId?: string; vaultPath?: string };
    if (!body.packId) throw new Error("Choose a skill pack to install.");
    const result = await installSkillPack({ packId: body.packId, vaultPath: body.vaultPath });
    const inventory = await getBrainSkillInventory(body.vaultPath);
    await writeSkillsReadme(inventory);
    invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
    await Promise.all(result.installed.map((skillSlug) => appendSkillAnalyticsEvent({
      skillSlug,
      event: "imported",
      taskSource: `pack:${result.pack.id}`,
      status: "success",
    }).catch(() => undefined)));
    return NextResponse.json({ ok: true, ...result, inventory });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not install skill pack." }, { status: 400 });
  }
}
