"use client";
// Zero Human Companies — in-app deliverable viewer. Deliverable files can live
// on any fleet machine; /api/fleet/read-file resolves the (vault-synced) local
// copy. We fetch through the app's normal same-origin fetch so the request is
// AUTHENTICATED (session cookie in the browser, device token in the native app)
// — a top-level <a target="_blank"> to the API route carries neither and returns
// a raw "auth required" JSON in a stray tab (seen live 2026-07-02). Text/JSON/CSV/
// markdown/images/PDF render inline; anything else offers a download.
import React from "react";
import { Modal } from "./Modals";
import { deliverableFileHref } from "./deliverables-model";
import type { IssueDeliverable, Theme } from "./types";

type ViewerState =
  | { phase: "loading" }
  | { phase: "text"; text: string; downloadUrl: string; fileName: string }
  | { phase: "image"; objectUrl: string; downloadUrl: string; fileName: string }
  | { phase: "pdf"; objectUrl: string; downloadUrl: string; fileName: string }
  | { phase: "binary"; downloadUrl: string; fileName: string; size: number }
  | { phase: "error"; message: string };

const TEXT_TYPES = /^(?:text\/|application\/json|application\/csv|application\/xml|application\/x-ndjson)/i;
const TEXT_EXT = /\.(?:md|markdown|txt|json|jsonl|csv|tsv|log|yaml|yml|xml|html?|ts|tsx|js|mjs|py|sh|css)$/i;

function fileNameOf(d: IssueDeliverable): string {
  const base = (d.path || d.label || "file").split(/[\\/]/).filter(Boolean).at(-1) || "file";
  return base.split(/[?#]/)[0] || "file";
}

export function FileViewerModal({ deliverable, machineName, theme = "dark", onClose }: {
  deliverable: IssueDeliverable; machineName?: string; theme?: Theme; onClose: () => void;
}) {
  const [state, setState] = React.useState<ViewerState>({ phase: "loading" });
  const fileName = fileNameOf(deliverable);

  React.useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    (async () => {
      try {
        // Same-origin, credentialed fetch → inherits the dashboard's auth exactly
        // like every other /api call the view makes.
        const res = await fetch(deliverableFileHref(deliverable), { cache: "no-store", credentials: "same-origin" });
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null;
          const suffix = machineName ? ` It ran on ${machineName}; non-vault outputs stay on that machine.` : "";
          throw new Error((body?.error || `Could not open this file (HTTP ${res.status}).`) + (res.status === 404 ? suffix : ""));
        }
        const contentType = res.headers.get("content-type") || "";
        const isText = TEXT_TYPES.test(contentType) || TEXT_EXT.test(fileName);
        const blob = await res.blob();
        if (cancelled) return;
        const downloadUrl = URL.createObjectURL(blob);
        objectUrls.push(downloadUrl);
        if (isText) {
          const text = await blob.text();
          if (!cancelled) setState({ phase: "text", text, downloadUrl, fileName });
        } else if (contentType.startsWith("image/")) {
          setState({ phase: "image", objectUrl: downloadUrl, downloadUrl, fileName });
        } else if (contentType === "application/pdf") {
          setState({ phase: "pdf", objectUrl: downloadUrl, downloadUrl, fileName });
        } else {
          setState({ phase: "binary", downloadUrl, fileName, size: blob.size });
        }
      } catch (error) {
        if (!cancelled) setState({ phase: "error", message: error instanceof Error ? error.message : "Could not open this file." });
      }
    })();
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [deliverable, fileName, machineName]);

  const subtitle = [deliverable.kind, deliverable.path, machineName ? `on ${machineName}` : null].filter(Boolean).join(" · ");
  const downloadUrl = "downloadUrl" in state ? state.downloadUrl : null;
  const footer = downloadUrl ? (
    <a href={downloadUrl} download={fileName} style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--bg-3)", color: "var(--cyan-2)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "6px 12px" }}>↓ download {fileName}</a>
  ) : null;

  return (
    <Modal title={fileName} subtitle={subtitle} onClose={onClose} width={900} theme={theme} zIndex={2147483100} footer={footer}>
      {state.phase === "loading" && (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "24px 0", textAlign: "center" }}>Loading file…</div>
      )}
      {state.phase === "error" && (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--danger-2)", lineHeight: 1.6, borderRadius: 10, border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)", padding: "12px 14px" }}>
          {state.message}
        </div>
      )}
      {state.phase === "text" && (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "var(--f-mono)", fontSize: 12, lineHeight: 1.55, color: "var(--fg-2)", maxHeight: "70vh", overflow: "auto", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "12px 14px" }} className="scrollbar-thin">{state.text}</pre>
      )}
      {state.phase === "image" && (
        // Client-side blob: object URL from an authed fetch — next/image can't
        // optimize a runtime object URL, so a plain <img> is correct here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={state.objectUrl} alt={fileName} style={{ maxWidth: "100%", maxHeight: "70vh", display: "block", margin: "0 auto", borderRadius: 8 }} />
      )}
      {state.phase === "pdf" && (
        <iframe src={state.objectUrl} title={fileName} style={{ width: "100%", height: "70vh", border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
      )}
      {state.phase === "binary" && (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-3)", padding: "20px 0", textAlign: "center", lineHeight: 1.6 }}>
          This file type can’t be previewed inline ({Math.max(1, Math.round(state.size / 1024))} KB).<br />Use the download button below.
        </div>
      )}
    </Modal>
  );
}
