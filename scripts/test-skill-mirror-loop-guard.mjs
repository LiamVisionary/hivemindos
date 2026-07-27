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

const { reconcileBrainSkills, syncSharedBrainSkillsToAeon } = await import(
  "../src/lib/services/obsidian/brain-skills.ts"
);

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

  // --- doubled-prefix minting is impossible even when dedup loses a slug ---
  // Reproduces the June-14 generator end-to-end: two vault dirs sharing a
  // frontmatter NAME collapse to one summary (name-keyed dedup), so the
  // loser's slug leaves the shared map while its dir stays on disk; importing
  // a source with that slug then collides on disk, and nextDestinationSlug
  // used to mint aeon-aeon-<x>. It must counter the existing base instead.
  {
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    await mkdir(join(vault, "Skills", "collide"), { recursive: true });
    await writeFileFs(join(vault, "Skills", "collide", "SKILL.md"), skillMarkdown("collide"));
    await mkdir(join(vault, "Skills", "aeon-collide"), { recursive: true });
    // Same frontmatter name as "collide" -> name-keyed dedup drops this slug
    // from the shared maps while the directory remains on disk.
    await writeFileFs(join(vault, "Skills", "aeon-collide", "SKILL.md"), skillMarkdown("collide"));

    const freshBody = skillMarkdown("collide-fresh");
    const result2 = await reconcileBrainSkills({
      vaultPath: vault,
      remoteProviders: [{
        id: "aeon",
        label: "Aeon",
        home: "~/.aeon",
        installed: true,
        skills: [
          // Path OUTSIDE any /.aeon/ tree so the mirror guards (correctly)
          // let it through — this exercises the minting path itself.
          aeonSkill("aeon-collide", freshBody, "/root/exported-skills/aeon-collide/SKILL.md", [
            sourceFile("SKILL.md", freshBody),
          ]),
        ],
      }],
      policies: { aeon: { autoImport: true, autoUpdate: true, trackRemovals: true } },
    });
    const mintedSlugs = result2.imported.map((skill) => skill.importedAs || skill.slug);
    assert.deepEqual(mintedSlugs, ["aeon-collide-2"], "collision counters the existing base");
    assert.ok(
      !existsSync(join(vault, "Skills", "aeon-aeon-collide")),
      "a doubled provider prefix must never be minted",
    );
  }

  // --- every aeon root is guarded, not just ~/.aeon/skills ---
  {
    const pluginBody = skillMarkdown("plugin-mirror");
    const result3 = await reconcileBrainSkills({
      vaultPath: vault,
      remoteProviders: [{
        id: "aeon",
        label: "Aeon",
        home: "~/.aeon",
        installed: true,
        skills: [
          aeonSkill("aeon-plugin-mirror", pluginBody, "/root/.aeon/plugins/aeon-plugin-mirror/SKILL.md", [
            sourceFile("SKILL.md", pluginBody),
          ]),
        ],
      }],
      policies: { aeon: { autoImport: true, autoUpdate: true, trackRemovals: true } },
    });
    assert.ok(
      result3.skipped.some((skill) => skill.slug === "aeon-plugin-mirror" && /recursive provider mirror/.test(skill.reason)),
      "prefixed slugs under ~/.aeon/plugins are recursive mirrors too",
    );
    assert.equal(existsSync(join(vault, "Skills", "aeon-aeon-plugin-mirror")), false);
  }

  // --- vault->aeon projection: GC stale managed mirrors, refuse doubled prefixes ---
  {
    const { writeFile: writeFileFs } = await import("node:fs/promises");
    const aeonRoot = join(home, ".aeon-sync-test");
    const aeonSkills = join(aeonRoot, "skills");
    // A stale MANAGED mirror (vault source long gone) — must be GC'd.
    await mkdir(join(aeonSkills, "aeon-stale-mirror"), { recursive: true });
    await writeFileFs(join(aeonSkills, "aeon-stale-mirror", "SKILL.md"), skillMarkdown("stale"));
    await writeFileFs(
      join(aeonSkills, "aeon-stale-mirror", ".hivemind-skill-source.json"),
      JSON.stringify({ managedBy: "hivemindos", provider: "shared-brain", sourcePath: "/gone/SKILL.md" }),
    );
    // A native unmanaged skill — never ours to remove.
    await mkdir(join(aeonSkills, "native-keeper"), { recursive: true });
    await writeFileFs(join(aeonSkills, "native-keeper", "SKILL.md"), skillMarkdown("native-keeper"));
    // A doubled-prefix dir somehow on the shelf — must not be projected.
    await mkdir(join(vault, "Skills", "aeon-aeon-junk"), { recursive: true });
    await writeFileFs(join(vault, "Skills", "aeon-aeon-junk", "SKILL.md"), skillMarkdown("junk"));

    const sync = await syncSharedBrainSkillsToAeon({ vaultPath: vault, aeonLocalPath: aeonRoot });
    assert.ok(sync.removed.includes("aeon-stale-mirror"), "stale managed mirror is GC'd");
    assert.equal(existsSync(join(aeonSkills, "aeon-stale-mirror")), false);
    assert.equal(existsSync(join(aeonSkills, "native-keeper", "SKILL.md")), true, "unmanaged skills survive GC");
    assert.ok(
      sync.skipped.some((skill) => skill.slug === "aeon-aeon-junk" && /doubled prefix/.test(skill.reason)),
      "doubled-prefix shelf entries are never projected",
    );
    assert.equal(existsSync(join(aeonSkills, "aeon-aeon-junk")), false);
    assert.equal(existsSync(join(aeonSkills, "collide", "SKILL.md")), true, "normal shelf skills project");
  }

  console.log("Skill mirror loop guard checks passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
