import Image from "next/image";
import { Copy, Eye, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import { cleanActivityTitle } from "@/features/chat/chat-composer";
import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import { RUNTIME_LABELS, type AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentTask, ChatMessage, HiveEnvImportEntry, RuntimeModelSelection } from "@/features/dashboard/dashboard-types";

const HERMES_EMPTY_TRANSCRIPT_MESSAGE = "Hermes session found. Send a message to resume it.";
const runtimeLabels = RUNTIME_LABELS as Record<string, string>;

export function sourcePriority(source?: string) {
  if (source === "hermes-state") return 8;
  if (source === "runtime-status") return 7;
  if (source?.startsWith("task-bus")) return 6;
  if (source === "dashboard-chat") return 5;
  if (source?.includes("/tasks") || source?.includes("/inbox") || source?.includes("/outbox")) return 4;
  if (source?.includes("/cron")) return 2;
  if (source?.includes("/logs") || source?.includes("/sessions")) return 0;
  return 1;
}

export function workPriority(task: AgentTask) {
  const statusBoost = task.status === "active" ? 20 : task.status === "failed" ? 15 : 0;
  return statusBoost + sourcePriority(task.source);
}

export function isMeaningfulActive(task: AgentTask) {
  return task.status === "active" && sourcePriority(task.source) >= 4;
}

export function isCronChatTask(task: AgentTask) {
  if (task.source?.includes("/cron")) return true;
  if (/(cron|schedul|automation|background)/i.test(task.sourceDetail ?? "")) return true;
  const transcript = [
    task.title,
    task.lastMessage,
    ...(task.messages ?? []).slice(0, 3).map((message) => message.content),
  ].join("\n");
  if (/\[IMPORTANT:\s*The user has invoked the "[^"]+" skill/i.test(transcript)) return true;
  if (/running as a scheduled cron job/i.test(transcript)) return true;
  if (/user has invoked the "[^"]+" skill/i.test(transcript)) return true;
  return /^hermes\s+cron\s+session$/i.test(cleanActivityTitle(task.title));
}

export function isChatSidebarTask(task: AgentTask) {
  if (isCronChatTask(task)) return false;
  return task.source === "hermes-state" || task.source === "dashboard-chat";
}

export function chatSeedMessagesForTask(task: AgentTask): ChatMessage[] {
  if (task.messages?.some((message: ChatMessage) => message.content.trim())) return task.messages;
  if (task.source === "hermes-state") return [];
  const placeholderOnly = !task.lastMessage
    || task.lastMessage === HERMES_EMPTY_TRANSCRIPT_MESSAGE
    || /no readable message was stored/i.test(task.lastMessage);
  return [
    {
      role: "system" as const,
      content: placeholderOnly
        ? `Resuming ${task.title || "previous chat"} from Hermes session metadata. The session id is available, but the dashboard could not display prior Hermes messages yet. Send the next message to continue this runtime session.`
        : `Resuming ${task.title || "previous chat"} from recent agent bridge metadata.`,
    },
    placeholderOnly
      ? {
        role: "assistant" as const,
        content: `I found the runtime session for "${task.title || "previous chat"}", but there were no readable prior messages to display yet. Send the next message to continue this session.`,
      }
      : { role: "assistant" as const, content: task.lastMessage },
  ];
}

export function taskChatLeafKey(agentId: string, task: AgentTask, taskIndex = 0) {
  return `task-${agentId}-${task.id}-${task.source ?? "unknown"}-${task.updatedAt || task.startedAt || taskIndex}`;
}

export function runtimeSessionIdFromTask(task: AgentTask) {
  if (task.source !== "hermes-state") return "";
  return task.id.startsWith("hermes-state:") ? task.id.slice("hermes-state:".length) : "";
}

export const hermesRuntimeSessionIdFromTask = runtimeSessionIdFromTask;

export function chatMessageStorageKey(agentId: string, leafKey?: string) {
  if (!leafKey || leafKey === `agent-${agentId}`) return agentId;
  return `${agentId}::${leafKey}`;
}

export function chatLeafFromStorageKey(agentId: string, storageKey: string) {
  return storageKey === agentId ? `agent-${agentId}` : storageKey.startsWith(`${agentId}::`) ? storageKey.slice(agentId.length + 2) : "";
}

export function createChatLeafKey(agentId: string, base = "agent") {
  return `${base}-${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function runtimeSessionForChat(agent: AgentProfile, leafKey: string, runtimeSessionId = "") {
  if (runtimeSessionId.trim()) return runtimeSessionId.trim();
  if (agent.runtime !== "openclaw") return "";
  const normalized = leafKey || `agent-${agent.id}`;
  return `agent:${agent.agentId || agent.id}:chat:${normalized.replace(/[^A-Za-z0-9:_-]+/g, "-")}`;
}

export function parseAgentEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = rest.join("=").trim();
  }
  return env;
}

export function formatAgentEnvText(env?: Record<string, string>) {
  return Object.entries(env ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function chatTaskMatchKey(value: string) {
  return cleanActivityTitle(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findRosterChatTask(agentWork: AgentTask[], displayedTask?: string) {
  const displayedKey = chatTaskMatchKey(displayedTask ?? "");
  const indexedTasks = agentWork.map((task, index) => ({ task, index }));
  const chatTasks = indexedTasks.filter(({ task }) => isChatSidebarTask(task));
  const matchingTaskById = displayedTask
    ? chatTasks.find(({ task }) => task.id === displayedTask)
    : undefined;
  if (matchingTaskById) return matchingTaskById;
  const matchingTask = displayedKey
    ? chatTasks.find(({ task }) => chatTaskMatchKey(task.title) === displayedKey)
      ?? chatTasks.find(({ task }) => chatTaskMatchKey(task.title).includes(displayedKey) || displayedKey.includes(chatTaskMatchKey(task.title)))
    : undefined;
  if (matchingTask) return matchingTask;
  return chatTasks.find(({ task }) => task.source === "hermes-state")
    ?? chatTasks.find(({ task }) => task.source !== "dashboard-chat")
    ?? chatTasks[0]
    ?? null;
}

export function parseEnvImportText(text: string, currentValues: Record<string, string>): { entries: HiveEnvImportEntry[]; error: string } {
  const values = new Map<string, string>();
  const invalid: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.replace(/^export\s+/, "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      invalid.push(key || rawKey);
      continue;
    }
    let value = rest.join("=").trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === "\"" || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  const entries = Array.from(values.entries())
    .map(([key, value]) => ({
      key,
      value,
      status: currentValues[key] === undefined ? "new" : currentValues[key] === value ? "same" : "changed",
    } satisfies HiveEnvImportEntry))
    .sort((left, right) => left.key.localeCompare(right.key));
  return {
    entries,
    error: invalid.length ? `Skipped ${invalid.length} invalid key${invalid.length === 1 ? "" : "s"}.` : "",
  };
}

export function randomEnvSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type EnvValueRowProps = {
  name: string;
  value: string;
  revealKey: string;
  revealed: boolean;
  saving?: boolean;
  onToggleReveal: (key: string) => void;
  onSave: (value: string) => void;
  onRemove: () => void;
  extraAction?: ReactNode;
  editable?: boolean;
};

export function EnvValueRow({
  name,
  value,
  revealKey,
  revealed,
  saving,
  onToggleReveal,
  onSave,
  onRemove,
  extraAction,
  editable = true,
}: EnvValueRowProps) {
  return (
    <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.10)] bg-[rgba(2,6,23,0.35)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="break-all text-xs text-[var(--foreground)]">{name}</code>
        <div className="flex flex-wrap gap-1">
          {editable ? extraAction : null}
          <Button type="button" size="icon" variant="ghost" aria-label={`${revealed ? "Hide" : "Reveal"} ${name}`} title={revealed ? "Hide value" : "Reveal value"} onClick={() => onToggleReveal(revealKey)}>
            <Eye aria-hidden="true" />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Copy ${name}`} title="Copy value" onClick={() => navigator.clipboard?.writeText(value)}>
            <Copy aria-hidden="true" />
          </Button>
          {editable ? (
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}>
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      <input
        key={`${revealKey}:${value}`}
        {...secretInputProps}
        defaultValue={value}
        disabled={saving || !editable}
        onBlur={(event) => {
          if (editable) onSave(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = value;
            event.currentTarget.blur();
          }
        }}
        className={`min-w-0 rounded-sm border border-[rgba(148,163,184,0.14)] px-2 py-1 font-mono text-xs outline-none focus:border-[rgba(94,234,212,0.45)] focus:text-[var(--foreground)] ${revealed ? "" : maskedSecretValueClass} ${editable ? "bg-[rgba(15,23,42,0.72)] text-[var(--muted)]" : "bg-[rgba(148,163,184,0.10)] text-[rgba(148,163,184,0.72)]"}`}
      />
      {saving ? <small className="text-[var(--muted)]">Saving...</small> : null}
    </div>
  );
}

export type AgentEnvCardProps = {
  agent: AgentProfile;
  renderKey: string;
  entries: Array<[string, string]>;
  draft: { key: string; value: string };
  runtimeModelSelection?: RuntimeModelSelection;
  revealedEnvValues: Record<string, boolean>;
  onToggleReveal: (key: string) => void;
  onSave: (key: string, value: string, previousValue: string) => void;
  onRemove: (key: string, previousValue: string) => void;
  onDraftChange: (draft: { key: string; value: string }) => void;
  onAdd: () => void;
};

export function AgentEnvCard({
  agent,
  renderKey,
  entries,
  draft,
  runtimeModelSelection,
  revealedEnvValues,
  onToggleReveal,
  onSave,
  onRemove,
  onDraftChange,
  onAdd,
}: AgentEnvCardProps) {
  const icon = beeRoleIconPath(agent.beeRole, agent.workerClass);
  const providerSlug = agent.provider?.trim() || runtimeModelSelection?.provider?.trim() || "";
  const providerMatch = runtimeModelSelection?.providers.find((provider) => provider.slug === providerSlug);
  const modelId = agent.model?.trim() || runtimeModelSelection?.model?.trim() || "";
  const modelMatch = providerMatch?.models.find((model) => model.id === modelId);
  const providerLabel = providerMatch?.name || providerSlug || runtimeLabels[agent.runtime];
  const modelLabel = modelMatch?.name || modelId || "Model not set";
  return (
    <article className="grid gap-4 rounded-md border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(135deg,rgba(10,14,21,0.86),rgba(5,8,13,0.74))] p-4" data-agent-card={renderKey}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-md border border-[rgba(94,234,212,0.24)] bg-[rgba(20,184,166,0.10)]">
          <Image src={icon} alt="" width={42} height={42} aria-hidden="true" unoptimized />
        </div>
        <div className="min-w-0">
          <strong className="block break-words text-base">{agent.name}</strong>
          <p className="m-0 mt-1 break-words text-xs text-[var(--muted)]">
            {providerLabel} · {modelLabel}
          </p>
          <p className="m-0 mt-1 break-words text-xs text-[var(--muted)]">
            {runtimeLabels[agent.runtime]} · {agent.agentId || agent.id}
          </p>
        </div>
        <span className="rounded-full border border-[rgba(148,163,184,0.18)] px-2 py-1 font-mono text-xs text-[var(--muted)]">{entries.length}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-2">
        <input
          value={draft.key}
          onChange={(event) => onDraftChange({ ...draft, key: event.target.value })}
          placeholder="KEY"
          className="min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)]"
        />
        <input
          {...secretInputProps}
          value={draft.value}
          onChange={(event) => onDraftChange({ ...draft, value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAdd();
          }}
          placeholder="value"
          className={`min-w-0 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.72)] px-2 py-2 font-mono text-xs text-[var(--foreground)] outline-none focus:border-[rgba(94,234,212,0.45)] ${maskedSecretValueClass}`}
        />
        <Button type="button" size="icon" variant="secondary" aria-label={`Add env for ${agent.name}`} title="Add env" onClick={onAdd}>
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <div className="grid gap-2">
        {entries.length ? entries.map(([key, value]) => {
          const revealKey = `agent:${agent.id}:${key}`;
          return (
            <EnvValueRow
              key={key}
              name={key}
              value={value}
              revealKey={revealKey}
              revealed={Boolean(revealedEnvValues[revealKey])}
              onToggleReveal={onToggleReveal}
              onSave={(nextValue) => onSave(key, nextValue, value)}
              onRemove={() => onRemove(key, value)}
            />
          );
        }) : (
          <p className="m-0 rounded-md border border-dashed border-[rgba(148,163,184,0.18)] p-3 text-xs text-[var(--muted)]">
            No agent-specific env overlay.
          </p>
        )}
      </div>
    </article>
  );
}
