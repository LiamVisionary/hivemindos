import { appendSkillAnalyticsEvent, readSkillAnalytics } from "@/lib/services/skills/skill-os";
import { maybeEnqueueSkillAutoresearch } from "@/lib/services/skills/skill-autoresearch";
import type { SkillAnalyticsEvent } from "@/lib/types/skill-os";
import { errorJson, okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const events = await readSkillAnalytics(Number.isFinite(limit) ? limit : 200);
  return okJson({ events });
}

export async function POST(request: Request) {
  try {
    const body = normalizeBody(await request.json().catch(() => ({})));
    const vaultPath = stringValue(body.vaultPath);
    const eventInput = { ...body };
    delete eventInput.vaultPath;
    const event = await appendSkillAnalyticsEvent(eventInput as Omit<SkillAnalyticsEvent, "id" | "createdAt"> & { id?: string; createdAt?: string });
    const autoresearch = isFailure(event)
      ? await maybeEnqueueSkillAutoresearch({ skillSlug: event.skillSlug, vaultPath })
      : { candidates: [], enqueued: [], skipped: [] };
    return okJson({ event, autoresearch });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Could not record skill analytics.", 400);
  }
}

function isFailure(event: SkillAnalyticsEvent) {
  return event.status === "failure"
    || event.status === "blocked"
    || event.event === "action-failed"
    || event.event === "task-failed"
    || event.event === "task-blocked";
}

function normalizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
