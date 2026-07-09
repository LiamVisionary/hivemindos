#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = spawnSync(process.execPath, [
  "scripts/hive-capability-search",
  "--json",
  "--no-api",
  "--limit",
  "8",
  "--kinds",
  "skill,tool-schema",
  "capability search workflow fusion route",
], {
  cwd: root,
  encoding: "utf8",
});

assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const payload = JSON.parse(cli.stdout);
assert.equal(payload.ok, true);
assert.equal(payload.source, "local-index");
assert.equal(payload.delivery.api, "/api/context-index");
assert.match(payload.delivery.noCli, /phone|No CLI|injected/i);
assert.ok(
  payload.selected.some((item) => item.id.includes("hive-capability-search") || /capability search/i.test(item.title)),
  "Expected the CLI to return the hive-capability-search skill or a capability-search result.",
);
assert.ok(
  payload.gaps.some((gap) => /Local mode/.test(gap)),
  "Local mode should explicitly disclose that connected apps were not refreshed.",
);

const files = {
  "setup.sh": readFileSync(resolve(root, "setup.sh"), "utf8"),
  "setup.ps1": readFileSync(resolve(root, "setup.ps1"), "utf8"),
  "uninstall.sh": readFileSync(resolve(root, "uninstall.sh"), "utf8"),
  "uninstall.ps1": readFileSync(resolve(root, "uninstall.ps1"), "utf8"),
  "packaged-skills/auto-install/hive-capability-search/SKILL.md": readFileSync(resolve(root, "packaged-skills/auto-install/hive-capability-search/SKILL.md"), "utf8"),
  "docs/for-users/packaged-skills/hive-skills.md": readFileSync(resolve(root, "docs/for-users/packaged-skills/hive-skills.md"), "utf8"),
};

for (const [file, content] of Object.entries(files)) {
  assert.match(content, /hive-capability-search/, `${file} should mention hive-capability-search`);
}

assert.match(
  files["packaged-skills/auto-install/hive-capability-search/SKILL.md"],
  /do not assume every agent has shell access/i,
  "Capability-search skill should preserve the no-shell runtime contract.",
);
assert.match(
  files["packaged-skills/auto-install/hive-capability-search/SKILL.md"],
  /phone-hosted|app-routed/i,
  "Capability-search skill should name app/phone no-CLI paths.",
);
assert.match(
  files["docs/for-users/packaged-skills/hive-skills.md"],
  /Agents without shell access/i,
  "Docs should explain no-CLI capability-search behavior.",
);

console.log("Hive capability search CLI contract passed.");
