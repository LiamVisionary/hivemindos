import type { KanbanLoopReceipt, KanbanTask } from "@/lib/types/kanban";
import {
  evaluateCompletionEvent,
  type EvaluationJudgeVerdict,
} from "@/lib/services/evaluation/control-plane";

export async function evaluateKanbanCompletion(input: {
  task: KanbanTask;
  receipts: KanbanLoopReceipt[];
  result: string;
  runId: string;
  startedAt?: number;
  completedAt: number;
}) {
  const { task } = input;
  return evaluateCompletionEvent({
    id: input.runId,
    surface: task.source?.startsWith("company:") || task.tenant?.startsWith("company:") ? "company" : "work-board",
    status: "completed",
    observed: true,
    output: input.result,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    rubric: task.loop?.evaluationRubric,
    metadata: { taskId: task.id },
  }, evaluationDependenciesFromReceipts(task, input.receipts));
}

function evaluationDependenciesFromReceipts(task: KanbanTask, receipts: KanbanLoopReceipt[]) {
  const judgeGateIds = new Set(task.loop?.evalGates.filter((gate) => gate.kind === "agent").map((gate) => gate.id) ?? []);
  const receipt = receipts.find((candidate) => candidate.status === "passed" && candidate.gateId && judgeGateIds.has(candidate.gateId));
  if (!receipt) return {};
  const metadata = receipt.metadata as {
    confidence?: unknown;
    axes?: unknown;
    evaluator?: unknown;
  } | undefined;
  const evaluator = metadata?.evaluator && typeof metadata.evaluator === "object"
    ? metadata.evaluator as EvaluationJudgeVerdict["evaluator"]
    : { agentId: "unknown", independent: false };
  const axes = Array.isArray(metadata?.axes)
    ? metadata.axes.flatMap((axis) => {
      if (!axis || typeof axis !== "object") return [];
      const value = axis as { id?: unknown; score?: unknown; evidence?: unknown };
      if (typeof value.id !== "string" || !Number.isFinite(Number(value.score))) return [];
      return [{
        id: value.id,
        score: Number(value.score),
        evidence: Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string") : [],
      }];
    })
    : [];
  return {
    judge: async (): Promise<EvaluationJudgeVerdict> => ({
      verdict: "accepted",
      confidence: Number.isFinite(Number(metadata?.confidence)) ? Number(metadata?.confidence) : 1,
      axes,
      summary: receipt.summary,
      evaluator,
    }),
  };
}
