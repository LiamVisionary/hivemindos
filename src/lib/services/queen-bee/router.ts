export type QueenBeeWorkerClass = "general" | "planner" | "code" | "vision" | "writer" | "research" | "artist" | "ops" | "qa" | "security";

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

const WORKER_CLASSES = new Set<QueenBeeWorkerClass>(["general", "planner", "code", "vision", "writer", "research", "artist", "ops", "qa", "security"]);

const CLASS_KEYWORDS: Array<{ workerClass: QueenBeeWorkerClass; priority: number; keywords: Array<{ pattern: RegExp; weight: number }> }> = [
  { workerClass: "planner", priority: 80, keywords: [/plan/i, /decompos/i, /architect/i, /strategy/i, /roadmap/i, /coordinate/i, /orchestrat/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "code", priority: 75, keywords: [/code/i, /bug/i, /api/i, /test/i, /repo/i, /typescript/i, /javascript/i, /css/i, /component/i, /build/i, /implement/i, /lint/i, /typecheck/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "writer", priority: 70, keywords: [{ pattern: /linkedin|social post|social copy|thread|caption/i, weight: 4 }, { pattern: /\bpost\b|\bcopy\b|\bwrite\b|docs?|readme|summary|article|prompt|release notes/i, weight: 2 }, { pattern: /editorial|newsletter|announcement|launch copy|tone/i, weight: 2 }] },
  { workerClass: "research", priority: 60, keywords: [/research/i, /find/i, /compare/i, /latest/i, /source/i, /market/i, /investigate/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "artist", priority: 55, keywords: [{ pattern: /image gen|generate (?:an? )?image|create (?:an? )?image|illustrat|visual asset|poster|logo/i, weight: 4 }, { pattern: /\bart\b|style|image concept|art direction/i, weight: 2 }] },
  { workerClass: "vision", priority: 70, keywords: [{ pattern: /screenshot|screen|visual qa/i, weight: 6 }, { pattern: /inspect|ui|ux|contrast/i, weight: 4 }, { pattern: /\bimage\b|visual/i, weight: 1 }] },
  { workerClass: "ops", priority: 45, keywords: [/deploy/i, /server/i, /cron/i, /websocket/i, /mcp/i, /fleet/i, /tailscale/i, /collector/i, /docker/i, /render/i].map((pattern) => ({ pattern, weight: 1 })) },
  { workerClass: "qa", priority: 85, keywords: [{ pattern: /\bqa\b|quality assurance/i, weight: 4 }, { pattern: /verify|verification|review|playwright|lint|typecheck|screenshot test|rigorous/i, weight: 2 }] },
  { workerClass: "security", priority: 82, keywords: [{ pattern: /security|vulnerab|exploit|owasp|threat model|pentest|penetration test|injection|\bxss\b|\bcsrf\b|secrets? (?:rotation|scan|leak)|hardening/i, weight: 4 }, { pattern: /\bauth\b|authn|authz|credential|sandbox escape|audit (?:the )?(?:code|deps|permissions)/i, weight: 2 }] },
];

const RUNTIME_PRIORITY = ["hermes", "openclaw", "opencode", "codex", "claude-code", "hivemind-os", "aeon"];
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

export type QueenBeeRouterOptions = {
  /** Recent per-agent completion/failure counts; adjusts scores by ±15 once an agent has enough history. */
  outcomes?: Record<string, { completed: number; failed: number }>;
  /** In-flight (assigned, not-yet-done) task count per agent name/id; spreads bursts across equal agents. */
  assignments?: Record<string, number>;
  /** Hard machine pin: when set, ONLY agents on the machine this names (by key,
   * friendly name, machineId, dnsName, or dnsName first label) are eligible, so
   * an explicit "run on machine X" cannot be routed elsewhere. */
  targetMachineKey?: string;
};

const LOAD_PENALTY_PER_TASK = 9;
const LOAD_PENALTY_MAX = 45;

function agentInFlight(agent: QueenBeeAgent, assignments?: Record<string, number>) {
  if (!assignments) return 0;
  for (const key of [agent.name, agent.id, agent.agentId]) {
    if (key && assignments[key]) return assignments[key];
  }
  return 0;
}

function loadPenalty(agent: QueenBeeAgent, options: QueenBeeRouterOptions, reasons: string[]) {
  const inFlight = agentInFlight(agent, options.assignments);
  if (inFlight <= 0) return 0;
  reasons.push(`busy with ${inFlight} in-flight task${inFlight === 1 ? "" : "s"}`);
  return -Math.min(LOAD_PENALTY_MAX, inFlight * LOAD_PENALTY_PER_TASK);
}

// Load-aware cross-machine spreading. The per-agent loadPenalty above spreads a
// burst across the least-busy AGENTS — but those can all sit on ONE saturated
// machine. This adds a MACHINE-level penalty (total in-flight across a machine's
// agents) so equally-capable work fans out across ALL online machines instead of
// piling onto one box until it times out. Deliberately gentler than the class
// match (+100): it breaks ties between equal agents, never sends specialized
// work to a wrong-but-idle agent. Kill switch: QUEEN_BEE_MACHINE_LOAD_SPREADING=0.
const MACHINE_LOAD_PENALTY_PER_TASK = 4;
const MACHINE_LOAD_PENALTY_MAX = 30;

function machineLoadSpreadingEnabled(): boolean {
  const raw = (process.env.QUEEN_BEE_MACHINE_LOAD_SPREADING ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

function machineLoadKey(machine: QueenBeeMachine): string {
  return normalizeMachineToken(machine.key) || normalizeMachineToken(machine.device?.machineId) || normalizeMachineToken(machine.device?.name);
}

/** Total in-flight (working/ready) tasks across ALL of a machine's agents. */
function machineInFlightLoad(machine: QueenBeeMachine, options: QueenBeeRouterOptions): number {
  let load = 0;
  for (const agent of machine.agents ?? []) load += agentInFlight(agent, options.assignments);
  return load;
}

function normalizeMachineToken(value?: string | null) {
  return String(value || "").trim().toLowerCase().replace(/\.$/, "");
}

/** Whether `target` names this machine — matched against its key, friendly
 * name, machineId, full dnsName, or dnsName's first label. Used to hard-pin a
 * Queen Bee task to a specific machine. */
export function machineMatchesTarget(machine: QueenBeeMachine, target?: string | null): boolean {
  const wanted = normalizeMachineToken(target);
  if (!wanted) return false;
  const dns = normalizeMachineToken(machine.device?.dnsName);
  return [
    normalizeMachineToken(machine.key),
    normalizeMachineToken(machine.device?.name),
    normalizeMachineToken(machine.device?.machineId),
    dns,
    dns.split(".")[0],
  ].filter(Boolean).includes(wanted);
}

export function chooseQueenBeeDelegate(task: QueenBeeTaskIntent, machines: QueenBeeMachine[] = [], options: QueenBeeRouterOptions = {}): QueenBeeDelegate {
  const [best] = rankQueenBeeDelegates(task, machines, options);
  if (best) return best;
  const workerClass = inferQueenBeeWorkerClass(task);
  return {
    status: "pending",
    workerClass,
    score: 0,
    reason: options.targetMachineKey
      ? `No chat-capable online agent is available on the pinned machine "${options.targetMachineKey}" right now; Queen Bee queued the task for that machine's next available worker.`
      : "No chat-capable online fleet agent is available yet; Queen Bee queued the task on the Work Board for later pickup.",
  };
}

export function rankQueenBeeDelegates(task: QueenBeeTaskIntent, machines: QueenBeeMachine[] = [], options: QueenBeeRouterOptions = {}): QueenBeeDelegate[] {
  const workerClass = inferQueenBeeWorkerClass(task);
  // Hard machine pin: an explicit target restricts candidates to that machine
  // only, so the fallback chain rotates among ITS agents instead of letting the
  // task route to a different machine.
  const scopedMachines = options.targetMachineKey
    ? machines.filter((machine) => machineMatchesTarget(machine, options.targetMachineKey))
    : machines;
  const candidates = scopedMachines.flatMap((machine) => candidateAgents(machine, workerClass, task, options));
  // Spread across machines: penalize candidates on an overall-busier machine so a
  // burst fans out across the fleet instead of saturating one box. Skipped when a
  // machine is explicitly pinned (nothing to spread across) or via the kill switch.
  if (!options.targetMachineKey && machineLoadSpreadingEnabled() && candidates.length > 1) {
    const loadByMachine = new Map<string, number>();
    for (const machine of scopedMachines) loadByMachine.set(machineLoadKey(machine), machineInFlightLoad(machine, options));
    for (const candidate of candidates) {
      const load = loadByMachine.get(machineLoadKey(candidate.machine)) ?? 0;
      if (load > 0) {
        candidate.score -= Math.min(MACHINE_LOAD_PENALTY_MAX, load * MACHINE_LOAD_PENALTY_PER_TASK);
        candidate.reasons.push(`machine carrying ${load} in-flight task${load === 1 ? "" : "s"} — spreading to a freer machine`);
      }
    }
  }
  const ranked = candidates.sort((left, right) => right.score - left.score || stableName(left).localeCompare(stableName(right)));
  return ranked.map((candidate, index) => {
    const machineName = candidate.machine.device?.name || candidate.machine.key || "unknown machine";
    const agentName = candidate.agent.name || candidate.agent.id || candidate.agent.agentId || "selected agent";
    const availability = ranked.length === 1
      ? "the only available"
      : index === 0
        ? "the best available"
        : `fallback #${index + 1}`;
    return {
      status: "delegated",
      workerClass,
      agent: candidate.agent,
      machine: candidate.machine,
      score: candidate.score,
      reason: `Queen Bee selected ${agentName} on ${machineName} as ${availability} ${workerClass} worker across the fleet (${candidate.reasons.join("; ")}).`,
    };
  });
}

function candidateAgents(machine: QueenBeeMachine, workerClass: QueenBeeWorkerClass, task: QueenBeeTaskIntent, options: QueenBeeRouterOptions): ScoredCandidate[] {
  if (!isCollectorUsable(machine.collector)) return [];
  if (machine.device?.online === false) return [];
  return (machine.agents ?? [])
    .filter((agent) => agent.beeRole !== "observer" && agent.beeRole !== "human")
    .filter((agent) => isChatCapable(agent, machine))
    .map((agent) => scoreCandidate(agent, machine, workerClass, task, options))
    .filter((candidate) => candidate.score > 0);
}

const OUTCOME_MIN_SAMPLES = 3;
const OUTCOME_MAX_ADJUSTMENT = 15;

function lookupOutcome(agent: QueenBeeAgent, outcomes?: Record<string, { completed: number; failed: number }>) {
  if (!outcomes) return undefined;
  // Local session stats are keyed by agent id; board-derived (cross-machine) stats are keyed
  // by assignee name. Check both so routing learns from remote agents too.
  for (const key of [agent.id, agent.agentId, agent.name]) {
    if (key && outcomes[key]) return outcomes[key];
  }
  return undefined;
}

function outcomeScore(agent: QueenBeeAgent, options: QueenBeeRouterOptions, reasons: string[], classMatched: boolean) {
  const outcome = lookupOutcome(agent, options.outcomes);
  if (!outcome) return 0;
  const total = outcome.completed + outcome.failed;
  if (total < OUTCOME_MIN_SAMPLES) return 0;
  const successRate = outcome.completed / total;
  const adjustment = Math.round((successRate - 0.5) * 2 * OUTCOME_MAX_ADJUSTMENT);
  // Recency should only LIFT an agent for work it actually matches: a recently-busy
  // off-class generalist must not outrank a fresh specialist on every task type. The
  // penalty for a weak record still applies regardless of class.
  if (adjustment > 0 && !classMatched) return 0;
  if (adjustment > 0) reasons.push(`strong recent completion rate (${outcome.completed}/${total})`);
  if (adjustment < 0) reasons.push(`weak recent completion rate (${outcome.completed}/${total})`);
  return adjustment;
}

function scoreCandidate(agent: QueenBeeAgent, machine: QueenBeeMachine, workerClass: QueenBeeWorkerClass, task: QueenBeeTaskIntent, options: QueenBeeRouterOptions = {}): ScoredCandidate {
  const reasons: string[] = [];
  let score = 10;
  const rawAgentClass = String(agent.workerClass || "").toLowerCase().trim();
  const agentClass = normalizeWorkerClass(agent.workerClass) ?? "general";
  const isCustomClass = Boolean(rawAgentClass) && !WORKER_CLASSES.has(rawAgentClass as QueenBeeWorkerClass);
  let classMatched = false;
  if (agentClass === workerClass) {
    score += 100;
    classMatched = true;
    reasons.push(`exact ${workerClass} worker class`);
  } else if (isCustomClass && taskMentionsClass(task, rawAgentClass)) {
    // Custom, user-defined worker classes are first-class when the request names the specialty.
    score += 100;
    classMatched = true;
    reasons.push(`custom "${rawAgentClass}" specialty matched the request`);
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
  score += outcomeScore(agent, options, reasons, classMatched);
  score += loadPenalty(agent, options, reasons); // spread bursts across equally-good agents
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

function isCollectorUsable(collector?: string) {
  if (!collector) return true;
  const normalized = collector.trim().toLowerCase();
  if (!normalized || normalized === "ready") return true;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return true;
  return false;
}

function normalizeWorkerClass(value?: string | null): QueenBeeWorkerClass | null {
  const normalized = String(value || "").toLowerCase().trim();
  return WORKER_CLASSES.has(normalized as QueenBeeWorkerClass) ? normalized as QueenBeeWorkerClass : null;
}

// True when the request names a custom (non-built-in) worker-class token, so a user-defined
// specialist (e.g. workerClass "legal") can win tasks even though task inference only emits
// built-in classes. Full semantic inference for custom classes comes with the packaged-agents registry.
function taskMentionsClass(task: QueenBeeTaskIntent, classToken: string): boolean {
  if (classToken.length < 3) return false;
  const text = [task.title, task.body, ...(task.skills ?? [])].join(" ").toLowerCase();
  const variants = new Set([classToken, classToken.replace(/[-_]+/g, " "), ...classToken.split(/[-_]+/)]);
  return [...variants].some((variant) => variant.length >= 3 && text.includes(variant));
}

function uniqueTokens(value: string) {
  return [...new Set(value.split(/[^a-z0-9]+/i).filter(Boolean))];
}

function stableName(candidate: ScoredCandidate) {
  return `${candidate.machine.key || candidate.machine.device?.name || ""}:${candidate.agent.id || candidate.agent.agentId || candidate.agent.name || ""}`;
}
