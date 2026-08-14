"use client";

import * as React from "react";
import {
  AlertTriangle,
  ChevronDown,
  Cpu,
  FileUp,
  GitBranch,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCcw,
  Settings,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FleetMachine } from "./fleet-data";
import type { MachineUpdateButtonDetail, MachineUpdateButtonStatus } from "./roster";
import styles from "./list-view.module.css";

export type FleetListMachineActionsProps = {
  machine: FleetMachine;
  updateStatus?: MachineUpdateButtonStatus;
  updateDetail?: MachineUpdateButtonDetail;
  onAddAgent: (machine: FleetMachine) => void;
  onOpenSettings?: (machine: FleetMachine) => void;
  onUpdateMachine?: (machine: FleetMachine) => void;
  onFixSyncIssue?: (machine: FleetMachine) => void | Promise<void>;
  onFixNetworkIssue?: (machine: FleetMachine) => void | Promise<void>;
  onOpenShell?: (machine: FleetMachine) => void;
  onSendFile?: (machine: FleetMachine) => void;
  onOpenCompute?: (machine: FleetMachine) => void;
  onRenameMachine?: (machineId: string, name: string) => void;
  onOpenCodeProof?: (machine: FleetMachine) => void;
};

function ActionMenuItem({
  Icon,
  label,
  detail,
  tone = "default",
  disabled = false,
  busy = false,
  onSelect,
}: {
  Icon: LucideIcon;
  label: string;
  detail?: string;
  tone?: "default" | "honey" | "danger";
  disabled?: boolean;
  busy?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      className={styles.actionMenuItem}
      data-tone={tone}
      disabled={disabled}
      title={detail}
      onSelect={onSelect}
    >
      {busy ? <LoaderCircle className={styles.actionSpinner} aria-hidden="true" /> : <Icon aria-hidden="true" />}
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
    </DropdownMenuItem>
  );
}

export function FleetListMachineActions({
  machine,
  updateStatus,
  updateDetail,
  onAddAgent,
  onOpenSettings,
  onUpdateMachine,
  onFixSyncIssue,
  onFixNetworkIssue,
  onOpenShell,
  onSendFile,
  onOpenCompute,
  onRenameMachine,
  onOpenCodeProof,
}: FleetListMachineActionsProps) {
  const [busyAction, setBusyAction] = React.useState<"sync" | "network" | null>(null);
  const [actionMessage, setActionMessage] = React.useState("");
  const showUpdate = Boolean(
    onUpdateMachine
      && (machine.canUpdate === true
        || machine.versionState === "stale"
        || updateStatus === "updating"
        || updateStatus === "updated"
        || updateStatus === "failed"),
  );
  const updateBusy = updateStatus === "updating" || updateStatus === "updated";
  const updateLabel = updateStatus === "updating"
    ? (updateDetail?.label ?? "Updating…")
    : updateStatus === "updated"
      ? (updateDetail?.label ?? "Updated")
      : updateStatus === "failed"
        ? "Update · retry"
        : (updateDetail?.label ?? "Update");
  const hasRepairs = Boolean(
    (machine.syncIssue && onFixSyncIssue)
      || (machine.networkIssue?.fixAction && onFixNetworkIssue),
  );
  const hasOperateActions = Boolean(onOpenShell || onSendFile || onOpenCompute);
  const hasManageActions = Boolean(
    (machine.collectorUrl && onOpenSettings)
      || showUpdate
      || onRenameMachine
      || onOpenCodeProof,
  );
  const issueCount = Number(Boolean(machine.syncIssue && onFixSyncIssue))
    + Number(Boolean(machine.networkIssue?.fixAction && onFixNetworkIssue))
    + Number(updateStatus === "failed");

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      setBusyAction(null);
      setActionMessage("");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [machine.id, machine.networkIssue?.fixAction, machine.syncIssue?.deviceID]);

  const runRepair = async (
    kind: "sync" | "network",
    action: () => void | Promise<void>,
  ) => {
    setBusyAction(kind);
    setActionMessage("");
    try {
      await action();
      setActionMessage(kind === "sync" ? "Sync repair sent." : "Network repair sent.");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Machine repair failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const rename = () => {
    const next = window.prompt("Rename machine", machine.name)?.trim();
    if (next && next !== machine.name) onRenameMachine?.(machine.id, next);
  };

  return (
    <div className={styles.machineActionsWrap} onClick={(event) => event.stopPropagation()}>
      <div className={styles.compactActionBar} role="group" aria-label={`Machine actions for ${machine.name}`}>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={() => onAddAgent(machine)}
        >
          <Plus aria-hidden="true" />
          <span>Add agent</span>
        </button>

        {hasRepairs || hasOperateActions || hasManageActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={styles.actionsTrigger}
                data-attention={issueCount > 0 ? "true" : undefined}
                aria-label={`Open actions for ${machine.name}${issueCount > 0 ? `, ${issueCount} ${issueCount === 1 ? "issue" : "issues"}` : ""}`}
              >
                <span>Actions</span>
                {issueCount > 0 ? <span className={styles.actionCount} aria-hidden="true">{issueCount}</span> : null}
                <ChevronDown aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={7}
              collisionPadding={12}
              className={styles.actionMenu}
            >
              <DropdownMenuLabel className={styles.actionMenuTitle}>{machine.name}</DropdownMenuLabel>

              {hasRepairs ? (
                <>
                  <DropdownMenuLabel className={styles.actionMenuSection}>Needs attention</DropdownMenuLabel>
                  {machine.syncIssue && onFixSyncIssue ? (
                    <ActionMenuItem
                      Icon={AlertTriangle}
                      label={busyAction === "sync" ? "Fixing sync…" : "Fix sync"}
                      detail={machine.syncIssue.title}
                      disabled={busyAction === "sync"}
                      busy={busyAction === "sync"}
                      tone="danger"
                      onSelect={() => void runRepair("sync", () => onFixSyncIssue(machine))}
                    />
                  ) : null}
                  {machine.networkIssue?.fixAction && onFixNetworkIssue ? (
                    <ActionMenuItem
                      Icon={Wrench}
                      label={busyAction === "network" ? "Repairing…" : (machine.networkIssue.fixLabel ?? "Fix network")}
                      detail={machine.networkIssue.title}
                      disabled={busyAction === "network"}
                      busy={busyAction === "network"}
                      tone="danger"
                      onSelect={() => void runRepair("network", () => onFixNetworkIssue(machine))}
                    />
                  ) : null}
                  <DropdownMenuSeparator className={styles.actionMenuSeparator} />
                </>
              ) : null}

              {hasOperateActions ? (
                <>
                  <DropdownMenuLabel className={styles.actionMenuSection}>Operate</DropdownMenuLabel>
                  {onOpenShell ? (
                    <ActionMenuItem
                      Icon={SquareTerminal}
                      label="Shell"
                      detail={machine.remoteShell === false ? "Unavailable on this machine" : undefined}
                      disabled={machine.remoteShell === false}
                      onSelect={() => onOpenShell(machine)}
                    />
                  ) : null}
                  {onSendFile ? (
                    <ActionMenuItem
                      Icon={FileUp}
                      label="Send file"
                      detail={machine.fileTransfers === false ? "Run Setup to prepare file access" : undefined}
                      disabled={machine.fileTransfers === false}
                      onSelect={() => onSendFile(machine)}
                    />
                  ) : null}
                  {onOpenCompute ? (
                    <ActionMenuItem
                      Icon={Cpu}
                      label="Rent compute"
                      detail="Host spare compute"
                      tone="honey"
                      onSelect={() => onOpenCompute(machine)}
                    />
                  ) : null}
                </>
              ) : null}

              {hasOperateActions && hasManageActions ? (
                <DropdownMenuSeparator className={styles.actionMenuSeparator} />
              ) : null}

              {hasManageActions ? (
                <>
                  <DropdownMenuLabel className={styles.actionMenuSection}>Manage</DropdownMenuLabel>
                  {machine.collectorUrl && onOpenSettings ? (
                    <ActionMenuItem Icon={Settings} label="Settings" onSelect={() => onOpenSettings(machine)} />
                  ) : null}
                  {showUpdate && onUpdateMachine ? (
                    <ActionMenuItem
                      Icon={RefreshCcw}
                      label={updateLabel}
                      detail={updateDetail?.detail}
                      disabled={updateBusy}
                      busy={updateBusy}
                      tone={updateStatus === "failed" ? "danger" : "default"}
                      onSelect={() => onUpdateMachine(machine)}
                    />
                  ) : null}
                  {onRenameMachine ? (
                    <ActionMenuItem Icon={Pencil} label="Rename" onSelect={rename} />
                  ) : null}
                  {onOpenCodeProof ? (
                    <ActionMenuItem Icon={GitBranch} label="Code proof" onSelect={() => onOpenCodeProof(machine)} />
                  ) : null}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {updateDetail?.detail ? <p className={styles.machineActionMessage} role="status">{updateDetail.detail}</p> : null}
      {actionMessage ? <p className={styles.machineActionMessage} role="status">{actionMessage}</p> : null}
    </div>
  );
}
