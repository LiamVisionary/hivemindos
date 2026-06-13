import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type DashboardStateSnapshot = Record<string, string>;

const DASHBOARD_STATE_ENDPOINT = "/api/dashboard/state";
const SAVE_RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

let cachedSnapshot: DashboardStateSnapshot | null = null;
const saveRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveRetryAttempts = new Map<string, number>();

// The packaged desktop app ships a static UI with no Next server, so `/api/*`
// doesn't exist there — dashboard state goes through native Tauri commands
// (src-tauri/src/dashboard_state.rs) instead of HTTP. The web app and a paired
// phone (no Tauri runtime) keep using the HTTP route.
async function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function postDashboardState(body: { values?: DashboardStateSnapshot; remove?: string[] }) {
  if (isTauriDesktopRuntime()) {
    try {
      const result = await nativeInvoke<{ ok?: boolean }>("dashboard_state_write", {
        values: body.values ?? {},
        remove: body.remove ?? [],
      });
      return Boolean(result?.ok);
    } catch {
      return false;
    }
  }
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

// Why an outage retried forever, never an {} fallback: hydration seeds in-memory
// state from this snapshot, and the next persist overwrites the server's stored
// values (chat history included). Resolving a transient failure (restarting dev
// server, proxy 503, embedded server still booting) to {} would wipe real data.
export type SnapshotRetryKind = "network" | "server" | "non-json";
export type SnapshotRetryInfo = {
  // 1-based count of consecutive failed attempts so far.
  attempt: number;
  // HTTP status of the failed response, or null when the fetch never connected.
  status: number | null;
  kind: SnapshotRetryKind;
};

export class DashboardStateAuthError extends Error {
  constructor(message = "Dashboard authentication is required.") {
    super(message);
    this.name = "DashboardStateAuthError";
  }
}

// On auth denial we must not return {} (that would hydrate a fake-empty
// dashboard). In the browser, navigate to the current route so the app falls
// back to its unlock flow; the returned promise never resolves, so hydration
// can't seed {} while navigation is in flight. With no window (server/SSR)
// there is nothing to navigate to, so surface the error to the caller.
function redirectToDashboardUnlock(message?: string): Promise<DashboardStateSnapshot> {
  if (typeof window === "undefined") {
    throw new DashboardStateAuthError(message);
  }
  const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(currentRoute);
  return new Promise(() => {});
}

// The retry loop never gives up (see above), so a *persistent* backend failure
// would otherwise hang hydration — and every dashboard loading screen with it —
// indefinitely. onRetry lets the caller surface a recoverable "still connecting"
// notice after a few failures while the loop keeps trying in the background and
// auto-recovers the moment the server answers. It must never resolve to {}.
export async function loadDashboardStateSnapshot(
  onRetry?: (info: SnapshotRetryInfo) => void,
): Promise<DashboardStateSnapshot> {
  if (cachedSnapshot) return cachedSnapshot;
  // Native desktop: read the local store directly. Unlike the HTTP path there's
  // no server outage to ride out — a missing file is genuinely empty (fresh
  // install), and native writes merge per-key, so an empty boot can't clobber.
  if (isTauriDesktopRuntime()) {
    try {
      const result = await nativeInvoke<{ values?: DashboardStateSnapshot }>("dashboard_state_read");
      cachedSnapshot = result?.values && typeof result.values === "object" ? result.values : {};
      return cachedSnapshot;
    } catch (error) {
      console.warn("Native dashboard state read failed; booting empty.", error);
      return {};
    }
  }
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(DASHBOARD_STATE_ENDPOINT, {
      cache: "no-store",
      headers: { accept: "application/json" },
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; values?: DashboardStateSnapshot; error?: string } | null;
    if (response?.ok && data?.ok && data.values && typeof data.values === "object") {
      cachedSnapshot = data.values;
      return cachedSnapshot;
    }
    // Auth denial is NOT an empty dashboard. Treating a 401 as {} would hydrate
    // a fake-empty UI (0 notes) and mask an expired session; bounce to the
    // unlock flow instead so the user re-authenticates rather than seeing empty.
    if (response?.status === 401) {
      return redirectToDashboardUnlock(data?.error);
    }
    // Any other non-5xx JSON answer (e.g. a legitimately empty store) is the
    // server's real state, not an outage: return it without caching so a later
    // reload re-checks instead of reusing the empty result.
    if (response && response.status < 500 && data) {
      return data.values && typeof data.values === "object" ? data.values : {};
    }
    const kind: SnapshotRetryKind = !response ? "network" : response.status >= 500 ? "server" : "non-json";
    onRetry?.({ attempt: attempt + 1, status: response?.status ?? null, kind });
    const delay = SNAPSHOT_RETRY_DELAYS_MS[attempt] ?? SNAPSHOT_RETRY_MAX_DELAY_MS;
    console.warn(`Dashboard state unavailable (attempt ${attempt + 1}, ${kind}${response ? ` ${response.status}` : ""}); retrying in ${delay}ms.`);
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

export async function saveDashboardStateValue(key: string, value: string) {
  if (cachedSnapshot) cachedSnapshot = { ...cachedSnapshot, [key]: value };
  cancelSaveRetry(key);
  const saved = await postDashboardState({ values: { [key]: value } });
  if (!saved) scheduleSaveRetry(key, value);
  return saved;
}

export async function saveDashboardStateValues(values: DashboardStateSnapshot) {
  if (cachedSnapshot) cachedSnapshot = { ...cachedSnapshot, ...values };
  for (const key of Object.keys(values)) cancelSaveRetry(key);
  const saved = await postDashboardState({ values });
  if (!saved) {
    for (const [key, value] of Object.entries(values)) scheduleSaveRetry(key, value);
  }
  return saved;
}

export async function removeDashboardStateValue(key: string) {
  if (cachedSnapshot) {
    const next = { ...cachedSnapshot };
    delete next[key];
    cachedSnapshot = next;
  }
  cancelSaveRetry(key);
  return postDashboardState({ remove: [key] });
}
