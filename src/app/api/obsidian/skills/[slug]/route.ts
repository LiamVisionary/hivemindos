import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { getSharedBrainSkillsCached } from "@/lib/services/obsidian/brain-skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

/** Read one canonical shared skill, including its complete SKILL.md body. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { slug: rawSlug } = await context.params;
    const slug = decodeURIComponent(rawSlug).trim();
    if (!slug) {
      return NextResponse.json({ ok: false, error: "Missing skill slug." }, { status: 400 });
    }
    const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
    const inventory = await getSharedBrainSkillsCached(vaultPath, { summaryMode: "fast" });
    const skill = inventory.shared.find((candidate) => candidate.slug === slug);
    if (!skill) {
      return NextResponse.json({ ok: false, error: `Shared skill ${slug} was not found.` }, { status: 404 });
    }
    const markdown = await readFile(skill.path, "utf8");
    return NextResponse.json({
      ok: true,
      skill: {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        updatedAt: skill.updatedAt,
        markdown,
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not read the shared skill.",
    }, { status: 400 });
  }
}
