import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  skill("managed-old", "Shared copy that should replace a managed projection.");

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
  const metadata = JSON.parse(read(join(projectedAgentReach, ".hivemind-skill-source.json")));
  assert.equal(metadata.managedBy, "hivemindos");
  assert.equal(metadata.provider, "shared-brain");
  assert.equal(metadata.targetRuntime, "codex");
  assert.equal(metadata.projection, "primary-overlay");

  assert.match(read(join(collisionDir, "SKILL.md")), /name: collision-local/);
  assert.match(read(join(managedDir, "SKILL.md")), /name: managed-old/);
  assert.match(read(join(home, ".codex", "AGENTS.md")), /primary skill source/);
  assert.match(result.stdout + result.stderr, /skipped 1 unmanaged local skill collision/);

  console.log("shared skill runtime projection checks passed");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
