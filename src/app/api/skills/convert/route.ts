import { NextResponse } from "next/server";
import { auditSkillInput, createSkillDraft } from "@/lib/services/skills/skill-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { title?: string; sourceKind?: string; content?: string };
    if (!body.content?.trim()) throw new Error("Provide content to convert into a skill.");
    const markdown = createSkillDraft({
      title: body.title,
      sourceKind: body.sourceKind,
      content: body.content,
    });
    const audit = await auditSkillInput({ slug: body.title, markdown, sourceRef: `draft:${body.sourceKind ?? "manual"}` });
    return NextResponse.json({ ok: true, markdown, audit });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not convert that input into a skill." }, { status: 400 });
  }
}
