"use client";

import {
  ArrowUp,
  BrainCircuit,
  ChevronLeft,
  FileStack,
  FolderOpen,
  LoaderCircle,
  MessageSquareText,
  Plus,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  arrayBufferToBase64,
  documentsFromDataTransfer,
  documentsFromFileList,
  prepareBrainDropDocuments,
  type BrainDropDocument,
} from "@/features/dashboard/views/brain-drop/brain-drop-files";
import {
  listenForTauriComposerDragDrop,
  type TauriDragDropEvent,
  type TauriDropPosition,
  type TauriWebviewApi,
} from "@/features/chat/tauri-composer-drag-drop";
import {
  openNativeBrainDropPaths,
  readNativeBrainDropDocuments,
  type NativeBrainDropDocument,
} from "@/lib/native/brain-drop-files";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import { DOCUMENT_INGESTION_ACCEPT } from "@/lib/services/document-ingestion-capabilities";

import styles from "./brain-drop-fab.module.css";

type BrainDropFabProps = {
  onImported?: (force?: boolean) => void | Promise<void>;
  vaultPath?: string;
};

type ImportResponse = {
  ok?: boolean;
  error?: string;
  imported?: Array<{ sourceName: string; notePath: string; created: boolean }>;
  failures?: Array<{ sourceName: string; error: string }>;
};

type CaptureResponse = {
  ok?: boolean;
  error?: string;
  note?: { notePath?: string };
  processing?: { routedNotePath?: string; status?: string; error?: string };
};

type TauriRuntimeWindow = Window & { __TAURI_INTERNALS__?: unknown };

function isFileDrag(event: Pick<DragEvent, "dataTransfer">) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function containsPosition(node: HTMLElement, position: TauriDropPosition) {
  const rect = node.getBoundingClientRect();
  const contains = (x: number, y: number) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  const scale = window.devicePixelRatio || 1;
  return contains(position.x, position.y) || (scale > 1 && contains(position.x / scale, position.y / scale));
}

export function BrainDropFab({ onImported, vaultPath }: BrainDropFabProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const textCaptureIdRef = useRef("");
  const dragDepthRef = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "text">("menu");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [status, setStatus] = useState("");

  const expanded = menuOpen || mode === "text" || busy;

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    void fetch("/api/brain/imported-sources").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode !== "text") return;
    const timer = window.setTimeout(() => textInputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const refreshBrain = useCallback(() => {
    void onImported?.(true);
  }, [onImported]);

  const uploadDocuments = useCallback(async (documents: NativeBrainDropDocument[], skipped = 0) => {
    if (!documents.length) {
      setBusy(false);
      setStatus(skipped
        ? `${skipped} unsupported, empty, oversized, or over-limit item${skipped === 1 ? " was" : "s were"} skipped.`
        : "No supported documents were found.");
      return;
    }
    setBusy(true);
    setMenuOpen(true);
    setStatus(`Reading ${documents.length} source${documents.length === 1 ? "" : "s"} into the brain…`);
    try {
      const response = await fetch("/api/brain/imported-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultPath, files: documents }),
      });
      const payload = await response.json().catch(() => ({})) as ImportResponse;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Brain import failed.");
      const imported = payload.imported?.length ?? 0;
      const failed = payload.failures?.length ?? 0;
      const omitted = skipped + failed;
      setStatus(`${imported} source${imported === 1 ? "" : "s"} fed to the brain${omitted ? ` · ${omitted} skipped or failed` : ""}.`);
      refreshBrain();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Brain import failed.");
    } finally {
      setBusy(false);
    }
  }, [refreshBrain, vaultPath]);

  const processBrowserDocuments = useCallback(async (candidates: BrainDropDocument[]) => {
    const prepared = prepareBrainDropDocuments(candidates);
    if (!prepared.documents.length) {
      await uploadDocuments([], prepared.skipped);
      return;
    }
    setBusy(true);
    setMenuOpen(true);
    setStatus(`Preparing ${prepared.documents.length} source${prepared.documents.length === 1 ? "" : "s"}…`);
    try {
      const uploads = await Promise.all(prepared.documents.map(async ({ file, sourceName }) => ({
        name: sourceName,
        mimeType: file.type || "application/octet-stream",
        dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
      })));
      await uploadDocuments(uploads, prepared.skipped);
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : "Could not read the selected documents.");
    }
  }, [uploadDocuments]);

  const processNativePaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    setMenuOpen(true);
    setStatus("Collecting supported documents…");
    try {
      const result = await readNativeBrainDropDocuments(paths);
      await uploadDocuments(result.documents, result.skipped);
    } catch (error) {
      setBusy(false);
      setStatus(error instanceof Error ? error.message : "Could not read the selected paths.");
    }
  }, [uploadDocuments]);

  const choose = useCallback(async (kind: "files" | "folders") => {
    if (busy) return;
    try {
      const nativePaths = await openNativeBrainDropPaths(kind);
      if (nativePaths !== null) {
        await processNativePaths(nativePaths);
        return;
      }
      (kind === "files" ? fileInputRef : folderInputRef).current?.click();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open the file browser.");
    }
  }, [busy, processNativePaths]);

  const captureText = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setStatus("Feeding your thought to the brain…");
    try {
      const response = await fetch("/api/obsidian/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "capture",
          vaultPath,
          content,
          source: "brain-drop-fab",
          tags: ["brain-drop-ui", "text-input"],
          idempotencyKey: textCaptureIdRef.current || (textCaptureIdRef.current = `brain-drop-${crypto.randomUUID()}`),
        }),
      });
      const payload = await response.json().catch(() => ({})) as CaptureResponse;
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Brain capture failed.");
      setText("");
      textCaptureIdRef.current = "";
      setMode("menu");
      setStatus(payload.processing?.routedNotePath
        ? `Thought routed to ${payload.processing.routedNotePath}.`
        : payload.processing?.status === "pending-retry"
          ? "Thought captured. Brain processing will retry automatically."
          : "Thought fed to the brain.");
      refreshBrain();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Brain capture failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    function insideLayer(event: Pick<DragEvent, "clientX" | "clientY">) {
      const node = layerRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }
    function enter(event: DragEvent) {
      if (busy || !isFileDrag(event) || !insideLayer(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDropActive(true);
    }
    function over(event: DragEvent) {
      if (busy || !isFileDrag(event) || !insideLayer(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDropActive(true);
    }
    function leave(event: DragEvent) {
      if (insideLayer(event)) return;
      dragDepthRef.current = 0;
      setDropActive(false);
    }
    function drop(event: DragEvent) {
      if (busy || !insideLayer(event) || !isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDropActive(false);
      if (event.dataTransfer) {
        void documentsFromDataTransfer(event.dataTransfer).then(processBrowserDocuments);
      }
    }
    document.addEventListener("dragenter", enter, true);
    document.addEventListener("dragover", over, true);
    document.addEventListener("dragleave", leave, true);
    document.addEventListener("drop", drop, true);
    return () => {
      document.removeEventListener("dragenter", enter, true);
      document.removeEventListener("dragover", over, true);
      document.removeEventListener("dragleave", leave, true);
      document.removeEventListener("drop", drop, true);
    };
  }, [busy, processBrowserDocuments]);

  useEffect(() => {
    if (typeof window === "undefined" || !(window as TauriRuntimeWindow).__TAURI_INTERNALS__) return;
    let disposed = false;
    let safeUnlisten = createSafeTauriUnlisten();
    function handleNativeDrop(event: TauriDragDropEvent) {
      const node = layerRef.current;
      const payload = event.payload;
      if (busy || !node || payload.type === "leave") {
        setDropActive(false);
        return;
      }
      if (!containsPosition(node, payload.position)) {
        setDropActive(false);
        return;
      }
      if (payload.type === "drop") {
        setDropActive(false);
        void processNativePaths(payload.paths);
        return;
      }
      setDropActive(true);
    }
    void import("@tauri-apps/api/webview")
      .then((module) => listenForTauriComposerDragDrop(module as TauriWebviewApi, handleNativeDrop))
      .then((unlisten) => {
        safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (disposed) safeUnlisten();
      })
      .catch(() => setDropActive(false));
    return () => {
      disposed = true;
      safeUnlisten();
    };
  }, [busy, processNativePaths]);

  return (
    <div ref={layerRef} className={styles.layer} aria-label="Feed the brain drop zone">
      {dropActive ? (
        <div className={styles.dropOverlay} aria-live="polite">
          <span className={styles.dropGlyph}><Sparkles aria-hidden="true" /></span>
          <strong>Drop to feed the brain</strong>
          <span>Files and folders become searchable Markdown</span>
        </div>
      ) : null}

      <div className={styles.dock} data-mode={mode}>
        {status ? <div className={styles.status} role="status">{status}</div> : null}
        <div
          className={styles.shell}
          data-expanded={expanded ? "true" : undefined}
          data-mode={mode}
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => {
            if (mode === "menu" && !busy) setMenuOpen(false);
          }}
          onFocusCapture={() => setMenuOpen(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget) && mode === "menu" && !busy) setMenuOpen(false);
          }}
        >
          {mode === "text" ? (
            <form className={styles.textComposer} onSubmit={(event) => { event.preventDefault(); void captureText(); }}>
              <button type="button" className={styles.circleButton} aria-label="Back to Feed the brain actions" onClick={() => setMode("menu")} disabled={busy}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <textarea
                ref={textInputRef}
                rows={1}
                value={text}
                placeholder="What should the brain remember?"
                aria-label="Brain Drop text"
                onChange={(event) => {
                  textCaptureIdRef.current = "";
                  setText(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void captureText();
                  }
                  if (event.key === "Escape") setMode("menu");
                }}
                disabled={busy}
              />
              <button type="submit" className={styles.sendButton} aria-label="Feed text to the brain" disabled={busy || !text.trim()}>
                {busy ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : <ArrowUp aria-hidden="true" />}
              </button>
            </form>
          ) : (
            <div className={styles.menu}>
              <button type="button" className={styles.collapsedButton} aria-label="Open Feed the brain" onClick={() => setMenuOpen(true)}>
                {busy ? <LoaderCircle aria-hidden="true" className={styles.spin} /> : expanded ? <BrainCircuit aria-hidden="true" /> : <Plus aria-hidden="true" />}
              </button>
              <span className={styles.title}>Feed the brain</span>
              <div className={styles.actions} role="group" aria-label="Feed the brain options">
                <button type="button" className={styles.circleButton} aria-label="Feed text to the brain" title="Text" onClick={() => setMode("text")} disabled={busy}>
                  <MessageSquareText aria-hidden="true" />
                </button>
                <button type="button" className={styles.circleButton} aria-label="Feed files to the brain" title="Files" onClick={() => void choose("files")} disabled={busy}>
                  <FileStack aria-hidden="true" />
                </button>
                <button type="button" className={styles.circleButton} aria-label="Feed folders to the brain" title="Folders" onClick={() => void choose("folders")} disabled={busy}>
                  <FolderOpen aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_INGESTION_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          void processBrowserDocuments(documentsFromFileList(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept={DOCUMENT_INGESTION_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          void processBrowserDocuments(documentsFromFileList(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
