import { NextRequest } from "next/server";
import { runTailnetVaultSync } from "@/lib/services/obsidian/tailnet-vault-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await runTailnetVaultSync({
      vaultPath: body.vaultPath,
      remoteHost: body.remoteHost,
      remotePath: body.remotePath,
      direction: body.direction,
      dryRun: body.dryRun,
    });
    return Response.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Hivemind Sync repair failed.",
    }, { status: 400 });
  }
}
