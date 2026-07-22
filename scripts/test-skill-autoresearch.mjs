#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  SKILL_AUTORESEARCH_VARIANTS,
  buildSkillAutoresearchLoop,
  buildSkillAutoresearchPlan,
  detectSkillAutoresearchCandidates,
  selectSkillAutoresearchBackend,
} = await import("../src/lib/services/skills/skill-autoresearch-policy.ts");
const { buildOperatingUnitLearningLoop } = await import("../src/lib/services/loops/index.ts");

const now = 1_800_000_000_000;

assert.deepEqual(
  SKILL_AUTORESEARCH_VARIANTS.map((variant) => variant.id),
  ["better-inputs", "sharper-output", "more-robust", "rethink"],
  "the built-in mechanism should preserve four independent improvement theses",
);

const nativeBackend = selectSkillAutoresearchBackend({
  preference: "auto",
  evoInstalled: false,
  repoRoot: "/tmp/project",
  benchmarkCommand: "pnpm test:skill",
});
assert.equal(nativeBackend.id, "hivemind-native");
assert.equal(nativeBackend.ready, true);
assert.match(nativeBackend.reason, /Evo is not installed/i);

const unmeasuredBackend = selectSkillAutoresearchBackend({
  preference: "auto",
  evoInstalled: true,
  repoRoot: "/tmp/project",
});
assert.equal(unmeasuredBackend.id, "hivemind-native");
assert.match(unmeasuredBackend.reason, /benchmark/i);

const evoBackend = selectSkillAutoresearchBackend({
  preference: "auto",
  evoInstalled: true,
  evoWorkspaceInitialized: false,
  repoRoot: "/tmp/project",
  benchmarkCommand: "pnpm test:skill",
});
assert.equal(evoBackend.id, "evo");
assert.equal(evoBackend.ready, true);
assert.equal(evoBackend.requiresInitialization, true);
assert.match(evoBackend.reason, /initialize/i);

const plan = buildSkillAutoresearchPlan({
  skillSlug: "research-brief",
  targetPath: "Skills/research-brief/SKILL.md",
  symptom: "Repeated low-signal research briefs.",
  backend: evoBackend,
  benchmarkCommand: "pnpm test:research-brief",
  now,
});
assert.equal(plan.applyPolicy, "review-gated");
assert.equal(plan.variants.length, 4);
assert.equal(plan.rubric.axes.find((axis) => axis.id === "improvement")?.weight, 0.3);
assert(plan.rubric.axes.every((axis) => typeof axis.scoreFloor === "number"), "each scoring axis should have a regression floor");
assert.equal(plan.harnessContract.worker.model, "fixed-worker-selected-at-dispatch");
assert.equal(plan.harnessContract.targetRevision, "Skills/research-brief/SKILL.md");
assert.match(plan.harnessIntervention.mechanism, /baseline and treatment/i);

const loop = buildSkillAutoresearchLoop(plan, now);
assert.equal(loop.mode, "optimizer");
assert.equal(loop.benchmark?.command, "pnpm test:research-brief");
assert.equal(loop.experiments?.length, 4);
assert(loop.evalGates.some((gate) => gate.verifier === "evo:score" && gate.required), "the winner requires a server-authoritative score receipt");
assert(loop.evalGates.some((gate) => gate.verifier === "agent:judge" && gate.required), "the winner requires an independent review");
assert(loop.handoffRules?.some((rule) => /do not overwrite/i.test(rule)), "the target should remain unchanged until review");
assert(loop.handoffRules?.some((rule) => /harness experiment ledger/i.test(rule)), "skill autoresearch should produce reusable harness evidence");

const baseEvent = {
  runtime: "codex",
  status: "failure",
  event: "task-failed",
  skillSlug: "research-brief",
};
const events = [1, 2, 3].map((index) => ({
  ...baseEvent,
  id: `event-${index}`,
  taskId: `task-${index}`,
  taskSource: index === 3 ? "company:acme:run-1" : `work-board:task-${index}`,
  companyId: index === 3 ? "acme" : undefined,
  note: `Attempt ${index} produced low-signal output.`,
  createdAt: new Date(now + index * 1_000).toISOString(),
}));

assert.equal(detectSkillAutoresearchCandidates(events.slice(0, 2)).length, 0, "two failures should not create noise");
const candidates = detectSkillAutoresearchCandidates(events);
assert.equal(candidates.length, 1);
assert.equal(candidates[0].skillSlug, "research-brief");
assert.equal(candidates[0].failureCount, 3);
assert.deepEqual(candidates[0].companyIds, ["acme"]);

const correctedExecution = detectSkillAutoresearchCandidates([
  ...events,
  {
    ...baseEvent,
    id: "event-3-corrected",
    event: "action-completed",
    status: "success",
    taskId: "task-3",
    taskSource: "company:acme:run-1",
    createdAt: new Date(now + 4_000).toISOString(),
  },
]);
assert.equal(
  correctedExecution.length,
  0,
  "the latest outcome for one execution should correct its earlier failure instead of double-counting it",
);

const alreadySuggested = detectSkillAutoresearchCandidates([
  ...events,
  {
    id: "suggested",
    skillSlug: "research-brief",
    event: "improvement-suggested",
    status: "review",
    taskSource: "autoresearch",
    createdAt: new Date(now + 10_000).toISOString(),
  },
]);
assert.equal(alreadySuggested.length, 0, "a newer pending suggestion should suppress duplicates");

const suggestion = {
  id: "suggested-cycle-one",
  skillSlug: "research-brief",
  event: "improvement-suggested",
  status: "review",
  taskSource: "autoresearch",
  createdAt: new Date(now + 10_000).toISOString(),
};
const nextCycleFailures = [1, 2, 3].map((index) => ({
  ...baseEvent,
  id: `next-cycle-${index}`,
  taskId: `next-cycle-task-${index}`,
  taskSource: `work-board:next-cycle-${index}`,
  createdAt: new Date(now + 10_000 + index * 1_000).toISOString(),
}));
assert.equal(detectSkillAutoresearchCandidates([...events, suggestion, ...nextCycleFailures.slice(0, 2)]).length, 0, "a new research cycle requires three fresh failures");
const nextCycleCandidates = detectSkillAutoresearchCandidates([...events, suggestion, ...nextCycleFailures]);
assert.equal(nextCycleCandidates[0]?.failureCount, 3, "prior-cycle failures must not count toward a later proposal");

const companyLoop = buildOperatingUnitLearningLoop({
  unitId: "company-a",
  unitName: "Company A",
  workTitle: "Improve the weekly research brief",
  runId: "run-a",
  metricName: "qualified insights",
  strategicGoal: "Increase decision quality",
  branchAgent: "research",
  skills: ["research-brief", "source-checker"],
  now,
});
assert(companyLoop.handoffRules?.some((rule) => /skill autoresearch/i.test(rule)), "company work should feed the app-wide skill autoresearch mechanism");
assert(companyLoop.evidenceRequired?.some((rule) => /skill performance/i.test(rule)), "company work should retain skill-performance evidence");

const [packagedSkill, harnessSkill, apiRoute, hiveActions, reviewPanel, packageJson] = await Promise.all([
  readFile(new URL("../packaged-skills/auto-install/hive-skill-autoresearch/SKILL.md", import.meta.url), "utf8"),
  readFile(new URL("../packaged-skills/auto-install/harness-engineering/SKILL.md", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/skills/autoresearch/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/services/hive-actions/catalog.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/views/AgentNativeInsightsPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);
assert.match(packagedSkill, /four independent variants/i);
assert.match(packagedSkill, /HivemindOS-native/i);
assert.match(harnessSkill, /available.*retrieved.*invoked.*relevant/i);
assert.match(harnessSkill, /lopopolo\/harness-engineering/);
assert.match(harnessSkill, /CC BY 4\.0/);
assert.match(apiRoute, /maybeEnqueueSkillAutoresearch/);
assert.match(hiveActions, /skillAutoresearchAction/);
assert.match(reviewPanel, /Autoresearch task queued on the Work Board/);
assert.match(packageJson, /"test:skill-autoresearch"/);

console.log("skill autoresearch policy, detection, backend routing, and app-wide contracts passed");
