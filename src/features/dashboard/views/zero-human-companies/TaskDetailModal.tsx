"use client";
// Zero Human Companies — the real work behind a board card: the agent's result,
// its deliverables (as human cards), and eval receipts. Deliverables are bucketed
// so junk (command strings, fabricated URLs, scratch files) collapses instead of
// cluttering the view. Its own file to keep the Modals ↔ FileViewer graph acyclic.
import React from "react";
import { Modal } from "./Modals";
import { SectionLabel, Spinner } from "./primitives";
import { DeliverableCard } from "./DeliverableCard";
import { CompanyIssueActionButtons, isCompanyReviewIssue } from "./CompanyIssueActions";
import { bucketDeliverables } from "./deliverables-model";
import type { PreviewDecision } from "./preview-review";
import type { Issue, Theme } from "./types";

const RECEIPT_TONE: Record<string, string> = { passed: "var(--cyan-2)", failed: "var(--danger-2)", skipped: "var(--fg-4)" };

/** Plain-language, actionable explanation of a blocked task (from the Queen). */
type Explanation = { headline: string; steps: string[]; detail: string };

// Explanations are on-demand and read-only, so cache them across modal re-opens
// (the modal remounts on every open) keyed by task + its last-updated stamp, so a
// task that changed since the last explanation re-explains instead of going stale.
const explanationCache = new Map<string, Explanation>();

export function TaskDetailModal({ issue, colonyName, companyId, apexGoal, metric, theme = "dark", onClose, onResolveIssue, onReviewPreview, busy }: {
  issue: Issue; colonyName: string; companyId?: string; apexGoal?: string; metric?: string; theme?: Theme; onClose: () => void; onResolveIssue?: (issue: Issue) => void; onReviewPreview?: (issue: Issue, decision: PreviewDecision, notes: string) => void; busy?: boolean;
}) {
  const work = issue.work;
  const [showInternal, setShowInternal] = React.useState(false);
  const cacheKey = work ? `${work.taskId}:${work.updatedAt ?? ""}` : "";
  const [explanation, setExplanation] = React.useState<Explanation | null>(() => explanationCache.get(cacheKey) ?? null);
  const [explaining, setExplaining] = React.useState(false);
  const [explainError, setExplainError] = React.useState("");

  const runExplain = React.useCallback(async () => {
    if (!work || !companyId) return;
    setExplaining(true);
    setExplainError("");
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/explain-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskTitle: issue.title,
          companyName: colonyName,
          apexGoal,
          metric,
          result: work.result ?? "",
          receipts: (work.receipts ?? []).map((r) => ({ status: r.status, summary: r.title, evidence: r.evidence ?? [] })),
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; explanation?: Explanation; error?: string } | null;
      if (!json?.ok || !json.explanation) {
        setExplainError(json?.error || "Couldn't generate an explanation just now.");
        return;
      }
      explanationCache.set(cacheKey, json.explanation);
      setExplanation(json.explanation);
    } catch {
      setExplainError("Couldn't reach the explainer just now.");
    } finally {
      setExplaining(false);
    }
  }, [work, companyId, issue.title, colonyName, apexGoal, metric, cacheKey]);

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
  const workTimestampMs = work.completedAt ?? work.updatedAt;
  // This explainer is specifically for blocked / needs-human cards; shipped
  // work already has the result and receipts below.
  const isBlockedForHuman = issue.status === "board_review" || work.status === "needs-human";
  const canExplain = isBlockedForHuman && Boolean(companyId) && Boolean(work.result?.trim() || work.receipts.length);

  return (
    <Modal title={issue.title} subtitle={subtitleParts.join(" · ")} onClose={onClose} width={780} theme={theme}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {isCompanyReviewIssue(issue) && (
          <div style={{ borderRadius: 12, border: "1px solid color-mix(in srgb, var(--honey) 32%, var(--line))", background: "color-mix(in srgb, var(--honey) 7%, var(--bg-2))", padding: "12px 14px" }}>
            <SectionLabel>issue actions</SectionLabel>
            <CompanyIssueActionButtons companyName={colonyName} issue={issue} onResolveIssue={onResolveIssue} onReviewPreview={onReviewPreview} busy={busy} />
          </div>
        )}
        {canExplain && (
          <div style={{ borderRadius: 12, border: "1px solid var(--honey-2)", background: "var(--bg-2)", padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--honey-2)" }}>
                What&apos;s happening &amp; what to do
              </span>
              {(!explanation || explaining) && (
                <button
                  type="button"
                  onClick={() => void runExplain()}
                  disabled={explaining}
                  style={{
                    fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 600,
                    color: explaining ? "var(--fg-4)" : "var(--bg)", background: explaining ? "transparent" : "var(--honey-2)",
                    border: explaining ? "1px solid var(--line)" : "none", borderRadius: 8, padding: "6px 12px",
                    cursor: explaining ? "default" : "pointer",
                  }}
                >
                  {explaining ? <><Spinner size={12} /> Asking the Queen</> : explainError ? "Try again" : "Explain this for me"}
                </button>
              )}
            </div>
            {explainError && !explaining ? (
              <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--danger-2)" }}>{explainError}</div>
            ) : null}
            {!explanation && !explaining && !explainError ? (
              <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5, color: "var(--fg-4)" }}>
                Get a plain-language summary of why this is blocked and the exact next step, read from this task&apos;s own evidence.
              </div>
            ) : null}
            {explanation ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg)", fontWeight: 500, textWrap: "pretty" }}>{explanation.headline}</div>
                {explanation.steps.length > 0 && (
                  <div>
                    <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.04, textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 5 }}>What to do</div>
                    <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                      {explanation.steps.map((step, i) => (
                        <li key={i} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-2)" }}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
                {explanation.detail ? (
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--fg-3)" }}>{explanation.detail}</div>
                ) : null}
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
                  Queen Bee, from this task&apos;s evidence · re-check the specifics before acting
                </div>
              </div>
            ) : null}
          </div>
        )}
        {buckets.visible.length > 0 && (
          <div>
            <SectionLabel>deliverables · {buckets.visible.length}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {buckets.visible.map((c, i) => (
                <DeliverableCard key={`v-${i}-${c.deliverable.id}`} item={c} machineName={work.machineName} timestampMs={workTimestampMs} theme={theme} layout="row" />
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
            <SectionLabel>verification checks · {work.receipts.length}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {work.receipts.map((r, i) => {
                const evidence = (r.evidence ?? []).filter((line) => line?.trim());
                return (
                  <div key={`${i}-${r.title.slice(0, 24)}`} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ display: "flex", gap: 9, alignItems: "baseline", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.5 }}>
                      <span className="mono-cap" style={{ color: RECEIPT_TONE[r.status] ?? "var(--fg-4)", flexShrink: 0 }}>{r.status}</span>
                      <span style={{ color: "var(--fg-3)", overflowWrap: "anywhere" }}>{r.title}</span>
                    </div>
                    {evidence.length > 0 && (
                      <details style={{ marginLeft: 14 }}>
                        <summary style={{ cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>
                          evidence · {evidence.length}
                        </summary>
                        <ul style={{ margin: "6px 0 0", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                          {evidence.map((line, j) => (
                            <li key={j} style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.5, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{line}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
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
                  <DeliverableCard key={`i-${i}-${c.deliverable.id}`} item={c} machineName={work.machineName} timestampMs={workTimestampMs} theme={theme} layout="row" />
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
