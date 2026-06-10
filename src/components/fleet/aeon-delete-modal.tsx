// src/components/fleet/aeon-delete-modal.tsx
// Slide-to-unlock confirmation for deleting AEON agents. Owned by FleetView so
// every surface (roster, graph tooltip, list view) gets the same guarded flow.
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { FleetAgent, FleetMachine } from "./fleet-data";
import styles from "./fleet-tokens.module.css";

export type AeonDeleteDepth = "local" | "github" | "both";
export type AeonDeleteStep = "local" | "github";
export type AeonDeleteStepStatus = "idle" | "working" | "done" | "failed";
export type AeonDeleteProgress = {
  step: AeonDeleteStep;
  status: AeonDeleteStepStatus;
  message?: string;
};
export type AeonDeleteResult = {
  ok: boolean;
  error?: string;
};

export function isAeonAgent(agent: Pick<FleetAgent, "runtime">) {
  return agent.runtime.trim().toLowerCase() === "aeon";
}

function AeonDeleteStatusPanel({
  depth,
  phase,
  message,
  steps,
  onClose,
  onRetry,
}: {
  depth: AeonDeleteDepth | null;
  phase: "deleting" | "done" | "error";
  message: string;
  steps: Record<AeonDeleteStep, AeonDeleteStepStatus>;
  onClose: () => void;
  onRetry: () => void;
}) {
  const visibleSteps: Array<{ key: AeonDeleteStep; label: string }> = depth === "both"
    ? [
        { key: "local", label: "Local repo" },
        { key: "github", label: "GitHub repo" },
      ]
    : depth === "github"
      ? [{ key: "github", label: "GitHub repo" }]
      : [{ key: "local", label: "Local repo" }];
  const statusLabel: Record<AeonDeleteStepStatus, string> = {
    idle: "Waiting",
    working: "Deleting",
    done: "Deleted",
    failed: "Failed",
  };
  const statusColor: Record<AeonDeleteStepStatus, string> = {
    idle: "var(--muted)",
    working: "#fecdd3",
    done: "var(--accent-strong)",
    failed: "var(--danger)",
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        marginTop: 16,
        border: `1px solid ${phase === "error" ? "rgba(251,113,133,0.42)" : "rgba(148,163,184,0.2)"}`,
        borderRadius: 8,
        background: "rgba(2,6,23,0.58)",
        padding: 12,
      }}
    >
      <div className={styles.monoCap} style={{ color: phase === "done" ? "var(--accent-strong)" : phase === "error" ? "var(--danger)" : "#fecdd3" }}>
        {phase === "done" ? "Deletion confirmed" : phase === "error" ? "Deletion needs attention" : "Deleting AEON agent"}
      </div>
      <div className="grid" style={{ gap: 8 }}>
        {visibleSteps.map((step) => {
          const status = steps[step.key];
          return (
            <div
              key={step.key}
              style={{
                display: "grid",
                gridTemplateColumns: "32px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 10,
                minHeight: 44,
                border: "1px solid rgba(148,163,184,0.16)",
                borderRadius: 8,
                background: "rgba(15,23,42,0.72)",
                padding: "8px 10px",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "grid",
                  width: 28,
                  height: 28,
                  placeItems: "center",
                  borderRadius: "50%",
                  border: `1px solid ${status === "working" ? "rgba(251,113,133,0.5)" : "rgba(148,163,184,0.24)"}`,
                  color: statusColor[status],
                }}
              >
                {status === "working" ? <LoaderCircle size={14} className="animate-spin" /> : status === "failed" ? <AlertTriangle size={14} /> : status === "done" ? "✓" : "•"}
              </span>
              <strong style={{ color: "var(--foreground)", fontSize: 13 }}>{step.label}</strong>
              <span className={styles.monoCap} style={{ color: statusColor[status], fontSize: 9 }}>
                {statusLabel[status]}
              </span>
            </div>
          );
        })}
      </div>
      {message ? (
        <div
          style={{
            border: `1px solid ${phase === "error" ? "rgba(251,113,133,0.34)" : "rgba(94,234,212,0.24)"}`,
            borderRadius: 7,
            background: phase === "error" ? "rgba(127,29,29,0.16)" : "rgba(20,83,74,0.16)",
            color: phase === "error" ? "#fecdd3" : "var(--accent-strong)",
            fontSize: 12,
            lineHeight: 1.45,
            padding: 10,
          }}
        >
          {message}
        </div>
      ) : null}
      {phase !== "deleting" ? (
        <div className="flex flex-wrap" style={{ justifyContent: "flex-end", gap: 8 }}>
          {phase === "error" ? (
            <button
              type="button"
              onClick={onRetry}
              style={{
                minHeight: 34,
                border: "1px solid rgba(251,113,133,0.36)",
                borderRadius: 7,
                background: "rgba(251,113,133,0.12)",
                color: "#fecdd3",
                fontFamily: "var(--f-mono)",
                fontSize: 10,
                fontWeight: 900,
                padding: "8px 11px",
              }}
            >
              Try again
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: 34,
              border: "1px solid rgba(148,163,184,0.22)",
              borderRadius: 7,
              background: "rgba(15,23,42,0.78)",
              color: "var(--foreground)",
              fontFamily: "var(--f-mono)",
              fontSize: 10,
              fontWeight: 900,
              padding: "8px 11px",
            }}
          >
            {phase === "done" ? "Done" : "Close"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AeonDeleteModal({
  machine,
  agent,
  onClose,
  onRemove,
}: {
  machine: FleetMachine;
  agent: FleetAgent;
  onClose: () => void;
  onRemove: (
    m: FleetMachine,
    a: FleetAgent,
    depth?: AeonDeleteDepth,
    onProgress?: (progress: AeonDeleteProgress) => void,
  ) => void | Promise<AeonDeleteResult | void>;
}) {
  const [deleteDepth, setDeleteDepth] = React.useState<AeonDeleteDepth | null>(null);
  const [deletePhase, setDeletePhase] = React.useState<"choice" | "deleting" | "done" | "error">("choice");
  const [deleteSteps, setDeleteSteps] = React.useState<Record<AeonDeleteStep, AeonDeleteStepStatus>>({ local: "idle", github: "idle" });
  const [deleteMessage, setDeleteMessage] = React.useState("");
  const [unlockValue, setUnlockValue] = React.useState(0);
  const unlockTrackRef = React.useRef<HTMLDivElement | null>(null);
  const portalTarget = typeof document === "undefined" ? null : document.body;

  const unlockDelete = React.useCallback(async (value: number) => {
    setUnlockValue(value);
    if (!deleteDepth || value < 96) return;
    const steps: AeonDeleteStep[] = deleteDepth === "both" ? ["local", "github"] : [deleteDepth];
    setDeletePhase("deleting");
    setDeleteMessage("");
    setDeleteSteps({ local: "idle", github: "idle" });
    const result = await onRemove(machine, agent, deleteDepth, (progress) => {
      setDeleteSteps((current) => ({ ...current, [progress.step]: progress.status }));
      if (progress.message) setDeleteMessage(progress.message);
    });
    if (result?.ok === false) {
      setDeletePhase("error");
      setDeleteMessage(result.error || "Could not delete this AEON agent.");
      setUnlockValue(0);
      return;
    }
    setDeleteSteps({
      local: steps.includes("local") ? "done" : "idle",
      github: steps.includes("github") ? "done" : "idle",
    });
    setDeletePhase("done");
    setDeleteMessage("Deletion complete.");
  }, [agent, deleteDepth, machine, onRemove]);

  const unlockValueFromClientX = React.useCallback((clientX: number) => {
    const rect = unlockTrackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const thumbSize = 52;
    const travel = Math.max(1, rect.width - thumbSize - 8);
    const next = ((clientX - rect.left - thumbSize / 2) / travel) * 100;
    return Math.max(0, Math.min(100, next));
  }, []);
  const updateUnlockDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!deleteDepth) return;
    setUnlockValue(unlockValueFromClientX(event.clientX));
  }, [deleteDepth, unlockValueFromClientX]);
  const finishUnlockDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!deleteDepth) return;
    const next = unlockValueFromClientX(event.clientX);
    if (next >= 96) {
      void unlockDelete(100);
      return;
    }
    setUnlockValue(0);
  }, [deleteDepth, unlockDelete, unlockValueFromClientX]);

  if (!portalTarget) return null;

  return createPortal((
    <div
      role="presentation"
      onClick={() => {
        if (deletePhase !== "deleting") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(2,6,23,0.76)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="aeon-delete-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(520px, 100%)",
          borderRadius: 8,
          border: "1px solid rgba(251,113,133,0.36)",
          background: "rgba(15,23,42,0.98)",
          boxShadow: "0 28px 90px rgba(0,0,0,0.5)",
          color: "var(--foreground)",
          padding: 18,
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={styles.monoCap} style={{ color: "var(--danger)", marginBottom: 8 }}>
              Aeon delete
            </div>
            <h3 id="aeon-delete-title" style={{ fontFamily: "var(--f-display)", fontSize: 21, lineHeight: 1.18, margin: 0 }}>
              How deeply would you like to delete {agent.name}?
            </h3>
          </div>
          <CloseIconButton
            type="button"
            aria-label="Cancel delete"
            onClick={onClose}
            disabled={deletePhase === "deleting"}
            className="grid place-items-center"
            style={{
              border: "1px solid rgba(148,163,184,0.22)",
              background: "rgba(15,23,42,0.78)",
              color: "var(--muted)",
              cursor: "pointer",
            }}
          />
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 16 }}>
          {[
            { depth: "local" as const, label: "Local Repo" },
            { depth: "github" as const, label: "GitHub Repo" },
            { depth: "both" as const, label: "Local + Github" },
          ].map((option) => (
            <button
              key={option.depth}
              type="button"
              aria-pressed={deleteDepth === option.depth}
              disabled={deletePhase !== "choice"}
              onClick={() => {
                setDeleteDepth(option.depth);
                setUnlockValue(0);
              }}
              style={{
                minHeight: 44,
                borderRadius: 7,
                border: deleteDepth === option.depth
                  ? "1px solid rgba(251,113,133,0.72)"
                  : "1px solid rgba(148,163,184,0.22)",
                background: deleteDepth === option.depth ? "rgba(251,113,133,0.18)" : "rgba(15,23,42,0.7)",
                color: deleteDepth === option.depth ? "#fecdd3" : "var(--foreground)",
                cursor: deletePhase === "choice" ? "pointer" : "default",
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 0,
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        {deletePhase === "choice" ? (
          <div
            style={{
              marginTop: 16,
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 8,
              background: "rgba(2,6,23,0.58)",
              padding: 12,
              opacity: deleteDepth ? 1 : 0.58,
            }}
          >
            <div className={styles.monoCap} style={{ color: deleteDepth ? "#fecdd3" : "var(--muted)", marginBottom: 10 }}>
              Slide to unlock delete
            </div>
            <div
              ref={unlockTrackRef}
              role="slider"
              aria-label={`Slide to unlock deletion for ${agent.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(unlockValue)}
              aria-disabled={!deleteDepth}
              tabIndex={deleteDepth ? 0 : -1}
              onPointerDown={(event) => {
                if (!deleteDepth) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                updateUnlockDrag(event);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                updateUnlockDrag(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                finishUnlockDrag(event);
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                setUnlockValue(0);
              }}
              style={{
                position: "relative",
                display: "grid",
                alignItems: "center",
                height: 58,
                overflow: "hidden",
                borderRadius: 999,
                border: "1px solid rgba(251,113,133,0.32)",
                background: "linear-gradient(180deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98))",
                boxShadow: "inset 0 2px 12px rgba(0,0,0,0.48)",
                cursor: deleteDepth ? "grab" : "not-allowed",
                touchAction: "none",
                userSelect: "none",
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 4,
                  width: `calc(${unlockValue}% + 52px)`,
                  maxWidth: "calc(100% - 8px)",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, rgba(251,113,133,0.28), rgba(251,113,133,0.08))",
                  transition: unlockValue === 0 ? "width 180ms ease" : "none",
                }}
              />
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  color: deleteDepth ? "#fecdd3" : "var(--muted)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 12,
                  fontWeight: 900,
                  letterSpacing: 0,
                  opacity: Math.max(0.22, 1 - unlockValue / 82),
                  transition: unlockValue === 0 ? "opacity 180ms ease" : "none",
                  whiteSpace: "nowrap",
                }}
              >
                slide to delete
              </div>
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 4,
                  display: "grid",
                  width: 50,
                  height: 50,
                  placeItems: "center",
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.28)",
                  background: deleteDepth
                    ? "linear-gradient(180deg, #fff7f7, #fecdd3)"
                    : "linear-gradient(180deg, rgba(226,232,240,0.56), rgba(148,163,184,0.32))",
                  color: "#7f1d1d",
                  boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
                  left: `calc(4px + ${unlockValue}% - ${unlockValue * 0.58}px)`,
                  transition: unlockValue === 0 ? "left 180ms ease" : "none",
                }}
              >
                <Trash2 size={17} />
              </div>
            </div>
          </div>
        ) : (
          <AeonDeleteStatusPanel
            depth={deleteDepth}
            phase={deletePhase}
            message={deleteMessage}
            steps={deleteSteps}
            onClose={onClose}
            onRetry={() => {
              setDeletePhase("choice");
              setDeleteSteps({ local: "idle", github: "idle" });
              setDeleteMessage("");
              setUnlockValue(0);
            }}
          />
        )}
      </div>
    </div>
  ), portalTarget);
}
