import { createHash } from "node:crypto";
import {
  LOOP_TEMPLATES,
  buildLoopFromTemplate,
  type LoopTemplateId,
} from "@/lib/services/loops/loop-templates";
import type { KanbanLoopSpec } from "@/lib/types/kanban";

export type QueenBeeTaskLoopInput = {
  title: string;
  message: string;
  loop?: KanbanLoopSpec | null;
  loopTemplateId?: LoopTemplateId | null;
  now?: number;
};

export const QUEEN_BEE_LOOP_POLICY_VERSION = 1;

/** Validate the untrusted API value before it reaches the template registry. */
export function parseQueenBeeLoopTemplateId(value: unknown): LoopTemplateId | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(LOOP_TEMPLATES, value)) {
    throw new Error("loopTemplateId must name a registered Queen Bee loop template.");
  }
  return value as LoopTemplateId;
}

/**
 * Preserve caller authority: an explicit loop (including null to opt out) wins.
 * A template request asks the server to construct a fresh, pending-gate loop so
 * clients never need to duplicate verifier commands, rubrics, or contracts.
 */
export function resolveQueenBeeTaskLoop(input: QueenBeeTaskLoopInput): KanbanLoopSpec | undefined {
  if (input.loop !== undefined) return input.loop ?? undefined;
  if (!input.loopTemplateId) return undefined;
  return buildLoopFromTemplate({
    templateId: input.loopTemplateId,
    title: input.title,
    goal: input.message,
    successCriteria: defaultQueenBeeSuccessCriteria(input.loopTemplateId),
    handoffRules: defaultQueenBeeHandoffRules(input.loopTemplateId),
    evidenceRequired: defaultQueenBeeEvidence(input.loopTemplateId),
    now: input.now,
  });
}

/** Stable dedupe partition; timestamps inside a concrete LoopSpec are excluded. */
export function queenBeeLoopPolicyKey(
  input: Pick<QueenBeeTaskLoopInput, "loop" | "loopTemplateId">,
): string | undefined {
  if (input.loop === null) return `loop:none:v${QUEEN_BEE_LOOP_POLICY_VERSION}`;
  if (input.loop !== undefined) {
    const digest = createHash("sha256")
      .update(JSON.stringify(canonicalLoopPolicyValue(input.loop)))
      .digest("hex")
      .slice(0, 16);
    return `loop:explicit:${digest}:v${QUEEN_BEE_LOOP_POLICY_VERSION}`;
  }
  if (input.loopTemplateId) return `loop:template:${input.loopTemplateId}:v${QUEEN_BEE_LOOP_POLICY_VERSION}`;
  return undefined;
}

function canonicalLoopPolicyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalLoopPolicyValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["createdAt", "updatedAt", "discoveredAt", "generatedAt"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalLoopPolicyValue(child)]),
  );
}

export function queenBeeLoopSkills(templateId: LoopTemplateId | null | undefined): string[] {
  if (templateId === "app-build-harness") return ["engineering-discipline", "harness-engineering"];
  if (templateId === "engineering-discipline" || templateId === "code-fix") return ["engineering-discipline"];
  return [];
}

export function prdLoopTemplateForSkills(skills: readonly string[]): LoopTemplateId {
  if (skills.includes("writer")) return "content";
  if (skills.includes("research")) return "research";
  return "engineering-discipline";
}

export function buildQueenBeePrdTaskLoop(
  draft: { title: string; body: string; skills: string[] },
  now?: number,
): KanbanLoopSpec {
  const templateId = prdLoopTemplateForSkills(draft.skills);
  return buildLoopFromTemplate({
    templateId,
    title: draft.title,
    goal: `${draft.title}. Deliver the scoped PRD requirement and its acceptance criteria.`,
    successCriteria: [
      "The scoped PRD requirement is delivered without unrelated expansion.",
      "Every acceptance criterion in the task body is addressed with durable evidence.",
      templateId === "content"
        ? "The content artifact is complete, polished, and independently accepted."
        : templateId === "research"
          ? "Claims are supported by named sources or artifacts and independently accepted."
          : "Relevant baseline, focused tests, lint, types, and independent engineering review pass or precise pre-existing failures are recorded.",
    ],
    handoffRules: [
      "Preserve concurrent work and keep changes limited to this PRD child task.",
      "Do not commit, push, deploy, send, spend, delete, or fan out without the authority recorded on the task.",
      "Report the real entry path exercised, verification output, artifacts, known gaps, and rollback path.",
    ],
    evidenceRequired: [
      "The requirement and acceptance criteria covered by this result.",
      "Artifact paths, source links, command output, screenshots, or receipts appropriate to the work.",
      "A distinct independent evaluator receipt and an honest list of remaining gaps.",
    ],
    now,
  });
}

function defaultQueenBeeSuccessCriteria(templateId: LoopTemplateId): string[] {
  if (templateId === "app-build-harness") return [
    "The requested app is implemented as a runnable artifact in the assigned workspace.",
    "The core user workflow works through the real rendered entry path, including important failure and empty states.",
    "Focused verification, lint, types, browser checks, artifact checks, and a distinct independent evaluator pass.",
  ];
  return [
    "The requested outcome is delivered within the assigned scope.",
    "Required verifier gates and a distinct independent evaluator accept the result.",
  ];
}

function defaultQueenBeeHandoffRules(templateId: LoopTemplateId): string[] {
  return [
    "Separate planning, building, and independent evaluation roles when staffable.",
    "Parallel workers must receive non-overlapping scopes and report durable artifact paths or receipts back to the parent task.",
    "Preserve concurrent work; do not commit, push, deploy, send, spend, delete, or fan out unless the task carries that authority.",
    templateId === "app-build-harness"
      ? "Verify the app through its real rendered workflow and attach screenshots or equivalent artifact evidence for the evaluator."
      : "Verify through the real user or runtime entry path when practical.",
  ];
}

function defaultQueenBeeEvidence(templateId: LoopTemplateId): string[] {
  return [
    "Scope, constraints, assumptions, and rollback path.",
    "Baseline and final output from the relevant entry path.",
    "Red/green regression evidence or a concrete reason it does not apply.",
    templateId === "app-build-harness"
      ? "Runnable app artifact, browser-path evidence, screenshots, and focused test/lint/type output."
      : "Focused verification output and durable artifact paths or source links.",
    "Distinct independent evaluator verdict plus known gaps and repository state.",
  ];
}
