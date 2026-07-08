import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/utils/server-auth";
import { resolveSpendApprovalEscalationNotifications } from "@/lib/services/messaging/escalation-notify";
import {
  decideApproval,
  listApprovals,
  type SpendApprovalStatus,
} from "@/lib/services/wallet/spend-approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: SpendApprovalStatus[] = ["pending", "approved", "denied", "expired", "consumed"];

// Lists spend-approval escalations (defaults to pending) and lets a human
// approve or deny a pending request — the "humans at the edges" control surface.
export async function GET(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const params = request.nextUrl.searchParams;
  const statusParam = params.get("status");
  const status = statusParam && STATUSES.includes(statusParam as SpendApprovalStatus)
    ? (statusParam as SpendApprovalStatus)
    : params.has("status") ? undefined : "pending";
  const approvals = await listApprovals({
    status,
    agentId: params.get("agentId") || undefined,
    companyId: params.get("companyId") || undefined,
  });
  return NextResponse.json({ ok: true, approvals });
}

type DecideBody = { id?: string; decision?: string; decidedBy?: string; note?: string };

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const body = (await request.json().catch(() => ({}))) as DecideBody;
  const id = body.id?.trim();
  const decision = body.decision === "approved" || body.decision === "approve"
    ? "approved"
    : body.decision === "denied" || body.decision === "deny"
      ? "denied"
      : null;
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  if (!decision) return NextResponse.json({ ok: false, error: "decision must be 'approved' or 'denied'" }, { status: 400 });
  const approval = await decideApproval(id, decision, body.decidedBy?.trim() || "dashboard", body.note);
  if (!approval) return NextResponse.json({ ok: false, error: "Approval request not found." }, { status: 404 });
  if (approval.status === "approved" || approval.status === "denied") {
    await resolveSpendApprovalEscalationNotifications(approval.id, approval.status).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, approval });
}
