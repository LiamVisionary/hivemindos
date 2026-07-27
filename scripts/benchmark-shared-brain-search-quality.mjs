import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const { recallAgentMemory } = await import("../src/lib/services/obsidian/agent-memory/core.ts");

const MEMORY_FOLDER = "Memory/Distillations/Agent Memory";
const FULL_VAULT_INDEX_PATH = "Operations/Brain Services/Full Vault Search Index.jsonl";
const MAX_VAULT_FILES = 50_000;
const MAX_VAULT_BYTES = 1024 * 1024;
const MAX_INDEX_TERMS_PER_NOTE = 900;
const EXCLUDE_PARTS = new Set([".git", ".obsidian", ".trash", ".hivemindos-transfers", "node_modules"]);
const EXCLUDE_PREFIXES = [
  "Operations/Runtime Mirrors/",
  "Operations/Brain Services/Agent Memory Index.jsonl",
  "Operations/Brain Services/Agent Memory Proofs.jsonl",
  FULL_VAULT_INDEX_PATH,
  "Operations/Vault Migrations/",
  "Archive/",
];
const LOW_SIGNAL_WORDS = new Set([
  "about", "after", "again", "agent", "agents", "also", "and", "are", "brain", "but", "can", "codex", "for", "from",
  "has", "have", "hive", "hivemindos", "into", "its", "memory", "note", "notes", "not", "our", "shared", "that",
  "the", "their", "this", "use", "uses", "vault", "was", "were", "what", "when", "where", "with", "you", "your",
]);
const indexCache = new Map();

const LIVE_CASES = [
  {
    label: "project decision",
    query: "collection:projects BYOK Agent Calls HivemindOS Cloud",
    expectedPath: "Projects/Agent Calls - BYOK vs HivemindOS Cloud.md",
  },
  {
    label: "operations policy",
    query: "collection:operations Queen Bee routing policy default routing safety gate cross-machine delegation",
    expectedPath: "Operations/Brain Services/Queen Bee/Routing Policy.md",
  },
  {
    label: "control plane overview",
    query: "collection:operations Queen Bee control plane coordination state identity routing safety dedupe leases",
    expectedPath: "Operations/Brain Services/Queen Bee/README.md",
  },
  {
    label: "coverage beats spam",
    query: "broad noisy search irrelevant recall quality keyword spam",
    expectedPath: "Projects/Search Quality Evaluation.md",
  },
  {
    label: "shared skill",
    query: "path:Skills/ hive-brain compiled wiki backlinks graph overview",
    expectedPath: "Skills/hive-brain-compiled-wiki/SKILL.md",
  },
  {
    label: "brain service note",
    query: "collection:operations Obsidian Native Brain Pack bases canvas",
    expectedPath: "Operations/Brain Services/Obsidian Native Brain Pack.md",
  },
  {
    label: "secure reference",
    query: "collection:operations secure hermes env sync encrypted backup references",
    expectedPath: "Operations/Secure/Secure Hermes Env Sync.md",
  },
  {
    label: "imported source",
    query: "path:Memory/Imported Bankr platform documentation wallet API token trading",
    expectedPath: "Memory/Imported Sources/Bankr Platform Documentation.md",
  },
  {
    label: "crypto intake",
    query: "collection:intake crypto token watchlist ideas",
    expectedPath: "Intake/Crypto token watchlist ideas.md",
  },
];

function parseArgs() {
  const args = { limit: 8, json: false };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--vault") args.vault = argv[++index];
    else if (arg === "--limit") args.limit = Number(argv[++index] || args.limit);
  }
  return args;
}

function rel(root, file) {
  return relative(root, file).split(sep).join("/");
}

function shouldSkip(root, file, isDir) {
  const notePath = rel(root, file);
  const name = basename(file);
  if (EXCLUDE_PARTS.has(name)) return true;
  if (name.startsWith(".")) return true;
  if (isDir && EXCLUDE_PREFIXES.some((prefix) => prefix.endsWith("/") && (notePath === prefix.slice(0, -1) || notePath.startsWith(prefix)))) return true;
  if (!isDir && EXCLUDE_PREFIXES.some((prefix) => notePath === prefix || notePath.startsWith(prefix))) return true;
  return false;
}

async function walk(root, dir = root, output = []) {
  if (output.length >= MAX_VAULT_FILES) return output;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= MAX_VAULT_FILES) break;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkip(root, file, true)) await walk(root, file, output);
    } else if (entry.isFile() && entry.name.endsWith(".md") && !shouldSkip(root, file, false)) {
      output.push(file);
    }
  }
  return output;
}

function words(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((word) => word.length >= 3 && !LOW_SIGNAL_WORDS.has(word));
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  const fields = new Map();
  if (!match) return { fields, body: markdown };
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    const raw = field[2].trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      fields.set(field[1], raw.slice(1, -1).split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
    } else {
      fields.set(field[1], raw.replace(/^["']|["']$/g, ""));
    }
  }
  return { fields, body: markdown.slice(match[0].length) };
}

function compact(value, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function recordFromMarkdown(root, file) {
  const st = statSync(file);
  if (!st.isFile() || st.size > MAX_VAULT_BYTES) return null;
  const markdown = readFileSync(file, "utf8");
  if (!markdown.trim()) return null;
  const { fields, body } = parseFrontmatter(markdown);
  const notePath = rel(root, file);
  const title = String(fields.get("title") || body.match(/^#\s+(.+)$/m)?.[1] || basename(file, ".md")).trim();
  const content = body.replace(/^#\s+.+$/gm, " ").trim();
  if (!content) return null;
  return {
    notePath,
    title,
    content,
    type: fields.get("type") || "context",
    tags: Array.isArray(fields.get("tags")) ? fields.get("tags") : notePath.split("/").slice(0, 3).map((part) => part.toLowerCase()),
    confidence: 0.62,
  };
}

function scoreRecord(record, query, searchScore = 0) {
  const queryText = query.trim().toLowerCase();
  const queryWords = words(query);
  const haystack = [record.title, record.content, record.type, record.tags?.join(" "), record.notePath].filter(Boolean).join(" ").toLowerCase();
  const title = record.title.toLowerCase();
  const content = record.content.toLowerCase();
  const matched = new Set();
  let score = 0;
  if (queryText && haystack.includes(queryText)) {
    score += 30;
    matched.add("exact-query");
  }
  for (const word of queryWords) {
    if (title.includes(word)) { score += 8; matched.add(word); }
    if ((record.tags || []).some((tag) => String(tag).includes(word))) { score += 6; matched.add(word); }
    if (content.includes(word)) { score += 4; matched.add(word); }
    if (record.notePath.toLowerCase().includes(word)) { score += 2; matched.add(word); }
  }
  if (searchScore) score += Math.min(30, Math.max(0, Math.round(searchScore)));
  score += Math.round(record.confidence * 10);
  return { score, matched: [...matched] };
}

function escapeRegex(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchVaultFilesWithRg(root, query) {
  const terms = [...new Set(String(query || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))].slice(0, 16);
  if (!terms.length) return null;
  const pattern = terms.map(escapeRegex).join("|");
  const args = ["-li", "--no-messages", "--no-ignore-vcs", "-g", "*.md", ...[...EXCLUDE_PARTS].flatMap((dir) => ["-g", `!${dir}/**`]), "-e", pattern, "."];
  const result = spawnSync("rg", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 15_000 });
  if (result.error || (result.status !== 0 && result.status !== 1)) return null;
  return String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => join(root, file))
    .filter((file) => !shouldSkip(root, file, false))
    .slice(0, MAX_VAULT_FILES);
}

async function oldSearch(root, query, limit) {
  const files = searchVaultFilesWithRg(root, query) ?? await walk(root);
  const hits = [];
  for (const file of files) {
    if (rel(root, file).startsWith(`${MEMORY_FOLDER}/`)) continue;
    const record = recordFromMarkdown(root, file);
    if (!record) continue;
    const scored = scoreRecord(record, query);
    if (scored.matched.length) hits.push({ ...record, score: scored.score, matched: scored.matched, excerpt: compact(record.content) });
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, limit);
}

function collectionForPath(notePath) {
  const first = notePath.split("/")[0]?.toLowerCase() || "root";
  return ["intake", "memory", "projects", "synthesis", "ideas", "operations", "skills", "templates"].includes(first) ? first : "root";
}

function termCounts(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return Object.fromEntries([...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_INDEX_TERMS_PER_NOTE));
}

async function buildIndex(root) {
  const records = [];
  for (const file of await walk(root)) {
    const st = await stat(file).catch(() => null);
    if (!st?.isFile() || st.size > MAX_VAULT_BYTES) continue;
    const markdown = await readFile(file, "utf8").catch(() => "");
    const { fields, body } = parseFrontmatter(markdown);
    const notePath = rel(root, file);
    const title = String(fields.get("title") || body.match(/^#\s+(.+)$/m)?.[1] || basename(file, ".md")).trim();
    const headings = [...body.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 32);
    const tags = Array.isArray(fields.get("tags")) ? fields.get("tags").map((tag) => String(tag).toLowerCase()) : [];
    const frontmatterType = typeof fields.get("type") === "string" ? fields.get("type") : undefined;
    const tokens = words([title, headings.join(" "), tags.join(" "), frontmatterType, body.replace(/^#\s+.+$/gm, " ")].filter(Boolean).join("\n"));
    if (!tokens.length) continue;
    records.push({
      schema: "hivemindos.full-vault-search.v1",
      path: notePath,
      collection: collectionForPath(notePath),
      title,
      headings,
      tags,
      frontmatterType,
      mtimeMs: st.mtimeMs,
      size: st.size,
      indexedByteLimit: MAX_VAULT_BYTES,
      documentLength: tokens.length,
      terms: termCounts(tokens),
      excerpt: compact(body.replace(/^#\s+.+$/gm, " "), 280),
    });
  }
  const indexFile = join(root, FULL_VAULT_INDEX_PATH);
  await mkdir(dirname(indexFile), { recursive: true });
  await writeFile(indexFile, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  return records;
}

async function readIndex(root) {
  const cached = indexCache.get(root);
  if (cached) return cached;
  const indexFile = join(root, FULL_VAULT_INDEX_PATH);
  if (!existsSync(indexFile)) {
    const built = await buildIndex(root);
    indexCache.set(root, built);
    return built;
  }
  const records = [];
  for (const line of String(await readFile(indexFile, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed.schema === "hivemindos.full-vault-search.v1" &&
        parsed.path &&
        parsed.terms &&
        parsed.indexedByteLimit === MAX_VAULT_BYTES
      ) records.push(parsed);
    } catch {
      // Ignore corrupt generated rows.
    }
  }
  const index = records.length ? records : await buildIndex(root);
  indexCache.set(root, index);
  return index;
}

function parseIndexedQuery(query) {
  const source = String(query || "");
  const phrases = [...source.matchAll(/"([^"]+)"/g)].map((match) => match[1].toLowerCase()).filter(Boolean);
  const terms = [];
  const negativeTerms = [];
  const collections = [];
  const pathPrefixes = [];
  for (const raw of source.replace(/"([^"]+)"/g, " ").split(/\s+/).filter(Boolean)) {
    const value = raw.toLowerCase().replace(/^["']|["']$/g, "");
    const [key, ...rest] = value.split(":");
    const filter = rest.join(":");
    if (rest.length && filter) {
      if (key === "collection" || key === "c") collections.push(filter);
      else if (key === "path") pathPrefixes.push(filter.replace(/^\/+/, ""));
      else terms.push(...words(filter));
    } else if (value.startsWith("-")) {
      negativeTerms.push(...words(value.slice(1)));
    } else {
      terms.push(...words(value));
    }
  }
  return { terms: [...new Set(terms)], negativeTerms: [...new Set(negativeTerms)], phrases, collections, pathPrefixes };
}

async function newSearch(root, query, limit) {
  const parsed = parseIndexedQuery(query);
  const records = (await readIndex(root)).filter((record) => {
    if (parsed.collections.length && !parsed.collections.includes(record.collection)) return false;
    if (parsed.pathPrefixes.length && !parsed.pathPrefixes.some((prefix) => record.path.toLowerCase().startsWith(prefix))) return false;
    if (parsed.negativeTerms.some((term) => record.terms[term])) return false;
    return true;
  });
  const averageLength = records.reduce((sum, record) => sum + record.documentLength, 0) / Math.max(1, records.length);
  const docFreq = new Map(parsed.terms.map((term) => [term, records.reduce((count, record) => count + (record.terms[term] ? 1 : 0), 0)]));
  function coverageScore(matched) {
    if (parsed.terms.length <= 1) return 0;
    const matchedTermCount = parsed.terms.filter((term) => matched.has(term)).length;
    if (!matchedTermCount) return 0;
    const coverage = matchedTermCount / parsed.terms.length;
    let score = coverage * 6;
    if (matchedTermCount === parsed.terms.length) score += 3;
    if (parsed.terms.length >= 4 && coverage < 0.5) score -= (parsed.terms.length - matchedTermCount) * 0.75;
    return score;
  }
  const indexedHits = records.map((record) => {
    const matched = new Set();
    let searchScore = 0;
    const title = record.title.toLowerCase();
    const headings = (record.headings || []).join(" ").toLowerCase();
    const haystack = `${title} ${headings} ${record.path.toLowerCase()} ${record.excerpt.toLowerCase()}`;
    for (const term of parsed.terms) {
      const frequency = record.terms[term] || 0;
      if (!frequency) continue;
      const df = docFreq.get(term) || 1;
      const idf = Math.log(1 + (records.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * (record.documentLength / Math.max(1, averageLength)));
      searchScore += idf * ((frequency * 2.2) / denominator);
      if (title.includes(term)) searchScore += 3;
      if (headings.includes(term)) searchScore += 1.5;
      if (record.path.toLowerCase().includes(term)) searchScore += 1;
      matched.add(term);
    }
    for (const phrase of parsed.phrases) {
      if (haystack.includes(phrase)) {
        searchScore += title.includes(phrase) ? 8 : 4;
        matched.add(`"${phrase}"`);
      }
    }
    searchScore += coverageScore(matched);
    if (parsed.collections.includes(record.collection)) searchScore += 2;
    return { ...record, searchScore: Math.round(searchScore * 100) / 10, matched: [...matched] };
  }).filter((hit) => hit.matched.length)
    .sort((left, right) => right.searchScore - left.searchScore || right.mtimeMs - left.mtimeMs)
    .slice(0, 400);

  const hits = [];
  for (const indexed of indexedHits) {
    const file = join(root, indexed.path);
    const record = recordFromMarkdown(root, file);
    if (!record) continue;
    const scored = scoreRecord(record, query, indexed.searchScore);
    if (scored.matched.length) hits.push({
      ...record,
      collection: indexed.collection,
      score: scored.score,
      matched: scored.matched,
      excerpt: compact(record.content),
    });
  }
  return hits.sort((left, right) => right.score - left.score).slice(0, limit);
}

function expectedRank(hits, expectedPath) {
  const rank = hits.findIndex((hit) => hit.notePath === expectedPath);
  return rank === -1 ? null : rank + 1;
}

function metrics(rows) {
  const count = rows.length || 1;
  const top1 = rows.filter((row) => row.rank === 1).length / count;
  const top3 = rows.filter((row) => row.rank !== null && row.rank <= 3).length / count;
  const mrr = rows.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / count;
  const medianMs = median(rows.map((row) => row.ms));
  return { top1, top3, mrr, medianMs };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.floor(sorted.length / 2)];
}

async function writeFixture(root) {
  async function write(file, body) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), body, "utf8");
  }
  await write("Projects/Agent Calls - BYOK vs HivemindOS Cloud.md", "# Agent Calls - BYOK vs HivemindOS Cloud\n\nBYOK agent calls compare local user provider keys with a HivemindOS Cloud relay for native AI coding app calls.");
  await write("Projects/Search Quality Evaluation.md", "# Search Quality Evaluation\n\nBroad noisy search should prefer documents that cover the full recall intent over irrelevant keyword spam.");
  await write("Operations/Brain Services/Queen Bee/Routing Policy.md", "# Queen Bee Routing Policy\n\nQueen Bee chooses the best available agent and machine from Fleet discovery, Work Board state, and safety policy.");
  await write("Operations/Brain Services/Queen Bee/README.md", "# Queen Bee Control Plane\n\nCoordination state for Queen Bee identity, routing and safety policy, dedupe records, leases, and completion receipts.");
  await write("Skills/hive-brain-compiled-wiki/SKILL.md", "# Hive Brain Compiled Wiki\n\nUse brain_search_knowledge, brain_get_node, brain_get_backlinks, and brain_graph_overview before broad full-vault recall for compiled wiki topics.");
  await write("Operations/Brain Services/Obsidian Native Brain Pack.md", "# Obsidian Native Brain Pack\n\nSeeds obsidian-markdown, obsidian-bases, json-canvas, and Bases/Canvas views for human-readable vault work.");
  await write("Operations/Secure/Secure Hermes Env Sync.md", "# Secure Hermes Env Sync\n\nTracks encrypted backup references for Hermes env sync and credential status names without plaintext secrets.");
  await write("Memory/Imported Sources/Bankr Platform Documentation.md", "# Bankr Platform Documentation\n\nBankr provides wallet APIs, token trading, transfers, portfolio balances, and natural language crypto operations.");
  await write("Memory/Imported Agent Memory/hermes/Platform API Token Spam.md", `# Platform API Token Runtime Notes\n\n${"platform api token runtime configuration guide. ".repeat(1200)}`);
  await write("Intake/Crypto token watchlist ideas.md", "# Crypto token watchlist ideas\n\nToken watchlist candidates, alerts, market narratives, and trading ideas for later review.");
  await write("Ideas/Search Noise Scratchpad.md", `# Broad Search Noise Scratchpad\n\n${"broad noisy search irrelevant keyword spam. ".repeat(900)}`);
  await write("Ideas/General Brainstorm.md", "# General Brainstorm\n\nUnrelated notes about interface polish, meeting cadence, and kitchen inventory.");
}

async function runCase(root, test, limit) {
  const oldStart = performance.now();
  const oldHits = await oldSearch(root, test.query, limit);
  const oldMs = performance.now() - oldStart;
  const newStart = performance.now();
  const newHits = await newSearch(root, test.query, limit);
  const newMs = performance.now() - newStart;
  const runtimeStart = performance.now();
  const runtimeResult = await recallAgentMemory({ vaultPath: root, query: test.query, scope: "full-vault", limit });
  const runtimeMs = performance.now() - runtimeStart;
  return {
    ...test,
    oldMs: Math.round(oldMs * 100) / 100,
    newMs: Math.round(newMs * 100) / 100,
    oldRank: expectedRank(oldHits, test.expectedPath),
    newRank: expectedRank(newHits, test.expectedPath),
    runtimeMs: Math.round(runtimeMs * 100) / 100,
    runtimeRank: expectedRank(runtimeResult.hits, test.expectedPath),
    oldTop: oldHits[0]?.notePath ?? null,
    newTop: newHits[0]?.notePath ?? null,
    runtimeTop: runtimeResult.hits[0]?.notePath ?? null,
  };
}

async function main() {
  const args = parseArgs();
  let root;
  let cases;
  if (args.vault) {
    root = resolve(args.vault);
    cases = LIVE_CASES.filter((test) => existsSync(join(root, test.expectedPath)));
    assert.ok(cases.length >= 4, `Expected at least 4 live benchmark cases in ${root}; found ${cases.length}.`);
  } else {
    root = join(await mkdtemp(join(tmpdir(), "hivemindos-search-quality-")), "vault");
    await writeFixture(root);
    cases = LIVE_CASES;
  }

  const rows = [];
  for (const test of cases) rows.push(await runCase(root, test, args.limit));
  const oldRows = rows.map((row) => ({ rank: row.oldRank, ms: row.oldMs }));
  const newRows = rows.map((row) => ({ rank: row.newRank, ms: row.newMs }));
  const runtimeRows = rows.map((row) => ({ rank: row.runtimeRank, ms: row.runtimeMs }));
  const oldMetrics = metrics(oldRows);
  const newMetrics = metrics(newRows);
  const runtimeMetrics = metrics(runtimeRows);
  const result = {
    vault: root,
    cases: rows.length,
    old: oldMetrics,
    indexed: newMetrics,
    runtime: runtimeMetrics,
    medianSpeedup: Math.round((oldMetrics.medianMs / Math.max(0.01, newMetrics.medianMs)) * 100) / 100,
    rows,
  };

  assert.ok(newMetrics.top1 >= oldMetrics.top1, "indexed search should not reduce Top-1 accuracy");
  assert.ok(newMetrics.top3 >= oldMetrics.top3, "indexed search should not reduce Top-3 accuracy");
  assert.ok(newMetrics.mrr >= oldMetrics.mrr, "indexed search should not reduce MRR");
  const runtimeFailures = rows
    .filter((row) => row.runtimeRank !== 1)
    .map((row) => ({ label: row.label, expectedPath: row.expectedPath, runtimeRank: row.runtimeRank, runtimeTop: row.runtimeTop }));
  const runtimeFailureSummary = runtimeFailures.length ? ` Failures: ${JSON.stringify(runtimeFailures)}` : "";
  assert.ok(runtimeMetrics.top1 >= newMetrics.top1, `real recall runtime should preserve indexed Top-1 accuracy.${runtimeFailureSummary}`);
  assert.ok(runtimeMetrics.top3 >= newMetrics.top3, `real recall runtime should preserve indexed Top-3 accuracy.${runtimeFailureSummary}`);
  assert.ok(runtimeMetrics.mrr >= newMetrics.mrr, `real recall runtime should preserve indexed MRR.${runtimeFailureSummary}`);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("Shared brain search quality benchmark");
  console.log(`Vault: ${root}`);
  console.log(`Cases: ${rows.length}`);
  console.log(`Old Top-1/Top-3/MRR: ${oldMetrics.top1.toFixed(2)} / ${oldMetrics.top3.toFixed(2)} / ${oldMetrics.mrr.toFixed(2)}; median ${oldMetrics.medianMs.toFixed(2)}ms`);
  console.log(`Indexed Top-1/Top-3/MRR: ${newMetrics.top1.toFixed(2)} / ${newMetrics.top3.toFixed(2)} / ${newMetrics.mrr.toFixed(2)}; median ${newMetrics.medianMs.toFixed(2)}ms`);
  console.log(`Runtime Top-1/Top-3/MRR: ${runtimeMetrics.top1.toFixed(2)} / ${runtimeMetrics.top3.toFixed(2)} / ${runtimeMetrics.mrr.toFixed(2)}; median ${runtimeMetrics.medianMs.toFixed(2)}ms`);
  console.log(`Median speedup: ${result.medianSpeedup.toFixed(2)}x`);
  for (const row of rows) {
    console.log(`- ${row.label}: old rank ${row.oldRank ?? "miss"} (${row.oldMs}ms), indexed rank ${row.newRank ?? "miss"} (${row.newMs}ms), runtime rank ${row.runtimeRank ?? "miss"} (${row.runtimeMs}ms)`);
  }
}

await main();
