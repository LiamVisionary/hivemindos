import { NextRequest, NextResponse } from "next/server";
import {
  deleteScheduledSchedule,
  readPastScheduledRuns,
  listScheduledSchedules,
  recordScheduledRun,
  upsertScheduledSchedule,
  type ScheduledRunRecord,
} from "@/lib/services/obsidian/scheduled-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SharedScheduleBody = {
  action?: "list-schedules" | "upsert-schedule" | "upsert-schedules" | "record-run" | "past-runs" | "delete-schedule";
  vaultPath?: string;
  scheduledFolder?: string;
  schedule?: Parameters<typeof upsertScheduledSchedule>[0]["schedule"];
  schedules?: Array<Parameters<typeof upsertScheduledSchedule>[0]["schedule"]>;
  record?: ScheduledRunRecord;
  limit?: number;
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as SharedScheduleBody;
  try {
    if (body.action === "upsert-schedule" && body.schedule) {
      const result = await upsertScheduledSchedule({
        vaultPath: body.vaultPath,
        scheduledFolder: body.scheduledFolder,
        schedule: body.schedule,
      });
      return NextResponse.json({ ok: true, result });
    }
    if (body.action === "list-schedules") {
      const schedules = await listScheduledSchedules({
        vaultPath: body.vaultPath,
        scheduledFolder: body.scheduledFolder,
      });
      return NextResponse.json({ ok: true, schedules });
    }
    if (body.action === "upsert-schedules" && Array.isArray(body.schedules)) {
      const results = await Promise.all(body.schedules.map((schedule) => upsertScheduledSchedule({
        vaultPath: body.vaultPath,
        scheduledFolder: body.scheduledFolder,
        schedule,
      })));
      return NextResponse.json({ ok: true, results });
    }
    if (body.action === "record-run" && body.record) {
      const result = await recordScheduledRun({
        vaultPath: body.vaultPath,
        scheduledFolder: body.scheduledFolder,
        record: body.record,
      });
      return NextResponse.json({ ok: true, result });
    }
    if (body.action === "delete-schedule" && body.schedule) {
      const result = await deleteScheduledSchedule({
        vaultPath: body.vaultPath,
        scheduledFolder: body.scheduledFolder,
        schedule: body.schedule,
      });
      return NextResponse.json({ ok: true, result });
    }
    if (body.action === "past-runs" && body.schedule) {
      const runs = await readPastScheduledRuns({
        vaultPath: body.vaultPath,
        scheduledFolder: body.scheduledFolder,
        schedule: body.schedule,
        limit: body.limit,
      });
      return NextResponse.json({ ok: true, runs });
    }
    return NextResponse.json({ ok: false, error: "Unsupported scheduler shared-vault action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not update shared scheduled vault.",
    }, { status: 500 });
  }
}
