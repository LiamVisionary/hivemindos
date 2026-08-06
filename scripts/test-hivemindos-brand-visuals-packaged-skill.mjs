#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageDir = join(root, "packaged-skills/optional/brand/hivemindos/hivemindos-brand-visuals");
const tempRoot = await mkdtemp(join(tmpdir(), "hivemind-brand-visuals-"));

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { getSkillCatalog } = await import("../src/lib/services/skills/skill-os.ts");
const { importRemoteBrainSkill } = await import("../src/lib/services/obsidian/brain-skills.ts");

try {
  const skill = await readFile(join(packageDir, "SKILL.md"), "utf8");
  const metadata = JSON.parse(await readFile(join(packageDir, ".hivemind-skill-source.json"), "utf8"));

  assert.match(skill, /^---\nname: hivemindos-brand-visuals\n/);
  assert.match(skill, /Choose one sharp visual thesis/);
  assert.match(skill, /Hexes are not inherently difficult; semantic overconstraint is/);
  assert.match(skill, /Do not submit the same node network or honeycomb in different colors/);
  assert.match(skill, /Review the mark before polishing the presentation/);
  assert.match(skill, /test it on unrelated concrete brands/);
  assert.match(skill, /still needs vector construction and clearance/);

  assert.equal(metadata.provider, "packaged-optional");
  assert.equal(metadata.status, "optional");
  assert.equal(metadata.hiveSlug, "hivemindos-brand-visuals");
  assert.equal(metadata.version, "0.2.0");
  assert.equal(
    metadata.sourcePath,
    "packaged-skills/optional/brand/hivemindos/hivemindos-brand-visuals",
  );

  const catalog = await getSkillCatalog({
    query: "visual thesis",
    includeRegistry: false,
  });
  const entry = catalog.find((item) => item.slug === "hivemindos-brand-visuals");
  assert(entry, "HivemindOS Brand Visuals should be discoverable in the optional Skill Browser catalog");
  assert.equal(entry.source, "HivemindOS optional packaged skills");
  assert.equal(entry.category, "Brand");
  assert.equal(
    entry.packagedPath,
    "packaged-skills/optional/brand/hivemindos/hivemindos-brand-visuals",
  );

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

  const installedDir = join(vaultPath, "Skills", "hivemindos-brand-visuals");
  const installedSkill = await readFile(join(installedDir, "SKILL.md"), "utf8");
  const installedSource = JSON.parse(
    await readFile(join(installedDir, ".hivemind-skill-source.json"), "utf8"),
  );
  assert.match(installedSkill, /Choose one sharp visual thesis/);
  assert.match(installedSkill, /Hexes are not inherently difficult/);
  assert.equal(installedSource.provider, "packaged-optional");
  assert.equal(typeof installedSource.installedAt, "string");
  await assert.rejects(stat(join(installedDir, ".git")));
  assert.match(
    await readFile(join(vaultPath, "Skills", "README.md"), "utf8"),
    /\[\[hivemindos-brand-visuals\/SKILL\]\]/,
  );

  await assert.rejects(
    stat(join(root, "packaged-skills/auto-install/hivemindos-brand-visuals")),
    "The brand skill must remain optional and must not be silently auto-installed",
  );
  assert.match(
    await readFile(join(root, "packaged-skills/README.md"), "utf8"),
    /brand\/hivemindos\/hivemindos-brand-visuals/,
  );
  assert.match(
    await readFile(join(root, "docs/for-users/packaged-skills/third-party-skills.md"), "utf8"),
    /brand\/hivemindos\/hivemindos-brand-visuals/,
  );
  assert.match(
    await readFile(join(root, "docs/for-users/whole-brain/shared-skills.md"), "utf8"),
    /brand\/hivemindos\/hivemindos-brand-visuals/,
  );

  console.log("HivemindOS Brand Visuals is lesson-updated, cataloged, optional, and installable.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
