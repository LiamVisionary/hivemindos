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
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OPTIONAL_ROOT = join(REPO_ROOT, "packaged-skills", "optional");
const AUTO_INSTALL_ROOT = join(REPO_ROOT, "packaged-skills", "auto-install");
const LOCK_PATH = join(REPO_ROOT, "skills-lock.json");

// ---------------------------------------------------------------------------
// Source registry. Each entry describes one upstream skill repo and how to map
// it into the packaged-skills/optional/ layout. Add a new entry to make a new
// domain vendorable repeatably; only `n8n` is validated end-to-end so far.
// ---------------------------------------------------------------------------

const SOURCES = {
  hyperframes: {
    category: "media",
    sourceLabel: "HeyGen HyperFrames",
    repo: "heygen-com/hyperframes",
    repoUrl: "https://github.com/heygen-com/hyperframes",
    license: "Apache-2.0",
    skillsRoot: "skills",
    layout: "dir",
    validated: true,
    ref: "3351fb1a6d7f0202d07db9bf9ad335fd0d1ec344",
    expectedCommit: "3351fb1a6d7f0202d07db9bf9ad335fd0d1ec344",
    sourceArchiveSha256: "5371981bb828588789bd682c31f374204a0ba85af4d2c2052a7cff2cf011edfc",
    destination: "auto-install",
    copySkillDirectory: true,
    licenseFile: "LICENSE",
    preserveFrontmatter: false,
    hivemindOsAugmentation: true,
    integrationPolicy: "hyperframes",
    resourceExcludes: {
      // The 40 MB binary showcase bundle is not required by any authoring workflow.
      // Keep its HTML examples, rules, adapters, and scripts while avoiding fleet-wide
      // replication of demo-only videos and images.
      "hyperframes-animation": ["examples/assets"],
    },
    descriptionOverrides: {
      hyperframes: "Use for a concrete request to create, render, or deliver a video when the user chooses HyperFrames (including the common shorthand or typo hypergen), HTML-based video, browser-rendered video, or motion graphics. Distinguish actionable creation from discussion, brainstorming, hypotheticals, and capability questions; those should not trigger generation or a method question.",
    },
    hivemindAdaptations: [
      "All nineteen upstream HyperFrames router, domain, and workflow skills are bundled as sibling auto-install skills.",
      "The 40 MB hyperframes-animation binary showcase asset directory is excluded; authoring rules, adapters, scripts, and HTML examples remain bundled.",
      "Mutable skills installers and curl-to-shell commands are disabled by HivemindOS policy; agents use the bundled skills and require explicit approval before installing or updating a CLI.",
      "Raw authentication output is never relayed; HivemindOS reports only provider/key names and set or missing status.",
    ],
  },

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

  mengto: {
    category: "design",
    sourceLabel: "mengto",
    repo: "MengTo/Skills",
    repoUrl: "https://github.com/MengTo/Skills",
    license: "MIT",
    // MengTo/Skills stores portable design, media, and Codex workflow skills as
    // `agent-skills/<category>/<skill>/SKILL.md`, often with local references.
    skillsRoot: "agent-skills",
    layout: "nested-dir",
    validated: true,
    copySkillDirectory: true,
    licenseFile: "LICENSE",
  },

  emilkowalski: {
    category: "design",
    sourceLabel: "emilkowalski",
    repo: "emilkowalski/skills",
    repoUrl: "https://github.com/emilkowalski/skills",
    license: "MIT",
    // Emil Kowalski's design-engineering skills live at `skills/<slug>/SKILL.md`.
    // `review-animations` ships a companion `STANDARDS.md`, so copy the whole skill
    // directory (like mengto) rather than only the SKILL.md.
    skillsRoot: "skills",
    layout: "dir",
    validated: true,
    copySkillDirectory: true,
    licenseFile: "LICENSE",
    // `review-animations` sets `disable-model-invocation: true`; keep upstream
    // frontmatter directives verbatim instead of flattening to name/description/license.
    preserveFrontmatter: true,
  },

  superpowers: {
    category: "engineering",
    sourceLabel: "obra-superpowers",
    repo: "obra/superpowers",
    repoUrl: "https://github.com/obra/superpowers",
    license: "MIT",
    skillsRoot: "skills",
    layout: "dir",
    validated: true,
    ref: "v6.1.1",
    expectedCommit: "d884ae04edebef577e82ff7c4e143debd0bbec99",
    copySkillDirectory: true,
    licenseFile: "LICENSE",
    preserveFrontmatter: true,
    include: [
      "brainstorming",
      "dispatching-parallel-agents",
      "executing-plans",
      "finishing-a-development-branch",
      "receiving-code-review",
      "requesting-code-review",
      "subagent-driven-development",
      "systematic-debugging",
      "test-driven-development",
      "using-git-worktrees",
      "verification-before-completion",
      "writing-plans",
    ],
    descriptionOverrides: {
      brainstorming: "Use for materially ambiguous, novel, cross-system, or costly-to-reverse engineering work that benefits from a reviewed design before implementation; keep clear reversible tasks lightweight.",
      "dispatching-parallel-agents": "Use when approved work contains two or more independent subtasks and HivemindOS, the user, and project policy permit parallel agent fan-out.",
      "subagent-driven-development": "Use when an approved implementation plan has independent tasks and the active HivemindOS runtime permits delegated implementer and reviewer roles.",
      "using-git-worktrees": "Use when consequential repository work needs an isolated checkout and the project worktree policy permits creating one.",
      "finishing-a-development-branch": "Use after implementation and verification to present safe branch handoff choices without assuming merge, push, cleanup, or deletion authority.",
      "writing-plans": "Use when a material multi-step engineering design needs an executable plan in the project's established planning surface.",
    },
    resourceExcludes: {
      // The visual companion starts a local web server. HivemindOS supplies its own
      // browser/visual tools, so only the portable brainstorming method is packaged.
      brainstorming: ["scripts", "visual-companion.md"],
      // This upstream demonstration imports Superpowers' own application aliases,
      // so packaging it would make the HivemindOS TypeScript project compile it.
      "systematic-debugging": ["condition-based-waiting-example.ts"],
    },
    hivemindOsAugmentation: true,
    note: "Curated methods only. The upstream plugin bootstrap, hooks, and brainstorming web server are intentionally excluded.",
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
  const gitOptions = {
    env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1", GIT_TERMINAL_PROMPT: "0" },
  };
  if (/^[a-f0-9]{40}$/i.test(ref ?? "")) {
    execFileSync("git", ["init", "--quiet", dir], gitOptions);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", repoUrl], gitOptions);
    execFileSync("git", ["-C", dir, "fetch", "--quiet", "--depth", "1", "origin", ref], gitOptions);
    execFileSync("git", ["-C", dir, "checkout", "--quiet", "--detach", "FETCH_HEAD"], gitOptions);
  } else {
    execFileSync("git", ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), repoUrl, dir], {
      ...gitOptions,
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  const commit = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], gitOptions).toString().trim();
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

async function hashPackagedFiles(root) {
  const hashes = {};
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".hivemind-skill-source.json") continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Packaged skill resource may not be a symlink: ${relative(root, path)}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) hashes[relative(root, path).replace(/\\/g, "/")] = sha256(await readFile(path));
    }
  }
  await walk(root);
  return hashes;
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
      units.push({ slug: slugify(base), file: e.name, sourceFolder: ".", markdown });
    }
  } else if (source.layout === "dir") {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const skillFile = join(skillsDir, e.name, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const markdown = await readFile(skillFile, "utf8");
      units.push({ slug: slugify(e.name), file: `${e.name}/SKILL.md`, sourceFolder: e.name, markdown });
    }
  } else if (source.layout === "nested-dir") {
    const categoryEntries = await readdir(skillsDir, { withFileTypes: true });
    for (const category of categoryEntries) {
      if (!category.isDirectory() || category.name.startsWith(".")) continue;
      const categoryDir = join(skillsDir, category.name);
      const entries = await readdir(categoryDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".")) continue;
        const sourceFolder = `${category.name}/${e.name}`;
        const skillFile = join(skillsDir, sourceFolder, "SKILL.md");
        if (!existsSync(skillFile)) continue;
        const markdown = await readFile(skillFile, "utf8");
        units.push({
          slug: slugify(e.name),
          file: `${sourceFolder}/SKILL.md`,
          sourceFolder,
          upstreamCategory: slugify(category.name),
          markdown,
        });
      }
    }
  } else {
    throw new Error(`Layout "${source.layout}" not yet implemented for this importer.`);
  }
  if (source.include?.length) {
    const included = new Set(source.include.map(slugify));
    return units.filter((unit) => included.has(unit.slug)).sort((a, b) => a.slug.localeCompare(b.slug));
  }
  units.sort((a, b) => a.slug.localeCompare(b.slug));
  return units;
}

function hivemindOsPolicy(unit, source) {
  if (source.integrationPolicy === "hyperframes") {
    const methodBoundary = unit.slug === "hyperframes" ? [
      "## HivemindOS method boundary",
      "",
      "Infer the user's speech act before routing. Discussion, brainstorming, hypotheticals, capability questions, and statements such as \"I'm thinking about generating a video\" remain ordinary conversation. Do not treat the presence of words such as “generate” or “video” as authorization, start generation, or ask for a method on that basis.",
      "",
      "For a concrete creation request, respect the selected production method:",
      "",
      "- **Cloud AI video generation** uses an explicitly selected connected hosted provider.",
      "- **Local AI video generation** uses an explicitly selected machine or private-fleet provider.",
      "- **HTML / HyperFrames rendering** uses these bundled HyperFrames skills.",
      "",
      "When a concrete request leaves the method open, ask which of those three the user intends. Upstream wording that calls HyperFrames a default does not override this HivemindOS multi-provider boundary.",
      "",
    ] : [];
    return [
      "## HivemindOS Integration",
      "",
      "- This skill and every HyperFrames router, domain, and workflow skill it references are already bundled as sibling skills under `packaged-skills/auto-install/<slug>/SKILL.md` and the Shared Brain skill shelf.",
      "- Resolve sibling skills by slug through the active skill shelf. Never invent a nested `packaged-skills/hyperframes/<slug>` path, and never run `npx skills add`, `npx skills update`, or a curl-to-shell installer to obtain a bundled workflow.",
      "- Treat upstream commands as proposed steps only after the user selects HTML / HyperFrames and the command fits the requested build. Existing HivemindOS permission and side-effect gates remain authoritative.",
      "- Use an already installed HyperFrames CLI when available. Installing or updating executable third-party code requires explicit approval and pinned provenance; do not silently fetch mutable latest code.",
      "- Never relay raw authentication command output. Report credential names and set or missing status only; cloud login, publish, upload, and paid-provider actions require the user's explicit request.",
      "",
      ...methodBoundary,
      "## Upstream Method",
      "",
    ].join("\n");
  }
  const shared = [
    "This optional skill is a method library inside HivemindOS, not a global bootstrap or instruction override.",
    "HivemindOS packaged skills, the active Work Board loop contract, user instructions, and project rules remain authoritative.",
    "Upstream words such as MUST, always, or mandatory apply only after this skill is selected for a task where the method fits; they do not force ceremony onto small, clear, reversible work.",
    "Do not commit, push, merge, delete branches, create worktrees, launch subagents, or take outward actions unless the user request and active project policy authorize that exact action.",
    "Record evidence and gate outcomes in the HivemindOS task/loop receipts when the work runs from the Work Board.",
  ];
  const specific = {
    brainstorming: [
      "Use this for material ambiguity, novel product behavior, cross-system design, or costly-to-reverse choices; a short inline design is enough for bounded changes.",
      "The upstream visual companion is not packaged. Use HivemindOS visual tools when a visual materially improves the decision.",
      "Follow the repository's established spec location and changelog policy instead of assuming docs/superpowers or an automatic commit.",
    ],
    "dispatching-parallel-agents": [
      "Parallel fan-out is optional and requires the runtime/user/project to permit it; prefer HivemindOS Queen Bee or approved agent routes when available.",
    ],
    "subagent-driven-development": [
      "Treat upstream subagent scripts and role prompts as implementation aids, not permission to fan out or commit autonomously.",
    ],
    "using-git-worktrees": [
      "Use the repository's existing worktree conventions and never disturb another task's dirty working tree.",
    ],
    "finishing-a-development-branch": [
      "Present finish options without performing destructive cleanup, merge, push, or branch deletion unless explicitly authorized.",
    ],
    "writing-plans": [
      "Use the project's established plan surface and file conventions; Work Board loop steps and receipts are the durable execution record when present.",
    ],
  }[unit.slug] ?? [];
  return [
    "## HivemindOS Integration",
    "",
    ...[...shared, ...specific].map((line) => `- ${line}`),
    "",
    "## Upstream Method",
    "",
  ].join("\n");
}

function adaptUpstreamContent(content, unit, source) {
  if (!source.hivemindOsAugmentation) return content;
  if (source.integrationPolicy === "hyperframes") {
    let adapted = content.replace(
      /## If the matched workflow isn't installed[\s\S]*?(?=## Workflow details)/,
      [
        "## HivemindOS packaged workflow resolution",
        "",
        "All workflows in the cheat-sheet are packaged as sibling auto-install skills. Resolve the selected slug from the active skill shelf or `packaged-skills/auto-install/<slug>/SKILL.md`, read it, and continue. Do not ask the user to install or update skills.",
        "",
      ].join("\n"),
    );
    adapted = adapted.replace(
      /curl -fsSL https:\/\/static\.heygen\.ai\/cli\/install\.sh \| bash[^\n]*/g,
      "# HivemindOS: do not use the mutable curl-to-shell installer; use an approved pinned CLI installation.",
    );
    return adapted;
  }
  let adapted = content.replaceAll("superpowers:", "");
  if (unit.slug === "executing-plans") {
    adapted = adapted.replace(
      /\*\*Note:\*\* Tell your human partner that Superpowers works much better[\s\S]*?instead of this skill\./,
      "**Delegation note:** If approved subagents are available and the plan contains independent tasks, prefer `subagent-driven-development`; otherwise execute the plan directly.",
    );
  }
  if (unit.slug === "writing-plans") {
    adapted = adapted
      .replaceAll("function(input)", "target_behavior(input)")
      .replace('"function not defined"', '"target_behavior not defined"');
  }
  if (unit.slug !== "brainstorming") return adapted;
  return adapted
    .replace(
      /<HARD-GATE>[\s\S]*?<\/HARD-GATE>/,
      [
        "<HARD-GATE>",
        "For the material ambiguity that caused this skill to be selected, do not implement until the design is presented and approved. If inspection proves the task is clear, bounded, and reversible, record that conclusion and return to the normal lightweight HivemindOS path.",
        "</HARD-GATE>",
      ].join("\n"),
    )
    .replace(
      /## Anti-Pattern: "This Is Too Simple To Need A Design"[\s\S]*?(?=\n## Checklist)/,
      "## Scope Check\n\nWhen this skill is selected, keep the design proportionate. A bounded design may be only a few sentences; do not expand it into ceremony that does not reduce risk.\n",
    )
    .replace(/^2\. \*\*Offer the visual companion just-in-time\*\*.*\n/m, "")
    .replace("6. **Write design doc** — save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit", "6. **Write design doc** — use the project's established spec location and do not commit unless authorized")
    .replace("- Write the validated design (spec) to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`", "- Write the validated design to the project's established spec location")
    .replace("Spec written and committed to `<path>`.", "Spec written to `<path>` (uncommitted unless separately authorized).")
    .replace(/\n## Visual Companion[\s\S]*$/, "\n");
}

async function adaptHyperframesPackagedResources(packageDir) {
  const pending = [packageDir];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "SKILL.md") continue;
      const original = await readFile(path, "utf8");
      const adapted = original
        .replaceAll(
          "Run `npx skills add heygen-com/hyperframes --all`",
          "Already bundled with HivemindOS; do not run a skills installer",
        )
        .replaceAll(
          "load it via `npx skills add pixel-point/animate-text` or `/animate-text`",
          "use it only when the separately installed `/animate-text` skill is already available",
        )
        .replaceAll(
          "npx skills add pixel-point/animate-text",
          "# HivemindOS: an external animate-text install requires explicit user approval",
        );
      if (adapted !== original) await writeFile(path, adapted);
    }
  }
}

// Produce the final vendored SKILL.md (guarantee YAML frontmatter with name + description).
function normalizeSkill(unit, source) {
  const { fields, body, has } = parseFrontmatter(unit.markdown);
  const name = fields.name?.trim() || unit.slug;
  let description = source.descriptionOverrides?.[unit.slug] || fields.description?.trim() || extractDescription(unit.markdown);
  const trigger = source.triggers?.[unit.slug];
  if (trigger && !/use (when|for)/i.test(description)) {
    description = `${description}${description.endsWith(".") ? "" : "."} Use for: ${trigger}.`;
  }
  description = description.replace(/"/g, "'").trim() || `Optional packaged skill: ${name}.`;
  const synthesized = !has || !fields.name || !fields.description;
  const content = adaptUpstreamContent(has ? body : unit.markdown.replace(/^\s*\n/, ""), unit, source);
  // Opt-in: carry through upstream frontmatter directives (e.g. `disable-model-invocation`,
  // `allowed-tools`) verbatim instead of flattening to name/description/license only. The
  // canonical trio is always re-emitted first; every other original frontmatter line is kept
  // as-is (block-style YAML lists included), so nothing meaningful is silently dropped.
  const passthrough = [];
  if (source.preserveFrontmatter && has) {
    const inner = unit.markdown.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
    for (const line of inner.split("\n")) {
      if (/^(name|description|license)\s*:/i.test(line)) continue;
      passthrough.push(line);
    }
    while (passthrough.length && !passthrough[passthrough.length - 1].trim()) passthrough.pop();
  }
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `license: ${source.license}`,
    ...passthrough,
    "---",
    "",
  ].join("\n");
  const augmentation = source.hivemindOsAugmentation ? hivemindOsPolicy(unit, source) : "";
  return { name, description, markdown: `${frontmatter}${augmentation}${content.trimEnd()}\n`, synthesized };
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
    if (source.expectedCommit && commit !== source.expectedCommit) {
      throw new Error(`Source ${id} resolved to ${commit}, expected ${source.expectedCommit}.`);
    }
    const units = await collectUpstream(source, dir);
    if (!units.length) throw new Error(`No skills found under ${source.skillsRoot} (layout ${source.layout}).`);
    if (source.include?.length && units.length !== source.include.length) {
      const found = new Set(units.map((unit) => unit.slug));
      const missing = source.include.map(slugify).filter((slug) => !found.has(slug));
      throw new Error(`Source ${id} is missing selected skills: ${missing.join(", ")}.`);
    }
    const stamp = new Date().toISOString();
    const imported = [];

    for (const unit of units) {
      const normalized = normalizeSkill(unit, source);
      const autoInstall = source.destination === "auto-install";
      const packageDir = autoInstall
        ? join(AUTO_INSTALL_ROOT, unit.slug)
        : join(OPTIONAL_ROOT, source.category, source.sourceLabel, unit.slug);
      const skillPath = join(packageDir, "SKILL.md");
      const hash = sha256(normalized.markdown);
      const packagedRel = relative(REPO_ROOT, skillPath).replace(/\\/g, "/");
      const lockKey = unit.slug;
      let resourceHashes;

      // Collision guard: same slug must map to the same packaged path.
      const prior = lock.skills[lockKey];
      if (prior && prior.packagedPath && prior.packagedPath !== packagedRel) {
        throw new Error(`Lock slug collision: "${lockKey}" -> ${prior.packagedPath} vs ${packagedRel}`);
      }

      if (!dryRun) {
        // Preserve original importedAt if the manifest already exists.
        let importedAt = stamp;
        const manifestPath = join(packageDir, ".hivemind-skill-source.json");
        if (existsSync(manifestPath)) {
          try {
            importedAt = JSON.parse(await readFile(manifestPath, "utf8")).importedAt ?? stamp;
          } catch {}
        }
        if (source.copySkillDirectory && unit.sourceFolder) {
          await rm(packageDir, { recursive: true, force: true });
          await mkdir(packageDir, { recursive: true });
          await cp(join(dir, source.skillsRoot, unit.sourceFolder), packageDir, { recursive: true, force: true });
          for (const excluded of source.resourceExcludes?.[unit.slug] ?? []) {
            const excludedPath = resolve(packageDir, excluded);
            if (excludedPath !== packageDir && excludedPath.startsWith(`${packageDir}/`)) {
              await rm(excludedPath, { recursive: true, force: true });
            }
          }
          if (source.integrationPolicy === "hyperframes") {
            await adaptHyperframesPackagedResources(packageDir);
          }
        } else {
          await mkdir(packageDir, { recursive: true });
        }
        await writeFile(skillPath, normalized.markdown);
        if (source.licenseFile) {
          const licensePath = join(dir, source.licenseFile);
          if (existsSync(licensePath)) {
            await cp(licensePath, join(packageDir, basename(source.licenseFile)), { force: true });
          }
        }
        const sourceFileUrl = source.sourceUrlTemplate
          ? source.sourceUrlTemplate.replace("{file}", unit.file)
          : `${source.repoUrl}/blob/${commit}/${source.skillsRoot}/${unit.file}`;
        const manifest = {
          upstreamName: normalized.name,
          upstreamSlug: unit.slug,
          hiveSlug: unit.slug,
          sourceLabel: source.sourceLabel,
          sourceUrl: sourceFileUrl,
          repository: source.repoUrl,
          installCommand: autoInstall ? "Bundled with HivemindOS" : `npx skills add ${source.repoUrl} --skill ${unit.slug}`,
          importedAt,
          refreshedAt: stamp,
          provider: autoInstall ? "packaged-auto-install" : "packaged-optional",
          providerLabel: autoInstall ? "HivemindOS auto-installed packaged skills" : "HivemindOS optional packaged skills",
          sourcePath: relative(REPO_ROOT, packageDir).replace(/\\/g, "/"),
          packageGroup: source.category,
          ...(unit.upstreamCategory ? { upstreamCategory: unit.upstreamCategory } : {}),
          status: autoInstall ? "auto-install" : "optional",
          license: source.license,
          commit,
          ...(source.sourceArchiveSha256 ? { sourceArchiveSha256: source.sourceArchiveSha256 } : {}),
          ...(source.repoUrl ? { upstreamSourceUrl: source.repoUrl } : {}),
          normalized: source.hivemindOsAugmentation
            ? "hivemindos-augmented-upstream"
            : normalized.synthesized ? "frontmatter-synthesized-by-importer" : "verbatim-frontmatter",
          description: normalized.description,
          ...(source.hivemindAdaptations ? { hivemindAdaptations: source.hivemindAdaptations } : {}),
        };
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        resourceHashes = await hashPackagedFiles(packageDir);
      }

      lock.skills[lockKey] = {
        source: source.repo,
        sourceType: "github",
        ref: commit,
        license: source.license,
        skillPath: `${source.skillsRoot}/${unit.file}`.replace(/\\/g, "/"),
        packagedPath: packagedRel,
        computedHash: hash,
        ...(resourceHashes ? { resourceHashes } : {}),
      };
      imported.push(unit.slug);
      console.log(
        `   ${dryRun ? "would import" : "imported"} ${unit.slug}${normalized.synthesized ? "  (frontmatter synthesized)" : ""}`,
      );
    }

    console.log(`   ${imported.length} skill(s) at ${source.destination === "auto-install" ? "packaged-skills/auto-install/" : `packaged-skills/optional/${source.category}/${source.sourceLabel}/`}`);
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
    const packageDir = dirname(abs);
    const currentResourceHashes = entry.resourceHashes ? await hashPackagedFiles(packageDir) : undefined;
    const resourcesMatch = !entry.resourceHashes || JSON.stringify(currentResourceHashes) === JSON.stringify(entry.resourceHashes);
    if (hash !== entry.computedHash || !resourcesMatch) {
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
