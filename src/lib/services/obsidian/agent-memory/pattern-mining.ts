import type { AgentOperationalEvent } from "./types";

export type OperationalPatternKind = "recurring-failure" | "repeated-operation" | "temporal-routine";

export type OperationalPatternCandidate = {
  key: string;
  kind: OperationalPatternKind;
  reviewKind: "memory" | "skill" | "job";
  title: string;
  summary: string;
  proposedContent: string;
  confidence: number;
  occurrenceCount: number;
  distinctTaskCount: number;
  evidence: Array<{ sourceType: "agent-run"; sourceId: string; excerpt: string }>;
};

export type OperationalPatternMiningOptions = {
  minDistinctTasks?: number;
  minRoutineOccurrences?: number;
  minRoutineMeanIntervalMs?: number;
  maxRoutineCoefficientOfVariation?: number;
};

function isNoise(event: AgentOperationalEvent) {
  const tags = new Set((event.tags ?? []).map((tag) => tag.toLowerCase()));
  if (["test", "e2e", "fixture", "smoke-test"].some((tag) => tags.has(tag))) return true;
  if (/^(?:test|e2e|fixture)\//.test(event.operationKey)) return true;
  return /\b(?:e2e|test fixture|smoke test)\b/i.test(`${event.title} ${event.summary}`);
}

function distinctTaskCount(events: AgentOperationalEvent[]) {
  return new Set(events.map((event) => event.taskId || event.id)).size;
}

function evidence(events: AgentOperationalEvent[]) {
  return events.slice(0, 6).map((event) => ({
    sourceType: "agent-run" as const,
    sourceId: event.taskId || event.id,
    excerpt: `${event.occurredAt}: ${event.title} — ${event.summary}`.slice(0, 1_500),
  }));
}

function confidenceFor(count: number, base: number) {
  return Math.min(0.96, Math.round((base + Math.min(0.2, count * 0.025)) * 100) / 100);
}

function routineStats(events: AgentOperationalEvent[]) {
  const times = events
    .map((event) => Date.parse(event.occurredAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (times.length < 3) return null;
  const intervals = times.slice(1).map((time, index) => time - times[index]).filter((interval) => interval > 0);
  if (intervals.length < 2) return null;
  const meanMs = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  const variance = intervals.reduce((sum, interval) => sum + (interval - meanMs) ** 2, 0) / intervals.length;
  return { meanMs, coefficientOfVariation: Math.sqrt(variance) / meanMs };
}

function cadenceLabel(meanMs: number) {
  const days = meanMs / 86_400_000;
  if (days >= 6.5 && days <= 7.5) return "weekly";
  if (days >= 27 && days <= 32) return "monthly";
  if (days >= 0.8 && days <= 1.2) return "daily";
  if (days >= 1) return `every ${Math.round(days)} days`;
  return `every ${Math.max(1, Math.round(meanMs / 3_600_000))} hours`;
}

function groupBy(events: AgentOperationalEvent[], keyFor: (event: AgentOperationalEvent) => string | undefined) {
  const groups = new Map<string, AgentOperationalEvent[]>();
  for (const event of events) {
    const key = keyFor(event)?.trim();
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return groups;
}

export function mineOperationalPatterns(
  sourceEvents: AgentOperationalEvent[],
  options: OperationalPatternMiningOptions = {},
) {
  const minDistinctTasks = Math.max(2, Math.trunc(options.minDistinctTasks ?? 3));
  const minRoutineOccurrences = Math.max(minDistinctTasks, Math.trunc(options.minRoutineOccurrences ?? 4));
  const minRoutineMeanIntervalMs = Math.max(60_000, Math.trunc(options.minRoutineMeanIntervalMs ?? 4 * 3_600_000));
  const maxRoutineCoefficientOfVariation = Math.max(0.05, Math.min(0.8, options.maxRoutineCoefficientOfVariation ?? 0.35));
  const events = sourceEvents.filter((event) => !isNoise(event));
  const candidates: OperationalPatternCandidate[] = [];

  const failureGroups = groupBy(
    events.filter((event) => event.outcome === "failure" || event.outcome === "blocked"),
    (event) => event.failureKey,
  );
  for (const [failureKey, group] of failureGroups) {
    const tasks = distinctTaskCount(group);
    if (tasks < minDistinctTasks) continue;
    candidates.push({
      key: `recurring-failure:${failureKey}`,
      kind: "recurring-failure",
      reviewKind: "memory",
      title: `Recurring operational failure: ${failureKey}`,
      summary: `${group.length} failures across ${tasks} distinct tasks share the same failure signature.`,
      proposedContent: `Reviewed learning candidate: the operational failure \`${failureKey}\` recurred ${group.length} times across ${tasks} distinct tasks. Review the evidence, identify the root cause and durable prevention, then evolve or save the resulting learning.`,
      confidence: confidenceFor(tasks, 0.68),
      occurrenceCount: group.length,
      distinctTaskCount: tasks,
      evidence: evidence(group),
    });
  }

  const operationGroups = groupBy(
    events.filter((event) => event.outcome === "success"),
    (event) => event.operationKey,
  );
  for (const [operationKey, group] of operationGroups) {
    const tasks = distinctTaskCount(group);
    if (tasks < minDistinctTasks) continue;
    const routine = group.length >= minRoutineOccurrences ? routineStats(group) : null;
    if (routine && routine.meanMs >= minRoutineMeanIntervalMs && routine.coefficientOfVariation <= maxRoutineCoefficientOfVariation) {
      const cadence = cadenceLabel(routine.meanMs);
      candidates.push({
        key: `temporal-routine:${operationKey}`,
        kind: "temporal-routine",
        reviewKind: "job",
        title: `Routine candidate: ${operationKey}`,
        summary: `${group.length} occurrences follow a stable ${cadence} cadence.`,
        proposedContent: `Reviewed automation candidate: \`${operationKey}\` ran ${group.length} times at a stable ${cadence} cadence. Confirm the desired trigger, owner, side-effect approvals, and failure handling before scheduling it.`,
        confidence: confidenceFor(group.length, 0.72),
        occurrenceCount: group.length,
        distinctTaskCount: tasks,
        evidence: evidence(group),
      });
      continue;
    }
    candidates.push({
      key: `repeated-operation:${operationKey}`,
      kind: "repeated-operation",
      reviewKind: "skill",
      title: `Reusable workflow candidate: ${operationKey}`,
      summary: `${group.length} successful operations across ${tasks} distinct tasks repeat the same workflow.`,
      proposedContent: `Reviewed skill candidate: \`${operationKey}\` repeated ${group.length} times across ${tasks} distinct tasks. Distill the stable inputs, steps, verification, and safety gates into a reusable shared skill.`,
      confidence: confidenceFor(tasks, 0.64),
      occurrenceCount: group.length,
      distinctTaskCount: tasks,
      evidence: evidence(group),
    });
  }

  return {
    scanned: sourceEvents.length,
    eligible: events.length,
    excludedAsNoise: sourceEvents.length - events.length,
    candidates: candidates.sort((left, right) => right.confidence - left.confidence || right.occurrenceCount - left.occurrenceCount || left.key.localeCompare(right.key)),
  };
}
