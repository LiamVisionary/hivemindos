import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = new URL("../src/features/dashboard/hooks/dashboard-swarm-command.ts", import.meta.url);
const source = readFileSync(sourcePath, "utf8")
  .replace(/^import .+;\n/gm, "")
  .replace(/\bexport\s+/g, "")
  + "\n;globalThis.__swarmTest = { parseSwarmCommand, taskWorkerClasses, selectSwarmAgents, formatSwarmReply };";

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const labels = {
  planner: "Planner",
  code: "Code",
  qa: "QA",
  general: "General",
  research: "Research",
  writer: "Writer",
  ops: "Ops",
  vision: "Vision",
  artist: "Artist",
};

const context = vm.createContext({
  console,
  TextDecoder,
  beeWorkerPreset(workerClass) {
    return {
      label: labels[workerClass] ?? workerClass,
      taskProfile: `${labels[workerClass] ?? workerClass} profile`,
    };
  },
  beeWorkerClassLabel(workerClass) {
    return labels[workerClass] ?? workerClass;
  },
  inferWorkerClass({ title = "", body = "" } = {}) {
    const text = `${title} ${body}`.toLowerCase();
    if (/\b(code|bug|typescript|fix|test)\b/.test(text)) return "code";
    if (/\b(research|source|latest)\b/.test(text)) return "research";
    return "general";
  },
  runtimeCan(agent, capability) {
    return Boolean(agent?.runtimeCapabilities?.[capability] ?? agent?.collectorCapabilities?.[capability]);
  },
});
vm.runInContext(compiled, context, { filename: "dashboard-swarm-command.ts" });

const { parseSwarmCommand, taskWorkerClasses, selectSwarmAgents, formatSwarmReply } = context.__swarmTest;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(parseSwarmCommand("/swarm fix the dashboard")), {
  task: "fix the dashboard",
});
assert.deepEqual(plain(parseSwarmCommand("/swarm 2 fix the dashboard")), {
  requestedAgentCount: 2,
  task: "fix the dashboard",
});
assert.deepEqual(plain(parseSwarmCommand("/swarm 99 fix the dashboard")), {
  requestedAgentCount: 8,
  task: "fix the dashboard",
});
assert.deepEqual(plain(parseSwarmCommand("/swarm 0 fix the dashboard")), {
  requestedAgentCount: 1,
  task: "fix the dashboard",
});
assert.deepEqual(plain(parseSwarmCommand("/swarm 2")), {
  requestedAgentCount: 2,
  task: "",
});

assert.deepEqual(plain(taskWorkerClasses("fix a TypeScript bug and test it", 2)), ["planner", "code"]);
assert.deepEqual(plain(taskWorkerClasses("fix a TypeScript bug and test it", 3)), ["planner", "code", "qa"]);
assert.equal(taskWorkerClasses("general planning", 99).length, 8);

const chatCapability = { chat: true };
const selectedAgent = {
  id: "queen",
  name: "Queen Bee",
  beeRole: "queen",
  workerClass: "planner",
  runtimeCapabilities: chatCapability,
  collectorCapabilities: chatCapability,
  machineName: "This Mac",
};
const agents = [
  { id: "unconfigured-planner", name: "Unconfigured Planner", beeRole: "queen", workerClass: "planner", runtimeCapabilities: chatCapability, collectorCapabilities: chatCapability, machineName: "This Mac" },
  selectedAgent,
  { id: "coder", name: "Coder", beeRole: "worker", workerClass: "code", runtimeCapabilities: chatCapability, collectorCapabilities: chatCapability },
  { id: "qa", name: "QA", beeRole: "worker", workerClass: "qa", runtimeCapabilities: chatCapability, collectorCapabilities: chatCapability },
  { id: "writer", name: "Writer", beeRole: "worker", workerClass: "writer", runtimeCapabilities: chatCapability, collectorCapabilities: chatCapability },
  { id: "observer", name: "Observer", beeRole: "observer", workerClass: "research", runtimeCapabilities: chatCapability, collectorCapabilities: chatCapability },
  { id: "offline", name: "Offline", beeRole: "worker", workerClass: "ops", runtimeCapabilities: {}, collectorCapabilities: {} },
];

assert.deepEqual(
  plain(selectSwarmAgents({ agents, selectedAgent, requestedAgentCount: 2, task: "fix a TypeScript bug and test it" }).map((plan) => plan.agent.id)),
  ["queen", "unconfigured-planner"],
);
assert.deepEqual(
  plain(selectSwarmAgents({
    agents,
    selectedAgent,
    requestedAgentCount: 2,
    task: "fix a TypeScript bug and test it",
    chatSetupIssue: (agent) => agent.id === "unconfigured-planner" ? "Missing gateway" : "",
  }).map((plan) => plan.agent.id)),
  ["queen", "coder"],
);
assert.deepEqual(
  plain(selectSwarmAgents({ agents, selectedAgent, requestedAgentCount: 3, task: "fix a TypeScript bug and test it" }).map((plan) => plan.agent.id)),
  ["queen", "unconfigured-planner", "qa"],
);
assert.equal(
  selectSwarmAgents({ agents, selectedAgent, requestedAgentCount: 8, task: "fix a TypeScript bug and test it" }).length,
  5,
);

const reply = formatSwarmReply("fix a TypeScript bug", [
  { agent: selectedAgent, workerClass: "planner", brief: "" },
  { agent: agents[2], workerClass: "code", brief: "" },
], [
  { status: "fulfilled", value: "Plan complete." },
  { status: "fulfilled", value: "Patch complete." },
]);
assert.match(reply, /## Swarm packet/);
assert.match(reply, /Completed: 2\/2/);
assert.match(reply, /Queen Bee - Planner/);
assert.match(reply, /Coder - Code/);

console.log("Dashboard swarm command parser, count selection, and packet formatting checks passed.");
