import { NextResponse } from "next/server";
import { readProjectRegistry, upsertProject } from "@/lib/services/projects/project-registry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vaultPath = url.searchParams.get("vaultPath");
  const registry = await readProjectRegistry({ vaultPath });
  return NextResponse.json({ ok: true, ...registry });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    id?: string;
    name?: string;
    localPath?: string;
    vaultNotePath?: string;
    preferredMachineKey?: string;
    allowedAgentIds?: string[];
    vaultPath?: string | null;
  } | null;
  if (!body?.name?.trim()) {
    return NextResponse.json({ ok: false, error: "Project name is required." }, { status: 400 });
  }
  const result = await upsertProject({
    id: body.id,
    name: body.name,
    localPath: body.localPath,
    vaultNotePath: body.vaultNotePath,
    preferredMachineKey: body.preferredMachineKey,
    allowedAgentIds: body.allowedAgentIds,
  }, { vaultPath: body.vaultPath });
  return NextResponse.json({ ok: true, ...result });
}
