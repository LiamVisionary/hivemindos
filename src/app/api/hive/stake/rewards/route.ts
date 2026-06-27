// guard:allow-hive-action-route - read-only seasonal reward calculation
import { NextRequest, NextResponse } from "next/server";
import {
  calculateHiveStakingSeasonRewards,
  type HiveStakingRewardEvent,
  type HiveStakingRewardEventType,
  type HiveStakingRewardSeason,
} from "@/lib/services/hive-staking-rewards";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RewardBody = {
  season?: unknown;
  events?: unknown;
};

export async function POST(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json().catch(() => ({})) as RewardBody;
    const season = parseSeason(body.season);
    const events = parseEvents(body.events);
    const result = calculateHiveStakingSeasonRewards({ season, events });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not calculate HIVE staking rewards.",
    }, { status: 400 });
  }
}

function parseSeason(value: unknown): HiveStakingRewardSeason {
  if (!isRecord(value)) throw new Error("season is required.");
  return {
    id: stringField(value.id, "season.id"),
    label: stringField(value.label, "season.label"),
    startAt: timestampField(value.startAt, "season.startAt"),
    endAt: timestampField(value.endAt, "season.endAt"),
    claimAt: value.claimAt == null ? undefined : timestampField(value.claimAt, "season.claimAt"),
    eligibleRevenueUsd: numberField(value.eligibleRevenueUsd, "season.eligibleRevenueUsd"),
    hivePriceUsd: value.hivePriceUsd == null ? undefined : numberField(value.hivePriceUsd, "season.hivePriceUsd"),
    minimumActiveSeconds: value.minimumActiveSeconds == null
      ? undefined
      : numberField(value.minimumActiveSeconds, "season.minimumActiveSeconds"),
  };
}

function parseEvents(value: unknown): HiveStakingRewardEvent[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("events must be an array.");
  if (value.length > 10_000) throw new Error("events is limited to 10,000 rows per calculation.");
  return value.map((row, index) => {
    if (!isRecord(row)) throw new Error(`events[${index}] must be an object.`);
    const type = stringField(row.type, `events[${index}].type`) as HiveStakingRewardEventType;
    return {
      account: stringField(row.account, `events[${index}].account`),
      type,
      amountHive: numberField(row.amountHive, `events[${index}].amountHive`),
      timestamp: timestampField(row.timestamp, `events[${index}].timestamp`),
      txHash: row.txHash == null ? undefined : stringField(row.txHash, `events[${index}].txHash`),
      logIndex: row.logIndex == null ? undefined : numberField(row.logIndex, `events[${index}].logIndex`),
    };
  });
}

function stringField(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function numberField(value: unknown, label: string) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function timestampField(value: unknown, label: string) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return Math.trunc(numeric);
    const parsedDate = Date.parse(trimmed);
    if (Number.isFinite(parsedDate)) return Math.trunc(parsedDate / 1000);
    throw new Error(`${label} must be a Unix timestamp or ISO date.`);
  }
  return Math.trunc(numberField(value, label));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
