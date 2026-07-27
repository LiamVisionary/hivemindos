import { NextRequest, NextResponse } from "next/server";
import {
  ensureWorkspaceScaffold,
  listHiveWorkspaces,
  resolveHiveWorkspace,
  upsertHiveWorkspace,
  workspacePathExists,
  type HiveWorkspaceInput,
} from "@/lib/services/hive-workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim();
  const store = listHiveWorkspaces();
  const active = resolveHiveWorkspace(id || store.activeWorkspaceId);
  return NextResponse.json({
    ok: true,
    activeWorkspaceId: active.id,
    active,
    workspaces: store.workspaces.map((workspace) => ({
      ...workspace,
      vaultExists: workspacePathExists(workspace.vaultPath),
      skillsExists: workspacePathExists(workspace.skillsPath),
      brainServicesExists: workspacePathExists(workspace.brainServicesPath),
    })),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HiveWorkspaceInput & { scaffold?: boolean };
    if (!body.vaultPath?.trim()) {
      return NextResponse.json({ ok: false, error: "vaultPath is required." }, { status: 400 });
    }
    const store = upsertHiveWorkspace(body);
    const workspace = store.workspaces.find((item) => item.vaultPath === body.vaultPath || item.id === body.id) || resolveHiveWorkspace(store.activeWorkspaceId);
    if (body.scaffold) ensureWorkspaceScaffold(workspace);
    return NextResponse.json({ ok: true, activeWorkspaceId: store.activeWorkspaceId, workspace, workspaces: store.workspaces });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not save workspace.",
    }, { status: 500 });
  }
}
