"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { WorkerTaskPreference } from "@/lib/types/agent-runtime";

type ConnectedAppOption = {
  id: string;
  name: string;
  kind?: string;
  apiBaseUrl?: string;
};

type ModelOption = {
  id: string;
  label: string;
  kind: "image" | "video" | "other";
};

type WorkerTaskPreferencesEditorProps = {
  value: WorkerTaskPreference[];
  onChange: (next: WorkerTaskPreference[]) => void;
};

const TASK_TYPE_OPTIONS = ["image", "video", "writing", "research", "code", "audio", "other"];

const compactInputStyle: React.CSSProperties = {
  minWidth: 0,
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  background: "rgba(2,6,23,0.48)",
  color: "var(--fg)",
  fontFamily: "var(--f-body)",
  fontSize: 12,
  outline: "none",
  padding: "7px 9px",
};

function preferenceId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `pref-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function WorkerTaskPreferencesEditor({ value, onChange }: WorkerTaskPreferencesEditorProps) {
  const [apps, setApps] = useState<ConnectedAppOption[]>([]);
  const [modelsByApp, setModelsByApp] = useState<Record<string, ModelOption[] | "loading">>({});
  const modelsRequestedRef = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fleet/apps?fast=1", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((payload: { apps?: ConnectedAppOption[] } | null) => {
        if (cancelled || !Array.isArray(payload?.apps)) return;
        const seen = new Set<string>();
        setApps(payload.apps.filter((app) => {
          if (!app.id || !app.name || seen.has(app.id)) return false;
          seen.add(app.id);
          return true;
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    for (const preference of value) {
      const appId = preference.appId;
      if (!appId || modelsRequestedRef.current.has(appId)) continue;
      modelsRequestedRef.current.add(appId);
      setModelsByApp((current) => ({ ...current, [appId]: "loading" }));
      fetch(`/api/fleet/apps/models?appId=${encodeURIComponent(appId)}`, { cache: "no-store" })
        .then((response) => response.json().catch(() => null))
        .then((payload: { ok?: boolean; models?: ModelOption[] } | null) => {
          setModelsByApp((current) => ({ ...current, [appId]: payload?.ok && Array.isArray(payload.models) ? payload.models : [] }));
        })
        .catch(() => {
          setModelsByApp((current) => ({ ...current, [appId]: [] }));
        });
    }
  }, [value]);

  const updateRow = (id: string, patch: Partial<WorkerTaskPreference>) => {
    onChange(value.map((preference) => (preference.id === id ? { ...preference, ...patch } : preference)));
  };

  const removeRow = (id: string) => {
    onChange(value.filter((preference) => preference.id !== id));
  };

  const addRow = () => {
    onChange([...value, { id: preferenceId(), taskType: "image" }]);
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {value.map((preference) => {
        const appModels = preference.appId ? modelsByApp[preference.appId] : undefined;
        const modelOptions = Array.isArray(appModels) ? appModels : [];
        const relevantModels = preference.taskType === "image" || preference.taskType === "video"
          ? modelOptions.filter((model) => (preference.taskType === "video" ? model.kind === "video" : model.kind !== "video"))
          : modelOptions;
        return (
          <div key={preference.id} style={{ display: "grid", gap: 6, padding: "9px 10px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--panel-bg-soft)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0,1fr) auto", gap: 6, alignItems: "center" }}>
              <select
                value={TASK_TYPE_OPTIONS.includes(preference.taskType) ? preference.taskType : "other"}
                onChange={(event) => updateRow(preference.id, { taskType: event.target.value })}
                style={compactInputStyle}
                aria-label="Task type"
              >
                {TASK_TYPE_OPTIONS.map((task) => <option key={task} value={task}>{task}</option>)}
              </select>
              <select
                value={preference.appId ?? ""}
                onChange={(event) => {
                  const app = apps.find((candidate) => candidate.id === event.target.value);
                  updateRow(preference.id, { appId: app?.id || undefined, appName: app?.name || undefined, model: undefined });
                }}
                style={compactInputStyle}
                aria-label="Preferred app"
              >
                <option value="">Any app</option>
                {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
                {preference.appId && !apps.some((app) => app.id === preference.appId)
                  ? <option value={preference.appId}>{preference.appName || preference.appId} (offline)</option>
                  : null}
              </select>
              <button
                type="button"
                onClick={() => removeRow(preference.id)}
                aria-label="Remove preference"
                style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", cursor: "pointer" }}
              >
                <Minus size={13} aria-hidden="true" />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,0.8fr) minmax(0,1.2fr)", gap: 6 }}>
              {preference.appId && (appModels === "loading" || relevantModels.length > 0) ? (
                <select
                  value={preference.model ?? ""}
                  onChange={(event) => updateRow(preference.id, { model: event.target.value || undefined })}
                  style={compactInputStyle}
                  disabled={appModels === "loading"}
                  aria-label="Preferred model"
                >
                  <option value="">{appModels === "loading" ? "Loading models..." : "App default model"}</option>
                  {relevantModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
              ) : (
                <input
                  value={preference.model ?? ""}
                  onChange={(event) => updateRow(preference.id, { model: event.target.value || undefined })}
                  placeholder="Model (optional)"
                  style={compactInputStyle}
                  aria-label="Preferred model"
                />
              )}
              <input
                value={preference.notes ?? ""}
                onChange={(event) => updateRow(preference.id, { notes: event.target.value || undefined })}
                placeholder="e.g. anime style, long-form realism"
                style={compactInputStyle}
                aria-label="Preference notes"
              />
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRow}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "fit-content", padding: "5px 10px", borderRadius: 999, border: "1px dashed var(--aeon-line)", background: "transparent", color: "var(--cyan-3)", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}
      >
        <Plus size={12} aria-hidden="true" /> Add task preference
      </button>
    </div>
  );
}
