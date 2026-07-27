import "server-only";

import { randomUUID } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "@/lib/home-dir";

export type OutcomeRoutingRecord = {
  id: string;
  provider: string;
  model: string;
  useCase: string;
  accepted: boolean;
  qualityScore?: number;
  costUsd?: number;
  latencyMs?: number;
  privacy?: "private-first" | "balanced" | "cloud-ok";
  proofPackId?: string;
  createdAt: string;
};

export type OutcomeRouteCandidate = {
  provider: string;
  model: string;
  score: number;
  free?: boolean;
};

export type OutcomeRouteConstraints = {
  useCases: string[];
  maxCostUsd?: number;
  maxLatencyMs?: number;
  privacy?: OutcomeRoutingRecord["privacy"];
};

export type OutcomeRouteEvidence = {
  samples: number;
  acceptedRate?: number;
  averageQuality?: number;
  averageCostUsd?: number;
  averageLatencyMs?: number;
  adjustment: number;
};

type OutcomeStore = { version: 1; records: OutcomeRoutingRecord[] };

const STORE_FILE = join(homedir(), ".hivemindos", "outcome-routing.json");
const MAX_RECORDS = 2_000;

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cleanText(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function candidateKey(provider: string, model: string) {
  return `${provider.trim().toLowerCase()}::${model.trim().toLowerCase()}`;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

export function outcomeEvidenceFor(
  candidate: OutcomeRouteCandidate,
  records: OutcomeRoutingRecord[],
  constraints: OutcomeRouteConstraints,
): OutcomeRouteEvidence {
  const useCases = new Set(constraints.useCases.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const relevant = records.filter((record) =>
    candidateKey(record.provider, record.model) === candidateKey(candidate.provider, candidate.model)
    && (!useCases.size || useCases.has(record.useCase.trim().toLowerCase())),
  );
  const acceptedRate = relevant.length ? relevant.filter((record) => record.accepted).length / relevant.length : undefined;
  const averageQuality = mean(relevant.map((record) => record.qualityScore).filter((value): value is number => value !== undefined));
  const averageCostUsd = mean(relevant.map((record) => record.costUsd).filter((value): value is number => value !== undefined));
  const averageLatencyMs = mean(relevant.map((record) => record.latencyMs).filter((value): value is number => value !== undefined));
  let adjustment = candidate.free ? 24 : 0;
  if (acceptedRate !== undefined) adjustment += Math.round((acceptedRate - 0.5) * 120);
  if (averageQuality !== undefined) adjustment += Math.round((averageQuality - 0.5) * 70);
  if (constraints.maxCostUsd !== undefined && averageCostUsd !== undefined) adjustment += averageCostUsd <= constraints.maxCostUsd ? 18 : -80;
  if (constraints.maxLatencyMs !== undefined && averageLatencyMs !== undefined) adjustment += averageLatencyMs <= constraints.maxLatencyMs ? 12 : -50;
  if (constraints.privacy === "private-first" && /local|ollama|lmstudio|hive-compute/i.test(candidate.provider)) adjustment += 28;
  if (constraints.privacy === "cloud-ok" && !candidate.free) adjustment += 5;
  adjustment += Math.min(20, relevant.length * 3);
  return { samples: relevant.length, acceptedRate, averageQuality, averageCostUsd, averageLatencyMs, adjustment };
}

export function rankOutcomeCandidates<T extends OutcomeRouteCandidate>(
  candidates: T[],
  records: OutcomeRoutingRecord[],
  constraints: OutcomeRouteConstraints,
): Array<T & { outcomeEvidence: OutcomeRouteEvidence }> {
  return candidates
    .map((candidate) => ({ ...candidate, outcomeEvidence: outcomeEvidenceFor(candidate, records, constraints) }))
    .sort((left, right) =>
      (right.score + right.outcomeEvidence.adjustment) - (left.score + left.outcomeEvidence.adjustment)
      || right.outcomeEvidence.samples - left.outcomeEvidence.samples
      || candidateKey(left.provider, left.model).localeCompare(candidateKey(right.provider, right.model)),
    );
}

export async function readOutcomeRoutingRecords(file = STORE_FILE) {
  const raw = await readFile(file, "utf8").catch(() => "");
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<OutcomeStore>;
    return Array.isArray(parsed.records) ? parsed.records.map(normalizeRecord).filter((record): record is OutcomeRoutingRecord => Boolean(record)) : [];
  } catch {
    return [];
  }
}

export async function recordOutcomeRoutingResult(input: Partial<OutcomeRoutingRecord>, file = STORE_FILE) {
  const provider = cleanText(input.provider);
  const model = cleanText(input.model);
  const useCase = cleanText(input.useCase, 120);
  if (!provider || !model || !useCase) throw new Error("provider, model, and useCase are required.");
  const record: OutcomeRoutingRecord = {
    id: cleanText(input.id) || `outcome_${randomUUID().slice(0, 12)}`,
    provider,
    model,
    useCase,
    accepted: input.accepted === true,
    qualityScore: clamp01(finite(input.qualityScore)),
    costUsd: nonNegative(finite(input.costUsd)),
    latencyMs: nonNegative(finite(input.latencyMs)),
    privacy: input.privacy === "private-first" || input.privacy === "cloud-ok" ? input.privacy : input.privacy === "balanced" ? "balanced" : undefined,
    proofPackId: cleanText(input.proofPackId),
    createdAt: Number.isNaN(Date.parse(input.createdAt ?? "")) ? new Date().toISOString() : input.createdAt!,
  };
  const records = await readOutcomeRoutingRecords(file);
  const next: OutcomeStore = { version: 1, records: [...records, record].slice(-MAX_RECORDS) };
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, file);
  return record;
}

function normalizeRecord(value: unknown): OutcomeRoutingRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<OutcomeRoutingRecord>;
  const provider = cleanText(item.provider);
  const model = cleanText(item.model);
  const useCase = cleanText(item.useCase, 120);
  if (!provider || !model || !useCase) return null;
  return {
    id: cleanText(item.id) || `outcome_${randomUUID().slice(0, 12)}`,
    provider,
    model,
    useCase,
    accepted: item.accepted === true,
    qualityScore: clamp01(finite(item.qualityScore)),
    costUsd: nonNegative(finite(item.costUsd)),
    latencyMs: nonNegative(finite(item.latencyMs)),
    privacy: item.privacy,
    proofPackId: cleanText(item.proofPackId),
    createdAt: Number.isNaN(Date.parse(item.createdAt ?? "")) ? new Date().toISOString() : item.createdAt!,
  };
}

function clamp01(value?: number) {
  return value === undefined ? undefined : Math.max(0, Math.min(1, value));
}

function nonNegative(value?: number) {
  return value === undefined ? undefined : Math.max(0, value);
}
