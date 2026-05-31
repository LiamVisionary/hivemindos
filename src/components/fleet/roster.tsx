// src/components/fleet/roster.tsx
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronDown, ChevronRight, Copy, LoaderCircle, MessageSquare, Monitor, Pencil, PhoneCall, PlugZap, Plus, Settings2, Smartphone, Trash2, Wallet } from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BeeIcon } from "./bee-icon";
import { HexTile } from "./hex-tile";
import { fleetAgentCanChat, isFleetMachineMobile, type AgentState, type FleetAgent, type FleetAgentChat, type FleetMachine } from "./fleet-data";
import styles from "./fleet-tokens.module.css";

const STATE_COLOR: Record<AgentState, string> = {
  working:   "var(--accent-strong)",
  ready:     "var(--muted)",
  scheduled: "#fde68a",
  setup:     "#fde68a",
  failed:    "var(--danger)",
};

export type MachineUpdateButtonStatus = "idle" | "updating" | "updated" | "failed";
export type MachineUpdateButtonDetail = {
  label?: string;
  detail?: string;
};
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

interface RosterRowProps {
  machine: FleetMachine;
  selected: boolean;
  expanded: boolean;
  selectedAgentId: string | null;
  updateStatus?: MachineUpdateButtonStatus;
  updateDetail?: MachineUpdateButtonDetail;
  onSelectMachine: () => void;
  onSelectAgent: (a: FleetAgent) => void;
  onToggle: () => void;
  onAddAgent: () => void;
  onUpdateMachine?: () => void;
  onRenameMachine?: (name: string) => void;
  onOpenNetworkIssue?: () => void;
  onOpenChat?: (a: FleetAgent) => void;
  onOpenTaskChat?: (a: FleetAgent, chat?: FleetAgentChat) => void;
  onCallAgent?: (a: FleetAgent) => void;
  onOpenWallet?: (a: FleetAgent) => void;
  onEditSettings?: (a: FleetAgent) => void;
  onDuplicate?: (a: FleetAgent) => void;
  onRemove?: (a: FleetAgent) => void;
}

function RosterRow({
  machine, selected, expanded, selectedAgentId,
  updateStatus,
  updateDetail,
  onSelectMachine, onSelectAgent, onToggle, onAddAgent,
  onUpdateMachine,
  onRenameMachine,
  onOpenNetworkIssue,
  onOpenChat, onOpenTaskChat, onCallAgent, onOpenWallet, onEditSettings, onDuplicate, onRemove,
}: RosterRowProps) {
  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(() => new Set());
  const [successDismissed, setSuccessDismissed] = React.useState(false);
  const [editingName, setEditingName] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState(machine.name);
  const roleIconDim = (state: AgentState) => state === "ready" || state === "setup" || state === "failed";
  const fire = (agent: FleetAgent, fn?: (a: FleetAgent) => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    fn?.(agent);
  };
  const fireTaskChat = (agent: FleetAgent, chat: FleetAgentChat, fn?: (a: FleetAgent, chat?: FleetAgentChat) => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    fn?.(agent, chat);
  };
  const toggleTaskPreview = (previewId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(previewId)) {
        next.delete(previewId);
      } else {
        next.add(previewId);
      }
      return next;
    });
  };

  React.useEffect(() => {
    if (updateStatus !== "updated") return;
    const timeout = window.setTimeout(() => setSuccessDismissed(true), 3000);
    return () => window.clearTimeout(timeout);
  }, [updateStatus]);

  React.useEffect(() => {
    if (editingName) return;
    const timeout = window.setTimeout(() => setNameDraft(machine.name), 0);
    return () => window.clearTimeout(timeout);
  }, [editingName, machine.name]);

  const commitName = () => {
    setEditingName(false);
    onRenameMachine?.(nameDraft);
  };

  const showUpdateButton = Boolean(
    onUpdateMachine
      && (
	        updateStatus === "updating"
	        || (updateStatus === "updated" && !successDismissed)
	        || updateStatus === "failed"
	        || (machine.versionState === "stale" && updateStatus !== "updated")
	        || machine.canUpdate === true
	      ),
	  );
  const updateDisabled = updateStatus === "updating" || updateStatus === "updated";
  const MachineIcon = isFleetMachineMobile(machine) ? Smartphone : Monitor;

  return (
    <div
      className="rounded-lg overflow-hidden relative"
      style={{
        border: `1px solid ${selected ? "rgba(255,212,90,0.42)" : "rgba(148,163,184,0.16)"}`,
        background: selected ? "rgba(255,212,90,0.10)" : "transparent",
      }}
    >
      <div
        onClick={onSelectMachine}
        className={`${styles.rosterMachineRow} cursor-pointer`}
        style={{
          color: selected ? "var(--hex-honey-border)" : "var(--foreground)",
        }}
      >
        <HexTile size={22} tone={selected ? "honey" : "default"}>
          <MachineIcon
            aria-hidden="true"
            size={13}
            style={{
              color: selected ? "var(--hex-honey-border)" : "var(--muted)",
            }}
          />
        </HexTile>
        <div className={styles.rosterMachineBody}>
          <div className={styles.rosterMachineSummary}>
            <div className={styles.rosterMachineIdentity}>
              <div className={`${styles.rosterMachineName} flex items-center gap-1.5`}>
                {editingName ? (
                  <input
                    value={nameDraft}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={commitName}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitName();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setNameDraft(machine.name);
                        setEditingName(false);
                      }
                    }}
                    aria-label={`Rename ${machine.name}`}
                    style={{
                      width: "100%",
                      minWidth: 0,
                      border: "1px solid rgba(94,234,212,0.46)",
                      borderRadius: 6,
                      background: "rgba(2,6,23,0.72)",
                      color: "var(--foreground)",
                      font: "inherit",
                      letterSpacing: 0,
                      padding: "2px 5px",
                      outline: "none",
                    }}
                  />
                ) : (
                  <>
                    <span>{machine.name}</span>
                    {onRenameMachine ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Rename ${machine.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setNameDraft(machine.name);
                              setEditingName(true);
                            }}
                            style={{
                              width: 20,
                              height: 20,
                              display: "inline-grid",
                              placeItems: "center",
                              border: 0,
                              borderRadius: 6,
                              background: "transparent",
                              color: "var(--muted)",
                              cursor: "pointer",
                              flex: "0 0 auto",
                            }}
                          >
                            <Pencil size={11} aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Rename machine</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </>
                )}
              </div>
              <div className={styles.rosterMachineMeta}>
                {machine.kind} · {machine.city}
              </div>
            </div>
            <div className={styles.rosterMachineStatus}>
              {showUpdateButton ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!updateDisabled) {
                      setSuccessDismissed(false);
                      onUpdateMachine?.();
                    }
                  }}
                  disabled={updateDisabled}
                  aria-label={
                    updateStatus === "updating"
                      ? `Updating ${machine.name}`
                      : updateStatus === "updated"
                        ? `${machine.name} updated`
                        : updateStatus === "failed"
                          ? `${updateDetail?.label ?? `Update failed for ${machine.name}`}. Retry update`
                          : `Update ${machine.name}`
                  }
                  title={updateDetail?.detail}
                  aria-live="polite"
                  className={`${styles.rosterUpdateButton} inline-flex items-center justify-center`}
                  style={{
                    minWidth: updateStatus === "updated" ? 70 : 62,
                    minHeight: 24,
                    padding: "4px 8px",
                    borderRadius: 7,
                    border: updateStatus === "failed"
                      ? "1px solid rgba(251,113,133,0.46)"
                      : updateStatus === "updated"
                        ? "1px solid rgba(94,234,212,0.54)"
                        : "1px solid rgba(255,212,90,0.46)",
                    background: updateStatus === "failed"
                      ? "rgba(251,113,133,0.14)"
                      : updateStatus === "updated"
                        ? "rgba(45,212,191,0.16)"
                        : "rgba(255,212,90,0.14)",
                    color: updateStatus === "failed"
                      ? "#fecdd3"
                      : updateStatus === "updated"
                        ? "var(--accent-strong)"
                        : "var(--hex-honey-border)",
                    fontFamily: "var(--f-mono)",
                    fontSize: 9.5,
                    fontWeight: 800,
                    letterSpacing: 0,
                    cursor: updateDisabled ? "default" : "pointer",
                  }}
                >
                  {updateStatus === "updating" ? (
                    <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
                  ) : updateStatus === "updated" ? (
                    "Updated!"
                  ) : updateStatus === "failed" ? (
                    "Failed"
                  ) : (
                    "Update"
                  )}
                </button>
                  </TooltipTrigger>
                  {updateDetail?.detail ? (
                    <TooltipContent side="top" style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                      {updateDetail.detail}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              ) : (
                <span
                  className={styles.rosterMachineCount}
                  style={{
                    color: selected ? "var(--hex-honey-border)" : "var(--accent-strong)",
                  }}
                >
                  {machine.agents.length}
                </span>
              )}
            </div>
          </div>
          {machine.networkIssue ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenNetworkIssue?.();
              }}
              className={styles.rosterNetworkIssue}
              style={{
                border: "1px solid rgba(251,191,36,0.42)",
                background: "rgba(251,191,36,0.12)",
                color: "#fde68a",
                cursor: "pointer",
              }}
            >
              <AlertTriangle size={10} aria-hidden="true" />
              <span>{machine.networkIssue.label}</span>
            </button>
          ) : null}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={expanded ? "Collapse" : "Expand"}
          className={`${styles.rosterMachineToggle} grid place-items-center`}
          style={{
            border: 0, background: "transparent",
            color: "var(--muted)", cursor: "pointer",
            transform: expanded ? "rotate(90deg)" : "rotate(0)",
            transition: "transform 160ms ease",
          }}
        >
          <ChevronRight size={12} />
        </button>
      </div>

      {expanded && machine.agents.length > 0 && (
        <div className="grid gap-1" style={{ padding: "0 10px 10px" }}>
          {machine.agents.map((a) => {
            const isSelA = selectedAgentId === a.id;
            const canChat = fleetAgentCanChat(a);
            return (
              <div
                key={a.id}
                style={{
                  border: `1px solid ${isSelA ? "rgba(255,212,90,0.55)" : "transparent"}`,
                  borderRadius: 8,
                  background: isSelA ? "rgba(255,212,90,0.14)" : "rgba(16,20,29,0.5)",
                  color: isSelA ? "var(--hex-honey-border)" : "var(--foreground)",
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onSelectAgent(a); }}
                  className="grid items-center text-left cursor-pointer"
                  style={{
                    width: "100%",
                    gridTemplateColumns: "26px minmax(0, 1fr) auto", gap: 10,
                    padding: "8px 10px",
                    border: 0,
                    background: "transparent",
                    color: "inherit",
                  }}
                >
                  <HexTile size={28} tone={isSelA ? "honey" : a.state === "working" ? "active" : "ghost"}>
                    <BeeIcon
                      role={a.beeRole === "queen" ? "queen" : "worker"}
                      workerClass={a.workerClass}
                      size={22}
                      dim={roleIconDim(a.state)}
                    />
                  </HexTile>
                  <div className="min-w-0">
                    <div className="font-semibold"
                      style={{ fontFamily: "var(--f-display)", fontSize: 11.5 }}>
                      {a.name}
                    </div>
                    <div
                      style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)" }}>
                      {a.runtime} · {a.role}
                    </div>
                  </div>
                  <span className={styles.monoCap}
                    style={{ color: STATE_COLOR[a.state], fontSize: 9 }}>
                    {a.state}
                  </span>
                </button>

                {isSelA && (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: "0 10px 10px 46px",
                    }}
                  >
                    {(a.recentChats?.length
                      ? a.recentChats
                      : [{ id: a.currentTaskId ?? "current", title: a.task, task: a.task, since: a.since }]
                    ).slice(0, 3).map((chat) => {
                      const previewId = `${a.id}:${chat.id}`;
                      const isTaskExpanded = expandedTaskIds.has(previewId);
                      const canResumeChat = canChat && chat.id !== "current";
                      return (
                        <div
                          key={previewId}
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleTaskPreview(previewId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.stopPropagation();
                            toggleTaskPreview(previewId);
                          }}
                          className={`${styles.rosterTaskPreview} ${isTaskExpanded ? styles.rosterTaskPreviewExpanded : ""}`}
                          aria-expanded={isTaskExpanded}
                          aria-label={`${isTaskExpanded ? "Collapse" : "Expand"} recent chat for ${a.name}`}
                        >
                          <span
                            className={`${styles.rosterTaskPreviewText} ${isTaskExpanded ? "" : styles.rosterTaskPreviewTextCollapsed}`}
                          >
                            {chat.title}
                          </span>
                          {canResumeChat ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={fireTaskChat(a, chat, onOpenTaskChat)}
                                  aria-label={`Resume chat with ${a.name}`}
                                  className="inline-grid place-items-center"
                                  style={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: 7,
                                    border: "1px solid rgba(94,234,212,0.32)",
                                    background: "rgba(45,212,191,0.10)",
                                    color: "var(--accent-strong)",
                                    cursor: "pointer",
                                    flex: "0 0 auto",
                                  }}
                                >
                                  <MessageSquare size={12} aria-hidden="true" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Resume chat</TooltipContent>
                            </Tooltip>
                          ) : null}
                          <span
                            aria-hidden="true"
                            style={{
                              color: "var(--muted)",
                              fontFamily: "var(--f-mono)",
                              fontSize: 9,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {chat.since}
                          </span>
                          <ChevronDown size={13} aria-hidden="true" />
                        </div>
                      );
                    })}
                    <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                      {canChat && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={fire(a, onOpenChat)}
                              className="inline-flex items-center uppercase font-bold"
                              style={{
                                gap: 6, padding: "7px 9px", borderRadius: 7, cursor: "pointer",
                                fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: 0.04,
                                border: "1px solid rgba(94,234,212,0.48)",
                                background: "rgba(45,212,191,0.16)",
                                color: "var(--accent-strong)",
                              }}
                            >
                              <MessageSquare size={12} /> New Chat
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Start a fresh chat with {a.name}</TooltipContent>
                        </Tooltip>
                      )}

                      {[
                        { id: "call", label: "Call", Icon: PhoneCall, onClick: fire(a, onCallAgent) },
                        { id: "wallet", label: "Wallet & limits", Icon: Wallet, onClick: fire(a, onOpenWallet) },
                        { id: "edit", label: "Edit settings", Icon: Settings2, onClick: fire(a, onEditSettings) },
                        { id: "dup", label: "Duplicate", Icon: Copy, onClick: fire(a, onDuplicate) },
                        { id: "remove", label: "Remove agent", Icon: Trash2, onClick: fire(a, onRemove), danger: true },
                      ].map(({ id, label, Icon, onClick, danger }) => (
                        <Tooltip key={id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={onClick}
                              aria-label={label}
                              className="inline-grid place-items-center cursor-pointer"
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 7,
                                border: danger
                                  ? "1px solid rgba(251,113,133,0.30)"
                                  : "1px solid rgba(148,163,184,0.22)",
                                background: "rgba(15,23,42,0.62)",
                                color: danger ? "#fecdd3" : "var(--foreground)",
                              }}
                            >
                              <Icon size={12} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{label}</TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onAddAgent(); }}
            className={`${styles.rosterAddAgentRow} grid items-center text-left cursor-pointer`}
            style={{
              gridTemplateColumns: "26px minmax(0, 1fr)",
              gap: 10,
              padding: "8px 10px",
              border: "1px dashed rgba(94,234,212,0.38)",
              borderRadius: 8,
              background: "rgba(45,212,191,0.06)",
              color: "var(--accent-strong)",
            }}
          >
            <span
              className="grid place-items-center"
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                border: "1px solid rgba(94,234,212,0.44)",
                background: "rgba(45,212,191,0.10)",
              }}
            >
              <Plus size={13} />
            </span>
            <span className={styles.monoCap} style={{ fontSize: 10 }}>
              Add agent
            </span>
          </button>
        </div>
      )}
      {expanded && machine.agents.length === 0 && (
        <div className="grid gap-1" style={{ padding: "0 10px 10px" }}>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onAddAgent(); }}
            className={`${styles.rosterAddAgentRow} grid items-center text-left cursor-pointer`}
            style={{
              gridTemplateColumns: "26px minmax(0, 1fr)",
              gap: 10,
              padding: "8px 10px",
              border: "1px dashed rgba(94,234,212,0.38)",
              borderRadius: 8,
              background: "rgba(45,212,191,0.06)",
              color: "var(--accent-strong)",
            }}
          >
            <span
              className="grid place-items-center"
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                border: "1px solid rgba(94,234,212,0.44)",
                background: "rgba(45,212,191,0.10)",
              }}
            >
              <Plus size={13} />
            </span>
            <span className={styles.monoCap} style={{ fontSize: 10 }}>
              Add first agent
            </span>
          </button>
        </div>
      )}
    </div>
  );
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

interface RosterProps {
  machines: FleetMachine[];
  selected: string;
  selectedAgentId: string | null;
  expanded: Set<string>;
  updateStatusByMachine?: Record<string, MachineUpdateButtonStatus>;
  updateDetailByMachine?: Record<string, MachineUpdateButtonDetail>;
  onSelectMachine: (id: string) => void;
  onSelectAgent: (m: FleetMachine, a: FleetAgent) => void;
  onToggleExpand: (id: string) => void;
  onAddAgent: (m: FleetMachine) => void;
  onUpdateMachine?: (m: FleetMachine) => void;
  onRenameMachine?: (machineId: string, name: string) => void;
  onOpenChat?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenTaskChat?: (m: FleetMachine, a: FleetAgent, chat?: FleetAgentChat) => void;
  onCallAgent?: (m: FleetMachine, a: FleetAgent) => void;
  onOpenWallet?: (m: FleetMachine, a: FleetAgent) => void;
  onEditSettings?: (m: FleetMachine, a: FleetAgent) => void;
  onDuplicate?: (m: FleetMachine, a: FleetAgent) => void;
  onRemove?: (
    m: FleetMachine,
    a: FleetAgent,
    depth?: AeonDeleteDepth,
    onProgress?: (progress: AeonDeleteProgress) => void,
  ) => void | Promise<AeonDeleteResult | void>;
}

export function Roster({
  machines, selected, selectedAgentId, expanded,
  updateStatusByMachine,
  updateDetailByMachine,
  onSelectMachine, onSelectAgent, onToggleExpand, onAddAgent,
  onUpdateMachine,
  onRenameMachine,
  onOpenChat, onOpenTaskChat, onCallAgent, onOpenWallet, onEditSettings, onDuplicate, onRemove,
}: RosterProps) {
  const [activeIssueMachine, setActiveIssueMachine] = React.useState<FleetMachine | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<{ machine: FleetMachine; agent: FleetAgent } | null>(null);
  const [deleteDepth, setDeleteDepth] = React.useState<AeonDeleteDepth | null>(null);
  const [deletePhase, setDeletePhase] = React.useState<"choice" | "deleting" | "done" | "error">("choice");
  const [deleteSteps, setDeleteSteps] = React.useState<Record<AeonDeleteStep, AeonDeleteStepStatus>>({ local: "idle", github: "idle" });
  const [deleteMessage, setDeleteMessage] = React.useState("");
  const [issueFixState, setIssueFixState] = React.useState<{
    key: string;
    status: "idle" | "running" | "done" | "failed";
    message: string;
  }>({ key: "", status: "idle", message: "" });
  const [unlockValue, setUnlockValue] = React.useState(0);
  const unlockTrackRef = React.useRef<HTMLDivElement | null>(null);
  const activeIssue = activeIssueMachine?.networkIssue;
  const activeIssueKey = activeIssueMachine && activeIssue?.fixAction ? `${activeIssueMachine.id}:${activeIssue.fixAction}` : "";
  const issueFixStatus = issueFixState.key === activeIssueKey ? issueFixState.status : "idle";
  const issueFixMessage = issueFixState.key === activeIssueKey ? issueFixState.message : "";
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const runIssueFix = React.useCallback(async () => {
    const fixAction = activeIssue?.fixAction;
    const fixKey = activeIssueKey;
    if (!fixAction || !fixKey) return;
    setIssueFixState({ key: fixKey, status: "running", message: "" });
    const response = await fetch("/api/tailscale/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: fixAction }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string; message?: string } | null;
    if (!response?.ok || data?.ok === false) {
      setIssueFixState({
        key: fixKey,
        status: "failed",
        message: data?.error || "The automatic repair did not finish.",
      });
      return;
    }
    setIssueFixState({
      key: fixKey,
      status: "done",
      message: data?.message || "Repair started. Give Tailscale a few seconds, then refresh Fleet.",
    });
  }, [activeIssue, activeIssueKey]);
  const resetDeleteAlert = React.useCallback(() => {
    setDeleteTarget(null);
    setDeleteDepth(null);
    setDeletePhase("choice");
    setDeleteSteps({ local: "idle", github: "idle" });
    setDeleteMessage("");
    setUnlockValue(0);
  }, []);
  const requestRemove = React.useCallback((machine: FleetMachine, agent: FleetAgent) => {
    if (agent.runtime.trim().toLowerCase() !== "aeon") {
      onRemove?.(machine, agent);
      return;
    }
    setDeleteTarget({ machine, agent });
    setDeleteDepth(null);
    setDeletePhase("choice");
    setDeleteSteps({ local: "idle", github: "idle" });
    setDeleteMessage("");
    setUnlockValue(0);
  }, [onRemove]);
  const unlockDelete = React.useCallback(async (value: number) => {
    setUnlockValue(value);
    if (!deleteTarget || !deleteDepth || value < 96) return;
    const steps: AeonDeleteStep[] = deleteDepth === "both" ? ["local", "github"] : [deleteDepth];
    setDeletePhase("deleting");
    setDeleteMessage("");
    setDeleteSteps({ local: "idle", github: "idle" });
    const result = await onRemove?.(deleteTarget.machine, deleteTarget.agent, deleteDepth, (progress) => {
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
  }, [deleteDepth, deleteTarget, onRemove]);
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
      unlockDelete(100);
      return;
    }
    setUnlockValue(0);
  }, [deleteDepth, unlockDelete, unlockValueFromClientX]);
  return (
    <div className="grid gap-1.5">
      {machines.map((m) => (
        <RosterRow
          key={m.id}
          machine={m}
          selected={m.id === selected}
          expanded={expanded.has(m.id) || (m.id === selected && !!selectedAgentId)}
          selectedAgentId={m.id === selected ? selectedAgentId : null}
          updateStatus={updateStatusByMachine?.[m.id]}
          updateDetail={updateDetailByMachine?.[m.id]}
          onSelectMachine={() => onSelectMachine(m.id)}
          onSelectAgent={(a) => onSelectAgent(m, a)}
          onToggle={() => onToggleExpand(m.id)}
          onAddAgent={() => onAddAgent(m)}
          onUpdateMachine={onUpdateMachine ? () => onUpdateMachine(m) : undefined}
          onRenameMachine={onRenameMachine ? (name) => onRenameMachine(m.id, name) : undefined}
          onOpenNetworkIssue={m.networkIssue ? () => setActiveIssueMachine(m) : undefined}
          onOpenChat={(a) => onOpenChat?.(m, a)}
          onOpenTaskChat={(a, chat) => onOpenTaskChat?.(m, a, chat)}
          onCallAgent={(a) => onCallAgent?.(m, a)}
          onOpenWallet={(a) => onOpenWallet?.(m, a)}
          onEditSettings={(a) => onEditSettings?.(m, a)}
          onDuplicate={(a) => onDuplicate?.(m, a)}
          onRemove={(a) => requestRemove(m, a)}
        />
      ))}
      {activeIssue && portalTarget ? createPortal((
        <div
          role="presentation"
          onClick={() => setActiveIssueMachine(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(2,6,23,0.72)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={activeIssue.title}
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              borderRadius: 8,
              border: "1px solid rgba(148,163,184,0.22)",
              background: "rgba(15,23,42,0.98)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.44)",
              color: "var(--foreground)",
              padding: 18,
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className={styles.monoCap} style={{ color: "#fde68a", marginBottom: 8 }}>
                  {activeIssueMachine?.name}
                </div>
                <h3 style={{ fontFamily: "var(--f-display)", fontSize: 20, margin: 0 }}>
                  {activeIssue.title}
                </h3>
              </div>
              <CloseIconButton
                type="button"
                aria-label="Close"
                onClick={() => setActiveIssueMachine(null)}
                className="grid place-items-center"
                style={{
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "rgba(15,23,42,0.78)",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              />
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.55, margin: "12px 0 14px" }}>
              {activeIssue.detail}
            </p>
            {activeIssue.fixAction ? (
              <>
                <button
                  type="button"
                  onClick={() => void runIssueFix()}
                  disabled={issueFixStatus === "running"}
                  className="inline-flex items-center justify-center gap-2"
                  style={{
                    width: "100%",
                    minHeight: 44,
                    borderRadius: 7,
                    border: "1px solid rgba(250,204,21,0.44)",
                    background: issueFixStatus === "done" ? "rgba(34,197,94,0.16)" : "rgba(250,204,21,0.16)",
                    color: issueFixStatus === "done" ? "#bbf7d0" : "#fde68a",
                    fontFamily: "var(--f-mono)",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    cursor: issueFixStatus === "running" ? "wait" : "pointer",
                    opacity: issueFixStatus === "running" ? 0.72 : 1,
                  }}
                >
                  {issueFixStatus === "running" ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <PlugZap size={15} aria-hidden="true" />}
                  {issueFixStatus === "running" ? "Fixing..." : issueFixStatus === "done" ? "Repair started" : activeIssue.fixLabel || "Fix automatically"}
                </button>
                {issueFixMessage ? (
                  <p
                    role={issueFixStatus === "failed" ? "alert" : "status"}
                    style={{
                      margin: "10px 0 0",
                      color: issueFixStatus === "failed" ? "#fecdd3" : "#bbf7d0",
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    {issueFixMessage}
                  </p>
                ) : null}
                <div
                  aria-hidden="true"
                  className="flex items-center gap-3"
                  style={{ margin: "16px 0 14px", color: "var(--muted)", fontFamily: "var(--f-mono)", fontSize: 11 }}
                >
                  <span style={{ height: 1, flex: 1, background: "rgba(148,163,184,0.2)" }} />
                  <span>OR</span>
                  <span style={{ height: 1, flex: 1, background: "rgba(148,163,184,0.2)" }} />
                </div>
              </>
            ) : null}
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowX: "auto",
                borderRadius: 7,
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(2,6,23,0.72)",
                color: "#dbeafe",
                padding: 12,
                fontFamily: "var(--f-mono)",
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >{activeIssue.commands.join("\n")}</pre>
          </div>
        </div>
      ), portalTarget) : null}
      {deleteTarget && portalTarget ? createPortal((
        <div
          role="presentation"
          onClick={() => {
            if (deletePhase !== "deleting") resetDeleteAlert();
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
                  How deeply would you like to delete {deleteTarget.agent.name}?
                </h3>
              </div>
              <CloseIconButton
                type="button"
                aria-label="Cancel delete"
                onClick={resetDeleteAlert}
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
                  aria-label={`Slide to unlock deletion for ${deleteTarget.agent.name}`}
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
                onClose={resetDeleteAlert}
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
      ), portalTarget) : null}
    </div>
  );
}
