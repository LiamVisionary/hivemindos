import { runInboxTriage } from "@/lib/services/brain/inbox-triage";
import { processPendingBrainDropInbox } from "@/lib/services/brain/brain-drop-intake";
import { publishInboxTriageNotification } from "@/lib/services/brain/inbox-triage-notifications";

// Perpetual driver for immediate Brain Drop intake plus the report-only daily
// Inbox Triage audit. Mirrors the
// company-autonomy-driver runner shape (globalThis-backed so dev HMR reloads
// don't spawn duplicates), but deliberately skips the machine-wide lease:
// runInboxTriage self-gates on "today's report already exists", so concurrent
// server processes at worst rewrite the same report-only file once.

export type InboxTriageDriverStatus = {
  status: "running" | "stopped";
  startedAt?: string;
  tickCount?: number;
  lastTickAt?: string;
  lastRunReason?: string;
  lastReportDate?: string;
  lastNotificationAt?: string;
  lastNotificationError?: string;
  lastProcessedCount?: number;
  lastProcessingError?: string;
  lastError?: string;
};

type Runner = InboxTriageDriverStatus & { stopRequested: boolean; stopped: Promise<void> };

const globalState = globalThis as typeof globalThis & {
  __hivemindInboxTriageDriver?: Runner;
};

function envNum(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// 15-minute polling retries interrupted/native inbox processing and keeps the
// daily report within a quarter hour of the configured report hour.
const tickIntervalMs = () => envNum("HIVEMINDOS_INBOX_TRIAGE_TICK_MS", 900_000);

export function inboxTriageDriverDisabled(): boolean {
  return (process.env.HIVEMINDOS_INBOX_TRIAGE || "").trim() === "0";
}

function sleepUnlessStopped(runner: Runner, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const interval = setInterval(() => {
      if (runner.stopRequested || Date.now() - started >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

async function loop(runner: Runner): Promise<void> {
  while (!runner.stopRequested) {
    try {
      const processing = await processPendingBrainDropInbox({ limit: 20 }).catch((error) => {
        runner.lastProcessingError = error instanceof Error ? error.message : String(error);
        return null;
      });
      const result = await runInboxTriage();
      runner.tickCount = (runner.tickCount ?? 0) + 1;
      runner.lastTickAt = new Date().toISOString();
      runner.lastRunReason = result.ran ? "reported" : result.reason;
      if (result.ran) {
        const notification = await publishInboxTriageNotification(result);
        if (notification.persisted || notification.desktop) runner.lastNotificationAt = new Date().toISOString();
        runner.lastNotificationError = notification.errors.length ? notification.errors.join("; ") : undefined;
      }
      if (processing) {
        runner.lastProcessedCount = processing.processed;
        runner.lastProcessingError = undefined;
      }
      if (result.reportDate) runner.lastReportDate = result.reportDate;
      runner.lastError = undefined;
    } catch (error) {
      runner.lastError = error instanceof Error ? error.message : String(error);
    }
    if (runner.stopRequested) break;
    await sleepUnlessStopped(runner, tickIntervalMs());
  }
}

export function startInboxTriageDriver(): InboxTriageDriverStatus {
  if (inboxTriageDriverDisabled()) {
    return { status: "stopped", lastError: "Disabled via HIVEMINDOS_INBOX_TRIAGE=0" };
  }
  const existing = globalState.__hivemindInboxTriageDriver;
  if (existing?.status === "running") return getInboxTriageDriverStatus();

  const runner: Runner = {
    status: "running",
    startedAt: new Date().toISOString(),
    tickCount: 0,
    stopRequested: false,
    stopped: Promise.resolve(),
  };
  runner.stopped = loop(runner)
    .then(() => {
      runner.status = "stopped";
    })
    .catch((error) => {
      runner.status = "stopped";
      runner.lastError = error instanceof Error ? error.message : String(error);
    });
  globalState.__hivemindInboxTriageDriver = runner;
  return getInboxTriageDriverStatus();
}

export async function stopInboxTriageDriver(): Promise<InboxTriageDriverStatus> {
  const runner = globalState.__hivemindInboxTriageDriver;
  if (runner && runner.status === "running") {
    runner.stopRequested = true;
    await runner.stopped;
  }
  return getInboxTriageDriverStatus();
}

export function getInboxTriageDriverStatus(): InboxTriageDriverStatus {
  const runner = globalState.__hivemindInboxTriageDriver;
  if (!runner) return { status: "stopped" };
  return {
    status: runner.status,
    startedAt: runner.startedAt,
    tickCount: runner.tickCount,
    lastTickAt: runner.lastTickAt,
    lastRunReason: runner.lastRunReason,
    lastReportDate: runner.lastReportDate,
    lastNotificationAt: runner.lastNotificationAt,
    lastNotificationError: runner.lastNotificationError,
    lastProcessedCount: runner.lastProcessedCount,
    lastProcessingError: runner.lastProcessingError,
    lastError: runner.lastError,
  };
}
