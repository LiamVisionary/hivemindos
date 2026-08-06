#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageDir = join(root, "packaged-skills/optional/writing/petergyang/no-ai-slop");
const commit = "61c21c351da4dcb40946a11fead978f2078a2c65";
const archiveHash = "f516d54c267dde6e4e3c64507957567de3f55fbf23c8f628a4ac4e68c98c721c";
const tempRoot = await mkdtemp(join(tmpdir(), "hivemind-no-ai-slop-"));
process.env.HOME = join(tempRoot, "home");
await mkdir(process.env.HOME, { recursive: true });

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { getSkillCatalog, normalizeAgentAgnosticSkill } = await import("../src/lib/services/skills/skill-os.ts");
const { importRemoteBrainSkill } = await import("../src/lib/services/obsidian/brain-skills.ts");

try {
  const metadata = JSON.parse(await readFile(join(packageDir, ".hivemind-skill-source.json"), "utf8"));
  assert.equal(metadata.commit, commit);
  assert.equal(metadata.sourceArchiveSha256, archiveHash);
  assert.equal(metadata.license, "MIT");
  assert.equal(metadata.provider, "packaged-optional");
  assert.match(metadata.securityVerdict, /^Approved for optional HivemindOS packaging/);
  assert.match(metadata.auditSummary.sourceReview, /All 5 upstream files/);
  assert.match(metadata.auditSummary.dynamicRuntime, /declarative Markdown and YAML only/);

  const files = (await readdir(packageDir, { recursive: true }))
    .filter((path) => !path.startsWith(".hivemind-skill-source.json"))
    .sort();
  assert.deepEqual(files, [
    "LICENSE",
    "README.md",
    "SKILL.md",
    "agents",
    "agents/openai.yaml",
    "eval.md",
  ]);

  const skill = await readFile(join(packageDir, "SKILL.md"), "utf8");
  const evaluation = await readFile(join(packageDir, "eval.md"), "utf8");
  assert.match(skill, /Preserve the user's point and personal voice/);
  assert.match(skill, /Make the minimum effective edit/);
  assert.match(skill, /Binary contrasts/);
  assert.match(skill, /Do not rewrite, score the draft, or guess whether AI wrote it/);
  assert.match(evaluation, /Would the writer recognize the edited draft as their own voice/);

  const catalog = await getSkillCatalog({ query: "ai slop", includeRegistry: false });
  const entry = catalog.find((item) => item.slug === "no-ai-slop");
  assert(entry, "No AI Slop should be discoverable in the optional Skill Browser catalog");
  assert.equal(entry.source, "Peter Yang");
  assert.equal(entry.category, "Writing");
  assert.equal(entry.packagedPath, "packaged-skills/optional/writing/petergyang/no-ai-slop");
  assert.ok(entry.capabilities.includes("chat"));
  assert.ok(!entry.capabilities.includes("deployment"));
  assert.ok(!entry.capabilities.includes("publishing"));

  const vaultPath = join(tempRoot, "vault");
  await importRemoteBrainSkill({
    vaultPath,
    skill: {
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      source: entry.source,
      githubUrl: entry.githubUrl,
      packagedPath: entry.packagedPath,
    },
  });

  const installedDir = join(vaultPath, "Skills", "no-ai-slop");
  const installedSource = JSON.parse(await readFile(join(installedDir, ".hivemind-skill-source.json"), "utf8"));
  const installedManifest = JSON.parse(await readFile(join(installedDir, ".hivemind-skill.json"), "utf8"));
  assert.equal(installedSource.commit, commit);
  assert.equal(installedSource.sourceArchiveSha256, archiveHash);
  assert.equal(installedSource.provider, "packaged-optional");
  assert.equal(installedSource.auditStatus, "trusted");
  assert.equal(installedManifest.audit.status, "trusted");
  assert.equal(
    await readFile(join(installedDir, "SKILL.md"), "utf8"),
    normalizeAgentAgnosticSkill(await readFile(join(packageDir, "SKILL.md"), "utf8"), "Peter Yang"),
  );
  assert.equal(
    await readFile(join(installedDir, "eval.md"), "utf8"),
    await readFile(join(packageDir, "eval.md"), "utf8"),
  );
  await assert.rejects(stat(join(installedDir, ".git")));
  assert.match(await readFile(join(vaultPath, "Skills", "README.md"), "utf8"), /\[\[no-ai-slop\/SKILL\]\]/);

  const lock = JSON.parse(await readFile(join(root, "skills-lock.json"), "utf8"));
  assert.equal(lock.skills["no-ai-slop"].ref, commit);
  assert.equal(lock.skills["no-ai-slop"].packagedPath, "packaged-skills/optional/writing/petergyang/no-ai-slop/SKILL.md");
  assert.match(await readFile(join(root, "packaged-skills/README.md"), "utf8"), /writing\/petergyang\/no-ai-slop/);
  assert.match(await readFile(join(root, "docs/for-users/packaged-skills/third-party-skills.md"), "utf8"), /writing\/petergyang\/no-ai-slop/);
  assert.match(await readFile(join(root, "docs/for-users/whole-brain/shared-skills.md"), "utf8"), /writing\/petergyang\/no-ai-slop/);

  console.log("No AI Slop is pinned, audited, cataloged, and installable with provenance preserved.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
