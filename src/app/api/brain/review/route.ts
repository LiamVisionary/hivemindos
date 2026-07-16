import { NextRequest } from "next/server";

import {
  applyBrainReviewProposal,
  approveBrainReviewProposal,
  createBrainReviewProposal,
  listBrainReviewProposals,
  previewBrainReviewApply,
  readBrainReviewQueue,
  rejectBrainReviewProposal,
} from "@/lib/services/brain-review-queue";
import type {
  BrainReviewKind,
  BrainReviewStatus,
} from "@/lib/types/brain-review";
import { errorJson, okJson } from "@/lib/utils/api-response";
import { requireAuthContext } from "@/lib/utils/server-auth";
import { workspaceScope } from "@/lib/types/principal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;

  try {
    const status = request.nextUrl.searchParams.get("status");
    const kind = request.nextUrl.searchParams.get("kind");
    const queue = await listBrainReviewProposals({
      status: status as BrainReviewStatus | "all" | null,
      kind: kind as BrainReviewKind | "all" | null,
    });
    return okJson({
      proposals: queue.proposals,
      updatedAt: queue.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthContext(request);
  if (auth.response) return auth.response;

  try {
    const body = normalizeBody(await request.json().catch(() => ({})));
    const action = typeof body.action === "string" ? body.action : "create";
    if (action === "create") {
      const result = await createBrainReviewProposal({
        ...body,
        createdByPrincipalId: body.createdByPrincipalId ?? auth.principal.principalId,
        scope: body.scope ?? workspaceScope(["brain:read"], ["brain-review"]),
      });
      return okJson({
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
      });
    }
    if (action === "list") {
      const result = await readBrainReviewQueue();
      return okJson({
        proposals: result.proposals,
        updatedAt: result.updatedAt,
      });
    }
    if (action === "approve") {
      const result = await approveBrainReviewProposal(bodyId(body));
      return okJson({
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
      });
    }
    if (action === "reject") {
      const result = await rejectBrainReviewProposal(bodyId(body), body.reason);
      return okJson({
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
      });
    }
    if (action === "preview-apply") {
      const preview = await previewBrainReviewApply(bodyId(body));
      return okJson({ preview });
    }
    if (action === "apply") {
      const result = await applyBrainReviewProposal(bodyId(body), body);
      return okJson({
        applied: result.applied,
        action: result.action,
        reason: result.reason,
        preview: result.preview,
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
        memory: result.memory,
        task: result.task,
      });
    }
    return errorJson(`Unsupported brain review action: ${action}`, 400);
  } catch (error) {
    return errorResponse(error);
  }
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bodyId(body: Record<string, unknown>) {
  return typeof body.id === "string" ? body.id : "";
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Brain review request failed.";
  return errorJson(message, 400);
}
