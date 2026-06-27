"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, Check, ListChecks, LoaderCircle, MapPin, MousePointer2, Send, Trash2, X } from "lucide-react";

import type { DashboardPin, DashboardPinBoundingBox } from "@/lib/types/dashboard-pins";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";

type DashboardPinsOverlayProps = {
  activeView: string;
  formatRelativeTime: (timestamp: number) => string;
  sharedVault: SharedVaultConfig;
};

type CaptureTarget = {
  selector?: string;
  textSnippet?: string;
  boundingBox?: DashboardPinBoundingBox;
  componentHint?: string;
};

type PinListResponse = {
  ok?: boolean;
  error?: string;
  pins?: DashboardPin[];
};

type PinActionResponse = {
  ok?: boolean;
  error?: string;
  pin?: DashboardPin;
  pins?: DashboardPin[];
  taskId?: string;
};

export function DashboardPinsOverlay({ activeView, formatRelativeTime, sharedVault }: DashboardPinsOverlayProps) {
  const [open, setOpen] = useState(false);
  const [captureMode, setCaptureMode] = useState(false);
  const [comment, setComment] = useState("");
  const [target, setTarget] = useState<CaptureTarget | null>(null);
  const [pins, setPins] = useState<DashboardPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("");
  const currentRoute = useCurrentRoute(activeView);
  const openPins = useMemo(
    () => pins.filter((pin) => pin.route === currentRoute && pin.status === "open"),
    [currentRoute, pins],
  );

  const refreshPins = useCallback(async () => {
    setLoading(true);
    setStatus("");
    try {
      const params = new URLSearchParams({ status: "all", route: currentRoute });
      const data = await fetchJson<PinListResponse>(`/api/dashboard/pins?${params.toString()}`);
      setPins(data.pins ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Dashboard pins failed to load.");
    } finally {
      setLoading(false);
    }
  }, [currentRoute]);

  useEffect(() => {
    if (!open) return undefined;
    const refreshHandle = window.setTimeout(() => void refreshPins(), 0);
    return () => window.clearTimeout(refreshHandle);
  }, [open, refreshPins]);

  useEffect(() => {
    if (!captureMode) return undefined;
    const captureClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest("[data-dashboard-pins-overlay='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(describeTarget(element));
      setCaptureMode(false);
      setOpen(true);
    };
    document.addEventListener("click", captureClick, { capture: true });
    return () => document.removeEventListener("click", captureClick, { capture: true });
  }, [captureMode]);

  const createPin = async () => {
    const cleanComment = comment.trim();
    if (!cleanComment) {
      setStatus("Add a short note before saving the pin.");
      return;
    }
    setBusyId("create");
    setStatus("");
    try {
      const data = await fetchJson<PinActionResponse>("/api/dashboard/pins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create",
          route: currentRoute,
          comment: cleanComment,
          selector: target?.selector,
          textSnippet: target?.textSnippet,
          boundingBox: target?.boundingBox,
          componentHint: target?.componentHint,
        }),
      });
      setPins(data.pins ?? updatePinList(pins, data.pin));
      setComment("");
      setTarget(null);
      setStatus("Pin saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pin save failed.");
    } finally {
      setBusyId("");
    }
  };

  const runPinAction = async (pin: DashboardPin, action: "send-to-work-board" | "resolve" | "archive" | "delete") => {
    setBusyId(`${action}:${pin.id}`);
    setStatus("");
    try {
      const body = action === "delete"
        ? { action: "delete", id: pin.id }
        : action === "send-to-work-board"
          ? {
              action,
              id: pin.id,
              vaultPath: sharedVault.enabled ? sharedVault.vaultPath : undefined,
              kanbanFolder: sharedVault.enabled ? sharedVault.kanbanFolder : undefined,
            }
          : {
              action: "update-status",
              id: pin.id,
              status: action === "resolve" ? "resolved" : "archived",
            };
      const data = await fetchJson<PinActionResponse>("/api/dashboard/pins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setPins(data.pins ?? updatePinList(pins, data.pin, action === "delete" ? pin.id : undefined));
      setStatus(pinActionStatus(action, data));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${action} failed.`);
    } finally {
      setBusyId("");
    }
  };

  return (
    <div data-dashboard-pins-overlay="true" className="fixed bottom-24 right-5 z-[80] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3">
      {openPins.map((pin) => <PinMarker pin={pin} key={pin.id} />)}
      {captureMode ? (
        <div className="rounded-md border border-[rgba(94,234,212,0.34)] bg-[rgba(2,6,23,0.92)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] shadow-2xl">
          Click any dashboard element to attach the pin.
        </div>
      ) : null}
      {open ? (
        <section className="w-[min(26rem,calc(100vw-2rem))] rounded-md border border-[rgba(148,163,184,0.2)] bg-[rgba(2,6,23,0.94)] p-4 text-[var(--foreground)] shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Dashboard pins</p>
              <h3 className="m-0 text-base font-bold">Annotate this screen</h3>
              <p className="m-0 mt-1 break-words text-xs text-[var(--muted)]">{currentRoute}</p>
            </div>
            <IconButton label="Close pins" onClick={() => setOpen(false)}>
              <X aria-hidden="true" />
            </IconButton>
          </div>

          <div className="mt-4 grid gap-3">
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="What should change here?"
              className="min-h-24 resize-y rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.72)] p-3 text-sm text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
            />
            {target ? (
              <div className="rounded-md border border-[rgba(94,234,212,0.2)] bg-[rgba(20,184,166,0.08)] p-3 text-xs">
                <strong>Target selected</strong>
                <p className="m-0 mt-1 break-words text-[var(--muted)]">
                  {[target.selector, target.componentHint, target.textSnippet].filter(Boolean).join(" · ")}
                </p>
              </div>
            ) : null}
            {status ? <p className="m-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs">{status}</p> : null}
            <div className="flex flex-wrap gap-2">
              <PanelButton onClick={() => setCaptureMode(true)} active={captureMode}>
                <MousePointer2 aria-hidden="true" />
                Target
              </PanelButton>
              <PanelButton onClick={() => void createPin()} disabled={Boolean(busyId)}>
                {busyId === "create" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <MapPin aria-hidden="true" />}
                Save
              </PanelButton>
              <PanelButton onClick={() => void refreshPins()} disabled={loading}>
                {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <ListChecks aria-hidden="true" />}
                List
              </PanelButton>
            </div>
          </div>

          <div className="mt-4 grid max-h-[26rem] gap-3 overflow-auto pr-1">
            {pins.map((pin) => (
              <article key={pin.id} className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="break-words">{pin.comment}</strong>
                  <span className="rounded-full border border-[rgba(148,163,184,0.18)] px-2 py-0.5 font-bold text-[var(--muted)]">{pin.status}</span>
                </div>
                <p className="m-0 break-words text-[var(--muted)]">
                  {[pin.textSnippet, pin.selector, relativeIso(pin.updatedAt, formatRelativeTime), pin.workBoardTaskId].filter(Boolean).join(" · ")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <IconButton
                    label="Send to Work Board"
                    onClick={() => void runPinAction(pin, "send-to-work-board")}
                    disabled={Boolean(busyId) || pin.status === "sent-to-work-board"}
                  >
                    {busyId === `send-to-work-board:${pin.id}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
                  </IconButton>
                  <IconButton
                    label="Resolve"
                    onClick={() => void runPinAction(pin, "resolve")}
                    disabled={Boolean(busyId) || pin.status === "resolved"}
                  >
                    {busyId === `resolve:${pin.id}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Check aria-hidden="true" />}
                  </IconButton>
                  <IconButton
                    label="Archive"
                    onClick={() => void runPinAction(pin, "archive")}
                    disabled={Boolean(busyId) || pin.status === "archived"}
                  >
                    {busyId === `archive:${pin.id}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Archive aria-hidden="true" />}
                  </IconButton>
                  <IconButton label="Delete" onClick={() => void runPinAction(pin, "delete")} disabled={Boolean(busyId)}>
                    {busyId === `delete:${pin.id}` ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Trash2 aria-hidden="true" />}
                  </IconButton>
                </div>
              </article>
            ))}
            {pins.length ? null : (
              <div className="rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-4 text-center text-sm text-[var(--muted)]">
                No pins saved for this route.
              </div>
            )}
          </div>
        </section>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-11 items-center gap-2 rounded-full border border-[rgba(94,234,212,0.28)] bg-[rgba(2,6,23,0.88)] px-4 text-sm font-bold text-[var(--foreground)] shadow-2xl backdrop-blur transition hover:border-[rgba(94,234,212,0.52)] hover:bg-[rgba(20,184,166,0.12)]"
        aria-label="Open dashboard pins"
      >
        <MapPin aria-hidden="true" className="h-4 w-4 text-[var(--accent-strong)]" />
        {openPins.length ? `${openPins.length} pin${openPins.length === 1 ? "" : "s"}` : "Pin"}
      </button>
    </div>
  );
}

function useCurrentRoute(activeView: string) {
  const [route, setRoute] = useState("");
  useEffect(() => {
    const update = () => {
      const pathname = window.location.pathname || "/";
      const search = window.location.search || (activeView ? `?view=${encodeURIComponent(activeView)}` : "");
      setRoute(`${pathname}${search}`);
    };
    update();
    window.addEventListener("popstate", update);
    window.addEventListener("hivemindos:navigate", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hivemindos:navigate", update);
    };
  }, [activeView]);
  return route || `/?view=${activeView}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(typeof data?.error === "string" ? data.error : `${url} returned HTTP ${response.status}`);
  }
  return data as T;
}

function describeTarget(element: Element): CaptureTarget {
  const rect = element.getBoundingClientRect();
  return {
    selector: selectorForElement(element),
    textSnippet: textSnippetForElement(element),
    boundingBox: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    componentHint: componentHintForElement(element),
  };
}

function selectorForElement(element: Element) {
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${cssEscape(testId)}"]`;
  const aria = element.getAttribute("aria-label");
  if (aria) return `${element.tagName.toLowerCase()}[aria-label="${cssEscape(aria)}"]`;
  if (element.id) return `#${cssEscape(element.id)}`;
  const classes = Array.from(element.classList).slice(0, 3).map((className) => `.${cssEscape(className)}`).join("");
  return `${element.tagName.toLowerCase()}${classes}`;
}

function componentHintForElement(element: Element) {
  const dataComponent = element.closest("[data-component]")?.getAttribute("data-component");
  if (dataComponent) return dataComponent;
  const labelledRegion = element.closest("[aria-label]")?.getAttribute("aria-label");
  return labelledRegion || undefined;
}

function textSnippetForElement(element: Element) {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 220) : undefined;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function updatePinList(pins: DashboardPin[], pin?: DashboardPin, deletedId?: string) {
  if (deletedId) return pins.filter((candidate) => candidate.id !== deletedId);
  if (!pin) return pins;
  const exists = pins.some((candidate) => candidate.id === pin.id);
  return exists
    ? pins.map((candidate) => candidate.id === pin.id ? pin : candidate)
    : [pin, ...pins];
}

function pinActionStatus(action: "send-to-work-board" | "resolve" | "archive" | "delete", data: PinActionResponse) {
  if (action === "send-to-work-board") return data.taskId ? `Sent to Work Board as ${data.taskId}.` : "Sent to Work Board.";
  if (action === "resolve") return "Pin resolved.";
  if (action === "archive") return "Pin archived.";
  return "Pin deleted.";
}

function PinMarker({ pin }: { pin: DashboardPin }) {
  if (!pin.boundingBox) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none fixed z-[79] rounded-md border border-[rgba(94,234,212,0.8)] bg-[rgba(20,184,166,0.12)] shadow-[0_0_0_9999px_rgba(2,6,23,0.02)]"
      style={{
        left: pin.boundingBox.x,
        top: pin.boundingBox.y,
        width: Math.max(18, pin.boundingBox.width),
        height: Math.max(18, pin.boundingBox.height),
      }}
    />
  );
}

function PanelButton({ active, children, disabled, onClick }: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm font-bold transition [&_svg]:h-4 [&_svg]:w-4 ${active ? "border-[rgba(94,234,212,0.52)] bg-[rgba(20,184,166,0.14)] text-[var(--foreground)]" : "border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] text-[var(--foreground)] hover:border-[rgba(94,234,212,0.36)]"} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {children}
    </button>
  );
}

function IconButton({ children, disabled, label, onClick }: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(148,163,184,0.18)] bg-[rgba(10,14,21,0.7)] text-[var(--foreground)] transition hover:border-[rgba(94,234,212,0.38)] disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:h-4 [&_svg]:w-4"
    >
      {children}
    </button>
  );
}

function relativeIso(value: string | undefined, formatRelativeTime: (timestamp: number) => string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? formatRelativeTime(timestamp) : value;
}
