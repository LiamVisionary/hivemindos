import type { KanbanBoard, KanbanTask, KanbanTaskRun } from "@/lib/types/kanban";
import type { LoopEvalGate, LoopReceipt } from "@/lib/types/loops";
import { listLoopPatterns, type LoopPatternDefinition, type LoopReadinessLevel } from "@/lib/services/loops/pattern-registry";

export type LoopReadinessSignal = {
  id: string;
  title: string;
  present: boolean;
  score: number;
  maxScore: number;
  evidence: string[];
};

export type LoopReadinessFinding = {
  level: "ok" | "warn" | "fail";
  message: string;
};

export type LoopReadinessTotals = {
  tasks: number;
  loopTasks: number;
  evalGates: number;
  requiredEvalGates: number;
  passedEvalGates: number;
  receipts: number;
  runs: number;
  activeRuns: number;
  needsHuman: number;
  budgetedLoopTasks: number;
  worktreeLoopTasks: number;
  contractLoopTasks: number;
  rubricLoopTasks: number;
  queenBeeTasks: number;
  antiPatterns: number;
  experiments: number;
};

export type LoopContractSummary = {
  taskId: string;
  taskTitle: string;
  contractTitle?: string;
  plannerAssertions: string[];
  evaluatorPushback: string[];
  agreedDone: string[];
  artifacts: string[];
  rubricTitle?: string;
  rubricAxes: string[];
};

export type LoopReadinessReport = {
  generatedAt: string;
  score: number;
  level: LoopReadinessLevel;
  assessment: string;
  board?: {
    slug: string;
    name: string;
    updatedAt: number;
  };
  totals: LoopReadinessTotals;
  contracts: LoopContractSummary[];
  signals: LoopReadinessSignal[];
  findings: LoopReadinessFinding[];
  recommendations: string[];
  patterns: LoopPatternDefinition[];
};

export type LoopEngineeringArtifacts = {
  loopMd: string;
  stateMd: string;
  budgetMd: string;
  contractMd: string;
  runLogMd: string;
  registryYaml: string;
};

const RECENT_ACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;

export function buildLoopReadinessReport(input: { board?: KanbanBoard | null; now?: number } = {}): LoopReadinessReport {
  const board = input.board ?? null;
  const now = input.now ?? Date.now();
  const patterns = listLoopPatterns();
  const tasks = board?.tasks ?? [];
  const runs = board?.runs ?? [];
  const loopTasks = tasks.filter((task) => Boolean(task.loop));
  const gates = loopTasks.flatMap((task) => task.loop?.evalGates ?? []);
  const receipts = loopTasks.flatMap((task) => task.loopReceipts ?? []);
  const requiredGates = gates.filter((gate) => gate.required);
  const passedGates = gates.filter((gate) => gate.status === "passed");
  const needsHuman = tasks.filter((task) => task.status === "needs-human").length;
  const budgetedLoopTasks = loopTasks.filter(taskHasBudgetOrLimit);
  const worktreeLoopTasks = loopTasks.filter(taskHasWorktreeIsolation);
  const contractLoopTasks = loopTasks.filter((task) => task.loop?.contract);
  const rubricLoopTasks = loopTasks.filter((task) => task.loop?.evaluationRubric);
  const contracts = loopContractSummaries(loopTasks);
  const queenBeeTasks = tasks.filter((task) => /^queen-bee|^loop|^flow:/.test(task.source ?? "") || task.assignee === "queen-bee").length;
  const activeRuns = runs.filter((run) => run.status === "running").length;
  const recentRuns = runs.filter((run) => isRecent(run.startedAt, now) || isRecent(run.endedAt, now));
  const antiPatterns = loopTasks.reduce((sum, task) => sum + (task.loop?.antiPatterns?.length ?? 0), 0);
  const experiments = loopTasks.reduce((sum, task) => sum + (task.loop?.experiments?.length ?? 0), 0);

  const signals: LoopReadinessSignal[] = [];
  addSignal(signals, "pattern-registry", "Machine-readable pattern registry", patterns.length > 0, 8, patterns.map((pattern) => pattern.id));
  addSignal(signals, "work-board-state", "Durable Work Board state", Boolean(board), 8, board ? [`board:${board.meta.slug}`, `${tasks.length} task${plural(tasks.length)}`] : []);
  addSignal(signals, "loop-contracts", "Loop contracts attached to work", loopTasks.length > 0, 14, loopTasks.slice(0, 6).map((task) => `${task.id}: ${task.title}`));
  addSignal(signals, "eval-gates", "Eval gates define done", gates.length > 0, 12, gateEvidence(gates));
  addSignal(signals, "verification-receipts", "Receipts prove gates or outcomes", receipts.length > 0 || passedGates.length > 0, 10, receiptEvidence(receipts, passedGates));
  addSignal(signals, "run-history", "Run history is inspectable", runs.length > 0 || Boolean(board?.events?.length), 8, runEvidence(runs), runs.length ? 8 : board?.events?.length ? 4 : 0);
  addSignal(signals, "budget-limits", "Budgets and retry limits are recorded", budgetedLoopTasks.length > 0, 10, budgetedLoopTasks.slice(0, 6).map((task) => `${task.id}: ${budgetSummary(task)}`), proportionalScore(10, budgetedLoopTasks.length, loopTasks.length));
  addSignal(signals, "human-gates", "Human handoff gates exist", gates.some((gate) => gate.kind === "human") || needsHuman > 0 || loopTasks.some(taskMentionsHumanGate), 8, humanGateEvidence(gates, tasks));
  addSignal(signals, "queen-bee-coordination", "Queen Bee or flow coordination is active", queenBeeTasks > 0, 8, tasks.filter((task) => /^queen-bee|^loop|^flow:/.test(task.source ?? "") || task.assignee === "queen-bee").slice(0, 6).map((task) => `${task.id}: ${task.source || task.assignee}`));
  addSignal(signals, "worktree-isolation", "Code loops have isolation hints", worktreeLoopTasks.length > 0, 6, worktreeLoopTasks.slice(0, 6).map((task) => `${task.id}: ${task.workspace}`), proportionalScore(6, worktreeLoopTasks.length, loopTasks.length));
  addSignal(signals, "negotiated-contracts", "Planner/evaluator contracts are written", contractLoopTasks.length > 0, 6, contracts.slice(0, 6).map((item) => `${item.taskId}: ${item.contractTitle ?? item.taskTitle}`), proportionalScore(6, contractLoopTasks.length, loopTasks.length));
  addSignal(signals, "evaluator-rubrics", "Evaluator rubrics are attached", rubricLoopTasks.length > 0, 6, contracts.filter((item) => item.rubricTitle).slice(0, 6).map((item) => `${item.taskId}: ${item.rubricTitle}`), proportionalScore(6, rubricLoopTasks.length, loopTasks.length));
  addSignal(signals, "learning-memory", "Experiments and anti-patterns compound", experiments > 0 || antiPatterns > 0, 8, [`${experiments} experiment${plural(experiments)}`, `${antiPatterns} anti-pattern${plural(antiPatterns)}`]);

  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.score, 0));
  const hasActivity = recentRuns.length > 0 || (board?.events ?? []).some((event) => isRecent(event.createdAt, now));
  const allLoopTasksBudgeted = loopTasks.length > 0 && budgetedLoopTasks.length === loopTasks.length;
  const hasHumanGate = Boolean(signals.find((signal) => signal.id === "human-gates")?.present);
  const level = readinessLevel({
    score,
    hasBoard: Boolean(board),
    loopTasks: loopTasks.length,
    gates: gates.length,
    receipts: receipts.length + passedGates.length,
    allLoopTasksBudgeted,
    hasHumanGate,
    hasActivity,
  });
  const findings = buildFindings(signals, score, level);
  const recommendations = buildRecommendations(signals, level, loopTasks.length);

  return {
    generatedAt: new Date(now).toISOString(),
    score,
    level,
    assessment: assessmentFor(score, level),
    board: board ? { slug: board.meta.slug, name: board.meta.name, updatedAt: board.meta.updatedAt } : undefined,
    totals: {
      tasks: tasks.length,
      loopTasks: loopTasks.length,
      evalGates: gates.length,
      requiredEvalGates: requiredGates.length,
      passedEvalGates: passedGates.length,
      receipts: receipts.length,
      runs: runs.length,
      activeRuns,
      needsHuman,
      budgetedLoopTasks: budgetedLoopTasks.length,
      worktreeLoopTasks: worktreeLoopTasks.length,
      contractLoopTasks: contractLoopTasks.length,
      rubricLoopTasks: rubricLoopTasks.length,
      queenBeeTasks,
      antiPatterns,
      experiments,
    },
    contracts,
    signals,
    findings,
    recommendations,
    patterns,
  };
}

export function renderLoopEngineeringArtifacts(report: LoopReadinessReport, input: { title?: string } = {}): LoopEngineeringArtifacts {
  const title = input.title?.trim() || "HivemindOS Loop Engineering";
  return {
    loopMd: renderLoopMd(report, title),
    stateMd: renderStateMd(report, title),
    budgetMd: renderBudgetMd(report, title),
    contractMd: renderContractMd(report, title),
    runLogMd: renderRunLogMd(report, title),
    registryYaml: renderRegistryYaml(report.patterns),
  };
}

function addSignal(signals: LoopReadinessSignal[], id: string, title: string, present: boolean, maxScore: number, evidence: string[], score = present ? maxScore : 0) {
  signals.push({
    id,
    title,
    present,
    score: Math.max(0, Math.min(maxScore, Math.round(score))),
    maxScore,
    evidence: evidence.filter(Boolean).slice(0, 8),
  });
}

function readinessLevel(input: {
  score: number;
  hasBoard: boolean;
  loopTasks: number;
  gates: number;
  receipts: number;
  allLoopTasksBudgeted: boolean;
  hasHumanGate: boolean;
  hasActivity: boolean;
}): LoopReadinessLevel {
  if (input.score >= 78 && input.loopTasks > 0 && input.gates > 0 && input.receipts > 0 && input.allLoopTasksBudgeted && input.hasHumanGate && input.hasActivity) return "L3";
  if (input.score >= 58 && input.loopTasks > 0 && input.gates > 0) return "L2";
  if (input.score >= 38 && input.hasBoard) return "L1";
  return "L0";
}

function assessmentFor(score: number, level: LoopReadinessLevel): string {
  if (level === "L3") return "Unattended-capable structure is present: state, gates, receipts, budgets, activity, and human gates are all visible.";
  if (level === "L2") return "Assisted loop structure is present. Add budget coverage, human gates, worktree isolation, and recent receipt activity before unattended runs.";
  if (level === "L1") return "Report-ready loop state exists. Attach loop contracts and receipts before allowing agents to complete autonomous work.";
  return score > 0
    ? "Loop registry exists, but durable runtime state is not yet proving loop operation."
    : "No loop-readiness signals were found.";
}

function buildFindings(signals: LoopReadinessSignal[], score: number, level: LoopReadinessLevel): LoopReadinessFinding[] {
  const findings = signals.map((signal): LoopReadinessFinding => ({
    level: signal.present ? "ok" : signal.id === "loop-contracts" || signal.id === "eval-gates" ? "fail" : "warn",
    message: signal.present
      ? `${signal.title}: ${signal.evidence[0] ?? "present"}.`
      : `${signal.title}: missing.`,
  }));
  findings.unshift({ level: level === "L0" ? "warn" : "ok", message: `Loop readiness ${level} with score ${score}/100.` });
  return findings;
}

function buildRecommendations(signals: LoopReadinessSignal[], level: LoopReadinessLevel, loopTaskCount: number): string[] {
  const missing = new Set(signals.filter((signal) => !signal.present).map((signal) => signal.id));
  const recommendations: string[] = [];
  if (missing.has("loop-contracts")) recommendations.push("Create Work Board tasks through /api/loops or Queen Bee with a loop contract attached.");
  if (missing.has("eval-gates")) recommendations.push("Use built-in verifiers such as evidence receipts, tests, artifact existence, independent judge, and human approval.");
  if (missing.has("verification-receipts")) recommendations.push("Require agents to return loop-receipts evidence before marking loop-gated tasks done.");
  if (missing.has("budget-limits") && loopTaskCount > 0) recommendations.push("Set maxAttempts plus token or cost caps on loop templates before raising autonomy.");
  if (missing.has("human-gates")) recommendations.push("Add human approval or explicit handoff rules for risky side effects, budget exceptions, and ambiguous decisions.");
  if (missing.has("worktree-isolation")) recommendations.push("Use workspace: worktree or an equivalent isolated checkout for autonomous code-changing loops.");
  if (missing.has("negotiated-contracts")) recommendations.push("Attach a planner/evaluator contract snapshot before agents start long-running work.");
  if (missing.has("evaluator-rubrics")) recommendations.push("Attach an evaluator rubric for subjective product, design, content, and customer-facing loops.");
  if (missing.has("run-history")) recommendations.push("Let workers claim/complete tasks through the Work Board so run history is append-only and inspectable.");
  if (level !== "L3") recommendations.push("Export LOOP.md, STATE.md, loop-budget.md, and loop-run-log.md snapshots for human and external-agent inspection.");
  return recommendations;
}

function taskHasBudgetOrLimit(task: KanbanTask): boolean {
  const budget = task.loop?.budget;
  return Boolean(
    task.maxAttempts ||
      task.maxRuntimeMs ||
      budget?.maxAttempts ||
      budget?.maxRuntimeMs ||
      budget?.maxTokens ||
      budget?.maxCostUsd,
  );
}

function taskHasWorktreeIsolation(task: KanbanTask): boolean {
  return task.workspace === "worktree" || Boolean(task.loop?.handoffRules?.some((rule) => /worktree|isolated checkout/i.test(rule)));
}

function taskMentionsHumanGate(task: KanbanTask): boolean {
  return Boolean(task.loop?.handoffRules?.some((rule) => /human|approval|escalat|gate/i.test(rule)));
}

function gateEvidence(gates: LoopEvalGate[]): string[] {
  const counts = new Map<string, number>();
  for (const gate of gates) counts.set(gate.verifier ?? gate.kind, (counts.get(gate.verifier ?? gate.kind) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => `${name}:${count}`);
}

function receiptEvidence(receipts: LoopReceipt[], passedGates: LoopEvalGate[]): string[] {
  const receiptLines = receipts.slice(0, 6).map((receipt) => `${receipt.gateId ?? "receipt"}:${receipt.status}`);
  if (receiptLines.length) return receiptLines;
  return passedGates.slice(0, 6).map((gate) => `${gate.id}:passed`);
}

function runEvidence(runs: KanbanTaskRun[]): string[] {
  return runs.slice(0, 6).map((run) => `${run.id}:${run.status}${run.assignee ? `:${run.assignee}` : ""}`);
}

function budgetSummary(task: KanbanTask): string {
  const budget = task.loop?.budget;
  return [
    `attempts ${task.maxAttempts ?? budget?.maxAttempts ?? "n/a"}`,
    budget?.maxTokens ? `tokens ${budget.maxTokens}` : "",
    budget?.maxCostUsd ? `cost $${budget.maxCostUsd}` : "",
    task.maxRuntimeMs ?? budget?.maxRuntimeMs ? `runtime ${Math.round((task.maxRuntimeMs ?? budget?.maxRuntimeMs ?? 0) / 1000)}s` : "",
  ].filter(Boolean).join(", ");
}

function humanGateEvidence(gates: LoopEvalGate[], tasks: KanbanTask[]): string[] {
  const humanGates = gates.filter((gate) => gate.kind === "human").map((gate) => gate.title);
  const blocked = tasks.filter((task) => task.status === "needs-human").map((task) => `${task.id}: ${task.title}`);
  return [...humanGates, ...blocked].slice(0, 8);
}

function loopContractSummaries(tasks: KanbanTask[]): LoopContractSummary[] {
  return tasks
    .filter((task) => task.loop?.contract || task.loop?.evaluationRubric)
    .slice(0, 24)
    .map((task) => ({
      taskId: task.id,
      taskTitle: task.title,
      contractTitle: task.loop?.contract?.title,
      plannerAssertions: task.loop?.contract?.plannerAssertions ?? [],
      evaluatorPushback: task.loop?.contract?.evaluatorPushback ?? [],
      agreedDone: task.loop?.contract?.agreedDone ?? [],
      artifacts: task.loop?.contract?.artifacts ?? [],
      rubricTitle: task.loop?.evaluationRubric?.title,
      rubricAxes: task.loop?.evaluationRubric?.axes.map((axis) => `${axis.title} (${Math.round(axis.weight * 100)}%): ${axis.description}`) ?? [],
    }));
}

function proportionalScore(maxScore: number, count: number, total: number): number {
  if (!total) return 0;
  return Math.round(maxScore * Math.min(1, count / total));
}

function isRecent(value: number | undefined, now: number): boolean {
  return Boolean(value && now - value <= RECENT_ACTIVITY_MS);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

function renderLoopMd(report: LoopReadinessReport, title: string): string {
  return [
    `# LOOP.md - ${title}`,
    "",
    "Generated from HivemindOS loop state. Use this as an operator-readable snapshot; the Work Board remains the live source of truth.",
    "",
    "## Readiness",
    "",
    `- Level: ${report.level}`,
    `- Score: ${report.score}/100`,
    `- Assessment: ${report.assessment}`,
    report.board ? `- Board: ${report.board.name} (${report.board.slug})` : "- Board: not loaded",
    "",
    "## Active Signals",
    "",
    ...report.signals.map((signal) => `- ${signal.present ? "[x]" : "[ ]"} ${signal.title}: ${signal.score}/${signal.maxScore}${signal.evidence.length ? ` - ${signal.evidence.join("; ")}` : ""}`),
    "",
    "## Pattern Registry",
    "",
    "| Pattern | Mode | Cadence | Risk | Week one |",
    "| --- | --- | --- | --- | --- |",
    ...report.patterns.map((pattern) => `| ${pattern.name} | ${pattern.defaultMode} | ${pattern.cadence} | ${pattern.risk} | ${pattern.weekOneMode} |`),
    "",
    "## Human Gates",
    "",
    "Risky side effects should move through explicit approval gates. Secrets, auth, payments, deploys, deletes, external sends, large code changes, and repeated failed attempts should not be completed unattended.",
    "",
  ].join("\n");
}

function renderStateMd(report: LoopReadinessReport, title: string): string {
  return [
    `# STATE.md - ${title}`,
    "",
    `Last generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Readiness: ${report.level} (${report.score}/100)`,
    `- Loop tasks: ${report.totals.loopTasks}/${report.totals.tasks}`,
    `- Eval gates: ${report.totals.passedEvalGates}/${report.totals.evalGates} passed`,
    `- Receipts: ${report.totals.receipts}`,
    `- Runs: ${report.totals.runs} (${report.totals.activeRuns} active)`,
    `- Needs human: ${report.totals.needsHuman}`,
    `- Written contracts: ${report.totals.contractLoopTasks}/${report.totals.loopTasks}`,
    `- Evaluator rubrics: ${report.totals.rubricLoopTasks}/${report.totals.loopTasks}`,
    "",
    "## Findings",
    "",
    ...report.findings.map((finding) => `- ${finding.level.toUpperCase()}: ${finding.message}`),
    "",
    "## Next Actions",
    "",
    ...(report.recommendations.length ? report.recommendations.map((item) => `- [ ] ${item}`) : ["- [x] No immediate loop-readiness recommendations."]),
    "",
  ].join("\n");
}

function renderContractMd(report: LoopReadinessReport, title: string): string {
  const sections = report.contracts.length
    ? report.contracts.flatMap((item) => [
      `## ${item.taskTitle}`,
      "",
      `- Task: ${item.taskId}`,
      item.contractTitle ? `- Contract: ${item.contractTitle}` : "- Contract: not attached",
      item.rubricTitle ? `- Rubric: ${item.rubricTitle}` : "- Rubric: not attached",
      "",
      "### Planner Assertions",
      "",
      ...(item.plannerAssertions.length ? item.plannerAssertions.map((line) => `- ${line}`) : ["- None recorded."]),
      "",
      "### Evaluator Pushback",
      "",
      ...(item.evaluatorPushback.length ? item.evaluatorPushback.map((line) => `- ${line}`) : ["- None recorded."]),
      "",
      "### Agreed Done",
      "",
      ...(item.agreedDone.length ? item.agreedDone.map((line) => `- ${line}`) : ["- None recorded."]),
      "",
      "### Expected Artifacts",
      "",
      ...(item.artifacts.length ? item.artifacts.map((line) => `- ${line}`) : ["- None recorded."]),
      "",
      "### Evaluator Rubric",
      "",
      ...(item.rubricAxes.length ? item.rubricAxes.map((line) => `- ${line}`) : ["- None recorded."]),
      "",
    ])
    : [
      "## No Contract Snapshots",
      "",
      "No loop tasks currently expose planner/evaluator contract snapshots or evaluator rubrics.",
      "",
    ];
  return [
    `# contract.md - ${title}`,
    "",
    "Generated from HivemindOS loop state. This file is a portable contract snapshot; the Work Board remains the live source of truth.",
    "",
    `- Written contracts: ${report.totals.contractLoopTasks}/${report.totals.loopTasks}`,
    `- Evaluator rubrics: ${report.totals.rubricLoopTasks}/${report.totals.loopTasks}`,
    "",
    ...sections,
  ].join("\n");
}

function renderBudgetMd(report: LoopReadinessReport, title: string): string {
  const dailyCap = report.patterns.reduce((sum, pattern) => sum + pattern.cost.suggestedDailyCap, 0);
  return [
    `# loop-budget.md - ${title}`,
    "",
    "Budget source: HivemindOS loop pattern registry plus per-task loop budgets where present.",
    "",
    "## Aggregate Defaults",
    "",
    `- Suggested aggregate daily token cap across built-in patterns: ${dailyCap}`,
    `- Budgeted loop tasks currently visible: ${report.totals.budgetedLoopTasks}/${report.totals.loopTasks}`,
    "- On exceed: pause autonomous loop scheduling, move ambiguous work to Needs You, and record a Work Board comment.",
    "- Max repeated failed attempts before human handoff: use each loop task's maxAttempts.",
    "",
    "## Pattern Caps",
    "",
    "| Pattern | No-op | Report | Action | Suggested daily cap | Early exit |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...report.patterns.map((pattern) => `| ${pattern.name} | ${pattern.cost.tokensNoop} | ${pattern.cost.tokensReport} | ${pattern.cost.tokensAction} | ${pattern.cost.suggestedDailyCap} | ${pattern.cost.earlyExitRequired ? "yes" : "no"} |`),
    "",
  ].join("\n");
}

function renderRunLogMd(report: LoopReadinessReport, title: string): string {
  return [
    `# loop-run-log.md - ${title}`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "This snapshot summarizes Work Board run history. The live append-only run records stay on the HivemindOS Work Board.",
    "",
    "## Totals",
    "",
    `- Runs: ${report.totals.runs}`,
    `- Active runs: ${report.totals.activeRuns}`,
    `- Receipts: ${report.totals.receipts}`,
    `- Needs human: ${report.totals.needsHuman}`,
    "",
    "## Signal Log",
    "",
    ...report.signals.map((signal) => `- ${signal.id}: ${signal.present ? "present" : "missing"} (${signal.score}/${signal.maxScore})`),
    "",
  ].join("\n");
}

function renderRegistryYaml(patterns: LoopPatternDefinition[]): string {
  return [
    "# Generated from HivemindOS loop pattern registry.",
    "patterns:",
    ...patterns.flatMap((pattern) => [
      `  - id: ${yamlScalar(pattern.id)}`,
      `    name: ${yamlScalar(pattern.name)}`,
      `    goal: ${yamlScalar(pattern.description)}`,
      `    cadence: ${yamlScalar(pattern.cadence)}`,
      `    risk: ${yamlScalar(pattern.risk)}`,
      `    default_mode: ${yamlScalar(pattern.defaultMode)}`,
      `    week_one_mode: ${yamlScalar(pattern.weekOneMode)}`,
      `    token_cost: ${yamlScalar(pattern.tokenCost)}`,
      `    skills: [${pattern.verifierIds.map(yamlScalar).join(", ")}]`,
      `    phases: [${pattern.phases.map(yamlScalar).join(", ")}]`,
      `    human_gates: [${pattern.humanGates.map(yamlScalar).join(", ")}]`,
      "    cost:",
      `      tokens_noop: ${pattern.cost.tokensNoop}`,
      `      tokens_report: ${pattern.cost.tokensReport}`,
      `      tokens_action: ${pattern.cost.tokensAction}`,
      `      suggested_daily_cap: ${pattern.cost.suggestedDailyCap}`,
      `      early_exit_required: ${pattern.cost.earlyExitRequired}`,
    ]),
    "",
  ].join("\n");
}

function yamlScalar(value: string): string {
  return /^[a-zA-Z0-9_.:-]+$/.test(value) ? value : JSON.stringify(value);
}
