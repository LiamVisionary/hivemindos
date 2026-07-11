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
const { dispatchCompanyWithAeon, buildCompanyAeonVariable } = await import("../src/lib/services/company-aeon-execution.ts");
const { listCompanyRuns } = await import("../src/lib/services/company-runs.ts");
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
  assert.equal(ledger.runs[0]?.status, "completed");
  assert.equal(ledger.runs[0]?.output?.executionEngine, "aeon");
  assert.equal(ledger.runs[0]?.output?.aeonSkill, "digest");
  assert.equal(ledger.runs[0]?.output?.evaluation?.verdict, "unobserved", "an accepted external dispatch is not misreported as evaluated work");
  assert.ok(ledger.runs[0]?.events?.some((event) => event.kind === "aeon-dispatched"));

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
