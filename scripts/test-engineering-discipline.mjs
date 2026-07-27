#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { getSkillPacks, installSkillPack } = await import("../src/lib/services/skills/skill-os.ts");
const { buildLoopFromTemplate } = await import("../src/lib/services/loops/loop-templates.ts");
const { findTaskTemplate } = await import("../src/components/task-modal/task-templates.ts");
const { NextRequest } = await import("next/server");
const { POST: createKanbanTaskViaApi } = await import("../src/app/api/kanban/route.ts");

const pack = (await getSkillPacks()).find((candidate) => candidate.id === "hivemind-engineering-discipline");
assert(pack, "manifest-backed Engineering Discipline pack should be discoverable");
assert.equal(pack.skills.length, 13, "pack should include the HivemindOS orchestrator plus 12 donor methods");
assert(pack.skills.every((skill) => skill.packagedPath), "pack skills should resolve to canonical packaged directories");
assert(!pack.skills.some((skill) => ["using-superpowers", "writing-skills"].includes(skill.slug)), "global bootstrap and upstream skill-authoring system should stay excluded");
assert(!existsSync(join(process.cwd(), "packaged-skills/optional/engineering/obra-superpowers/brainstorming/scripts")), "brainstorming web server should not be packaged");
assert(!existsSync(join(process.cwd(), "packaged-skills/optional/engineering/obra-superpowers/brainstorming/visual-companion.md")), "visual companion should not be packaged");
const brainstormingMarkdown = await readFile(join(process.cwd(), "packaged-skills/optional/engineering/obra-superpowers/brainstorming/SKILL.md"), "utf8");
assert(brainstormingMarkdown.includes("materially ambiguous"), "brainstorming discovery and policy should be scoped for HivemindOS");
assert(brainstormingMarkdown.includes("## HivemindOS Integration"), "donor skills should carry the HivemindOS authority preface");
const sourceMetadata = JSON.parse(await readFile(join(process.cwd(), "packaged-skills/optional/engineering/obra-superpowers/brainstorming/.hivemind-skill-source.json"), "utf8"));
assert.equal(sourceMetadata.commit, "d884ae04edebef577e82ff7c4e143debd0bbec99", "donor provenance should stay pinned");
const skillsLock = JSON.parse(await readFile(join(process.cwd(), "skills-lock.json"), "utf8"));
assert(skillsLock.skills.brainstorming.resourceHashes["SKILL.md"], "lock should cover packaged donor resources, not only source metadata");
for (const [path, text] of [
  ["docs/for-users/packaged-skills/hive-skills.md", "engineering-discipline"],
  ["docs/for-users/packaged-skills/third-party-skills.md", "obra/superpowers"],
  ["docs/for-users/whole-brain/shared-skills.md", "HivemindOS Engineering Discipline"],
  ["docs/for-users/features/work-and-scheduler.md", "Engineering discipline"],
]) {
  assert((await readFile(join(process.cwd(), path), "utf8")).includes(text), `${path} should document ${text}`);
}

const loop = buildLoopFromTemplate({
  templateId: "engineering-discipline",
  title: "Engineering fixture",
  goal: "Implement and verify a bounded fixture.",
  now: 1_900_000_000_000,
});
const gates = new Map(loop.evalGates.map((gate) => [gate.id, gate]));
for (const gateId of [
  "engineering-baseline-evidence",
  "engineering-red-green-evidence",
  "engineering-focused-tests",
  "engineering-lint",
  "engineering-typecheck",
  "engineering-independent-review",
  "engineering-final-evidence",
]) {
  assert.equal(gates.get(gateId)?.required, true, `${gateId} should be a required completion gate`);
}
assert.equal(gates.get("engineering-design-approval")?.required, false, "design approval should be risk-scoped, not global ceremony");
assert(loop.evidenceRequired?.some((item) => item.includes("Red/green")), "loop should require red/green evidence or a concrete non-applicability receipt");

const taskTemplate = findTaskTemplate("engineering/discipline");
assert.equal(taskTemplate?.loopTemplateId, "engineering-discipline", "quick-add template should create the real engineering loop");
assert(taskTemplate?.defaultAttachments?.some((attachment) => attachment.label === "engineering-discipline"), "quick-add template should attach the canonical orchestrator skill");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-engineering-pack-"));
try {
  const invalidTemplateRequest = new NextRequest("http://localhost/api/kanban?board=engineering-discipline-fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vaultPath,
      title: "Invalid engineering fixture",
      loopTemplateId: "not-a-real-template",
    }),
  });
  const invalidTemplateResponse = await createKanbanTaskViaApi(invalidTemplateRequest);
  const invalidTemplateResult = await invalidTemplateResponse.json();
  assert.equal(invalidTemplateResponse.status, 400, "unknown loop templates should be rejected at the API boundary");
  assert.equal(invalidTemplateResult.ok, false);
  assert.match(invalidTemplateResult.error, /Unknown loop template/);

  const request = new NextRequest("http://localhost/api/kanban?board=engineering-discipline-fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      vaultPath,
      title: "Engineering API fixture",
      body: "Verify the real Work Board template entry path.",
      status: "ideas",
      priority: "normal",
      loopTemplateId: "engineering-discipline",
    }),
  });
  const apiResponse = await createKanbanTaskViaApi(request);
  const apiResult = await apiResponse.json();
  assert.equal(apiResult.ok, true, apiResult.error ?? "Work Board template request should succeed");
  assert.equal(apiResult.task?.loop?.goal, "Verify the real Work Board template entry path.");
  assert(apiResult.task?.loop?.evalGates?.some((gate) => gate.id === "engineering-final-evidence"), "API-created task should carry the Engineering Discipline gates");

  const promoteRequest = new NextRequest("http://localhost/api/kanban?board=engineering-discipline-fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "promote",
      vaultPath,
      taskId: apiResult.task.id,
    }),
  });
  const promoteResult = await (await createKanbanTaskViaApi(promoteRequest)).json();
  assert.equal(promoteResult.ok, true, promoteResult.error ?? "Engineering task should promote to Ready");
  assert.equal(promoteResult.task?.status, "ready");

  const claimRequest = new NextRequest("http://localhost/api/kanban?board=engineering-discipline-fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "claim",
      vaultPath,
      taskId: apiResult.task.id,
      assignee: "engineering-fixture",
      claimer: "engineering-fixture",
      runtime: "test",
    }),
  });
  const claimResult = await (await createKanbanTaskViaApi(claimRequest)).json();
  assert.equal(claimResult.ok, true, claimResult.error ?? "Engineering task should be claimable");

  const incompleteRequest = new NextRequest("http://localhost/api/kanban?board=engineering-discipline-fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "complete",
      vaultPath,
      taskId: apiResult.task.id,
      summary: "Attempted completion without evidence.",
      result: "Implementation claimed complete without test receipts.",
      loopReceipts: [],
    }),
  });
  const incompleteResult = await (await createKanbanTaskViaApi(incompleteRequest)).json();
  assert.equal(incompleteResult.ok, true);
  assert.equal(incompleteResult.blocked, true, "Engineering Discipline should block completion without its required evidence");
  assert.equal(incompleteResult.task?.status, "needs-human");
  assert(incompleteResult.missingGateIds?.includes("engineering-final-evidence"), "blocked completion should name the missing final-evidence gate");

  const skillsRoot = join(vaultPath, "Skills");
  const legacyDir = join(skillsRoot, "writing-plans");
  const unmanagedDir = join(skillsRoot, "test-driven-development");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "SKILL.md"), "---\nname: writing-plans\nauthor: HivemindOS, adapted from obra/superpowers\n---\n\nLegacy managed copy.\n");
  await writeFile(join(legacyDir, ".hivemind-skill-source.json"), `${JSON.stringify({ provider: "hermes" })}\n`);
  await mkdir(unmanagedDir, { recursive: true });
  await writeFile(join(unmanagedDir, "SKILL.md"), "---\nname: test-driven-development\n---\n\nUser-authored copy that must survive.\n");

  const result = await installSkillPack({ packId: pack.id, vaultPath });
  assert(result.updated.includes("writing-plans"), "legacy managed Superpowers adaptation should update");
  assert(result.skipped.includes("test-driven-development"), "unmanaged colliding skill should be preserved");
  assert(result.installed.includes("engineering-discipline"), "canonical HivemindOS orchestrator should install");
  assert.equal(await readFile(join(unmanagedDir, "SKILL.md"), "utf8"), "---\nname: test-driven-development\n---\n\nUser-authored copy that must survive.\n");
  const archiveEntries = await readdir(join(skillsRoot, ".archive"));
  assert(archiveEntries.some((entry) => entry.startsWith("writing-plans-")), "managed update should archive the previous copy");
  const installedMetadata = JSON.parse(await readFile(join(skillsRoot, "engineering-discipline", ".hivemind-skill-source.json"), "utf8"));
  assert.equal(installedMetadata.provider, "packaged-auto-install");
  assert.equal(installedMetadata.installedFromPack, pack.id);

  const repeat = await installSkillPack({ packId: pack.id, vaultPath });
  assert.equal(repeat.installed.length, 0, "repeat install should be idempotent");
  assert.equal(repeat.updated.length, 0, "repeat install should not re-archive unchanged managed skills");
  assert.equal(repeat.skipped.length, 13, "repeat install should preserve all unchanged skills");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}

console.log("engineering discipline tests passed");
