import type { LoopCapabilityCapital, LoopReceipt, LoopSpec } from "@/lib/types/loops";

export type LoopMetricTask = {
  status?: string;
  result?: string;
  body?: string;
  skills?: string[];
  deliverables?: unknown[];
  loop?: LoopSpec;
  loopReceipts?: LoopReceipt[];
  completedAt?: number;
};

export type LoopMetricAgent = {
  runtime?: string;
};

export type ComputeLoopCapabilityCapitalInput = {
  tasks: LoopMetricTask[];
  agents?: LoopMetricAgent[];
  totalSpentUsd?: number;
  autonomyActive?: boolean;
  emptyLoopNote?: string;
  loopAttachmentNoun?: string;
};

export function computeLoopCapabilityCapital(input: ComputeLoopCapabilityCapitalInput): LoopCapabilityCapital {
  const tasks = input.tasks;
  const loops = tasks.map((task) => task.loop).filter(Boolean) as LoopSpec[];
  const done = tasks.filter((task) => task.status === "done");
  const now = Date.now();
  const recentDone = done.filter((task) => task.completedAt && now - task.completedAt <= 14 * 24 * 60 * 60 * 1000);
  const outputTasks = done.filter(taskHasDurableOutput);
  const evalGates = loops.reduce((n, loop) => n + (loop.evalGates?.length ?? 0), 0);
  const passedEvalGates = loops.reduce(
    (n, loop) => n + (loop.evalGates?.filter((gate) => gate.status === "passed").length ?? 0),
    0,
  );
  const experiments = loops.reduce((n, loop) => n + (loop.observation?.totalExperiments ?? loop.experiments?.length ?? 0), 0);
  const committedExperiments = loops.reduce(
    (n, loop) => n + (loop.observation?.committedExperiments ?? loop.experiments?.filter((item) => item.status === "committed").length ?? 0),
    0,
  );
  const frontierCandidates = loops.reduce((n, loop) => n + (loop.observation?.frontier?.length ?? 0), 0);
  const antiPatterns = loops.reduce((n, loop) => n + (loop.observation?.antiPatternCount ?? loop.antiPatterns?.length ?? 0), 0);
  const workflowAssets = new Set(done.flatMap((task) => task.skills ?? []).filter((skill) => skill && skill !== "company-goal")).size + committedExperiments;
  const learningAssets = outputTasks.length + committedExperiments + antiPatterns;
  const distillationQueue = done.filter((task) => !task.loopReceipts?.some((receipt) => /distill|learn|memory/i.test(receipt.summary))).length;
  const spendEfficiency = input.totalSpentUsd && input.totalSpentUsd > 0
    ? Math.round((learningAssets / input.totalSpentUsd) * 100) / 100
    : null;
  const runtimeCount = new Set((input.agents ?? []).map((agent) => agent.runtime).filter(Boolean)).size;
  const hasEvo = (input.agents ?? []).some((agent) => agent.runtime?.toLowerCase() === "evo") || loops.some((loop) => loop.frontierStrategy?.kind === "pareto_per_task");
  const modelIndependence = clamp((runtimeCount > 0 ? 35 : 0) + Math.min(runtimeCount, 3) * 15 + (hasEvo ? 15 : 0) + (evalGates > 0 ? 15 : 0));
  const gateScore = evalGates > 0 ? Math.round((passedEvalGates / evalGates) * 100) : loops.length ? 35 : 0;
  const score = clamp(
    Math.round(
      Math.min(35, learningAssets * 7) +
        Math.min(20, workflowAssets * 4) +
        Math.min(15, experiments * 2) +
        Math.min(10, frontierCandidates * 2) +
        Math.min(10, antiPatterns * 3) +
        Math.min(10, Math.round(gateScore / 10)),
    ),
  );

  const notes = [
    loops.length
      ? `${loops.length} optimizer loop${loops.length === 1 ? "" : "s"} attached to ${input.loopAttachmentNoun ?? "work"}.`
      : input.emptyLoopNote ?? "Attach loop contracts to work to build reusable learning.",
    evalGates ? `${passedEvalGates}/${evalGates} eval gate${evalGates === 1 ? "" : "s"} passed or waiting for evidence.` : "No eval gates have been recorded yet.",
    distillationQueue ? `${distillationQueue} completed task${distillationQueue === 1 ? "" : "s"} ready for reviewed memory distillation.` : "Completed work is already reflected in receipts or no work is done yet.",
  ];

  if (input.autonomyActive) notes.push("Autonomy is on; idle crews keep receiving fresh work toward the operating goal.");

  return {
    score,
    learningAssets,
    workflowAssets,
    evalGates,
    passedEvalGates,
    experiments,
    committedExperiments,
    frontierCandidates,
    antiPatterns,
    distillationQueue,
    learningVelocity: recentDone.length,
    spendEfficiency,
    modelIndependence,
    notes,
  };
}

function taskHasDurableOutput(task: LoopMetricTask): boolean {
  return Boolean(
    task.result?.trim() ||
      task.body?.includes("Deliverable:") ||
      task.body?.includes("Result:") ||
      (task.deliverables?.length ?? 0) > 0,
  );
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}
