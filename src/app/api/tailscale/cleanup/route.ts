import {
  DEFAULT_STALE_DEVICE_AGE_DAYS,
  deleteTailnetDevices,
  planTailnetCleanup,
  tailnetAutoCleanupEnabled,
} from "@/lib/services/fleet/tailnet-cleanup";

export const runtime = "nodejs";

function staleAgeDaysFromRequest(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_DEVICE_AGE_DAYS;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = await planTailnetCleanup(staleAgeDaysFromRequest(url.searchParams.get("staleAgeDays")));
  return Response.json({ ok: !plan.error, autoCleanupEnabled: await tailnetAutoCleanupEnabled(), ...plan });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    staleAgeDays?: number;
    scope?: "hivemindos" | "duplicate" | "all";
    deviceIds?: string[];
    unattended?: boolean;
  };
  if (body.unattended && !(await tailnetAutoCleanupEnabled())) {
    return Response.json({
      ok: false,
      autoCleanupEnabled: false,
      error: "Unattended cleanup is disabled. Set HIVE_TAILNET_AUTO_CLEANUP=1 in ~/.hivemindos/.env to allow the daily sweep to delete stale nodes.",
    });
  }
  const plan = await planTailnetCleanup(staleAgeDaysFromRequest(body.staleAgeDays));
  if (!plan.configured || plan.error) {
    return Response.json({ ok: false, ...plan }, { status: plan.configured ? 502 : 200 });
  }

  const scope = body.scope ?? "hivemindos";
  const requestedIds = Array.isArray(body.deviceIds) ? new Set(body.deviceIds) : null;
  // Deletions are always limited to the computed stale candidates; scope and
  // deviceIds can only narrow that set further, never widen it.
  const targets = plan.candidates
    .filter((candidate) => scope === "all" || candidate.scope === scope)
    .filter((candidate) => !requestedIds || requestedIds.has(candidate.id));

  const results = await deleteTailnetDevices(targets);
  return Response.json({
    ok: results.every((result) => result.ok),
    staleAgeDays: plan.staleAgeDays,
    scope,
    totalDevices: plan.totalDevices,
    deleted: results.filter((result) => result.ok),
    failed: results.filter((result) => !result.ok),
    skipped: plan.candidates.filter((candidate) => !targets.includes(candidate)),
  });
}
