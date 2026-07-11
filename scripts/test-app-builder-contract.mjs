#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const contractPath = "contracts/app-builder/v1.json";
assert.equal(existsSync(contractPath), true, "the public repo must own the canonical app-builder contract");

const contract = JSON.parse(await readFile(contractPath, "utf8"));
assert.equal(contract.protocol, "hivemindos.app-builder/v1");
assert.equal(contract.version, "1.0.0");
assert.equal(contract.provenance?.donors?.december?.commit, "909b5c23dce9316e88a2755baef56b3ded2845e0");
assert.equal(contract.templates.nextjs.files["package.json"].includes('"next": "16.2.6"'), true);
assert.deepEqual(
  contract.capabilities.find((item) => item.id === "projects.create")?.backends,
  ["local", "managed"],
);
assert.deepEqual(
  contract.capabilities.find((item) => item.id === "runtime.start")?.backends,
  ["local"],
);
assert.deepEqual(
  contract.capabilities.find((item) => item.id === "files.write")?.backends,
  ["local"],
);
assert.equal(contract.confirmations.createProject, "CONFIRM_APP_PROJECT_CREATE");
assert.equal(contract.confirmations.installDependencies, "CONFIRM_APP_DEPENDENCIES");
assert.equal(contract.confirmations.startRuntime, "CONFIRM_APP_RUNTIME");
assert.doesNotMatch(JSON.stringify(contract), /payTo|HCLOUD_TOKEN|OPENROUTER_API_KEY|docker\.sock/);

const projectTypes = await readFile("src/lib/types/gitlawb.ts", "utf8");
const projectRegistry = await readFile("src/lib/services/projects/project-registry.ts", "utf8");
assert.equal(existsSync("src/app/api/app-builder/route.ts"), true, "the authenticated app-builder API route must exist");
assert.equal(existsSync("src/lib/services/hive-actions/app-builder.ts"), true, "the app-builder Hive Action must exist");
const route = await readFile("src/app/api/app-builder/route.ts", "utf8");
const action = await readFile("src/lib/services/hive-actions/app-builder.ts", "utf8");
const mcp = await readFile("scripts/hivemind-mcp", "utf8");
const collector = await readFile("scripts/agent-telemetry-collector.mjs", "utf8");
const localAdapter = await readFile("scripts/lib/app-builder.mjs", "utf8");

assert.match(projectTypes, /appBuilder\?:/);
assert.match(projectRegistry, /appBuilder:/);
assert.match(route, /requireAuth/);
assert.match(route, /isFleetCollectorUrl/);
assert.match(route, /createManagedCloudAppProject/);
assert.match(route, /async function runLocal\(body:[\s\S]{0,600}if \(action === "list"\)/);
assert.match(action, /toolName: "app_builder"/);
assert.match(action, /APP_BUILDER_CONFIRMATIONS/);
assert.match(mcp, /name === "app_builder"/);
assert.match(collector, /pathname === "\/app-builder"/);
assert.match(collector, /pathname === "\/app-builder"[\s\S]{0,500}requireLinkOwner/);
assert.doesNotMatch(localAdapter, /CONFIRM_APP_PROJECT_CREATE/);
assert.doesNotMatch(mcp, /CONFIRM_APP_PROJECT_CREATE/);
assert.match(mcp, /collectorUrl: machine\.device\?\.collectorUrl/);

console.log("App-builder canonical contract and integration surfaces are single-sourced.");
