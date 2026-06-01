import { NextResponse } from "next/server";
import { approveWorkflowAction } from "@/lib/services/skills/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      skillSlug?: string;
      actionId?: string;
      auditStatus?: "trusted" | "review" | "restricted" | "blocked";
      permissions?: string[];
    };
    if (!body.skillSlug || !body.actionId) throw new Error("Skill slug and action id are required.");
    if (body.auditStatus === "blocked") throw new Error("Blocked skills cannot be approved for action execution.");
    const approval = await approveWorkflowAction({
      skillSlug: body.skillSlug,
      actionId: body.actionId,
      auditStatus: body.auditStatus,
      permissions: body.permissions,
    });
    return NextResponse.json({ ok: true, approval });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not approve workflow action." }, { status: 400 });
  }
}
