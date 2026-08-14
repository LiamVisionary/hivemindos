"use client";

import {
  ChevronDown,
  Copy,
  Settings2,
  Trash2,
  Wallet,
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
import { ChatCallSplitButton } from "./chat-call-split-button";
import type { FleetAgent, FleetMachine } from "./fleet-data";
import styles from "./list-view.module.css";

type AgentAction = (machine: FleetMachine, agent: FleetAgent) => void;

export type FleetListAgentActionsProps = {
  machine: FleetMachine;
  agent: FleetAgent;
  onOpenChat?: AgentAction;
  onCallAgent?: AgentAction;
  onOpenWallet?: AgentAction;
  onEditSettings?: AgentAction;
  onDuplicate?: AgentAction;
  onRemove?: AgentAction;
};

function AgentMenuItem({
  Icon,
  label,
  danger = false,
  onSelect,
}: {
  Icon: LucideIcon;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      className={styles.actionMenuItem}
      data-tone={danger ? "danger" : "default"}
      onSelect={onSelect}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </DropdownMenuItem>
  );
}

export function FleetListAgentActions({
  machine,
  agent,
  onOpenChat,
  onCallAgent,
  onOpenWallet,
  onEditSettings,
  onDuplicate,
  onRemove,
}: FleetListAgentActionsProps) {
  const hasMenuActions = Boolean(onOpenWallet || onEditSettings || onDuplicate || onRemove);
  const run = (action?: AgentAction) => action?.(machine, agent);

  return (
    <div
      className={styles.compactActionBar}
      role="group"
      aria-label={`Agent actions for ${agent.name}`}
      onClick={(event) => event.stopPropagation()}
    >
      <ChatCallSplitButton
        name={agent.name}
        chatLabel="New chat"
        onChat={onOpenChat ? () => run(onOpenChat) : undefined}
        onCall={onCallAgent ? () => run(onCallAgent) : undefined}
        singleClassName={styles.primaryAction}
        splitClassName={styles.chatCallSplit}
        chatClassName={styles.chatSegment}
        callClassName={styles.callSegment}
      />

      {hasMenuActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={styles.actionsTrigger}
              aria-label={`Open actions for ${agent.name}`}
            >
              <span>Actions</span>
              <ChevronDown aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={7}
            collisionPadding={12}
            className={styles.actionMenu}
          >
            <DropdownMenuLabel className={styles.actionMenuTitle}>{agent.name}</DropdownMenuLabel>
            <DropdownMenuLabel className={styles.actionMenuSection}>Agent controls</DropdownMenuLabel>
            {onOpenWallet ? <AgentMenuItem Icon={Wallet} label="Wallet" onSelect={() => run(onOpenWallet)} /> : null}
            {onEditSettings ? <AgentMenuItem Icon={Settings2} label="Settings" onSelect={() => run(onEditSettings)} /> : null}
            {onDuplicate ? <AgentMenuItem Icon={Copy} label="Duplicate" onSelect={() => run(onDuplicate)} /> : null}
            {onRemove ? (
              <>
                <DropdownMenuSeparator className={styles.actionMenuSeparator} />
                <AgentMenuItem Icon={Trash2} label="Remove agent" danger onSelect={() => run(onRemove)} />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
