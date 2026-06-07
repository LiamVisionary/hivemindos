import type { AgentProfile, BeeWorkerClass, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { beeWorkerPreset } from "@/lib/config/bee-worker-presets";
import { beeWorkerClassLabel, inferWorkerClass } from "@/lib/services/orchestration/bee-roles";
import { runtimeCan } from "@/features/dashboard/dashboard-storage";
import { parseRuntimeSsePayload, responseErrorMessage, runtimeErrorMessage } from "./runtime-stream-errors";
import { appendCommandMessages, clearComposer, replacePendingReply } from "./dashboard-handoff-command";

type ChatMessage = { role: string; content: string; surface: string };

type SwarmCommandInput = {
  agents: AgentProfile[];
  appOrigin?: string;
  createDefaultAgentWallet: (agentId: string) => AgentWalletConfig;
  honeyLedgerEnabled: boolean;
  prompt: string;
  selectedAgent: AgentProfile;
  selectedChatLeafKey: string;
  selectedStorageKey: string;
  sharedVault: SharedVaultConfig;
  walletsByAgent: Record<string, AgentWalletConfig>;
  workingDirectory?: string;
  appendMessage: (agentId: string, message: ChatMessage, storageKey?: string) => void;
  appendPreviewMessages: (agentId: string, leafKey: string, messages: ChatMessage[]) => void;
  chatSetupIssue: (agent: AgentProfile) => string;
  setText: (value: string) => void;
  setAttachmentError: (value: string) => void;
  setAttachmentMenuOpen: (value: boolean) => void;
  setMessagesByAgent: (updater: (current: any) => any) => void;
  setSelectedChatPreview: (updater: (current: any) => any) => void;
};

type SwarmAgentPlan = {
  agent: AgentProfile;
  workerClass: BeeWorkerClass;
  brief: string;
};

export type ParsedSwarmCommand = {
  requestedAgentCount?: number;
  task: string;
};

const DEFAULT_SWARM_AGENTS = 4;
const MAX_SWARM_AGENTS = 8;
const SWARM_AGENT_TIMEOUT_MS = 120_000;

function commandArgs(prompt: string, command: "swarm" | "swarm-sim") {
  return prompt.replace(new RegExp(`^/${command}\\b`, "i"), "").trim();
}

export function parseSwarmCommand(prompt: string): ParsedSwarmCommand {
  const args = commandArgs(prompt, "swarm");
  const countMatch = args.match(/^(\d{1,2})(?:\s+|$)([\s\S]*)$/);
  if (!countMatch) return { task: args };
  const requestedAgentCount = Math.max(1, Math.min(MAX_SWARM_AGENTS, Number(countMatch[1])));
  return {
    requestedAgentCount,
    task: countMatch[2].trim(),
  };
}

function swarmAgentLimit(requestedAgentCount?: number) {
  if (!Number.isFinite(requestedAgentCount)) return DEFAULT_SWARM_AGENTS;
  return Math.max(1, Math.min(MAX_SWARM_AGENTS, Math.trunc(requestedAgentCount ?? DEFAULT_SWARM_AGENTS)));
}

export function taskWorkerClasses(task: string, requestedAgentCount?: number): BeeWorkerClass[] {
  const primary = inferWorkerClass({ title: task, body: task, skills: [] });
  const text = task.toLowerCase();
  const limit = swarmAgentLimit(requestedAgentCount);
  const classes: BeeWorkerClass[] = ["planner"];
  const add = (workerClass: BeeWorkerClass) => {
    if (!classes.includes(workerClass)) classes.push(workerClass);
  };
  add(primary);
  if (/\b(code|bug|implement|api|repo|typescript|component|test|build|fix)\b/i.test(text)) add("code");
  if (/\b(research|find|compare|latest|source|market|investigate)\b/i.test(text)) add("research");
  if (/\b(write|docs?|copy|summary|article|readme|release note)\b/i.test(text)) add("writer");
  if (/\b(image|visual|design|logo|asset|illustration|art)\b/i.test(text)) add("artist");
  if (/\b(deploy|server|fleet|tailscale|collector|mcp|cron|ops)\b/i.test(text)) add("ops");
  if (/\b(ui|ux|screenshot|inspect|visual qa|screen)\b/i.test(text)) add("vision");
  if (/\b(verify|review|qa|lint|typecheck|playwright|smoke)\b/i.test(text) || primary === "code" || primary === "ops") add("qa");
  for (const fallback of ["general", "research", "writer", "ops", "vision", "artist", "qa", "code"] as BeeWorkerClass[]) {
    if (classes.length >= limit) break;
    add(fallback);
  }
  return classes.slice(0, limit);
}

function normalizedMatchValue(value?: string) {
  return value?.trim().toLowerCase().replace(/\/+$/, "") ?? "";
}

function sameRuntimeNeighborhood(agent: AgentProfile, selectedAgent: AgentProfile) {
  const agentMachine = normalizedMatchValue(agent.machineName);
  const selectedMachine = normalizedMatchValue(selectedAgent.machineName);
  if (agentMachine && selectedMachine && agentMachine === selectedMachine) return true;
  const agentCollector = normalizedMatchValue(agent.telemetryUrl ?? agent.gatewayUrl);
  const selectedCollector = normalizedMatchValue(selectedAgent.telemetryUrl ?? selectedAgent.gatewayUrl);
  return Boolean(agentCollector && selectedCollector && agentCollector === selectedCollector);
}

function hasAgentSetupIssue(agent: AgentProfile, chatSetupIssue?: (agent: AgentProfile) => string) {
  if (!chatSetupIssue) return false;
  try {
    return Boolean(chatSetupIssue(agent));
  } catch {
    return true;
  }
}

function agentDispatchScore(
  agent: AgentProfile,
  workerClass: BeeWorkerClass,
  selectedAgent: AgentProfile,
  usedIds: Set<string>,
  chatSetupIssue?: (agent: AgentProfile) => string,
) {
  if (usedIds.has(agent.id)) return -1;
  if (agent.beeRole === "human" || agent.beeRole === "observer") return -1;
  if (!runtimeCan(agent, "chat")) return -1;
  if (hasAgentSetupIssue(agent, chatSetupIssue)) return -1;
  let score = agent.id === selectedAgent.id ? 6 : 0;
  if (agent.workerClass === workerClass) score += 60;
  if (agent.workerClass === "general") score += 16;
  if (!agent.workerClass) score += 12;
  if (agent.beeRole === "queen" && workerClass === "planner") score += 30;
  if (agent.collectorCapabilities?.chat) score += 20;
  if (agent.telemetryUrl?.trim() || agent.gatewayUrl?.trim()) score += 10;
  if (sameRuntimeNeighborhood(agent, selectedAgent)) score += 70;
  if (/this mac|local/i.test(agent.machineName ?? "")) score += 20;
  return score;
}

export function selectSwarmAgents(input: {
  agents: AgentProfile[];
  chatSetupIssue?: (agent: AgentProfile) => string;
  requestedAgentCount?: number;
  selectedAgent: AgentProfile;
  task: string;
}): SwarmAgentPlan[] {
  const roster = input.agents.some((agent) => agent.id === input.selectedAgent.id)
    ? input.agents
    : [input.selectedAgent, ...input.agents];
  const usedIds = new Set<string>();
  const limit = swarmAgentLimit(input.requestedAgentCount);
  return taskWorkerClasses(input.task, limit).flatMap((workerClass) => {
    if (usedIds.size >= limit) return [];
    const agent = roster
      .map((candidate) => ({ agent: candidate, score: agentDispatchScore(candidate, workerClass, input.selectedAgent, usedIds, input.chatSetupIssue) }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score)[0]?.agent;
    if (!agent) return [];
    usedIds.add(agent.id);
    const preset = beeWorkerPreset(workerClass);
    return [{
      agent,
      workerClass,
      brief: [
        `You are the ${preset.label} in a HivemindOS agent swarm.`,
        preset.taskProfile,
        "Work independently on your part of the task. Return concise, decision-useful output with findings, proposed actions, risks, and verification steps. Do not claim other agents' work as complete.",
      ].join("\n"),
    }];
  });
}

async function readAgentResponse(response: Response) {
  if (!response.ok || !response.body) {
    throw new Error(await responseErrorMessage(response, `Request failed with ${response.status}`));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const eventText of events) {
      const line = eventText.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;
      const parsed = parseRuntimeSsePayload(payload) as { choices?: Array<{ delta?: { content?: string } }>; error?: unknown };
      const runtimeError = runtimeErrorMessage(parsed);
      if (runtimeError) throw new Error(runtimeError);
      text += parsed.choices?.[0]?.delta?.content ?? "";
    }
  }
  return text.trim();
}

async function askSwarmAgent(input: SwarmCommandInput, plan: SwarmAgentPlan, task: string) {
  const response = await fetch("/api/chat/agent-runtime", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hivemind-Run-Type": "swarm-agent",
    },
    signal: swarmAgentTimeoutSignal(),
    body: JSON.stringify({
      agent: plan.agent,
      sharedVault: input.sharedVault,
      workingDirectory: input.workingDirectory || plan.agent.localDataDir || "",
      wallet: input.walletsByAgent[plan.agent.id] ?? input.createDefaultAgentWallet(plan.agent.id),
      honeyLedgerEnabled: input.honeyLedgerEnabled,
      agentMode: "plan",
      messages: [{
        role: "user",
        content: [
          plan.brief,
          "",
          `Swarm task: ${task}`,
          "",
          `Your worker class: ${beeWorkerClassLabel(plan.workerClass)}`,
        ].join("\n"),
      }],
    }),
  });
  return readAgentResponse(response);
}

function swarmAgentTimeoutSignal() {
  const timeout = (AbortSignal as typeof AbortSignal & { timeout?: (milliseconds: number) => AbortSignal }).timeout;
  if (timeout) return timeout(SWARM_AGENT_TIMEOUT_MS);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), SWARM_AGENT_TIMEOUT_MS);
  return controller.signal;
}

function formatSwarmReply(task: string, plans: SwarmAgentPlan[], results: PromiseSettledResult<string>[]) {
  const completed = results.filter((result) => result.status === "fulfilled" && result.value.trim()).length;
  const lines = [
    `## Swarm packet`,
    "",
    `Task: ${task}`,
    `Agents: ${plans.map((plan) => `${plan.agent.name} (${beeWorkerClassLabel(plan.workerClass)})`).join(", ")}`,
    "",
    `Completed: ${completed}/${plans.length}`,
  ];
  plans.forEach((plan, index) => {
    const result = results[index];
    lines.push("", `### ${plan.agent.name} - ${beeWorkerClassLabel(plan.workerClass)}`);
    if (!result || result.status === "rejected") {
      lines.push(`Could not complete this pass: ${result?.reason instanceof Error ? result.reason.message : "runtime request failed"}`);
    } else {
      lines.push(result.value.trim() || "No written response returned.");
    }
  });
  lines.push("", "### Coordinator note", "Use this packet as parallel input. Ask `/swarm` again with a narrower follow-up when you want another multi-agent pass.");
  return lines.join("\n");
}

export async function handleDashboardSwarmCommand(input: SwarmCommandInput) {
  const parsedCommand = parseSwarmCommand(input.prompt);
  const task = parsedCommand.task;
  const userMessage: ChatMessage = { role: "user", content: input.prompt, surface: "chat" };
  if (!task) {
    const assistantMessage: ChatMessage = { role: "assistant", content: "What should the agent swarm work on?", surface: "chat" };
    appendCommandMessages(input, userMessage, assistantMessage);
    clearComposer(input);
    return;
  }

  const plans = selectSwarmAgents({
    agents: input.agents,
    chatSetupIssue: input.chatSetupIssue,
    requestedAgentCount: parsedCommand.requestedAgentCount,
    selectedAgent: input.selectedAgent,
    task,
  });
  if (!plans.length) {
    const assistantMessage: ChatMessage = { role: "assistant", content: "No configured chat-capable worker agents are available for a swarm yet.", surface: "chat" };
    appendCommandMessages(input, userMessage, assistantMessage);
    clearComposer(input);
    return;
  }

  const pendingMessage: ChatMessage = {
    role: "assistant",
    content: `Spawning ${plans.length} swarm agent${plans.length === 1 ? "" : "s"}: ${plans.map((plan) => `${plan.agent.name} (${beeWorkerClassLabel(plan.workerClass)})`).join(", ")}...`,
    surface: "chat",
  };
  appendCommandMessages(input, userMessage, pendingMessage);
  clearComposer(input);
  const results = await Promise.allSettled(plans.map((plan) => askSwarmAgent(input, plan, task)));
  replacePendingReply(input, pendingMessage, formatSwarmReply(task, plans, results));
}

function simStatusUrl(origin: string | undefined, jobId: string) {
  const base = origin?.replace(/\/+$/, "") || "";
  return `${base}/api/miroshark/swarm?job_id=${encodeURIComponent(jobId)}`;
}

export async function handleDashboardSwarmSimCommand(input: SwarmCommandInput) {
  const scenario = commandArgs(input.prompt, "swarm-sim");
  const userMessage: ChatMessage = { role: "user", content: input.prompt, surface: "chat" };
  if (!scenario) {
    const assistantMessage: ChatMessage = { role: "assistant", content: "What scenario should MiroShark simulate?", surface: "chat" };
    appendCommandMessages(input, userMessage, assistantMessage);
    clearComposer(input);
    return;
  }

  const pendingMessage: ChatMessage = { role: "assistant", content: "Launching MiroShark simulation...", surface: "chat" };
  appendCommandMessages(input, userMessage, pendingMessage);
  clearComposer(input);
  try {
    const response = await fetch("/api/miroshark/swarm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario,
        rounds: 5,
        platform: "parallel",
        projectName: `Chat swarm sim - ${scenario.slice(0, 72)}`,
      }),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; jobId?: string; status?: string; step?: string; message?: string; error?: string } | null;
    if (!response.ok || !data?.ok || !data.jobId) {
      throw new Error(data?.error ?? `MiroShark returned HTTP ${response.status}`);
    }
    const payload = {
      title: "MiroShark swarm simulation",
      scenario,
      status: data.status ?? data.step ?? "queued",
      message: data.message,
      jobId: data.jobId,
      statusUrl: simStatusUrl(input.appOrigin, data.jobId),
    };
    replacePendingReply(input, pendingMessage, [
      "MiroShark simulation queued.",
      "",
      "```json",
      JSON.stringify(payload, null, 2),
      "```",
    ].join("\n"));
  } catch (error) {
    replacePendingReply(input, pendingMessage, `MiroShark simulation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
