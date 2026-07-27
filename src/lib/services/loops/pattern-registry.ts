import registryData from "./pattern-registry.json" with { type: "json" };
import type { LoopMode } from "@/lib/types/loops";
import type { LoopVerifierId } from "@/lib/services/loops/verifier-registry";

export type LoopReadinessLevel = "L0" | "L1" | "L2" | "L3";

export type LoopPatternRisk = "low" | "medium" | "high";

export type LoopPatternCost = {
  tokensNoop: number;
  tokensReport: number;
  tokensAction: number;
  suggestedDailyCap: number;
  earlyExitRequired: boolean;
};

export type LoopPatternDefinition = {
  id: string;
  name: string;
  description: string;
  defaultMode: LoopMode;
  cadence: string;
  risk: LoopPatternRisk;
  verifierIds: LoopVerifierId[];
  phases: string[];
  humanGates: string[];
  weekOneMode: LoopReadinessLevel;
  tokenCost: "low" | "medium" | "high" | "very-high";
  cost: LoopPatternCost;
};

export type LoopPatternRegistry = {
  version: number;
  patterns: LoopPatternDefinition[];
};

const KNOWN_MODES = new Set<LoopMode>(["closed", "open", "optimizer"]);
const KNOWN_RISKS = new Set<LoopPatternRisk>(["low", "medium", "high"]);
const KNOWN_LEVELS = new Set<LoopReadinessLevel>(["L0", "L1", "L2", "L3"]);
const KNOWN_TOKEN_COSTS = new Set<LoopPatternDefinition["tokenCost"]>(["low", "medium", "high", "very-high"]);

export const LOOP_PATTERN_REGISTRY: LoopPatternRegistry = normalizeRegistry(registryData);

export function listLoopPatterns(): LoopPatternDefinition[] {
  return LOOP_PATTERN_REGISTRY.patterns;
}

export function findLoopPattern(id: string): LoopPatternDefinition | undefined {
  return LOOP_PATTERN_REGISTRY.patterns.find((pattern) => pattern.id === id);
}

function normalizeRegistry(value: unknown): LoopPatternRegistry {
  if (!value || typeof value !== "object") {
    throw new Error("Loop pattern registry must be an object.");
  }
  const input = value as { version?: unknown; patterns?: unknown };
  const patterns = Array.isArray(input.patterns)
    ? input.patterns.map(normalizePattern)
    : [];
  if (!patterns.length) throw new Error("Loop pattern registry has no patterns.");
  return {
    version: positiveInteger(input.version) ?? 1,
    patterns,
  };
}

function normalizePattern(value: unknown): LoopPatternDefinition {
  if (!value || typeof value !== "object") {
    throw new Error("Loop pattern entry must be an object.");
  }
  const input = value as Record<string, unknown>;
  const id = requiredString(input.id, "pattern id");
  const defaultMode = String(input.defaultMode ?? "");
  const risk = String(input.risk ?? "");
  const weekOneMode = String(input.weekOneMode ?? "");
  const tokenCost = String(input.tokenCost ?? "");
  if (!KNOWN_MODES.has(defaultMode as LoopMode)) {
    throw new Error(`Loop pattern ${id} has invalid defaultMode.`);
  }
  if (!KNOWN_RISKS.has(risk as LoopPatternRisk)) {
    throw new Error(`Loop pattern ${id} has invalid risk.`);
  }
  if (!KNOWN_LEVELS.has(weekOneMode as LoopReadinessLevel)) {
    throw new Error(`Loop pattern ${id} has invalid weekOneMode.`);
  }
  if (!KNOWN_TOKEN_COSTS.has(tokenCost as LoopPatternDefinition["tokenCost"])) {
    throw new Error(`Loop pattern ${id} has invalid tokenCost.`);
  }
  return {
    id,
    name: requiredString(input.name, `${id} name`),
    description: requiredString(input.description, `${id} description`),
    defaultMode: defaultMode as LoopMode,
    cadence: requiredString(input.cadence, `${id} cadence`),
    risk: risk as LoopPatternRisk,
    verifierIds: stringArray(input.verifierIds) as LoopVerifierId[],
    phases: stringArray(input.phases),
    humanGates: stringArray(input.humanGates),
    weekOneMode: weekOneMode as LoopReadinessLevel,
    tokenCost: tokenCost as LoopPatternDefinition["tokenCost"],
    cost: normalizeCost(input.cost, id),
  };
}

function normalizeCost(value: unknown, patternId: string): LoopPatternCost {
  if (!value || typeof value !== "object") {
    throw new Error(`Loop pattern ${patternId} is missing cost metadata.`);
  }
  const input = value as Record<string, unknown>;
  return {
    tokensNoop: requiredPositiveInteger(input.tokensNoop, `${patternId} tokensNoop`),
    tokensReport: requiredPositiveInteger(input.tokensReport, `${patternId} tokensReport`),
    tokensAction: requiredPositiveInteger(input.tokensAction, `${patternId} tokensAction`),
    suggestedDailyCap: requiredPositiveInteger(input.suggestedDailyCap, `${patternId} suggestedDailyCap`),
    earlyExitRequired: input.earlyExitRequired === true,
  };
}

function requiredString(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`Loop pattern registry missing ${label}.`);
  return text;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function positiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const numeric = positiveInteger(value);
  if (!numeric) throw new Error(`Loop pattern registry missing ${label}.`);
  return numeric;
}
