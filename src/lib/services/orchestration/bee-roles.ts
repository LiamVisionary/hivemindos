import type { AgentProfile, BeeAgentRole, BeeWorkerClass } from "@/lib/types/agent-runtime";
import type { KanbanTask } from "@/lib/types/kanban";

export const BEE_AGENT_ROLES: Array<{ id: BeeAgentRole; label: string; description: string }> = [
  { id: "queen", label: "Queen Bee", description: "Reviews ready work, chooses the route, and can take tasks herself." },
  { id: "worker", label: "Worker Bee", description: "Executes assigned work." },
  { id: "observer", label: "Observer", description: "Visible to the colony but not assigned automatically." },
  { id: "human", label: "Human-operated", description: "Manual profile; automation will not claim work for it." },
];

export const BEE_WORKER_CLASSES: Array<{ id: BeeWorkerClass; label: string; description: string }> = [
  { id: "general", label: "General", description: "Broad tasks and coordination." },
  { id: "planner", label: "Planner", description: "Task decomposition, sequencing, and delegation plans." },
  { id: "code", label: "Engineer", description: "Programming, tests, repositories, APIs, and automation." },
  { id: "vision", label: "Vision", description: "Screenshots, UI inspection, and image understanding." },
  { id: "writer", label: "Writer", description: "Docs, copy, summaries, and structured writing." },
  { id: "research", label: "Research", description: "External information gathering and synthesis." },
  { id: "artist", label: "Artist", description: "Image generation, art direction, and visual assets." },
  { id: "ops", label: "Ops", description: "Deployment, environments, fleet, and system operations." },
  { id: "qa", label: "QA", description: "Testing, verification, and review passes." },
  { id: "security", label: "Security", description: "Threat scanning, skill/code audits, and vulnerability review." },
];

export type BeeAssignment = {
  queen?: AgentProfile;
  worker?: AgentProfile;
  workerClass: BeeWorkerClass;
  mode: "queen" | "worker" | "pending";
  reason: string;
};

type BeeAssignmentOptions = {
  preferQueen?: boolean;
};

const CLASS_KEYWORDS: Array<{ workerClass: BeeWorkerClass; priority: number; keywords: Array<{ pattern: RegExp; weight?: number }> }> = [
  { workerClass: "planner", priority: 80, keywords: [/plan/i, /decompos/i, /architect/i, /strategy/i, /roadmap/i, /coordinate/i, /orchestrat/i].map((pattern) => ({ pattern })) },
  { workerClass: "code", priority: 75, keywords: [/code/i, /bug/i, /api/i, /test/i, /repo/i, /typescript/i, /css/i, /component/i, /build/i, /implement/i].map((pattern) => ({ pattern })) },
  {
    workerClass: "writer",
    priority: 70,
    keywords: [
      { pattern: /linkedin|social post|social copy|thread|caption/i, weight: 4 },
      { pattern: /\bpost\b|\bcopy\b|\bwrite\b|docs?|readme|summary|article|prompt/i, weight: 2 },
      { pattern: /editorial|newsletter|announcement|launch copy|tone/i, weight: 2 },
    ],
  },
  { workerClass: "research", priority: 60, keywords: [/research/i, /find/i, /compare/i, /latest/i, /source/i, /market/i, /investigate/i].map((pattern) => ({ pattern })) },
  {
    workerClass: "artist",
    priority: 55,
    keywords: [
      { pattern: /image gen|generate (?:an? )?image|create (?:an? )?image|illustrat|visual asset|poster|logo/i, weight: 4 },
      { pattern: /\bart\b|style|image concept|art direction/i, weight: 2 },
    ],
  },
  {
    workerClass: "vision",
    priority: 50,
    keywords: [
      { pattern: /screenshot|inspect|ui|ux|screen/i, weight: 3 },
      { pattern: /\bimage\b|visual/i, weight: 1 },
    ],
  },
  {
    workerClass: "security",
    priority: 47,
    keywords: [
      { pattern: /vulnerab|exploit|malicious|threat|cve\b|injection|exfiltrat|skillspector/i, weight: 4 },
      { pattern: /security|audit|scan|pentest|penetration|sandbox escape|supply chain/i, weight: 2 },
    ],
  },
  { workerClass: "ops", priority: 45, keywords: [/deploy/i, /server/i, /cron/i, /websocket/i, /mcp/i, /fleet/i, /tailscale/i, /collector/i].map((pattern) => ({ pattern })) },
  { workerClass: "qa", priority: 40, keywords: [/qa/i, /verify/i, /review/i, /playwright/i, /lint/i, /typecheck/i, /screenshot test/i].map((pattern) => ({ pattern })) },
];

// Adapted from Conway-Research/automaton's role-to-harness registry:
// use lightweight role/class matching first, then fall back to a general worker.
export function inferWorkerClass(task: Pick<KanbanTask, "title" | "body" | "skills">): BeeWorkerClass {
  if (/^\s*(?:generate|create|make|design)\s+(?:an?\s+)?(?:image|visual|illustration|art|asset)\b/i.test(task.title)) {
    return "artist";
  }
  const text = [task.title, task.body, ...(task.skills ?? [])].join(" ");
  const scored = CLASS_KEYWORDS
    .map((entry) => ({
      workerClass: entry.workerClass,
      priority: entry.priority,
      score: entry.keywords.reduce((score, keyword) => score + (keyword.pattern.test(text) ? keyword.weight ?? 1 : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.priority - left.priority);
  return scored[0]?.workerClass ?? "general";
}

function agentDispatchScore(agent: AgentProfile) {
  const urls = [agent.telemetryUrl, agent.gatewayUrl].filter(Boolean).join(" ");
  let score = 0;
  if (agent.collectorCapabilities?.chat) score += 30;
  if (/this mac|local/i.test(agent.machineName ?? "")) score += 20;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(urls)) score += 12;
  if (agent.telemetryUrl?.trim()) score += 4;
  if (agent.gatewayUrl?.trim()) score += 2;
  return score;
}

export function chooseBeeAssignment(task: KanbanTask, agents: AgentProfile[], options: BeeAssignmentOptions = {}): BeeAssignment {
  const workerClass = inferWorkerClass(task);
  const preferQueen = options.preferQueen ?? true;
  const available = agents
    .filter((agent) => agent.beeRole !== "observer" && agent.beeRole !== "human")
    .sort((left, right) => agentDispatchScore(right) - agentDispatchScore(left));
  const queen = available.find((agent) => agent.beeRole === "queen")
    ?? available.find((agent) => /queen|orchestrat|lead|main/i.test(agent.name));
  const worker = available.find((agent) => (
    agent.id !== queen?.id
    && agent.beeRole !== "queen"
    && (agent.workerClass === workerClass || !agent.workerClass || agent.workerClass === "general")
  )) ?? available.find((agent) => agent.id !== queen?.id && agent.beeRole !== "queen");
  if (queen && worker) {
    return {
      queen,
      worker,
      workerClass,
      mode: "worker",
      reason: `${queen.name} is online as Queen Bee and delegated this ${workerClass} work to ${worker.name}.`,
    };
  }
  if (worker) {
    return {
      queen,
      worker,
      workerClass,
      mode: "worker",
      reason: queen
        ? `${queen.name} is online as Queen Bee and delegated this ${workerClass} work to ${worker.name}.`
        : `No Queen Bee is online, so the dashboard pickup loop chose ${worker.name} as the best available ${workerClass} worker.`,
    };
  }
  const fallbackWorker = available.find((agent) => agent.beeRole === "worker")
    ?? available.find((agent) => agent.beeRole !== "queen")
    ?? (preferQueen ? available[0] : undefined);
  if (!preferQueen && fallbackWorker) {
    return {
      queen,
      worker: fallbackWorker,
      workerClass,
      mode: "worker",
      reason: `Undo work is routed directly to ${fallbackWorker.name} as the best available ${workerClass} worker.`,
    };
  }
  if (queen) {
    return {
      queen,
      worker: queen,
      workerClass,
      mode: "queen",
      reason: `${queen.name} is the Queen Bee and will review or delegate this ${workerClass} work.`,
    };
  }

  if (fallbackWorker) {
    return {
      worker: fallbackWorker,
      workerClass,
      mode: "worker",
      reason: `No Queen Bee is online, so the dashboard pickup loop chose ${fallbackWorker.name} as the best available ${workerClass} worker.`,
    };
  }

  return {
    workerClass,
    mode: "pending",
    reason: "No online agent is available for this task yet.",
  };
}

export function beeRoleLabel(role?: BeeAgentRole) {
  return BEE_AGENT_ROLES.find((entry) => entry.id === role)?.label ?? "Worker Bee";
}

export function beeWorkerClassLabel(workerClass?: BeeWorkerClass) {
  return BEE_WORKER_CLASSES.find((entry) => entry.id === workerClass)?.label ?? "General";
}
