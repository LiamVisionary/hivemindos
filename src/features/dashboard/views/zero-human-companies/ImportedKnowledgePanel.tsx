"use client";

import { Panel, SectionLabel } from "./primitives";
import type { Colony } from "./types";

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ImportedKnowledgePanel({ colony }: { colony: Colony }) {
  const knowledge = colony.importedKnowledge;
  if (!knowledge) return null;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey)" }}>local · native reader</span>}>company data room</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {[
            ["documents", String(knowledge.documents.length)],
            ["source size", formatBytes(knowledge.totalSourceBytes)],
            ["failed files", String(knowledge.failedFiles.length)],
            ["last refreshed", knowledge.lastDiscoveredAt.slice(0, 10)],
          ].map(([label, value]) => (
            <div key={label} style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel-2)", padding: "12px 13px" }}>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 600, color: "var(--fg)", wordBreak: "break-word" }}>{value}</div>
              <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 6 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, border: "1px solid var(--honey-line)", borderRadius: 10, background: "var(--honey-soft)", padding: "11px 12px", color: "var(--fg-2)", fontSize: 12, lineHeight: 1.6 }}>
          These are reviewable reference sources, not standing instructions. Agents may search and cite them; a human must deliberately promote any operating rule through Learning.
        </div>
      </Panel>

      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{knowledge.notesFolder}</span>}>imported sources</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 9 }}>
          {knowledge.documents.map((document) => (
            <div key={document.id} style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg-2)", padding: "11px 12px", minWidth: 0 }}>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 600, color: "var(--fg)", lineHeight: 1.35, wordBreak: "break-word" }}>{document.title}</div>
              <div style={{ marginTop: 6, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", lineHeight: 1.5, wordBreak: "break-word" }}>{document.format} · {formatBytes(document.sourceBytes)} · sha256:{document.sourceSha256.slice(0, 12)}</div>
              <div style={{ marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)", lineHeight: 1.5, wordBreak: "break-word" }}>{document.relativePath}</div>
              <div style={{ marginTop: 4, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--honey)", lineHeight: 1.5, wordBreak: "break-word" }}>{document.notePath}</div>
            </div>
          ))}
        </div>
      </Panel>

      {knowledge.failedFiles.length ? (
        <Panel>
          <SectionLabel>files needing attention</SectionLabel>
          <div style={{ display: "grid", gap: 8 }}>
            {knowledge.failedFiles.map((failure) => (
              <div key={failure.sourceName} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--danger-2)", lineHeight: 1.5, wordBreak: "break-word" }}>
                {failure.sourceName}: {failure.error}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
