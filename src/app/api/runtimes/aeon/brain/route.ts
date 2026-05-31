import { NextRequest, NextResponse } from "next/server";
import { authenticateAeonBrainRequest } from "@/lib/services/aeon-brain/identity";
import { verifyGitHubRepositoryVisibility } from "@/lib/services/aeon-brain/github";
import { assertActionAllowed, resolveAeonBrainPolicy, type AeonBrainAction } from "@/lib/services/aeon-brain/policy";
import { createAeonBrainVault } from "@/lib/services/aeon-brain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AeonBrainRequestBody = {
  action?: AeonBrainAction;
  vaultPath?: string;
  query?: string;
  path?: string;
  content?: string;
  identity?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as AeonBrainRequestBody;
    const action = body.action ?? "policy";
    const identity = await authenticateAeonBrainRequest(request, body);
    const repository = await verifyGitHubRepositoryVisibility(identity.repository);
    const vault = await createAeonBrainVault(body.vaultPath);
    const policy = await resolveAeonBrainPolicy({
      repo: repository.repository,
      runId: identity.runId,
      visibility: repository.visibility,
      vaultPath: vault.vaultRoot,
    });

    assertActionAllowed(policy, action);

    if (action === "policy") {
      return NextResponse.json({ ok: true, identity, repository, policy: publicPolicy(policy), vaultRoot: vault.vaultRoot });
    }

    if (action === "search") {
      const results = await vault.search(body.query ?? "", policy);
      return NextResponse.json({ ok: true, identity, repository, policy: publicPolicy(policy), results });
    }

    if (action === "read") {
      if (!body.path?.trim()) throw Object.assign(new Error("Note path is required."), { status: 400 });
      const note = await vault.read(body.path, policy);
      return NextResponse.json({ ok: true, identity, repository, policy: publicPolicy(policy), note });
    }

    if (action === "list") {
      const files = await vault.list(policy);
      return NextResponse.json({ ok: true, identity, repository, policy: publicPolicy(policy), files });
    }

    if (action === "bulk") {
      const notes = await vault.bulk(policy);
      return NextResponse.json({ ok: true, identity, repository, policy: publicPolicy(policy), notes });
    }

    if (action === "append") {
      if (!body.path?.trim()) throw Object.assign(new Error("Append path is required."), { status: 400 });
      const result = await vault.append(body.path, body.content ?? "", policy);
      return NextResponse.json({ ok: true, identity, repository, policy: publicPolicy(policy), result });
    }

    throw Object.assign(new Error(`Unsupported AEON brain action: ${action}.`), { status: 400 });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "AEON brain request failed.",
    }, { status });
  }
}

function publicPolicy(policy: Awaited<ReturnType<typeof resolveAeonBrainPolicy>>) {
  return {
    mode: policy.mode,
    visibility: policy.visibility,
    allowedActions: policy.allowedActions,
    exclude: policy.exclude,
    appendAllow: policy.appendAllow,
    maxResults: policy.maxResults,
    maxCharsPerResult: policy.maxCharsPerResult,
    maxCharsPerRun: policy.maxCharsPerRun,
    allowNoteOpen: policy.allowNoteOpen,
    allowDirectoryListing: policy.allowDirectoryListing,
    allowBulkExport: policy.allowBulkExport,
  };
}
