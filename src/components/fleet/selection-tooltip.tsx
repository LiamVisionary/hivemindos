"use client";

import * as React from "react";
import {
  AlertTriangle,
  Copy,
  Cpu,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Plus,
  Settings,
  Smartphone,
  SquareTerminal,
  Trash2,
  Wallet,
} from "lucide-react";

import { CloseIconButton } from "@/components/ui/close-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { BeeIcon } from "./bee-icon";
import { ChatCallSplitButton } from "./chat-call-split-button";
import { HexTile } from "./hex-tile";
import {
  fleetAgentCanChat,
  isFleetMachineMobile,
  type FleetAgent,
  type FleetAgentChat,
  type FleetMachine,
} from "./fleet-data";
import type {
  MachineUpdateButtonDetail,
  MachineUpdateButtonStatus,
} from "./roster";
import { FleetTaskPreviewRow } from "./task-preview-row";
import styles from "./fleet-tokens.module.css";
import splitStyles from "./selection-tooltip-actions.module.css";

type AgentAction = (machine: FleetMachine, agent: FleetAgent) => void;

type FleetAgentDetailPanelProps = {
  machine: FleetMachine;
  agent: FleetAgent;
  expandedTaskIds: Set<string>;
  onToggleTaskPreview: (previewId: string) => void;
  onOpenChat?: AgentAction;
  onOpenTaskChat?: (
    machine: FleetMachine,
    agent: FleetAgent,
    chat?: FleetAgentChat,
  ) => void;
  onCallAgent?: AgentAction;
  onOpenWallet?: AgentAction;
  onEditSettings?: AgentAction;
  onDuplicate?: AgentAction;
  onRemove?: AgentAction;
};

type FleetMachineDetailPanelProps = {
  machine: FleetMachine;
  updateStatus?: MachineUpdateButtonStatus;
  updateDetail?: MachineUpdateButtonDetail;
  onAddAgent?: (machine: FleetMachine) => void;
  onUpdateMachine?: (machine: FleetMachine) => void;
  onOpenCodeProof?: (machine: FleetMachine) => void;
  onFixSyncIssue?: (machine: FleetMachine) => void | Promise<void>;
  onOpenUsePodHost?: (machine: FleetMachine) => void;
  onOpenShell?: (machine: FleetMachine) => void;
};

export type FleetSelectionTooltipContentProps = {
  machine: FleetMachine;
  agent?: FleetAgent | null;
  updateStatus?: MachineUpdateButtonStatus;
  updateDetail?: MachineUpdateButtonDetail;
  onClose?: () => void;
  onAddAgent?: (machine: FleetMachine) => void;
  onUpdateMachine?: (machine: FleetMachine) => void;
  onOpenCodeProof?: (machine: FleetMachine) => void;
  onFixSyncIssue?: (machine: FleetMachine) => void | Promise<void>;
  onOpenUsePodHost?: (machine: FleetMachine) => void;
  onOpenShell?: (machine: FleetMachine) => void;
  onOpenChat?: AgentAction;
  onOpenTaskChat?: (
    machine: FleetMachine,
    agent: FleetAgent,
    chat?: FleetAgentChat,
  ) => void;
  onCallAgent?: AgentAction;
  onOpenWallet?: AgentAction;
  onEditSettings?: AgentAction;
  onDuplicate?: AgentAction;
  onRemove?: AgentAction;
};

const AGENT_STATE_COLOR: Record<FleetAgent["state"], string> = {
  working: "var(--accent-strong)",
  ready: "var(--muted)",
  scheduled: "#fde68a",
  setup: "#fde68a",
  failed: "var(--danger)",
};

function stopEvent(event: React.MouseEvent | React.KeyboardEvent) {
  event.stopPropagation();
}

function actionHandler(
  machine: FleetMachine,
  agent: FleetAgent,
  fn?: AgentAction,
) {
  return (event: React.MouseEvent) => {
    event.stopPropagation();
    fn?.(machine, agent);
  };
}

function taskChatHandler(
  machine: FleetMachine,
  agent: FleetAgent,
  chat: FleetAgentChat,
  fn?: (
    machine: FleetMachine,
    agent: FleetAgent,
    chat?: FleetAgentChat,
  ) => void,
) {
  return (event: React.MouseEvent) => {
    event.stopPropagation();
    fn?.(machine, agent, chat);
  };
}

function FleetAgentDetailPanel({
  machine,
  agent,
  expandedTaskIds,
  onToggleTaskPreview,
  onOpenChat,
  onOpenTaskChat,
  onCallAgent,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
}: FleetAgentDetailPanelProps) {
  const canChat = fleetAgentCanChat(agent);
  const chats = (
    agent.recentChats?.length
      ? agent.recentChats
      : [
          {
            id: agent.currentTaskId ?? "current",
            title: agent.task,
            task: agent.task,
            since: agent.since,
          },
        ]
  ).slice(0, 3);

  return (
    <div className="grid" style={{ gap: 8 }}>
      {chats.map((chat) => {
        const previewId = `${agent.id}:${chat.id}`;
        const isTaskExpanded = expandedTaskIds.has(previewId);
        const canResumeChat =
          canChat && chat.id !== "current" && onOpenTaskChat;
        return (
          <FleetTaskPreviewRow
            key={previewId}
            id={previewId}
            title={chat.title}
            since={chat.since}
            expanded={isTaskExpanded}
            subjectName={agent.name}
            onToggle={onToggleTaskPreview}
          >
            {canResumeChat ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={taskChatHandler(
                      machine,
                      agent,
                      chat,
                      onOpenTaskChat,
                    )}
                    aria-label={`Resume chat with ${agent.name}`}
                    className={`${styles.tooltipActionButton} inline-grid place-items-center`}
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
          </FleetTaskPreviewRow>
        );
      })}

      <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
        <ChatCallSplitButton
          name={agent.name}
          chatLabel="New chat"
          onChat={canChat && onOpenChat ? actionHandler(machine, agent, onOpenChat) : undefined}
          onCall={onCallAgent ? actionHandler(machine, agent, onCallAgent) : undefined}
          singleClassName={splitStyles.chatSingle}
          splitClassName={splitStyles.chatCallSplit}
          chatClassName={splitStyles.chatSegment}
          callClassName={splitStyles.callSegment}
        />

        {[
          {
            id: "wallet",
            label: "Wallet & limits",
            Icon: Wallet,
            onClick: actionHandler(machine, agent, onOpenWallet),
          },
          {
            id: "edit",
            label: "Edit settings",
            Icon: Settings,
            onClick: actionHandler(machine, agent, onEditSettings),
          },
          {
            id: "dup",
            label: "Duplicate",
            Icon: Copy,
            onClick: actionHandler(machine, agent, onDuplicate),
          },
          {
            id: "remove",
            label: "Remove agent",
            Icon: Trash2,
            onClick: actionHandler(machine, agent, onRemove),
            danger: true,
          },
        ].map(({ id, label, Icon, onClick, danger }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClick}
                aria-label={label}
                className={`${styles.tooltipActionButton} inline-grid place-items-center cursor-pointer`}
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
                <Icon size={12} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function FleetMachineDetailPanel({
  machine,
  updateStatus,
  updateDetail,
  onAddAgent,
  onUpdateMachine,
  onOpenCodeProof,
  onFixSyncIssue,
  onOpenUsePodHost,
  onOpenShell,
}: FleetMachineDetailPanelProps) {
  const syncIssueKey = machine.syncIssue?.deviceID ?? "";
  const [syncFix, setSyncFix] = React.useState<{
    key: string;
    state: "idle" | "running" | "done" | "failed";
    message: string;
  }>({ key: "", state: "idle", message: "" });
  const syncState = syncFix.key === syncIssueKey ? syncFix.state : "idle";
  const syncMessage = syncFix.key === syncIssueKey ? syncFix.message : "";
  const updateDisabled =
    updateStatus === "updating" || updateStatus === "updated";
  const showUpdateButton = Boolean(
    onUpdateMachine &&
    (updateStatus === "updating" ||
      updateStatus === "updated" ||
      updateStatus === "failed" ||
      machine.versionState === "stale" ||
      machine.canUpdate === true),
  );
  const codeNode = machine.gitlawb;
  const codeNodeLabel = codeNode?.healthy
    ? "Code node"
    : codeNode?.enabled
      ? "Code node offline"
      : codeNode
        ? "Code proof"
        : "";
  const syncRunning = syncState === "running";
  const syncTooltip = [syncMessage, machine.syncIssue?.detail]
    .filter(Boolean)
    .join("\n\n");

  const runSyncFix = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!onFixSyncIssue || syncRunning) return;
    setSyncFix({ key: syncIssueKey, state: "running", message: "" });
    try {
      await onFixSyncIssue(machine);
      setSyncFix({
        key: syncIssueKey,
        state: "done",
        message:
          "Repair request sent. Fleet will refresh the sync state shortly.",
      });
    } catch (error) {
      setSyncFix({
        key: syncIssueKey,
        state: "failed",
        message:
          error instanceof Error ? error.message : "Syncthing repair failed.",
      });
    }
  };

  return (
    <div className="grid" style={{ gap: 9 }}>
      <div
        className="grid"
        style={{
          gap: 5,
          color: "var(--muted)",
          fontFamily: "var(--f-mono)",
          fontSize: 10.5,
          lineHeight: 1.45,
        }}
      >
        <span>
          {machine.kind} · {machine.role} · {machine.city}
        </span>
        <span>{machine.os}</span>
        <span>
          {machine.tailnet}
          {machine.ip !== "—" ? ` · ${machine.ip}` : ""}
          {machine.ping ? ` · ${machine.ping}ms` : ""}
        </span>
        <span>
          {machine.agents.length} agent{machine.agents.length === 1 ? "" : "s"}{" "}
          · {machine.uptime}
        </span>
      </div>

      <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
        {showUpdateButton ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!updateDisabled) onUpdateMachine?.(machine);
                }}
                disabled={updateDisabled}
                aria-label={
                  updateStatus === "updating"
                    ? `Updating ${machine.name}`
                    : `Update ${machine.name}`
                }
                className={`${styles.tooltipActionButton} inline-flex items-center justify-center`}
                style={{
                  minHeight: 28,
                  gap: 6,
                  padding: "7px 9px",
                  borderRadius: 7,
                  border:
                    updateStatus === "failed"
                      ? "1px solid rgba(251,113,133,0.46)"
                      : updateStatus === "updated"
                        ? "1px solid rgba(94,234,212,0.54)"
                        : "1px solid rgba(255,212,90,0.46)",
                  background:
                    updateStatus === "failed"
                      ? "rgba(251,113,133,0.14)"
                      : updateStatus === "updated"
                        ? "rgba(45,212,191,0.16)"
                        : "rgba(255,212,90,0.14)",
                  color:
                    updateStatus === "failed"
                      ? "#fecdd3"
                      : updateStatus === "updated"
                        ? "var(--accent-strong)"
                        : "var(--hex-honey-border)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 9.5,
                  fontWeight: 800,
                  cursor: updateDisabled ? "default" : "pointer",
                }}
              >
                {updateStatus === "updating" ? (
                  <LoaderCircle
                    size={12}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {updateStatus === "updated"
                  ? "Updated!"
                  : updateStatus === "failed"
                    ? "Failed"
                    : updateStatus === "updating"
                      ? "Updating"
                      : "Update"}
              </button>
            </TooltipTrigger>
            {updateDetail?.detail ? (
              <TooltipContent style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                {updateDetail.detail}
              </TooltipContent>
            ) : null}
          </Tooltip>
        ) : null}

        {codeNodeLabel && onOpenCodeProof ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenCodeProof(machine);
                }}
                aria-label={`Open Code Proof setup for ${machine.name}`}
                className={`${styles.tooltipActionButton} inline-flex items-center justify-center`}
                style={{
                  minHeight: 28,
                  gap: 6,
                  padding: "7px 9px",
                  borderRadius: 7,
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "rgba(15,23,42,0.62)",
                  color: "var(--foreground)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 9.5,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                <GitBranch size={12} aria-hidden="true" />
                {codeNodeLabel}
              </button>
            </TooltipTrigger>
            <TooltipContent>Open Code Proof setup</TooltipContent>
          </Tooltip>
        ) : null}

        {onOpenShell && machine.collectorUrl ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* aria-disabled (not disabled) when the machine's linkd has no
                  shell service, so the explanatory tooltip still fires. */}
              <button
                type="button"
                aria-disabled={machine.remoteShell === false}
                onClick={(event) => {
                  event.stopPropagation();
                  if (machine.remoteShell === false) return;
                  onOpenShell(machine);
                }}
                aria-label={`Open terminal on ${machine.name}`}
                className={`${styles.tooltipActionButton} inline-flex items-center justify-center`}
                style={{
                  minHeight: 28,
                  gap: 6,
                  padding: "7px 9px",
                  borderRadius: 7,
                  border: "1px solid rgba(148,163,184,0.22)",
                  background: "rgba(15,23,42,0.62)",
                  color: "var(--foreground)",
                  fontFamily: "var(--f-mono)",
                  fontSize: 9.5,
                  fontWeight: 800,
                  cursor: machine.remoteShell === false ? "not-allowed" : "pointer",
                  opacity: machine.remoteShell === false ? 0.55 : undefined,
                }}
              >
                <SquareTerminal size={12} aria-hidden="true" />
                Terminal
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {machine.remoteShell === false
                ? `Remote shell isn't available on ${machine.name} yet — Windows machines don't support it.`
                : `Open a shell on ${machine.name} over the hive link`}
            </TooltipContent>
          </Tooltip>
        ) : null}

        {onAddAgent ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddAgent(machine);
                }}
                className={`${styles.tooltipActionButton} inline-flex items-center uppercase font-bold`}
                style={{
                  gap: 6,
                  padding: "7px 9px",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontFamily: "var(--f-mono)",
                  fontSize: 9.5,
                  letterSpacing: 0.04,
                  border: "1px dashed rgba(94,234,212,0.44)",
                  background: "rgba(45,212,191,0.08)",
                  color: "var(--accent-strong)",
                }}
              >
                <Plus size={12} aria-hidden="true" /> Add agent
              </button>
            </TooltipTrigger>
            <TooltipContent>Add agent to {machine.name}</TooltipContent>
          </Tooltip>
        ) : null}

        {onOpenUsePodHost ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenUsePodHost(machine);
                }}
                aria-label={`Rent ${machine.name} compute through Hive Compute`}
                className={styles.rosterUsePodHostButton}
                style={{ minHeight: 28, padding: "7px 9px" }}
              >
                <Cpu size={15} aria-hidden="true" />
                <span>Rent compute</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Run Hive Compute on this machine</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {machine.networkIssue ? (
        <div
          className={styles.rosterNetworkIssue}
          style={{
            border: "1px solid rgba(251,191,36,0.42)",
            background: "rgba(251,191,36,0.12)",
            color: "#fde68a",
          }}
        >
          <AlertTriangle size={10} aria-hidden="true" />
          <span>{machine.networkIssue.label}</span>
        </div>
      ) : null}

      {machine.syncIssue ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(event) => void runSyncFix(event)}
              disabled={syncRunning}
              className={`${styles.tooltipActionButton} ${styles.rosterNetworkIssue}`}
              style={{
                border:
                  syncState === "done"
                    ? "1px solid rgba(94,234,212,0.46)"
                    : "1px solid rgba(251,113,133,0.46)",
                background:
                  syncState === "done"
                    ? "rgba(45,212,191,0.13)"
                    : "rgba(251,113,133,0.13)",
                color:
                  syncState === "done" ? "var(--accent-strong)" : "#fecdd3",
                cursor: syncRunning
                  ? "wait"
                  : onFixSyncIssue
                    ? "pointer"
                    : "default",
              }}
            >
              {syncRunning ? (
                <LoaderCircle
                  size={10}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle size={10} aria-hidden="true" />
              )}
              <span>
                {syncRunning
                  ? "Fixing sync..."
                  : syncState === "done"
                    ? "Sync repair sent"
                    : syncState === "failed"
                      ? "Sync fix failed"
                      : machine.syncIssue.label}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
            {syncTooltip}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function FleetSelectionTooltipContent({
  machine,
  agent,
  updateStatus,
  updateDetail,
  onClose,
  onAddAgent,
  onUpdateMachine,
  onOpenCodeProof,
  onFixSyncIssue,
  onOpenUsePodHost,
  onOpenShell,
  onOpenChat,
  onOpenTaskChat,
  onCallAgent,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
}: FleetSelectionTooltipContentProps) {
  const MachineIcon = isFleetMachineMobile(machine) ? Smartphone : Monitor;
  const activeSelectionKey = `${machine?.id ?? "none"}:${agent?.id ?? "machine"}`;
  const [expandedTaskState, setExpandedTaskState] = React.useState<{
    key: string;
    ids: Set<string>;
  }>(() => ({ key: activeSelectionKey, ids: new Set() }));
  const emptyTaskIds = React.useMemo(() => new Set<string>(), []);
  const expandedTaskIds =
    expandedTaskState.key === activeSelectionKey
      ? expandedTaskState.ids
      : emptyTaskIds;

  const toggleTaskPreview = React.useCallback(
    (previewId: string) => {
      setExpandedTaskState((current) => {
        const next = new Set(
          current.key === activeSelectionKey ? current.ids : [],
        );
        if (next.has(previewId)) next.delete(previewId);
        else next.add(previewId);
        return { key: activeSelectionKey, ids: next };
      });
    },
    [activeSelectionKey],
  );

  return (
    <div
      aria-label={agent ? `${agent.name} actions` : `${machine.name} details`}
      onClick={stopEvent}
      onKeyDown={stopEvent}
      style={{
        color: "var(--foreground)",
        width: "min(380px, calc(100vw - 32px))",
      }}
    >
      <div
        className="flex items-start justify-between"
        style={{ gap: 10, marginBottom: 10 }}
      >
        <div className="flex min-w-0 items-center" style={{ gap: 10 }}>
          <HexTile size={agent ? 48 : 44} tone="honey" surface="flat">
            {agent ? (
              <BeeIcon
                role={agent.beeRole === "queen" ? "queen" : "worker"}
                workerClass={agent.workerClass}
                size={36}
                dim={agent.state === "ready"}
              />
            ) : (
              <MachineIcon
                aria-hidden="true"
                size={24}
                style={{ color: "var(--hex-honey-border)" }}
              />
            )}
          </HexTile>
          <div className="min-w-0">
            <div
              className={styles.monoCap}
              style={{
                color: agent
                  ? AGENT_STATE_COLOR[agent.state]
                  : "var(--accent-strong)",
                marginBottom: 3,
              }}
            >
              {agent
                ? `${machine.name} · ${agent.runtime} · ${agent.role}`
                : `${machine.kind} · ${machine.role}`}
            </div>
            <div
              style={{
                fontFamily: "var(--f-display)",
                fontSize: 15,
                fontWeight: 700,
                lineHeight: 1.2,
                overflowWrap: "anywhere",
              }}
            >
              {agent ? agent.name : machine.name}
            </div>
          </div>
        </div>
        <CloseIconButton
          type="button"
          aria-label="Close selection tooltip"
          onClick={(event) => {
            event.stopPropagation();
            onClose?.();
          }}
          className="grid place-items-center"
          style={{
            width: 28,
            height: 28,
            border: "1px solid rgba(148,163,184,0.22)",
            background: "rgba(15,23,42,0.78)",
            color: "var(--muted)",
            cursor: "pointer",
          }}
        />
      </div>

      {agent ? (
        <FleetAgentDetailPanel
          machine={machine}
          agent={agent}
          expandedTaskIds={expandedTaskIds}
          onToggleTaskPreview={toggleTaskPreview}
          onOpenChat={onOpenChat}
          onOpenTaskChat={onOpenTaskChat}
          onCallAgent={onCallAgent}
          onOpenWallet={onOpenWallet}
          onEditSettings={onEditSettings}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
        />
      ) : (
        <FleetMachineDetailPanel
          machine={machine}
          updateStatus={updateStatus}
          updateDetail={updateDetail}
          onAddAgent={onAddAgent}
          onUpdateMachine={onUpdateMachine}
          onOpenCodeProof={onOpenCodeProof}
          onFixSyncIssue={onFixSyncIssue}
          onOpenUsePodHost={onOpenUsePodHost}
          onOpenShell={onOpenShell}
        />
      )}
    </div>
  );
}
