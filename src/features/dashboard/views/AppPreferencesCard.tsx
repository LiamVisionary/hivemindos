"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, ImageIcon, LoaderCircle, Star } from "lucide-react";

export type AppPreferenceRecord = {
  appId: string;
  appName?: string;
  priority?: boolean;
  usageNotes?: string;
  capabilities?: string[];
  preferredModels?: Array<{ task: string; model: string }>;
};

function parseCapabilities(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim().toLowerCase().slice(0, 40);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

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
  const [capabilities, setCapabilities] = useState((preference?.capabilities ?? []).join(", "));
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
    setCapabilities((preference?.capabilities ?? []).join(", "));
    setPreferredModels(preference?.preferredModels ?? []);
  }

  const notesDirty = usageNotes !== (preference?.usageNotes ?? "");
  const capabilitiesDirty = parseCapabilities(capabilities).join(", ") !== (preference?.capabilities ?? []).join(", ");

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
    capabilities: parseCapabilities(capabilities),
    preferredModels,
    ...overrides,
  }), [app.id, app.name, priority, usageNotes, capabilities, preferredModels]);

  const saveCapabilities = () => {
    void persist(buildPreference({}));
  };

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
    <div className="fa-pref">
      <div className="fa-pref-head">
        <h4 className="fa-pref-title">
          <Star aria-hidden="true" data-on={priority ? "" : undefined} />
          Agent preferences
        </h4>
        <div className="fa-pref-status">
          {saving ? <LoaderCircle aria-hidden="true" className="fa-spin" style={{ width: 14, height: 14, color: "var(--fg-3)" }} /> : null}
          {saveState === "saved" ? <span className="fa-pref-flag" data-tone="ok">Saved</span> : null}
          {saveState === "error" ? <span className="fa-pref-flag" data-tone="error">Save failed</span> : null}
          <button type="button" className="fa-act" data-active={priority ? "" : undefined} onClick={togglePriority} disabled={saving}>
            <Star aria-hidden="true" data-on={priority ? "" : undefined} />
            {priority ? "Priority app" : "Make priority"}
          </button>
        </div>
      </div>

      <p className="fa-pref-lead">
        Tell agents when to pick this app. Capability search and image routing read these hints, so a request like &quot;generate a realistic image&quot; lands on the right app.
      </p>

      <div className="fa-pref-field">
        <label htmlFor={`app-usage-notes-${app.id}`} className="fa-pref-label">Use this app for</label>
        <textarea
          id={`app-usage-notes-${app.id}`}
          className="fb-textarea"
          value={usageNotes}
          onChange={(event) => setUsageNotes(event.target.value)}
          placeholder="e.g. Use this app for realistic photo-style images; avoid it for anime."
          rows={3}
          style={{ resize: "vertical" }}
        />
        {notesDirty ? (
          <button type="button" className="fa-act" style={{ width: "fit-content" }} onClick={saveNotes} disabled={saving}>Save notes</button>
        ) : null}
      </div>

      <div className="fa-pref-field">
        <label htmlFor={`app-capabilities-${app.id}`} className="fa-pref-label">What this app can do</label>
        <input
          id={`app-capabilities-${app.id}`}
          className="fb-field"
          value={capabilities}
          onChange={(event) => setCapabilities(event.target.value)}
          placeholder="e.g. video, image-to-video"
        />
        <p className="fa-pref-hint">
          Comma-separated capability tags. Agents see these in the connected-app roster so they know what this app does — even when the app doesn&apos;t advertise it itself.
        </p>
        {capabilitiesDirty ? (
          <button type="button" className="fa-act" style={{ width: "fit-content" }} onClick={saveCapabilities} disabled={saving}>Save capabilities</button>
        ) : null}
      </div>

      {generative && app.apiBaseUrl ? (
        <div className="fa-pref-models">
          {modelsLoading ? (
            <div className="fa-pref-spinner">
              <LoaderCircle aria-hidden="true" className="fa-spin" />
              Discovering models from the app…
            </div>
          ) : null}
          {!modelsLoading && models !== null && models.length === 0 ? (
            <p className="fa-pref-hint">This app did not publish a model list. Agents will use the app default.</p>
          ) : null}
          {MODEL_TASK_LABELS.map(({ task, label, icon: Icon }) => {
            const options = modelsByTask.get(task) ?? [];
            if (!options.length) return null;
            const selected = preferredModels.find((entry) => entry.task === task)?.model ?? "";
            return (
              <div key={task} className="fa-pref-field">
                <span className="fa-pref-model-label">
                  <Icon aria-hidden="true" />
                  {label}
                </span>
                {options.length <= 6 ? (
                  <div className="fa-pref-chips">
                    <button type="button" className="fa-pref-chip" data-active={selected === "" ? "" : undefined} onClick={() => setTaskModel(task, "")}>
                      App default
                    </button>
                    {options.map((model) => (
                      <button type="button" key={model.id} className="fa-pref-chip" data-active={selected === model.id ? "" : undefined} title={model.id} onClick={() => setTaskModel(task, model.id)}>
                        {model.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <select className="fb-select" value={selected} onChange={(event) => setTaskModel(task, event.target.value)}>
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
