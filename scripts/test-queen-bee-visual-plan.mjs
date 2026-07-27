#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-queen-visual-plan-"));
const vaultPath = join(tempHome, "vault");
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;

await mkdir(vaultPath, { recursive: true });

try {
  const route = await import("../src/app/api/queen-bee/route.ts");
  const visualArtifacts = await import("../src/lib/services/visual-artifacts.ts");
  const { NextRequest } = await import("next/server");

  const fleetSnapshot = [
    {
      key: "mac",
      collector: "ready",
      device: {
        self: true,
        name: "This Mac",
        os: "darwin",
        online: true,
        collectorUrl: "http://127.0.0.1:8787",
      },
      capabilities: { chat: true, runtimes: ["codex"] },
      agents: [
        {
          id: "codex-code",
          name: "Codex Code",
          runtime: "codex",
          gatewayUrl: "",
          beeRole: "worker",
          workerClass: "code",
          runtimeCapabilities: { chat: true },
          collectorCapabilities: { chat: true },
        },
      ],
    },
  ];

  const submitResponse = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/queen-bee", {
    message: "Implement the dashboard pin overlay and verify it with focused tests.",
    taskTitle: "Implement dashboard pin overlay",
    source: "unit-test",
    mode: "act",
    vaultPath,
    fleetSnapshot,
  }));
  assert.equal(submitResponse.status, 200);
  const submitBody = await submitResponse.json();
  assert.equal(submitBody.ok, true);
  assert.ok(submitBody.task?.id);
  assert.ok(submitBody.visualPlan?.id);
  assert.equal(submitBody.visualPlan.workBoardTaskId, submitBody.task.id);
  assert.equal(submitBody.visualPlan.storage, "vault");

  const submitArtifacts = await visualArtifacts.listVisualArtifacts({
    vaultPath,
    workBoardTaskId: submitBody.task.id,
  });
  assert.equal(submitArtifacts.artifacts.length, 1);
  assert.equal(submitArtifacts.artifacts[0].queenBeeRunId, submitBody.fingerprint);
  assert.ok(submitArtifacts.artifacts[0].blocks.some((block) => block.type === "diagram"));
  assert.ok(submitArtifacts.artifacts[0].blocks.some((block) => block.type === "risk"));

  const prdResponse = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/queen-bee", {
    action: "decompose-prd",
    title: "Agent-native adoption",
    prd: [
      "# Agent-native adoption",
      "## Requirements",
      "- Add review queue visibility.",
      "- Add Context X-Ray receipts.",
      "## Acceptance Criteria",
      "- Focused tests pass.",
    ].join("\n"),
    source: "unit-test-prd",
    maxTasks: 2,
    vaultPath,
    fleetSnapshot,
  }));
  assert.equal(prdResponse.status, 200);
  const prdBody = await prdResponse.json();
  assert.equal(prdBody.ok, true);
  assert.ok(prdBody.epic?.id);
  assert.equal(prdBody.tasks.length, 2);
  assert.ok(prdBody.visualPlan?.id);
  assert.equal(prdBody.visualPlan.workBoardTaskId, prdBody.epic.id);

  const prdArtifacts = await visualArtifacts.listVisualArtifacts({
    vaultPath,
    workBoardTaskId: prdBody.epic.id,
  });
  assert.equal(prdArtifacts.artifacts.length, 1);
  assert.ok(prdArtifacts.artifacts[0].blocks.some((block) => block.type === "file-tree"));
  assert.ok(prdArtifacts.artifacts[0].blocks.some((block) => block.type === "diff-summary"));

  console.log("Queen Bee visual plan tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function jsonRequest(NextRequest, url, body) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
