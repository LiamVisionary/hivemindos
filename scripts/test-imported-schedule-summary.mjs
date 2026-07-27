#!/usr/bin/env node
// Regression coverage for the imported-company schedule UI summaries.
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { summarizeImportedSchedule } = await import("../src/features/dashboard/views/zero-human-companies/imported-schedule-summary.ts");

const now = new Date("2026-07-07T09:36:00.000Z");
const options = { now, timeZone: "Asia/Manila", locale: "en-US" };

const twiceDaily = summarizeImportedSchedule({ kind: "github-actions", schedule: "0 8,20 * * *" }, options);
assert.match(twiceDaily.cadence, /Twice daily/);
assert.match(twiceDaily.cadence, /4:00 AM/);
assert.match(twiceDaily.cadence, /4:00 PM/);
assert.match(twiceDaily.previousRunLabel, /Tue, Jul 7/);
assert.match(twiceDaily.previousRunLabel, /4:00 PM/);
assert.match(twiceDaily.previousRunTimeLabel, /Tue, Jul 7/);
assert.equal(twiceDaily.previousRunRelativeLabel, "2h ago");
assert.match(twiceDaily.nextRunLabel, /Wed, Jul 8/);
assert.match(twiceDaily.nextRunLabel, /4:00 AM/);
assert.match(twiceDaily.nextRunTimeLabel, /Wed, Jul 8/);
assert.equal(twiceDaily.nextRunRelativeLabel, "in 10h");
assert.equal(twiceDaily.previousRun?.atMs, Date.parse("2026-07-07T08:00:00.000Z"));
assert.equal(twiceDaily.previousRun?.clockLabel, "4:00 PM");
assert.equal(twiceDaily.nextRun?.atMs, Date.parse("2026-07-07T20:00:00.000Z"));
assert.equal(twiceDaily.nextRun?.clockLabel, "4:00 AM");
assert.equal(twiceDaily.deviceTimezone, "Asia/Manila");
assert.equal(twiceDaily.sourceTimezone, "UTC");
assert.equal(twiceDaily.upcomingOccurrences.length, 4);
assert.equal(twiceDaily.upcomingOccurrences[0]?.relativeLabel, "in 10h");
assert.equal(twiceDaily.upcomingRunLabels.length, 4);
assert.equal(twiceDaily.upcomingCompactLabels.length, 4);
assert.match(twiceDaily.runHistoryLabel, /Provider run receipts are not connected yet/);

const halfHourly = summarizeImportedSchedule({ kind: "supabase-cron", schedule: "*/30 * * * *" }, options);
assert.equal(halfHourly.cadence, "Every 30 minutes");
assert.match(halfHourly.previousRunLabel, /5:30 PM/);
assert.match(halfHourly.nextRunLabel, /6:00 PM/);

const weekly = summarizeImportedSchedule({ kind: "github-actions", schedule: "0 2 * * 0" }, options);
assert.match(weekly.cadence, /Weekly on Sunday/);
assert.match(weekly.previousRunLabel, /Sun, Jul 5/);
assert.match(weekly.previousRunLabel, /10:00 AM/);
assert.match(weekly.nextRunLabel, /Sun, Jul 12/);
assert.match(weekly.nextRunLabel, /10:00 AM/);

const invalid = summarizeImportedSchedule({ kind: "other", schedule: "not a cron" }, options);
assert.equal(invalid.cadence, "Custom schedule");
assert.ok(invalid.parseError);
assert.equal(invalid.nextRun, null);
assert.equal(invalid.upcomingOccurrences.length, 0);
assert.equal(invalid.nextRunLabel, "Unknown");

console.log("imported schedule summary test passed");
