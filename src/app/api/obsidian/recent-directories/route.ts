import { NextRequest } from "next/server";
import { listRecentDirectories, recordRecentDirectory } from "@/lib/services/obsidian/recent-directories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await listRecentDirectories({
      vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? undefined,
      kanbanFolder: request.nextUrl.searchParams.get("kanbanFolder") ?? undefined,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read recent directories.",
    }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Parameters<typeof recordRecentDirectory>[0];
    const result = await recordRecentDirectory(body);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not record recent directory.",
    }, { status: 400 });
  }
}
