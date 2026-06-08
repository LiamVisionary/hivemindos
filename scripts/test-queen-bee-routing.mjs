#!/usr/bin/env node
import assert from "node:assert/strict";
import { chooseQueenBeeDelegate, inferQueenBeeWorkerClass } from "../src/lib/services/queen-bee/router.ts";

const baseAgent = {
  id: "agent-general",
  name: "General Worker",
  runtime: "hermes",
  gatewayUrl: "",
  beeRole: "worker",
  workerClass: "general",
  runtimeCapabilities: { chat: true },
  collectorCapabilities: { chat: true },
};

function machine(key, name, agents, extra = {}) {
  return {
    key,
    collector: "ready",
    device: {
      self: false,
      name,
      os: "linux",
      online: true,
      collectorUrl: `http://${key}.local:5055`,
      ...extra.device,
    },
    capabilities: { chat: true, runtimes: ["hermes", "codex"], ...extra.capabilities },
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "device" && key !== "capabilities")),
    agents,
  };
}

assert.equal(inferQueenBeeWorkerClass({ title: "fix the TypeScript API tests", body: "" }), "code");
assert.equal(inferQueenBeeWorkerClass({ title: "verify this UI with screenshots", body: "" }), "vision");
assert.equal(inferQueenBeeWorkerClass({ title: "deploy the collector and check Tailscale", body: "" }), "ops");

const codeMachine = machine("ubuntu", "Ubuntu Build Box", [{
  ...baseAgent,
  id: "codex-code",
  name: "Codex Code Bee",
  runtime: "codex",
  workerClass: "code",
  machineName: "Ubuntu Build Box",
}]);
const localQueen = machine("mac", "This Mac", [{
  ...baseAgent,
  id: "queen-local",
  name: "Local Queen",
  beeRole: "queen",
  workerClass: "planner",
  machineName: "This Mac",
}], { device: { self: true, os: "darwin" } });
const visionMachine = machine("studio", "Vision Studio", [{
  ...baseAgent,
  id: "vision-worker",
  name: "Vision Bee",
  runtime: "openclaw",
  workerClass: "vision",
  machineName: "Vision Studio",
}]);

const codeRoute = chooseQueenBeeDelegate({
  title: "Implement API route and TypeScript tests",
  body: "Need repository edits, lint, and typecheck.",
}, [localQueen, visionMachine, codeMachine]);
assert.equal(codeRoute.status, "delegated");
assert.equal(codeRoute.workerClass, "code");
assert.equal(codeRoute.agent?.id, "codex-code");
assert.equal(codeRoute.machine?.key, "ubuntu");
assert.match(codeRoute.reason, /best available code worker/i);

const visionRoute = chooseQueenBeeDelegate({
  title: "Inspect the screenshot and verify CTA contrast",
  body: "Use visual QA on the rendered page.",
}, [codeMachine, localQueen, visionMachine]);
assert.equal(visionRoute.workerClass, "vision");
assert.equal(visionRoute.agent?.id, "vision-worker");
assert.equal(visionRoute.machine?.key, "studio");

const fallbackRoute = chooseQueenBeeDelegate({ title: "Summarize the release notes", body: "" }, [localQueen]);
assert.equal(fallbackRoute.status, "delegated");
assert.equal(fallbackRoute.agent?.id, "queen-local");
assert.equal(fallbackRoute.machine?.key, "mac");
assert.match(fallbackRoute.reason, /only available/i);

const olderHivemindMachine = machine("collector-old", "Collector Old", [{
  ...baseAgent,
  id: "old-code-worker",
  name: "Old Code Bee",
  runtime: "codex",
  workerClass: "code",
}], {
  version: {
    appDir: "/Users/liam/hivemindos",
    branch: "main",
    commit: "1111111111111111111111111111111111111111",
    latestCommit: "3333333333333333333333333333333333333333",
    dirty: false,
  },
});
const latestHivemindMachine = machine("collector-latest", "Collector Latest", [{
  ...baseAgent,
  id: "latest-code-worker",
  name: "Latest Code Bee",
  runtime: "codex",
  workerClass: "code",
}], {
  version: {
    appDir: "/Users/liam/hivemindos",
    branch: "main",
    commit: "3333333333333333333333333333333333333333",
    latestCommit: "3333333333333333333333333333333333333333",
    dirty: false,
  },
});
const unrelatedLatestMachine = machine("other-latest", "Other Latest", [{
  ...baseAgent,
  id: "other-code-worker",
  name: "Other Code Bee",
  runtime: "codex",
  workerClass: "code",
}], {
  version: {
    appDir: "/Users/liam/other-project",
    branch: "main",
    commit: "4444444444444444444444444444444444444444",
    latestCommit: "4444444444444444444444444444444444444444",
    dirty: false,
  },
});
const latestProjectRoute = chooseQueenBeeDelegate({
  title: "Add a toolbar button to this project",
  body: "This is a repository code change; pick the machine with the latest checkout of that project.",
}, [olderHivemindMachine, unrelatedLatestMachine, latestHivemindMachine]);
assert.equal(latestProjectRoute.status, "delegated");
assert.equal(latestProjectRoute.agent?.id, "latest-code-worker");
assert.equal(latestProjectRoute.machine?.key, "collector-latest");
assert.match(latestProjectRoute.reason, /matching project checkout/i);
assert.match(latestProjectRoute.reason, /up to date/i);

const staleMapsAgencyMachine = machine("maps-stale", "Maps Stale", [{
  ...baseAgent,
  id: "maps-stale-code-worker",
  name: "Maps Stale Code Bee",
  runtime: "codex",
  workerClass: "code",
}], {
  version: {
    projects: [{
      projectId: "maps-agency",
      name: "Maps Agency",
      localPath: "/Users/liam/maps-agency",
      branch: "main",
      remoteUrl: "gitlawb://repo/maps-agency",
      gitlawbRepoId: "gl-maps-agency",
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      latestCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      dirty: false,
    }],
  },
});
const dirtyMapsAgencyMachine = machine("maps-dirty", "Maps Dirty", [{
  ...baseAgent,
  id: "maps-dirty-code-worker",
  name: "Maps Dirty Code Bee",
  runtime: "codex",
  workerClass: "code",
}], {
  version: {
    projects: [{
      projectId: "maps-agency",
      name: "Maps Agency",
      localPath: "/root/documents/maps-agency",
      branch: "main",
      remoteUrl: "gitlawb://repo/maps-agency",
      gitlawbRepoId: "gl-maps-agency",
      commit: "cccccccccccccccccccccccccccccccccccccccc",
      latestCommit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      dirty: true,
    }],
  },
});
const unrelatedProjectMachine = machine("crm-latest", "CRM Latest", [{
  ...baseAgent,
  id: "crm-code-worker",
  name: "CRM Code Bee",
  runtime: "codex",
  workerClass: "code",
}], {
  version: {
    projects: [{
      projectId: "crm",
      name: "CRM",
      localPath: "/root/crm",
      branch: "main",
      remoteUrl: "gitlawb://repo/crm",
      gitlawbRepoId: "gl-crm",
      commit: "dddddddddddddddddddddddddddddddddddddddd",
      latestCommit: "dddddddddddddddddddddddddddddddddddddddd",
      dirty: false,
    }],
  },
});
const gitLawbProjectRoute = chooseQueenBeeDelegate({
  title: "Add preview booking to Maps Agency",
  body: "Use the GitLawb project registry and continue on the machine with local unpushed work if it has that repo.",
  projectRegistry: {
    projects: [{
      id: "maps-agency",
      name: "Maps Agency",
      localPath: "/root/documents/maps-agency",
      preferredMachineKey: "maps-dirty",
      gitlawbRepo: {
        repoId: "gl-maps-agency",
        repoName: "maps-agency",
        remoteUrl: "gitlawb://repo/maps-agency",
        branch: "main",
        linkedAt: Date.now(),
      },
      allowedAgentIds: ["maps-dirty-code-worker", "maps-stale-code-worker"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }],
    updatedAt: Date.now(),
  },
}, [unrelatedProjectMachine, staleMapsAgencyMachine, dirtyMapsAgencyMachine]);
assert.equal(gitLawbProjectRoute.status, "delegated");
assert.equal(gitLawbProjectRoute.agent?.id, "maps-dirty-code-worker");
assert.equal(gitLawbProjectRoute.machine?.key, "maps-dirty");
assert.match(gitLawbProjectRoute.reason, /GitLawb project registry/i);
assert.match(gitLawbProjectRoute.reason, /local changes/i);

const pendingRoute = chooseQueenBeeDelegate({ title: "do work", body: "" }, [machine("offline", "Offline", [], { device: { online: false } })]);
assert.equal(pendingRoute.status, "pending");
assert.equal(pendingRoute.agent, undefined);
assert.match(pendingRoute.reason, /No chat-capable/i);

console.log("Queen Bee routing tests passed.");
