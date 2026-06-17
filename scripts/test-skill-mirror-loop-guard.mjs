#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";
import { createHash } from "node:crypto";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const root = await mkdtemp(join(tmpdir(), "hivemindos-skill-loop-"));
const home = join(root, "home");
const vault = join(root, "vault");

process.env.HOME = home;
process.env.AEON_LOCAL_PATH = join(home, ".aeon", "repo");

const { reconcileBrainSkills } = await import("../src/lib/services/obsidian/brain-skills.ts");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function skillMarkdown(name) {
  return [
    "---",
    `name: ${name}`,
    "description: Skill loop guard test fixture.",
    "---",
    "",
    `# ${name}`,
    "",
    "This fixture should only be imported when it is a true provider-native skill.",
  ].join("\n");
}

function sourceFile(path, text) {
  return { path, contentBase64: Buffer.from(text).toString("base64") };
}

function aeonSkill(slug, body, sourcePath, sourceFiles) {
  return {
    id: `aeon:test:${sourcePath}`,
    slug,
    name: slug,
    description: "Skill loop guard test fixture.",
    provider: "aeon",
    providerLabel: "Aeon",
    path: sourcePath,
    sourcePath,
    sourceMachine: "test-machine",
    relativePath: `${slug}/SKILL.md`,
    checksum: sha256(body),
    updatedAt: Date.now(),
    imported: false,
    sourceFiles,
  };
}

try {
  await mkdir(join(home, ".aeon", "skills"), { recursive: true });
  await mkdir(join(vault, "Skills"), { recursive: true });

  const nativeBody = skillMarkdown("native-aeon-skill");
  const sharedMirrorBody = skillMarkdown("hermes-apple-notes");
  const historicalMirrorBody = skillMarkdown("claude-access");
  const sharedMirrorMetadata = JSON.stringify({
    managedBy: "hivemindos",
    provider: "shared-brain",
    providerLabel: "Shared brain",
    sourcePath: "/vault/Skills/hermes-apple-notes/SKILL.md",
  });

  const remoteProvider = {
    id: "aeon",
    label: "Aeon",
    home: "~/.aeon",
    installed: true,
    skills: [
      aeonSkill(
        "native-aeon-skill",
        nativeBody,
        "/root/.aeon/skills/native-aeon-skill/SKILL.md",
        [sourceFile("SKILL.md", nativeBody)],
      ),
      aeonSkill(
        "aeon-hermes-apple-notes-2",
        sharedMirrorBody,
        "/root/.aeon/skills/aeon-hermes-apple-notes-2/SKILL.md",
        [
          sourceFile("SKILL.md", sharedMirrorBody),
          sourceFile(".hivemind-skill-source.json", sharedMirrorMetadata),
        ],
      ),
      aeonSkill(
        "aeon-aeon-claude-access-2",
        historicalMirrorBody,
        "/root/.aeon/skills/aeon-aeon-claude-access-2/SKILL.md",
        [sourceFile("SKILL.md", historicalMirrorBody)],
      ),
    ],
  };

  const result = await reconcileBrainSkills({
    vaultPath: vault,
    remoteProviders: [remoteProvider],
    policies: { aeon: { autoImport: true, autoUpdate: true, trackRemovals: true } },
  });

  assert.deepEqual(result.imported.map((skill) => skill.slug), ["native-aeon-skill"]);
  assert.ok(
    result.skipped.some((skill) => skill.slug === "aeon-hermes-apple-notes-2" && /shared-brain mirror/.test(skill.reason)),
    "shared-brain AEON mirror should be skipped",
  );
  assert.ok(
    result.skipped.some((skill) => skill.slug === "aeon-aeon-claude-access-2" && /recursive provider mirror/.test(skill.reason)),
    "historical recursive AEON mirror should be skipped",
  );
  assert.equal(existsSync(join(vault, "Skills", "native-aeon-skill", "SKILL.md")), true);
  assert.equal(existsSync(join(vault, "Skills", "aeon-hermes-apple-notes-2")), false);
  assert.equal(existsSync(join(vault, "Skills", "aeon-aeon-claude-access-2")), false);

  console.log("Skill mirror loop guard checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
