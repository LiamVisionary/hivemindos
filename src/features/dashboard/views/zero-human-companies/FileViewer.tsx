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
const MARKDOWN_EXT = /\.(?:md|markdown)$/i;
const DOCUMENT_TEXT_EXT = /\.(?:txt)$/i;
const RAW_TEXT_EXT = /\.(?:json|jsonl|csv|tsv|log|yaml|yml|xml|html?|ts|tsx|js|mjs|py|sh|css)$/i;

function fileNameOf(d: IssueDeliverable): string {
  const base = (d.path || d.label || "file").split(/[\\/]/).filter(Boolean).at(-1) || "file";
  return base.split(/[?#]/)[0] || "file";
}

function textMode(fileName: string, kind?: string): "markdown" | "document" | "raw" {
  if (MARKDOWN_EXT.test(fileName)) return "markdown";
  if (RAW_TEXT_EXT.test(fileName)) return "raw";
  const label = `${kind ?? ""} ${fileName}`.toLowerCase();
  if (DOCUMENT_TEXT_EXT.test(fileName) || /\b(report|document|brief|memo|result|note)\b/.test(label)) return "document";
  return "raw";
}

function stripFrontmatter(text: string): string {
  return text.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

function safeHref(href: string): string {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) || trimmed.startsWith("#")) return trimmed;
  return "#";
}

function inlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>()]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={`code-${match.index}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={`strong-${match.index}`}>{inlineMarkdown(token.slice(2, -2))}</strong>);
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = safeHref(link?.[2] ?? "#");
      const external = /^https?:\/\//i.test(href);
      nodes.push(
        <a key={`link-${match.index}`} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
          {link?.[1] ?? token}
        </a>,
      );
    } else {
      const href = safeHref(token.replace(/[.,;:!?]+$/, ""));
      const trailing = token.slice(href.length);
      nodes.push(<a key={`url-${match.index}`} href={href} target="_blank" rel="noreferrer">{href}</a>);
      if (trailing) nodes.push(trailing);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function keyValueLine(line: string): { key: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z0-9 _/-]{1,32}):\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  return { key: match[1].trim(), value: match[2].trim() };
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderDocumentBlocks(text: string, markdown: boolean): React.ReactNode[] {
  const lines = stripFrontmatter(text).split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let index = 0;
  const nextKey = (kind: string) => `${kind}-${index}-${blocks.length}`;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (markdown && trimmed.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre className="zhc-file-document-code" key={nextKey("code")}><code>{code.join("\n")}</code></pre>);
      continue;
    }

    if (markdown && /^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={nextKey("hr")} />);
      index += 1;
      continue;
    }

    if (markdown) {
      const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
      if (heading) {
        const level = heading[1].length;
        const content = inlineMarkdown(heading[2]);
        blocks.push(level === 1
          ? <h1 key={nextKey("h1")}>{content}</h1>
          : level === 2
            ? <h2 key={nextKey("h2")}>{content}</h2>
            : <h3 key={nextKey("h3")}>{content}</h3>);
        index += 1;
        continue;
      }
    }

    if (markdown && index + 1 < lines.length && /\|/.test(trimmed) && isTableDivider(lines[index + 1])) {
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && /\|/.test(lines[index].trim())) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="zhc-file-document-tableWrap" key={nextKey("table")}>
          <table>
            <thead><tr>{header.map((cell, cellIndex) => <th key={`h-${cellIndex}`}>{inlineMarkdown(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={`r-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`c-${cellIndex}`}>{inlineMarkdown(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const meta = keyValueLine(trimmed);
    if (meta && !/^https?:\/\//i.test(meta.value)) {
      const items = [meta];
      index += 1;
      while (index < lines.length) {
        const next = keyValueLine(lines[index]);
        if (!next) break;
        items.push(next);
        index += 1;
      }
      blocks.push(
        <dl className="zhc-file-document-meta" key={nextKey("meta")}>
          {items.map((item) => (
            <React.Fragment key={item.key}>
              <dt>{item.key}</dt>
              <dd>{inlineMarkdown(item.value)}</dd>
            </React.Fragment>
          ))}
        </dl>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, "").trim());
        index += 1;
      }
      blocks.push(<ul key={nextKey("ul")}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, "").trim());
        index += 1;
      }
      blocks.push(<ol key={nextKey("ol")}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    if (markdown && /^>\s+/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s+/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s+/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={nextKey("quote")}>{quote.map((item, itemIndex) => <p key={itemIndex}>{inlineMarkdown(item)}</p>)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (markdown && /^(#{1,3})\s+|```|^\s*[-*]\s+|^\s*\d+[.)]\s+|^>\s+/.test(lines[index])) break;
      const nextMeta = keyValueLine(lines[index]);
      if (nextMeta && !/^https?:\/\//i.test(nextMeta.value)) break;
      if (index + 1 < lines.length && /\|/.test(lines[index]) && isTableDivider(lines[index + 1])) break;
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) blocks.push(<p key={nextKey("p")}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }

  return blocks;
}

function DocumentTextView({ text, markdown }: { text: string; markdown: boolean }) {
  return (
    <article className="zhc-file-document scrollbar-thin">
      {renderDocumentBlocks(text, markdown)}
    </article>
  );
}

function RawTextView({ text }: { text: string }) {
  return <pre className="zhc-file-raw scrollbar-thin">{text}</pre>;
}

function TextPreview({ text, fileName, kind }: { text: string; fileName: string; kind?: string }) {
  const mode = textMode(fileName, kind);
  return mode === "raw"
    ? <RawTextView text={text} />
    : <DocumentTextView text={text} markdown={mode === "markdown"} />;
}

export function FileViewerModal({ deliverable, displayTitle, displayKind, machineName, theme = "dark", onClose }: {
  deliverable: IssueDeliverable; displayTitle?: string; displayKind?: string; machineName?: string; theme?: Theme; onClose: () => void;
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

  const modalTitle = displayTitle?.trim() || fileName;
  const subtitle = [displayKind || deliverable.kind || "File", machineName ? `on ${machineName}` : null].filter(Boolean).join(" · ");
  const downloadUrl = "downloadUrl" in state ? state.downloadUrl : null;
  const footer = downloadUrl ? (
    <a href={downloadUrl} download={fileName} style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--bg-3)", color: "var(--cyan-2)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "6px 12px" }}>Download {fileName}</a>
  ) : null;

  return (
    <Modal title={modalTitle} subtitle={subtitle} onClose={onClose} width={920} theme={theme} zIndex={2147483100} footer={footer}>
      {state.phase === "loading" && (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "24px 0", textAlign: "center" }}>Loading file…</div>
      )}
      {state.phase === "error" && (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--danger-2)", lineHeight: 1.6, borderRadius: 10, border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", background: "color-mix(in srgb, var(--danger) 10%, transparent)", padding: "12px 14px" }}>
          {state.message}
        </div>
      )}
      {state.phase === "text" && (
        <TextPreview text={state.text} fileName={state.fileName} kind={deliverable.kind} />
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
