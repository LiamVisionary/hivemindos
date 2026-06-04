#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tmp = await mkdtemp(join(tmpdir(), "hive-env-remove-"));
const envFile = join(tmp, ".hivemindos", ".env");
const bin = join(tmp, "bin");
const ghLog = join(tmp, "gh-log.jsonl");

function run(script, args) {
  const result = spawnSync("python3", [join(root, "scripts", script), "--agent-env-file", envFile, "--no-backup", "--no-tailnet-sync", "--no-aeon-auto-sync", ...args], {
    cwd: root,
    env: {
      ...process.env,
      HOME: tmp,
      HIVE_ENV_PROJECT_ROOT: root,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    },
    text: true,
    encoding: "utf8",
  });
  return result;
}

try {
  await mkdir(join(tmp, ".hivemindos"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(ghLog)};
const repoIndex = args.indexOf("-R");
const repo = repoIndex >= 0 ? args[repoIndex + 1] : "";
if (args[0] === "secret" && args[1] === "set") {
  const key = args[2];
  const input = fs.readFileSync(0, "utf8");
  fs.appendFileSync(logPath, JSON.stringify({ action: "set", repo, key, length: input.length }) + "\\n");
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "delete") {
  const key = args[2];
  fs.appendFileSync(logPath, JSON.stringify({ action: "delete", repo, key }) + "\\n");
  process.exit(0);
}
process.stderr.write("unexpected gh args: " + args.join(" "));
process.exit(1);
`);
  await chmod(join(bin, "gh"), 0o755);

  let result = run("hive-env-add", ["HIVE_REMOVE_ONE=present"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = run("hive-env-add", ["HIVE_REMOVE_TWO=present"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = run("hive-env-remove", ["HIVE_REMOVE_ONE"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let envText = await readFile(envFile, "utf8");
  assert.ok(!envText.includes("HIVE_REMOVE_ONE="), "hive-env-remove should remove the named key");
  assert.ok(envText.includes("HIVE_REMOVE_TWO=present"), "hive-env-remove should preserve other keys");

  result = run("hive-env-delete", ["HIVE_REMOVE_TWO"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  envText = await readFile(envFile, "utf8");
  assert.ok(!envText.includes("HIVE_REMOVE_TWO="), "hive-env-delete should remove the named key");

  result = run("hive-env-remove", ["BAD-KEY"]);
  assert.equal(result.status, 2, "invalid keys should fail before touching env files");

  result = run("hive-env-add", ["--runtime", "aeon", "--sync-aeon-github-secret", "--aeon-repo", "owner/private", "AEON_REMOVE_KEY=present"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = run("hive-env-remove", ["--runtime", "aeon", "--sync-aeon-github-secret", "--aeon-repo", "owner/private", "AEON_REMOVE_KEY"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const ghEvents = (await readFile(ghLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(ghEvents.some((event) => event.action === "set" && event.key === "AEON_REMOVE_KEY"), "expected AEON secret set before removal");
  assert.ok(ghEvents.some((event) => event.action === "delete" && event.key === "AEON_REMOVE_KEY"), "expected AEON secret delete on removal");

  console.log("hive env remove/delete smoke passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
