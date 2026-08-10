"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./BrowserLivePreview.module.css";

type BrowserPreviewDescriptor = {
  source?: string;
  url: string;
};

type BrowserPreviewEvent = {
  browserPreview?: unknown;
};

type PreviewPosition = { left: number; top: number };

function normalizeBrowserPreview(value: unknown): BrowserPreviewDescriptor | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as { source?: unknown; url?: unknown };
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  const port = Number(url.match(/^https?:\/\/[^/]+\/app-proxy\/(\d{1,5})\/?$/i)?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    source: typeof entry.source === "string" ? entry.source.slice(0, 64) : undefined,
    url,
  };
}

export function latestBrowserPreview(events: unknown[] = []) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const preview = normalizeBrowserPreview((events[index] as BrowserPreviewEvent | undefined)?.browserPreview);
    if (preview) return preview;
  }
  return null;
}

export function browserPreviewWebSocketUrl(value: string) {
  try {
    const url = new URL(value);
    const port = Number(url.pathname.match(/^\/app-proxy\/(\d{1,5})\/?$/)?.[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "";
    if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol === "https:") url.protocol = "wss:";
    else return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function clampPosition(left: number, top: number, width: number, height: number): PreviewPosition {
  const margin = 12;
  return {
    left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin)),
    top: Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - height - margin)),
  };
}

export function BrowserLivePreview({
  active,
  preview,
}: {
  active: boolean;
  preview: BrowserPreviewDescriptor;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    originLeft: number;
    originTop: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const hasFrameRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [connection, setConnection] = useState<{
    status: "connecting" | "live" | "reconnecting";
    url: string;
  }>({ status: "connecting", url: "" });
  const [position, setPosition] = useState<PreviewPosition | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const socketUrl = browserPreviewWebSocketUrl(preview.url);
    if (!socketUrl) return undefined;
    let stopped = false;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | undefined;
    hasFrameRef.current = false;
    if (imageRef.current) imageRef.current.removeAttribute("src");

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(socketUrl);
      socket.onopen = () => setConnection({
        status: hasFrameRef.current ? "live" : "connecting",
        url: preview.url,
      });
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as { data?: unknown; type?: unknown };
          if (message.type !== "frame" || typeof message.data !== "string" || !message.data) return;
          if (imageRef.current) imageRef.current.src = `data:image/jpeg;base64,${message.data}`;
          if (!hasFrameRef.current) {
            hasFrameRef.current = true;
            setConnection({ status: "live", url: preview.url });
          }
        } catch {
          // Ignore non-frame stream messages; the next valid frame keeps the preview live.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setConnection({ status: "reconnecting", url: preview.url });
        reconnectTimer = window.setTimeout(connect, 800);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [active, preview.url]);

  useEffect(() => {
    if (!position) return undefined;
    const keepInViewport = () => {
      const panel = panelRef.current;
      if (!panel) return;
      setPosition((current) => current
        ? clampPosition(current.left, current.top, panel.offsetWidth, panel.offsetHeight)
        : current);
    };
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, [position]);

  if (!active) return null;

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = {
      originLeft: rect.left,
      originTop: rect.top,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPosition({ left: rect.left, top: rect.top });
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || drag.pointerId !== event.pointerId) return;
    setPosition(clampPosition(
      drag.originLeft + event.clientX - drag.startX,
      drag.originTop + event.clientY - drag.startY,
      panel.offsetWidth,
      panel.offsetHeight,
    ));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const positionStyle: CSSProperties = position
    ? { left: position.left, top: position.top }
    : { bottom: 18, right: 18 };
  const connectionStatus = connection.url === preview.url ? connection.status : "connecting";
  const statusText = connectionStatus === "live"
    ? "Live"
    : connectionStatus === "reconnecting"
      ? "Reconnecting"
      : "Connecting";

  return (
    <div
      ref={panelRef}
      className={styles.preview}
      data-collapsed={collapsed ? "true" : undefined}
      style={positionStyle}
      aria-label="Live browser preview"
    >
      <div
        className={styles.titleBar}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Drag to move the browser preview"
      >
        <span className={styles.browserMark} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className={styles.title}>Browser</span>
        <span className={styles.status} data-live={connectionStatus === "live" ? "true" : undefined}>
          <span className={styles.statusDot} aria-hidden="true" />
          {statusText}
        </span>
        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? "Expand browser preview" : "Collapse browser preview"}
          title={collapsed ? "Expand preview" : "Collapse preview"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span aria-hidden="true">{collapsed ? "↗" : "−"}</span>
        </button>
      </div>
      {collapsed ? null : (
        <div className={styles.viewport}>
          <div className={styles.placeholder} data-hidden={connectionStatus === "live" ? "true" : undefined}>
            <span className={styles.placeholderGlow} />
            <span>{statusText} to browser…</span>
          </div>
          {/* The frame stream is visual telemetry; changing src via a ref avoids a React render per frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} className={styles.frame} alt="Live browser viewport" />
          <span className={styles.liveBadge}>
            <span aria-hidden="true" />
            Agent browsing
          </span>
        </div>
      )}
    </div>
  );
}
