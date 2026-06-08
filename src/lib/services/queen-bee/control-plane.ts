import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { createTask, readBoard } from "@/lib/services/kanban/local-kanban-store";
import { scheduleQueenBeeAutonomousPickup } from "@/lib/services/queen-bee/autonomous-worker";
import { chooseQueenBeeDelegate, type QueenBeeWorkerClass } from "@/lib/services/queen-bee/router";
import { readProjectRegistry } from "@/lib/services/projects/project-registry";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { KanbanPriority } from "@/lib/types/kanban";

export const QUEEN_BEE_FOLDER_NAME = "Queen Bee";
export const QUEEN_BEE_PROTOCOL = "hivemind-queen-bee";

export type QueenBeeOptions = {
  vaultPath?: string | null;
  brainServicesFolder?: string | null;
  kanbanFolder?: string | null;
};

export type QueenBeeMessageInput = QueenBeeOptions & {
  message: string;
  source?: string | null;
  mode?: "act" | "plan" | "route";
  priority?: KanbanPriority;
  taskTitle?: string | null;
  agentId?: string | null;
  machineId?: string | null;
  fleetSnapshot?: QueenBeeFleetMachine[] | null;
};

export type QueenBeeFleetMachine = {
  key?: string;
  collector?: string;
  device?: {
    name?: string;
    dnsName?: string;
    os?: string;
    online?: boolean;
    collectorUrl?: string;
    machineId?: string;
    self?: boolean;
  };
  capabilities?: Record<string, unknown>;
  version?: {
    appDir?: string;
    commit?: string;
    shortCommit?: string;
    branch?: string;
    dirty?: boolean;
    latestCommit?: string;
    latestShortCommit?: string;
    updateCommand?: string;
    projects?: Array<{
      projectId?: string;
      name?: string;
      slug?: string;
      localPath?: string;
      appDir?: string;
      remoteUrl?: string;
      gitlawbRepoId?: string;
      gitlawbRepoName?: string;
      branch?: string;
      commit?: string;
      shortCommit?: string;
      dirty?: boolean;
      latestCommit?: string;
      latestShortCommit?: string;
      updateCommand?: string;
    }>;
    projectCheckouts?: Array<{
      projectId?: string;
      name?: string;
      slug?: string;
      localPath?: string;
      appDir?: string;
      remoteUrl?: string;
      gitlawbRepoId?: string;
      gitlawbRepoName?: string;
      branch?: string;
      commit?: string;
      shortCommit?: string;
      dirty?: boolean;
      latestCommit?: string;
      latestShortCommit?: string;
      updateCommand?: string;
    }>;
  };
  agents?: Array<{
    id?: string;
    agentId?: string;
    name?: string;
    runtime?: string;
    beeRole?: string;
    workerClass?: string;
    machineName?: string;
    telemetryUrl?: string;
    gatewayUrl?: string;
    skillProfilePrompt?: string;
    preferredSkillSlugs?: string[];
    runtimeCapabilities?: Record<string, unknown>;
    collectorCapabilities?: Record<string, unknown>;
  }>;
};

export type QueenBeeState = {
  protocol: typeof QUEEN_BEE_PROTOCOL;
  version: 1;
  identity: "logical-queen-bee";
  status: "ready";
  updatedAt: string;
  workBoard: string;
  memory: string;
  fleet: string;
  handoff: string;
};

type QueenBeePaths = {
  vaultRoot: string;
  brainServicesFolder: string;
  root: string;
  state: string;
  identity: string;
  routingPolicy: string;
  safetyPolicy: string;
  currentState: string;
  intentDedupe: string;
  leases: string;
  receipts: string;
  nodes: string;
  inbox: string;
  outbox: string;
};

export function normalizeQueenBeeFolder(folder?: string | null) {
  const clean = String(folder || DEFAULT_SHARED_VAULT.brainServicesFolder).trim();
  if (!clean || clean.split(/[\\/]+/).includes("..")) {
    throw new Error("Brain services folder must be a relative vault path.");
  }
  return clean.split(/[\\/]+/).filter(Boolean).join(sep);
}

export function resolveQueenBeePaths(options: QueenBeeOptions = {}): QueenBeePaths {
  const vaultRoot = resolveObsidianVaultPath(options.vaultPath || DEFAULT_SHARED_VAULT.vaultPath);
  const brainServicesFolder = normalizeQueenBeeFolder(options.brainServicesFolder);
  const root = join(vaultRoot, brainServicesFolder, QUEEN_BEE_FOLDER_NAME);
  return {
    vaultRoot,
    brainServicesFolder,
    root,
    state: join(root, "state.json"),
    identity: join(root, "Identity.md"),
    routingPolicy: join(root, "Routing Policy.md"),
    safetyPolicy: join(root, "Safety Policy.md"),
    currentState: join(root, "Current State.md"),
    intentDedupe: join(root, "intent-dedupe.jsonl"),
    leases: join(root, "leases.jsonl"),
    receipts: join(root, "receipts.jsonl"),
    nodes: join(root, "nodes"),
    inbox: join(root, "inbox"),
    outbox: join(root, "outbox"),
  };
}

export async function initializeQueenBeeControlPlane(options: QueenBeeOptions = {}) {
  const paths = resolveQueenBeePaths(options);
  await Promise.all([paths.root, paths.nodes, paths.inbox, paths.outbox].map((path) => mkdir(path, { recursive: true })));

  const state = defaultQueenBeeState(options);
  await writeIfMissing(paths.state, `${JSON.stringify(state, null, 2)}\n`);
  await writeIfMissing(paths.identity, queenBeeIdentityMarkdown());
  await writeIfMissing(paths.routingPolicy, queenBeeRoutingPolicyMarkdown());
  await writeIfMissing(paths.safetyPolicy, queenBeeSafetyPolicyMarkdown());
  await writeIfMissing(paths.currentState, queenBeeCurrentStateMarkdown());
  await writeIfMissing(join(paths.nodes, "README.md"), queenBeeNodesReadme());
  await writeIfMissing(join(paths.inbox, "README.md"), "# Queen Bee Inbox\n\nOptional append-only request intake for runtimes that cannot call `/api/queen-bee` directly.\n");
  await writeIfMissing(join(paths.outbox, "README.md"), "# Queen Bee Outbox\n\nOptional response receipts for runtimes that cannot receive live API responses.\n");
  await writeIfMissing(paths.intentDedupe, "");
  await writeIfMissing(paths.leases, "");
  await writeIfMissing(paths.receipts, "");
  return { paths, state };
}

export async function readQueenBeeState(options: QueenBeeOptions = {}) {
  const { paths, state } = await initializeQueenBeeControlPlane(options);
  try {
    const raw = await readFile(paths.state, "utf8");
    return { paths, state: JSON.parse(raw) as QueenBeeState };
  } catch {
    return { paths, state };
  }
}

export async function submitQueenBeeMessage(input: QueenBeeMessageInput) {
  const message = input.message?.trim();
  if (!message) throw new Error("Queen Bee message is required.");

  const { paths, state } = await initializeQueenBeeControlPlane(input);
  const source = input.source?.trim() || "api";
  const mode = input.mode || "act";
  const fingerprint = fingerprintIntent({ message, source, mode });
  const idempotencyKey = `queen-bee:${fingerprint}`;
  const title = input.taskTitle?.trim() || taskTitleFromMessage(message);
  const createdAt = new Date().toISOString();
  const projectRegistry = await readQueenBeeProjectRegistry(input.vaultPath);
  const delegation = chooseQueenBeeDelegate({ title, body: message, skills: [], projectRegistry }, input.fleetSnapshot ?? []);
  const selectedAgentName = delegation.agent?.name || delegation.agent?.id || delegation.agent?.agentId;
  const selectedMachineName = delegation.machine?.device?.name || delegation.machine?.key;

  const result = await createTask(null, {
    title,
    body: queenBeeTaskBody({ message, source, mode, fingerprint, delegation }),
    assignee: selectedAgentName || "queen-bee",
    status: mode === "plan" ? "ideas" : "ready",
    priority: input.priority || "normal",
    workspace: "scratch",
    skills: ["hivemindos-coordination", delegation.workerClass],
    targetMachine: delegation.machine ? {
      key: delegation.machine.key || delegation.machine.device?.machineId || selectedMachineName || "unknown",
      name: selectedMachineName || "Unknown machine",
      collectorUrl: delegation.machine.device?.collectorUrl,
    } : null,
    idempotencyKey,
  }, {
    vaultPath: input.vaultPath,
    kanbanFolder: input.kanbanFolder,
  });

  const dedupeRecord = {
    protocol: QUEEN_BEE_PROTOCOL,
    fingerprint,
    idempotencyKey,
    taskId: result.task.id,
    status: result.created ? "accepted" : "duplicate",
    source,
    mode,
    workerClass: delegation.workerClass,
    selectedAgent: selectedAgentName,
    selectedMachine: selectedMachineName,
    createdAt,
  };
  await appendJsonl(paths.intentDedupe, dedupeRecord);

  const receipt = {
    protocol: QUEEN_BEE_PROTOCOL,
    taskId: result.task.id,
    fingerprint,
    status: result.created ? "queued" : "already-queued",
    delegation: publicDelegation(delegation),
    summary: result.created
      ? delegation.status === "delegated"
        ? `Queen Bee accepted the request and delegated it to ${selectedAgentName} on ${selectedMachineName}.`
        : "Queen Bee accepted the request and queued it on the shared Work Board until a matching fleet agent is available."
      : "Queen Bee found an existing Work Board task for this request fingerprint.",
    createdAt,
  };
  await appendJsonl(paths.receipts, receipt);
  await updateCurrentState(paths.currentState, { taskId: result.task.id, title, source, mode, createdAt, delegation });
  const autonomousPickupScheduled = result.created && mode === "act" && scheduleQueenBeeAutonomousPickup({
    task: result.task,
    delegation,
    vaultPath: input.vaultPath,
    kanbanFolder: input.kanbanFolder,
  });

  const board = await readBoard(null, { vaultPath: input.vaultPath, kanbanFolder: input.kanbanFolder });
  return {
    protocol: QUEEN_BEE_PROTOCOL,
    state,
    created: result.created,
    task: result.task,
    board: { slug: board.meta.slug, taskCount: board.tasks.length, kanbanFolder: input.kanbanFolder || DEFAULT_SHARED_VAULT.kanbanFolder },
    route: {
      kind: "work-board",
      assignee: result.task.assignee || "queen-bee",
      targetMachine: result.task.targetMachine,
      delegation: publicDelegation(delegation),
      autonomousPickupScheduled,
      reason: delegation.reason,
    },
    fingerprint,
    receipt,
    paths: {
      root: paths.root,
      intentDedupe: paths.intentDedupe,
      receipts: paths.receipts,
      currentState: paths.currentState,
    },
  };
}

export function fingerprintIntent(input: { message: string; source?: string; mode?: string }) {
  const normalized = [input.source || "api", input.mode || "act", input.message]
    .join("\n")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

function defaultQueenBeeState(options: QueenBeeOptions = {}): QueenBeeState {
  return {
    protocol: QUEEN_BEE_PROTOCOL,
    version: 1,
    identity: "logical-queen-bee",
    status: "ready",
    updatedAt: new Date().toISOString(),
    workBoard: options.kanbanFolder || DEFAULT_SHARED_VAULT.kanbanFolder,
    memory: "Memory/Distillations/Agent Memory + Operations/Brain Services/Agent Memory Index.jsonl",
    fleet: "/api/fleet/discover + /api/fleet/apps",
    handoff: "/api/handoff + .hivemindos-transfers/",
  };
}

async function readQueenBeeProjectRegistry(vaultPath?: string | null) {
  try {
    const registry = await readProjectRegistry({ vaultPath });
    return { projects: registry.projects, updatedAt: registry.updatedAt };
  } catch {
    return { projects: [], updatedAt: Date.now() };
  }
}

async function writeIfMissing(path: string, content: string) {
  if (existsSync(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return true;
}

async function appendJsonl(path: string, record: Record<string, unknown>) {
  await mkdir(dirname(path), { recursive: true });
  const prior = existsSync(path) ? await readFile(path, "utf8") : "";
  const next = `${prior}${prior && !prior.endsWith("\n") ? "\n" : ""}${JSON.stringify(record)}\n`;
  await writeFile(path, next, "utf8");
}

async function updateCurrentState(path: string, event: { taskId: string; title: string; source: string; mode: string; createdAt: string; delegation: ReturnType<typeof chooseQueenBeeDelegate> }) {
  const delegation = publicDelegation(event.delegation);
  const content = `${queenBeeCurrentStateMarkdown().trim()}\n\n## Last Accepted Request\n\n- Time: ${event.createdAt}\n- Task: ${event.taskId}\n- Title: ${event.title}\n- Source: ${event.source}\n- Mode: ${event.mode}\n- Worker class: ${delegation.workerClass}\n- Delegate: ${delegation.agent?.name || "pending"}\n- Machine: ${delegation.machine?.name || "pending"}\n- Routing reason: ${delegation.reason}\n`;
  await writeFile(path, content, "utf8");
}

function taskTitleFromMessage(message: string) {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

function queenBeeTaskBody(input: { message: string; source: string; mode: string; fingerprint: string; delegation: ReturnType<typeof chooseQueenBeeDelegate> }) {
  const delegation = publicDelegation(input.delegation);
  return [
    "Created by the Queen Bee control plane.",
    "",
    `Source: ${input.source}`,
    `Mode: ${input.mode}`,
    `Intent fingerprint: ${input.fingerprint}`,
    `Worker class: ${delegation.workerClass}`,
    `Delegated agent: ${delegation.agent?.name || "pending"}`,
    `Target machine: ${delegation.machine?.name || "pending"}`,
    "",
    "## Request",
    input.message,
    "",
    "## Routing contract",
    "Use Shared Brain Memory for durable context, Fleet discovery for live capability, Handoff for cross-machine work, and receipts under Operations/Brain Services/Queen Bee/ for dedupe/audit.",
    "",
    "## Queen Bee delegation",
    delegation.reason,
  ].join("\n");
}

function publicDelegation(delegation: ReturnType<typeof chooseQueenBeeDelegate>) {
  return {
    status: delegation.status,
    workerClass: delegation.workerClass as QueenBeeWorkerClass,
    score: delegation.score,
    reason: delegation.reason,
    agent: delegation.agent ? {
      id: delegation.agent.id,
      agentId: delegation.agent.agentId,
      name: delegation.agent.name,
      runtime: delegation.agent.runtime,
      beeRole: delegation.agent.beeRole,
      workerClass: delegation.agent.workerClass,
    } : null,
    machine: delegation.machine ? {
      key: delegation.machine.key,
      name: delegation.machine.device?.name,
      os: delegation.machine.device?.os,
      collectorUrl: delegation.machine.device?.collectorUrl,
      machineId: delegation.machine.device?.machineId,
    } : null,
  };
}

function queenBeeIdentityMarkdown() {
  return `# Queen Bee Identity

Queen Bee is the single logical coordinator identity for HivemindOS. She may be reached from any runtime or machine, but all instances coordinate through the shared brain, shared Work Board, shared memory, fleet discovery, and handoff receipts.

## Product contract

- Present one assistant identity to the user.
- Hide per-machine coordinators unless routing details help trust or debugging.
- Prefer existing HivemindOS primitives over parallel queues.
- Write auditable receipts for accepted, duplicate, delegated, blocked, and completed work.
`;
}

function queenBeeRoutingPolicyMarkdown() {
  return `# Queen Bee Routing Policy

Queen Bee routes requests by reading, in order: the user request, Shared Brain Memory, Work Board state, Fleet discovery, connected-app context, project notes, and safety policy.

## Canonical primitives

- Tasks: Operations/Work Board/kanban.json and /api/kanban.
- Durable memory: Memory/Distillations/Agent Memory and /api/brain/memory.
- Live machines: /api/fleet/discover and /api/fleet/apps.
- Cross-machine delegation: /api/handoff and .hivemindos-transfers/.
- Human attention: Operations/Agent Notifications/.

## Default routing

- Local repo work goes to the machine that owns the checkout and has shell/git capability.
- Vault writes go to a runtime with writable shared-vault access.
- Mac-only UI or voice actions go to the Mac coordinator.
- GPU/media work goes to a machine advertising those capabilities.
- Rank online chat-capable agents across all machines, not just the local machine.
- Assign Work Board cards to the best available matching agent and target machine; use \`queen-bee\` only when no matching runtime is online.
- Risky actions require an explicit safety gate before execution.
`;
}

function queenBeeSafetyPolicyMarkdown() {
  return `# Queen Bee Safety Policy

## Levels

- Read-only lookup: no confirmation required.
- Safe mutation directly requested by Liam: proceed after fresh prerequisite checks.
- Risky mutation such as delete, deploy, send, spend, credentials, or irreversible external side effects: require explicit confirmation and write a receipt.
- Sensitive data: never write raw secrets, tokens, passwords, keys, or connection strings into the vault; use credential names/status only.

## Execution rule

Vault state provides consistency and replay protection. Live APIs provide current execution truth. Human confirmation gates high-risk side effects.
`;
}

function queenBeeCurrentStateMarkdown() {
  return `# Queen Bee Current State

Status: ready

Queen Bee is backed by Operations/Brain Services/Queen Bee, the shared Work Board, Shared Brain Memory, Fleet discovery, and Handoff. Runtime instances should check this file for compact state, then use live APIs for fresh status before executing work.
`;
}

function queenBeeNodesReadme() {
  return `# Queen Bee Nodes

Optional machine snapshots and annotations. Live availability should come from /api/fleet/discover and /api/fleet/apps; files here are cache/context, not the primary source of truth.
`;
}
