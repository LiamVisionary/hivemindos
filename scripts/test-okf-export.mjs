#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-okf-"));
const vault = join(tmp, "vault");
const memoryDir = join(vault, "Memory", "Distillations", "Agent Memory", "decision");
const conversationDir = join(vault, "Memory", "Conversations", "codex");
const output = join(vault, "Operations", "Brain Services", "OKF Export");

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, { encoding: "utf8", flag: "w" });
}

try {
  await write(join(memoryDir, "okf-decision.md"), `---
type: "agent-memory"
memoryType: "decision"
title: "Use OKF as exchange format"
status: "active"
confidence: 0.9
tags: ["okf", "brain"]
createdAt: "2026-06-13T00:00:00.000Z"
updatedAt: "2026-06-13T00:00:00.000Z"
---
# Use OKF as exchange format

Export HivemindOS shared-brain notes as an OKF bundle without changing the native vault.
`);
  await write(join(conversationDir, "okf-chat.md"), `---
type: conversation
sessionId: test
agentName: Codex
runtime: codex
title: "OKF chat"
startedAt: "2026-06-13T00:00:00.000Z"
tags:
  - conversation
  - okf
---
# [[Codex]] conversation - OKF chat

## Transcript

User asked whether OKF export exists.
`);

  const servicePath = new URL("../src/lib/services/obsidian/okf.ts", import.meta.url);
  const source = await readFile(servicePath, "utf8");
  const testableSource = source.replace(
    'import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";',
    "function resolveObsidianVaultPath(vaultPath) { return vaultPath; }",
  );
  const transpiled = ts.transpileModule(testableSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
    },
  }).outputText;
  const modulePath = join(tmp, "okf-service.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  const { exportOkfBundle, validateOkfBundle } = await import(pathToFileURL(modulePath).href);
  const result = await exportOkfBundle({ vaultPath: vault, outputPath: output, include: "all" });
  const validation = await validateOkfBundle({ bundlePath: result.bundlePath });
  assert.equal(result.concepts, 2);
  assert.equal(validation.ok, true);

  const index = await readFile(join(output, "index.md"), "utf8");
  assert.match(index, /agent_memory_decision/);
  assert.match(index, /conversation/);

  const exportedMemory = await readFile(join(output, "agent-memory", "decision", "use-okf-as-exchange-format.md"), "utf8");
  assert.match(exportedMemory, /^---\ntype: "agent_memory_decision"/);
  assert.match(exportedMemory, /timestamp: "2026-06-13T00:00:00.000Z"/);
  console.log("OKF export contract passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
