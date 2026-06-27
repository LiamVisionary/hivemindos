import { NextRequest, NextResponse } from "next/server";
import { getSharedBrainSkillsCached, type BrainSkillInventory } from "@/lib/services/obsidian/brain-skills";
import { getSkillCatalog } from "@/lib/services/skills/skill-os";
import { cachedCall } from "@/lib/services/async-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SKILL_CATALOG_CACHE_MS = 60_000;

export async function GET(request: NextRequest) {
  try {
    const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    // The resolved catalog is the same regardless of `q` (which just filters),
    // so cache the unfiltered list and filter per request. This endpoint was
    // ~20s on every skill-browser open: it built the FULL brain inventory
    // (summaryMode "full" reads every skill's entire body — incl. the 300+ file
    // cloudflare tree) plus an untimed fleet round-trip. getSkillCatalog only
    // needs the shared-skill slugs to mark what's already imported, so read just
    // the shared shelf (the cheap `?shared=1` path) — no provider scan, no fleet.
    const skills = await cachedCall(`skill-catalog:${vaultPath ?? ""}`, SKILL_CATALOG_CACHE_MS, async () => {
      const shared = await getSharedBrainSkillsCached(vaultPath, { summaryMode: "fast" });
      const inventory: BrainSkillInventory = {
        ...shared,
        providers: [],
        totals: { shared: shared.shared.length, providerSkills: 0, importable: 0 },
      };
      return getSkillCatalog({ inventory });
    });
    const q = query?.trim().toLowerCase();
    const filtered = q
      ? skills.filter((entry) => [entry.name, entry.slug, entry.description, entry.source, entry.category ?? "", ...entry.tags].join(" ").toLowerCase().includes(q))
      : skills;
    return NextResponse.json({ ok: true, skills: filtered });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not load skill catalog." }, { status: 500 });
  }
}
