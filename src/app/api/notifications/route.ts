import { NextRequest, NextResponse } from "next/server";
import {
  createAgentNotification,
  listAgentNotifications,
  markAgentNotificationRead,
  markAllAgentNotificationsRead,
  resolveStaleTaskNotifications,
  setAgentNotificationResolution,
  updateAgentNotificationSettings,
} from "@/lib/services/obsidian/agent-notifications";
import { readBoard } from "@/lib/services/kanban/local-kanban-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTIFICATIONS_CACHE_MS = 5_000;

type NotificationsPayload = Awaited<ReturnType<typeof listAgentNotifications>>;

const notificationCache = new Map<string, { checkedAt: number; payload: NotificationsPayload }>();
const notificationInFlight = new Map<string, Promise<NotificationsPayload>>();
let notificationCacheVersion = 0;

export async function GET(request: NextRequest) {
  try {
    const options = optionsFromRequest(request);
    const cursor = Number(request.nextUrl.searchParams.get("cursor") ?? 0);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 40);
    const result = await readCachedNotifications({ ...options, cursor, limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const options = optionsFromRequest(request, body);
    const result = await createAgentNotification(body.notification ?? body, options);
    clearNotificationCache();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const options = optionsFromRequest(request, body);
    if (body.action === "mark-all-read") {
      const result = await markAllAgentNotificationsRead(options);
      clearNotificationCache();
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "settings") {
      const result = await updateAgentNotificationSettings(body.settings ?? {}, options);
      clearNotificationCache();
      return NextResponse.json({ ok: true, ...result });
    }
    if (body.action === "resolve-stale-task-cards") {
      // Bulk janitor: resolve+read every task-lifecycle card whose task is no
      // longer needs-human. The live board is the authority; held (snoozed)
      // tasks still count as live so their cards survive.
      const board = await readBoard(null, { vaultPath: options.vaultPath ?? undefined });
      const live = (board.tasks ?? [])
        .filter((task) => task.status === "needs-human")
        .map((task) => task.id);
      const janitor = await resolveStaleTaskNotifications(live, options);
      clearNotificationCache();
      const result = await listAgentNotifications({ ...options, cursor: 0, limit: 40 });
      return NextResponse.json({ ok: true, janitor, ...result });
    }
    if (!body.id) throw new Error("Notification id is required.");
    if (body.action === "dismiss") {
      await setAgentNotificationResolution(
        body.id,
        { status: "resolved", note: "Dismissed by human.", by: "dashboard" },
        options,
      );
      const result = await markAgentNotificationRead(body.id, options);
      clearNotificationCache();
      return NextResponse.json({ ok: true, ...result });
    }
    const result = await markAgentNotificationRead(body.id, options);
    clearNotificationCache();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

function notificationCacheKey(options: ReturnType<typeof optionsFromRequest> & { cursor: number; limit: number }) {
  return JSON.stringify({
    vaultPath: options.vaultPath ?? "",
    notificationsFolder: options.notificationsFolder ?? "",
    cursor: options.cursor,
    limit: options.limit,
  });
}

async function readCachedNotifications(options: ReturnType<typeof optionsFromRequest> & { cursor: number; limit: number }) {
  const key = notificationCacheKey(options);
  const now = Date.now();
  for (const [entryKey, entry] of notificationCache) {
    if (now - entry.checkedAt >= NOTIFICATIONS_CACHE_MS) notificationCache.delete(entryKey);
  }
  const cached = notificationCache.get(key);
  if (cached && now - cached.checkedAt < NOTIFICATIONS_CACHE_MS) return cached.payload;

  let inFlight = notificationInFlight.get(key);
  if (!inFlight) {
    const version = notificationCacheVersion;
    const request = listAgentNotifications(options)
      .then((payload) => {
        if (version === notificationCacheVersion) {
          notificationCache.set(key, { checkedAt: Date.now(), payload });
        }
        return payload;
      })
      .finally(() => {
        if (notificationInFlight.get(key) === request) {
          notificationInFlight.delete(key);
        }
      });
    inFlight = request;
    notificationInFlight.set(key, inFlight);
  }
  return inFlight;
}

function clearNotificationCache() {
  notificationCacheVersion += 1;
  notificationCache.clear();
  notificationInFlight.clear();
}

function optionsFromRequest(request: NextRequest, body?: { vaultPath?: string; notificationsFolder?: string }) {
  return {
    vaultPath: request.nextUrl.searchParams.get("vaultPath") ?? body?.vaultPath,
    notificationsFolder: request.nextUrl.searchParams.get("notificationsFolder") ?? body?.notificationsFolder,
  };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Notifications request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}
