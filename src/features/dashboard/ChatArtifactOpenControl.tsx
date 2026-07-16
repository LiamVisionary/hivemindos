"use client";

import { useEffect, useRef, useState } from "react";
import {
  AppWindow,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  FolderOpen,
  LoaderCircle,
  MonitorUp,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  downloadDeliverableToDevice,
  loadDeliverableAvailability,
  loadDeliverableOpenCapabilities,
  runDeliverableOpenAction,
  type DeliverableOpenAction,
  type DeliverableOpenCapabilities,
  type DeliverableSourceMachine,
} from "@/lib/services/deliverable-open-client";
import { openExternalUrl } from "@/lib/native/open-external-url";

type ChatArtifactOpenControlProps = {
  kind: "file" | "url";
  label: string;
  onCopy: (value: string) => void;
  sourceMachine?: DeliverableSourceMachine;
  target: string;
};

function OpenIcon({ busy, downloading }: { busy: boolean; downloading: boolean }) {
  if (downloading) return busy
    ? <LoaderCircle aria-hidden="true" className="fr-chat-artifact-open-spinner" />
    : <Download aria-hidden="true" />;
  return busy
    ? <LoaderCircle aria-hidden="true" className="fr-chat-artifact-open-spinner" />
    : <MonitorUp aria-hidden="true" />;
}

export function ChatArtifactOpenControl({ kind, label, onCopy, sourceMachine, target }: ChatArtifactOpenControlProps) {
  const [capabilities, setCapabilities] = useState<DeliverableOpenCapabilities | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [busyAction, setBusyAction] = useState<DeliverableOpenAction | "download" | "">("");
  const [activeTarget, setActiveTarget] = useState(target);
  const [message, setMessage] = useState("");
  const messageTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
  }, []);

  useEffect(() => {
    if (kind !== "file" || !sourceMachine?.collectorUrl) return undefined;
    let cancelled = false;
    void loadDeliverableAvailability(activeTarget).then((result) => {
      if (!cancelled && !result.available) setCapabilities(result);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeTarget, kind, sourceMachine?.collectorUrl]);

  function flashMessage(value: string) {
    setMessage(value);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(""), 3200);
  }

  async function discoverApps() {
    if (kind !== "file" || capabilities || discovering) return;
    setDiscovering(true);
    try {
      setCapabilities(await loadDeliverableOpenCapabilities(activeTarget));
    } catch (error) {
      setCapabilities({
        apps: [],
        available: false,
        error: error instanceof Error ? error.message : "Could not inspect compatible applications.",
        fileManagerLabel: "file manager",
      });
    } finally {
      setDiscovering(false);
    }
  }

  async function runAction(action: DeliverableOpenAction, appId?: string) {
    if (kind === "url") {
      void openExternalUrl(target, "chrome");
      return;
    }
    setBusyAction(action);
    setMessage("");
    try {
      const result = await runDeliverableOpenAction({ action, appId, path: activeTarget });
      if (!result?.ok) throw new Error(result?.error || "Could not open that file.");
    } catch (error) {
      flashMessage(error instanceof Error ? error.message : "Could not open that file.");
    } finally {
      setBusyAction("");
    }
  }

  async function downloadToDevice() {
    if (!sourceMachine) return;
    setBusyAction("download");
    setMessage("");
    try {
      const result = await downloadDeliverableToDevice({ path: target, sourceMachine });
      if (!result.path) throw new Error("The download completed without a local file path.");
      setActiveTarget(result.path);
      setCapabilities(await loadDeliverableOpenCapabilities(result.path));
      flashMessage(`Downloaded to ${result.displayPath || result.path}`);
    } catch (error) {
      flashMessage(error instanceof Error ? error.message : "Could not download that file.");
    } finally {
      setBusyAction("");
    }
  }

  function copyTarget() {
    onCopy(activeTarget);
    flashMessage(kind === "url" ? "Link copied" : "Path copied");
  }

  const unavailable = capabilities?.available === false;
  const downloadable = kind === "file" && unavailable && Boolean(sourceMachine?.collectorUrl);
  const fileManagerLabel = capabilities?.fileManagerLabel || "file manager";

  return (
    <div className="fr-chat-artifact-open-control">
      <div className="fr-chat-artifact-open-group" role="group" aria-label={`Open ${label}`}>
        <button
          type="button"
          className="fr-chat-artifact-open-primary"
          aria-label={downloadable ? `Download ${label} to this device` : `Open ${label}`}
          disabled={Boolean(busyAction) || (unavailable && !downloadable)}
          onClick={() => downloadable ? void downloadToDevice() : void runAction("open")}
        >
          <OpenIcon busy={busyAction === (downloadable ? "download" : "open")} downloading={downloadable} />
          <span>{busyAction === "download" ? "Downloading" : busyAction === "open" ? "Opening" : downloadable ? "Download" : "Open"}</span>
        </button>
        <DropdownMenu onOpenChange={(open) => { if (open) void discoverApps(); }}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="fr-chat-artifact-open-more"
              aria-label={`More ways to open ${label}`}
              disabled={Boolean(busyAction)}
            >
              <ChevronDown aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="fr-chat-artifact-open-menu" sideOffset={7}>
            <DropdownMenuLabel className="fr-chat-artifact-open-menu-label">{label}</DropdownMenuLabel>
            <DropdownMenuItem
              className="fr-chat-artifact-open-menu-item"
              disabled={unavailable}
              onSelect={() => void runAction("open")}
            >
              <FileText aria-hidden="true" />
              <span>Open {kind === "url" ? "link" : "file"}</span>
              {kind === "file" ? <small>Default</small> : null}
            </DropdownMenuItem>
            {kind === "file" ? (
              <>
                <DropdownMenuItem
                  className="fr-chat-artifact-open-menu-item"
                  disabled={unavailable}
                  onSelect={() => void runAction("folder")}
                >
                  <FolderOpen aria-hidden="true" />
                  <span>Open folder</span>
                  <small>{fileManagerLabel}</small>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    className="fr-chat-artifact-open-menu-item fr-chat-artifact-open-in-trigger"
                    disabled={unavailable}
                  >
                    <AppWindow aria-hidden="true" />
                    <span>Open in…</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="fr-chat-artifact-open-menu fr-chat-artifact-open-submenu" sideOffset={1}>
                      <DropdownMenuLabel className="fr-chat-artifact-open-menu-label">Compatible apps</DropdownMenuLabel>
                      {discovering ? (
                        <DropdownMenuItem className="fr-chat-artifact-open-menu-item" disabled>
                          <LoaderCircle aria-hidden="true" className="fr-chat-artifact-open-spinner" />
                          <span>Finding apps…</span>
                        </DropdownMenuItem>
                      ) : capabilities?.apps.length ? capabilities.apps.map((app) => (
                        <DropdownMenuItem
                          className="fr-chat-artifact-open-menu-item"
                          key={app.id}
                          onSelect={() => void runAction("open-in", app.id)}
                        >
                          <span className="fr-chat-artifact-app-mark" aria-hidden="true">{app.name.slice(0, 1)}</span>
                          <span>{app.name}</span>
                          {app.isDefault ? <small>Default</small> : null}
                        </DropdownMenuItem>
                      )) : (
                        <DropdownMenuItem className="fr-chat-artifact-open-menu-item" disabled>
                          <span>No compatible apps found</span>
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                {downloadable ? (
                  <DropdownMenuItem
                    className="fr-chat-artifact-open-menu-item fr-chat-artifact-download-item"
                    onSelect={() => void downloadToDevice()}
                  >
                    <Download aria-hidden="true" />
                    <span>Download to this device</span>
                    <small>Downloads</small>
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}
            <DropdownMenuSeparator className="fr-chat-artifact-open-menu-separator" />
            <DropdownMenuItem className="fr-chat-artifact-open-menu-item" onSelect={copyTarget}>
              {message.includes("copied") ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              <span>Copy {kind === "url" ? "link" : "path"}</span>
            </DropdownMenuItem>
            {capabilities?.error ? (
              <p className="fr-chat-artifact-open-menu-note">{capabilities.error}</p>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {message ? <span className="fr-chat-artifact-open-status" role="status">{message}</span> : null}
    </div>
  );
}
