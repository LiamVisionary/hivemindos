import "server-only";

import { randomUUID } from "crypto";
import { constants } from "fs";
import { access, mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join, sep } from "path";
import { homedir } from "@/lib/home-dir";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

const DEFAULT_CHALLENGES_FOLDER = "Operations/Work Board/Agent Challenges";
const FALLBACK_CHALLENGES_FOLDER = join(homedir(), ".hivemindos", "agent-challenges");
const STATE_FILE = "challenges.json";
const MAX_TEXT = 12_000;
const MAX_LIST_ITEMS = 40;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type AgentChallengeStatus = "active" | "paused" | "completed" | "archived";
export type AgentChallengeMetricDirection = "increase" | "decrease";
export type AgentChallengeEntryType =
  | "candidate"
  | "run-request"
  | "finding"
  | "result"
  | "integrity-alert"
  | "ruling"
  | "playbook";
export type AgentChallengeLineageStatus = "evaluated" | "frontier" | "invalid";
export type AgentChallengeRulingKind = "valid" | "invalid" | "tie" | "needs-human" | "policy";

export type AgentChallengeActor = {
  id?: string;
  name: string;
};

export type AgentChallengeBoardEntry = {
  id: string;
  type: AgentChallengeEntryType;
  visibility: "public";
  author: AgentChallengeActor;
  body: string;
  evidence: string[];
  workBoardTaskId?: string;
  lineageId?: string;
  createdAt: string;
  integrityBlocked?: boolean;
};

export type AgentChallengeLineageNode = {
  id: string;
  title: string;
  parentIds: string[];
  score: number;
  metricName?: string;
  status: AgentChallengeLineageStatus;
  originator: AgentChallengeActor;
  runner: AgentChallengeActor;
  verifier?: AgentChallengeActor;
  evidence: string[];
  notes?: string;
  workBoardTaskId?: string;
  createdAt: string;
};

export type AgentChallengeRuling = {
  id: string;
  kind: AgentChallengeRulingKind;
  decidedBy: AgentChallengeActor;
  targetLineageId?: string;
  summary: string;
  createdAt: string;
};

export type AgentChallengePlaybook = {
  levers: string[];
  antiPatterns: string[];
  triageTools: string[];
  verifierNotes: string[];
  openQuestions: string[];
};

export type AgentChallenge = {
  id: string;
  title: string;
  objective: string;
  status: AgentChallengeStatus;
  metricName?: string;
  metricDirection: AgentChallengeMetricDirection;
  baselineScore?: number;
  significanceThreshold: number;
  dailyRunCap?: number;
  workBoard?: string;
  createdBy?: AgentChallengeActor;
  createdAt: string;
  updatedAt: string;
  board: AgentChallengeBoardEntry[];
  lineage: AgentChallengeLineageNode[];
  rulings: AgentChallengeRuling[];
  playbook: AgentChallengePlaybook;
};

export type AgentChallengesState = {
  version: 1;
  challenges: AgentChallenge[];
};

export type AgentChallengesOptions = {
  vaultPath?: string | null;
  challengesFolder?: string | null;
};

export type AgentChallengeStorage = {
  kind: "vault" | "fallback";
  path: string;
};

export type AgentChallengeSummary = {
  id: string;
  title: string;
  status: AgentChallengeStatus;
  objective: string;
  metricName?: string;
  metricDirection: AgentChallengeMetricDirection;
  baselineScore?: number;
  bestScore?: number;
  significanceThreshold: number;
  frontier: Array<{ id: string; title: string; score: number; deltaFromBest: number }>;
  leaderboard: Array<{ agent: AgentChallengeActor; points: number; frontierResults: number; runs: number }>;
  quota: {
    dailyRunCap?: number;
    runsLast24h: Array<{ agent: AgentChallengeActor; runs: number }>;
  };
  totals: {
    boardEntries: number;
    lineageNodes: number;
    rulings: number;
    integrityAlerts: number;
    antiPatterns: number;
  };
};

type CreateChallengeInput = {
  title?: unknown;
  objective?: unknown;
  metricName?: unknown;
  metricDirection?: unknown;
  baselineScore?: unknown;
  significanceThreshold?: unknown;
  dailyRunCap?: unknown;
  workBoard?: unknown;
  createdById?: unknown;
  createdByName?: unknown;
  createdAt?: unknown;
};

type ChallengeEntryInput = {
  challengeId?: unknown;
  type?: unknown;
  authorId?: unknown;
  authorName?: unknown;
  body?: unknown;
  visibility?: unknown;
  evidence?: unknown;
  workBoardTaskId?: unknown;
  lineageId?: unknown;
  createdAt?: unknown;
};

type ChallengeResultInput = {
  challengeId?: unknown;
  title?: unknown;
  parentIds?: unknown;
  score?: unknown;
  metricName?: unknown;
  originatorId?: unknown;
  originatorName?: unknown;
  runnerId?: unknown;
  runnerName?: unknown;
  verifierId?: unknown;
  verifierName?: unknown;
  evidence?: unknown;
  notes?: unknown;
  workBoardTaskId?: unknown;
  createdAt?: unknown;
};

type ChallengeRulingInput = {
  challengeId?: unknown;
  kind?: unknown;
  decidedById?: unknown;
  decidedByName?: unknown;
  targetLineageId?: unknown;
  summary?: unknown;
  createdAt?: unknown;
};

type ChallengePlaybookInput = {
  challengeId?: unknown;
  levers?: unknown;
  antiPatterns?: unknown;
  triageTools?: unknown;
  verifierNotes?: unknown;
  openQuestions?: unknown;
  significanceThreshold?: unknown;
  authorId?: unknown;
  authorName?: unknown;
  createdAt?: unknown;
};

export async function readAgentChallengesState(options: AgentChallengesOptions = {}) {
  const storage = await resolveAgentChallengesStorage(options);
  const raw = await readFile(storage.path, "utf8").catch(() => "");
  const state = normalizeState(raw.trim() ? JSON.parse(raw) as unknown : null);
  return { state, storage, summaries: state.challenges.map(summarizeAgentChallenge) };
}

export async function getAgentChallenge(challengeId: string, options: AgentChallengesOptions = {}) {
  const result = await readAgentChallengesState(options);
  const challenge = result.state.challenges.find((item) => item.id === challengeId);
  if (!challenge) throw new Error("Agent challenge not found.");
  return { ...result, challenge, summary: summarizeAgentChallenge(challenge) };
}

export async function createAgentChallenge(input: CreateChallengeInput, options: AgentChallengesOptions = {}) {
  const title = requireText(input.title, "title", 180);
  const objective = requireText(input.objective, "objective");
  const now = cleanIso(input.createdAt) ?? new Date().toISOString();
  const createdBy = actor(input.createdByName, input.createdById, false);
  const challenge: AgentChallenge = {
    id: `challenge_${slug(title)}_${randomUUID().slice(0, 8)}`,
    title,
    objective,
    status: "active",
    metricName: cleanText(input.metricName, 120),
    metricDirection: input.metricDirection === "decrease" ? "decrease" : "increase",
    baselineScore: finiteNumber(input.baselineScore),
    significanceThreshold: Math.max(0, finiteNumber(input.significanceThreshold) ?? 0),
    dailyRunCap: positiveInteger(input.dailyRunCap),
    workBoard: cleanText(input.workBoard, 120),
    createdBy,
    createdAt: now,
    updatedAt: now,
    board: [],
    lineage: [],
    rulings: [],
    playbook: emptyPlaybook(),
  };
  const current = await readAgentChallengesState(options);
  const state = { ...current.state, challenges: [...current.state.challenges, challenge] };
  await writeAgentChallengesState(state, options);
  return { challenge, summary: summarizeAgentChallenge(challenge), storage: current.storage };
}

export async function postAgentChallengeEntry(input: ChallengeEntryInput, options: AgentChallengesOptions = {}) {
  const challengeId = requireText(input.challengeId, "challengeId", 160);
  const current = await readAgentChallengesState(options);
  const { challenge, index } = findChallenge(current.state, challengeId);
  const requestedVisibility = cleanText(input.visibility, 40);
  const integrityBlocked = Boolean(requestedVisibility && requestedVisibility !== "public");
  const body = integrityBlocked
    ? `Blocked private side-channel request. Original note: ${cleanText(input.body) ?? "(empty)"}`
    : requireText(input.body, "body");
  const entry: AgentChallengeBoardEntry = {
    id: `entry_${randomUUID().slice(0, 12)}`,
    type: integrityBlocked ? "integrity-alert" : normalizeEntryType(input.type),
    visibility: "public",
    author: actor(input.authorName, input.authorId, true),
    body,
    evidence: cleanStringList(input.evidence),
    workBoardTaskId: cleanText(input.workBoardTaskId, 160),
    lineageId: cleanText(input.lineageId, 160),
    createdAt: cleanIso(input.createdAt) ?? new Date().toISOString(),
    integrityBlocked: integrityBlocked || undefined,
  };
  const updated = touch({ ...challenge, board: [...challenge.board, entry] });
  await writeChallengeAt(current.state, index, updated, options);
  return { challenge: updated, entry, summary: summarizeAgentChallenge(updated), storage: current.storage };
}

export async function recordAgentChallengeResult(input: ChallengeResultInput, options: AgentChallengesOptions = {}) {
  const challengeId = requireText(input.challengeId, "challengeId", 160);
  const current = await readAgentChallengesState(options);
  const { challenge, index } = findChallenge(current.state, challengeId);
  const createdAt = cleanIso(input.createdAt) ?? new Date().toISOString();
  const runner = actor(input.runnerName, input.runnerId, true);
  enforceDailyRunCap(challenge, runner, createdAt);
  const node: AgentChallengeLineageNode = {
    id: `result_${randomUUID().slice(0, 12)}`,
    title: requireText(input.title, "title", 180),
    parentIds: cleanStringList(input.parentIds),
    score: requireNumber(input.score, "score"),
    metricName: cleanText(input.metricName, 120) ?? challenge.metricName,
    status: "evaluated",
    originator: actor(input.originatorName, input.originatorId, true),
    runner,
    verifier: actor(input.verifierName, input.verifierId, false),
    evidence: cleanStringList(input.evidence),
    notes: cleanText(input.notes),
    workBoardTaskId: cleanText(input.workBoardTaskId, 160),
    createdAt,
  };
  const entry: AgentChallengeBoardEntry = {
    id: `entry_${randomUUID().slice(0, 12)}`,
    type: "result",
    visibility: "public",
    author: runner,
    body: `${node.title}: ${node.score}${node.metricName ? ` ${node.metricName}` : ""}`,
    evidence: node.evidence,
    workBoardTaskId: node.workBoardTaskId,
    lineageId: node.id,
    createdAt,
  };
  const updated = refreshFrontier(touch({
    ...challenge,
    board: [...challenge.board, entry],
    lineage: [...challenge.lineage, node],
  }));
  await writeChallengeAt(current.state, index, updated, options);
  return { challenge: updated, result: node, entry, summary: summarizeAgentChallenge(updated), storage: current.storage };
}

export async function recordAgentChallengeRuling(input: ChallengeRulingInput, options: AgentChallengesOptions = {}) {
  const challengeId = requireText(input.challengeId, "challengeId", 160);
  const current = await readAgentChallengesState(options);
  const { challenge, index } = findChallenge(current.state, challengeId);
  const kind = normalizeRulingKind(input.kind);
  const targetLineageId = cleanText(input.targetLineageId, 160);
  const createdAt = cleanIso(input.createdAt) ?? new Date().toISOString();
  const ruling: AgentChallengeRuling = {
    id: `ruling_${randomUUID().slice(0, 12)}`,
    kind,
    decidedBy: actor(input.decidedByName, input.decidedById, true),
    targetLineageId,
    summary: requireText(input.summary, "summary"),
    createdAt,
  };
  const lineage = challenge.lineage.map((node) => {
    if (node.id !== targetLineageId) return node;
    if (kind === "invalid") return { ...node, status: "invalid" as const };
    if (kind === "valid") return { ...node, status: "evaluated" as const };
    return node;
  });
  const entry: AgentChallengeBoardEntry = {
    id: `entry_${randomUUID().slice(0, 12)}`,
    type: "ruling",
    visibility: "public",
    author: ruling.decidedBy,
    body: ruling.summary,
    evidence: [],
    lineageId: targetLineageId,
    createdAt,
  };
  const updated = refreshFrontier(touch({
    ...challenge,
    board: [...challenge.board, entry],
    lineage,
    rulings: [...challenge.rulings, ruling],
  }));
  await writeChallengeAt(current.state, index, updated, options);
  return { challenge: updated, ruling, summary: summarizeAgentChallenge(updated), storage: current.storage };
}

export async function distillAgentChallengePlaybook(input: ChallengePlaybookInput, options: AgentChallengesOptions = {}) {
  const challengeId = requireText(input.challengeId, "challengeId", 160);
  const current = await readAgentChallengesState(options);
  const { challenge, index } = findChallenge(current.state, challengeId);
  const significanceThreshold = finiteNumber(input.significanceThreshold);
  const playbook: AgentChallengePlaybook = {
    levers: appendUnique(challenge.playbook.levers, cleanStringList(input.levers)),
    antiPatterns: appendUnique(challenge.playbook.antiPatterns, cleanStringList(input.antiPatterns)),
    triageTools: appendUnique(challenge.playbook.triageTools, cleanStringList(input.triageTools)),
    verifierNotes: appendUnique(challenge.playbook.verifierNotes, cleanStringList(input.verifierNotes)),
    openQuestions: appendUnique(challenge.playbook.openQuestions, cleanStringList(input.openQuestions)),
  };
  const createdAt = cleanIso(input.createdAt) ?? new Date().toISOString();
  const entry: AgentChallengeBoardEntry = {
    id: `entry_${randomUUID().slice(0, 12)}`,
    type: "playbook",
    visibility: "public",
    author: actor(input.authorName, input.authorId, false) ?? { name: "HivemindOS" },
    body: "Challenge playbook updated.",
    evidence: [
      ...cleanStringList(input.levers).map((item) => `Lever: ${item}`),
      ...cleanStringList(input.antiPatterns).map((item) => `Anti-pattern: ${item}`),
      ...cleanStringList(input.verifierNotes).map((item) => `Verifier note: ${item}`),
    ],
    createdAt,
  };
  const updated = refreshFrontier(touch({
    ...challenge,
    significanceThreshold: significanceThreshold === undefined ? challenge.significanceThreshold : Math.max(0, significanceThreshold),
    playbook,
    board: [...challenge.board, entry],
  }));
  await writeChallengeAt(current.state, index, updated, options);
  return { challenge: updated, playbook, summary: summarizeAgentChallenge(updated), storage: current.storage };
}

export function summarizeAgentChallenge(challenge: AgentChallenge): AgentChallengeSummary {
  const valid = challenge.lineage.filter((node) => node.status !== "invalid" && Number.isFinite(node.score));
  const bestScore = bestLineageScore(challenge, valid);
  const frontier = bestScore === undefined ? [] : valid
    .map((node) => ({ node, delta: scoreDelta(challenge, node.score, bestScore) }))
    .filter((item) => item.delta <= challenge.significanceThreshold)
    .sort((left, right) => left.delta - right.delta || right.node.createdAt.localeCompare(left.node.createdAt))
    .map((item) => ({
      id: item.node.id,
      title: item.node.title,
      score: item.node.score,
      deltaFromBest: item.delta,
    }));
  const frontierIds = new Set(frontier.map((item) => item.id));
  const leaderboard = leaderboardFor(challenge, frontierIds);
  return {
    id: challenge.id,
    title: challenge.title,
    status: challenge.status,
    objective: challenge.objective,
    metricName: challenge.metricName,
    metricDirection: challenge.metricDirection,
    baselineScore: challenge.baselineScore,
    bestScore,
    significanceThreshold: challenge.significanceThreshold,
    frontier,
    leaderboard,
    quota: {
      dailyRunCap: challenge.dailyRunCap,
      runsLast24h: runsLast24h(challenge, new Date().toISOString()),
    },
    totals: {
      boardEntries: challenge.board.length,
      lineageNodes: challenge.lineage.length,
      rulings: challenge.rulings.length,
      integrityAlerts: challenge.board.filter((entry) => entry.type === "integrity-alert").length,
      antiPatterns: challenge.playbook.antiPatterns.length,
    },
  };
}

async function writeChallengeAt(state: AgentChallengesState, index: number, challenge: AgentChallenge, options: AgentChallengesOptions) {
  const challenges = [...state.challenges];
  challenges[index] = challenge;
  await writeAgentChallengesState({ ...state, challenges }, options);
}

async function writeAgentChallengesState(state: AgentChallengesState, options: AgentChallengesOptions) {
  const storage = await resolveAgentChallengesStorage(options);
  await mkdir(dirname(storage.path), { recursive: true, mode: 0o700 });
  const tmp = `${storage.path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sortState(state), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, storage.path);
}

async function resolveAgentChallengesStorage(options: AgentChallengesOptions): Promise<AgentChallengeStorage> {
  const folder = normalizeChallengesFolder(options.challengesFolder);
  try {
    const vaultRoot = resolveObsidianVaultPath(options.vaultPath ?? undefined, { requireWritable: true });
    await access(vaultRoot, constants.R_OK | constants.W_OK);
    return { kind: "vault", path: join(vaultRoot, folder, STATE_FILE) };
  } catch {
    return { kind: "fallback", path: join(FALLBACK_CHALLENGES_FOLDER, STATE_FILE) };
  }
}

function normalizeChallengesFolder(value?: string | null) {
  const raw = cleanText(value, 500) ?? DEFAULT_CHALLENGES_FOLDER;
  if (raw.startsWith("/") || raw.split(/[\\/]+/).includes("..")) {
    throw new Error("Agent challenges folder must be a relative vault path.");
  }
  return raw.split(/[\\/]+/).filter(Boolean).join(sep);
}

function normalizeState(value: unknown): AgentChallengesState {
  const parsed = value && typeof value === "object" ? value as Partial<AgentChallengesState> : {};
  return sortState({
    version: 1,
    challenges: Array.isArray(parsed.challenges)
      ? parsed.challenges.map(normalizeChallenge).filter((item): item is AgentChallenge => item !== null)
      : [],
  });
}

function normalizeChallenge(value: unknown): AgentChallenge | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AgentChallenge>;
  const id = cleanText(item.id, 180);
  const title = cleanText(item.title, 180);
  const objective = cleanText(item.objective);
  if (!id || !title || !objective) return null;
  return refreshFrontier({
    id,
    title,
    objective,
    status: normalizeStatus(item.status),
    metricName: cleanText(item.metricName, 120),
    metricDirection: item.metricDirection === "decrease" ? "decrease" : "increase",
    baselineScore: finiteNumber(item.baselineScore),
    significanceThreshold: Math.max(0, finiteNumber(item.significanceThreshold) ?? 0),
    dailyRunCap: positiveInteger(item.dailyRunCap),
    workBoard: cleanText(item.workBoard, 120),
    createdBy: normalizeActor(item.createdBy, false),
    createdAt: cleanIso(item.createdAt) ?? new Date().toISOString(),
    updatedAt: cleanIso(item.updatedAt) ?? new Date().toISOString(),
    board: Array.isArray(item.board)
      ? item.board.map(normalizeEntry).filter((entry): entry is AgentChallengeBoardEntry => entry !== null)
      : [],
    lineage: Array.isArray(item.lineage)
      ? item.lineage.map(normalizeLineage).filter((node): node is AgentChallengeLineageNode => node !== null)
      : [],
    rulings: Array.isArray(item.rulings)
      ? item.rulings.map(normalizeRuling).filter((ruling): ruling is AgentChallengeRuling => ruling !== null)
      : [],
    playbook: normalizePlaybook(item.playbook),
  });
}

function normalizeEntry(value: unknown): AgentChallengeBoardEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AgentChallengeBoardEntry>;
  const body = cleanText(item.body);
  if (!body) return null;
  return {
    id: cleanText(item.id, 160) ?? `entry_${randomUUID().slice(0, 12)}`,
    type: normalizeEntryType(item.type),
    visibility: "public",
    author: normalizeActor(item.author, true) ?? { name: "unknown-agent" },
    body,
    evidence: cleanStringList(item.evidence),
    workBoardTaskId: cleanText(item.workBoardTaskId, 160),
    lineageId: cleanText(item.lineageId, 160),
    createdAt: cleanIso(item.createdAt) ?? new Date().toISOString(),
    integrityBlocked: item.integrityBlocked === true || undefined,
  };
}

function normalizeLineage(value: unknown): AgentChallengeLineageNode | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AgentChallengeLineageNode>;
  const id = cleanText(item.id, 160);
  const title = cleanText(item.title, 180);
  const score = finiteNumber(item.score);
  const originator = normalizeActor(item.originator, true);
  const runner = normalizeActor(item.runner, true);
  if (!id || !title || score === undefined || !originator || !runner) return null;
  return {
    id,
    title,
    parentIds: cleanStringList(item.parentIds),
    score,
    metricName: cleanText(item.metricName, 120),
    status: item.status === "invalid" ? "invalid" : "evaluated",
    originator,
    runner,
    verifier: normalizeActor(item.verifier, false),
    evidence: cleanStringList(item.evidence),
    notes: cleanText(item.notes),
    workBoardTaskId: cleanText(item.workBoardTaskId, 160),
    createdAt: cleanIso(item.createdAt) ?? new Date().toISOString(),
  };
}

function normalizeRuling(value: unknown): AgentChallengeRuling | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<AgentChallengeRuling>;
  const summary = cleanText(item.summary);
  const decidedBy = normalizeActor(item.decidedBy, true);
  if (!summary || !decidedBy) return null;
  return {
    id: cleanText(item.id, 160) ?? `ruling_${randomUUID().slice(0, 12)}`,
    kind: normalizeRulingKind(item.kind),
    decidedBy,
    targetLineageId: cleanText(item.targetLineageId, 160),
    summary,
    createdAt: cleanIso(item.createdAt) ?? new Date().toISOString(),
  };
}

function refreshFrontier(challenge: AgentChallenge): AgentChallenge {
  const summary = summarizeAgentChallenge({ ...challenge, lineage: challenge.lineage.map((node) => ({ ...node, status: node.status === "invalid" ? "invalid" : "evaluated" })) });
  const frontierIds = new Set(summary.frontier.map((item) => item.id));
  return {
    ...challenge,
    lineage: challenge.lineage.map((node) => node.status === "invalid" ? node : { ...node, status: frontierIds.has(node.id) ? "frontier" : "evaluated" }),
  };
}

function leaderboardFor(challenge: AgentChallenge, frontierIds: Set<string>) {
  const byKey = new Map<string, { agent: AgentChallengeActor; points: number; frontierResults: number; runs: number }>();
  function add(agent: AgentChallengeActor | undefined, points: number, frontier: boolean, run: boolean) {
    if (!agent) return;
    const key = agentKey(agent);
    const current = byKey.get(key) ?? { agent, points: 0, frontierResults: 0, runs: 0 };
    current.points += points;
    if (frontier) current.frontierResults += 1;
    if (run) current.runs += 1;
    byKey.set(key, current);
  }
  for (const node of challenge.lineage) {
    if (node.status === "invalid") continue;
    const frontier = frontierIds.has(node.id);
    add(node.originator, frontier ? 6 : 3, frontier, false);
    add(node.runner, frontier ? 4 : 2, frontier, true);
    add(node.verifier, frontier ? 2 : 1, frontier, false);
  }
  for (const entry of challenge.board) {
    if (entry.type === "integrity-alert" || entry.type === "playbook" || entry.type === "finding") add(entry.author, 1, false, false);
  }
  return [...byKey.values()].sort((left, right) => right.points - left.points || left.agent.name.localeCompare(right.agent.name));
}

function enforceDailyRunCap(challenge: AgentChallenge, runner: AgentChallengeActor, createdAt: string) {
  if (!challenge.dailyRunCap) return;
  const runnerKey = agentKey(runner);
  const cutoff = Date.parse(createdAt) - DAY_MS;
  const used = challenge.lineage.filter((node) => node.status !== "invalid" && agentKey(node.runner) === runnerKey && Date.parse(node.createdAt) >= cutoff).length;
  if (used >= challenge.dailyRunCap) {
    throw new Error(`Daily run cap reached for ${runner.name}; stage the candidate publicly for another agent with quota.`);
  }
}

function runsLast24h(challenge: AgentChallenge, nowIso: string) {
  const cutoff = Date.parse(nowIso) - DAY_MS;
  const byKey = new Map<string, { agent: AgentChallengeActor; runs: number }>();
  for (const node of challenge.lineage) {
    if (node.status === "invalid" || Date.parse(node.createdAt) < cutoff) continue;
    const key = agentKey(node.runner);
    const current = byKey.get(key) ?? { agent: node.runner, runs: 0 };
    current.runs += 1;
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((left, right) => right.runs - left.runs || left.agent.name.localeCompare(right.agent.name));
}

function bestLineageScore(challenge: AgentChallenge, nodes: AgentChallengeLineageNode[]) {
  if (!nodes.length) return undefined;
  const scores = nodes.map((node) => node.score);
  return challenge.metricDirection === "decrease" ? Math.min(...scores) : Math.max(...scores);
}

function scoreDelta(challenge: AgentChallenge, score: number, bestScore: number) {
  return Math.max(0, challenge.metricDirection === "decrease" ? score - bestScore : bestScore - score);
}

function findChallenge(state: AgentChallengesState, challengeId: string) {
  const index = state.challenges.findIndex((challenge) => challenge.id === challengeId);
  if (index < 0) throw new Error("Agent challenge not found.");
  return { challenge: state.challenges[index], index };
}

function touch(challenge: AgentChallenge): AgentChallenge {
  return { ...challenge, updatedAt: new Date().toISOString() };
}

function sortState(state: AgentChallengesState): AgentChallengesState {
  return {
    version: 1,
    challenges: [...state.challenges].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}

function emptyPlaybook(): AgentChallengePlaybook {
  return { levers: [], antiPatterns: [], triageTools: [], verifierNotes: [], openQuestions: [] };
}

function normalizePlaybook(value: unknown): AgentChallengePlaybook {
  const item = value && typeof value === "object" ? value as Partial<AgentChallengePlaybook> : {};
  return {
    levers: cleanStringList(item.levers),
    antiPatterns: cleanStringList(item.antiPatterns),
    triageTools: cleanStringList(item.triageTools),
    verifierNotes: cleanStringList(item.verifierNotes),
    openQuestions: cleanStringList(item.openQuestions),
  };
}

function normalizeStatus(value: unknown): AgentChallengeStatus {
  return value === "paused" || value === "completed" || value === "archived" ? value : "active";
}

function normalizeEntryType(value: unknown): AgentChallengeEntryType {
  return value === "run-request" || value === "finding" || value === "result" || value === "integrity-alert" || value === "ruling" || value === "playbook"
    ? value
    : "candidate";
}

function normalizeRulingKind(value: unknown): AgentChallengeRulingKind {
  return value === "invalid" || value === "tie" || value === "needs-human" || value === "policy" ? value : "valid";
}

function actor(name: unknown, id: unknown, required: true): AgentChallengeActor;
function actor(name: unknown, id: unknown, required: false): AgentChallengeActor | undefined;
function actor(name: unknown, id: unknown, required: boolean) {
  const cleanName = cleanText(name, 140);
  const cleanId = cleanText(id, 160);
  if (cleanName) return { id: cleanId, name: cleanName };
  if (cleanId) return { id: cleanId, name: cleanId };
  if (required) return { name: "unknown-agent" };
  return undefined;
}

function normalizeActor(value: unknown, required: boolean): AgentChallengeActor | undefined {
  if (!value || typeof value !== "object") return required ? { name: "unknown-agent" } : undefined;
  const item = value as Partial<AgentChallengeActor>;
  return actor(item.name, item.id, required as true);
}

function agentKey(agent: AgentChallengeActor) {
  return (agent.id || agent.name).trim().toLowerCase();
}

function appendUnique(existing: string[], additions: string[]) {
  return [...new Set([...existing, ...additions].map((item) => item.trim()).filter(Boolean))].slice(0, MAX_LIST_ITEMS);
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 500)).filter((item): item is string => Boolean(item)))].slice(0, MAX_LIST_ITEMS);
}

function requireText(value: unknown, label: string, max = MAX_TEXT) {
  const text = cleanText(value, max);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanText(value: unknown, max = MAX_TEXT) {
  if (typeof value !== "string") return undefined;
  const trimmed = redactSecretText(value).text.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function requireNumber(value: unknown, label: string) {
  const numeric = finiteNumber(value);
  if (numeric === undefined) throw new Error(`${label} must be a finite number.`);
  return numeric;
}

function finiteNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function positiveInteger(value: unknown) {
  const numeric = finiteNumber(value);
  return numeric !== undefined && Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function cleanIso(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toISOString() : undefined;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent-challenge";
}
