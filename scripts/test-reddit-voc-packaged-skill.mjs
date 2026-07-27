#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { register } from "node:module";

const exec = promisify(execFile);
const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageDir = join(root, "packaged-skills/optional/gtm/mikefutia/reddit-voc-research");
const scriptPath = join(packageDir, "scripts/fetch_reddit.py");
const tempRoot = await mkdtemp(join(tmpdir(), "hivemind-reddit-voc-"));
process.env.HOME = join(tempRoot, "home");
await mkdir(process.env.HOME, { recursive: true });

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { getSkillCatalog } = await import("../src/lib/services/skills/skill-os.ts");

try {
  const metadata = JSON.parse(await readFile(join(packageDir, ".hivemind-skill-source.json"), "utf8"));
  assert.equal(metadata.commit, "379d8e63801585e59e0660fe66a5e8a61fe51747");
  assert.equal(metadata.sourceArchiveSha256, "dab87e934b2f058d07de9890a8c0894c423e7d35d778ad2c022fef66e42dce3f");
  assert.equal(metadata.license, "MIT");
  assert.equal(metadata.provider, "packaged-optional");

  const catalog = await getSkillCatalog({ query: "reddit", includeRegistry: false });
  const entry = catalog.find((item) => item.slug === "reddit-voc-research");
  assert(entry, "Reddit VOC Research should be discoverable in the optional Skill Browser catalog");
  assert.equal(entry.source, "UI Skills: mikefutia");
  assert.equal(entry.category, "Gtm");
  assert.equal(entry.packagedPath, "packaged-skills/optional/gtm/mikefutia/reddit-voc-research");
  assert.ok(entry.envKeys.includes("SCRAPECREATORS_API_KEY"));

  const script = await readFile(scriptPath, "utf8");
  assert.doesNotMatch(script, /scrapecreators-key\.txt/);
  assert.doesNotMatch(script, /["']author["']\s*:/);
  assert.match(script, /max\(1, min\(20, args\.threads\)\)/);
  assert.match(script, /max\(1, min\(40, args\.comments_per_thread\)\)/);
  assert.match(script, /host\.endswith\("\.reddit\.com"\)/);
  assert.match(script, /"schema": "hivemindos-reddit-voc-source-v1"/);

  await exec("python3", ["-m", "py_compile", scriptPath], { env: { ...process.env, PYTHONPYCACHEPREFIX: join(tempRoot, "pycache") } });
  const help = await exec("python3", [scriptPath, "--help"]);
  assert.match(help.stdout, /--comments-per-thread/);
  const missingKey = await exec("python3", [scriptPath, "--query", "test", "--subreddits", "SaaS", "--outdir", tempRoot], {
    env: { PATH: process.env.PATH ?? "" },
  }).catch((error) => error);
  assert.equal(missingKey.code, 2);
  assert.match(missingKey.stderr, /SCRAPECREATORS_API_KEY is not configured/);

  assert.match(await readFile(join(root, "packaged-skills/README.md"), "utf8"), /gtm\/mikefutia\/reddit-voc-research/);
  assert.match(await readFile(join(root, "docs/for-users/packaged-skills/third-party-skills.md"), "utf8"), /gtm\/mikefutia\/reddit-voc-research/);
  console.log("Reddit VOC Research is pinned, bounded, documented, and discoverable.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
