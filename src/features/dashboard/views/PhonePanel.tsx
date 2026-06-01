"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Clock3,
  FolderSync,
  LoaderCircle,
  Pencil,
  PhoneCall,
  PhoneOutgoing,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { readNativePhonePrompts } from "@/lib/native/phone";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type CallPrompt = {
  id: string;
  title: string;
  time: string;
  enabled: boolean;
  instructions: string;
  path: string;
};

type PromptsPayload = {
  ok?: boolean;
  prompts?: CallPrompt[];
  vaultPath?: string;
  error?: string;
};

type SyncDevice = {
  deviceID: string;
  name: string;
  completion: number | null;
  needBytes: number | null;
  needItems: number | null;
};

type SyncFolder = {
  folderId: string;
  label: string;
  path: string;
  paused: boolean;
  completion: number | null;
  needBytes: number | null;
  needItems: number | null;
  devices: SyncDevice[];
};

type SyncStatusPayload = {
  ok?: boolean;
  available?: boolean;
  folders?: SyncFolder[];
  error?: string;
};

type PhonePanelProps = {
  activeView: DashboardView;
  fleetClass: ClassNameBuilder;
  formatRelativeTime: (timestamp: number) => string;
  sharedVault?: SharedVaultConfig;
};

type DraftState = {
  id?: string;
  title: string;
  time: string;
  enabled: boolean;
  instructions: string;
};

const EMPTY_DRAFT: DraftState = { title: "", time: "08:30", enabled: true, instructions: "" };

function formatCompletion(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

export function PhonePanel({ activeView, fleetClass, formatRelativeTime, sharedVault }: PhonePanelProps) {
  const [prompts, setPrompts] = useState<CallPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatusPayload | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);

  const portalTarget = typeof document === "undefined" ? null : document.body;
  const nativeVaultPath = sharedVault?.enabled ? sharedVault.vaultPath : undefined;

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const nativeData = await readNativePhonePrompts({
        vaultPath: nativeVaultPath,
      });
      const response = nativeData?.ok ? null : await fetch("/api/phone", { cache: "no-store" });
      const data = nativeData?.ok ? nativeData as PromptsPayload : await response?.json() as PromptsPayload;
      if ((!nativeData?.ok && !response?.ok) || data.ok === false) throw new Error(data.error || `${response?.status} ${response?.statusText}`);
      setPrompts(data.prompts ?? []);
      setCheckedAt(Date.now());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load call prompts.");
    } finally {
      setLoading(false);
    }
  }, [nativeVaultPath]);

  const refreshSync = useCallback(async () => {
    setSyncLoading(true);
    try {
      const response = await fetch("/api/phone?action=sync-status", { cache: "no-store" });
      const data = await response.json() as SyncStatusPayload;
      setSync(data);
    } catch {
      setSync({ ok: false, available: false });
    } finally {
      setSyncLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeView !== "phone") return undefined;
    const timer = window.setTimeout(() => {
      void refresh();
      void refreshSync();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeView, refresh, refreshSync]);

  const openCreate = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setDraftOpen(true);
    setStatus("");
  }, []);

  const openEdit = useCallback((prompt: CallPrompt) => {
    setDraft({ id: prompt.id, title: prompt.title, time: prompt.time, enabled: prompt.enabled, instructions: prompt.instructions });
    setDraftOpen(true);
    setStatus("");
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft.title.trim()) {
      setStatus("A title is required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", ...draft }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not save the call prompt.");
      setDraftOpen(false);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the call prompt.");
    } finally {
      setSaving(false);
    }
  }, [draft, refresh]);

  const toggleEnabled = useCallback(async (prompt: CallPrompt) => {
    setBusyId(prompt.id);
    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "toggle", id: prompt.id, enabled: !prompt.enabled }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not toggle the call prompt.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not toggle the call prompt.");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const removePrompt = useCallback(async (prompt: CallPrompt) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete the call prompt "${prompt.title}"?`)) return;
    setBusyId(prompt.id);
    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id: prompt.id }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "Could not delete the call prompt.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete the call prompt.");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const callNow = useCallback(async (prompt: CallPrompt) => {
    setBusyId(prompt.id);
    setStatus("");
    try {
      const response = await fetch("/api/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ring", id: prompt.id }),
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        setStatus(data.error || "Gateway not reachable.");
      } else {
        setStatus(`Ringing your phone with "${prompt.title}".`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not ring the phone.");
    } finally {
      setBusyId(null);
    }
  }, []);

  const rescan = useCallback(async () => {
    setSyncLoading(true);
    try {
      await fetch("/api/phone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rescan" }),
      });
    } catch {
      // never throw; sync strip degrades on its own
    } finally {
      await refreshSync();
    }
  }, [refreshSync]);

  if (activeView !== "phone") return null;

  const syncFolders = sync?.available && sync.folders?.length ? sync.folders : [];
  const enabledCount = prompts.filter((prompt) => prompt.enabled).length;

  return (
    <section className={fleetClass("taskPanel", "tabPanel")}>
      <div className={fleetClass("taskPanelHeader")}>
        <div>
          <p className="eyebrow">Phone</p>
          <h2>Call prompts</h2>
          <p>Spoken instructions your iPhone calls you with. Stored as markdown in the vault and picked up by the call scheduler.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus aria-hidden="true" />
            New prompt
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCcw aria-hidden="true" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Syncthing sync-status strip — degrades to a neutral line when unavailable. */}
      <div className="mt-4 grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <FolderSync aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />
            Vault sync
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void rescan()} disabled={syncLoading}>
            {syncLoading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCcw aria-hidden="true" />}
            Rescan now
          </Button>
        </div>
        {syncFolders.length ? (
          <div className="grid gap-2">
            {syncFolders.map((folder) => (
              <div key={folder.folderId} className="grid gap-1 rounded-md border border-[rgba(148,163,184,0.10)] bg-[rgba(2,6,23,0.4)] px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[var(--foreground)]">{folder.label}</span>
                  <span className={folder.completion !== null && folder.completion >= 100 ? "text-[#bbf7d0]" : "text-[var(--accent-strong)]"}>
                    {folder.paused ? "Paused" : `${formatCompletion(folder.completion)} synced`}
                  </span>
                </div>
                {folder.devices.length ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                    {folder.devices.map((device) => (
                      <span key={device.deviceID}>
                        {device.name}: {formatCompletion(device.completion)}
                        {device.needItems ? ` · ${device.needItems} pending` : ""}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[11px] text-[var(--muted)]">No paired devices yet.</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-xs text-[var(--muted)]">
            {syncLoading ? "Checking Syncthing…" : "Syncthing status unavailable."}
          </p>
        )}
      </div>

      {status ? (
        <p className="mt-3 rounded-md border border-[rgba(94,234,212,0.18)] bg-[rgba(20,184,166,0.06)] px-3 py-2 text-xs text-[var(--foreground)]">{status}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
        <span>{prompts.length} prompts</span>
        <span>·</span>
        <span>{enabledCount} enabled</span>
        <span>·</span>
        <span>{checkedAt ? formatRelativeTime(checkedAt) : loading ? "Loading…" : "Not yet"}</span>
      </div>

      <div className="mt-4 grid gap-3">
        {prompts.map((prompt) => (
          <article
            key={prompt.id}
            className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-[var(--foreground)]">{prompt.title}</strong>
                <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(148,163,184,0.18)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                  <Clock3 aria-hidden="true" className="h-3 w-3" />
                  {prompt.time ? `Calls at ${prompt.time}` : "No time set"}
                </span>
              </div>
              {prompt.instructions ? (
                <p className="m-0 mt-1 line-clamp-2 break-words text-xs leading-5 text-[var(--muted)]">{prompt.instructions}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={prompt.enabled}
                aria-label={prompt.enabled ? "Disable prompt" : "Enable prompt"}
                disabled={busyId === prompt.id}
                onClick={() => void toggleEnabled(prompt)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${prompt.enabled ? "border-[rgba(94,234,212,0.45)] bg-[rgba(20,184,166,0.35)]" : "border-[rgba(148,163,184,0.22)] bg-[rgba(15,23,42,0.72)]"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${prompt.enabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
              <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(prompt)} disabled={busyId === prompt.id}>
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              <Button type="button" size="sm" onClick={() => void callNow(prompt)} disabled={busyId === prompt.id}>
                {busyId === prompt.id ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <PhoneOutgoing aria-hidden="true" />}
                Call now
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void removePrompt(prompt)} disabled={busyId === prompt.id}>
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </article>
        ))}
      </div>

      {!loading && prompts.length === 0 ? (
        <div className="mt-4 grid place-items-center gap-2 rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-8 text-center text-sm text-[var(--muted)]">
          <PhoneCall aria-hidden="true" className="h-6 w-6 text-[var(--accent-strong)]" />
          <strong className="text-[var(--foreground)]">No call prompts yet</strong>
          <p className="m-0 max-w-md">Create one and your iPhone will call you with the spoken instructions at the time you set.</p>
        </div>
      ) : null}

      {draftOpen && portalTarget ? createPortal((
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-8" role="dialog" aria-modal="true" aria-label={draft.id ? "Edit call prompt" : "New call prompt"}>
          <div className="grid max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-md border border-[rgba(148,163,184,0.20)] bg-[rgba(5,8,13,0.98)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[rgba(148,163,184,0.14)] p-6">
              <div>
                <p className="eyebrow">Phone</p>
                <h3 className="m-0 text-2xl font-bold">{draft.id ? "Edit call prompt" : "New call prompt"}</h3>
                <p className="m-0 mt-2 text-sm leading-6 text-[var(--muted)]">
                  Saved as markdown in the vault. The call scheduler rings your phone at the time below.
                </p>
              </div>
              <CloseIconButton aria-label="Close call prompt editor" onClick={() => setDraftOpen(false)} />
            </div>
            <div className="grid gap-4 overflow-auto p-6">
              <label className="grid gap-1 text-xs text-[var(--muted)]">
                Title
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Morning briefing"
                  className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
                <label className="grid gap-1 text-xs text-[var(--muted)]">
                  Time
                  <input
                    type="time"
                    value={draft.time}
                    onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
                    className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                  />
                </label>
                <label className="mt-5 flex items-center gap-3 text-sm text-[var(--foreground)]">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.enabled}
                    aria-label={draft.enabled ? "Disable prompt" : "Enable prompt"}
                    onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full border transition ${draft.enabled ? "border-[rgba(94,234,212,0.45)] bg-[rgba(20,184,166,0.35)]" : "border-[rgba(148,163,184,0.22)] bg-[rgba(15,23,42,0.72)]"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${draft.enabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                  Enabled
                </label>
              </div>
              <label className="grid gap-1 text-xs text-[var(--muted)]">
                Instructions
                <textarea
                  value={draft.instructions}
                  onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))}
                  placeholder="What should the voice agent say or ask when it calls?"
                  className="min-h-48 resize-y rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.66)] p-3 font-mono text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-[rgba(148,163,184,0.14)] px-6 py-5">
              <Button type="button" size="sm" onClick={() => void saveDraft()} disabled={saving || !draft.title.trim()}>
                {saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" />}
                {draft.id ? "Save" : "Create"}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setDraftOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ), portalTarget) : null}
    </section>
  );
}
