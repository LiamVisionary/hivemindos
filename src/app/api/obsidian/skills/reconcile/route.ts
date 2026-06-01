import { NextRequest, NextResponse } from "next/server";
import {
  reconcileBrainSkills,
  type BrainSkillProviderAutoSyncPolicy,
  type BrainSkillProviderId,
  type RemoteBrainSkillProviderInventory,
} from "@/lib/services/obsidian/brain-skills";
import { remoteSkillProviders } from "@/lib/services/fleet/remote-skill-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      vaultPath?: string;
      providers?: RemoteBrainSkillProviderInventory[];
      includeFleetProviders?: boolean;
      policies?: Partial<Record<BrainSkillProviderId, BrainSkillProviderAutoSyncPolicy>>;
    };
    const remoteProviders = [
      ...(body.providers ?? []),
      ...(body.includeFleetProviders === false ? [] : await remoteSkillProviders(request, { includeSourceFiles: true })),
    ];
    const result = await reconcileBrainSkills({
      vaultPath: body.vaultPath,
      remoteProviders,
      policies: body.policies,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Skill reconcile failed.",
    }, { status: 400 });
  }
}
