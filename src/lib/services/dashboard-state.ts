import "server-only";

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";

export type DashboardStateValues = Record<string, string>;

const DASHBOARD_STATE_FILE = join(homedir(), ".hivemindos", "dashboard-state.json");
let dashboardStateWriteQueue: Promise<DashboardStateFile> = Promise.resolve(emptyState());

type DashboardStateFile = {
  version: 1;
  values: DashboardStateValues;
  updatedAt: string;
};

function emptyState(): DashboardStateFile {
  return {
    version: 1,
    values: {},
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeStateFile(value: unknown): DashboardStateFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyState();
  const record = value as Partial<DashboardStateFile>;
  const values = record.values && typeof record.values === "object" && !Array.isArray(record.values)
    ? Object.fromEntries(Object.entries(record.values).filter(([key, item]) => key.trim() && typeof item === "string"))
    : {};
  return {
    version: 1,
    values,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
  };
}

export async function readDashboardState(): Promise<DashboardStateFile> {
  try {
    return await readDashboardStateStrict();
  } catch {
    return emptyState();
  }
}

/**
 * Like `readDashboardState`, but a read or parse failure of an EXISTING state
 * file throws instead of masquerading as empty state. A missing file is still
 * the empty state — absence is a legitimate fresh install, not an outage. For
 * callers whose fallback on "empty" is dangerous (e.g. voice continuity treats
 * "no prefs" as "cloud voice selected").
 */
export async function readDashboardStateStrict(): Promise<DashboardStateFile> {
  let rawState: string;
  try {
    rawState = await readFile(DASHBOARD_STATE_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyState();
    throw error;
  }
  if (!rawState.trim()) return emptyState();
  return normalizeStateFile(JSON.parse(rawState) as unknown);
}

async function writeDashboardState(state: DashboardStateFile) {
  await mkdir(dirname(DASHBOARD_STATE_FILE), { recursive: true, mode: 0o700 });
  const temporaryPath = `${DASHBOARD_STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, DASHBOARD_STATE_FILE);
}

export async function updateDashboardState(input: {
  values?: DashboardStateValues;
  remove?: string[];
}): Promise<DashboardStateFile> {
  const write = async () => {
    const current = await readDashboardState();
    const values = { ...current.values };
    for (const key of input.remove ?? []) {
      if (typeof key === "string" && key.trim()) delete values[key];
    }
    for (const [key, value] of Object.entries(input.values ?? {})) {
      if (!key.trim() || typeof value !== "string") continue;
      values[key] = value;
    }
    const next = {
      version: 1 as const,
      values,
      updatedAt: new Date().toISOString(),
    };
    await writeDashboardState(next);
    return next;
  };
  dashboardStateWriteQueue = dashboardStateWriteQueue.catch(() => emptyState()).then(write);
  return dashboardStateWriteQueue;
}

/**
 * Read-modify-write a single state value inside the write queue, so two
 * concurrent mutations of the same key (e.g. agent-profile upserts from a
 * phone) can never lose each other's writes.
 */
export async function mutateDashboardStateValue(
  key: string,
  mutate: (current: string | null) => string,
): Promise<DashboardStateFile> {
  const write = async () => {
    const current = await readDashboardState();
    const values = { ...current.values, [key]: mutate(current.values[key] ?? null) };
    const next = {
      version: 1 as const,
      values,
      updatedAt: new Date().toISOString(),
    };
    await writeDashboardState(next);
    return next;
  };
  dashboardStateWriteQueue = dashboardStateWriteQueue.catch(() => emptyState()).then(write);
  return dashboardStateWriteQueue;
}
