"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { FileUp, LoaderCircle } from "lucide-react";

import { CloseIconButton } from "@/components/ui/close-icon-button";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import {
  listenForTauriComposerDragDrop,
  type TauriDragDropEvent,
  type TauriDropPosition,
  type TauriWebviewApi,
} from "@/features/chat/tauri-composer-drag-drop";

import type { FleetMachine } from "./fleet-data";
import styles from "./machine-send-file-modal.module.css";

// HiveDrop sends a file to a fleet machine over Hivemind Link. Browser-picked
// files use a raw XHR upload for real upload progress; Tauri-native drops send
// the OS path so the server can stream the file from disk and publish progress.

type MachineSendFileModalProps = {
  machine: FleetMachine;
  onClose: () => void;
};

type SendState = "idle" | "sending" | "done" | "error";
type HiveDropPhase = "preparing" | "sending" | "done" | "error";

type HiveDropProgress = {
  phase: HiveDropPhase | "idle";
  bytesSent: number;
  totalBytes: number | null;
  uploadBytesSent: number;
  uploadTotalBytes: number | null;
};

type HiveDropProgressResponse = {
  ok?: boolean;
  progress?: {
    phase?: HiveDropPhase;
    bytesSent?: number;
    totalBytes?: number | null;
    error?: string;
    path?: string;
  };
  error?: string;
};

type HiveDropResponse = {
  ok?: boolean;
  transferId?: string;
  path?: string;
  error?: string;
};

type XhrResult = {
  status: number;
  data: HiveDropResponse | null;
};

function emptyProgress(): HiveDropProgress {
  return {
    phase: "idle",
    bytesSent: 0,
    totalBytes: null,
    uploadBytesSent: 0,
    uploadTotalBytes: null,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function createTransferId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `hivedrop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sendWithProgress(
  url: string,
  body: XMLHttpRequestBodyInit,
  onUploadProgress: (loaded: number, total: number | null) => void,
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = 0;
    xhr.upload.onprogress = (event) => {
      onUploadProgress(event.loaded, event.lengthComputable ? event.total : null);
    };
    xhr.onload = () => {
      const text = String(xhr.responseText || "");
      let data: HiveDropResponse | null = null;
      try {
        data = text ? JSON.parse(text) as HiveDropResponse : null;
      } catch {
        data = null;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => reject(new Error("HiveDrop could not reach the local dashboard route."));
    xhr.onabort = () => reject(new Error("HiveDrop was canceled."));
    xhr.send(body);
  });
}

function rawFileUrl(input: {
  transferId: string;
  file: File;
  collectorUrl: string;
  destDir: string;
  machineName: string;
}) {
  const params = new URLSearchParams({
    transport: "raw",
    transferId: input.transferId,
    fileName: input.file.name,
    size: String(input.file.size),
    collectorUrl: input.collectorUrl,
    destDir: input.destDir,
    machineName: input.machineName,
  });
  return `/api/fleet/send-file?${params.toString()}`;
}

export function MachineSendFileModal({ machine, onClose }: MachineSendFileModalProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [sourcePath, setSourcePath] = React.useState<string | null>(null);
  const [sourceName, setSourceName] = React.useState("");
  const [destDir, setDestDir] = React.useState("~/Downloads");
  const [state, setState] = React.useState<SendState>("idle");
  const [message, setMessage] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState<HiveDropProgress>(() => emptyProgress());
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropZoneRef = React.useRef<HTMLButtonElement>(null);
  const hasCollector = Boolean(machine.collectorUrl);
  const hasSelection = Boolean(file || sourcePath);
  const selectedName = file?.name ?? sourceName;
  const displayDestDir = destDir.trim() || "~/Downloads";

  const resetTransferState = React.useCallback(() => {
    setState("idle");
    setMessage("");
    setProgress(emptyProgress());
  }, []);

  const pickFile = React.useCallback((next: File | null) => {
    if (!next) return;
    setFile(next);
    setSourcePath(null);
    setSourceName(next.name);
    resetTransferState();
  }, [resetTransferState]);

  const pickPath = React.useCallback((path: string) => {
    setSourcePath(path);
    setFile(null);
    setSourceName(baseName(path));
    resetTransferState();
  }, [resetTransferState]);

  const pollTransferProgress = React.useCallback((transferId: string, fallbackTotal: number | null) => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/fleet/send-file?transferId=${encodeURIComponent(transferId)}`, {
          cache: "no-store",
        });
        if (!res.ok || !active) return;
        const data = (await res.json().catch(() => null)) as HiveDropProgressResponse | null;
        const next = data?.progress;
        if (!next) return;
        const nextBytes = Number.isFinite(next.bytesSent) ? Number(next.bytesSent) : 0;
        const nextTotal = typeof next.totalBytes === "number" ? next.totalBytes : fallbackTotal;
        setProgress((current) => ({
          ...current,
          phase: next.phase ?? current.phase,
          bytesSent: Math.max(current.bytesSent, nextBytes),
          totalBytes: nextTotal,
        }));
      } catch {
        // Progress polling is advisory; the main upload response owns errors.
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 350);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // Tauri-native drag-drop (packaged app): HTML5 events never fire there.
  React.useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let safeUnlisten = createSafeTauriUnlisten();

    const insideDropZone = (position: TauriDropPosition) => {
      const node = dropZoneRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const contains = (x: number, y: number) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      // Tauri reports positions in physical pixels on HiDPI displays.
      const scale = window.devicePixelRatio || 1;
      return contains(position.x, position.y) || (scale > 1 && contains(position.x / scale, position.y / scale));
    };

    const handle = (event: TauriDragDropEvent) => {
      const payload = event.payload;
      if (payload.type === "leave") {
        setDragging(false);
        return;
      }
      const inside = insideDropZone(payload.position);
      if (payload.type === "drop") {
        setDragging(false);
        if (inside) {
          const path = payload.paths?.[0];
          if (path) pickPath(path);
        }
        return;
      }
      setDragging(inside);
    };

    void import("@tauri-apps/api/webview")
      .then((module) => {
        if (disposed) return undefined;
        return listenForTauriComposerDragDrop(module as TauriWebviewApi, handle);
      })
      .then((unlisten) => {
        if (!unlisten) return;
        safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (disposed) safeUnlisten();
      })
      .catch(() => {
        if (!disposed) setDragging(false);
      });

    return () => {
      disposed = true;
      safeUnlisten();
    };
  }, [pickPath]);

  const send = React.useCallback(async () => {
    if ((!file && !sourcePath) || state === "sending") return;
    const transferId = createTransferId();
    const targetDir = destDir.trim() || "~/Downloads";
    const fallbackTotal = file?.size ?? null;
    setState("sending");
    setMessage("");
    setProgress({
      phase: "preparing",
      bytesSent: 0,
      totalBytes: fallbackTotal,
      uploadBytesSent: 0,
      uploadTotalBytes: fallbackTotal,
    });

    const stopPolling = pollTransferProgress(transferId, fallbackTotal);
    try {
      let url = "/api/fleet/send-file";
      let body: XMLHttpRequestBodyInit;
      if (file) {
        url = rawFileUrl({
          transferId,
          file,
          collectorUrl: machine.collectorUrl ?? "",
          destDir: targetDir,
          machineName: machine.name,
        });
        body = file;
      } else {
        const form = new FormData();
        form.append("sourcePath", sourcePath ?? "");
        form.append("fileName", sourceName);
        form.append("transferId", transferId);
        form.append("collectorUrl", machine.collectorUrl ?? "");
        form.append("destDir", targetDir);
        form.append("machineName", machine.name);
        body = form;
      }

      const result = await sendWithProgress(url, body, (loaded, total) => {
        setProgress((current) => ({
          ...current,
          phase: current.phase === "idle" ? "preparing" : current.phase,
          uploadBytesSent: loaded,
          uploadTotalBytes: total ?? current.uploadTotalBytes ?? fallbackTotal,
        }));
      });

      if (!result.data?.ok || result.status < 200 || result.status >= 300) {
        setState("error");
        setMessage(result.data?.error || `HiveDrop failed with HTTP ${result.status}.`);
        return;
      }

      setState("done");
      setProgress((current) => ({
        ...current,
        phase: "done",
        bytesSent: current.totalBytes ?? current.bytesSent,
      }));
      setMessage(`HiveDrop saved to ${result.data.path ?? targetDir} on ${machine.name}.`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "HiveDrop failed.");
    } finally {
      window.setTimeout(stopPolling, 800);
    }
  }, [file, sourcePath, sourceName, state, destDir, machine.collectorUrl, machine.name, pollTransferProgress]);

  // HTML5 drop (browser / dev): Tauri swallows these in the packaged app.
  const onHtml5Drop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) pickFile(dropped);
    },
    [pickFile],
  );

  const progressTotal = progress.totalBytes ?? (file ? progress.uploadTotalBytes ?? file.size : null);
  const progressBytes = Math.max(progress.bytesSent, file ? progress.uploadBytesSent : 0);
  const progressPercent = progressTotal && progressTotal > 0
    ? Math.max(0, Math.min(100, Math.round((progressBytes / progressTotal) * 100)))
    : null;
  const progressLabel = progressPercent !== null
    ? `${formatBytes(Math.min(progressBytes, progressTotal ?? progressBytes))} of ${formatBytes(progressTotal ?? progressBytes)}`
    : progress.phase === "preparing"
      ? "Preparing HiveDrop"
      : "Sending with HiveDrop";

  return createPortal(
    <div role="presentation" className={styles.backdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Send a file privately to ${machine.name} via HiveDrop`}
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            <FileUp size={14} aria-hidden="true" style={{ color: "var(--sf-accent)", flex: "none" }} />
            <span>Send file to {machine.name}</span>
          </span>
          <CloseIconButton
            type="button"
            aria-label="Close file sender"
            onClick={onClose}
            style={{ width: 26, height: 26 }}
          />
        </div>

        <div className={styles.body}>
          <div className={styles.brandHero}>
            <span className={styles.brandMark}>
              <FileUp size={23} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span className={styles.brandIdentity}>
              <span className={styles.brandEyebrow}>HivemindOS private transfer</span>
              <span className={styles.brandName}>HiveDrop</span>
            </span>
          </div>

          <p className={styles.intro}>Drag & Drop or Browse to send a file privately via HiveDrop</p>

          <div className={styles.field}>
            <span className={styles.label}>File</span>
            <button
              ref={dropZoneRef}
              type="button"
              className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onHtml5Drop}
            >
              <span className={styles.dropZoneIcon}>
                <FileUp size={16} aria-hidden="true" />
              </span>
              <span className={styles.dropZoneText}>
                <span className={styles.dropZoneName}>
                  {dragging ? "Drop the file here" : hasSelection ? selectedName : "Choose a file"}
                </span>
                <span className={styles.dropZoneHint}>
                  {dragging
                    ? "Release to attach"
                    : file
                      ? formatBytes(file.size)
                      : sourcePath
                        ? "from this machine"
                        : "Click to browse or drop a file here"}
                </span>
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              className={styles.hiddenInput}
              onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Destination folder</span>
            <input
              type="text"
              className={styles.textInput}
              value={destDir}
              onChange={(event) => setDestDir(event.target.value)}
              placeholder="~/Downloads"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {state === "sending" || state === "done" || state === "error" ? (
            <div className={styles.progressPanel}>
              <div className={styles.progressHeader}>
                <span>{state === "done" ? "HiveDrop complete" : state === "error" ? "HiveDrop stopped" : `Sending ${selectedName}`}</span>
                <span>{progressPercent !== null ? `${progressPercent}%` : progressLabel}</span>
              </div>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="HiveDrop progress"
                aria-valuemin={0}
                aria-valuemax={progressPercent !== null ? 100 : undefined}
                aria-valuenow={progressPercent !== null ? progressPercent : undefined}
              >
                <span
                  className={`${styles.progressFill} ${progressPercent === null ? styles.progressFillIndeterminate : ""}`}
                  style={progressPercent !== null ? { width: `${progressPercent}%` } : undefined}
                />
              </div>
              <div className={styles.progressMeta}>
                <span>{progressLabel}</span>
                <span>{displayDestDir}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.sendButton}
            disabled={!hasSelection || !hasCollector || state === "sending"}
            onClick={() => void send()}
          >
            {state === "sending" ? (
              <>
                <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> Sending file
              </>
            ) : (
              <>
                <FileUp size={12} aria-hidden="true" /> Send file
              </>
            )}
          </button>
        </div>

        {state === "error" || message ? (
          <div
            className={`${styles.statusNote} ${
              state === "done" ? styles.statusNoteOk : state === "error" ? styles.statusNoteError : ""
            }`}
          >
            {message}
          </div>
        ) : (
          <div className={styles.statusNote}>
            {hasCollector
              ? `HiveDrop streams through Hivemind Link into ${displayDestDir} on ${machine.name}.`
              : `${machine.name} has no reachable collector URL, so HiveDrop cannot send to it right now.`}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
