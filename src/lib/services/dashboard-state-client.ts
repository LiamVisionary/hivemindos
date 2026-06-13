export type DashboardStateSnapshot = Record<string, string>;

const DASHBOARD_STATE_ENDPOINT = "/api/dashboard/state";
const SAVE_RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

let cachedSnapshot: DashboardStateSnapshot | null = null;
const saveRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveRetryAttempts = new Map<string, number>();

async function postDashboardState(body: { values?: DashboardStateSnapshot; remove?: string[] }) {
  const response = await fetch(DASHBOARD_STATE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as { ok?: boolean } | null;
  return Boolean(response?.ok && data?.ok);
}

function cancelSaveRetry(key: string) {
  const timer = saveRetryTimers.get(key);
  if (timer) clearTimeout(timer);
  saveRetryTimers.delete(key);
  saveRetryAttempts.delete(key);
}

// A restarting dev server (proxy 503) makes saves fail transiently; re-send the
// latest value for the key instead of dropping it.
function scheduleSaveRetry(key: string, fallbackValue: string) {
  const attempt = saveRetryAttempts.get(key) ?? 0;
  if (attempt >= SAVE_RETRY_DELAYS_MS.length || saveRetryTimers.has(key)) return;
  saveRetryAttempts.set(key, attempt + 1);
  saveRetryTimers.set(key, setTimeout(() => {
    saveRetryTimers.delete(key);
    const value = cachedSnapshot?.[key] ?? fallbackValue;
    void postDashboardState({ values: { [key]: value } }).then((ok) => {
      if (ok) saveRetryAttempts.delete(key);
      else scheduleSaveRetry(key, value);
    });
  }, SAVE_RETRY_DELAYS_MS[attempt]));
}

const SNAPSHOT_RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000];
const SNAPSHOT_RETRY_MAX_DELAY_MS = 5_000;

export class DashboardStateAuthError extends Error {
  constructor(message = "Dashboard authentication is required.") {
    super(message);
    this.name = "DashboardStateAuthError";
  }
}

function redirectToDashboardUnlock(message?: string): Promise<DashboardStateSnapshot> {
  if (typeof window === "undefined") {
    throw new DashboardStateAuthError(message);
  }
  const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(currentRoute);
  return new Promise(() => {});
}

// Booting from an empty snapshot is destructive: hydration seeds in-memory state
// from it, and the next persist overwrites the server's stored values (chat
// history included). A transient failure (restarting dev server, proxy 503)
// or an auth failure must therefore block hydration, never resolve to {}.
export async function loadDashboardStateSnapshot(): Promise<DashboardStateSnapshot> {
  if (cachedSnapshot) return cachedSnapshot;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(DASHBOARD_STATE_ENDPOINT, {
      cache: "no-store",
      headers: { accept: "application/json" },
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; values?: DashboardStateSnapshot } | null;
    if (response?.ok && data?.ok && data.values && typeof data.values === "object") {
      cachedSnapshot = data.values;
      return cachedSnapshot;
    }
    if (response?.status === 401) {
      return redirectToDashboardUnlock(data?.error);
    }
    if (response && response.status < 500 && data) {
      throw new Error(data.error ?? `Dashboard state request failed with HTTP ${response.status}.`);
    }
    const delay = SNAPSHOT_RETRY_DELAYS_MS[attempt] ?? SNAPSHOT_RETRY_MAX_DELAY_MS;
    console.warn(`Dashboard state unavailable (attempt ${attempt + 1}); retrying in ${delay}ms.`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export function dashboardStateValue(snapshot: DashboardStateSnapshot, key: string, suffix?: string): string | null {
  const current = snapshot[key];
  if (current !== undefined) return current;
  if (!suffix) return null;
  const migratedKey = Object.keys(snapshot).find((candidate) => candidate !== key && candidate.endsWith(suffix));
  return migratedKey ? snapshot[migratedKey] ?? null : null;
}

// Boot and view switches flip a single `hydrated` flag, which fires ~14 separate
// persist effects in the same commit — each previously its own POST, producing
// the request storm seen in dev logs. Coalesce every save/remove issued within a
// tick into one POST carrying all keys (the route accepts `values` + `remove`
// together). Each caller still gets a Promise<boolean> resolving to whether the
// batch stored, and failed value writes still fall back to per-key retry.
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let coalescedValues: DashboardStateSnapshot = {};
let coalescedRemovals = new Set<string>();
let coalescedWaiters: Array<(ok: boolean) => void> = [];

function scheduleCoalescedFlush() {
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(flushCoalescedState, 0);
}

function flushCoalescedState() {
  coalesceTimer = null;
  const values = coalescedValues;
  const removals = [...coalescedRemovals];
  const waiters = coalescedWaiters;
  coalescedValues = {};
  coalescedRemovals = new Set();
  coalescedWaiters = [];

  const hasValues = Object.keys(values).length > 0;
  if (!hasValues && removals.length === 0) {
    waiters.forEach((resolve) => resolve(true));
    return;
  }
  for (const key of Object.keys(values)) cancelSaveRetry(key);
  for (const key of removals) cancelSaveRetry(key);

  void postDashboardState({
    values: hasValues ? values : undefined,
    remove: removals.length ? removals : undefined,
  }).then((saved) => {
    // Value writes retry per-key on failure; removals stay best-effort as before.
    if (!saved) {
      for (const [key, value] of Object.entries(values)) scheduleSaveRetry(key, value);
    }
    waiters.forEach((resolve) => resolve(saved));
  });
}

export function saveDashboardStateValue(key: string, value: string): Promise<boolean> {
  if (cachedSnapshot) cachedSnapshot = { ...cachedSnapshot, [key]: value };
  cancelSaveRetry(key);
  coalescedRemovals.delete(key);
  coalescedValues = { ...coalescedValues, [key]: value };
  return new Promise<boolean>((resolve) => {
    coalescedWaiters.push(resolve);
    scheduleCoalescedFlush();
  });
}

export function saveDashboardStateValues(values: DashboardStateSnapshot): Promise<boolean> {
  if (cachedSnapshot) cachedSnapshot = { ...cachedSnapshot, ...values };
  for (const key of Object.keys(values)) {
    cancelSaveRetry(key);
    coalescedRemovals.delete(key);
  }
  coalescedValues = { ...coalescedValues, ...values };
  return new Promise<boolean>((resolve) => {
    coalescedWaiters.push(resolve);
    scheduleCoalescedFlush();
  });
}

export function removeDashboardStateValue(key: string): Promise<boolean> {
  if (cachedSnapshot) {
    const next = { ...cachedSnapshot };
    delete next[key];
    cachedSnapshot = next;
  }
  cancelSaveRetry(key);
  if (key in coalescedValues) {
    const next = { ...coalescedValues };
    delete next[key];
    coalescedValues = next;
  }
  coalescedRemovals.add(key);
  return new Promise<boolean>((resolve) => {
    coalescedWaiters.push(resolve);
    scheduleCoalescedFlush();
  });
}
