"use client";

/* App workspace pane for the chat route — the Replit-style split view.
 *
 * Tabs: App (live preview behind the SSRF-gated probe), Code (read-only
 * files_tree/files_read browser), Console (real linkd shell). The header is
 * browser chrome: URL (click to copy), refresh, open externally, device-width
 * toggle, target picker, and a temporary-deploy share flow.
 *
 * Honesty rules carried over from the old shelf preview:
 *  - The iframe mounts only after /api/chat/preview reports the target live.
 *  - A dead app renders its real manifest state (stopped / error / restarted)
 *    with a working Start button — never a generic dead pane.
 *  - Warm-up polling keeps showing the checking skeleton; it never fakes a
 *    live frame before the probe passes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { APP_BUILDER_CONFIRMATIONS } from "@/lib/services/app-builder/contract";
import type { ChatPreviewTarget } from "@/lib/services/chat/chat-preview-targets";
import type { ChatAppArtifact } from "@/lib/services/chat/chat-app-artifact";
import { openExternalUrl } from "@/lib/native/open-external-url";

import { ChatTerminalDrawer } from "./ChatTerminalDrawer";
import { ICON_PATHS, Ico, SpinnerIco } from "./composer-primitives";
import type { ThreadAppPreviewPhase } from "./use-thread-app-preview";

export type AppWorkspaceTab = "app" | "code" | "console";
export type WorkspaceDevice = "desktop" | "tablet" | "phone";

const WS_ICONS: Record<string, string | string[]> = {
  refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6",
  chevronRight: "m9 6 6 6-6 6",
  code: ["m8 8-4 4 4 4", "m16 8 4 4-4 4"],
  desktop: ["M3 4h18v12H3z", "M8 20h8", "M12 16v4"],
  tablet: ["M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M11 18h2"],
  phone: ["M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M11 18h2"],
  play: "M8 5v14l11-7z",
  stop: "M7 7h10v10H7z",
  share: ["M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5", "M12 16V3", "M7 8l5-5 5 5"],
  folder: "M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
};

const WARMUP_PROBE_ATTEMPTS = 20;
const WARMUP_PROBE_INTERVAL_MS = 1_500;

const PHASE_STEPS: { phase: ThreadAppPreviewPhase; label: string }[] = [
  { phase: "checking", label: "Checking the app project" },
  { phase: "installing", label: "Installing dependencies" },
  { phase: "starting", label: "Starting the dev server" },
];

function EmptyTile({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="cx-ws-empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {children}
    </div>
  );
}

/** Probes the target through the SSRF-gated route before embedding it. While
 * `expectLive` is set (the dev server just started), a dead probe re-polls
 * instead of settling, so warm-up never reads as failure. */
export function WorkspacePreviewFrame({ target, nonce, expectLive, ensureBusy, onEnsurePreview }: {
  target: ChatPreviewTarget;
  nonce: number;
  expectLive: boolean;
  ensureBusy: boolean;
  onEnsurePreview?: () => void;
}) {
  const [retryNonce, setRetryNonce] = useState(0);
  const targetKey = [target.url, target.machine, target.projectId, target.directory, nonce, retryNonce].join("");
  const [result, setResult] = useState<{ key: string; state: "live" | "dead"; reason: string; projectStatus: string } | null>(null);
  const state = result?.key === targetKey ? result.state : "probing";
  const reason = result?.key === targetKey ? result.reason : "";
  const projectStatus = result?.key === targetKey ? result.projectStatus : "";

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;
    const query = new URLSearchParams({ url: target.url, machine: target.machine });
    if (target.projectId) query.set("projectId", target.projectId);
    if (target.directory) query.set("directory", target.directory);
    if (target.machineKey) query.set("machineKey", target.machineKey);
    if (target.collectorUrl) query.set("collectorUrl", target.collectorUrl);
    const settle = (payload: { live: boolean; reason: string; projectStatus: string }) => {
      if (cancelled) return;
      if (!payload.live && expectLive && attempts < WARMUP_PROBE_ATTEMPTS) {
        attempts += 1;
        timer = window.setTimeout(probeOnce, WARMUP_PROBE_INTERVAL_MS);
        return;
      }
      setResult({ key: targetKey, state: payload.live ? "live" : "dead", reason: payload.reason, projectStatus: payload.projectStatus });
    };
    const probeOnce = () => {
      fetch(`/api/chat/preview?${query}`)
        .then((response) => response.json())
        .then((payload) => settle({
          live: Boolean(payload?.live ?? payload?.data?.live),
          reason: String(payload?.reason ?? payload?.data?.reason ?? ""),
          projectStatus: String(payload?.projectStatus ?? payload?.data?.projectStatus ?? ""),
        }))
        .catch((error: unknown) => settle({
          live: false,
          reason: error instanceof Error ? error.message : "probe failed",
          projectStatus: "",
        }));
    };
    probeOnce();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- targetKey folds in every target field plus both nonces
  }, [targetKey, expectLive]);

  if (state === "probing") {
    return <div role="status" aria-label="Checking preview" className="cx-genskel cx-ws-frame-skel" />;
  }
  if (state === "dead") {
    // projectStatus is the thread app project's real manifest state from the
    // status re-fetch (stopped / error / running-elsewhere) — render the honest
    // story, with the restart affordance right where the failure is.
    const title = projectStatus === "stopped"
      ? `${target.name} is not running`
      : projectStatus === "error"
        ? `${target.name} could not start`
        : projectStatus === "running"
          ? `${target.name} restarted`
          : `${target.name} is not reachable`;
    return (
      <div className="cx-ws-dead">
        <EmptyTile title={title} body={reason || "The hosted app did not respond."}>
          <div className="cx-ws-dead-actions">
            {onEnsurePreview ? (
              <button type="button" className="cx-ws-btn cx-ws-btn-primary" onClick={onEnsurePreview} disabled={ensureBusy}>
                {ensureBusy ? <SpinnerIco size={14} /> : <Ico d={WS_ICONS.play} size={14} sw={1.9} />}
                <span>{projectStatus === "error" ? "Try again" : "Start app"}</span>
              </button>
            ) : null}
            <button type="button" className="cx-ws-btn" onClick={() => setRetryNonce((value) => value + 1)}>
              <Ico d={WS_ICONS.refresh} size={14} sw={1.9} />
              <span>Check again</span>
            </button>
          </div>
        </EmptyTile>
      </div>
    );
  }
  return (
    <iframe
      title={`${target.name} preview`}
      src={target.url}
      className="cx-ws-frame"
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
    />
  );
}

type TreeEntry = { name: string; path: string; type: "dir" | "file"; size?: number };

function formatBytes(size?: number) {
  if (!Number.isFinite(size) || size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read-only project browser over files_tree/files_read. Directories load
 * lazily per level; the UI never writes — edits stay with the agent. */
function WorkspaceCodeTab({ directory, machineKey, collectorUrl, machineLabel }: {
  directory: string;
  machineKey?: string;
  collectorUrl?: string;
  machineLabel: string;
}) {
  const [dirs, setDirs] = useState<Record<string, TreeEntry[] | "loading" | "error">>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selected, setSelected] = useState<{ path: string; content: string; size?: number } | null>(null);
  const [fileLoading, setFileLoading] = useState("");
  const [fileError, setFileError] = useState("");
  const [copied, setCopied] = useState(false);
  const requestSeqRef = useRef(0);

  const filesRequest = useCallback(async (action: "files_tree" | "files_read", path: string) => {
    const response = await fetch("/api/app-builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, backend: "local", directory, path: path || undefined, machineKey, collectorUrl: collectorUrl || undefined }),
    });
    const payload = await response.json().catch(() => null) as Record<string, any> | null;
    if (!response.ok || payload?.ok === false) throw new Error(String(payload?.error || "App files request failed."));
    return payload?.data ?? payload ?? {};
  }, [collectorUrl, directory, machineKey]);

  const loadDir = useCallback((path: string) => {
    setDirs((current) => ({ ...current, [path]: "loading" }));
    filesRequest("files_tree", path)
      .then((payload) => {
        const entries = (Array.isArray(payload?.entries) ? payload.entries : []) as TreeEntry[];
        setDirs((current) => ({ ...current, [path]: entries }));
      })
      .catch(() => setDirs((current) => ({ ...current, [path]: "error" })));
  }, [filesRequest]);

  // The parent keys this component by directory, so a directory change
  // remounts with fresh state; this effect only fetches the root listing
  // (renderEntries treats `undefined` as loading, so no sync setState here).
  useEffect(() => {
    let cancelled = false;
    filesRequest("files_tree", "")
      .then((payload) => {
        if (cancelled) return;
        const entries = (Array.isArray(payload?.entries) ? payload.entries : []) as TreeEntry[];
        setDirs((current) => ({ ...current, "": entries }));
      })
      .catch(() => {
        if (!cancelled) setDirs((current) => ({ ...current, "": "error" }));
      });
    return () => { cancelled = true; };
  }, [filesRequest]);

  const toggleDir = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else {
        next.add(path);
        if (!dirs[path]) loadDir(path);
      }
      return next;
    });
  };

  const openFile = (entry: TreeEntry) => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setFileLoading(entry.path);
    setFileError("");
    filesRequest("files_read", entry.path)
      .then((payload) => {
        if (requestSeqRef.current !== seq) return;
        setSelected({ path: String(payload?.path ?? entry.path), content: String(payload?.content ?? ""), size: Number(payload?.size) || entry.size });
      })
      .catch((error: unknown) => {
        if (requestSeqRef.current !== seq) return;
        setFileError(error instanceof Error ? error.message : "Could not read the file.");
      })
      .finally(() => {
        if (requestSeqRef.current === seq) setFileLoading("");
      });
  };

  const renderEntries = (path: string, depth: number): React.ReactNode => {
    const listing = dirs[path];
    if (listing === "loading" || listing === undefined) {
      return <div role="status" aria-label="Loading files" className="cx-ws-tree-skel"><span className="fr-skel" /><span className="fr-skel" /><span className="fr-skel" /></div>;
    }
    if (listing === "error") {
      return <p className="cx-ws-tree-note">Could not list this folder. <button type="button" onClick={() => loadDir(path)}>Retry</button></p>;
    }
    if (!listing.length) return <p className="cx-ws-tree-note">Empty folder</p>;
    return listing.map((entry) => (
      <div key={entry.path}>
        <button
          type="button"
          className="cx-ws-tree-row"
          data-selected={selected?.path === entry.path || undefined}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (entry.type === "dir" ? toggleDir(entry.path) : openFile(entry))}
          title={entry.path}
        >
          {entry.type === "dir" ? (
            <Ico d={WS_ICONS.chevronRight} size={11} sw={2} style={{ flexShrink: 0, transform: expanded.has(entry.path) ? "rotate(90deg)" : undefined, transition: "transform 140ms" }} />
          ) : (
            <span style={{ width: 11, flexShrink: 0 }} />
          )}
          <Ico d={entry.type === "dir" ? WS_ICONS.folder : ICON_PATHS.file} size={13} sw={1.6} style={{ flexShrink: 0 }} stroke={entry.type === "dir" ? "var(--honey)" : "var(--fg-4)"} />
          <span className="cx-ws-tree-name">{entry.name}</span>
          {fileLoading === entry.path ? <SpinnerIco size={11} /> : null}
        </button>
        {entry.type === "dir" && expanded.has(entry.path) ? renderEntries(entry.path, depth + 1) : null}
      </div>
    ));
  };

  if (!directory) {
    return (
      <div className="cx-ws-dead">
        <EmptyTile title="No app project yet" body={`This conversation does not have an app project on ${machineLabel || "this machine"} yet. Ask the agent to build one.`} />
      </div>
    );
  }

  return (
    <div className="cx-ws-code-layout">
      <div className="cx-scroll cx-ws-tree" aria-label="Project files">
        {renderEntries("", 0)}
      </div>
      <div className="cx-ws-viewer">
        {selected ? (
          <>
            <div className="cx-ws-viewer-head">
              <span className="cx-ws-viewer-path" title={selected.path}>{selected.path}</span>
              <span className="cx-ws-viewer-size">{formatBytes(selected.size)}</span>
              <button
                type="button"
                className="cx-iconbtn cx-ws-chromebtn"
                aria-label="Copy file contents"
                title={copied ? "Copied" : "Copy file contents"}
                onClick={() => {
                  void navigator.clipboard?.writeText(selected.content).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  });
                }}
              >
                <Ico d={copied ? ICON_PATHS.check : ICON_PATHS.copy} size={14} sw={1.8} stroke={copied ? "var(--live)" : "currentColor"}>
                  {copied ? null : <rect x="9" y="9" width="12" height="12" rx="2" />}
                </Ico>
              </button>
            </div>
            <pre className="cx-scroll cx-ws-code">{selected.content}</pre>
          </>
        ) : fileError ? (
          <div className="cx-ws-dead"><EmptyTile title="Could not read the file" body={fileError} /></div>
        ) : (
          <div className="cx-ws-dead"><EmptyTile title="Pick a file" body="Select a file on the left to read it. The agent owns edits — this view is read-only." /></div>
        )}
      </div>
    </div>
  );
}

function expiryLabel(expiresInSeconds?: number) {
  if (!Number.isFinite(expiresInSeconds) || !expiresInSeconds) return "";
  const days = Math.round(expiresInSeconds / 86_400);
  if (days >= 1) return `expires in ~${days} day${days === 1 ? "" : "s"}`;
  return `expires in ~${Math.max(1, Math.round(expiresInSeconds / 3_600))}h`;
}

export type AppWorkspaceProps = {
  targets: ChatPreviewTarget[];
  activeTargetId: string;
  onSelectTarget: (id: string) => void;
  tab: AppWorkspaceTab;
  onTabChange: (tab: AppWorkspaceTab) => void;
  appArtifact?: ChatAppArtifact;
  projectStatus: string;
  previewBusy: boolean;
  previewPhase: ThreadAppPreviewPhase;
  previewError: string;
  previewWaiting: boolean;
  onEnsurePreview: () => void;
  onStopApp?: () => void;
  machineLabel: string;
  machineKey?: string;
  collectorUrl: string;
  workingDirectory: string;
  onClose: () => void;
  onToast: (message: string) => void;
  onResizeStart: (event: React.PointerEvent) => void;
};

export function AppWorkspace(props: AppWorkspaceProps) {
  const {
    targets, activeTargetId, onSelectTarget, tab, onTabChange, appArtifact, projectStatus,
    previewBusy, previewPhase, previewError, previewWaiting, onEnsurePreview, onStopApp,
    machineLabel, machineKey, collectorUrl, workingDirectory, onClose, onToast, onResizeStart,
  } = props;

  const [device, setDevice] = useState<WorkspaceDevice>("desktop");
  const [frameNonce, setFrameNonce] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployError, setDeployError] = useState("");
  const [deployResult, setDeployResult] = useState<{ deploymentUrl: string; claimUrl?: string; expiresInSeconds?: number } | null>(null);
  const headerPopRef = useRef<HTMLDivElement | null>(null);

  const activeTarget = targets.find((target) => target.id === activeTargetId) ?? targets[0];
  const isThreadApp = activeTarget?.source === "thread-app";
  const projectDirectory = appArtifact?.directory ?? (isThreadApp ? activeTarget?.directory ?? "" : "");
  const consoleDirectory = projectDirectory || workingDirectory;
  // "Running" requires a live preview target, not just the artifact's last
  // manifest state — an app stopped outside this UI (collector restart, direct
  // stop) leaves a stale "running" artifact behind, and the footer must not
  // contradict the pane's stopped state.
  const running = activeTarget ? (isThreadApp ? projectStatus === "running" : true) : false;
  const statusLabel = previewPhase === "checking"
    ? "Checking…"
    : previewPhase === "installing"
      ? "Installing…"
      : previewPhase === "starting"
        ? "Starting…"
        : previewPhase === "stopping"
          ? "Stopping…"
          : previewWaiting
            ? "Waiting for the agent to finish…"
            : running ? "Running" : projectStatus === "error" ? "Error" : appArtifact || activeTarget ? "Stopped" : "No app";
  const statusColor = previewPhase || previewWaiting
    ? "var(--honey)"
    : running ? "var(--live)" : projectStatus === "error" ? "var(--danger)" : "var(--fg-4)";

  useEffect(() => {
    if (!pickerOpen && !deployOpen) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || headerPopRef.current?.contains(target)) return;
      setPickerOpen(false);
      setDeployOpen(false);
    }
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [pickerOpen, deployOpen]);

  const copyUrl = () => {
    if (!activeTarget?.url) return;
    void navigator.clipboard?.writeText(activeTarget.url).then(() => onToast("Preview URL copied"));
  };

  const runTemporaryDeploy = async () => {
    if (!projectDirectory || deployBusy) return;
    setDeployBusy(true);
    setDeployError("");
    try {
      const response = await fetch("/api/app-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_deploy",
          backend: "local",
          directory: projectDirectory,
          name: appArtifact?.name || activeTarget?.name || "Chat app",
          machineKey,
          collectorUrl: collectorUrl || undefined,
          confirmation: APP_BUILDER_CONFIRMATIONS.temporaryDeploy,
        }),
      });
      const payload = await response.json().catch(() => null) as Record<string, any> | null;
      if (!response.ok || payload?.ok === false) throw new Error(String(payload?.error || "Temporary deploy failed."));
      const data = payload?.data ?? payload ?? {};
      const deploymentUrl = String(data.deploymentUrl || "");
      if (!deploymentUrl) throw new Error("The deploy finished without a preview URL.");
      setDeployResult({ deploymentUrl, claimUrl: String(data.claimUrl || "") || undefined, expiresInSeconds: Number(data.expiresInSeconds) || undefined });
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : "Temporary deploy failed.");
    } finally {
      setDeployBusy(false);
    }
  };

  const busySteps = previewBusy && previewPhase !== "stopping" ? (
    <div className="cx-ws-steps" role="status" aria-label="Preparing the app preview">
      {PHASE_STEPS.map((step) => {
        const currentIndex = PHASE_STEPS.findIndex((candidate) => candidate.phase === previewPhase);
        const stepIndex = PHASE_STEPS.findIndex((candidate) => candidate.phase === step.phase);
        const stepState = currentIndex < 0 || stepIndex < currentIndex ? "done" : stepIndex === currentIndex ? "current" : "pending";
        return (
          <div key={step.phase} className="cx-ws-step" data-state={stepState}>
            {stepState === "current" ? <SpinnerIco size={13} /> : (
              <Ico d={stepState === "done" ? ICON_PATHS.check : WS_ICONS.chevronRight} size={13} sw={2} stroke={stepState === "done" ? "var(--live)" : "var(--fg-4)"} />
            )}
            <span>{step.label}</span>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <aside className="cx-ws" aria-label="App workspace">
      <div className="cx-ws-handle" role="separator" aria-orientation="vertical" aria-label="Resize workspace" onPointerDown={onResizeStart} />

      <header className="cx-ws-header" ref={headerPopRef}>
        <button type="button" className="cx-iconbtn cx-ws-chromebtn" onClick={onClose} aria-label="Back to chat" title="Back to chat">
          <Ico d={WS_ICONS.chevronRight} size={15} sw={1.9} />
        </button>
        <span className="cx-ws-name-wrap">
          {targets.length > 1 ? (
            <button type="button" className="cx-ws-name cx-ws-name-btn" aria-haspopup="menu" aria-expanded={pickerOpen} onClick={() => { setPickerOpen((open) => !open); setDeployOpen(false); }}>
              <span className="cx-ws-dot" style={{ background: statusColor }} aria-hidden />
              <span className="cx-ws-name-text">{activeTarget?.name || appArtifact?.name || "App"}</span>
              <Ico d="m6 9 6 6 6-6" size={12} sw={1.9} />
            </button>
          ) : (
            <span className="cx-ws-name">
              <span className="cx-ws-dot" style={{ background: statusColor }} aria-hidden />
              <span className="cx-ws-name-text">{activeTarget?.name || appArtifact?.name || "App"}</span>
            </span>
          )}
          {pickerOpen ? (
            <div className="cx-pop cx-ws-pop" role="menu" aria-label="Choose preview target">
              {targets.map((target) => (
                <button key={target.id} type="button" className="cx-menuitem cx-ws-pop-item" role="menuitem" data-active={target.id === activeTarget?.id || undefined} onClick={() => { onSelectTarget(target.id); setPickerOpen(false); }}>
                  <span className="cx-ws-pop-name">{target.name}</span>
                  <small>{[target.source === "thread-app" ? "This chat" : target.machine, target.port ? `:${target.port}` : ""].filter(Boolean).join(" ")}</small>
                </button>
              ))}
            </div>
          ) : null}
        </span>

        <div className="cx-ws-tabs" role="tablist" aria-label="Workspace tabs">
          {([["app", "App"], ["code", "Code"], ["console", "Console"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className="cx-ws-tab" onClick={() => onTabChange(id)}>{label}</button>
          ))}
        </div>

        <span style={{ flex: 1 }} />

        {projectDirectory ? (
          <span className="cx-ws-deploy-wrap">
            <button type="button" className="cx-ws-btn" aria-label="Share a temporary preview" aria-haspopup="dialog" aria-expanded={deployOpen} onClick={() => { setDeployOpen((open) => !open); setPickerOpen(false); }}>
              <Ico d={WS_ICONS.share} size={13} sw={1.8} />
              <span>Share</span>
            </button>
            {deployOpen ? (
              <div className="cx-pop cx-ws-pop cx-ws-deploy" role="dialog" aria-label="Share a temporary preview">
                {deployResult ? (
                  <>
                    <strong>Preview deployed</strong>
                    <button type="button" className="cx-ws-url cx-ws-deploy-url" title="Copy link" onClick={() => { void navigator.clipboard?.writeText(deployResult.deploymentUrl).then(() => onToast("Share link copied")); }}>
                      <span>{deployResult.deploymentUrl}</span>
                      <Ico d={ICON_PATHS.copy} size={12} sw={1.8}><rect x="9" y="9" width="12" height="12" rx="2" /></Ico>
                    </button>
                    <div className="cx-ws-deploy-row">
                      <button type="button" className="cx-ws-btn" onClick={() => void openExternalUrl(deployResult.deploymentUrl)}>
                        <Ico d={ICON_PATHS.openIn} size={12} sw={1.8} />
                        <span>Open</span>
                      </button>
                      {deployResult.expiresInSeconds ? <small>{expiryLabel(deployResult.expiresInSeconds)}</small> : null}
                    </div>
                  </>
                ) : (
                  <>
                    <strong>Share a temporary preview</strong>
                    <p>Publishes a snapshot of this app to a temporary public Cloudflare URL so anyone with the link can try it. It expires on its own.</p>
                    {deployError ? <p className="cx-ws-deploy-error">{deployError}</p> : null}
                    <button type="button" className="cx-ws-btn cx-ws-btn-primary" onClick={() => void runTemporaryDeploy()} disabled={deployBusy}>
                      {deployBusy ? <SpinnerIco size={13} /> : <Ico d={WS_ICONS.share} size={13} sw={1.8} />}
                      <span>{deployBusy ? "Deploying…" : "Deploy preview"}</span>
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </span>
        ) : null}
      </header>

      {tab === "app" ? (
        <>
          <div className="cx-ws-chrome">
            <button type="button" className="cx-iconbtn cx-ws-chromebtn" aria-label="Reload preview" title="Reload preview" onClick={() => setFrameNonce((value) => value + 1)} disabled={!activeTarget}>
              <Ico d={WS_ICONS.refresh} size={14} sw={1.8} />
            </button>
            <button type="button" className="cx-ws-url" onClick={copyUrl} disabled={!activeTarget?.url} title={activeTarget?.url ? "Copy URL" : "No preview URL yet"}>
              <span>{activeTarget?.url || "No preview URL yet"}</span>
              {activeTarget?.url ? <Ico d={ICON_PATHS.copy} size={12} sw={1.8}><rect x="9" y="9" width="12" height="12" rx="2" /></Ico> : null}
            </button>
            <button type="button" className="cx-iconbtn cx-ws-chromebtn" aria-label="Open in browser" title="Open in browser" onClick={() => { if (activeTarget?.url) void openExternalUrl(activeTarget.url); }} disabled={!activeTarget?.url}>
              <Ico d={ICON_PATHS.openIn} size={14} sw={1.8} />
            </button>
            <span className="cx-ws-devices" role="group" aria-label="Preview width">
              {([["desktop", WS_ICONS.desktop], ["tablet", WS_ICONS.tablet], ["phone", WS_ICONS.phone]] as const).map(([id, icon]) => (
                <button key={id} type="button" className="cx-iconbtn cx-ws-chromebtn" aria-label={`${id} width`} title={`${id} width`} aria-pressed={device === id} data-active={device === id || undefined} onClick={() => setDevice(id)}>
                  <Ico d={icon} size={14} sw={1.7} />
                </button>
              ))}
            </span>
          </div>
          <div className="cx-ws-body">
            {previewBusy && previewPhase !== "stopping" ? (
              <div className="cx-ws-busy">
                {busySteps}
                <div role="status" aria-label="Preparing conversation preview" className="cx-genskel cx-ws-frame-skel" />
              </div>
            ) : previewError ? (
              <div className="cx-ws-dead">
                <EmptyTile title="Preview could not start" body={previewError}>
                  <div className="cx-ws-dead-actions">
                    <button type="button" className="cx-ws-btn cx-ws-btn-primary" onClick={onEnsurePreview}>
                      <Ico d={WS_ICONS.play} size={14} sw={1.9} />
                      <span>Try again</span>
                    </button>
                  </div>
                </EmptyTile>
              </div>
            ) : activeTarget ? (
              <div className="cx-ws-frame-holder" data-device={device}>
                <WorkspacePreviewFrame
                  key={`${activeTarget.id}-${frameNonce}`}
                  target={activeTarget}
                  nonce={frameNonce}
                  expectLive={projectStatus === "running"}
                  ensureBusy={previewBusy}
                  onEnsurePreview={isThreadApp || appArtifact ? onEnsurePreview : undefined}
                />
              </div>
            ) : (
              <div className="cx-ws-dead">
                <EmptyTile
                  title={appArtifact ? `${appArtifact.name} is ${projectStatus === "error" ? "not running" : "stopped"}` : "No preview available"}
                  body={appArtifact
                    ? "Start it to bring the live preview back."
                    : `This conversation does not have a runnable app on ${machineLabel || "this machine"} yet.`}
                >
                  {appArtifact ? (
                    <div className="cx-ws-dead-actions">
                      <button type="button" className="cx-ws-btn cx-ws-btn-primary" onClick={onEnsurePreview} disabled={previewBusy || previewWaiting}>
                        {previewWaiting ? <SpinnerIco size={14} /> : <Ico d={WS_ICONS.play} size={14} sw={1.9} />}
                        <span>{previewWaiting ? "Waiting for the agent…" : "Start app"}</span>
                      </button>
                    </div>
                  ) : null}
                </EmptyTile>
              </div>
            )}
          </div>
        </>
      ) : null}

      {tab === "code" ? (
        <div className="cx-ws-body">
          <WorkspaceCodeTab key={projectDirectory} directory={projectDirectory} machineKey={machineKey} collectorUrl={collectorUrl} machineLabel={machineLabel} />
        </div>
      ) : null}

      {tab === "console" ? (
        <div className="cx-ws-body cx-ws-console">
          <ChatTerminalDrawer
            variant="embedded"
            machineName={machineLabel}
            machineKey={machineKey || "local"}
            collectorUrl={collectorUrl}
            workingDirectory={consoleDirectory}
            onClose={() => onTabChange("app")}
          />
        </div>
      ) : null}

      <footer className="cx-ws-foot">
        <span className="cx-ws-dot" style={{ background: statusColor }} aria-hidden />
        <span style={{ color: statusColor }}>{statusLabel}</span>
        {appArtifact ? (
          <>
            <button type="button" className="cx-ws-btn cx-ws-footbtn" onClick={onEnsurePreview} disabled={previewBusy || previewWaiting} title="Restart the app">
              <Ico d={WS_ICONS.refresh} size={12} sw={1.9} />
              <span>Restart</span>
            </button>
            {onStopApp && running ? (
              <button type="button" className="cx-ws-btn cx-ws-footbtn" onClick={onStopApp} disabled={previewBusy} title="Stop the app">
                <Ico d={WS_ICONS.stop} size={12} sw={1.9} />
                <span>Stop</span>
              </button>
            ) : null}
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <span className="cx-ws-foot-meta" title={projectDirectory || undefined}>
          {[machineLabel, activeTarget?.port ? `port ${activeTarget.port}` : "", appArtifact?.templateId].filter(Boolean).join(" · ")}
        </span>
      </footer>
    </aside>
  );
}
