export type QueenBeeWorkerClass = "general" | "planner" | "code" | "vision" | "writer" | "research" | "artist" | "ops" | "qa";

type QueenBeeAgent = {
  id?: string;
  agentId?: string;
  name?: string;
  runtime?: string;
  beeRole?: string;
  workerClass?: QueenBeeWorkerClass | string;
  machineName?: string;
  telemetryUrl?: string;
  gatewayUrl?: string;
  skillProfilePrompt?: string;
  preferredSkillSlugs?: string[];
  runtimeCapabilities?: { chat?: boolean } & Record<string, unknown>;
  collectorCapabilities?: { chat?: boolean } & Record<string, unknown>;
};

type CollectorProjectCheckout = {
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
};

type CollectorVersion = {
  appDir?: string;
  commit?: string;
  shortCommit?: string;
  branch?: string;
  dirty?: boolean;
  latestCommit?: string;
  latestShortCommit?: string;
  updateCommand?: string;
  projects?: CollectorProjectCheckout[];
  projectCheckouts?: CollectorProjectCheckout[];
};

type ProjectRegistryHint = {
  projects?: Array<{
    id?: string;
    name?: string;
    localPath?: string;
    preferredMachineKey?: string;
    allowedAgentIds?: string[];
    gitlawbRepo?: {
      repoId?: string;
      repoName?: string;
      remoteUrl?: string;
      branch?: string;
    };
  }>;
};

type QueenBeeMachine = {
  key?: string;
  collector?: string;
  device?: {
    self?: boolean;
    name?: string;
    dnsName?: string;
    os?: string;
    online?: boolean;
    collectorUrl?: string;
    machineId?: string;
  } & Record<string, unknown>;
  capabilities?: {
    chat?: boolean;
    runtimes?: string[];
    hostedApps?: boolean;
    runtimeAgentCreation?: boolean;
    skillInventory?: boolean;
    syncthing?: boolean;
  } & Record<string, unknown>;
  version?: CollectorVersion;
  agents?: QueenBeeAgent[];
};

export type QueenBeeTaskIntent = {
  title: string;
  body?: string;
  skills?: string[];
  projectRegistry?: ProjectRegistryHint | null;
};

export type QueenBeeDelegate = {
  status: "delegated" | "pending";
  workerClass: QueenBeeWorkerClass;
  agent?: QueenBeeAgent;
  machine?: QueenBeeMachine;
  score: number;
  reason: string;
};

type ScoredCandidate = {
  agent: QueenBeeAgent;
  machine: QueenBeeMachine;
  workerClass: QueenBeeWorkerClass;
  score: number;
  reasons: string[];
};

const WORKER_CLASSES = new Set<QueenBeeWorkerClass>(["general", "planner", "code", "vision", "writer", "research", "artist", "ops", "qa"]);

const CLASS_KEYWORDS: Array<{ workerClass: QueenBeeWorkerClass; priority: number; keywords: Array<{ pattern: RegExp; weight: number }> }> = [
  { workerClass: "planner", priority: 80, keywords: [/plan/i, /decompos/i, /architect/i, /strategy/i, /roadmap/i, /coordinate/i, /orchestrat/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "code", priority: 75, keywords: [/code/i, /bug/i, /api/i, /test/i, /repo/i, /typescript/i, /javascript/i, /css/i, /component/i, /build/i, /implement/i, /lint/i, /typecheck/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "writer", priority: 70, keywords: [{ pattern: /linkedin|social post|social copy|thread|caption/i, weight: 4 }, { pattern: /\bpost\b|\bcopy\b|\bwrite\b|docs?|readme|summary|article|prompt|release notes/i, weight: 2 }, { pattern: /editorial|newsletter|announcement|launch copy|tone/i, weight: 2 }] },
  { workerClass: "research", priority: 60, keywords: [/research/i, /find/i, /compare/i, /latest/i, /source/i, /market/i, /investigate/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "artist", priority: 55, keywords: [{ pattern: /image gen|generate (?:an? )?image|create (?:an? )?image|illustrat|visual asset|poster|logo/i, weight: 4 }, { pattern: /\bart\b|style|image concept|art direction/i, weight: 2 }] },
  { workerClass: "vision", priority: 70, keywords: [{ pattern: /screenshot|screen|visual qa/i, weight: 6 }, { pattern: /inspect|ui|ux|contrast/i, weight: 4 }, { pattern: /\bimage\b|visual/i, weight: 1 }] },
  { workerClass: "ops", priority: 45, keywords: [/deploy/i, /server/i, /cron/i, /websocket/i, /mcp/i, /fleet/i, /tailscale/i, /collector/i, /docker/i, /render/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "qa", priority: 85, keywords: [{ pattern: /\bqa\b|quality assurance/i, weight: 4 }, { pattern: /verify|verification|review|playwright|lint|typecheck|screenshot test|rigorous/i, weight: 2 }] },
];

const RUNTIME_PRIORITY = ["hermes", "openclaw", "opencode", "codex", "claude-code", "openai-compatible", "aeon"];
const CURRENT_APP_PROJECT_SLUGS = new Set(["hivemindos", "omniagenthivemind"]);

export function inferQueenBeeWorkerClass(task: QueenBeeTaskIntent): QueenBeeWorkerClass {
  if (/^\s*(?:generate|create|make|design)\s+(?:an?\s+)?(?:image|visual|illustration|art|asset)\b/i.test(task.title)) return "artist";
  for (const skill of task.skills ?? []) {
    const normalized = normalizeWorkerClass(skill);
    if (normalized && normalized !== "general") return normalized;
  }
  const text = [task.title, task.body, ...(task.skills ?? [])].join(" ");
  const scored = CLASS_KEYWORDS
    .map((entry) => ({
      workerClass: entry.workerClass,
      priority: entry.priority,
      score: entry.keywords.reduce((score, keyword) => score + (keyword.pattern.test(text) ? keyword.weight : 0), 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.priority - left.priority);
  return scored[0]?.workerClass ?? "general";
}

export function chooseQueenBeeDelegate(task: QueenBeeTaskIntent, machines: QueenBeeMachine[] = []): QueenBeeDelegate {
  const workerClass = inferQueenBeeWorkerClass(task);
  const candidates = machines.flatMap((machine) => candidateAgents(machine, workerClass, task));
  if (!candidates.length) {
    return {
      status: "pending",
      workerClass,
      score: 0,
      reason: "No chat-capable online fleet agent is available yet; Queen Bee queued the task on the Work Board for later pickup.",
    };
  }
  const [best] = candidates.sort((left, right) => right.score - left.score || stableName(left).localeCompare(stableName(right)));
  const machineName = best.machine.device?.name || best.machine.key || "unknown machine";
  const agentName = best.agent.name || best.agent.id || best.agent.agentId || "selected agent";
  const availability = candidates.length === 1 ? "the only available" : "the best available";
  return {
    status: "delegated",
    workerClass,
    agent: best.agent,
    machine: best.machine,
    score: best.score,
    reason: `Queen Bee selected ${agentName} on ${machineName} as ${availability} ${workerClass} worker across the fleet (${best.reasons.join("; ")}).`,
  };
}

function candidateAgents(machine: QueenBeeMachine, workerClass: QueenBeeWorkerClass, task: QueenBeeTaskIntent): ScoredCandidate[] {
  if (machine.collector && machine.collector !== "ready") return [];
  if (machine.device?.online === false) return [];
  return (machine.agents ?? [])
    .filter((agent) => agent.beeRole !== "observer" && agent.beeRole !== "human")
    .filter((agent) => isChatCapable(agent, machine))
    .map((agent) => scoreCandidate(agent, machine, workerClass, task))
    .filter((candidate) => candidate.score > 0);
}

function scoreCandidate(agent: QueenBeeAgent, machine: QueenBeeMachine, workerClass: QueenBeeWorkerClass, task: QueenBeeTaskIntent): ScoredCandidate {
  const reasons: string[] = [];
  let score = 10;
  const agentClass = normalizeWorkerClass(agent.workerClass) ?? "general";
  if (agentClass === workerClass) {
    score += 100;
    reasons.push(`exact ${workerClass} worker class`);
  } else if (agentClass === "general") {
    score += 35;
    reasons.push("general fallback worker");
  } else if (agent.beeRole === "queen") {
    score += 12;
    reasons.push("Queen Bee can review/delegate when no better worker exists");
  }

  if (agent.beeRole === "worker") score += 18;
  if (agent.beeRole === "queen") score -= workerClass === "planner" ? 0 : 18;
  if (agent.runtimeCapabilities?.chat || agent.collectorCapabilities?.chat || machine.capabilities?.chat) {
    score += 30;
    reasons.push("chat-capable runtime");
  }
  if (machine.collector === "ready") score += 16;
  if (machine.device?.online !== false) score += 12;
  if (machine.capabilities?.syncthing) score += 4;
  if (machine.capabilities?.skillInventory) score += 4;

  const runtimeIndex = RUNTIME_PRIORITY.indexOf(String(agent.runtime || ""));
  if (runtimeIndex >= 0) score += Math.max(0, 12 - runtimeIndex * 2);
  score += taskAffinityScore(agent, machine, task, reasons);
  if (machine.device?.self) score += 1; // tie-break only; do not prefer local over a better remote specialist.
  return { agent, machine, workerClass, score, reasons };
}

function taskAffinityScore(agent: QueenBeeAgent, machine: QueenBeeMachine, task: QueenBeeTaskIntent, reasons: string[]) {
  const text = [task.title, task.body, ...(task.skills ?? [])].join(" ").toLowerCase();
  const profile = [agent.name, agent.skillProfilePrompt, ...(agent.preferredSkillSlugs ?? []), machine.device?.name, machine.device?.os].join(" ").toLowerCase();
  let score = 0;
  for (const token of uniqueTokens(text)) {
    if (token.length >= 4 && profile.includes(token)) score += 2;
  }
  if (score > 0) reasons.push("profile text overlaps request");
  if (/mac|darwin|ios|xcode|voice|screen recording/.test(text) && /darwin|mac/i.test(String(machine.device?.os || machine.device?.name || ""))) {
    score += 35;
    reasons.push("Mac-specific request matched Mac machine");
  }
  if (/linux|ubuntu|docker|server|deploy|tailscale|collector/.test(text) && /linux|ubuntu/i.test(String(machine.device?.os || machine.device?.name || ""))) {
    score += 28;
    reasons.push("Linux/ops request matched Linux machine");
  }
  if (/repo|code|test|build|typecheck|lint/.test(text) && /codex|opencode|claude-code|hermes/.test(String(agent.runtime))) score += 10;
  score += projectCheckoutScore(machine, agent, task, text, reasons);
  return score;
}

function projectCheckoutScore(machine: QueenBeeMachine, agent: QueenBeeAgent, task: QueenBeeTaskIntent, taskText: string, reasons: string[]) {
  let score = 0;
  const checkouts = projectCheckoutsForVersion(machine.version);
  const registryMatches = matchingRegistryProjects(task.projectRegistry, taskText);
  const matchedRegistry = registryMatches.find((project) => checkouts.some((checkout) => checkoutMatchesRegistryProject(checkout, project)));
  if (matchedRegistry) {
    const checkout = checkouts.find((candidate) => checkoutMatchesRegistryProject(candidate, matchedRegistry));
    score += 95;
    reasons.push(`GitLawb project registry matched ${matchedRegistry.name || matchedRegistry.id || "project"}`);
    if (matchedRegistry.preferredMachineKey && machineKeyMatches(machine, matchedRegistry.preferredMachineKey)) {
      score += 45;
      reasons.push("preferred project machine");
    }
    if (Array.isArray(matchedRegistry.allowedAgentIds) && matchedRegistry.allowedAgentIds.length) {
      const agentId = agent.id || agent.agentId;
      if (agentId && matchedRegistry.allowedAgentIds.includes(agentId)) {
        score += 25;
        reasons.push("project allows selected agent");
      } else {
        score -= 80;
        reasons.push("project registry does not list this agent as preferred");
      }
    }
    if (checkout) score += checkoutFreshnessScore(checkout, "project checkout", reasons);
    return score;
  }

  const currentCheckout = checkouts.find((checkout) => checkout.project && taskMentionsProject(taskText, checkout.project));
  if (!currentCheckout) return 0;
  score += 70;
  reasons.push(`matching project checkout (${currentCheckout.project})`);
  score += checkoutFreshnessScore(currentCheckout, "matching project checkout", reasons);
  return score;
}

function projectCheckoutsForVersion(version?: CollectorVersion) {
  const checkouts: Array<CollectorProjectCheckout & { project: string }> = [];
  const primaryProject = projectSlugFromAppDir(version?.appDir);
  if (primaryProject) {
    checkouts.push({
      project: primaryProject,
      name: primaryProject,
      localPath: version?.appDir,
      appDir: version?.appDir,
      branch: version?.branch,
      commit: version?.commit,
      shortCommit: version?.shortCommit,
      dirty: version?.dirty,
      latestCommit: version?.latestCommit,
      latestShortCommit: version?.latestShortCommit,
      updateCommand: version?.updateCommand,
    });
  }
  for (const checkout of [...(version?.projects ?? []), ...(version?.projectCheckouts ?? [])]) {
    const project = normalizeProjectSlug(checkout.slug || checkout.projectId || checkout.name || projectSlugFromAppDir(checkout.localPath || checkout.appDir));
    if (project) checkouts.push({ ...checkout, project });
  }
  return checkouts;
}

function checkoutFreshnessScore(checkout: CollectorProjectCheckout, label: string, reasons: string[]) {
  let score = 0;
  const commit = checkout.commit?.trim();
  const latestCommit = checkout.latestCommit?.trim();
  if (checkout.dirty) {
    score += 75;
    reasons.push(`${label} has local changes`);
  }
  if (commit && latestCommit && commit === latestCommit) {
    score += 80;
    reasons.push(`${label} is up to date`);
  } else if (commit && latestCommit) {
    score -= checkout.dirty ? 10 : 35;
    reasons.push(`${label} is behind ${checkout.latestShortCommit || latestCommit.slice(0, 7)}`);
  }
  if (checkout.branch) reasons.push(`project branch ${checkout.branch}`);
  return score;
}

function matchingRegistryProjects(registry: ProjectRegistryHint | null | undefined, taskText: string) {
  const text = normalizeProjectSlug(taskText);
  if (!text) return [];
  return (registry?.projects ?? []).filter((project) => {
    const aliases = [
      project.id,
      project.name,
      project.localPath && projectSlugFromAppDir(project.localPath),
      project.gitlawbRepo?.repoId,
      project.gitlawbRepo?.repoName,
      project.gitlawbRepo?.remoteUrl && projectSlugFromRemote(project.gitlawbRepo.remoteUrl),
    ].map((value) => normalizeProjectSlug(String(value || ""))).filter((value) => value.length >= 3);
    return aliases.some((alias) => text.includes(alias));
  });
}

function checkoutMatchesRegistryProject(checkout: CollectorProjectCheckout & { project: string }, project: NonNullable<ProjectRegistryHint["projects"]>[number]) {
  const checkoutAliases = [
    checkout.project,
    checkout.projectId,
    checkout.name,
    checkout.localPath && projectSlugFromAppDir(checkout.localPath),
    checkout.appDir && projectSlugFromAppDir(checkout.appDir),
    checkout.gitlawbRepoId,
    checkout.gitlawbRepoName,
    checkout.remoteUrl && projectSlugFromRemote(checkout.remoteUrl),
  ].map((value) => normalizeProjectSlug(String(value || ""))).filter(Boolean);
  const registryAliases = [
    project.id,
    project.name,
    project.localPath && projectSlugFromAppDir(project.localPath),
    project.gitlawbRepo?.repoId,
    project.gitlawbRepo?.repoName,
    project.gitlawbRepo?.remoteUrl && projectSlugFromRemote(project.gitlawbRepo.remoteUrl),
  ].map((value) => normalizeProjectSlug(String(value || ""))).filter(Boolean);
  return checkoutAliases.some((alias) => registryAliases.includes(alias));
}

function machineKeyMatches(machine: QueenBeeMachine, preferred: string) {
  const normalized = normalizeProjectSlug(preferred);
  return [machine.key, machine.device?.machineId, machine.device?.name, machine.device?.dnsName]
    .map((value) => normalizeProjectSlug(String(value || "")))
    .includes(normalized);
}

function projectSlugFromRemote(remoteUrl?: string) {
  const withoutGit = String(remoteUrl || "").trim().replace(/\.git$/i, "");
  return withoutGit.split(/[/:]+/).filter(Boolean).pop() || "";
}

function projectSlugFromAppDir(appDir?: string) {
  const tail = String(appDir || "").trim().split(/[\\/]+/).filter(Boolean).pop();
  if (!tail) return "";
  return normalizeProjectSlug(tail.replace(/^omni-agent-/, "").replace(/^my-/, ""));
}

function taskMentionsProject(taskText: string, projectSlug: string) {
  const normalizedText = normalizeProjectSlug(taskText);
  if (!normalizedText || !projectSlug || projectSlug.length < 3) return false;
  if (normalizedText.includes(projectSlug)) return true;
  return CURRENT_APP_PROJECT_SLUGS.has(projectSlug) && /\bthis\s+(?:project|repo|repository|codebase)\b/i.test(taskText);
}

function normalizeProjectSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isChatCapable(agent: QueenBeeAgent, machine: QueenBeeMachine) {
  return agent.runtime === "hermes" || agent.runtimeCapabilities?.chat === true || agent.collectorCapabilities?.chat === true || machine.capabilities?.chat === true;
}

function normalizeWorkerClass(value?: string | null): QueenBeeWorkerClass | null {
  const normalized = String(value || "").toLowerCase().trim();
  return WORKER_CLASSES.has(normalized as QueenBeeWorkerClass) ? normalized as QueenBeeWorkerClass : null;
}

function uniqueTokens(value: string) {
  return [...new Set(value.split(/[^a-z0-9]+/i).filter(Boolean))];
}

function stableName(candidate: ScoredCandidate) {
  return `${candidate.machine.key || candidate.machine.device?.name || ""}:${candidate.agent.id || candidate.agent.agentId || candidate.agent.name || ""}`;
}
