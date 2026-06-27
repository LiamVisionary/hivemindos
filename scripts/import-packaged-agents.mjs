#!/usr/bin/env node
// Reusable importer for HivemindOS optional packaged AGENTS (agent subclasses).
//
// Vendors external agent collections into `packaged-agents/optional/<source>/<slug>/AGENT.md`
// in the runtime-agnostic AGENT.md format the in-app agent catalog + installer expect. The
// upstream agents may be authored for one runtime (e.g. Claude subagents); the importer keeps
// only the runtime-neutral parts (name, description, system-prompt body) so the installed agent
// can run on any runtime via the per-runtime prompt delivery matrix.
//
//   node scripts/import-packaged-agents.mjs --list
//   node scripts/import-packaged-agents.mjs wshobson            # import one source
//   node scripts/import-packaged-agents.mjs wshobson --dry-run
//   node scripts/import-packaged-agents.mjs --all
//   node scripts/import-packaged-agents.mjs --verify            # re-hash vendored agents vs lock
//
// No file is committed; this is a producer/verifier only.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPTIONAL_ROOT = join(REPO_ROOT, "packaged-agents", "optional");
const LOCK_PATH = join(REPO_ROOT, "agents-lock.json");

const SOURCES = {
  wshobson: {
    sourceLabel: "wshobson",
    repo: "wshobson/agents",
    repoUrl: "https://github.com/wshobson/agents",
    license: "MIT",
    // Canonical de-duplicated agents (not the per-runtime .cursor/.gemini mirrors).
    agentsGlobDir: "plugins",
    // plugins/<domain>/agents/<slug>.md
    matchPath: (rel) => {
      const m = rel.match(/^plugins\/([^/]+)\/agents\/([^/]+)\.md$/);
      return m ? { domain: m[1], slug: m[2] } : null;
    },
    validated: true,
  },
};

function parseArgs(argv) {
  const out = { ids: [], all: false, verify: false, list: false, dryRun: false, ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--all") out.all = true;
    else if (a === "--verify") out.verify = true;
    else if (a === "--list") out.list = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--ref") out.ref = argv[++i];
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else out.ids.push(a);
  }
  return out;
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const slugify = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const titleCase = (v) => String(v).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function parseFrontmatter(markdown) {
  const m = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { fields: {}, body: markdown };
  const fields = {};
  for (const line of m[1].split("\n")) {
    const f = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (f) fields[f[1].toLowerCase()] = f[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fields, body: markdown.slice(m[0].length) };
}

// Build the runtime-neutral AGENT.md for an optional agent.
function toAgentMarkdown({ slug, label, summary, domain, body }) {
  const fm = [
    `id: ${slug}`,
    "tier: optional",
    `label: ${JSON.stringify(label)}`,
    `summary: ${JSON.stringify(summary)}`,
    `domain: ${JSON.stringify(domain)}`,
    `skillSlugs: []`,
  ];
  return `---\n${fm.join("\n")}\n---\n\n## Soul\n\n${body.trim()}\n`;
}

function gitClone(repoUrl, ref) {
  const dir = execFileSync("mktemp", ["-d", join(tmpdir(), "hive-agent-import-XXXXXX")]).toString().trim();
  execFileSync("git", ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), repoUrl, dir], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const commit = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
  return { dir, commit };
}

async function walkMd(root, base = root, out = []) {
  for (const e of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    const p = join(root, e.name);
    if (e.isDirectory() && e.name !== ".git") await walkMd(p, base, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(relative(base, p).replace(/\\/g, "/"));
  }
  return out;
}

async function readLock() {
  if (!existsSync(LOCK_PATH)) return { version: 1, agents: {} };
  return JSON.parse(await readFile(LOCK_PATH, "utf8"));
}
async function writeLock(lock) {
  const sorted = Object.fromEntries(Object.entries(lock.agents).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(LOCK_PATH, `${JSON.stringify({ version: lock.version ?? 1, agents: sorted }, null, 2)}\n`);
}

async function importSource(id, { ref, dryRun }, lock) {
  const source = SOURCES[id];
  if (!source) throw new Error(`Unknown source "${id}". Known: ${Object.keys(SOURCES).join(", ")}`);
  console.log(`\n→ ${id}  (${source.repo}, ${source.license})${source.validated ? "" : "  [UNVALIDATED]"}`);
  const { dir, commit } = gitClone(source.repoUrl, ref ?? source.ref);
  try {
    const rels = await walkMd(join(dir, source.agentsGlobDir), dir);
    const units = [];
    for (const rel of rels) {
      const match = source.matchPath(rel);
      if (!match) continue;
      const markdown = await readFile(join(dir, rel), "utf8");
      const { fields, body } = parseFrontmatter(markdown);
      if (!body.trim()) continue;
      const slug = slugify(fields.name || match.slug);
      const summary = (fields.description || "").replace(/\s+/g, " ").trim() || `Optional ${match.domain} agent.`;
      units.push({ slug, label: titleCase(match.slug), summary, domain: match.domain, rel, body });
    }
    units.sort((a, b) => a.slug.localeCompare(b.slug));
    if (!units.length) throw new Error(`No agents matched under ${source.agentsGlobDir}.`);

    const stamp = new Date().toISOString();
    const seen = new Set();
    let written = 0;
    for (const unit of units) {
      if (seen.has(unit.slug)) continue; // de-dupe across domains
      seen.add(unit.slug);
      const packageDir = join(OPTIONAL_ROOT, source.sourceLabel, unit.slug);
      const agentPath = join(packageDir, "AGENT.md");
      const md = toAgentMarkdown(unit);
      const hash = sha256(md);
      const packagedRel = relative(REPO_ROOT, agentPath).replace(/\\/g, "/");

      if (!dryRun) {
        await mkdir(packageDir, { recursive: true });
        let importedAt = stamp;
        const manifestPath = join(packageDir, ".hivemind-agent-source.json");
        if (existsSync(manifestPath)) {
          try { importedAt = JSON.parse(await readFile(manifestPath, "utf8")).importedAt ?? stamp; } catch {}
        }
        await writeFile(agentPath, md);
        await writeFile(manifestPath, `${JSON.stringify({
          upstreamName: basename(unit.rel, ".md"),
          slug: unit.slug,
          label: unit.label,
          domain: unit.domain,
          sourceLabel: source.sourceLabel,
          sourceUrl: `${source.repoUrl}/blob/${commit}/${unit.rel}`,
          repository: source.repoUrl,
          installCommand: `(packaged) optional agent ${unit.slug}`,
          importedAt,
          refreshedAt: stamp,
          provider: "packaged-optional-agent",
          providerLabel: "HivemindOS optional packaged agents",
          sourcePath: relative(REPO_ROOT, packageDir).replace(/\\/g, "/"),
          status: "optional",
          license: source.license,
          commit,
          description: unit.summary,
        }, null, 2)}\n`);
      }
      lock.agents[unit.slug] = {
        source: source.repo,
        sourceType: "github",
        ref: commit,
        license: source.license,
        skillPath: unit.rel,
        packagedPath: packagedRel,
        computedHash: hash,
      };
      written += 1;
    }
    console.log(`   ${dryRun ? "would import" : "imported"} ${written} agent(s) -> packaged-agents/optional/${source.sourceLabel}/`);
    return written;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function verify(lock) {
  let drift = 0, checked = 0;
  for (const [slug, entry] of Object.entries(lock.agents)) {
    if (!entry.packagedPath) continue;
    checked += 1;
    const abs = join(REPO_ROOT, entry.packagedPath);
    if (!existsSync(abs)) { console.log(`   MISSING  ${slug}`); drift += 1; continue; }
    const hash = sha256(await readFile(abs, "utf8"));
    if (hash !== entry.computedHash) { console.log(`   DRIFT    ${slug}`); drift += 1; }
  }
  console.log(`\n${checked} vendored agent(s) checked, ${drift} drift/missing.`);
  return drift;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    for (const [id, s] of Object.entries(SOURCES)) {
      console.log(`  ${id.padEnd(12)} ${s.repo}  (${s.license})${s.validated ? "" : "  [unvalidated]"}`);
    }
    return;
  }
  const lock = await readLock();
  if (args.verify) process.exit((await verify(lock)) ? 1 : 0);

  const ids = args.all ? Object.keys(SOURCES) : args.ids;
  if (!ids.length) { console.error("Specify a source id (see --list), --all, or --verify."); process.exit(2); }
  for (const id of ids) await importSource(id, args, lock);
  if (!args.dryRun) {
    await writeLock(lock);
    console.log(`\nUpdated ${relative(REPO_ROOT, LOCK_PATH)}.`);
  } else {
    console.log("\nDry run: no files written.");
  }
}

main().catch((err) => { console.error(`\nImport failed: ${err.message}`); process.exit(1); });
