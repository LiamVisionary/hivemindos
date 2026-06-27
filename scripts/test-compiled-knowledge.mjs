#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const tmp = await mkdtemp(join(tmpdir(), "hivemindos-compiled-knowledge-"));
const vault = join(tmp, "vault");

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

async function loadModule(sourcePath, replacements = []) {
  let source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
    },
  }).outputText;
  const modulePath = join(tmp, `${sourcePath.split("/").pop().replace(/\.ts$/, "")}-${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(modulePath, transpiled, "utf8");
  return import(pathToFileURL(modulePath).href);
}

function mcpRequest(child, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for MCP response to ${message.method}`)), 5000);
    const onData = (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id !== message.id) continue;
        clearTimeout(timeout);
        child.stdout.off("data", onData);
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolve(parsed.result);
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

try {
  const contractSource = await readFile(new URL("../src/lib/services/brain/shared-contribution-contract.ts", import.meta.url), "utf8");
  const contractTranspiled = ts.transpileModule(contractSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.NodeNext },
  }).outputText;
  const contractPath = join(tmp, "shared-contribution-contract.mjs");
  await writeFile(contractPath, contractTranspiled, "utf8");
  const contract = await import(pathToFileURL(contractPath).href);
  const service = await loadModule("../src/lib/services/obsidian/compiled-knowledge.ts", [
    [
      'import { resolveSharedContributionPolicy } from "@/lib/services/brain/shared-contribution-contract";',
      `const { resolveSharedContributionPolicy } = await import(${JSON.stringify(pathToFileURL(contractPath).href)});`,
    ],
    [
      'import { resolveSharedContributionPolicy, type BrainActorKind, type BrainCollaborationMode } from "@/lib/services/brain/shared-contribution-contract";',
      `const { resolveSharedContributionPolicy } = await import(${JSON.stringify(pathToFileURL(contractPath).href)});`,
    ],
    [
      'import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";',
      "function resolveObsidianVaultPath(vaultPath) { return vaultPath; }",
    ],
    [
      'import { listFilesMatchingTerms, searchTermsFromQuery } from "@/lib/services/search/ripgrep-search";',
      `function searchTermsFromQuery(query) { return [...new Set(String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))].slice(0, 16); }
async function listFilesMatchingTerms() { return null; }`,
    ],
  ]);

  const humanMirror = contract.resolveSharedContributionPolicy({
    domain: "shared-cohort",
    actorKind: "human",
    collaborationMode: "human-collective",
  });
  assert.equal(humanMirror.canWrite, false);
  assert.match(humanMirror.guidance, /opted-in personal domain/);

  const agentMirror = contract.resolveSharedContributionPolicy({
    domain: "shared-cohort",
    actorKind: "agent",
    collaborationMode: "agent-to-agent",
  });
  assert.equal(agentMirror.canWrite, true);

  const result = await service.compileKnowledgeToWiki({
    vaultPath: vault,
    domain: "research",
    title: "Agent Memory Architecture",
    content: "HivemindOS compiles durable research into graph-shaped markdown. Compiled knowledge helps agents trace backlinks.",
    summary: "Compiled knowledge turns source material into durable entity, concept, and summary pages.",
    tags: ["brain", "test"],
    entities: [{ name: "HivemindOS", facts: ["Local-first agent operating system."] }],
    concepts: [{ name: "Compiled Knowledge", facts: ["Builds graph-shaped markdown once instead of re-deriving every answer."] }],
    createdAt: "2026-06-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.domain, "research");
  assert.equal(result.pagesWritten.length >= 3, true);
  assert.equal(result.pagesWritten.some((writeResult) => writeResult.path === "entities/hivemindos.md"), true);
  assert.equal(result.pagesWritten.some((writeResult) => writeResult.path === "concepts/compiled-knowledge.md"), true);

  const root = join(vault, "Synthesis", "Compiled Knowledge", "research", "wiki");
  const summary = await readFile(join(root, result.summaryPath), "utf8");
  assert.match(summary, /type: "compiled-summary"/);
  assert.match(summary, /\[\[hivemindos]]/);
  assert.match(summary, /\[\[compiled-knowledge]]/);

  const overview = await service.getCompiledKnowledgeGraphOverview({ vaultPath: vault, domain: "research" });
  assert.equal(overview.counts.nodes >= 3, true);
  assert.equal(overview.counts.edges >= 2, true);

  const node = await service.getCompiledKnowledgeNode({ vaultPath: vault, domain: "research", slug: "hivemindos" });
  assert.equal(node.node.backlinks.includes(result.summaryPath.replace(/^summaries\/|\.md$/g, "")) || node.node.backlinks.length > 0, true);
  const backlinks = await service.getCompiledKnowledgeBacklinks({ vaultPath: vault, domain: "research", slug: "hivemindos" });
  assert.equal(backlinks.slug, "hivemindos");
  assert.equal(backlinks.backlinks.length > 0, true);

  const search = await service.searchCompiledKnowledge({
    vaultPath: vault,
    domain: "research",
    query: "Compiled Knowledge backlinks",
  });
  assert.equal(search.results.length > 0, true);
  assert.equal(search.results[0].slug, "compiled-knowledge");
  assert.equal(search.results[0].matchedFields.includes("title") || search.results[0].matchedFields.includes("slug"), true);

  await write(join(root, "concepts", "bad-links.md"), `---
type: "compiled-concept"
title: "Bad Links"
tags: [compiled-knowledge, concept]
createdAt: "2026-06-13T00:00:00.000Z"
updatedAt: "2026-06-13T00:00:00.000Z"
---

# Bad Links

## Related
- [[missing target]]
`);

  const health = await service.scanCompiledKnowledgeHealth({ vaultPath: vault, domain: "research" });
  const broken = health.issues.find((issue) => issue.type === "broken-link" && issue.target === "missing-target");
  assert.ok(broken);

  await service.dismissCompiledKnowledgeIssue({ vaultPath: vault, domain: "research", issueId: broken.id, reason: "test dismissal" });
  const healthAfterDismiss = await service.scanCompiledKnowledgeHealth({ vaultPath: vault, domain: "research" });
  assert.equal(healthAfterDismiss.issues.some((issue) => issue.id === broken.id), false);

  const policy = await service.getCompiledKnowledgeStatus({ vaultPath: vault, domain: "research" });
  assert.equal(policy.exists, true);
  assert.equal(policy.entities >= 1, true);

  const mcp = spawn("node", ["scripts/hivemind-mcp"], { cwd: new URL("..", import.meta.url).pathname, stdio: ["pipe", "pipe", "pipe"] });
  try {
    await mcpRequest(mcp, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const tools = await mcpRequest(mcp, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const toolNames = tools.tools.map((tool) => tool.name);
    for (const expected of [
      "compile_brain_knowledge",
      "brain_graph_overview",
      "brain_search_knowledge",
      "brain_get_node",
      "brain_get_backlinks",
      "scan_brain_wiki_health",
      "fix_brain_wiki_issue",
      "shared_brain_contract",
    ]) {
      assert.equal(toolNames.includes(expected), true, `MCP tool missing: ${expected}`);
    }
  } finally {
    mcp.kill();
  }

  const skill = await readFile(new URL("../packaged-skills/auto-install/hive-brain-compiled-wiki/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /compile_brain_knowledge/);
  assert.match(skill, /brain_search_knowledge/);
  assert.match(skill, /human-collective/);
  assert.match(skill, /agent-to-agent/);
  assert.match(skill, /scan_brain_wiki_health/);

  console.log("Compiled knowledge contract passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
