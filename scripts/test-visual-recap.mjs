#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const execFileAsync = promisify(execFile);
const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-visual-recap-"));
const repo = join(tempHome, "repo");
const vaultPath = join(tempHome, "vault");
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;

try {
  await mkdir(vaultPath, { recursive: true });
  await setupRepo(repo);

  const service = await import("../src/lib/services/visual-recap.ts");
  const result = await service.buildVisualRecap({
    cwd: repo,
    includeUntracked: true,
    maxFiles: 20,
  });

  assert.ok(result.changedFiles.includes("src/app/api/wallet/send/route.ts"));
  assert.ok(result.untrackedFiles.includes("src/features/dashboard/views/NewPanel.tsx"));
  const riskBlock = result.artifactInput.blocks.find((block) => block.type === "risk");
  assert.match(riskBlock.markdown, /Wallet\/payment files changed/);
  assert.match(riskBlock.markdown, /API routes changed/);
  const fileTree = result.artifactInput.blocks.find((block) => block.type === "file-tree");
  assert.equal(fileTree.items.some((item) => item.path === "src/app/api/wallet/send/route.ts"), true);

  const saved = await service.buildVisualRecap({
    cwd: repo,
    includeUntracked: true,
    vaultPath,
    save: true,
    title: "Saved recap",
  });
  assert.equal(saved.saved.storage.kind, "vault");
  const rawArtifact = await readFile(saved.saved.storage.path, "utf8");
  assert.match(rawArtifact, /Saved recap/);
  assert.match(rawArtifact, /src\/app\/api\/wallet\/send\/route\.ts/);

  const script = await execFileAsync(
    "node",
    [
      join(process.cwd(), "scripts", "visual-recap.mjs"),
      `--cwd=${repo}`,
      "--dry-run",
      "--json",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: tempHome,
        NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vaultPath,
      },
      maxBuffer: 1024 * 1024,
    },
  );
  const payload = JSON.parse(script.stdout.toString());
  assert.equal(payload.ok, true);
  assert.equal(payload.dryRun, true);
  assert.ok(payload.changedFiles.includes("src/app/api/wallet/send/route.ts"));

  console.log("Visual recap tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

async function setupRepo(root) {
  await mkdir(root, { recursive: true });
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "HivemindOS Test"]);
  await write(join(root, "src/app/api/wallet/send/route.ts"), "export const runtime = 'nodejs';\n");
  await write(join(root, "scripts/test-existing.mjs"), "console.log('ok');\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "baseline"]);
  await write(join(root, "src/app/api/wallet/send/route.ts"), "export const runtime = 'nodejs';\nexport const changed = true;\n");
  await write(join(root, "src/features/dashboard/views/NewPanel.tsx"), "export function NewPanel() { return null; }\n");
}

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

async function git(cwd, args) {
  await execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 });
}
