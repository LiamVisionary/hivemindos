"use client";
// Zero Human Companies — the real work behind a board card: the agent's result,
// its deliverables (as human cards), and eval receipts. Deliverables are bucketed
// so junk (command strings, fabricated URLs, scratch files) collapses instead of
// cluttering the view. Its own file to keep the Modals ↔ FileViewer graph acyclic.
import React from "react";
import { Modal } from "./Modals";
import { SectionLabel } from "./primitives";
import { DeliverableCard } from "./DeliverableCard";
import { bucketDeliverables } from "./deliverables-model";
import type { Issue, Theme } from "./types";

const RECEIPT_TONE: Record<string, string> = { passed: "var(--cyan-2)", failed: "var(--danger-2)", skipped: "var(--fg-4)" };

export function TaskDetailModal({ issue, colonyName, theme = "dark", onClose }: {
  issue: Issue; colonyName: string; theme?: Theme; onClose: () => void;
}) {
  const work = issue.work;
  const [showInternal, setShowInternal] = React.useState(false);
  if (!work) return null;
  const when = work.completedAt ?? work.updatedAt;
  const subtitleParts = [
    issue.agent ? `by ${issue.agent}` : null,
    work.status,
    work.machineName,
    when ? new Date(when).toLocaleString() : null,
    colonyName,
  ].filter(Boolean);
  const buckets = bucketDeliverables(work.deliverables);

  return (
    <Modal title={issue.title} subtitle={subtitleParts.join(" · ")} onClose={onClose} width={780} theme={theme}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {buckets.visible.length > 0 && (
          <div>
            <SectionLabel>deliverables · {buckets.visible.length}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {buckets.visible.map((c, i) => (
                <DeliverableCard key={`v-${i}-${c.deliverable.id}`} item={c} machineName={work.machineName} theme={theme} layout="row" />
              ))}
            </div>
          </div>
        )}
        {work.result?.trim() ? (
          <div>
            <SectionLabel>result</SectionLabel>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-2)", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "12px 14px" }}>
              {work.result}
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>No result recorded yet.</div>
        )}
        {work.receipts.length > 0 && (
          <div>
            <SectionLabel>eval receipts · {work.receipts.length}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {work.receipts.map((r, i) => (
                <div key={`${i}-${r.title.slice(0, 24)}`} style={{ display: "flex", gap: 9, alignItems: "baseline", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.5 }}>
                  <span className="mono-cap" style={{ color: RECEIPT_TONE[r.status] ?? "var(--fg-4)", flexShrink: 0 }}>{r.status}</span>
                  <span style={{ color: "var(--fg-3)", overflowWrap: "anywhere" }}>{r.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {buckets.internal.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowInternal((v) => !v)} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", padding: 0 }}>
              {showInternal ? "▾" : "▸"} {buckets.internal.length} working file{buckets.internal.length === 1 ? "" : "s"} (internal / not openable)
            </button>
            {showInternal && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {buckets.internal.map((c, i) => (
                  <DeliverableCard key={`i-${i}-${c.deliverable.id}`} item={c} machineName={work.machineName} theme={theme} layout="row" />
                ))}
              </div>
            )}
          </div>
        )}
        {work.body?.trim() ? (
          <details>
            <summary style={{ cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>original task brief</summary>
            <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-3)", marginTop: 8, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "12px 14px" }}>
              {work.body}
            </div>
          </details>
        ) : null}
      </div>
    </Modal>
  );
}
