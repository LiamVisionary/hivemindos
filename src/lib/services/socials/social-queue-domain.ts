import { randomUUID } from "node:crypto";

import type {
  SocialAccount,
  SocialAwakeHours,
  SocialQueueItem,
  SocialQueueItemState,
} from "@/lib/services/socials/socials-types";

const DAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const ALLOWED_TRANSITIONS: Record<SocialQueueItemState, readonly SocialQueueItemState[]> = {
  draft: ["suggested", "approved", "scheduled", "canceled"],
  suggested: ["draft", "approved", "scheduled", "canceled"],
  approved: ["draft", "scheduled", "posting", "canceled"],
  scheduled: ["draft", "suggested", "approved", "posting", "canceled"],
  posting: ["posted", "scheduled", "failed"],
  posted: [],
  canceled: [],
  failed: ["draft", "approved", "scheduled", "canceled"],
};

export const DEFAULT_AUTO_CANCEL_WINDOW_MS = 5 * 60_000;
export const MAX_SOCIAL_POST_ATTEMPTS = 4;

function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function localClockParts(date: Date, timezone: string): { day: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
    const hours = Number(parts.find((part) => part.type === "hour")?.value);
    const minutes = Number(parts.find((part) => part.type === "minute")?.value);
    const day = DAY_INDEX[weekday];
    if (!Number.isInteger(day) || !Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    return { day, minute: hours * 60 + minutes };
  } catch {
    return null;
  }
}

export function validAwakeHoursConfiguration(hours: SocialAwakeHours, at = new Date()): boolean {
  return parseClock(hours.start) !== null
    && parseClock(hours.end) !== null
    && Boolean(localClockParts(at, hours.timezone))
    && Array.isArray(hours.days)
    && hours.days.length > 0
    && hours.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    && new Set(hours.days).size === hours.days.length;
}

/** Fail closed when a configured timezone or clock is invalid. */
export function isInsideAwakeHours(hours: SocialAwakeHours, at: Date): boolean {
  if (!hours.enabled) return true;
  const start = parseClock(hours.start);
  const end = parseClock(hours.end);
  const local = localClockParts(at, hours.timezone);
  if (start === null || end === null || !local || !hours.days.length) return false;
  const allowedDays = new Set(hours.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (start === end) return allowedDays.has(local.day);
  if (start < end) return allowedDays.has(local.day) && local.minute >= start && local.minute < end;
  // A wrapped window belongs to the day on which it starts. At 01:00 Tuesday,
  // a Monday 22:00–02:00 window is still open.
  if (local.minute >= start) return allowedDays.has(local.day);
  return local.minute < end && allowedDays.has((local.day + 6) % 7);
}

/** Find the next open minute. Iteration is DST-safe because it walks instants, not guessed offsets. */
export function nextAwakeInstant(hours: SocialAwakeHours, from: Date): Date {
  if (!hours.enabled || isInsideAwakeHours(hours, from)) return new Date(from);
  if (!validAwakeHoursConfiguration(hours, from)) {
    throw new Error(`Invalid awake-hours configuration for timezone ${hours.timezone}.`);
  }
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  const limit = cursor.getTime() + 9 * 24 * 60 * 60_000;
  while (cursor.getTime() <= limit) {
    if (isInsideAwakeHours(hours, cursor)) return cursor;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`No awake-hours opening found within nine days for timezone ${hours.timezone}.`);
}

export function createQueueItem(input: {
  account: SocialAccount;
  text: string;
  title?: string;
  subreddit?: string;
  replyTo?: string;
  quoteOf?: string;
  origin: "agent" | "human";
  suggestedFor?: string;
  now?: Date;
  autoCancelWindowMs?: number;
}): SocialQueueItem {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const canAutoSchedule = input.origin === "agent" && input.account.postingMode === "auto" && Boolean(input.account.autoOptIn);
  const cancelWindowMs = Math.max(30_000, input.autoCancelWindowMs ?? DEFAULT_AUTO_CANCEL_WINDOW_MS);
  const cancelWindowEndsAt = new Date(now.getTime() + cancelWindowMs).toISOString();
  const state: SocialQueueItemState = canAutoSchedule ? "scheduled" : input.origin === "agent" ? "suggested" : "draft";
  return {
    id: `social_${randomUUID()}`,
    accountId: input.account.id,
    platform: input.account.platform,
    state,
    text: input.text.trim(),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.subreddit?.trim() ? { subreddit: input.subreddit.trim().replace(/^r\//, "") } : {}),
    ...(input.replyTo?.trim() ? { replyTo: input.replyTo.trim() } : {}),
    ...(input.quoteOf?.trim() ? { quoteOf: input.quoteOf.trim() } : {}),
    origin: input.origin,
    automated: canAutoSchedule,
    ...(input.suggestedFor ? { suggestedFor: input.suggestedFor } : {}),
    ...(canAutoSchedule
      ? {
          scheduledFor: cancelWindowEndsAt,
          cancelWindowEndsAt,
          approval: { at, by: "auto-mode" as const, optInAt: input.account.autoOptIn!.enabledAt },
        }
      : {}),
    stateHistory: [{ state, at, by: input.origin }],
    createdAt: at,
    updatedAt: at,
  };
}

export function transitionQueueItem(
  item: SocialQueueItem,
  nextState: SocialQueueItemState,
  input: {
    by: "human" | "agent" | "tick";
    now?: Date;
    scheduledFor?: string;
    result?: SocialQueueItem["result"];
    failure?: SocialQueueItem["failure"];
    delivery?: SocialQueueItem["delivery"];
  },
): SocialQueueItem {
  if (!ALLOWED_TRANSITIONS[item.state].includes(nextState)) {
    throw new Error(`Invalid social queue transition: ${item.state} -> ${nextState}.`);
  }
  const at = (input.now ?? new Date()).toISOString();
  const requiresHumanApproval = nextState === "approved" || nextState === "scheduled";
  const approval = requiresHumanApproval && input.by === "human"
    ? { at, by: "human" as const }
    : item.approval;
  if ((nextState === "scheduled" || nextState === "posting") && !approval) {
    throw new Error(`Refusing ${nextState} transition without a durable approval record.`);
  }
  const scheduledFor = nextState === "scheduled"
    ? input.scheduledFor ?? item.scheduledFor ?? at
    : item.scheduledFor;
  return {
    ...item,
    state: nextState,
    approval,
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(input.delivery ? { delivery: input.delivery } : {}),
    ...(input.result ? { result: input.result, failure: undefined, retryAt: undefined } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
    ...(nextState === "canceled" ? { canceledAt: at } : {}),
    stateHistory: [...item.stateHistory, { state: nextState, at, by: input.by }],
    updatedAt: at,
  };
}

export type QueueReadiness = { ready: true } | { ready: false; reason: string; nextAt?: string };

/** Final fail-closed gate called immediately before every external post. */
export function queueItemReadyToPost(
  item: SocialQueueItem,
  account: SocialAccount,
  now: Date,
  options: { includeNextAwakeAt?: boolean } = {},
): QueueReadiness {
  if (item.state !== "approved" && item.state !== "scheduled") return { ready: false, reason: `Item is ${item.state}.` };
  if (account.status !== "connected") return { ready: false, reason: "Account is not connected." };
  if (!item.approval) return { ready: false, reason: "No durable approval record." };
  if (item.approval.by === "auto-mode") {
    if (account.postingMode !== "auto" || !account.autoOptIn || account.autoOptIn.enabledAt !== item.approval.optInAt) {
      return { ready: false, reason: "Auto-mode opt-in was revoked or replaced." };
    }
    const cancelEnds = Date.parse(item.cancelWindowEndsAt ?? "");
    if (!Number.isFinite(cancelEnds)) return { ready: false, reason: "Auto-mode item has no valid cancellation window." };
    if (now.getTime() < cancelEnds) return { ready: false, reason: "Cancellation window is still open.", nextAt: new Date(cancelEnds).toISOString() };
  }
  const scheduled = Date.parse(item.scheduledFor ?? "");
  if (item.state === "scheduled" && (!Number.isFinite(scheduled) || now.getTime() < scheduled)) {
    return { ready: false, reason: "Scheduled time has not arrived.", ...(Number.isFinite(scheduled) ? { nextAt: new Date(scheduled).toISOString() } : {}) };
  }
  if (!isInsideAwakeHours(account.awakeHours, now)) {
    if (options.includeNextAwakeAt === false) return { ready: false, reason: "Outside awake hours." };
    try {
      return { ready: false, reason: "Outside awake hours.", nextAt: nextAwakeInstant(account.awakeHours, now).toISOString() };
    } catch {
      return { ready: false, reason: "Awake-hours configuration is invalid." };
    }
  }
  return { ready: true };
}

export function retryDelayMs(attempt: number): number {
  const normalized = Math.max(1, Math.floor(attempt));
  return Math.min(15 * 60_000, 30_000 * 2 ** (normalized - 1));
}
