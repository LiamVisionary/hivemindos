"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, ImageIcon, LoaderCircle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AppPreferenceRecord = {
  appId: string;
  appName?: string;
  priority?: boolean;
  usageNotes?: string;
  preferredModels?: Array<{ task: string; model: string }>;
};

type AppModelOption = {
  id: string;
  label: string;
  kind: "image" | "video" | "other";
  source: string;
};

type AppPreferencesCardProps = {
  app: {
    id: string;
    name: string;
    kind: string;
    apiBaseUrl?: string;
    apiRoutes?: Array<{ method: string; path: string; summary?: string }>;
  };
  preference: AppPreferenceRecord | null;
  onSaved: (preference: AppPreferenceRecord) => void;
};

function appIdHostPort(value: string) {
  const match = /^(.+):(\d+):(.+)$/.exec(value.trim());
  if (!match) return null;
  return { host: match[1], port: Number(match[2]) };
}

export function matchAppPreference(
  app: { id: string; name: string },
  preferences: AppPreferenceRecord[],
): AppPreferenceRecord | null {
  const exact = preferences.find((preference) => preference.appId === app.id);
  if (exact) return exact;
  const hostPort = appIdHostPort(app.id);
  if (hostPort) {
    const hostMatch = preferences.find((preference) => {
      const candidate = appIdHostPort(preference.appId);
      return candidate !== null && candidate.host === hostPort.host && candidate.port === hostPort.port;
    });
    if (hostMatch) return hostMatch;
  }
  const name = app.name.trim().toLowerCase();
  return preferences.find((preference) => (preference.appName ?? "").trim().toLowerCase() === name) ?? null;
}

export function isGenerativeApp(app: { kind: string; apiRoutes?: Array<{ path: string; summary?: string }> }) {
  if (["ai", "creative", "media"].includes(app.kind)) return true;
  const routeText = (app.apiRoutes ?? []).map((route) => `${route.path} ${route.summary ?? ""}`).join(" ").toLowerCase();
  return /generate|txt2img|image|video|diffusion/.test(routeText);
}

const MODEL_TASK_LABELS: Array<{ task: "image" | "video"; label: string; icon: typeof ImageIcon }> = [
  { task: "image", label: "Image model", icon: ImageIcon },
  { task: "video", label: "Video model", icon: Clapperboard },
];

export function AppPreferencesCard({ app, preference, onSaved }: AppPreferencesCardProps) {
  const [priority, setPriority] = useState(preference?.priority === true);
  const [usageNotes, setUsageNotes] = useState(preference?.usageNotes ?? "");
  const [preferredModels, setPreferredModels] = useState<Array<{ task: string; model: string }>>(preference?.preferredModels ?? []);
  const [models, setModels] = useState<AppModelOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const generative = isGenerativeApp(app);
  const modelsLoading = generative && Boolean(app.apiBaseUrl) && models === null;
  const savedTimerRef = useRef<number | null>(null);

  // Preferences load async in the parent; re-seed local form state when the
  // stored record for this app arrives or changes (render-time adjustment).
  const [seededPreference, setSeededPreference] = useState(preference);
  if (preference !== seededPreference) {
    setSeededPreference(preference);
    setPriority(preference?.priority === true);
    setUsageNotes(preference?.usageNotes ?? "");
    setPreferredModels(preference?.preferredModels ?? []);
  }

  const notesDirty = usageNotes !== (preference?.usageNotes ?? "");

  useEffect(() => {
    if (!generative || !app.apiBaseUrl) return;
    let cancelled = false;
    fetch(`/api/fleet/apps/models?appId=${encodeURIComponent(app.id)}`, { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((payload: { ok?: boolean; models?: AppModelOption[] } | null) => {
        if (!cancelled) setModels(payload?.ok && Array.isArray(payload.models) ? payload.models : []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [app.id, app.apiBaseUrl, generative]);

  const persist = useCallback(async (next: AppPreferenceRecord) => {
    setSaving(true);
    setSaveState("idle");
    try {
      const response = await fetch("/api/fleet/apps/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; preference?: AppPreferenceRecord } | null;
      if (!response.ok || !payload?.ok) throw new Error("save failed");
      onSaved(payload.preference ?? next);
      setSaveState("saved");
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaveState("idle"), 1600);
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }, [onSaved]);

  const buildPreference = useCallback((overrides: Partial<AppPreferenceRecord>): AppPreferenceRecord => ({
    appId: app.id,
    appName: app.name,
    priority,
    usageNotes: usageNotes.trim() || undefined,
    preferredModels,
    ...overrides,
  }), [app.id, app.name, priority, usageNotes, preferredModels]);

  const togglePriority = () => {
    const next = !priority;
    setPriority(next);
    void persist(buildPreference({ priority: next }));
  };

  const saveNotes = () => {
    void persist(buildPreference({}));
  };

  const setTaskModel = (task: string, model: string) => {
    const next = preferredModels.filter((entry) => entry.task !== task);
    if (model) next.push({ task, model });
    setPreferredModels(next);
    void persist(buildPreference({ preferredModels: next }));
  };

  const modelsByTask = useMemo(() => {
    const grouped = new Map<"image" | "video", AppModelOption[]>();
    for (const model of models ?? []) {
      const task = model.kind === "video" ? "video" : "image";
      grouped.set(task, [...(grouped.get(task) ?? []), model]);
    }
    return grouped;
  }, [models]);

  return (
    <div className="grid gap-3 rounded-md border border-[rgba(251,191,36,0.18)] bg-[rgba(10,14,21,0.55)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Star aria-hidden="true" className={`h-4 w-4 ${priority ? "fill-[#fbbf24] text-[#fbbf24]" : "text-[var(--muted)]"}`} />
          Agent preferences
        </div>
        <div className="flex items-center gap-2">
          {saving ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-[var(--muted)]" /> : null}
          {saveState === "saved" ? <span className="text-[10px] font-black uppercase text-[var(--accent-strong)]">Saved</span> : null}
          {saveState === "error" ? <span className="text-[10px] font-black uppercase text-[#fca5a5]">Save failed</span> : null}
          <Button
            type="button"
            size="sm"
            variant={priority ? "default" : "secondary"}
            className="h-8 px-2.5 text-xs"
            onClick={togglePriority}
            disabled={saving}
          >
            <Star aria-hidden="true" className={`h-3.5 w-3.5 ${priority ? "fill-current" : ""}`} />
            {priority ? "Priority app" : "Make priority"}
          </Button>
        </div>
      </div>

      <p className="m-0 text-xs leading-5 text-[var(--muted)]">
        Tell agents when to pick this app. Capability search and image routing read these hints, so a request like &quot;generate a realistic image&quot; lands on the right app.
      </p>

      <div className="grid gap-1.5">
        <label htmlFor={`app-usage-notes-${app.id}`} className="text-xs font-bold text-[var(--foreground)]">
          Use this app for...
        </label>
        <textarea
          id={`app-usage-notes-${app.id}`}
          value={usageNotes}
          onChange={(event) => setUsageNotes(event.target.value)}
          placeholder="e.g. Use this app for realistic photo-style images; avoid it for anime."
          rows={3}
          className="w-full resize-y rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.44)] px-3 py-2 text-sm leading-5 text-[var(--foreground)] placeholder:text-[var(--muted)] focus:border-[rgba(94,234,212,0.4)] focus:outline-none"
        />
        {notesDirty ? (
          <Button type="button" size="sm" variant="secondary" className="h-8 w-fit px-2.5 text-xs" onClick={saveNotes} disabled={saving}>
            Save notes
          </Button>
        ) : null}
      </div>

      {generative && app.apiBaseUrl ? (
        <div className="grid gap-3">
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              Discovering models from the app...
            </div>
          ) : null}
          {!modelsLoading && models !== null && models.length === 0 ? (
            <p className="m-0 text-xs leading-5 text-[var(--muted)]">
              This app did not publish a model list. Agents will use the app default.
            </p>
          ) : null}
          {MODEL_TASK_LABELS.map(({ task, label, icon: Icon }) => {
            const options = modelsByTask.get(task) ?? [];
            if (!options.length) return null;
            const selected = preferredModels.find((entry) => entry.task === task)?.model ?? "";
            return (
              <div key={task} className="grid gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
                  <Icon aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent-strong)]" />
                  {label}
                </span>
                {options.length <= 6 ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTaskModel(task, "")}
                      className={`rounded-md border px-2.5 py-1.5 text-xs font-bold transition ${selected === ""
                        ? "border-[rgba(94,234,212,0.45)] bg-[rgba(20,184,166,0.14)] text-[var(--accent-strong)]"
                        : "border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.40)] text-[var(--muted)] hover:border-[rgba(148,163,184,0.34)]"}`}
                    >
                      App default
                    </button>
                    {options.map((model) => (
                      <button
                        type="button"
                        key={model.id}
                        onClick={() => setTaskModel(task, model.id)}
                        title={model.id}
                        className={`max-w-[16rem] truncate rounded-md border px-2.5 py-1.5 text-xs font-bold transition ${selected === model.id
                          ? "border-[rgba(94,234,212,0.45)] bg-[rgba(20,184,166,0.14)] text-[var(--accent-strong)]"
                          : "border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.40)] text-[var(--muted)] hover:border-[rgba(148,163,184,0.34)]"}`}
                      >
                        {model.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <select
                    value={selected}
                    onChange={(event) => setTaskModel(task, event.target.value)}
                    className="w-full rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(2,6,23,0.44)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[rgba(94,234,212,0.4)] focus:outline-none"
                  >
                    <option value="">App default</option>
                    {options.map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
