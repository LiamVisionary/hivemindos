import { createTask } from "@/lib/services/kanban/local-kanban-store";
import { titleTokens } from "@/lib/services/company-task-dedup";
import type { QueenBeeOptions, QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { chooseQueenBeeDelegate } from "@/lib/services/queen-bee/router";
import { readQueenBeeOutcomeStats } from "@/lib/services/queen-bee/outcome-stats";
import { readProjectRegistry } from "@/lib/services/projects/project-registry";
import type { KanbanPriority } from "@/lib/types/kanban";

export type QueenBeePrdDecompositionInput = QueenBeeOptions & {
  prd: string;
  title?: string | null;
  source?: string | null;
  priority?: KanbanPriority;
  projectId?: string | null;
  fleetSnapshot?: QueenBeeFleetMachine[] | null;
  maxTasks?: number;
  preview?: boolean;
};

export type QueenBeePrdTaskDraft = {
  title: string;
  body: string;
  skills: string[];
  dependsOnDraftIndexes: number[];
};

function cleanLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function prdTitle(prd: string, fallback?: string | null) {
  const explicit = fallback?.trim();
  if (explicit) return explicit;
  const heading = prd.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/^prd\s*[:-]\s*/i, "").trim();
  return cleanLines(prd)[0]?.replace(/^prd\s*[:-]\s*/i, "").slice(0, 120) || "Imported PRD";
}

function sectionMap(prd: string) {
  const sections = new Map<string, string[]>();
  let current = "overview";
  sections.set(current, []);
  for (const rawLine of prd.split(/\r?\n/)) {
    const heading = rawLine.match(/^#{1,4}\s+(.+)$/)?.[1]?.trim();
    if (heading) {
      current = heading.toLowerCase();
      sections.set(current, []);
      continue;
    }
    const line = rawLine.trim();
    if (line) sections.get(current)?.push(line);
  }
  return sections;
}

function matchingSection(sections: Map<string, string[]>, patterns: RegExp[]) {
  for (const [heading, lines] of sections) {
    if (patterns.some((pattern) => pattern.test(heading))) return lines;
  }
  return [];
}

function bulletText(line: string) {
  return line
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .trim();
}

function candidateRequirements(prd: string, maxTasks: number) {
  const sections = sectionMap(prd);
  const preferred = [
    ...matchingSection(sections, [/requirement/, /scope/, /feature/, /user stor/, /milestone/, /task/]),
    ...matchingSection(sections, [/acceptance/, /success/, /deliverable/]),
  ];
  const bulletCandidates = (preferred.length ? preferred : cleanLines(prd))
    .filter((line) => /^([-*+]|\d+[.)]|\[[ xX]\])\s+/.test(line))
    .map(bulletText)
    .filter((line) => line.length >= 8);
  if (bulletCandidates.length) return [...new Set(bulletCandidates)].slice(0, maxTasks);

  return cleanLines(prd)
    .map((line) => line.replace(/^#{1,4}\s+/, ""))
    .filter((line) => line.length >= 24 && !/^prd\b/i.test(line))
    .slice(0, maxTasks);
}

function acceptanceCriteria(prd: string) {
  const sections = sectionMap(prd);
  const lines = matchingSection(sections, [/acceptance/, /success/, /done/, /verification/]);
  return lines.map(bulletText).filter((line) => line.length >= 6).slice(0, 8);
}

function taskTitle(requirement: string, index: number) {
  const trimmed = requirement.replace(/[.:;]\s*$/, "").trim();
  if (/^(build|add|create|implement|wire|design|test|document|ship)\b/i.test(trimmed)) {
    return trimmed.slice(0, 110);
  }
  return `${index + 1}. ${trimmed.slice(0, 96)}`;
}

function workerSkills(requirement: string) {
  const text = requirement.toLowerCase();
  if (/test|qa|acceptance|verify|coverage/.test(text)) return ["qa"];
  if (/doc|copy|release note|guide/.test(text)) return ["writer"];
  if (/deploy|service|worker|cloudflare|n8n|docker|ops/.test(text)) return ["ops"];
  if (/research|compare|audit|catalog|mcp/.test(text)) return ["research"];
  return ["code"];
}

// Tokens that mark a requirement AS verification work; they never link a QA draft
// to a specific build draft ("test the checkout flow" links via "checkout", not "test").
const QA_GENERIC_TOKENS = new Set([
  "test", "tests", "testing", "tested", "verify", "verified", "verification",
  "acceptance", "coverage", "harden", "criteria",
]);

function isBuildClass(skills: readonly string[]): boolean {
  return skills.includes("code") || skills.includes("ops");
}

/**
 * Dependency edges for a QA-classified draft: the earlier build (code/ops) drafts
 * it verifies. A verification bullet that names a specific build requirement
 * (shared meaningful token) depends on exactly those; one that names no target
 * verifies the build work as a whole and depends on every earlier build draft.
 * Only earlier indexes are eligible — createQueenBeePrdTasks resolves parent ids
 * in draft order, and board parent-gating needs the parent to exist first.
 */
function qaTargetIndexes(requirements: readonly string[], skillsByIndex: readonly string[][], index: number): number[] {
  const buildIndexes: number[] = [];
  for (let i = 0; i < index; i += 1) {
    if (isBuildClass(skillsByIndex[i]!)) buildIndexes.push(i);
  }
  if (!buildIndexes.length) return [];
  const qaTokens = [...titleTokens(requirements[index]!)].filter((token) => !QA_GENERIC_TOKENS.has(token));
  const matched = buildIndexes.filter((i) => {
    const buildTokens = titleTokens(requirements[i]!);
    return qaTokens.some((token) => buildTokens.has(token));
  });
  return matched.length ? matched : buildIndexes;
}

function taskBody(input: { requirement: string; title: string; source: string; criteria: string[]; index: number }) {
  const criteria = input.criteria.length
    ? input.criteria.map((criterion) => `- ${criterion}`).join("\n")
    : "- The task is implemented, verified, and documented in the Work Board result.";
  return [
    `Source PRD: ${input.source}`,
    "",
    "Requirement",
    input.requirement,
    "",
    "Acceptance criteria",
    criteria,
    "",
    "Decomposition note",
    `Generated by Queen Bee PRD decomposition as task ${input.index + 1}. Keep changes scoped to this requirement and record verification in the task result.`,
  ].join("\n");
}

export function decomposePrdToTaskDrafts(prd: string, options: { title?: string | null; source?: string | null; maxTasks?: number } = {}) {
  const maxTasks = Math.max(1, Math.min(options.maxTasks ?? 12, 24));
  const title = prdTitle(prd, options.title);
  const source = options.source?.trim() || title;
  const criteria = acceptanceCriteria(prd);
  const requirements = candidateRequirements(prd, maxTasks);
  const skillsByIndex = requirements.map((requirement) => workerSkills(requirement));
  // Independent by default so the board runs the epic as a parallel DAG. The only
  // real edges are verification ones: QA drafts wait for the build drafts they
  // verify. (The old blanket chain — each task depending on its predecessor —
  // serialized 12-24 task epics for no content reason.)
  const drafts: QueenBeePrdTaskDraft[] = requirements.map((requirement, index) => ({
    title: taskTitle(requirement, index),
    body: taskBody({ requirement, title, source, criteria, index }),
    skills: ["prd-decomposition", ...skillsByIndex[index]!],
    dependsOnDraftIndexes: skillsByIndex[index]!.includes("qa")
      ? qaTargetIndexes(requirements, skillsByIndex, index)
      : [],
  }));
  return { title, source, criteria, drafts };
}

export async function createQueenBeePrdTasks(input: QueenBeePrdDecompositionInput) {
  const prd = input.prd?.trim();
  if (!prd) throw new Error("PRD text is required.");
  const decomposition = decomposePrdToTaskDrafts(prd, {
    title: input.title,
    source: input.source,
    maxTasks: input.maxTasks,
  });
  if (input.preview) return { created: false, decomposition, epic: null, tasks: [] };

  const projectRegistry = await readProjectRegistry({ vaultPath: input.vaultPath }).catch(() => ({ projects: [] }));
  const outcomes = await readQueenBeeOutcomeStats().catch(() => ({}));
  const epicResult = await createTask(null, {
    title: `PRD: ${decomposition.title}`,
    body: [
      `Source: ${decomposition.source}`,
      "",
      "Queen Bee decomposed this PRD into linked implementation tasks.",
      "",
      "Acceptance criteria",
      decomposition.criteria.length ? decomposition.criteria.map((criterion) => `- ${criterion}`).join("\n") : "- Child tasks complete with verification.",
    ].join("\n"),
    status: "ideas",
    priority: input.priority || "normal",
    projectId: input.projectId?.trim() || undefined,
    skills: ["prd-decomposition", "planning"],
    idempotencyKey: `queen-bee:prd:${decomposition.title.toLowerCase()}:${decomposition.drafts.length}`,
  }, input);

  const createdTasks: Array<{ id: string; title: string; created: boolean }> = [];
  const draftIdByIndex = new Map<number, string>();
  for (let index = 0; index < decomposition.drafts.length; index += 1) {
    const draft = decomposition.drafts[index]!;
    const delegation = chooseQueenBeeDelegate({
      title: draft.title,
      body: draft.body,
      skills: draft.skills,
      projectRegistry,
    }, input.fleetSnapshot ?? [], { outcomes });
    const parentIds = draft.dependsOnDraftIndexes.flatMap((draftIndex) => {
      const id = draftIdByIndex.get(draftIndex);
      return id ? [id] : [];
    });
    const taskResult = await createTask(null, {
      title: draft.title,
      body: [
        draft.body,
        "",
        `PRD epic: ${epicResult.task.id}`,
        delegation.agent ? `Suggested delegate: ${delegation.agent.name || delegation.agent.id || delegation.agent.agentId}` : "",
        delegation.machine ? `Suggested machine: ${delegation.machine.device?.name || delegation.machine.key || "unknown"}` : "",
      ].filter(Boolean).join("\n"),
      status: "ready",
      priority: input.priority || "normal",
      projectId: input.projectId?.trim() || undefined,
      assignee: delegation.agent?.name || delegation.agent?.id || delegation.agent?.agentId || undefined,
      targetMachine: delegation.machine ? {
        key: delegation.machine.key || delegation.machine.device?.machineId || delegation.machine.device?.name || "unknown",
        name: delegation.machine.device?.name || delegation.machine.key || "Unknown machine",
        collectorUrl: delegation.machine.device?.collectorUrl,
      } : null,
      skills: draft.skills,
      parents: parentIds,
      idempotencyKey: `queen-bee:prd:${decomposition.title.toLowerCase()}:task:${index}:${draft.title.toLowerCase()}`,
    }, input);
    draftIdByIndex.set(index, taskResult.task.id);
    createdTasks.push({ id: taskResult.task.id, title: taskResult.task.title, created: taskResult.created });
  }

  return {
    created: true,
    decomposition,
    epic: { id: epicResult.task.id, title: epicResult.task.title, created: epicResult.created },
    tasks: createdTasks,
  };
}
