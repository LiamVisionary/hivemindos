import type { GitLawbProofStatus } from "@/lib/types/gitlawb";

export const AGENT_MEMORY_TYPES = [
  "instruction",
  "fact",
  "decision",
  "goal",
  "commitment",
  "preference",
  "relationship",
  "context",
  "event",
  "learning",
  "observation",
  "artifact",
  "error",
  "action",
] as const;

export type AgentMemoryType = (typeof AGENT_MEMORY_TYPES)[number];

export const AGENT_MEMORY_COGNITIVE_STAGES = ["system1", "system2"] as const;
export type AgentMemoryCognitiveStage = (typeof AGENT_MEMORY_COGNITIVE_STAGES)[number];

export const AGENT_MEMORY_EVOLUTION_TYPES = ["override", "supplement", "temporal", "negate", "conflict"] as const;
export type AgentMemoryEvolutionType = (typeof AGENT_MEMORY_EVOLUTION_TYPES)[number];

export const AGENT_MEMORY_SOURCE_TYPES = ["explicit", "inferred", "composite"] as const;
export type AgentMemorySourceType = (typeof AGENT_MEMORY_SOURCE_TYPES)[number];

const LEGACY_AGENT_MEMORY_SOURCE_TYPE_ALIASES: Readonly<Record<string, AgentMemorySourceType>> = {
  conversation: "explicit",
  analysis: "inferred",
  observed: "inferred",
  "reviewed-artifact": "inferred",
  "reviewed-work-board-result": "inferred",
  "work-board": "inferred",
  "work-board-artifact": "inferred",
  "work-board-research": "inferred",
  "work-board-result": "inferred",
  "work-board-task": "inferred",
};

export function normalizeAgentMemorySourceType(value?: string): AgentMemorySourceType | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z]+/g, "-");
  const canonical = LEGACY_AGENT_MEMORY_SOURCE_TYPE_ALIASES[normalized] ?? normalized;
  if (!(AGENT_MEMORY_SOURCE_TYPES as readonly string[]).includes(canonical)) {
    throw new Error(`Unsupported memory source type "${value}". Use one of: ${AGENT_MEMORY_SOURCE_TYPES.join(", ")}.`);
  }
  return canonical as AgentMemorySourceType;
}

export const AGENT_MEMORY_ACTOR_ROLES = ["user", "assistant", "agent", "system", "tool"] as const;
export type AgentMemoryActorRole = (typeof AGENT_MEMORY_ACTOR_ROLES)[number];

export const AGENT_MEMORY_ORIGINS = [
  "user-stated",
  "assistant-action",
  "agent-action",
  "system-receipt",
  "imported",
  "vault-note",
] as const;
export type AgentMemoryOrigin = (typeof AGENT_MEMORY_ORIGINS)[number];

export type AgentMemoryUsageSummary = {
  retrievalCount?: number;
  finalAnswerCount?: number;
  lastRetrievedAt?: string;
  lastUsedAt?: string;
};

export type AgentMemoryScoreDetails = {
  exact?: number;
  coverage?: number;
  intent?: number;
  lexical?: number;
  entity?: number;
  semantic?: number;
  temporal?: number;
  confidence?: number;
  recency?: number;
  usage?: number;
  status?: number;
  search?: number;
};

export type AgentMemoryChainItem = {
  id: string;
  title: string;
  content: string;
  status: AgentMemoryRecord["status"];
  notePath: string;
  createdAt: string;
  updatedAt: string;
  cognitiveStage?: AgentMemoryCognitiveStage;
  evolutionType?: AgentMemoryEvolutionType;
  evolutionReason?: string;
};

export type AgentMemoryRecord = {
  id: string;
  type: AgentMemoryType;
  title: string;
  content: string;
  memoryKey?: string;
  confidence: number;
  status: "active" | "superseded" | "archived";
  cognitiveStage?: AgentMemoryCognitiveStage;
  supersedes?: string[];
  supersededBy?: string[];
  evolutionRootId?: string;
  evolutionType?: AgentMemoryEvolutionType;
  evolutionReason?: string;
  evidenceCount?: number;
  sourceType?: AgentMemorySourceType;
  metaTags?: string[];
  tags: string[];
  entities?: string[];
  aliases?: string[];
  actorRole?: AgentMemoryActorRole;
  memoryOrigin?: AgentMemoryOrigin;
  source?: string;
  agentName?: string;
  agentId?: string;
  runtime?: string;
  machineName?: string;
  machineId?: string;
  tailnetId?: string;
  tailnetName?: string;
  tailnetDnsName?: string;
  collectorUrl?: string;
  sessionId?: string;
  project?: string;
  createdAt: string;
  updatedAt: string;
  notePath: string;
  proofId?: string;
  proofStatus?: GitLawbProofStatus;
  proofHash?: string;
  proofPath?: string;
  actorDid?: string;
  searchScore?: number;
  /** Full-vault BM25 score normalized against the best direct index hit. */
  searchScoreNormalized?: number;
  searchCollection?: string;
  usage?: AgentMemoryUsageSummary;
};

export type AgentMemoryProofMode = boolean | "auto";

export type AgentMemoryHit = AgentMemoryRecord & {
  score: number;
  matched: string[];
  excerpt: string;
  scoreDetails?: AgentMemoryScoreDetails;
  evolutionChain?: AgentMemoryChainItem[];
};

export type RememberAgentMemoryInput = {
  vaultPath?: string;
  type?: string;
  title?: string;
  content?: string;
  /** Stable single-source-of-truth key. A second active write must evolve the current head. */
  memoryKey?: string;
  confidence?: number;
  cognitiveStage?: string;
  evidenceCount?: number;
  sourceType?: string;
  metaTags?: string[];
  tags?: string[];
  entities?: string[];
  aliases?: string[];
  actorRole?: string;
  memoryOrigin?: string;
  source?: string;
  agentName?: string;
  agentId?: string;
  runtime?: string;
  machineName?: string;
  machineId?: string;
  tailnetId?: string;
  tailnetName?: string;
  tailnetDnsName?: string;
  collectorUrl?: string;
  sessionId?: string;
  project?: string;
  proof?: AgentMemoryProofMode;
  // Fuzzy suspected-duplicate writes are blocked unless this is set. A
  // canonical-key collision still requires evolve or a genuinely distinct key.
  allowDuplicate?: boolean;
  // High-confidence secret shapes block a write unless explicitly overridden.
  allowSensitiveContent?: boolean;
  /** Operational-event metadata used by remember-action / record-operation. */
  operationKey?: string;
  failureKey?: string;
  outcome?: string;
  taskId?: string;
};

export type RecordAgentOperationalEventInput = RememberAgentMemoryInput;

export type AgentOperationalEvent = {
  schema: "hivemindos.agent-operational-event.v1";
  id: string;
  title: string;
  summary: string;
  operationKey: string;
  failureKey?: string;
  outcome: "success" | "failure" | "blocked" | "cancelled" | "unknown";
  taskId?: string;
  source?: string;
  agentName?: string;
  agentId?: string;
  runtime?: string;
  project?: string;
  sessionId?: string;
  tags: string[];
  entities: string[];
  occurredAt: string;
};

export type ListAgentOperationalEventsInput = {
  query?: string;
  project?: string;
  since?: string;
  limit?: number;
};

export type EvolveAgentMemoryInput = RememberAgentMemoryInput & {
  memoryId?: string;
  supersedes?: string[];
  evolutionType?: string;
  evolutionReason?: string;
};

export type RecallAgentMemoryInput = {
  vaultPath?: string;
  query?: string;
  type?: string;
  tags?: string[];
  project?: string;
  limit?: number;
  includeArchived?: boolean;
  includeOperational?: boolean;
  scope?: string;
  temporalMode?: "auto" | "current" | "historical" | "as-of";
  asOf?: string;
  trackUsage?: boolean;
  usageContext?: string;
  // Floor applied by answer mode before hits reach model context.
  minScore?: number;
};

export type RebuildAgentMemoryIndexInput = {
  vaultPath?: string;
  includeFullVault?: boolean;
};

export type RecordAgentMemoryUsageInput = {
  vaultPath?: string;
  memoryIds?: string[];
  query?: string;
  usageType?: "retrieved" | "final-answer";
  usageContext?: string;
  agentName?: string;
  runtime?: string;
  sessionId?: string;
};
