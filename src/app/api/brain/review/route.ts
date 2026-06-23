import { NextRequest, NextResponse } from "next/server";

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
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const status = request.nextUrl.searchParams.get("status");
    const kind = request.nextUrl.searchParams.get("kind");
    const queue = await listBrainReviewProposals({
      status: status as BrainReviewStatus | "all" | null,
      kind: kind as BrainReviewKind | "all" | null,
    });
    return NextResponse.json({
      ok: true,
      proposals: queue.proposals,
      updatedAt: queue.updatedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = normalizeBody(await request.json().catch(() => ({})));
    const action = typeof body.action === "string" ? body.action : "create";
    if (action === "create") {
      const result = await createBrainReviewProposal(body);
      return NextResponse.json({
        ok: true,
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
      });
    }
    if (action === "list") {
      const result = await readBrainReviewQueue();
      return NextResponse.json({
        ok: true,
        proposals: result.proposals,
        updatedAt: result.updatedAt,
      });
    }
    if (action === "approve") {
      const result = await approveBrainReviewProposal(bodyId(body));
      return NextResponse.json({
        ok: true,
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
      });
    }
    if (action === "reject") {
      const result = await rejectBrainReviewProposal(bodyId(body), body.reason);
      return NextResponse.json({
        ok: true,
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
      });
    }
    if (action === "preview-apply") {
      const preview = await previewBrainReviewApply(bodyId(body));
      return NextResponse.json({ ok: true, preview });
    }
    if (action === "apply") {
      const result = await applyBrainReviewProposal(bodyId(body), body);
      return NextResponse.json({
        ok: true,
        applied: result.applied,
        action: result.action,
        reason: result.reason,
        preview: result.preview,
        proposal: result.proposal,
        proposals: result.file.proposals,
        updatedAt: result.file.updatedAt,
        memory: result.memory,
      });
    }
    return NextResponse.json({
      ok: false,
      error: `Unsupported brain review action: ${action}`,
    }, { status: 400 });
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
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
