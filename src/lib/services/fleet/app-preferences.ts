import { homedir } from "os";
import { dirname, join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

const APP_PREFERENCES_FILE = join(homedir(), ".hivemindos", "app-preferences.json");
const APP_PREFERENCES_CACHE_MS = 5_000;

export type AppModelPreference = {
  /** Task family the model applies to, e.g. "image" | "video" | free text. */
  task: string;
  model: string;
};

export type ConnectedAppPreference = {
  appId: string;
  appName?: string;
  /** User pinned this app as a priority capability target. */
  priority?: boolean;
  /** Natural-prose routing hint, e.g. "Use this app for anime-style images". */
  usageNotes?: string;
  preferredModels?: AppModelPreference[];
  updatedAt?: number;
};

export type AppPreferenceCarrier = {
  id?: string;
  name?: string;
  priority?: boolean;
  usageNotes?: string;
  preferredModels?: AppModelPreference[];
};

let preferencesCache: { preferences: ConnectedAppPreference[]; readAt: number } | null = null;

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeModelPreferences(value: unknown): AppModelPreference[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      task: cleanText((entry as AppModelPreference)?.task).toLowerCase(),
      model: cleanText((entry as AppModelPreference)?.model),
    }))
    .filter((entry) => entry.task && entry.model)
    .slice(0, 16);
}

export function normalizeAppPreference(value: unknown): ConnectedAppPreference | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const appId = cleanText(record.appId);
  if (!appId) return null;
  return {
    appId,
    appName: cleanText(record.appName) || undefined,
    priority: record.priority === true || undefined,
    usageNotes: cleanText(record.usageNotes).slice(0, 2_000) || undefined,
    preferredModels: normalizeModelPreferences(record.preferredModels),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined,
  };
}

export async function readAppPreferences(): Promise<ConnectedAppPreference[]> {
  const now = Date.now();
  if (preferencesCache && now - preferencesCache.readAt < APP_PREFERENCES_CACHE_MS) {
    return preferencesCache.preferences;
  }
  const raw = await readFile(APP_PREFERENCES_FILE, "utf8").catch(() => "");
  let preferences: ConnectedAppPreference[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { preferences?: unknown[] };
      preferences = (parsed.preferences ?? [])
        .map(normalizeAppPreference)
        .filter((entry): entry is ConnectedAppPreference => entry !== null);
    } catch {
      preferences = [];
    }
  }
  preferencesCache = { preferences, readAt: now };
  return preferences;
}

async function writeAppPreferences(preferences: ConnectedAppPreference[]) {
  await mkdir(dirname(APP_PREFERENCES_FILE), { recursive: true });
  await writeFile(APP_PREFERENCES_FILE, JSON.stringify({ version: 1, preferences }, null, 2), "utf8");
  preferencesCache = { preferences, readAt: Date.now() };
}

function appIdHostPort(value?: string) {
  const match = /^(.+):(\d+):(.+)$/.exec(cleanText(value));
  if (!match) return null;
  return { host: match[1], port: Number(match[2]) };
}

function normalizeName(value?: string) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Discovered app ids can drift (host:port:name composites), so match exact id
 * first, then host:port, then the remembered app name.
 */
export function appPreferenceFor(
  app: { id?: string; name?: string },
  preferences: ConnectedAppPreference[],
): ConnectedAppPreference | null {
  const appId = cleanText(app.id);
  if (appId) {
    const exact = preferences.find((preference) => preference.appId === appId);
    if (exact) return exact;
    const hostPort = appIdHostPort(appId);
    if (hostPort) {
      const hostMatch = preferences.find((preference) => {
        const candidate = appIdHostPort(preference.appId);
        return candidate !== null && candidate.host === hostPort.host && candidate.port === hostPort.port;
      });
      if (hostMatch) return hostMatch;
    }
  }
  const name = normalizeName(app.name);
  if (!name) return null;
  return preferences.find((preference) => normalizeName(preference.appName) === name) ?? null;
}

export async function saveAppPreference(input: unknown): Promise<ConnectedAppPreference> {
  const preference = normalizeAppPreference(input);
  if (!preference) throw new Error("appId is required to save an app preference.");
  preference.updatedAt = Date.now();
  const preferences = await readAppPreferences();
  const next = preferences.filter((entry) => entry.appId !== preference.appId);
  const isEmpty = !preference.priority && !preference.usageNotes && !(preference.preferredModels?.length);
  if (!isEmpty) next.push(preference);
  await writeAppPreferences(next);
  return preference;
}

export async function deleteAppPreference(appId: string) {
  const trimmed = cleanText(appId);
  if (!trimmed) throw new Error("appId is required to delete an app preference.");
  const preferences = await readAppPreferences();
  await writeAppPreferences(preferences.filter((entry) => entry.appId !== trimmed));
}

/** Merge stored user preferences onto discovered app records. */
export function applyAppPreferences<T extends AppPreferenceCarrier>(
  apps: T[],
  preferences: ConnectedAppPreference[],
): T[] {
  if (!preferences.length) return apps;
  return apps.map((app) => {
    const preference = appPreferenceFor(app, preferences);
    if (!preference) return app;
    return {
      ...app,
      priority: preference.priority === true,
      usageNotes: preference.usageNotes,
      preferredModels: preference.preferredModels?.length ? preference.preferredModels : undefined,
    };
  });
}

/** Token overlap between a task/prompt and an app's usage notes (0 when either side is empty). */
export function usageNoteAffinity(taskText: string, usageNotes?: string) {
  const notes = cleanText(usageNotes).toLowerCase();
  const text = cleanText(taskText).toLowerCase();
  if (!notes || !text) return 0;
  const noteTokens = new Set(notes.split(/[^a-z0-9]+/).filter((token) => token.length >= 4));
  if (!noteTokens.size) return 0;
  let overlap = 0;
  for (const token of new Set(text.split(/[^a-z0-9]+/))) {
    if (noteTokens.has(token)) overlap += 1;
  }
  return overlap;
}

export function preferredModelFor(task: string, preferredModels?: AppModelPreference[]) {
  const normalized = cleanText(task).toLowerCase();
  if (!normalized || !preferredModels?.length) return "";
  const exact = preferredModels.find((entry) => entry.task === normalized);
  if (exact) return exact.model;
  const partial = preferredModels.find((entry) => entry.task.includes(normalized) || normalized.includes(entry.task));
  return partial?.model ?? "";
}
