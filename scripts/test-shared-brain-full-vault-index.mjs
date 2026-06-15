import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = process.cwd();
const tmp = await mkdtemp(join(tmpdir(), "hivemindos-full-vault-index-"));
const vault = join(tmp, "vault");

async function write(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, "utf8");
}

await write(join(vault, "Projects", "Recall Speed.md"), `---
title: "Recall Speed Plan"
tags: ["retrieval", "speed"]
---

# Recall Speed Plan

The shared brain should use a lightweight BM25 lexical index for full-vault search. This keeps markdown recall fast without embeddings.
`);

await write(join(vault, "Ideas", "Cooking Notes.md"), `# Cooking Notes

Unrelated sourdough timing and kitchen notes.
`);

const result = spawnSync("node", [
  "scripts/hive-brain",
  "answer",
  "collection:projects BM25 lexical index without embeddings",
  "--no-api",
  "--vault",
  vault,
  "--scope",
  "full-vault",
  "--limit",
  "3",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 20_000,
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /Recall Speed Plan/);
assert.match(result.stdout, /Projects\/Recall Speed\.md/);
assert.doesNotMatch(result.stdout, /Cooking Notes/);

const indexPath = join(vault, "Operations", "Brain Services", "Full Vault Search Index.jsonl");
assert.equal(existsSync(indexPath), true, "full-vault index should be generated");
const index = await readFile(indexPath, "utf8");
assert.match(index, /hivemindos\.full-vault-search\.v1/);
assert.match(index, /"collection":"projects"/);

await appendFile(indexPath, `${JSON.stringify({
  schema: "hivemindos.full-vault-search.v1",
  path: "Skills/missing-stale-skill/SKILL.md",
  collection: "skills",
  title: "Missing stale skill",
  headings: ["Missing stale skill"],
  tags: [],
  mtimeMs: Date.now(),
  size: 100,
  documentLength: 6,
  terms: { missing: 2, stale: 2, skill: 2 },
  excerpt: "This generated row points at a missing file.",
})}\n`, "utf8");

const staleResult = spawnSync("node", [
  "scripts/hive-brain",
  "answer",
  "missing stale skill",
  "--no-api",
  "--vault",
  vault,
  "--scope",
  "full-vault",
  "--limit",
  "3",
], {
  cwd: root,
  encoding: "utf8",
  timeout: 20_000,
});
assert.equal(staleResult.status, 0, staleResult.stderr || staleResult.stdout);
assert.doesNotMatch(staleResult.stdout, /ENOENT/);
assert.match(staleResult.stdout, /No matching shared-brain memories or vault notes were found|Recall scope:/);

for (const [path, tokens] of [
  ["src/lib/services/obsidian/full-vault-search-index.ts", [
    "FULL_VAULT_SEARCH_INDEX_PATH",
    "bm25Score",
    "collectionForPath",
    "parseSearchQuery",
    "rebuildFullVaultSearchIndex",
    "searchFullVaultSearchIndex",
  ]],
  ["src/lib/services/obsidian/agent-memory.ts", [
    "searchFullVaultSearchIndex",
    "record.searchScore = hit.score",
    "record.searchCollection = hit.collection",
    "fullVaultIndex",
  ]],
  ["scripts/hive-brain", [
    "FULL_VAULT_INDEX_PATH",
    "searchFullVaultIndex",
    "collections.push",
    "fs.existsSync(file)",
  ]],
]) {
  const content = await readFile(join(root, path), "utf8");
  for (const token of tokens) assert.ok(content.includes(token), `${path} should contain ${token}`);
}

console.log("Shared brain full-vault search index checks passed.");
