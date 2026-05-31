#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { constants } from "fs";
import { access } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const root = resolve(process.cwd());
const tmp = await mkdtemp(join(tmpdir(), "hive-aeon-env-sync-"));
const bin = join(tmp, "bin");
const home = join(tmp, "home");
const envFile = join(tmp, "shared.env");
const logPath = join(tmp, "gh-log.jsonl");
const secretsPath = join(tmp, "gh-secrets.json");
const privatePath = join(tmp, "repo-private");
let lastRunOutput = "";

async function ensureDir(path) {
  await import("fs/promises").then(({ mkdir }) => mkdir(path, { recursive: true }));
}

function runHive(args) {
  const result = spawnSync("python3", [join(root, "scripts", "hive-env-add"), "--agent-env-file", envFile, "--no-backup", "--no-tailnet-sync", ...args], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HIVE_AEON_ENV_SYNC_REPOS: "owner/private",
      HIVE_AEON_ENV_AUTO_SYNC: "true",
      HIVE_NOTE_ROOT: join(tmp, "empty-vault"),
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`hive-env-add failed (${result.status})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  lastRunOutput = `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
  return result;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function logEvents() {
  const raw = await readFile(logPath, "utf8").catch(() => "");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

try {
  await ensureDir(bin);
  await ensureDir(home);
  await writeFile(privatePath, "true");
  await writeFile(secretsPath, "{}\n");
  await writeFile(join(bin, "gh"), `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const logPath = ${JSON.stringify(logPath)};
const secretsPath = ${JSON.stringify(secretsPath)};
const privatePath = ${JSON.stringify(privatePath)};
const repoIndex = args.indexOf("-R");
const repo = repoIndex >= 0 ? args[repoIndex + 1] : args[2];
const secrets = fs.existsSync(secretsPath) ? JSON.parse(fs.readFileSync(secretsPath, "utf8") || "{}") : {};
function save() { fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2) + "\\n"); }
function log(event) { fs.appendFileSync(logPath, JSON.stringify(event) + "\\n"); }
if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ isPrivate: fs.readFileSync(privatePath, "utf8").trim() === "true" }));
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "list") {
  process.stdout.write(JSON.stringify(Object.keys(secrets[repo] || {}).map((name) => ({ name }))));
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "set") {
  const key = args[2];
  const input = fs.readFileSync(0, "utf8");
  secrets[repo] = secrets[repo] || {};
  secrets[repo][key] = { length: input.length };
  save();
  log({ action: "set", repo, key, length: input.length });
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "delete") {
  const key = args[2];
  if (secrets[repo]) delete secrets[repo][key];
  save();
  log({ action: "delete", repo, key });
  process.exit(0);
}
process.stderr.write("unexpected gh args: " + args.join(" "));
process.exit(1);
`);
  await import("fs/promises").then(({ chmod }) => chmod(join(bin, "gh"), 0o755));

  runHive(["TEST_KEY=first"]);
  let events = await logEvents();
  if (events.filter((event) => event.action === "set" && event.key === "TEST_KEY").length !== 1) {
    throw new Error(`expected first TEST_KEY set\n${lastRunOutput}\nEVENTS:\n${JSON.stringify(events, null, 2)}`);
  }

  runHive(["TEST_KEY=first"]);
  events = await logEvents();
  if (events.filter((event) => event.action === "set" && event.key === "TEST_KEY").length !== 1) {
    throw new Error("expected unchanged TEST_KEY to skip");
  }

  runHive(["TEST_KEY=second"]);
  events = await logEvents();
  if (events.filter((event) => event.action === "set" && event.key === "TEST_KEY").length !== 2) {
    throw new Error("expected changed TEST_KEY to resync");
  }

  runHive(["PUBLIC_GUARD_KEY=kept-while-private"]);
  await writeFile(privatePath, "false");
  runHive(["--reconcile"]);
  events = await logEvents();
  if (!events.some((event) => event.action === "delete" && event.key === "PUBLIC_GUARD_KEY")) {
    throw new Error("expected managed secrets to be deleted when repo becomes public");
  }

  const state = await readJson(join(home, ".hivemindos", "aeon-env-sync-state.json"), {});
  if (state?.repos?.["owner/private"]?.private !== false) {
    throw new Error("expected sync state to record public restriction");
  }

  await access(logPath, constants.R_OK);
  console.log("aeon env auto sync differential smoke passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
