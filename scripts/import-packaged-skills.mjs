#!/usr/bin/env node
// Reusable importer for HivemindOS optional packaged skills.
//
// Vendors external SKILL.md skill repos into `packaged-skills/optional/<category>/<source>/<slug>/`
// in the layout the in-app catalog + Pack installer expect (see packaged-skills/README.md and
// src/lib/services/skills/skill-os.ts: readPackagedOptionalCatalog / readPackagedDirectoryPacks).
//
// For each imported skill it:
//   1. clones the upstream repo at a pinned/HEAD ref into a temp dir,
//   2. normalizes the upstream skill file into `<slug>/SKILL.md` (synthesizing YAML frontmatter
//      when the upstream file has none — e.g. flat `.md` fragments),
//   3. writes `.hivemind-skill-source.json` provenance (license, repo, commit, sourceUrl),
//   4. records a sha256 of the vendored SKILL.md in `skills-lock.json` for reproducibility.
//
// Usage:
//   node scripts/import-packaged-skills.mjs --list
//   node scripts/import-packaged-skills.mjs n8n
//   node scripts/import-packaged-skills.mjs n8n --ref <commit-or-tag>
//   node scripts/import-packaged-skills.mjs --all
//   node scripts/import-packaged-skills.mjs --verify        # re-hash vendored skills vs lock
//   node scripts/import-packaged-skills.mjs n8n --dry-run
//
// No file is committed; this is a producer/verifier only.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPTIONAL_ROOT = join(REPO_ROOT, "packaged-skills", "optional");
const LOCK_PATH = join(REPO_ROOT, "skills-lock.json");

// ---------------------------------------------------------------------------
// Source registry. Each entry describes one upstream skill repo and how to map
// it into the packaged-skills/optional/ layout. Add a new entry to make a new
// domain vendorable repeatably; only `n8n` is validated end-to-end so far.
// ---------------------------------------------------------------------------

const SOURCES = {
  n8n: {
    category: "n8n",
    sourceLabel: "forma-norden",
    repo: "forma-norden/n8n-gtm-workflow-pack",
    repoUrl: "https://github.com/forma-norden/n8n-gtm-workflow-pack",
    license: "MIT",
    // Authoritative skill set lives in `.agents/skills/` (router SKILL.md + 8 fragments).
    // The fragments are self-contained playbooks with no frontmatter, so layout = "flat".
    skillsRoot: ".agents/skills",
    layout: "flat",
    // The router orchestrator is dropped on purpose: HivemindOS does skill discovery natively
    // (context-index + recommendSkills), so the upstream keyword router is redundant here.
    exclude: ["SKILL"],
    validated: true,
    sourceUrlTemplate:
      "https://github.com/forma-norden/n8n-gtm-workflow-pack/blob/main/.agents/skills/{file}",
    // Concise discovery triggers, taken verbatim from the upstream router's routing table.
    triggers: {
      "n8n-lead-ingestion-enrichment": "lead ingestion, enrich leads, webhook-to-enrichment, dedupe, schema validation",
      "n8n-cold-outreach-orchestrator": "outreach sequencing, campaign enrollment, template rotation, send guardrails",
      "n8n-crm-conversation-sync": "CRM sync, HubSpot, Salesforce, log activity, follow-up tasks",
      "n8n-lead-scoring-routing": "lead scoring, route leads, MQL/SQL, prioritization, hot-lead alerts",
      "n8n-workflow-reliability-guardrails": "error handling, retry, timeout, dead-letter, workflow reliability",
      "n8n-observability-cost-control": "execution monitoring, AI-node cost control, drift alerting, health checks",
      "n8n-clay-integration": "Clay integration, Clay webhook, bidirectional Clay<->n8n sync",
      "n8n-self-hosting-guide": "self-host n8n, Docker, PostgreSQL, queue mode, scaling, backups",
    },
  },

  // --- Configured but NOT yet validated by a clone. Run with --dry-run first to confirm
  //     skillsRoot/layout before trusting the output. ---
  gtm: {
    category: "gtm",
    sourceLabel: "chadboyda",
    repo: "chadboyda/agent-gtm-skills",
    repoUrl: "https://github.com/chadboyda/agent-gtm-skills",
    license: "MIT",
    skillsRoot: "skills",
    layout: "dir",
    validated: false,
  },
  engineering: {
    category: "engineering",
    sourceLabel: "alirezarezvani",
    repo: "alirezarezvani/claude-skills",
    repoUrl: "https://github.com/alirezarezvani/claude-skills",
    license: "MIT",
    // alirezarezvani bundles many domains (engineering/product/marketing/c-level/finance/...).
    // skillsRoot/layout must be confirmed against the repo before import (--dry-run).
    skillsRoot: "skills",
    layout: "dir",
    validated: false,
  },
  clay: {
    category: "clay",
    sourceLabel: "bcharleson",
    repo: "bcharleson/clay-gtm-cli",
    repoUrl: "https://github.com/bcharleson/clay-gtm-cli",
    license: "MIT",
    skillsRoot: "skills",
    layout: "dir",
    validated: false,
    note: "Skills require a live Clay.com account + webhook tables; surface that gate to users.",
  },
  "sales-prompts": {
    category: "sales-prompts",
    sourceLabel: "prospeda",
    repo: "Prospeda/claude-gtm-skills",
    repoUrl: "https://github.com/Prospeda/claude-gtm-skills",
    license: "MIT",
    skillsRoot: ".",
    layout: "prompt-library",
    validated: false,
    note: "2000+ copy-paste prompts, not SKILL.md skills. Needs a prompt->skill wrap mode and a count cap before import.",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugToTitle(slug) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseFrontmatter(markdown) {
  const m = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return { has: false, fields: {}, body: markdown };
  const fields = {};
  for (const line of m[1].split("\n")) {
    const f = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (f) fields[f[1].toLowerCase()] = f[2].replace(/^["']|["']$/g, "").trim();
  }
  return { has: true, fields, body: markdown.slice(m[0].length).replace(/^\s*\n/, "") };
}

// First meaningful prose paragraph after an optional `## Purpose` heading; falls back to the
// first non-heading paragraph. Newlines collapsed to single spaces.
function extractDescription(markdown) {
  const purpose = markdown.match(/##\s*Purpose\s*\n+([\s\S]*?)(\n##\s|\n#\s|$)/i);
  let para = purpose ? purpose[1] : "";
  if (!para.trim()) {
    for (const block of markdown.split(/\n\s*\n/)) {
      const t = block.trim();
      if (t && !t.startsWith("#") && !t.startsWith("---")) {
        para = t;
        break;
      }
    }
  }
  return para.replace(/\s+/g, " ").trim();
}

function gitClone(repoUrl, ref) {
  const dir = execFileSync("mktemp", ["-d", join(tmpdir(), "hive-skill-import-XXXXXX")])
    .toString()
    .trim();
  execFileSync("git", ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), repoUrl, dir], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  const commit = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim();
  return { dir, commit };
}

async function readLock() {
  if (!existsSync(LOCK_PATH)) return { version: 1, skills: {} };
  return JSON.parse(await readFile(LOCK_PATH, "utf8"));
}

async function writeLock(lock) {
  const sorted = Object.fromEntries(Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b)));
  const out = { version: lock.version ?? 1, skills: sorted };
  await writeFile(LOCK_PATH, `${JSON.stringify(out, null, 2)}\n`);
}

// Collect upstream {slug, file, markdown} units for a source layout.
async function collectUpstream(source, rootDir) {
  const skillsDir = join(rootDir, source.skillsRoot);
  const units = [];
  if (source.layout === "flat") {
    const exclude = new Set((source.exclude ?? []).map((e) => e.toLowerCase()));
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const base = basename(e.name, ".md");
      if (exclude.has(base.toLowerCase())) continue;
      const markdown = await readFile(join(skillsDir, e.name), "utf8");
      units.push({ slug: slugify(base), file: e.name, markdown });
    }
  } else if (source.layout === "dir") {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const skillFile = join(skillsDir, e.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const markdown = await readFile(skillFile, "utf8");
      units.push({ slug: slugify(e.name), file: `${e.name}/SKILL.md`, markdown });
    }
  } else {
    throw new Error(`Layout "${source.layout}" not yet implemented for this importer.`);
  }
  units.sort((a, b) => a.slug.localeCompare(b.slug));
  return units;
}

// Produce the final vendored SKILL.md (guarantee YAML frontmatter with name + description).
function normalizeSkill(unit, source) {
  const { fields, body, has } = parseFrontmatter(unit.markdown);
  const name = fields.name?.trim() || unit.slug;
  let description = fields.description?.trim() || extractDescription(unit.markdown);
  const trigger = source.triggers?.[unit.slug];
  if (trigger && !/use (when|for)/i.test(description)) {
    description = `${description}${description.endsWith(".") ? "" : "."} Use for: ${trigger}.`;
  }
  description = description.replace(/"/g, "'").trim() || `Optional packaged skill: ${name}.`;
  const synthesized = !has || !fields.name || !fields.description;
  const content = has ? body : unit.markdown.replace(/^\s*\n/, "");
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `license: ${source.license}`,
    "---",
    "",
  ].join("\n");
  return { name, description, markdown: `${frontmatter}${content.trimEnd()}\n`, synthesized };
}

async function importSource(id, { ref, dryRun }, lock) {
  const source = SOURCES[id];
  if (!source) throw new Error(`Unknown source "${id}". Known: ${Object.keys(SOURCES).join(", ")}`);
  if (source.layout === "prompt-library") {
    throw new Error(`Source "${id}" uses layout "prompt-library" which this importer does not support yet.`);
  }
  console.log(`\n→ ${id}  (${source.repo}, ${source.license})${source.validated ? "" : "  [UNVALIDATED config]"}`);

  const { dir, commit } = gitClone(source.repoUrl, ref ?? source.ref);
  try {
    const units = await collectUpstream(source, dir);
    if (!units.length) throw new Error(`No skills found under ${source.skillsRoot} (layout ${source.layout}).`);
    const stamp = new Date().toISOString();
    const imported = [];

    for (const unit of units) {
      const normalized = normalizeSkill(unit, source);
      const packageDir = join(OPTIONAL_ROOT, source.category, source.sourceLabel, unit.slug);
      const skillPath = join(packageDir, "SKILL.md");
      const hash = sha256(normalized.markdown);
      const packagedRel = relative(REPO_ROOT, skillPath).replace(/\\/g, "/");
      const lockKey = unit.slug;

      // Collision guard: same slug must map to the same packaged path.
      const prior = lock.skills[lockKey];
      if (prior && prior.packagedPath && prior.packagedPath !== packagedRel) {
        throw new Error(`Lock slug collision: "${lockKey}" -> ${prior.packagedPath} vs ${packagedRel}`);
      }

      if (!dryRun) {
        await mkdir(packageDir, { recursive: true });
        // Preserve original importedAt if the manifest already exists.
        let importedAt = stamp;
        const manifestPath = join(packageDir, ".hivemind-skill-source.json");
        if (existsSync(manifestPath)) {
          try {
            importedAt = JSON.parse(await readFile(manifestPath, "utf8")).importedAt ?? stamp;
          } catch {}
        }
        await writeFile(skillPath, normalized.markdown);
        const sourceFileUrl = source.sourceUrlTemplate
          ? source.sourceUrlTemplate.replace("{file}", unit.file)
          : `${source.repoUrl}/blob/${commit}/${source.skillsRoot}/${unit.file}`;
        const manifest = {
          upstreamName: basename(unit.file, ".md"),
          upstreamSlug: unit.slug,
          hiveSlug: unit.slug,
          sourceLabel: source.sourceLabel,
          sourceUrl: sourceFileUrl,
          repository: source.repoUrl,
          installCommand: `npx skills add ${source.repoUrl} --skill ${unit.slug}`,
          importedAt,
          refreshedAt: stamp,
          provider: "packaged-optional",
          providerLabel: "HivemindOS optional packaged skills",
          sourcePath: relative(REPO_ROOT, packageDir).replace(/\\/g, "/"),
          packageGroup: source.category,
          status: "optional",
          license: source.license,
          commit,
          normalized: normalized.synthesized ? "frontmatter-synthesized-by-importer" : "verbatim-frontmatter",
          description: normalized.description,
        };
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }

      lock.skills[lockKey] = {
        source: source.repo,
        sourceType: "github",
        ref: commit,
        license: source.license,
        skillPath: `${source.skillsRoot}/${unit.file}`.replace(/\\/g, "/"),
        packagedPath: packagedRel,
        computedHash: hash,
      };
      imported.push(unit.slug);
      console.log(
        `   ${dryRun ? "would import" : "imported"} ${unit.slug}${normalized.synthesized ? "  (frontmatter synthesized)" : ""}`,
      );
    }

    console.log(`   ${imported.length} skill(s) at packaged-skills/optional/${source.category}/${source.sourceLabel}/`);
    return imported;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function verify(lock) {
  let drift = 0;
  let checked = 0;
  for (const [slug, entry] of Object.entries(lock.skills)) {
    if (!entry.packagedPath) continue; // legacy entries without a vendored path
    checked += 1;
    const abs = join(REPO_ROOT, entry.packagedPath);
    if (!existsSync(abs)) {
      console.log(`   MISSING  ${slug}  (${entry.packagedPath})`);
      drift += 1;
      continue;
    }
    const hash = sha256(await readFile(abs, "utf8"));
    if (hash !== entry.computedHash) {
      console.log(`   DRIFT    ${slug}  expected ${entry.computedHash.slice(0, 12)} got ${hash.slice(0, 12)}`);
      drift += 1;
    } else {
      console.log(`   ok       ${slug}`);
    }
  }
  console.log(`\n${checked} vendored skill(s) checked, ${drift} drift/missing.`);
  return drift;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    console.log("Configured skill sources:\n");
    for (const [id, s] of Object.entries(SOURCES)) {
      console.log(`  ${id.padEnd(14)} ${s.repo}  (${s.license}, layout=${s.layout})${s.validated ? "" : "  [unvalidated]"}`);
      if (s.note) console.log(`  ${"".padEnd(14)} note: ${s.note}`);
    }
    return;
  }

  const lock = await readLock();

  if (args.verify) {
    const drift = await verify(lock);
    process.exit(drift ? 1 : 0);
  }

  const ids = args.all ? Object.keys(SOURCES) : args.ids;
  if (!ids.length) {
    console.error("Specify a source id (see --list), or --all, or --verify.");
    process.exit(2);
  }

  for (const id of ids) {
    await importSource(id, args, lock);
  }
  if (!args.dryRun) {
    await writeLock(lock);
    console.log(`\nUpdated ${relative(REPO_ROOT, LOCK_PATH)}. Run "node scripts/import-packaged-skills.mjs --verify" to confirm hashes.`);
  } else {
    console.log("\nDry run: no files written.");
  }
}

main().catch((err) => {
  console.error(`\nImport failed: ${err.message}`);
  process.exit(1);
});
