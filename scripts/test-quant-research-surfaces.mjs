#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const route = await import("../src/app/api/quant-research/route.ts");
const actions = await import("../src/lib/services/hive-actions/catalog.ts");
const contextIndex = await import("../src/lib/services/context-index.ts");
const skillOs = await import("../src/lib/services/skills/skill-os.ts");

const policyResponse = await route.GET(new Request("http://localhost/api/quant-research?action=policy"));
assert.equal(policyResponse.status, 200);
const policyBody = await policyResponse.json();
assert.equal(policyBody.ok, true);
assert.equal(policyBody.policy.researchOnly, true);
assert.equal(policyBody.policy.liveTradingEnabled, false);
assert.equal(policyBody.roles.length, 6);

const invalidResponse = await route.GET(new Request("http://localhost/api/quant-research?action=nope"));
assert.equal(invalidResponse.status, 400);
assert.equal((await invalidResponse.json()).ok, false);

const action = actions.listHiveActions().find((item) => item.id === "research.quant-swarm");
assert.ok(action, "quant research must be discoverable in the canonical Hive action matrix");
assert.equal(action.contextIndex.route, "/api/quant-research");
assert.equal(action.readOnly, undefined, "run capability writes only local research artifacts");
assert.match(action.contextIndex.retrievalText, /research-only/i);

const search = await contextIndex.searchContextIndex({
  query: "run a Rust backtest with independent Python validation and overfitting checks",
  kinds: ["tool-schema"],
  limit: 10,
});
assert.ok(search.items.some((item) => item.id === "hive-action:research.quant-swarm"));

const cliPolicy = spawnSync("node", ["scripts/hive-quant-research.mjs", "policy"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
assert.equal(cliPolicy.status, 0, cliPolicy.stderr);
assert.equal(JSON.parse(cliPolicy.stdout).policy.liveTradingEnabled, false);

const runRoot = mkdtempSync(join(tmpdir(), "quant-cli-"));
const cliList = spawnSync("node", ["scripts/hive-quant-research.mjs", "list", "--run-root", runRoot], {
  cwd: process.cwd(),
  encoding: "utf8",
});
assert.equal(cliList.status, 0, cliList.stderr);
assert.deepEqual(JSON.parse(cliList.stdout).runs, []);

const skillMarkdown = readFileSync("packaged-skills/auto-install/hive-quant-research/SKILL.md", "utf8");
const scheduledActions = skillOs.parseWorkflowActions(skillMarkdown);
assert.equal(scheduledActions.length, 1);
assert.equal(scheduledActions[0].command, "hive-quant-research");
assert.equal(scheduledActions[0].requiresApproval, true);
assert.ok(scheduledActions[0].permissions.includes("filesystem:write"));

console.log("Quant research API, CLI, and capability discovery passed.");
