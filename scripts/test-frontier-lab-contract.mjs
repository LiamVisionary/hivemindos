#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const repo = process.cwd();
const routeSource = await readFile(join(repo, "src/app/api/companies/[id]/frontier-lab/route.ts"), "utf8");
const panelSource = await readFile(join(repo, "src/features/dashboard/views/zero-human-companies/FrontierLabPanel.tsx"), "utf8");
const panelCss = await readFile(join(repo, "src/features/dashboard/views/zero-human-companies/frontier-lab.module.css"), "utf8");
const cockpitSource = await readFile(join(repo, "src/features/dashboard/views/zero-human-companies/Cockpit.tsx"), "utf8");
const orchestrationSource = await readFile(join(repo, "src/lib/services/companies-orchestration.ts"), "utf8");
const workerSource = await readFile(join(repo, "src/lib/services/queen-bee/autonomous-worker.ts"), "utf8");

assert.equal((routeSource.match(/requireAuth\(request\)/g) ?? []).length, 2, "GET and PATCH must both authenticate");
assert.match(routeSource, /evaluateFrontierLabStageTransition/);
assert.match(routeSource, /setCompanyFrontierLabPolicy/);
assert.match(routeSource, /Connect OpenAI OAuth before enabling Frontier Lab/);
assert.match(routeSource, /native hierarchical Hivemind execution/);
assert.match(routeSource, /Staff at least two distinct company agent identities/);
assert.match(panelSource, /No OpenRouter fallback/);
assert.match(panelSource, /draft\.models\[tier\]/);
assert.match(panelSource, /role="switch"/);
assert.match(panelCss, /@media \(max-width: 700px\)/);
assert.match(cockpitSource, /key: "frontier", label: "Frontier Lab"/);
assert.match(cockpitSource, /<FrontierLabPanel companyId=\{c\.id\}/);
assert.match(orchestrationSource, /frontier-lab:tier:/, "dispatch must stamp the task tier for worker routing");
assert.match(orchestrationSource, /const llmDrafts = frontierPolicy\s*\? null/, "Frontier planning must not make an unreserved model call");
assert.match(orchestrationSource, /dispatchableMembers: countDispatchableMemberIdentities\(scoped\)/, "Frontier capacity must count distinct online identities, not replicated agent copies");
assert.match(orchestrationSource, /requireIndependentJudge: company\.frontierLab\?\.enabled === true/, "Frontier tasks must retain independent review when the ordinary-company judge default is disabled");
assert.match(workerSource, /openAiOAuthAgentForFrontierLabTier\(frontierTier\)/);
assert.match(workerSource, /reserveCompanyIntelligence\(/);
assert.match(workerSource, /settleCompanyIntelligenceReservation\(/);
assert.match(workerSource, /revision-\$\{currentTask\.updatedAt\}/, "reservation identity must dedupe concurrent pickups but permit a later task revision");
assert.match(workerSource, /taggedFrontierTier && \(!companyId \|\| !company \|\| !company\.frontierLab\)/, "tier-tagged tasks must fail closed without a resolvable policy");

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-frontier-contract-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemindos-frontier-contract-vault-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0";

try {
  const { countDispatchableMemberIdentities } = await import("../src/lib/services/companies-orchestration.ts");
  const replicatedFleet = [
    { device: { online: true }, agents: [{ id: "same-agent", runtime: "hermes" }] },
    { device: { online: true }, agents: [{ id: "same-agent", runtime: "hermes" }, { id: "independent-reviewer", runtime: "hermes" }] },
  ];
  assert.equal(countDispatchableMemberIdentities(replicatedFleet), 2, "replicated copies of one profile must not manufacture reviewer independence");

  const { getCompany, setCompanyFrontierLabPolicy, upsertCompany } = await import("../src/lib/services/companies-store.ts");
  const created = await upsertCompany({ id: "co-frontier-contract", name: "Frontier Contract", agentIds: [] });
  const updated = await setCompanyFrontierLabPolicy(created.id, {
    enabled: true,
    stage: "pilot",
    monthlyTokenLimit: 5_000_000,
    perTaskTokenLimit: 250_000,
    maxParallelTasks: 999,
    maxTasksPerCycle: 999,
    perMachineConcurrency: 999,
    elasticWorkers: true,
    requireIndependentReview: true,
    provider: "openai-oauth",
    models: { scout: "gpt-5.6-sol", builder: "gpt-5.6-luna", reviewer: "gpt-5.6-terra" },
  });
  assert(updated?.frontierLab);
  assert.equal(updated.frontierLab.maxParallelTasks, 4);
  assert.deepEqual(updated.frontierLab.models, { scout: "gpt-5.6-luna", builder: "gpt-5.6-terra", reviewer: "gpt-5.6-sol" });

  await upsertCompany({ id: created.id, name: "Frontier Contract Renamed", agentIds: created.agentIds });
  const readBack = await getCompany(created.id);
  assert.equal(readBack?.name, "Frontier Contract Renamed");
  assert.equal(readBack?.frontierLab?.enabled, true, "generic company edits must preserve dedicated Frontier Lab policy");
  assert.equal(readBack?.frontierLab?.provider, "openai-oauth");
} finally {
  await rm(tempHome, { recursive: true, force: true });
  await rm(vaultPath, { recursive: true, force: true });
}

console.log("Frontier Lab API, Cockpit, dispatch, worker, and replicated-store contract test passed");
