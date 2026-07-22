#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const guardScript = path.join(repoRoot, "scripts/guard-ui-typography.mjs");
const designContract = readFileSync(path.join(repoRoot, "DESIGN.md"), "utf8");
const agentInstructions = readFileSync(path.join(repoRoot, "src/AGENTS.md"), "utf8");
const designSystemButton = readFileSync(
  path.join(repoRoot, "public/design-system/components/core/Button.jsx"),
  "utf8",
);

assert.match(designContract, /control-label:[\s\S]*?fontWeight:\s*500/);
assert.match(designContract, /Interactive control labels default to weight `500`/);
assert.match(agentInstructions, /Interactive control labels must use font weight `400–600`/);
assert.match(agentInstructions, /pass `guard:ui-typography`/);
assert.match(designSystemButton, /fontWeight:\s*v\.fontWeight \|\| 500/);

async function write(root, file, body) {
  const fullPath = path.join(root, file);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, body, "utf8");
}

function runGuard(root, extra = []) {
  return spawnSync("node", [guardScript, "--root", root, ...extra], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const tmp = await mkdtemp(path.join(tmpdir(), "ui-typography-guard-"));

try {
  const heavyCssRoot = path.join(tmp, "heavy-css");
  await write(
    heavyCssRoot,
    "src/Heavy.module.css",
    `.actions button { font-weight: 800; }\n.hero h1 { font-weight: 800; }\n`,
  );
  const heavyCss = runGuard(heavyCssRoot);
  assert.notEqual(heavyCss.status, 0, "heavy button labels should fail");
  assert.match(heavyCss.stderr, /Heavy\.module\.css:1/);
  assert.doesNotMatch(heavyCss.stderr, /hero h1/, "display headings remain allowed");

  const calmCssRoot = path.join(tmp, "calm-css");
  await write(calmCssRoot, "src/Calm.module.css", `.primaryButton { font-weight: 500; }\n`);
  const calmCss = runGuard(calmCssRoot);
  assert.equal(calmCss.status, 0, calmCss.stderr || calmCss.stdout);

  const heavyJsxRoot = path.join(tmp, "heavy-jsx");
  await write(
    heavyJsxRoot,
    "src/Heavy.tsx",
    `export function Heavy() { return <button className="font-extrabold">Continue</button>; }\n`,
  );
  const heavyJsx = runGuard(heavyJsxRoot);
  assert.notEqual(heavyJsx.status, 0, "heavy Tailwind button labels should fail");
  assert.match(heavyJsx.stderr, /Heavy\.tsx:1/);

  const allowedRoot = path.join(tmp, "allowed");
  await write(
    allowedRoot,
    "src/Allowed.module.css",
    `/* guard:allow-heavy-control - icon-only branded control */\n.iconButton { font-weight: 700; }\n`,
  );
  const allowed = runGuard(allowedRoot);
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

  const baselineRoot = path.join(tmp, "baseline");
  await write(baselineRoot, "src/Legacy.module.css", `.legacyButton { font-weight: 800; }\n`);
  await write(
    baselineRoot,
    "baseline.json",
    `${JSON.stringify({
      version: 1,
      entries: [
        {
          file: "src/Legacy.module.css",
          selector: ".legacyButton",
          weight: "800",
        },
      ],
    }, null, 2)}\n`,
  );
  const baseline = runGuard(baselineRoot, ["--baseline", "baseline.json"]);
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

  console.log("UI typography guard tests passed.");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
