import { NextRequest, NextResponse } from "next/server";
import { authenticateAeonBrainRequest } from "@/lib/services/aeon-brain/identity";
import { verifyGitHubRepositoryVisibility } from "@/lib/services/aeon-brain/github";
import { runAeonMiroSharkRehearsal } from "@/lib/services/miroshark/hive-rehearsal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AeonHiveMiroSharkRequest = {
  action?: "rehearse";
  scenario?: string;
  simulationId?: string;
  projectId?: string;
  graphId?: string;
  projectName?: string;
  platform?: "twitter" | "reddit" | "parallel" | "polymarket";
  rounds?: number;
  waitForPosts?: boolean;
  maxWaitMs?: number;
  vaultPath?: string;
  startExisting?: boolean;
  identity?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as AeonHiveMiroSharkRequest;
    const identity = await authenticateAeonBrainRequest(request, body);
    const repository = await verifyGitHubRepositoryVisibility(identity.repository);
    if (repository.visibility !== "private" && repository.visibility !== "internal" && process.env.HIVE_AEON_HIVE_ALLOW_PUBLIC_REHEARSAL !== "true") {
      throw Object.assign(new Error("AEON hive MiroShark rehearsal is limited to private/internal repositories by default."), { status: 403 });
    }
    if (body.action && body.action !== "rehearse") {
      throw Object.assign(new Error(`Unsupported AEON hive MiroShark action: ${body.action}`), { status: 400 });
    }

    const result = await runAeonMiroSharkRehearsal(body, identity, { requestUrl: request.url });
    return NextResponse.json({ ...result, repository });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "AEON hive MiroShark request failed.",
    }, { status });
  }
}
