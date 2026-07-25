"use client";

/* Right-hand shelf for the redesigned chat route: Details / Files / Preview.
 *
 * Honesty rules baked in:
 *  - Tokens render only when `/api/chat/thread-usage` reports tokensAvailable.
 *    A thread whose runtime never wrote a usage row shows "not recorded",
 *    never a fabricated 0.
 *  - Files are the real generated artifacts on this thread's messages.
 *  - Preview lists real hosted apps on the chat's machine; with none, it says so.
 */

import { useEffect, useState } from "react";

import type { ChatThreadUsage } from "@/lib/services/chat/thread-usage";
import type { ChatPreviewTarget } from "@/lib/services/chat/chat-preview-targets";
import { ICON_PATHS, Ico } from "./composer-primitives";

export type ShelfMode = "details" | "files" | "preview";

export type ShelfDeliverable = {
  id: string;
  kind: "image" | "video" | "audio" | "model3d" | "file";
  name: string;
  meta: string;
  url?: string;
};

const sectionLabel: React.CSSProperties = {
  fontFamily: "var(--f-body)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: "var(--fg-3)",
};

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
      <span style={{ fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--fg-3)" }}>{label}</span>
      <span style={{ fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500, color: tone ?? "var(--fg)", textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

export type ContextShelfProps = {
  mode: ShelfMode;
  onModeChange: (mode: ShelfMode) => void;

  taskTitle: string;
  statusLabel: string;
  statusColor: string;
  agentLine: string;
  machineLabel: string;
  runtimes: string[];
  providers: string[];
  models: string[];
  elapsedLabel: string;
  workingDirectory: string;

  usage: ChatThreadUsage | null;
  usageLoading: boolean;
  messageCount: number;

  liveOutput: string;
  live: boolean;

  deliverables: ShelfDeliverable[];
  onOpenDeliverable?: (deliverable: ShelfDeliverable) => void;

  previewTargets: ChatPreviewTarget[];
  previewBusy?: boolean;
  previewError?: string;
  onExpandPreview: () => void;
};

export function ContextShelf(props: ContextShelfProps) {
  const {
    mode, onModeChange, taskTitle, statusLabel, statusColor, agentLine, machineLabel,
    runtimes, providers, models, elapsedLabel, workingDirectory,
    usage, usageLoading, messageCount, liveOutput, live,
    deliverables, onOpenDeliverable, previewTargets, previewBusy = false, previewError = "", onExpandPreview,
  } = props;

  if (mode === "preview") {
    return (
      <div style={{ display: "grid", gap: 13 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="cx-iconbtn" onClick={() => onModeChange("details")} title="Back to details" aria-label="Back to details" style={backBtn}>
            <Ico d={ICON_PATHS.chevronLeft} size={16} sw={1.9} />
          </button>
          <span style={{ flex: 1, ...sectionLabel }}>Preview</span>
          {previewTargets.length ? (
            <button type="button" className="cx-iconbtn" onClick={onExpandPreview} title="Expand to full view" aria-label="Expand to full view" style={backBtn}>
              <Ico d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" size={15} sw={1.9} />
            </button>
          ) : null}
        </div>
        {previewBusy ? (
          <div role="status" aria-label="Preparing conversation preview" className="cx-genskel" style={{ width: "100%", aspectRatio: "9 / 16", border: "1px solid var(--line-2)", borderRadius: 22 }} />
        ) : previewError ? (
          <EmptyState title="Preview could not start" body={previewError} />
        ) : previewTargets.length ? (
          <PreviewFrame target={previewTargets[0]} />
        ) : (
          <EmptyState
            title="No preview available"
            body={`This conversation does not have a runnable app on ${machineLabel || "this machine"} yet.`}
          />
        )}
      </div>
    );
  }

  if (mode === "files") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" className="cx-iconbtn" onClick={() => onModeChange("details")} title="Back to details" aria-label="Back to details" style={backBtn}>
            <Ico d={ICON_PATHS.chevronLeft} size={16} sw={1.9} />
          </button>
          <span style={{ flex: 1, ...sectionLabel }}>Files · this conversation</span>
        </div>
        {deliverables.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
            {deliverables.map((deliverable) => {
              const isMedia = deliverable.kind === "image" || deliverable.kind === "video";
              return (
                <button
                  key={deliverable.id}
                  type="button"
                  className="cx-file"
                  title={deliverable.name}
                  onClick={() => onOpenDeliverable?.(deliverable)}
                  style={{ display: "grid", gap: 8, border: 0, background: "transparent", padding: 0, cursor: onOpenDeliverable ? "pointer" : "default", textAlign: "left" }}
                >
                  <div style={{ position: "relative", aspectRatio: "1 / 1", border: "1px solid var(--line-2)", borderRadius: 12, background: "var(--bg-soft)", overflow: "hidden", display: "grid", placeItems: "center" }}>
                    {deliverable.kind === "image" && deliverable.url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- generated media is served from a signed local route, not the image optimizer
                      <img src={deliverable.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <Ico d={isMedia ? "M8 5v14l11-7z" : ICON_PATHS.file} size={30} sw={1.5} stroke="var(--fg-4)" />
                    )}
                    <span style={{ position: "absolute", left: 7, bottom: 7, fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg-3)", background: "var(--panel-hi)", borderRadius: 5, padding: "2px 5px" }}>{deliverable.kind}</span>
                  </div>
                  <div style={{ display: "grid", gap: 1, padding: "0 1px" }}>
                    <span style={{ fontFamily: "var(--f-body)", fontSize: 11.5, fontWeight: 500, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{deliverable.name}</span>
                    <span style={{ fontFamily: "var(--f-body)", fontSize: 10.5, color: "var(--fg-4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{deliverable.meta}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No files yet" body="Images, video, and other artifacts this agent generates in this conversation will collect here." />
        )}
      </div>
    );
  }

  return (
    <>
      <section style={{ display: "grid", gap: 12 }}>
        <span style={sectionLabel}>Current task</span>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontFamily: "var(--f-body)", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.25, overflowWrap: "anywhere" }}>{taskTitle}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--fg-3)" }}>
            <span className={live ? "cx-dot-live" : undefined} style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor", color: statusColor }} />
            <span style={{ color: statusColor }}>{statusLabel}</span>
            <span style={{ color: "var(--fg-4)" }}>·</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentLine}</span>
          </div>
        </div>
        <div style={{ display: "grid" }}>
          <Row label="Runtime" value={runtimes.length ? runtimes.join(", ") : "—"} />
          <Row label="Machine" value={machineLabel || "—"} tone="var(--live)" />
          <Row label="Directory" value={workingDirectory || "—"} />
          <Row label="Elapsed" value={elapsedLabel} />
        </div>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <span style={sectionLabel}>Run telemetry</span>
        <div style={{ display: "grid" }}>
          <Row label="Provider" value={providers.length ? providers.join(", ") : "—"} />
          <Row label="Model" value={models.length ? models.join(", ") : "—"} />
          <Row label="Messages" value={String(messageCount)} />
          {usageLoading ? (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--fg-3)" }}>Tokens</span>
              <span className="fr-skel" role="status" aria-label="Loading token usage" style={{ width: 64, height: 10, borderRadius: 5 }} />
            </div>
          ) : usage?.tokensAvailable ? (
            <Row label="Tokens" value={usage.tokens.total.toLocaleString("en-US")} tone="var(--honey)" />
          ) : (
            <Row label="Tokens" value={<span title="This runtime did not record token usage for this thread." style={{ color: "var(--fg-4)" }}>not recorded</span>} />
          )}
          {usage && usage.costUsd > 0 ? <Row label="Spend" value={`$${usage.costUsd.toFixed(4)}`} /> : null}
        </div>
      </section>

      {liveOutput ? (
        <section style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={sectionLabel}>Live output</span>
            {live ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-body)", fontSize: 11, color: "var(--live)" }}>
                <span className="cx-dot-live" style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }} />
                streaming
              </span>
            ) : null}
          </div>
          <pre className="cx-scroll" style={{ maxHeight: 150, overflow: "auto", border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg-soft)", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, lineHeight: 1.7, margin: 0, padding: "12px 14px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{liveOutput}</pre>
        </section>
      ) : null}
    </>
  );
}

const backBtn: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: 28,
  height: 28,
  border: 0,
  borderRadius: 8,
  background: "transparent",
  color: "var(--fg-3)",
  cursor: "pointer",
};

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 8, border: "1px dashed var(--line-2)", borderRadius: 12, padding: "28px 18px", textAlign: "center" }}>
      <strong style={{ fontFamily: "var(--f-body)", fontSize: 13.5, fontWeight: 600, color: "var(--fg-2)" }}>{title}</strong>
      <p style={{ margin: 0, fontFamily: "var(--f-body)", fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-4)" }}>{body}</p>
    </div>
  );
}

/** Probes the target through the SSRF-gated route before embedding it. */
export function PreviewFrame({
  target,
  tall,
  refreshKey = 0,
  workspace = false,
}: {
  target: ChatPreviewTarget;
  tall?: boolean;
  refreshKey?: number;
  workspace?: boolean;
}) {
  const targetKey = [target.url, target.machine, target.projectId, target.directory].join("\u001f");
  const probeKey = `${targetKey}\u001f${refreshKey}`;
  const [result, setResult] = useState<{ key: string; state: "live" | "dead"; reason: string } | null>(null);
  const state = result?.key === probeKey ? result.state : "probing";
  const reason = result?.key === probeKey ? result.reason : "";

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ url: target.url, machine: target.machine });
    if (target.projectId) query.set("projectId", target.projectId);
    if (target.directory) query.set("directory", target.directory);
    if (target.machineKey) query.set("machineKey", target.machineKey);
    if (target.collectorUrl) query.set("collectorUrl", target.collectorUrl);
    fetch(`/api/chat/preview?${query}`)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        const live = Boolean(payload?.live ?? payload?.data?.live);
        setResult({ key: probeKey, state: live ? "live" : "dead", reason: String(payload?.reason ?? payload?.data?.reason ?? "") });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({ key: probeKey, state: "dead", reason: error instanceof Error ? error.message : "probe failed" });
      });
    return () => { cancelled = true; };
  }, [probeKey, target.collectorUrl, target.directory, target.machine, target.machineKey, target.projectId, target.url]);

  const frameStyle: React.CSSProperties = {
    width: "100%",
    aspectRatio: workspace || tall ? undefined : "9 / 16",
    height: workspace ? "100%" : tall ? "min(78vh, 720px)" : undefined,
    border: workspace ? 0 : "1px solid var(--line-2)",
    borderRadius: workspace ? 0 : tall ? 30 : 22,
    overflow: "hidden",
    background: "var(--bg-soft)",
    display: "block",
  };

  if (state === "probing") {
    return (
      <div role="status" aria-label="Checking preview" className="cx-genskel" style={frameStyle} />
    );
  }
  if (state === "dead") {
    return (
      <div style={{ ...frameStyle, display: "grid", placeItems: "center", padding: 20 }}>
        <EmptyState title={`${target.name} is not reachable`} body={reason || "The hosted app did not respond."} />
      </div>
    );
  }
  return (
    <iframe
      title={`${target.name} preview`}
      src={target.url}
      key={probeKey}
      style={frameStyle}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
    />
  );
}
