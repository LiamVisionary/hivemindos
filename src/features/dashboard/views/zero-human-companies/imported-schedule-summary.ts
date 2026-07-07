import type { ImportedSchedule } from "@/lib/types/company-import";

type CronField = {
  values: Set<number>;
  any: boolean;
};

type CronSpec = {
  minutes: CronField;
  hours: CronField;
  daysOfMonth: CronField;
  months: CronField;
  daysOfWeek: CronField;
};

export type ImportedScheduleOccurrence = {
  atMs: number;
  iso: string;
  label: string;
  compactLabel: string;
  dateLabel: string;
  clockLabel: string;
  relativeLabel: string;
};

export type ImportedScheduleSummary = {
  sourceTimezone: string;
  deviceTimezone: string;
  cadence: string;
  nextRun: ImportedScheduleOccurrence | null;
  nextRunLabel: string;
  nextRunTimeLabel: string;
  nextRunRelativeLabel: string;
  previousRun: ImportedScheduleOccurrence | null;
  previousRunLabel: string;
  previousRunTimeLabel: string;
  previousRunRelativeLabel: string;
  upcomingOccurrences: ImportedScheduleOccurrence[];
  upcomingRunLabels: string[];
  upcomingCompactLabels: string[];
  sourceCron: string;
  runHistoryLabel: string;
  parseError?: string;
};

type SummaryOptions = {
  now?: Date;
  timeZone?: string;
  locale?: string;
};

const FIELD_SPECS = [
  ["minute", 0, 59],
  ["hour", 0, 23],
  ["day of month", 1, 31],
  ["month", 1, 12],
  ["day of week", 0, 7],
] as const;

const DAY_NAMES = new Map([
  ["sun", 0], ["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5], ["sat", 6],
]);

const MONTH_NAMES = new Map([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);

export function summarizeImportedSchedule(schedule: Pick<ImportedSchedule, "schedule" | "kind">, options: SummaryOptions = {}): ImportedScheduleSummary {
  const sourceCron = (schedule.schedule ?? "").trim();
  const deviceTimezone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  const sourceTimezone = "UTC";
  const runHistoryLabel = "Provider run receipts are not connected yet; last/next are calculated from the schedule.";
  if (!sourceCron) {
    return {
      sourceTimezone,
      deviceTimezone,
      cadence: "Schedule expression unavailable",
      nextRun: null,
      nextRunLabel: "Unknown",
      nextRunTimeLabel: "Unknown",
      nextRunRelativeLabel: "",
      previousRun: null,
      previousRunLabel: "Unknown",
      previousRunTimeLabel: "Unknown",
      previousRunRelativeLabel: "",
      upcomingOccurrences: [],
      upcomingRunLabels: [],
      upcomingCompactLabels: [],
      sourceCron,
      runHistoryLabel,
      parseError: "No cron expression was imported for this schedule.",
    };
  }

  const parsed = parseCronExpression(sourceCron);
  if (!parsed) {
    return {
      sourceTimezone,
      deviceTimezone,
      cadence: "Custom schedule",
      nextRun: null,
      nextRunLabel: "Unknown",
      nextRunTimeLabel: "Unknown",
      nextRunRelativeLabel: "",
      previousRun: null,
      previousRunLabel: "Unknown",
      previousRunTimeLabel: "Unknown",
      previousRunRelativeLabel: "",
      upcomingOccurrences: [],
      upcomingRunLabels: [],
      upcomingCompactLabels: [],
      sourceCron,
      runHistoryLabel,
      parseError: `Could not parse cron expression "${sourceCron}".`,
    };
  }

  const now = options.now ?? new Date();
  const nextRun = findOccurrence(parsed, now, 1);
  const previousRun = findOccurrence(parsed, now, -1);
  const upcomingRuns = findUpcomingOccurrences(parsed, now, 4);
  const nextOccurrence = nextRun ? summarizeOccurrence(nextRun, deviceTimezone, options.locale, now) : null;
  const previousOccurrence = previousRun ? summarizeOccurrence(previousRun, deviceTimezone, options.locale, now) : null;
  const upcomingOccurrences = upcomingRuns.map((date) => summarizeOccurrence(date, deviceTimezone, options.locale, now));
  return {
    sourceTimezone,
    deviceTimezone,
    cadence: describeCron(parsed, upcomingRuns, deviceTimezone, options.locale),
    nextRun: nextOccurrence,
    nextRunLabel: nextOccurrence?.label ?? "Not within the next year",
    nextRunTimeLabel: nextOccurrence?.compactLabel ?? "Unknown",
    nextRunRelativeLabel: nextOccurrence?.relativeLabel ?? "",
    previousRun: previousOccurrence,
    previousRunLabel: previousOccurrence?.label ?? "Not found in the past year",
    previousRunTimeLabel: previousOccurrence?.compactLabel ?? "Unknown",
    previousRunRelativeLabel: previousOccurrence?.relativeLabel ?? "",
    upcomingOccurrences,
    upcomingRunLabels: upcomingOccurrences.map((occurrence) => occurrence.label),
    upcomingCompactLabels: upcomingOccurrences.map((occurrence) => occurrence.compactLabel),
    sourceCron,
    runHistoryLabel,
  };
}

export function parseCronExpression(expression: string): CronSpec | null {
  const fields = expression.trim().replace(/\s+/g, " ").split(" ");
  if (fields.length !== 5) return null;
  const parsed = fields.map((field, index) => parseCronField(field, FIELD_SPECS[index][1], FIELD_SPECS[index][2], index));
  if (parsed.some((field) => field === null)) return null;
  return {
    minutes: parsed[0]!,
    hours: parsed[1]!,
    daysOfMonth: parsed[2]!,
    months: parsed[3]!,
    daysOfWeek: normalizeDayOfWeekField(parsed[4]!),
  };
}

function parseCronField(field: string, min: number, max: number, fieldIndex: number): CronField | null {
  const clean = field.trim().toLowerCase();
  if (!clean) return null;
  const values = new Set<number>();
  const parts = clean.split(",");
  for (const part of parts) {
    const [rangePartRaw, stepRaw] = part.split("/");
    const rangePart = rangePartRaw === "?" ? "*" : rangePartRaw;
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      const range = rangePart.split("-");
      start = parseCronValue(range[0], fieldIndex);
      end = range.length > 1 ? parseCronValue(range[1], fieldIndex) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    }
    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  if (values.size === 0) return null;
  return { values, any: clean === "*" || clean === "?" };
}

function parseCronValue(value: string | undefined, fieldIndex: number) {
  if (!value) return Number.NaN;
  if (fieldIndex === 3) return MONTH_NAMES.get(value) ?? Number(value);
  if (fieldIndex === 4) return DAY_NAMES.get(value) ?? Number(value);
  return Number(value);
}

function normalizeDayOfWeekField(field: CronField): CronField {
  const values = new Set<number>();
  for (const value of field.values) values.add(value === 7 ? 0 : value);
  return { any: field.any, values };
}

function findUpcomingOccurrences(spec: CronSpec, now: Date, count: number): Date[] {
  const dates: Date[] = [];
  let cursor = now;
  for (let index = 0; index < count; index += 1) {
    const next = findOccurrence(spec, cursor, 1);
    if (!next) break;
    dates.push(next);
    cursor = next;
  }
  return dates;
}

function findOccurrence(spec: CronSpec, now: Date, direction: 1 | -1): Date | null {
  const minute = 60_000;
  const maxSteps = 366 * 24 * 60;
  let cursor = new Date(Math.floor(now.getTime() / minute) * minute + direction * minute);
  for (let step = 0; step < maxSteps; step += 1) {
    if (matchesCron(spec, cursor)) return cursor;
    cursor = new Date(cursor.getTime() + direction * minute);
  }
  return null;
}

function matchesCron(spec: CronSpec, date: Date) {
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const weekday = date.getUTCDay();
  if (!spec.minutes.values.has(minute) || !spec.hours.values.has(hour) || !spec.months.values.has(month)) return false;
  const dayOfMonthMatches = spec.daysOfMonth.values.has(day);
  const dayOfWeekMatches = spec.daysOfWeek.values.has(weekday);
  if (spec.daysOfMonth.any && spec.daysOfWeek.any) return true;
  if (spec.daysOfMonth.any) return dayOfWeekMatches;
  if (spec.daysOfWeek.any) return dayOfMonthMatches;
  return dayOfMonthMatches || dayOfWeekMatches;
}

function describeCron(spec: CronSpec, upcomingRuns: Date[], timeZone: string, locale?: string) {
  const minutes = sortedValues(spec.minutes.values);
  const hours = sortedValues(spec.hours.values);
  const weekdays = sortedValues(spec.daysOfWeek.values);
  if (spec.daysOfMonth.any && spec.daysOfWeek.any && spec.months.any) {
    if (hours.length === 24 && minutes.length > 1) {
      const step = evenlySpacedStep(minutes);
      if (step) return `Every ${step} minutes`;
    }
    if (hours.length === 24 && minutes.length === 1) return `Hourly at :${pad(minutes[0])}`;
    if (minutes.length === 1 && hours.length === 2) return `Twice daily at ${localTimes(upcomingRuns, timeZone, locale).join(" and ")}`;
    const hourStep = evenlySpacedStep(hours, 24);
    if (minutes.length === 1 && hourStep && hours.length > 1) return `Every ${hourStep} hours at :${pad(minutes[0])}`;
    if (minutes.length === 1 && hours.length > 1) return `${hours.length} times daily at ${localTimes(upcomingRuns, timeZone, locale).join(", ")}`;
    if (minutes.length === 1 && hours.length === 1) return `Daily at ${localTimes(upcomingRuns, timeZone, locale)[0] ?? "the scheduled local time"}`;
  }
  if (spec.daysOfMonth.any && !spec.daysOfWeek.any && spec.months.any && minutes.length === 1 && hours.length === 1) {
    return `Weekly on ${weekdays.map(weekdayName).join(", ")} at ${localTimes(upcomingRuns, timeZone, locale)[0] ?? "the scheduled local time"}`;
  }
  if (!spec.daysOfMonth.any && spec.daysOfWeek.any && spec.months.any && minutes.length === 1 && hours.length === 1) {
    const days = sortedValues(spec.daysOfMonth.values).join(", ");
    return `Monthly on day ${days} at ${localTimes(upcomingRuns, timeZone, locale)[0] ?? "the scheduled local time"}`;
  }
  return "Custom cron schedule";
}

function localTimes(dates: Date[], timeZone: string, locale?: string) {
  const seen = new Set<string>();
  const formatter = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone });
  for (const date of dates) seen.add(formatter.format(date));
  return [...seen].slice(0, 4);
}

function formatDateTime(date: Date, timeZone: string, locale: string | undefined, now: Date) {
  const absolute = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
  return `${absolute} (${relativeLabel(now, date)})`;
}

function formatCompactDateTime(date: Date, timeZone: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

function formatLocalDate(date: Date, timeZone: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

function formatLocalClock(date: Date, timeZone: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

function summarizeOccurrence(date: Date, timeZone: string, locale: string | undefined, now: Date): ImportedScheduleOccurrence {
  return {
    atMs: date.getTime(),
    iso: date.toISOString(),
    label: formatDateTime(date, timeZone, locale, now),
    compactLabel: formatCompactDateTime(date, timeZone, locale),
    dateLabel: formatLocalDate(date, timeZone, locale),
    clockLabel: formatLocalClock(date, timeZone, locale),
    relativeLabel: relativeLabel(now, date),
  };
}

function relativeLabel(from: Date, to: Date) {
  const diffMs = to.getTime() - from.getTime();
  const past = diffMs < 0;
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60_000));
  const value = absMinutes < 90
    ? `${absMinutes}m`
    : absMinutes < 48 * 60
      ? `${Math.round(absMinutes / 60)}h`
      : `${Math.round(absMinutes / 1440)}d`;
  return past ? `${value} ago` : `in ${value}`;
}

function sortedValues(values: Set<number>) {
  return [...values].sort((a, b) => a - b);
}

function evenlySpacedStep(values: number[], wrap?: number) {
  if (values.length < 2) return null;
  const diffs = values.map((value, index) => {
    const next = values[(index + 1) % values.length];
    if (index === values.length - 1) return wrap ? next + wrap - value : null;
    return next - value;
  }).filter((value): value is number => value !== null);
  const first = diffs[0];
  return first && diffs.every((diff) => diff === first) ? first : null;
}

function weekdayName(value: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][value] ?? `day ${value}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
