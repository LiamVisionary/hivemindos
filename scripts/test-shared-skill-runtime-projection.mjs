import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), "hive-shared-skill-projection-"));
const home = join(tmp, "home");
const vault = join(tmp, "vault");

function skill(slug, description) {
  const dir = join(vault, "Skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n`);
}

function read(path) {
  return readFileSync(path, "utf8");
}

try {
  mkdirSync(join(home, ".codex", "skills"), { recursive: true });
  skill("agent-reach", "Shared X and web research router.");
  skill("collision", "Shared copy that should not overwrite an unmanaged local skill.");
  skill("hyperframes", "Existing managed package whose update checksum must survive seeding.");
  skill("managed-old", "Shared copy that should replace a managed projection.");

  const existingBundledMetadata = join(vault, "Skills", "agent-reach", ".hivemind-skill-source.json");
  writeFileSync(existingBundledMetadata, '{"provider":"user-reviewed"}\n');
  chmodSync(existingBundledMetadata, 0o444);

  writeFileSync(join(vault, "Skills", "hyperframes", ".hivemind-skill-source.json"), JSON.stringify({
    provider: "packaged-auto-install",
    sourceChecksum: "preserve-for-checksum-aware-sync",
  }));

  const collisionDir = join(home, ".codex", "skills", "collision");
  mkdirSync(collisionDir, { recursive: true });
  writeFileSync(join(collisionDir, "SKILL.md"), "---\nname: collision-local\n---\n\n# local collision\n");

  const managedDir = join(home, ".codex", "skills", "managed-old");
  mkdirSync(managedDir, { recursive: true });
  writeFileSync(join(managedDir, "SKILL.md"), "---\nname: stale-managed\n---\n\n# stale\n");
  writeFileSync(join(managedDir, ".hivemind-skill-source.json"), JSON.stringify({
    managedBy: "hivemindos",
    provider: "shared-brain",
  }));

  const result = spawnSync("bash", [
    "scripts/seed-shared-skills.sh",
    "--import-sources",
    "none",
    "--share-targets",
    "codex",
  ], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vault,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const projectedAgentReach = join(home, ".codex", "skills", "agent-reach");
  assert.match(read(join(projectedAgentReach, "SKILL.md")), /name: agent-reach/);
  assert.equal(read(existingBundledMetadata), '{"provider":"user-reviewed"}\n', "setup should not rewrite existing shared-shelf provenance");
  const metadata = JSON.parse(read(join(projectedAgentReach, ".hivemind-skill-source.json")));
  assert.equal(metadata.managedBy, "hivemindos");
  assert.equal(metadata.provider, "shared-brain");
  assert.equal(metadata.targetRuntime, "codex");
  assert.equal(metadata.projection, "primary-overlay");
  assert.match(metadata.sourceChecksum, /^[a-f0-9]{64}$/, "managed projections should record the source content they already copied");

  assert.match(read(join(collisionDir, "SKILL.md")), /name: collision-local/);
  assert.match(read(join(managedDir, "SKILL.md")), /name: managed-old/);
  assert.match(read(join(home, ".codex", "AGENTS.md")), /primary skill source/);
  assert.match(result.stdout + result.stderr, /skipped 1 unmanaged local skill collision/);
  assert.equal(
    JSON.parse(read(join(vault, "Skills", "hyperframes", ".hivemind-skill-source.json"))).sourceChecksum,
    "preserve-for-checksum-aware-sync",
    "the seeder must not erase update provenance before hive-brain-sync compares checksums",
  );

  const hyperframesMetadata = JSON.parse(read(join(
    vault,
    "Skills",
    "product-launch-video",
    ".hivemind-skill-source.json",
  )));
  assert.equal(hyperframesMetadata.provider, "packaged-auto-install");
  assert.equal(hyperframesMetadata.commit, "3351fb1a6d7f0202d07db9bf9ad335fd0d1ec344");
  assert.equal(
    hyperframesMetadata.sourceArchiveSha256,
    "5371981bb828588789bd682c31f374204a0ba85af4d2c2052a7cff2cf011edfc",
    "shared-brain setup must preserve the shipped HyperFrames provenance",
  );

  const firstProjectionMetadata = read(join(projectedAgentReach, ".hivemind-skill-source.json"));
  const rerun = spawnSync("bash", [
    "scripts/seed-shared-skills.sh",
    "--import-sources",
    "none",
    "--share-targets",
    "codex",
  ], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vault,
    },
    encoding: "utf8",
  });
  assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
  assert.equal(
    read(join(projectedAgentReach, ".hivemind-skill-source.json")),
    firstProjectionMetadata,
    "an unchanged projection rerun should not rewrite hundreds of skill directories",
  );
  assert.match(rerun.stdout + rerun.stderr, /\b\d+ unchanged\b/, "reruns should report the fast unchanged path");

  writeFileSync(join(vault, "Skills", "agent-reach", "SKILL.md"), "---\nname: agent-reach\ndescription: Updated shared router.\n---\n\n# updated\n");
  const update = spawnSync("bash", [
    "scripts/seed-shared-skills.sh",
    "--import-sources",
    "none",
    "--share-targets",
    "codex",
  ], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vault,
    },
    encoding: "utf8",
  });
  assert.equal(update.status, 0, update.stderr || update.stdout);
  assert.match(read(join(projectedAgentReach, "SKILL.md")), /description: Updated shared router/);

  const missingShelf = spawnSync("node", [
    "scripts/sync-shared-skill-projections.mjs",
    "--source",
    join(tmp, "missing-skills"),
    "--target",
    join(tmp, "missing-target"),
    "--agent",
    "codex",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(missingShelf.status, 0, missingShelf.stderr || missingShelf.stdout);
  assert.equal(missingShelf.stdout, "0\t0\t0\t0\n", "a missing optional shelf should be a safe no-op");

  console.log("shared skill runtime projection checks passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
