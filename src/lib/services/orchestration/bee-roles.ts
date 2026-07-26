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

/**
 * Single source of truth for worker-class keyword inference (capability-matrix
 * convention). Every dispatch surface — the Queen Bee fleet router, the
 * dashboard pickup loop, and the handoff intake — classifies through THIS
 * table. Two copies had drifted apart (router: qa 85 / security 82 / vision 70
 * vs this file's 40 / 47 / 50, with different keywords); the merge adopts the
 * ROUTER's priorities and weights, and preserves the keywords that existed only
 * here as explicit entries on the security row.
 */
export const WORKER_CLASS_KEYWORDS: Array<{ workerClass: BeeWorkerClass; priority: number; keywords: Array<{ pattern: RegExp; weight: number }> }> = [
  { workerClass: "planner", priority: 80, keywords: [/plan/i, /decompos/i, /architect/i, /strategy/i, /roadmap/i, /coordinate/i, /orchestrat/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "code", priority: 75, keywords: [/code/i, /bug/i, /api/i, /test/i, /repo/i, /typescript/i, /javascript/i, /css/i, /component/i, /build/i, /implement/i, /lint/i, /typecheck/i].map((pattern) => ({ pattern, weight: 1 })) },
  {
    workerClass: "writer",
    priority: 70,
    keywords: [
      { pattern: /linkedin|social post|social copy|thread|caption/i, weight: 4 },
      { pattern: /\bpost\b|\bcopy\b|\bwrite\b|docs?|readme|summary|article|prompt|release notes/i, weight: 2 },
      { pattern: /editorial|newsletter|announcement|launch copy|tone/i, weight: 2 },
    ],
  },
  { workerClass: "research", priority: 60, keywords: [/research/i, /find/i, /compare/i, /latest/i, /source/i, /market/i, /investigate/i].map((pattern) => ({ pattern, weight: 1 })) },
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
    priority: 70,
    keywords: [
      { pattern: /screenshot|screen|visual qa/i, weight: 6 },
      { pattern: /inspect|ui|ux|contrast/i, weight: 4 },
      { pattern: /\bimage\b|visual/i, weight: 1 },
    ],
  },
  { workerClass: "ops", priority: 45, keywords: [/deploy/i, /server/i, /cron/i, /websocket/i, /mcp/i, /fleet/i, /tailscale/i, /collector/i, /docker/i, /render/i].map((pattern) => ({ pattern, weight: 1 })) },
  {
    workerClass: "qa",
    priority: 85,
    keywords: [
      { pattern: /\bqa\b|quality assurance/i, weight: 4 },
      { pattern: /verify|verification|review|playwright|lint|typecheck|screenshot test|rigorous/i, weight: 2 },
    ],
  },
  {
    workerClass: "security",
    priority: 82,
    keywords: [
      { pattern: /security|vulnerab|exploit|owasp|threat model|pentest|penetration test|injection|\bxss\b|\bcsrf\b|secrets? (?:rotation|scan|leak)|hardening/i, weight: 4 },
      { pattern: /\bauth\b|authn|authz|credential|sandbox escape|audit (?:the )?(?:code|deps|permissions)/i, weight: 2 },
      // Orchestration-surface keywords that only existed in this file's old
      // table, preserved as explicit entries when the two tables merged.
      { pattern: /malicious|threat|cve\b|exfiltrat|skillspector/i, weight: 4 },
      { pattern: /audit|scan|supply chain/i, weight: 2 },
    ],
  },
];

const WORKER_CLASS_IDS = new Set<BeeWorkerClass>(BEE_WORKER_CLASSES.map((entry) => entry.id));

/** Normalize a raw class/skill token to a built-in worker class, or null for custom/unknown tokens. */
export function normalizeWorkerClassToken(value?: string | null): BeeWorkerClass | null {
  const normalized = String(value || "").toLowerCase().trim();
  return WORKER_CLASS_IDS.has(normalized as BeeWorkerClass) ? (normalized as BeeWorkerClass) : null;
}

// The ONE inference function, consumed by every dispatch surface (the Queen Bee
// router's inferQueenBeeWorkerClass delegates here). An explicit worker-class
// token in `skills` wins outright — Queen Bee stamps the routed class into task
// skills, so re-classification downstream stays consistent with the router.
export function inferWorkerClass(task: { title: string; body?: string; skills?: string[] }): BeeWorkerClass {
  if (/^\s*(?:generate|create|make|design)\s+(?:an?\s+)?(?:image|visual|illustration|art|asset)\b/i.test(task.title)) {
    return "artist";
  }
  for (const skill of task.skills ?? []) {
    const normalized = normalizeWorkerClassToken(skill);
    if (normalized && normalized !== "general") return normalized;
  }
  const text = [task.title, task.body, ...(task.skills ?? [])].join(" ");
  const scored = WORKER_CLASS_KEYWORDS
    .map((entry) => ({
      workerClass: entry.workerClass,
      priority: entry.priority,
      score: entry.keywords.reduce((score, keyword) => score + (keyword.pattern.test(text) ? keyword.weight : 0), 0),
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
