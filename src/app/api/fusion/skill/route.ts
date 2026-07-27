import { NextRequest, NextResponse } from "next/server";
import { createFusionSkill } from "@/lib/services/fusion/fusion-skill";
import { connectedAppsForFusion } from "@/lib/services/fusion/connected-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      prompt?: string;
      vaultPath?: string;
      includeConnectedApps?: boolean;
    };
    const result = await createFusionSkill({
      prompt: body.prompt ?? "",
      vaultPath: body.vaultPath,
      connectedApps: body.includeConnectedApps === false ? undefined : await connectedAppsForFusion(request.url),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not create fusion skill.",
    }, { status: 400 });
  }
}
