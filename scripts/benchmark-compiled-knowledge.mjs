#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile, readFile, stat as fsStat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, "").split("=");
  return [key, value ?? "true"];
}));
const pageCount = Number(args.get("pages") || 720);
const runs = Number(args.get("runs") || 15);
const tmp = await mkdtemp(join(tmpdir(), "hivemindos-compiled-bench-"));
const vault = join(tmp, "vault");
const domain = "bench";
const compiledRoot = join(vault, "Synthesis", "Compiled Knowledge", domain, "wiki");

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

async function loadTs(sourcePath, replacements = []) {
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

function stat(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
  return {
    runs: values.length,
    minMs: Number(sorted[0].toFixed(2)),
    medianMs: Number(percentile(0.5).toFixed(2)),
    p95Ms: Number(percentile(0.95).toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

function searchTerms(query) {
  return [...new Set(String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))].slice(0, 16);
}

function escapeRegex(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walkMarkdown(root, dir = root, output = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") await walkMarkdown(root, fullPath, output);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      output.push(fullPath);
    }
  }
  return output;
}

async function listVaultMatches(root, query) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const pattern = terms.map(escapeRegex).join("|");
  const result = spawnSync("rg", ["-li", "--no-messages", "--no-ignore-vcs", "-g", "*.md", "-e", pattern, "."], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10000,
  });
  if (!result.error && (result.status === 0 || result.status === 1)) {
    return String(result.stdout || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => join(root, file));
  }
  return walkMarkdown(root);
}

function markdownTitle(path, content) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.split("/").pop()?.replace(/\.md$/, "") || path;
}

async function oldBroadVaultSearch(root, query, limit = 12) {
  const terms = searchTerms(query);
  const queryLower = query.toLowerCase();
  const files = await listVaultMatches(root, query);
  const hits = [];
  for (const file of files) {
    const fileStat = await fsStat(file).catch(() => null);
    if (!fileStat?.isFile() || fileStat.size > 512 * 1024) continue;
    const content = await readFile(file, "utf8");
    const title = markdownTitle(file, content);
    const notePath = file.slice(root.length + 1).split("/").join("/");
    const haystack = `${title}\n${notePath}\n${content}`.toLowerCase();
    let score = haystack.includes(queryLower) ? 30 : 0;
    const matched = [];
    for (const term of terms) {
      if (title.toLowerCase().includes(term)) {
        score += 8;
        matched.push("title");
      }
      if (notePath.toLowerCase().includes(term)) {
        score += 2;
        matched.push("path");
      }
      if (content.toLowerCase().includes(term)) {
        score += 4;
        matched.push("body");
      }
    }
    if (score > 0) {
      hits.push({
        title,
        notePath,
        score,
        matched: [...new Set(matched)],
        excerpt: content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/\s+/g, " ").trim().slice(0, 260),
      });
    }
  }
  return { query, results: hits.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title)).slice(0, limit) };
}

async function bench(label, fn) {
  await fn();
  await fn();
  const times = [];
  let last;
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    last = await fn();
    times.push(performance.now() - start);
  }
  return { label, timing: stat(times), last };
}

function yaml(type, title) {
  return `---\ntype: "compiled-${type}"\ntitle: "${title}"\ntags: [compiled-knowledge, benchmark]\ncreatedAt: "2026-06-13T00:00:00.000Z"\nupdatedAt: "2026-06-13T00:00:00.000Z"\n---\n`;
}

async function seedVault() {
  await mkdir(join(vault, "Operations", "Brain Services"), { recursive: true });
  const entityCount = Math.floor(pageCount / 3);
  const conceptCount = Math.floor(pageCount / 3);
  const summaryCount = pageCount - entityCount - conceptCount;

  for (let index = 0; index < entityCount; index += 1) {
    const nextConcept = `concept-${index % conceptCount}`;
    const nextSummary = `summary-${index % summaryCount}`;
    await write(join(compiledRoot, "entities", `entity-${index}.md`), `${yaml("entity", `Entity ${index}`)}
# Entity ${index}

## Overview
Entity ${index} participates in the benchmark graph.

## Related
- [[${nextConcept}]]
- [[summaries/${nextSummary}]]
`);
  }

  for (let index = 0; index < conceptCount; index += 1) {
    const nextEntity = `entity-${index % entityCount}`;
    const nextSummary = `summary-${index % summaryCount}`;
    await write(join(compiledRoot, "concepts", `concept-${index}.md`), `${yaml("concept", `Concept ${index}`)}
# Concept ${index}

## Overview
Concept ${index} connects entities and summaries.

## Related
- [[${nextEntity}]]
- [[summaries/${nextSummary}]]
`);
  }

  for (let index = 0; index < summaryCount; index += 1) {
    const entity = `entity-${index % entityCount}`;
    const concept = `concept-${index % conceptCount}`;
    await write(join(compiledRoot, "summaries", `summary-${index}.md`), `${yaml("summary", `Summary ${index}`)}
# Summary ${index}

## Summary
Summary ${index} is synthetic benchmark material.

## Entities Mentioned
- [[${entity}]]

## Concepts Mentioned
- [[${concept}]]
`);
  }

  await write(join(compiledRoot, "index.md"), "# Index\n");
  await write(join(compiledRoot, "log.md"), "# Log\n");
}

try {
  await seedVault();

  const contractSource = await readFile(new URL("../src/lib/services/brain/shared-contribution-contract.ts", import.meta.url), "utf8");
  const contractPath = join(tmp, "shared-contribution-contract.mjs");
  await writeFile(contractPath, ts.transpileModule(contractSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.NodeNext },
  }).outputText, "utf8");

  const compiled = await loadTs("../src/lib/services/obsidian/compiled-knowledge.ts", [
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
async function listFilesMatchingTerms({ root, terms, glob = "*.md", maxResults = 5000 }) {
  const { spawnSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const pattern = terms.join("|");
  const result = spawnSync("rg", ["-li", "--no-messages", "--no-ignore-vcs", "-g", glob, "-e", pattern, "."], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
  if (result.error || (result.status !== 0 && result.status !== 1)) return null;
  return String(result.stdout || "").split("\\n").map((line) => line.trim()).filter(Boolean).slice(0, maxResults).map((file) => join(root, file));
}`,
    ],
  ]);

  const brainGraph = await loadTs("../src/lib/services/obsidian/brain-graph.ts", [
    [
      'import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";',
      "function resolveObsidianVaultPath(vaultPath) { return vaultPath; }",
    ],
    [
      'import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";',
      'const DEFAULT_SHARED_VAULT = { brainServicesFolder: "Operations/Brain Services" };',
    ],
  ]);

  const oldGenericGraph = await bench("old: buildBrainGraph(vault)", () => brainGraph.buildBrainGraph(vault, { force: true }));
  const newOverview = await bench("new: getCompiledKnowledgeGraphOverview(domain)", () => compiled.getCompiledKnowledgeGraphOverview({ vaultPath: vault, domain }));
  const newFullGraph = await bench("new: buildCompiledKnowledgeGraph(domain)", () => compiled.buildCompiledKnowledgeGraph({ vaultPath: vault, domain }));
  const lookupSlug = `concept-${Math.min(120, Math.max(0, Math.floor(pageCount / 6)))}`;
  const lookupPath = `Synthesis/Compiled Knowledge/${domain}/wiki/concepts/${lookupSlug}.md`;
  const oldFindNodeBySlug = async () => {
    const graph = await brainGraph.buildBrainGraph(vault, { force: true });
    const node = graph.nodes.find((item) => item.id === lookupPath || item.id.endsWith(`/concepts/${lookupSlug}.md`) || item.label === lookupSlug);
    return { node, graph };
  };
  const oldFindBacklinks = async () => {
    const graph = await brainGraph.buildBrainGraph(vault, { force: true });
    const backlinks = graph.links.filter((link) => link.target === lookupPath).map((link) => link.source).sort();
    return { slug: lookupSlug, backlinks, graph };
  };
  const oldNodeLookup = await bench("old: buildBrainGraph + find node slug", oldFindNodeBySlug);
  const newNodeLookup = await bench("new: getCompiledKnowledgeNode(slug)", () => compiled.getCompiledKnowledgeNode({ vaultPath: vault, domain, slug: lookupSlug }));
  const oldBacklinkLookup = await bench("old: buildBrainGraph + filter backlinks", oldFindBacklinks);
  const newBacklinkLookup = await bench("new: getCompiledKnowledgeBacklinks(slug)", () => compiled.getCompiledKnowledgeBacklinks({ vaultPath: vault, domain, slug: lookupSlug }));
  const newHealthScan = await bench("new: scanCompiledKnowledgeHealth(domain)", () => compiled.scanCompiledKnowledgeHealth({ vaultPath: vault, domain }));
  const searchQuery = "Concept 120 benchmark graph";
  const oldSearch = await bench("old: broad vault rg markdown search", () => oldBroadVaultSearch(vault, searchQuery, 12));
  const newCompiledSearch = await bench("new: searchCompiledKnowledge(query)", () => compiled.searchCompiledKnowledge({ vaultPath: vault, domain, query: searchQuery, limit: 12 }));

  const oldPayloadBytes = Buffer.byteLength(JSON.stringify(oldGenericGraph.last), "utf8");
  const overviewPayloadBytes = Buffer.byteLength(JSON.stringify(newOverview.last), "utf8");
  const newGraphPayloadBytes = Buffer.byteLength(JSON.stringify(newFullGraph.last), "utf8");
  const oldNodeLookupPayloadBytes = Buffer.byteLength(JSON.stringify(oldNodeLookup.last.graph), "utf8");
  const newNodeLookupPayloadBytes = Buffer.byteLength(JSON.stringify(newNodeLookup.last), "utf8");
  const oldBacklinkLookupPayloadBytes = Buffer.byteLength(JSON.stringify(oldBacklinkLookup.last.graph), "utf8");
  const newBacklinkLookupPayloadBytes = Buffer.byteLength(JSON.stringify(newBacklinkLookup.last), "utf8");
  const oldSearchPayloadBytes = Buffer.byteLength(JSON.stringify(oldSearch.last), "utf8");
  const newSearchPayloadBytes = Buffer.byteLength(JSON.stringify(newCompiledSearch.last), "utf8");
  const oldRealNodes = oldGenericGraph.last.nodes.filter((node) => !String(node.id).startsWith("unresolved:")).length;
  const oldUnresolvedNodes = oldGenericGraph.last.nodes.length - oldRealNodes;

  assert.equal(newOverview.last.counts.nodes, pageCount);
  assert.equal(newFullGraph.last.nodes.length, pageCount);
  assert.equal(Boolean(oldNodeLookup.last.node), true);
  assert.equal(newNodeLookup.last.node.slug, lookupSlug);
  assert.equal(newBacklinkLookup.last.backlinks.length, 2);
  assert.equal(newCompiledSearch.last.results[0]?.slug, lookupSlug);

  const result = {
    dataset: {
      pages: pageCount,
      runs,
      vault,
      note: "Synthetic compiled-knowledge domain with entities, concepts, summaries, and wikilinks.",
    },
    oldGenericGraph: {
      timing: oldGenericGraph.timing,
      nodesReturned: oldGenericGraph.last.nodes.length,
      realNoteNodesReturned: oldRealNodes,
      unresolvedPseudoNodesReturned: oldUnresolvedNodes,
      linksReturned: oldGenericGraph.last.links.length,
      truncated: oldGenericGraph.last.truncated,
      payloadBytes: oldPayloadBytes,
    },
    newCompiledOverview: {
      timing: newOverview.timing,
      nodesCovered: newOverview.last.counts.nodes,
      edgesCovered: newOverview.last.counts.edges,
      payloadBytes: overviewPayloadBytes,
    },
    newCompiledFullGraph: {
      timing: newFullGraph.timing,
      nodesReturned: newFullGraph.last.nodes.length,
      edgesReturned: newFullGraph.last.edges.length,
      payloadBytes: newGraphPayloadBytes,
    },
    nodeLookup: {
      slug: lookupSlug,
      oldBroadGraphFind: {
        timing: oldNodeLookup.timing,
        found: Boolean(oldNodeLookup.last.node),
        payloadBytes: oldNodeLookupPayloadBytes,
      },
      newCompiledNode: {
        timing: newNodeLookup.timing,
        outgoingReturned: newNodeLookup.last.node.outgoing.length,
        backlinksReturned: newNodeLookup.last.node.backlinks.length,
        payloadBytes: newNodeLookupPayloadBytes,
      },
    },
    backlinkLookup: {
      slug: lookupSlug,
      oldBroadGraphFilter: {
        timing: oldBacklinkLookup.timing,
        backlinksReturned: oldBacklinkLookup.last.backlinks.length,
        payloadBytes: oldBacklinkLookupPayloadBytes,
      },
      newCompiledBacklinks: {
        timing: newBacklinkLookup.timing,
        backlinksReturned: newBacklinkLookup.last.backlinks.length,
        payloadBytes: newBacklinkLookupPayloadBytes,
      },
    },
    healthScan: {
      timing: newHealthScan.timing,
      issuesFound: newHealthScan.last.issues.length,
      payloadBytes: Buffer.byteLength(JSON.stringify(newHealthScan.last), "utf8"),
      note: "No old generic equivalent; this measures the new corpus-health maintenance path only.",
    },
    compiledSearch: {
      query: searchQuery,
      oldBroadVaultSearch: {
        timing: oldSearch.timing,
        topPath: oldSearch.last.results[0]?.notePath,
        resultsReturned: oldSearch.last.results.length,
        payloadBytes: oldSearchPayloadBytes,
      },
      newCompiledSearch: {
        timing: newCompiledSearch.timing,
        topSlug: newCompiledSearch.last.results[0]?.slug,
        topMatchedFields: newCompiledSearch.last.results[0]?.matchedFields ?? [],
        resultsReturned: newCompiledSearch.last.results.length,
        payloadBytes: newSearchPayloadBytes,
      },
    },
    improvements: {
      overviewMedianSpeedupVsOld: Number((oldGenericGraph.timing.medianMs / newOverview.timing.medianMs).toFixed(2)),
      overviewPayloadReductionVsOld: Number((oldPayloadBytes / overviewPayloadBytes).toFixed(2)),
      realNoteCoverageVsOld: Number((newOverview.last.counts.nodes / oldRealNodes).toFixed(2)),
      edgeCoverageVsOld: Number((newOverview.last.counts.edges / oldGenericGraph.last.links.length).toFixed(2)),
      fullGraphRealNoteCoverageVsOld: Number((newFullGraph.last.nodes.length / oldRealNodes).toFixed(2)),
      nodeLookupMedianSpeedupVsOld: Number((oldNodeLookup.timing.medianMs / newNodeLookup.timing.medianMs).toFixed(2)),
      nodeLookupPayloadReductionVsOld: Number((oldNodeLookupPayloadBytes / newNodeLookupPayloadBytes).toFixed(2)),
      backlinkLookupMedianSpeedupVsOld: Number((oldBacklinkLookup.timing.medianMs / newBacklinkLookup.timing.medianMs).toFixed(2)),
      backlinkLookupPayloadReductionVsOld: Number((oldBacklinkLookupPayloadBytes / newBacklinkLookupPayloadBytes).toFixed(2)),
      backlinkCoverageVsOld: oldBacklinkLookup.last.backlinks.length > 0
        ? Number((newBacklinkLookup.last.backlinks.length / oldBacklinkLookup.last.backlinks.length).toFixed(2))
        : "old-returned-zero",
      compiledSearchMedianSpeedupVsOld: Number((oldSearch.timing.medianMs / newCompiledSearch.timing.medianMs).toFixed(2)),
      compiledSearchPayloadReductionVsOld: Number((oldSearchPayloadBytes / newSearchPayloadBytes).toFixed(2)),
    },
  };

  console.log(JSON.stringify(result, null, 2));
} finally {
  await rm(tmp, { recursive: true, force: true });
}
