"use client";

import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Cpu,
  FileUp,
  GitBranch,
  MessageSquare,
  Plus,
  RefreshCcw,
  Settings,
  SquareTerminal,
  Trash2,
  Wallet,
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
import { ChatCallSplitButton } from "@/components/fleet/chat-call-split-button";
import type { HiveAgent, HiveMachine } from "./fleet-hive-types";
import styles from "./hive-panel-actions.module.css";

type MachineUpdateAction = {
  label: string;
  busy: boolean;
  canUpdate: boolean;
  detail?: string;
  tone: "idle" | "working" | "failed" | "updated";
} | null;

type MenuActionProps = {
  Icon: LucideIcon;
  label: string;
  detail?: string;
  disabled?: boolean;
  tone?: "default" | "honey" | "danger";
  onSelect: () => void;
};

export function HiveChatCallSplitButton({
  name,
  chatLabel = "Chat",
  callLabel = "Call agent",
  onChat,
  onCall,
}: {
  name: string;
  chatLabel?: string;
  callLabel?: string;
  onChat?: () => void;
  onCall?: () => void;
}) {
  return (
    <ChatCallSplitButton
      name={name}
      chatLabel={chatLabel}
      callLabel={callLabel}
      onChat={onChat}
      onCall={onCall}
      singleClassName={styles.primaryAction}
      splitClassName={styles.chatCallSplit}
      chatClassName={styles.chatSegment}
      callClassName={styles.callSegment}
    />
  );
}

function MenuAction({
  Icon,
  label,
  detail,
  disabled = false,
  tone = "default",
  onSelect,
}: MenuActionProps) {
  return (
    <DropdownMenuItem
      className={styles.menuItem}
      data-tone={tone}
      disabled={disabled}
      title={detail}
      onSelect={onSelect}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
    </DropdownMenuItem>
  );
}

export function HiveMachineActions({
  machine,
  update,
  onAddAgent,
  onOpenSettings,
  onUpdateMachine,
  onFixSyncIssue,
  onFixNetworkIssue,
  onOpenShell,
  onSendFile,
  onOpenCompute,
  onOpenCodeProof,
}: {
  machine: HiveMachine;
  update: MachineUpdateAction;
  onAddAgent?: (machine: HiveMachine) => void;
  onOpenSettings?: () => void;
  onUpdateMachine?: (machine: HiveMachine) => void;
  onFixSyncIssue?: (machine: HiveMachine) => void;
  onFixNetworkIssue?: (machine: HiveMachine) => void;
  onOpenShell?: (machine: HiveMachine) => void;
  onSendFile?: (machine: HiveMachine) => void;
  onOpenCompute?: (machine: HiveMachine) => void;
  onOpenCodeProof?: (machine: HiveMachine) => void;
}) {
  const sync = machine.source.syncIssue;
  const network = machine.source.networkIssue;
  const hasRepairs = Boolean((sync && onFixSyncIssue) || (network?.fixAction && onFixNetworkIssue));
  const hasOperateActions = Boolean(onOpenShell || onSendFile || onOpenCompute);
  const hasManageActions = Boolean(onOpenSettings || (update?.canUpdate && onUpdateMachine) || onOpenCodeProof);
  const issueCount = Number(Boolean(sync && onFixSyncIssue))
    + Number(Boolean(network?.fixAction && onFixNetworkIssue))
    + Number(update?.tone === "failed");

  return (
    <div className={styles.actionBar} role="group" aria-label={`Machine actions for ${machine.name}`}>
      {onAddAgent ? (
        <button
          type="button"
          className={styles.primaryAction}
          data-bee={`fleet-hive-add-${machine.name}`}
          onClick={() => onAddAgent(machine)}
        >
          <Plus aria-hidden="true" />
          <span>Add agent</span>
        </button>
      ) : null}

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
              {issueCount > 0 ? <span className={styles.issueCount} aria-hidden="true">{issueCount}</span> : null}
              <ChevronDown aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={7} collisionPadding={12} className={styles.menu}>
            <DropdownMenuLabel className={styles.menuTitle}>{machine.name}</DropdownMenuLabel>

            {hasRepairs ? (
              <>
                <DropdownMenuLabel className={styles.menuSection}>Needs attention</DropdownMenuLabel>
                {sync && onFixSyncIssue ? (
                  <MenuAction
                    Icon={AlertTriangle}
                    label="Fix sync"
                    detail={sync.title}
                    tone="danger"
                    onSelect={() => onFixSyncIssue(machine)}
                  />
                ) : null}
                {network?.fixAction && onFixNetworkIssue ? (
                  <MenuAction
                    Icon={Wrench}
                    label={network.fixLabel ?? "Fix network"}
                    detail={network.title}
                    tone="danger"
                    onSelect={() => onFixNetworkIssue(machine)}
                  />
                ) : null}
                <DropdownMenuSeparator className={styles.menuSeparator} />
              </>
            ) : null}

            {hasOperateActions ? (
              <>
                <DropdownMenuLabel className={styles.menuSection}>Operate</DropdownMenuLabel>
                {onOpenShell ? (
                  <MenuAction
                    Icon={SquareTerminal}
                    label="Shell"
                    detail={machine.source.remoteShell === false ? "Unavailable on this machine" : undefined}
                    disabled={machine.source.remoteShell === false}
                    onSelect={() => onOpenShell(machine)}
                  />
                ) : null}
                {onSendFile ? (
                  <MenuAction
                    Icon={FileUp}
                    label="Send file"
                    detail={machine.source.fileTransfers === false ? "Run Setup to prepare file access" : undefined}
                    disabled={machine.source.fileTransfers === false}
                    onSelect={() => onSendFile(machine)}
                  />
                ) : null}
                {onOpenCompute ? (
                  <MenuAction
                    Icon={Cpu}
                    label="Rent compute"
                    detail="Host spare compute"
                    tone="honey"
                    onSelect={() => onOpenCompute(machine)}
                  />
                ) : null}
              </>
            ) : null}

            {hasOperateActions && hasManageActions ? <DropdownMenuSeparator className={styles.menuSeparator} /> : null}

            {hasManageActions ? (
              <>
                <DropdownMenuLabel className={styles.menuSection}>Manage</DropdownMenuLabel>
                {onOpenSettings ? <MenuAction Icon={Settings} label="Settings" onSelect={onOpenSettings} /> : null}
                {update?.canUpdate && onUpdateMachine ? (
                  <MenuAction
                    Icon={RefreshCcw}
                    label={update.label}
                    detail={update.detail}
                    disabled={update.busy}
                    tone={update.tone === "failed" ? "danger" : "default"}
                    onSelect={() => onUpdateMachine(machine)}
                  />
                ) : null}
                {onOpenCodeProof ? (
                  <MenuAction Icon={GitBranch} label="Code proof" onSelect={() => onOpenCodeProof(machine)} />
                ) : null}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function HiveAgentActions({
  machine,
  agent,
  canChat,
  onOpenChat,
  onCallAgent,
  onOpenTaskChat,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
}: {
  machine: HiveMachine;
  agent: HiveAgent;
  canChat: boolean;
  onOpenChat?: (machine: HiveMachine, agent: HiveAgent) => void;
  onCallAgent?: (machine: HiveMachine, agent: HiveAgent) => void;
  onOpenTaskChat?: (machine: HiveMachine, agent: HiveAgent) => void;
  onOpenWallet?: (machine: HiveMachine, agent: HiveAgent) => void;
  onEditSettings?: (machine: HiveMachine, agent: HiveAgent) => void;
  onDuplicate?: (machine: HiveMachine, agent: HiveAgent) => void;
  onRemove?: (machine: HiveMachine, agent: HiveAgent) => void;
}) {
  const chatIsPrimary = canChat && Boolean(onOpenChat);
  const hasMenuActions = Boolean(
    (canChat && onOpenTaskChat)
      || onOpenWallet
      || onEditSettings
      || onDuplicate
      || onRemove,
  );

  return (
    <div className={styles.actionBar} role="group" aria-label={`Agent actions for ${agent.name}`}>
      <HiveChatCallSplitButton
        name={agent.name}
        onChat={chatIsPrimary && onOpenChat ? () => onOpenChat(machine, agent) : undefined}
        onCall={onCallAgent ? () => onCallAgent(machine, agent) : undefined}
      />

      {hasMenuActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={styles.actionsTrigger} aria-label={`Open actions for ${agent.name}`}>
              <span>Actions</span>
              <ChevronDown aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={7} collisionPadding={12} className={styles.menu}>
            <DropdownMenuLabel className={styles.menuTitle}>{agent.name}</DropdownMenuLabel>
            <DropdownMenuLabel className={styles.menuSection}>Agent controls</DropdownMenuLabel>
            {canChat && onOpenTaskChat ? (
              <MenuAction Icon={MessageSquare} label="Task chat" onSelect={() => onOpenTaskChat(machine, agent)} />
            ) : null}
            {onOpenWallet ? <MenuAction Icon={Wallet} label="Wallet" onSelect={() => onOpenWallet(machine, agent)} /> : null}
            {onEditSettings ? <MenuAction Icon={Settings} label="Settings" onSelect={() => onEditSettings(machine, agent)} /> : null}
            {onDuplicate ? <MenuAction Icon={Copy} label="Duplicate" onSelect={() => onDuplicate(machine, agent)} /> : null}
            {onRemove ? (
              <>
                <DropdownMenuSeparator className={styles.menuSeparator} />
                <MenuAction Icon={Trash2} label="Remove agent" tone="danger" onSelect={() => onRemove(machine, agent)} />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
