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

// Sends a file to a fleet machine over the tailnet. The bytes are POSTed to
// /api/fleet/send-file, which streams them to the machine via `tailscale ssh`
// (the same transport the shell button and handoff use to reach machines).
//
// Drag-and-drop has to be wired two ways. In a browser the HTML5 drop event
// fires with the File bytes. In the packaged Tauri app the native layer
// (dragDropEnabled, on by default) swallows the HTML5 event and instead emits
// `tauri://drag-drop` with the OS file path — so we listen for that too and
// send the path for the server to read locally. Mirrors chat-composer.tsx.

type MachineSendFileModalProps = {
  machine: FleetMachine;
  onClose: () => void;
};

type SendState = "idle" | "sending" | "done" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function MachineSendFileModal({ machine, onClose }: MachineSendFileModalProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [sourcePath, setSourcePath] = React.useState<string | null>(null);
  const [sourceName, setSourceName] = React.useState("");
  const [destDir, setDestDir] = React.useState("~/Downloads");
  const [state, setState] = React.useState<SendState>("idle");
  const [message, setMessage] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropZoneRef = React.useRef<HTMLButtonElement>(null);
  const hasCollector = Boolean(machine.collectorUrl);
  const hasSelection = Boolean(file || sourcePath);
  const selectedName = file?.name ?? sourceName;

  const pickFile = React.useCallback((next: File | null) => {
    if (!next) return;
    setFile(next);
    setSourcePath(null);
    setSourceName(next.name);
    setState("idle");
    setMessage("");
  }, []);

  const pickPath = React.useCallback((path: string) => {
    setSourcePath(path);
    setFile(null);
    setSourceName(baseName(path));
    setState("idle");
    setMessage("");
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
    setState("sending");
    setMessage("");
    try {
      const form = new FormData();
      if (file) {
        form.append("file", file);
      } else if (sourcePath) {
        form.append("sourcePath", sourcePath);
        form.append("fileName", sourceName);
      }
      form.append("collectorUrl", machine.collectorUrl ?? "");
      form.append("destDir", destDir.trim() || "~/Downloads");
      form.append("machineName", machine.name);
      const res = await fetch("/api/fleet/send-file", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; path?: string; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setState("error");
        setMessage(data?.error || `Transfer failed (HTTP ${res.status}).`);
        return;
      }
      setState("done");
      setMessage(`Saved to ${data.path ?? destDir} on ${machine.name}.`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Transfer failed.");
    }
  }, [file, sourcePath, sourceName, state, destDir, machine.collectorUrl, machine.name]);

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

  return createPortal(
    <div role="presentation" className={styles.backdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Send a file to ${machine.name}`}
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
            aria-label="Close send file"
            onClick={onClose}
            style={{ width: 26, height: 26 }}
          />
        </div>

        <div className={styles.body}>
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
                  {dragging ? "Drop the file here" : hasSelection ? selectedName : "Choose a file…"}
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
                <LoaderCircle size={12} className="animate-spin" aria-hidden="true" /> Sending…
              </>
            ) : (
              <>
                <FileUp size={12} aria-hidden="true" /> Send over tailscale
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
              ? `Streams over tailscale ssh into ${destDir.trim() || "~/Downloads"} on ${machine.name}.`
              : `${machine.name} has no reachable collector URL — can't send a file to it right now.`}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
