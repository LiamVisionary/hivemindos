#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-visual-artifacts-"));
const vaultPath = join(tempHome, "vault");
const authSecret = "y".repeat(40);
const deviceToken = "visual-artifacts-device-token";
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = authSecret;
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = deviceToken;

await mkdir(vaultPath, { recursive: true });

try {
  const service = await import("../src/lib/services/visual-artifacts.ts");
  const route = await import("../src/app/api/visual-artifacts/route.ts");
  const { NextRequest } = await import("next/server");

  await assert.rejects(
    () => service.createVisualArtifact({
      title: "Invalid block",
      blocks: [{ type: "unknown", markdown: "Nope" }],
      vaultPath,
    }),
    /Unsupported visual artifact block type/,
  );

  const plan = await service.createVisualArtifact({
    kind: "plan",
    title: "Agent-native adoption plan",
    workBoardTaskId: "task-123",
    queenBeeRunId: "queen-run-1",
    projectPath: join(tempHome, "workspace", "hivemind-os"),
    vaultPath,
    blocks: [
      {
        type: "summary",
        markdown: "Plan for Agent-Native-inspired features. api_key=supersecret123 should not persist.",
      },
      {
        type: "file-tree",
        items: [
          {
            path: join(tempHome, "workspace", "hivemind-os", "src/app/api/example/route.ts"),
            note: "Route touched by the plan.",
          },
        ],
      },
      {
        type: "diagram",
        mermaid: "graph TD\n  A[Agent] --> B[Hive Action Registry]",
      },
    ],
  });

  assert.equal(plan.storage.kind, "vault");
  assert.ok(plan.storage.path.startsWith(vaultPath));
  assert.equal(plan.artifact.kind, "plan");
  assert.equal(plan.artifact.blocks.length, 3);

  const rawVaultArtifact = await readFile(plan.storage.path, "utf8");
  assert.equal(rawVaultArtifact.includes("supersecret123"), false);

  const fetched = await service.getVisualArtifact(plan.artifact.id, { vaultPath });
  assert.equal(fetched.artifact.title, "Agent-native adoption plan");
  assert.equal(fetched.storage.kind, "vault");

  const publicPlan = service.visualArtifactPublicView(plan.artifact);
  assert.equal(publicPlan.projectPath?.startsWith(tempHome), false);
  assert.match(publicPlan.projectPath ?? "", /\[local-path\]/);
  const fileTree = publicPlan.blocks.find((block) => block.type === "file-tree");
  assert.equal(fileTree.items[0].path.startsWith(tempHome), false);
  assert.match(fileTree.items[0].path, /\[local-path\]/);

  const listedByTask = await service.listVisualArtifacts({ workBoardTaskId: "task-123", vaultPath });
  assert.equal(listedByTask.artifacts.length, 1);
  assert.equal(listedByTask.artifacts[0].id, plan.artifact.id);

  const fallback = await service.createVisualArtifact({
    kind: "recap",
    title: "Fallback recap",
    queenBeeRunId: "queen-run-fallback",
    vaultPath: join(tempHome, "missing-vault"),
    blocks: [
      {
        type: "diff-summary",
        markdown: "Fallback recap writes when the shared vault is unavailable.",
      },
      {
        type: "risk",
        markdown: "No risks beyond fallback storage.",
      },
    ],
  });
  assert.equal(fallback.storage.kind, "fallback");
  assert.ok(fallback.storage.path.startsWith(join(tempHome, ".hivemindos", "visual-artifacts")));

  const listedByRun = await service.listVisualArtifacts({
    queenBeeRunId: "queen-run-fallback",
    vaultPath: join(tempHome, "missing-vault"),
  });
  assert.equal(listedByRun.artifacts.length, 1);
  assert.equal(listedByRun.artifacts[0].id, fallback.artifact.id);

  const unauthorized = await route.GET(new NextRequest("http://127.0.0.1/api/visual-artifacts"));
  assert.equal(unauthorized.status, 401);

  const apiCreate = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/visual-artifacts", {
    action: "create",
    kind: "recap",
    title: "API recap",
    vaultPath,
    projectPath: join(tempHome, "workspace", "hivemind-os"),
    blocks: [
      {
        type: "summary",
        markdown: "API-created recap.",
      },
    ],
  }));
  assert.equal(apiCreate.status, 200);
  const apiCreateBody = await apiCreate.json();
  assert.equal(apiCreateBody.ok, true);
  assert.equal(apiCreateBody.storage.kind, "vault");

  const apiGetPublic = await route.GET(authedRequest(
    NextRequest,
    `http://127.0.0.1/api/visual-artifacts?id=${apiCreateBody.artifact.id}&vaultPath=${encodeURIComponent(vaultPath)}&public=1`,
  ));
  assert.equal(apiGetPublic.status, 200);
  const apiGetPublicBody = await apiGetPublic.json();
  assert.equal(apiGetPublicBody.artifact.projectPath.startsWith(tempHome), false);
  assert.match(apiGetPublicBody.artifact.projectPath, /\[local-path\]/);

  const apiList = await route.GET(authedRequest(
    NextRequest,
    `http://127.0.0.1/api/visual-artifacts?vaultPath=${encodeURIComponent(vaultPath)}&limit=10`,
  ));
  assert.equal(apiList.status, 200);
  const apiListBody = await apiList.json();
  assert.equal(apiListBody.artifacts.length >= 2, true);

  console.log("Visual artifact store and API tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function authedRequest(NextRequest, url, init = {}) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-hivemindos-device-token": deviceToken,
    },
  });
}

function jsonRequest(NextRequest, url, body) {
  return authedRequest(NextRequest, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
