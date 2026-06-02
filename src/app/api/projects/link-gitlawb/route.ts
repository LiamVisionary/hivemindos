import { NextResponse } from "next/server";
import { linkProjectGitLawb } from "@/lib/services/projects/project-registry";
import { readGitLawbStatus } from "@/lib/services/gitlawb/gitlawb-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    projectId?: string;
    name?: string;
    repo?: {
      repoId?: string;
      repoName?: string;
      remoteUrl?: string;
      nodeUrl?: string;
      branch?: string;
    };
    vaultPath?: string | null;
  } | null;
  if (!body?.projectId && !body?.name?.trim()) {
    return NextResponse.json({ ok: false, error: "Project id or name is required." }, { status: 400 });
  }
  const status = await readGitLawbStatus({ nodeUrl: body.repo?.nodeUrl, cache: true });
  const result = await linkProjectGitLawb({
    projectId: body.projectId,
    name: body.name,
    repo: {
      repoId: body.repo?.repoId,
      repoName: body.repo?.repoName || body.name,
      remoteUrl: body.repo?.remoteUrl,
      nodeUrl: body.repo?.nodeUrl || status.node.nodeUrl,
      branch: body.repo?.branch,
      linkedAt: Date.now(),
    },
    vaultPath: body.vaultPath,
  });
  return NextResponse.json({
    ok: true,
    ...result,
    gitlawb: {
      proofReady: status.cli.installed && status.identity.source === "local",
      nodeAvailable: status.node.healthy,
      status,
    },
  });
}
