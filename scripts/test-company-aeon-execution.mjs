#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-aeon-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-aeon-vault-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;

const {
  buildCompanyRuntimeMix,
  companyExecutionCapability,
  companyExecutionConfigFromForm,
  companyExecutionFormFromConfig,
  normalizeCompanyExecutionConfig,
  parseCompanyExecutionConfig,
} = await import("../src/lib/services/company-execution-capabilities.ts");
const {
  inspectCompanyAeonActivity,
  listCompanyAeonOptions,
  resolveCompanyAeonBinding,
} = await import("../src/lib/services/company-aeon-binding.ts");
const { dispatchCompanyWithAeon, buildCompanyAeonVariable, syncCompanyAeonOutcomes } = await import("../src/lib/services/company-aeon-execution.ts");
const { listCompanyRuns } = await import("../src/lib/services/company-runs.ts");
const { readCompanyMemory } = await import("../src/lib/services/company-memory.ts");
const { getCompany, upsertCompany } = await import("../src/lib/services/companies-store.ts");

try {
  assert.deepEqual(normalizeCompanyExecutionConfig({ engine: "hivemind" }), { engine: "hivemind" });
  assert.deepEqual(
    normalizeCompanyExecutionConfig({ engine: "aeon", profileId: " aeon-growth ", skill: "digest" }),
    { engine: "aeon", profileId: "aeon-growth", skill: "digest" },
  );
  assert.equal(normalizeCompanyExecutionConfig({ engine: "aeon", profileId: "aeon-growth", skill: "Bad Skill" }), undefined);
  assert.deepEqual(
    companyExecutionConfigFromForm({ executionEngine: "aeon", aeonProfileId: " aeon-growth ", aeonSkill: " digest " }),
    { engine: "aeon", profileId: "aeon-growth", skill: "digest" },
    "one form mapper owns the UI-to-domain projection",
  );
  assert.deepEqual(
    companyExecutionFormFromConfig({ engine: "aeon", profileId: "aeon-growth", skill: "digest" }),
    { executionEngine: "aeon", aeonProfileId: "aeon-growth", aeonSkill: "digest" },
    "one form mapper owns the domain-to-UI projection",
  );
  assert.deepEqual(
    buildCompanyRuntimeMix({ engine: "aeon", profileId: "aeon-growth", skill: "digest" }, ["Hermes", "Hermes", "Codex"]),
    ["AEON · digest", "Hermes", "Codex"],
    "live and demo cards share one runtime-label projection",
  );
  assert.deepEqual(
    parseCompanyExecutionConfig({ engine: "aeon", profileId: "", skill: "digest" }),
    { ok: false, error: "Choose an AEON workspace before saving this company." },
    "the API and store share one validation policy",
  );
  assert.deepEqual(
    parseCompanyExecutionConfig({ engine: "unknown" }),
    { ok: false, error: "Choose a valid company autonomy engine." },
    "unknown engines are rejected instead of silently becoming HivemindOS",
  );
  assert.deepEqual(
    parseCompanyExecutionConfig({}),
    { ok: false, error: "Choose a valid company autonomy engine." },
    "missing engine discriminants are rejected at the shared boundary",
  );
  assert.deepEqual(
    companyExecutionCapability({ engine: "aeon", profileId: "aeon-growth", skill: "digest" }).autonomy,
    { requiresCompanyCrew: false, requiresOnlineCrew: false, activityAuthority: "aeon-workspace" },
    "the execution matrix makes AEON independent from native crew and Work Board activity",
  );

  const company = await upsertCompany({
    name: "AEON Growth Company",
    members: [{ agentId: "founder-queen", roleInCompany: "Queen" }],
    apexGoal: { title: "Find qualified launch partners", metric: "partner conversations", target: "20" },
    charter: "Research the market and preserve evidence for the operator.",
    execution: { engine: "aeon", profileId: "aeon-growth", skill: "digest" },
  });
  assert.deepEqual((await getCompany(company.id))?.execution, {
    engine: "aeon",
    profileId: "aeon-growth",
    skill: "digest",
  }, "AEON execution binding persists with the company definition");

  const profile = {
    id: "aeon-growth",
    name: "Growth AEON",
    runtime: "aeon",
    gatewayUrl: "",
    aeonLocalPath: "~/.aeon-growth",
  };
  const skill = { slug: "digest", name: "Digest", description: "Build the company digest." };
  const bindingDependencies = {
    readProfiles: async () => [profile],
    listSkills: async () => [skill],
    listRuns: async () => [{ id: "run-1", runtime: "aeon", name: "Digest", status: "active" }],
  };
  assert.deepEqual(
    await listCompanyAeonOptions("aeon-growth", { vaultPath }, bindingDependencies),
    {
      profiles: [{ id: "aeon-growth", name: "Growth AEON", workspace: "Growth AEON" }],
      skills: [{ slug: "digest", name: "Digest", description: "Build the company digest." }],
    },
    "the picker consumes the same server-side catalog used for validation and dispatch",
  );
  assert.equal(
    (await resolveCompanyAeonBinding("aeon-growth", "digest", { vaultPath }, bindingDependencies)).skill.slug,
    "digest",
  );
  assert.equal(
    (await inspectCompanyAeonActivity(company.execution, { vaultPath }, bindingDependencies)).hasActiveRun,
    true,
    "queued or active workspace runs stop autonomy from overlapping AEON dispatches",
  );
  await assert.rejects(
    inspectCompanyAeonActivity(company.execution, { vaultPath }, {
      ...bindingDependencies,
      listRuns: async () => { throw new Error("run lookup unavailable"); },
    }),
    /run lookup unavailable/i,
    "unknown AEON activity fails closed instead of being mistaken for an idle workspace",
  );
  await assert.rejects(
    resolveCompanyAeonBinding("aeon-growth", "missing", { vaultPath }, bindingDependencies),
    /no longer available/i,
    "save and dispatch reject skills absent from the authoritative workspace catalog",
  );
  let captured = null;
  const result = await dispatchCompanyWithAeon(company, { vaultPath }, {
    resolveBinding: async () => ({ profile, skill }),
    dispatchSkill: async (selectedProfile, skill, overrides) => {
      captured = { selectedProfile, skill, overrides };
      return { dispatched: true, skill, source: "aeon-cli", result: { ok: true } };
    },
  });

  assert.equal(result.executionEngine, "aeon");
  assert.equal(result.planner, "aeon");
  assert.equal(result.externalRunCount, 1);
  assert.equal(result.taskCount, 0, "AEON dispatch does not fabricate a Work Board task");
  assert.equal(result.aeon.skill, "digest");
  assert.equal(captured.skill, "digest");
  assert.match(captured.overrides.var, /Company AEON Growth Company/);
  assert.match(captured.overrides.var, /Goal Find qualified launch partners/);
  assert.equal(captured.overrides.var, buildCompanyAeonVariable(company));

  const ledger = await listCompanyRuns(company.id);
  assert.equal(ledger.runs[0]?.status, "running", "dispatch-accept leaves the company run OPEN until the workspace run actually finishes");
  assert.equal(ledger.runs[0]?.output, undefined, "no completion output is fabricated at dispatch-accept");
  assert.ok(ledger.runs[0]?.events?.some((event) => event.kind === "aeon-dispatched"));

  // ── outcome sweep: terminal workspace runs fold back into memory + the run ledger ──
  const liveCompany = await getCompany(company.id);
  const sweepDeps = (runs) => ({
    resolveBinding: async () => ({ profile, skill }),
    listRuns: async () => runs,
  });
  const stillActive = await syncCompanyAeonOutcomes([liveCompany], { vaultPath }, sweepDeps([
    { id: "9001", runtime: "aeon", name: "Digest", status: "active", createdAt: new Date().toISOString() },
  ]));
  assert.equal(stillActive, 0, "an in-flight workspace run records nothing");
  assert.equal((await listCompanyRuns(company.id)).runs[0]?.status, "running", "the dispatch stays open while the workspace run is active");

  const staleRun = { id: "8000", runtime: "aeon", name: "Old digest", status: "completed", conclusion: "success", createdAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), updatedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString() };
  const doneRun = { id: "9001", runtime: "aeon", name: "Digest", status: "completed", conclusion: "success", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), url: "https://github.com/example/aeon/runs/9001" };
  const firstSweep = await syncCompanyAeonOutcomes([liveCompany], { vaultPath }, sweepDeps([staleRun, doneRun]));
  assert.equal(firstSweep, 1, "only the run from THIS dispatch window is recorded — pre-dispatch history is ignored");
  const secondSweep = await syncCompanyAeonOutcomes([liveCompany], { vaultPath }, sweepDeps([staleRun, doneRun]));
  assert.equal(secondSweep, 0, "the outcome sweep is idempotent (deduped on aeonRunId in company memory)");
  const memoryAfter = await readCompanyMemory(company.id);
  const outcomeRecord = memoryAfter.find((record) => record.data?.aeonRunId === "9001");
  assert.equal(outcomeRecord?.kind, "task-completed", "a successful workspace run lands in memory as task-completed");
  const closedRun = (await listCompanyRuns(company.id)).runs.find((run) => run.id === result.companyRunId);
  assert.equal(closedRun?.status, "completed", "the sweep finishes the open dispatch run");
  assert.equal(closedRun?.output?.aeonRunId, "9001", "the finished run names the workspace run that closed it");
  assert.equal(closedRun?.output?.evaluation?.verdict, "accepted", "the observed completion is evaluated for real, not unobserved");
  assert.ok(closedRun?.events?.some((event) => event.kind === "aeon-run-completed"), "the run trail records the observed workspace completion");

  // A FAILING workspace run must surface as a failure, not silent success.
  const failCompany = await upsertCompany({
    name: "AEON Fail Company",
    members: [{ agentId: "founder-queen-2", roleInCompany: "Queen" }],
    apexGoal: { title: "Ship the weekly digest", metric: "digests", target: "1" },
    execution: { engine: "aeon", profileId: "aeon-growth", skill: "digest" },
  });
  const failDispatch = await dispatchCompanyWithAeon(await getCompany(failCompany.id), { vaultPath }, {
    resolveBinding: async () => ({ profile, skill }),
    dispatchSkill: async () => ({ dispatched: true, skill: "digest", source: "aeon-cli" }),
  });
  const failedRun = { id: "9100", runtime: "aeon", name: "Digest", status: "failed", conclusion: "failure", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.equal(await syncCompanyAeonOutcomes([await getCompany(failCompany.id)], { vaultPath }, sweepDeps([failedRun])), 1);
  const failMemory = await readCompanyMemory(failCompany.id);
  assert.equal(failMemory.find((record) => record.data?.aeonRunId === "9100")?.kind, "task-blocked", "a failed workspace run lands in memory as task-blocked");
  const failClosed = (await listCompanyRuns(failCompany.id)).runs.find((run) => run.id === failDispatch.companyRunId);
  assert.equal(failClosed?.status, "failed", "a failing external run closes the dispatch as FAILED — no longer invisible");
  assert.equal(failClosed?.output?.evaluation?.verdict, "rejected", "the observed failure evaluates as rejected");

  // Non-AEON companies and AEON companies with nothing outstanding are skipped without a workspace lookup.
  let lookedUp = false;
  assert.equal(
    await syncCompanyAeonOutcomes([await getCompany(failCompany.id)], { vaultPath }, {
      resolveBinding: async () => { lookedUp = true; return { profile, skill }; },
      listRuns: async () => { lookedUp = true; return []; },
    }),
    0,
  );
  assert.equal(lookedUp, false, "no open dispatch means no binding/workspace lookup at all");

  await assert.rejects(
    dispatchCompanyWithAeon(company, { vaultPath }, {
      resolveBinding: async () => { throw new Error("AEON workspace not found."); },
    }),
    /workspace not found/i,
    "a stale company binding fails before any AEON command runs",
  );

  console.log("company AEON execution suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
