import { NextRequest, NextResponse } from "next/server";
import {
  getBrainSkillInventory,
  getSharedBrainSkillsCached,
  invalidateSkillFileListCache,
  importGitHubBrainSkill,
  importUploadedBrainSkill,
  importBrainSkills,
  importRemoteBrainSkill,
  writeBrainSkill,
  SHARED_BRAIN_CACHE_PREFIX,
  type BrainSkillProviderId,
} from "@/lib/services/obsidian/brain-skills";
import { remoteSkillProviders } from "@/lib/services/fleet/remote-skill-providers";
import { cachedCall, invalidateCachedCall } from "@/lib/services/async-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAIN_SKILL_INVENTORY_CACHE_PREFIX = "brain-skill-inventory:";
const BRAIN_SKILL_INVENTORY_CACHE_MS = 60_000;

export async function GET(request: NextRequest) {
  try {
    const vaultPath = request.nextUrl.searchParams.get("vaultPath") ?? undefined;
    // `?shared=1` returns only the shared-brain skills. Callers that just need the
    // shared list (e.g. the AEON ready check) skip the expensive per-provider
    // directory scan and remote-provider fetch that the full inventory performs.
    if (request.nextUrl.searchParams.get("shared") === "1") {
      const shared = await getSharedBrainSkillsCached(vaultPath, { summaryMode: "fast" });
      // Optional `offset`/`limit` page the (cached) shelf so thin clients —
      // the phone paints its first screen from ~20 skills — don't transfer
      // the whole list. Without `limit` the response is unchanged.
      const offset = Math.max(0, Math.floor(Number(request.nextUrl.searchParams.get("offset")) || 0));
      const limit = Math.floor(Number(request.nextUrl.searchParams.get("limit")) || 0);
      return NextResponse.json({
        ok: true,
        ...shared,
        shared: limit > 0 ? shared.shared.slice(offset, offset + limit) : shared.shared,
        sharedTotal: shared.shared.length,
        providers: [],
        totals: { shared: shared.shared.length, providerSkills: 0, importable: 0 },
      });
    }
    const waitForRemote = request.nextUrl.searchParams.get("remote") === "1";
    const cacheKey = [
      BRAIN_SKILL_INVENTORY_CACHE_PREFIX,
      vaultPath ?? "",
      waitForRemote ? "remote" : "fast",
    ].join(":");
    const inventory = await cachedCall(cacheKey, BRAIN_SKILL_INVENTORY_CACHE_MS, async () => {
      // Start the remote fetch and the local scan together — the remote
      // inventories are only consumed at the final merge, so awaiting them
      // up front would serialize fleet discovery in front of the vault and
      // provider-home scans.
      const remoteProviders = remoteSkillProviders(request, waitForRemote
        ? {}
        : { fleetTimeoutMs: 2_500, collectorTimeoutMs: 2_500 }).catch(() => []);
      return getBrainSkillInventory(vaultPath, remoteProviders, { summaryMode: "fast" });
    });
    return NextResponse.json({ ok: true, ...inventory });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      action?: "import-github" | "import-remote" | "write-skill";
      vaultPath?: string;
      provider?: BrainSkillProviderId | "all";
      githubUrl?: string;
      markdown?: string;
      files?: Array<{ path?: string; content?: string }>;
      name?: string;
      skill?: {
        slug?: string;
        name?: string;
        description?: string;
        source?: string;
        category?: string;
        skillMdUrl?: string;
        githubUrl?: string;
        packagedPath?: string;
      };
    };
    if (body.action === "import-github") {
      if (!body.githubUrl?.trim()) throw new Error("Missing GitHub URL.");
      const result = await importGitHubBrainSkill({
        vaultPath: body.vaultPath,
        githubUrl: body.githubUrl,
      });
      invalidateSkillFileListCache();
      invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
      invalidateCachedCall(BRAIN_SKILL_INVENTORY_CACHE_PREFIX);
      return NextResponse.json({ ok: true, ...result, imported: [], skipped: [] });
    }
    if (body.action === "import-remote") {
      if (!body.skill) throw new Error("Missing skill to import.");
      const result = await importRemoteBrainSkill({
        vaultPath: body.vaultPath,
        skill: body.skill,
      });
      invalidateSkillFileListCache();
      invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
      invalidateCachedCall(BRAIN_SKILL_INVENTORY_CACHE_PREFIX);
      return NextResponse.json({ ok: true, ...result, imported: [body.skill], skipped: [] });
    }
    if (body.action === "write-skill") {
      const result = await writeBrainSkill({
        vaultPath: body.vaultPath,
        markdown: body.markdown ?? "",
      });
      invalidateSkillFileListCache();
      invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
      invalidateCachedCall(BRAIN_SKILL_INVENTORY_CACHE_PREFIX);
      return NextResponse.json({ ok: true, ...result, imported: [], skipped: [] });
    }
    if (Array.isArray(body.files) && body.files.length) {
      const result = await importUploadedBrainSkill({
        vaultPath: body.vaultPath,
        name: body.name,
        files: body.files
          .filter((file) => typeof file.path === "string" && typeof file.content === "string")
          .map((file) => ({ path: file.path!, content: file.content! })),
      });
      invalidateSkillFileListCache();
      invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
      invalidateCachedCall(BRAIN_SKILL_INVENTORY_CACHE_PREFIX);
      return NextResponse.json({ ok: true, ...result, imported: [], skipped: [] });
    }
    const result = await importBrainSkills({
      vaultPath: body.vaultPath,
      provider: body.provider ?? "all",
      remoteProviders: await remoteSkillProviders(request, { includeSourceFiles: true }),
    });
    invalidateSkillFileListCache();
    invalidateCachedCall(SHARED_BRAIN_CACHE_PREFIX);
    invalidateCachedCall(BRAIN_SKILL_INVENTORY_CACHE_PREFIX);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Brain skill sync failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
