import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aeonCli, parseAeonCliJson, readAeonControlPlane } from "../src/lib/services/runtime-adapters/aeon-cli";
import { AEON_OUTPUT_DIRECTORIES } from "../src/lib/services/runtime-adapters/aeon-capabilities";
import { inspectAeonWorkspace, replaceLegacyAeonWorkspace } from "../src/lib/services/runtime-adapters/aeon-workspace";

const temp = await mkdtemp(join(tmpdir(), "hivemind-aeon-v01-"));

async function write(path: string, content: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

try {
  const root = join(temp, "current");
  await Promise.all([
    mkdir(join(root, "apps", "cli"), { recursive: true }),
    mkdir(join(root, "catalog"), { recursive: true }),
    mkdir(join(root, "skills", "morning-brief"), { recursive: true }),
    mkdir(join(root, "output", ".chains"), { recursive: true }),
    mkdir(join(root, "output", ".attest"), { recursive: true }),
    mkdir(join(root, "output", "articles"), { recursive: true }),
    mkdir(join(root, "memory", "topics"), { recursive: true }),
    mkdir(join(root, "memory", "issues"), { recursive: true }),
    mkdir(join(root, "memory", "skill-health"), { recursive: true }),
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(root, "apps", "dashboard", "outputs"), { recursive: true }),
  ]);
  await write(join(root, "aeon.yml"), [
    "model: claude-sonnet-5",
    "harness: claude",
    "gateway: { provider: bankr }",
    "skills:",
    "  morning-brief: { enabled: true, schedule: '0 9 * * *' }",
    "chains:",
    "  daily-research:",
    "    skills: [morning-brief]",
    "reactive:",
    "  issue-opened:",
    "    skill: morning-brief",
    "",
  ].join("\n"));
  await write(join(root, "catalog", "skills.json"), JSON.stringify({ skills: [{ slug: "morning-brief", category: "research" }] }));
  await write(join(root, "output", ".chains", "daily-research.json"), "{}");
  await write(join(root, "output", ".attest", "receipt.json"), "{}");
  await write(join(root, "memory", "topics", "index.md"), "---\nokf_version: 0.1\n---\n# Knowledge\n");
  await write(join(root, "memory", "topics", "concept.md"), "---\ntype: Concept\n---\n# Concept\n");
  await write(join(root, "memory", "issues", "skill-health.md"), "# Issue\n");
  await write(join(root, "memory", "skill-health", "record.json"), "{}");
  await write(join(root, "scripts", "okf-config.json"), "{}");
  await write(join(root, "scripts", "okf-validate.mjs"), "");

  const cli = join(root, "apps", "cli", "aeon");
  await write(cli, `#!/bin/sh
	printf '%s\\n' "$*" > "$AEON_REPO_ROOT/.last-cli-args"
	printf 'AEON CLI bootstrap ready\\n'
case "$1 $2" in
  "skills ls") printf '%s\\n' '[{"name":"morning-brief","description":"Build the morning brief.","tags":["research"],"requires":[{"key":"ANTHROPIC_API_KEY","optional":false}],"mcp":[{"slug":"hivemind","optional":true}],"category":"research","pack":"core","packName":"Core","enabled":true,"schedule":"0 9 * * *","var":"","model":"","harness":""}]' ;;
  "config show") printf '%s\\n' '{"repo":"owner/aeon","model":"claude-sonnet-5","harness":"claude","gateway":"bankr","jsonrenderEnabled":true,"skillsEnabled":1,"skillsConfigured":1}' ;;
  "packs ls") printf '%s\\n' '{"firstParty":[{"key":"core","name":"Core","description":"Core skills","total":1,"enabled":1}],"community":[]}' ;;
  "mcp ls") printf '%s\\n' '{"hivemind":{"command":"node","args":["server.mjs"]}}' ;;
  "mcp catalog") printf '%s\\n' '[{"slug":"github","name":"GitHub","url":"https://example.test/mcp"}]' ;;
  "strategy show") printf '%s\\n' '{"exists":true,"content":"# Strategy"}' ;;
  "soul show") printf '%s\\n' '{"soul":{"exists":true,"content":"# Soul"},"style":{"exists":true,"content":"# Style"}}' ;;
  "secrets ls") printf '%s\\n' '[{"name":"ANTHROPIC_API_KEY","group":"Models","description":"Claude API","isSet":true}]' ;;
  "runs ls") printf '%s\\n' '[{"id":42,"workflow":"Morning Brief","status":"completed","conclusion":"success","created_at":"2026-07-10T00:00:00Z","url":"https://example.test/run/42"}]' ;;
  *) printf '%s\\n' '{"ok":true}' ;;
esac
`);
  await chmod(cli, 0o755);

  assert.deepEqual(parseAeonCliJson<{ ok: boolean }>("npm install prelude\n{\"ok\":true}\n"), { ok: true });
  const layout = await inspectAeonWorkspace(root);
  assert.equal(layout.generation, "v0.1");
  assert.equal(layout.hasLegacyManifest, false, "AEON v0.1 must not require a root skills.json");
  assert(layout.outputDirectories.includes("output/.chains"));
  assert(AEON_OUTPUT_DIRECTORIES.includes("apps/dashboard/outputs"));

  const skills = await aeonCli.skills(root);
  assert.equal(skills[0]?.requires[0]?.key, "ANTHROPIC_API_KEY");
  assert.equal(skills[0]?.mcp[0]?.slug, "hivemind");
  const runs = await aeonCli.runs(root, 5);
  assert.equal(runs[0]?.workflow, "Morning Brief");
  await aeonCli.runSkill(root, "morning-brief", { var: "Company launch brief" });
  assert.match(await readFile(join(root, ".last-cli-args"), "utf8"), /skills run morning-brief --var Company launch brief --json/);

  const control = await readAeonControlPlane(root);
  assert.equal(control.config.gateway, "bankr");
  assert.equal(control.packs.firstParty[0]?.enabled, 1);
  assert.equal(control.strategy.exists, true);
  assert.equal(control.soul.style.exists, true);
  assert.equal(control.chains.definitions, 1);
  assert.equal(control.chains.artifacts, 1);
  assert.equal(control.reactive.rules, 1);
  assert.equal(control.provenance.attestations, 1);
  assert.equal(control.health.issues, 1);
  assert.equal(control.health.scoreRecords, 1);
  assert.equal(control.okf.version, "0.1");
  assert.equal(control.okf.markdownFiles, 2);

  const legacy = join(temp, "legacy");
  await mkdir(legacy, { recursive: true });
  await write(join(legacy, "aeon.yml"), "skills:\n");
  await write(join(legacy, "skills.json"), JSON.stringify({ skills: [] }));
  assert.equal((await inspectAeonWorkspace(legacy)).generation, "legacy");
  assert.equal((await inspectAeonWorkspace(join(temp, "missing"))).generation, "invalid");

  const repaired = await replaceLegacyAeonWorkspace(legacy, async (installRoot) => {
    await write(join(installRoot, "aeon.yml"), "skills:\n");
    await write(join(installRoot, "catalog", "skills.json"), JSON.stringify({ skills: [] }));
    await write(join(installRoot, "apps", "cli", "aeon"), "#!/bin/sh\nexit 0\n");
    await chmod(join(installRoot, "apps", "cli", "aeon"), 0o755);
  }, new Date("2026-07-11T06:00:00.000Z"));
  assert.equal(repaired.changed, true);
  assert.equal((await inspectAeonWorkspace(legacy)).generation, "v0.1");
  assert.equal((await inspectAeonWorkspace(repaired.backupRoot)).generation, "legacy");

  const rollbackRoot = join(temp, "legacy-rollback");
  await write(join(rollbackRoot, "aeon.yml"), "skills:\n");
  await write(join(rollbackRoot, "skills.json"), JSON.stringify({ skills: [] }));
  await assert.rejects(
    replaceLegacyAeonWorkspace(rollbackRoot, async (installRoot) => {
      await write(join(installRoot, "partial-clone"), "incomplete");
      throw new Error("simulated clone failure");
    }, new Date("2026-07-11T06:01:00.000Z")),
    /legacy workspace was restored: simulated clone failure/,
  );
  assert.equal((await inspectAeonWorkspace(rollbackRoot)).generation, "legacy");
  assert.equal(await access(join(rollbackRoot, "partial-clone")).then(() => true).catch(() => false), false);

  const [workspaceRoute, nativeDeliverables] = await Promise.all([
    readFile(join(process.cwd(), "src/app/api/runtimes/aeon/workspaces/route.ts"), "utf8"),
    readFile(join(process.cwd(), "src-tauri/src/deliverables.rs"), "utf8"),
  ]);
  assert(!workspaceRoute.includes('writeFile(join(root, "skills.json")'), "web setup must not manufacture legacy skills.json");
  assert(!workspaceRoute.includes('mkdir(join(root, ".outputs")'), "web setup must not manufacture legacy output folders");
  assert(!nativeDeliverables.includes('ensure_file(&root.join("skills.json")'), "native setup must not manufacture legacy skills.json");
  assert(nativeDeliverables.includes('"output/.attest"'), "native output discovery must include v0.1 attestations");
  assert(workspaceRoute.includes('action === "repair-legacy"'), "web setup must expose the legacy-workspace repair action");

  console.log("AEON v0.1 compatibility contract passed.");
  console.log("- CLI JSON prelude parsing: passed");
  console.log("- v0.1 vs legacy workspace detection: passed");
  console.log("- skills/requires/MCP/run mapping: passed");
  console.log("- control-plane packs, identity, chains, reactive, health, OKF, and provenance: passed");
  console.log("- web/native setup and output migration guards: passed");
  console.log("- one-click legacy backup, v0.1 replacement, and failed-install rollback: passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
