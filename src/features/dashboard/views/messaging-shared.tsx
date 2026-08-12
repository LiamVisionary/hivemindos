"use client";

import { type ButtonHTMLAttributes, type CSSProperties, type ReactNode, useState } from "react";
import Image from "next/image";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type {
  HiveMessagingChannel,
  HiveMessagingProviderMeta,
  HiveMessagingRunState,
} from "@/lib/types/messaging-channels";
import styles from "@/features/dashboard/views/messaging-channels.module.css";

export type MessagingAgentOption = {
  id: string;
  name: string;
  runtime: string;
  sub: string;
  avatar: string;
  isQueen: boolean;
};

export const QUEEN_BEE_AGENT_ID = "queen-bee";

export function agentSubtitle(agent: Pick<AgentProfile, "id" | "runtime" | "beeRole">): string {
  if (agent.id === QUEEN_BEE_AGENT_ID || agent.beeRole === "queen") return "orchestrator · hermes";
  return `worker · ${agent.runtime}`;
}

export function toAgentOption(agent: Pick<AgentProfile, "id" | "name" | "runtime" | "beeRole" | "workerClass">): MessagingAgentOption {
  const isQueen = agent.id === QUEEN_BEE_AGENT_ID || agent.beeRole === "queen";
  return {
    id: agent.id,
    name: agent.name,
    runtime: agent.runtime,
    sub: agentSubtitle(agent),
    avatar: isQueen ? beeRoleIconPath("queen") : beeRoleIconPath(agent.beeRole ?? "worker", agent.workerClass ?? "general"),
    isQueen,
  };
}

export const RUN_STATE_META: Record<HiveMessagingRunState, { text: string; tone: HiveMessagingRunState }> = {
  live: { text: "Live", tone: "live" },
  enabled: { text: "Enabled", tone: "enabled" },
  paused: { text: "Paused", tone: "paused" },
  attention: { text: "Needs key", tone: "attention" },
};

export function channelRunState(channel: HiveMessagingChannel): HiveMessagingRunState {
  if (channel.runState) return channel.runState;
  if (channel.readOnly) return "live";
  if (!channel.enabled) return "paused";
  if (channel.credentialConfigured === false) return "attention";
  return "enabled";
}

export function channelEndpoint(channel: HiveMessagingChannel): string {
  const base = `${channel.provider}:${channel.target.chatId || "…"}`;
  return channel.target.threadId ? `${base}:${channel.target.threadId}` : base;
}

/** One line describing the last delivery attempt, for the inspector / chips. */
export function deliveryStatusLine(channel: HiveMessagingChannel): { text: string; tone: DotTone } {
  if (channel.readOnly) return { text: "Bridged from Hermes — delivering", tone: "live" };
  if (!channel.enabled) return { text: "Paused by you", tone: "muted" };
  if (channel.credentialConfigured === false) {
    const missing = channel.missingCredentials?.length ? channel.missingCredentials.join(", ") : "credential";
    return { text: `Needs ${missing}`, tone: "attention" };
  }
  if (channel.lastTestStatus === "ok") return { text: `Delivered ${relativeTime(channel.lastTestAt)}`, tone: "ok" };
  if (channel.lastTestStatus === "error") return { text: `Failed · ${channel.lastTestMessage || "delivery error"}`, tone: "error" };
  return { text: "Not tested yet", tone: "muted" };
}

export function relativeTime(iso?: string): string {
  if (!iso) return "recently";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "recently";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export type DotTone = HiveMessagingRunState | "ok" | "error" | "muted";

export function StatusDot({ tone }: { tone: DotTone }) {
  return <span className={styles.dot} data-tone={tone} aria-hidden="true" />;
}

export function ProviderTile({ meta, size }: { meta: HiveMessagingProviderMeta; size: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? styles.provSm : size === "lg" ? styles.provLg : styles.provMd;
  return (
    <span className={cn(styles.provTile, sizeClass)} style={{ "--tile": meta.color } as CSSProperties} aria-hidden="true">
      {meta.mono}
    </span>
  );
}

export function BeeHex({ avatar, small }: { avatar: string; small?: boolean }) {
  const dim = small ? 22 : 42;
  return (
    <span className={cn(styles.hex, small && styles.hexSm)} aria-hidden="true">
      <span className={styles.hexBorder} />
      <span className={styles.hexInner}>
        <Image src={avatar} alt="" width={dim} height={dim} unoptimized style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </span>
    </span>
  );
}

const CAP_LABELS: Record<string, string> = {
  text: "Text",
  images: "Images",
  files: "Files",
  voice: "Voice",
  threads: "Threads",
  reactions: "Reactions",
  typing: "Typing",
  streaming: "Streaming",
};

export function capabilityLabels(meta?: HiveMessagingProviderMeta): string[] {
  return (meta?.capabilities ?? []).map((cap) => CAP_LABELS[cap] ?? cap);
}

type HiveButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "default" | "sm" | "icon" | "iconSm";
};

/** Hivemind accent primary pill button in the hive language (matches the design system). */
export function HiveButton({ variant = "primary", size = "default", className, type, children, ...props }: HiveButtonProps) {
  const variantClass = variant === "secondary" ? styles.btnSecondary
    : variant === "outline" ? styles.btnOutline
    : variant === "ghost" ? styles.btnGhost
    : styles.btnPrimary;
  const sizeClass = size === "sm" ? styles.btnSm
    : size === "icon" ? styles.btnIcon
    : size === "iconSm" ? styles.btnIconSm
    : undefined;
  return (
    <button type={type ?? "button"} className={cn(styles.btn, variantClass, sizeClass, className)} {...props}>
      {children}
    </button>
  );
}

/** Warm copyable endpoint line (the hive-themed CopyableCodeLine). */
export function Endpoint({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={styles.endpoint}>
      <code className={styles.endpointCode}>{value}</code>
      <HiveButton variant="secondary" size="iconSm" onClick={copy} aria-label={copied ? "Copied" : "Copy endpoint"} title="Copy">
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </HiveButton>
    </div>
  );
}

export type ButtonChildren = ReactNode;
