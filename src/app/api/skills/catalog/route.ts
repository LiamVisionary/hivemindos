import { NextRequest, NextResponse } from "next/server";
import { getBrainSkillInventory } from "@/lib/services/obsidian/brain-skills";
import { remoteSkillProviders } from "@/lib/services/fleet/remote-skill-providers";
import { getSkillCatalog } from "@/lib/services/skills/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    const remoteProviders = await remoteSkillProviders(request);
    const inventory = await getBrainSkillInventory(vaultPath, remoteProviders);
    const skills = await getSkillCatalog({ query, inventory });
    return NextResponse.json({ ok: true, skills });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load skill catalog." }, { status: 500 });
  }
}
