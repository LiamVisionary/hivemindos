import { NextResponse } from "next/server";
import { auditSkillInput, appendSkillAnalyticsEvent } from "@/lib/services/skills/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      slug?: string;
      markdown?: string;
      files?: Array<{ path?: string; content?: string }>;
      sourceRef?: string;
    };
    const audit = await auditSkillInput({
      slug: body.slug,
      markdown: body.markdown,
      files: body.files?.filter((file) => file.path && typeof file.content === "string").map((file) => ({ path: file.path!, content: file.content! })),
      sourceRef: body.sourceRef,
    });
    await appendSkillAnalyticsEvent({
      skillSlug: body.slug ?? "draft-skill",
      event: "audited",
      auditStatus: audit.status,
      status: audit.status === "blocked" ? "blocked" : audit.status === "trusted" ? "success" : "review",
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, audit });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Skill audit failed." }, { status: 400 });
  }
}
