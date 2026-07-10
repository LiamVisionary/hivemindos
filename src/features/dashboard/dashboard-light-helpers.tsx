import { Activity, AppWindow, Bell, Bot, Brain, CandlestickChart, Cloud, Cpu, FolderOpen, KanbanSquare, KeyRound, Landmark, Layers3, MessageSquare, Network, PhoneCall, PlugZap, Repeat2, Search, ShieldCheck, Sparkles, WalletCards, Wrench } from "lucide-react";

import { beeRoleIconPath } from "@/lib/config/bee-role-icons";
import { RUNTIME_LABELS, type AgentProfile, type BeeWorkerClass } from "@/lib/types/agent-runtime";
import { KANBAN_COLUMNS, type KanbanTask } from "@/lib/types/kanban";
import { beeWorkerClassLabel, chooseBeeAssignment } from "@/lib/services/orchestration/bee-roles";
import { agentAliasMap, agentWorkspaceKey } from "@/features/fleet/fleet-identity";
import { attachmentSizeLabel, linkedDirectoryLabel } from "@/features/chat/chat-formatters";
import { runtimeCan } from "@/features/dashboard/dashboard-storage";
import { parseTaskBrief, taskBriefHeadline } from "@/features/dashboard/kanban-result-format";
import type { AgentTask, ChatMessage, ChatTreeItem, DashboardView, MachineGroup } from "@/features/dashboard/dashboard-types";

const STARTER_AGENT_IDS = new Set([
  "openclaw-main",
  "hermes-orchestrator",
  "hermes-seo",
  "hermes-cmo",
  "hermes-dev",
  "hermes-ops",
  "hermes-life",
  "aeon-1",
]);

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function formatDurationShort(ms: number) {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatMessageTimestamp(timestamp?: number) {
  if (!timestamp) return "time unknown";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function inferCurrentTask(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "No task yet";
}

export function inferLatestAgentMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant")?.content
    || "No agent response yet.";
}

export function workspaceLabelFromPath(path?: string) {
  const trimmed = path?.trim();
  if (!trimmed) return "Stray chats";
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  if (withoutTrailingSlash === "~" || withoutTrailingSlash === "$home") return "Home";
  return withoutTrailingSlash.split("/").filter(Boolean).at(-1) ?? withoutTrailingSlash;
}

export function parentPathFromPath(path?: string) {
  const trimmed = path?.trim().replace(/\/+$/, "");
  if (!trimmed || trimmed === "~" || trimmed === "$home") return "~";
  const pieces = trimmed.split("/").filter(Boolean);
  if (trimmed.startsWith("~/")) return pieces.length > 1 ? `~/${pieces.slice(0, -1).join("/")}` : "~";
  if (!trimmed.startsWith("/")) return pieces.length > 1 ? pieces.slice(0, -1).join("/") : ".";
  return pieces.length > 1 ? `/${pieces.slice(0, -1).join("/")}` : "/";
}

export function chatFolderLabel(agent: AgentProfile, machine: MachineGroup) {
  return workspaceLabelFromPath(machine.version?.appDir || agent.localDataDir);
}

export function chatDedupeKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 96);
}

export function chatPreviewDedupeKey(title: string, subtitle: string) {
  return `${chatDedupeKey(title)}:${chatDedupeKey(subtitle).slice(0, 80)}`;
}

export function preferChatTreeItem(current: ChatTreeItem | undefined, candidate: ChatTreeItem) {
  if (!current) return candidate;
  if (candidate.active !== current.active) return candidate.active ? candidate : current;
  if (candidate.rank !== current.rank) return candidate.rank > current.rank ? candidate : current;
  return (candidate.updatedAt ?? 0) > (current.updatedAt ?? 0) ? candidate : current;
}

export function chatSetupIssue(agent: AgentProfile) {
  if (!runtimeCan(agent, "chat")) {
    return `${RUNTIME_LABELS[agent.runtime]} is a background/runtime adapter here. Use Scheduler, runs, or skills instead of Chat.`;
  }
  if (STARTER_AGENT_IDS.has(agent.id) && agent.runtime !== "openclaw" && !agent.telemetryUrl?.trim()) {
    return "This starter shortcut is not connected to a running chat runtime. Pick a discovered machine agent or connect a real chat URL.";
  }
  if (agent.runtime === "openclaw") {
    return agent.gatewayUrl.trim() ? "" : "Add the OpenClaw gateway URL before chatting.";
  }
  if (agent.runtime === "hermes" && agent.telemetryUrl?.trim() && agent.collectorCapabilities?.chat === false) {
    return `${agent.machineName || "This Mac"} is connected, but its local agent bridge does not have the Hermes chat bridge installed yet. Run setup/update on that machine after these dashboard changes are available there.`;
  }
  if (!agent.gatewayUrl.trim()) {
    if (agent.runtime === "hermes" && agent.telemetryUrl?.trim()) return "";
    return agent.telemetryUrl
      ? "This agent was found through a local agent bridge. Add its runtime chat URL in setup before sending messages."
      : "Add the runtime chat URL before sending messages.";
  }
  return "";
}

export function kanbanCardMessage(task: KanbanTask) {
  const body = task.body?.trim();
  if (body) {
    // Control-plane dispatch briefs lead with routing metadata; the card
    // preview should show the actual request instead (full brief renders
    // structured in the conversation modal).
    const brief = parseTaskBrief(body);
    const headline = brief ? taskBriefHeadline(brief) : "";
    return headline || body;
  }

  const result = task.result?.trim();
  if (!result) return "No task body yet.";

  const compact = result.replace(/\s+/g, " ");
  if (/produced terminal\/tool output but has not sent a final agent response/i.test(result)) {
    return result.split(/\n\n+/)[0] ?? compact;
  }
  const looksLikeToolDump = /^{["{[]|^\[Subdirectory context discovered:|#\s+Project Rules|AGENTS\.md|total_count/i.test(result);
  if (looksLikeToolDump || result.length > 280) {
    return compact.startsWith("Dispatch reached")
      ? result
      : "Agent produced a long diagnostic output. Open the task for the full notes.";
  }

  return result;
}

export function isKanbanTerminalMessage(text: string) {
  const trimmed = text.trim();
  return /^[$>]\s+\S/.test(trimmed)
    || /\n[$>]\s+\S/.test(trimmed)
    || /^>\s*[\w@.-]+/.test(trimmed)
    || /\s>\s+(?:tsc|pnpm|npm|yarn|node|git|curl|bash)\b/i.test(trimmed)
    || /^(?:pnpm|npm|yarn|node|git|curl|bash|tsc)\b/i.test(trimmed);
}

export const KANBAN_STEER_TARGETS = KANBAN_COLUMNS.filter((column) => (
  column.id !== "needs-human" && column.id !== "archived"
));

export function kanbanTaskBee(task: KanbanTask, agents: AgentProfile[]) {
  if (task.status === "ready") {
    return {
      icon: beeRoleIconPath("queen"),
      roleLabel: "Queen Bee",
      assignee: "Waiting for pickup",
    };
  }
  const assignee = task.assignee?.trim();
  const agent = assignee
    ? agents.find((item) => item.name === assignee || item.id === assignee || item.agentId === assignee)
    : undefined;
  if (task.status === "done") {
    const completedBy = agent?.name || assignee || "user";
    const completedByQueen = agent?.beeRole === "queen";
    return {
      icon: agent ? beeRoleIconPath(completedByQueen ? "queen" : "worker", agent.workerClass ?? "general") : "",
      roleLabel: "Completed by:",
      assignee: completedBy,
    };
  }
  const queen = task.tenant === "queen-bee" || agent?.beeRole === "queen";
  const workerClass = agent?.workerClass
    ?? (task.tenant?.endsWith("-worker") ? task.tenant.replace(/-worker$/, "") as BeeWorkerClass : undefined);
  const roleLabel = queen ? "Queen bee" : `${beeWorkerClassLabel(workerClass)} worker bee`;
  return {
    icon: beeRoleIconPath(queen ? "queen" : "worker", workerClass ?? "general"),
    roleLabel,
    assignee: assignee || "Unassigned",
  };
}

export function kanbanEventLabel(kind: string) {
  const labels: Record<string, string> = {
    "board.migrated": "Board migrated",
    "comment.created": "Comment added",
    "task.created": "Task created",
    "task.moved": "Moved",
    "task.updated": "Updated",
  };
  return labels[kind] ?? kind
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function kanbanTaskDispatchPrompt(task: KanbanTask, assignment: ReturnType<typeof chooseBeeAssignment>) {
  const attachmentDetails = [
    task.linkedDirectories?.length ? ["Linked directories:", ...task.linkedDirectories.map((directory) => `- ${linkedDirectoryLabel(directory)}`)].join("\n") : "",
    task.attachments?.length ? [
      "Attached files/images:",
      ...task.attachments.map((attachment) => `- ${attachment.kind}: ${attachment.name} (${attachment.mimeType || "unknown"}, ${attachmentSizeLabel(attachment.size)})`),
    ].join("\n") : "",
  ].filter(Boolean).join("\n\n");
  const undoDetails = task.undoRequestedAt
    ? [
      "Undo request:",
      "Reverse only the work performed for this Kanban task. Do not roll back unrelated user or agent changes.",
      "Inspect the current workspace and the task notes, then make the smallest targeted reversal you can.",
      "If you cannot identify the task-specific changes safely, stop and explain exactly what human input is needed.",
    ].join("\n")
    : "";
  const needsVisualHandoff = assignment.workerClass !== "artist"
    && /\b(image|visual|illustration|graphic|artwork|asset|thumbnail|poster|banner|hero|linkedin post|social post)\b/i.test(`${task.title}\n${task.body ?? ""}`);
  return [
    "You are receiving an automated Kanban assignment from the Queen Bee orchestrator.",
    `Task: ${task.title}`,
    undoDetails,
    task.body ? `Task details:\n${task.body}` : "Task details: none provided.",
    task.targetMachine?.name ? `Target machine: ${task.targetMachine.name}` : "Target machine: Any machine.",
    attachmentDetails,
    task.result ? `Existing notes:\n${task.result}` : "",
    `Suggested worker class: ${beeWorkerClassLabel(assignment.workerClass)}.`,
    task.undoRequestedAt
      ? "This is an explicit undo request. Treat the previous completed change for this task as the target and reverse it narrowly, even if existing notes say the original task was verified or completed."
      : "Treat existing notes as authoritative retry context when they say an old expectation was superseded, removed, or already verified. Do not undo a verified dashboard change just to satisfy a stale task title.",
    needsVisualHandoff
      ? "If your result creates writing, research, planning, or QA context for a downstream visual/image task, include a final section named exactly `VISUAL_BRIEF:` with the prompt an artist agent should use. Do not create the image yourself unless you are the artist worker."
      : "",
    "Complete the task as far as your runtime/tools allow. End with a concise result summary and any evidence.",
    "If you are blocked on human input, access, approval, or a decision, end your result with a section named exactly `ACTION NEEDED:` containing one or two imperative sentences telling the human precisely what to do or decide (include the options if there is a choice). This section becomes the card's headline on the Work Board.",
    "When it helps the human act faster, add extra lines directly under `ACTION NEEDED:` — `LINK: <url>` pointing where they get or do the thing (for an API key, the exact page that issues it), `OPTIONS: <choice A> | <choice B>` when you need a decision, and `NEEDS: api-key <ENV_VAR_NAME>` (or `NEEDS: file` / `NEEDS: text`) naming what you are waiting for. The Work Board renders these as one-click answer buttons, a save-to-shared-env key input, or an attach-a-file prompt, and the human's answer comes back to you on this task.",
  ].filter(Boolean).join("\n\n");
}

export function kanbanTaskInterruptPrompt(task: KanbanTask, previousTitle: string, previousBody: string) {
  return [
    "Interrupt your current work on this Kanban task and switch to the revised task below.",
    "Treat this as replacing the prior assignment. Do not spawn or wait for another agent.",
    previousTitle !== task.title || previousBody !== task.body
      ? [
        "Previous task:",
        `Title: ${previousTitle}`,
        previousBody ? `Details:\n${previousBody}` : "Details: none provided.",
      ].join("\n")
      : "",
    "Revised task:",
    `Title: ${task.title}`,
    task.body ? `Details:\n${task.body}` : "Details: none provided.",
    task.result ? `Existing notes:\n${task.result}` : "",
    "Continue immediately with the revised work. If you were already working on the old version, abandon that path unless it still applies to this revised version.",
  ].filter(Boolean).join("\n\n");
}

export function simpleStableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function extractKanbanVisualBrief(text: string) {
  const match = text.match(/(?:^|\n)\s*VISUAL[\s_-]*BRIEF\s*:\s*([\s\S]*?)(?=\n\s*(?:[A-Z][A-Z0-9_ -]{2,}|Resume this session with|Session|Duration|Messages|---RESULT_LENGTH---)\s*:|\n\s*╰|$)/i);
  const brief = match?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return brief.length > 20 ? brief.slice(0, 2000) : "";
}

export function kanbanReadyPickupSignature(task: KanbanTask, agents: AgentProfile[]) {
  const agentSignature = agents
    .map((agent) => [
      agent.id,
      agent.name,
      agent.beeRole ?? "",
      agent.workerClass ?? "",
      agent.telemetryUrl || agent.gatewayUrl ? "online" : "offline",
    ].join(":"))
    .sort()
    .join("|");
  return `${task.id}:${task.updatedAt}:${agentSignature}`;
}

export function kanbanTaskAssigneeAgent(task: KanbanTask, agents: AgentProfile[]) {
  const assignee = task.assignee?.trim();
  if (!assignee) return undefined;
  const normalizedAssignee = assignee.toLowerCase();
  return agents.find((agent) => {
    // Local-machine display labels differ by OS ("This Mac" / "This PC" /
    // "This computer" — see displayMachineName in fleet-identity). An assignee
    // written with any of them must match an agent whose stored machineName is
    // a local-machine indicator, including default Windows "DESKTOP-…" hostnames.
    const localMachineLabels = ["This Mac", "This PC", "This computer"];
    const thisMachineAliases = agent.machineName && /mac|local|this|desktop|win|computer|\bpc\b/i.test(agent.machineName)
      ? localMachineLabels.flatMap((label) => [
        `${agent.name} on ${label}`,
        agent.agentId ? `${agent.agentId} on ${label}` : "",
        `${agent.runtime} on ${label}`,
      ])
      : [];
    const candidates = [
      agent.id,
      agent.agentId,
      agent.name,
      agent.machineName ? `${agent.name} on ${agent.machineName}` : "",
      agent.machineName && agent.agentId ? `${agent.agentId} on ${agent.machineName}` : "",
      agent.machineName ? `${agent.runtime} on ${agent.machineName}` : "",
      ...thisMachineAliases,
    ].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
    return candidates.includes(normalizedAssignee);
  });
}

export function kanbanTaskAssignmentForAgent(task: KanbanTask, agent: AgentProfile): ReturnType<typeof chooseBeeAssignment> {
  const fallback = chooseBeeAssignment(task, [agent]);
  return {
    ...fallback,
    queen: agent.beeRole === "queen" ? agent : fallback.queen,
    worker: agent,
    mode: agent.beeRole === "queen" ? "queen" : "worker",
    reason: `${agent.name} was already assigned on the Work board, so this is a retry of the claimed task.`,
  };
}

export function viewIcon(view: DashboardView) {
  if (view === "agents") return <Network aria-hidden="true" />;
  if (view === "kanban") return <KanbanSquare aria-hidden="true" />;
  if (view === "scheduler") return <Repeat2 aria-hidden="true" />;
  if (view === "swarm") return <Activity aria-hidden="true" />;
  if (view === "history") return <KanbanSquare aria-hidden="true" />;
  if (view === "wallet") return <WalletCards aria-hidden="true" />;
  if (view === "trade") return <CandlestickChart aria-hidden="true" />;
  if (view === "vault") return <Brain aria-hidden="true" />;
  if (view === "integrations") return <PlugZap aria-hidden="true" />;
  if (view === "maintenance") return <ShieldCheck aria-hidden="true" />;
  if (view === "sessions") return <Search aria-hidden="true" />;
  if (view === "tools") return <Wrench aria-hidden="true" />;
  if (view === "memory") return <Cpu aria-hidden="true" />;
  if (view === "files") return <FolderOpen aria-hidden="true" />;
  if (view === "notifications") return <Bell aria-hidden="true" />;
  if (view === "more") return <Layers3 aria-hidden="true" />;
  if (view === "env") return <KeyRound aria-hidden="true" />;
  if (view === "my-apps") return <AppWindow aria-hidden="true" />;
  if (view === "phone") return <PhoneCall aria-hidden="true" />;
  if (view === "aeon") return <Bot aria-hidden="true" />;
  if (view === "fusion") return <Sparkles aria-hidden="true" />;
  if (view === "governance") return <Landmark aria-hidden="true" />;
  if (view === "cloud") return <Cloud aria-hidden="true" />;
  if (view === "compute") return <Cpu aria-hidden="true" />;
  return <MessageSquare aria-hidden="true" />;
}

export function dedupeAgents(configuredAgents: AgentProfile[], autoDiscoveredAgents: AgentProfile[]) {
  const aliases = agentAliasMap(configuredAgents, autoDiscoveredAgents);
  const configured = configuredAgents.map((agent) => {
    const live = autoDiscoveredAgents.find((candidate) => aliases.get(candidate.id) === agent.id);
    if (!live) return agent;
    return {
      ...live,
      ...agent,
      telemetryUrl: live.telemetryUrl || agent.telemetryUrl,
      machineName: live.machineName || agent.machineName,
      collectorCapabilities: live.collectorCapabilities ?? agent.collectorCapabilities,
      runtimeKind: live.runtimeKind ?? agent.runtimeKind,
      runtimeCapabilities: live.runtimeCapabilities ?? agent.runtimeCapabilities,
    };
  });
  const configuredKeys = new Set(configured.map(agentWorkspaceKey));
  return [
    ...configured,
    ...autoDiscoveredAgents.filter((agent, index, list) => {
      const key = agentWorkspaceKey(agent);
      return !aliases.has(agent.id)
        && !configuredKeys.has(key)
        && list.findIndex((item) => agentWorkspaceKey(item) === key) === index;
    }),
  ];
}

export function isRuntimeSetupNoise(text: string) {
  return /not reachable|Chat URL needed|runtime chat URL|Request failed with 500|fetch failed|Check that the .* runtime is running/i.test(text);
}

export function isSlowDelegationMessage(text: string) {
  return /did not produce a response before the dashboard timeout|operation was aborted due to timeout|timeout/i.test(text)
    && !/Chat URL needed|runtime chat URL|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(text);
}

export function isTransientDelegationMessage(text: string) {
  return isSlowDelegationMessage(text) || /^Failed to fetch$/i.test(text.trim());
}

export function isHermesAuthFailure(text: string) {
  return /Codex refresh token was already consumed|Run `?codex`?.*Run `?hermes auth`?|hermes auth|Run `?hermes model`?/is.test(text);
}

export function isInternalHermesSessionPrelude(text: string) {
  return /^---\s*name:\s*kanban-worker\b/i.test(text.trim());
}

export function isKanbanAwaitingAgentUpdate(task: KanbanTask) {
  return task.status === "working"
    && Boolean(task.agentSession?.sessionId);
}

export function isStarterPlaceholder(agent: AgentProfile, knownWork: Record<string, AgentTask[]>, knownMessages: Record<string, ChatMessage[]>) {
  if (!STARTER_AGENT_IDS.has(agent.id)) return false;
  if (agent.telemetryUrl?.trim()) return false;
  if (agent.runtime !== "openclaw") return true;
  if (agent.localDataDir?.trim() && agent.localDataDir !== "~/.hermes") return false;
  const work = knownWork[agent.id] ?? [];
  const messages = knownMessages[agent.id] ?? [];
  const meaningfulWork = work.filter((task) => (
    !isRuntimeSetupNoise(task.title)
    && !isRuntimeSetupNoise(task.lastMessage)
  ));
  const nonSystemMessages = messages.filter((message) => message.role !== "system");
  const hasSuccessfulAssistantMessage = nonSystemMessages.some((message) => (
    message.role === "assistant"
    && !isRuntimeSetupNoise(message.content)
  ));
  if (meaningfulWork.length > 0) return false;
  if (hasSuccessfulAssistantMessage) return false;
  return true;
}
