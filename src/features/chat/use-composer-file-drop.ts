"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";

import { filesFromDataTransfer, filesFromReferencePaths } from "@/features/chat/chat-drop-references";
import {
  listenForTauriComposerDragDrop,
  type TauriDragDropEvent,
  type TauriDropPosition,
  type TauriWebviewApi,
} from "@/features/chat/tauri-composer-drag-drop";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";

type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export type ComposerFileDropHandler = (files: FileList | File[]) => void;

/**
 * Composer file-drop behaviour shared by every chat composer surface.
 *
 * Two transports, because the desktop app needs both: the browser fires HTML5
 * drag events, but Tauri's WKWebView swallows them and re-emits native
 * `tauri://drag-*` events carrying filesystem paths instead of `File` objects
 * (see tauri-composer-drag-drop.ts). Dropping either transport silently breaks
 * drag-to-attach on one surface, so both live here rather than in a component.
 *
 * The document-level HTML5 listeners are capture-phase and hit-test against the
 * composer's own rect: a drop anywhere else on the page must not attach a file.
 */
export function useComposerFileDrop({
  enabled,
  onDropFileReferences,
}: {
  enabled: boolean;
  onDropFileReferences?: ComposerFileDropHandler;
}) {
  const dropRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const dropActiveRef = useRef(false);
  const [dropActive, setDropActive] = useState(false);

  const canDrop = Boolean(onDropFileReferences && enabled);

  const setDropActiveValue = useCallback((active: boolean) => {
    dropActiveRef.current = active;
    setDropActive((current) => (current === active ? current : active));
  }, []);

  useEffect(() => {
    if (!canDrop) return;

    function isInsideComposer(event: Pick<DragEvent, "clientX" | "clientY">) {
      const node = dropRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
    }

    function handleDocumentDragEnter(event: DragEvent) {
      if (!isInsideComposer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setDropActiveValue(true);
    }

    function handleDocumentDragOver(event: DragEvent) {
      if (!isInsideComposer(event)) {
        if (dropActiveRef.current) setDropActiveValue(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDropActiveValue(true);
    }

    function handleDocumentDragLeave(event: DragEvent) {
      if (isInsideComposer(event)) return;
      dragDepthRef.current = 0;
      setDropActiveValue(false);
    }

    function handleDocumentDrop(event: DragEvent) {
      if (!isInsideComposer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDropActiveValue(false);
      onDropFileReferences?.(event.dataTransfer ? filesFromDataTransfer(event.dataTransfer) : []);
    }

    document.addEventListener("dragenter", handleDocumentDragEnter, true);
    document.addEventListener("dragover", handleDocumentDragOver, true);
    document.addEventListener("dragleave", handleDocumentDragLeave, true);
    document.addEventListener("drop", handleDocumentDrop, true);
    return () => {
      document.removeEventListener("dragenter", handleDocumentDragEnter, true);
      document.removeEventListener("dragover", handleDocumentDragOver, true);
      document.removeEventListener("dragleave", handleDocumentDragLeave, true);
      document.removeEventListener("drop", handleDocumentDrop, true);
    };
  }, [canDrop, onDropFileReferences, setDropActiveValue]);

  useEffect(() => {
    if (!canDrop) return;
    if (typeof window === "undefined" || !(window as TauriRuntimeWindow).__TAURI_INTERNALS__) return;

    let disposed = false;
    let safeUnlisten = createSafeTauriUnlisten();

    function isInsideComposerPosition(position: TauriDropPosition) {
      const node = dropRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const contains = (x: number, y: number) => x >= rect.left
        && x <= rect.right
        && y >= rect.top
        && y <= rect.bottom;
      // Tauri reports physical pixels; the rect is in CSS pixels. On a Retina
      // display those differ by devicePixelRatio, so accept either reading.
      const scale = window.devicePixelRatio || 1;
      return contains(position.x, position.y)
        || (scale > 1 && contains(position.x / scale, position.y / scale));
    }

    function handleTauriDragDrop(event: TauriDragDropEvent) {
      const payload = event.payload;
      if (payload.type === "leave") {
        dragDepthRef.current = 0;
        setDropActiveValue(false);
        return;
      }
      const insideComposer = isInsideComposerPosition(payload.position);
      if (!insideComposer) {
        if (dropActiveRef.current) setDropActiveValue(false);
        return;
      }
      if (payload.type === "drop") {
        dragDepthRef.current = 0;
        setDropActiveValue(false);
        void filesFromReferencePaths(payload.paths).then((files) => {
          if (!disposed) onDropFileReferences?.(files);
        });
        return;
      }
      setDropActiveValue(true);
    }

    void import("@tauri-apps/api/webview")
      .then((module) => {
        if (disposed) return undefined;
        const webviewApi = module as TauriWebviewApi;
        return listenForTauriComposerDragDrop(webviewApi, handleTauriDragDrop);
      })
      .then((unlisten) => {
        if (!unlisten) return;
        safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (disposed) safeUnlisten();
      })
      .catch(() => {
        if (!disposed) {
          dragDepthRef.current = 0;
          setDropActiveValue(false);
        }
      });

    return () => {
      disposed = true;
      safeUnlisten();
    };
  }, [canDrop, onDropFileReferences, setDropActiveValue]);

  function onDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDrop) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDropActiveValue(true);
  }

  function onDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDrop) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDropActiveValue(true);
  }

  function onDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDrop) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActiveValue(false);
  }

  function onDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDrop) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDropActiveValue(false);
    onDropFileReferences?.(event.dataTransfer ? filesFromDataTransfer(event.dataTransfer) : []);
  }

  return {
    dropRef,
    dropActive,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
