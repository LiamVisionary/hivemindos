#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const DEFAULT_PRICE_PER_MILLION = 1;
const SKIP_DIRS = new Set([".git", ".next", ".next-tauri", ".next-tauri-build", "node_modules", "out", "dist", "build", "target"]);
const READABLE_EXTENSIONS = new Set([".md", ".mdx", ".ts", ".tsx", ".js", ".mjs", ".json", ".sh", ".ps1", ".go", ".rs", ".yaml", ".yml"]);

export const scenarios = [
  {
    id: "brain-recall",
    title: "Recall project context before answering",
    task: "Explain how HivemindOS shared brain memory works and which command a raw agent should use before relying on prior context.",
    e2e: {
      outcome: {
        kind: "required-patterns",
        patterns: ["hive-brain answer", "typed agent memory", "full-vault"],
        minimumRatio: 1,
      },
    },
    baseline: {
      label: "Naive broad docs and source read",
      paths: [
        "AGENTS.md",
        "README.md",
        "docs/for-users/features/brain-vault-and-skills.md",
        "docs/for-users/whole-brain",
        "scripts/hive-brain",
        "src/lib/services/obsidian/agent-memory",
        "src/lib/services/chat/shared-brain-memory-context.ts",
        "src/lib/services/context-index.ts",
      ],
    },
    hive: {
      label: "Hive-brain targeted recall",
      snippets: [
        "Use `hive-brain answer \"<query>\"` for concise grounded shared-brain recall.",
        "Use `hive-brain recall \"<query>\" --scope full-vault --limit 8` when a ranked hit list is more useful.",
        "Default recall is tiered: typed Agent Memory first, then full-vault augmentation only when needed.",
      ],
      sections: [
        { path: "docs/for-users/features/brain-vault-and-skills.md", heading: "Shared Brain Memory Summary" },
        { path: "docs/for-users/packaged-skills/hive-skills.md", heading: "Supporting Hive Search Commands" },
      ],
      paths: ["scripts/hive-brain"],
      pathMaxChars: 5000,
    },
  },
  {
    id: "software-build",
    title: "Start a software build request",
    task: "Build a new HivemindOS feature without starting from a blank page.",
    e2e: {
      outcome: {
        kind: "required-patterns",
        patterns: ["hive-assimilate", "hive-capability-search", "existing"],
        minimumRatio: 2 / 3,
      },
    },
    baseline: {
      label: "Naive current-project sweep",
      paths: [
        "AGENTS.md",
        "README.md",
        "docs",
        "src/features/dashboard",
        "src/lib/services",
        "packaged-skills",
      ],
      maxFilesPerDirectory: 120,
    },
    hive: {
      label: "Hive-assimilate plus focused capability map",
      snippets: [
        "Pinned sources are authoritative. Inspect them before broad discovery.",
        "Search the shared brain, current project, bounded user project roots, local/private indexes, and public GitHub before custom implementation.",
        "Use concrete copied/adapted files, tests, configs, schemas, assets, or workflows before writing glue code.",
      ],
      sections: [
        { path: "AGENTS.md", heading: "Shared Brain And Skills" },
        { path: "docs/for-users/features/token-and-cost-savings.md", heading: "Practical Rule" },
      ],
      paths: [
        "packaged-skills/auto-install/hive-assimilate/SKILL.md",
        "packaged-skills/auto-install/hive-capability-search/SKILL.md",
        "src/lib/services/chat/task-retrieval-context.ts",
      ],
      pathMaxChars: 14000,
    },
  },
  {
    id: "chatbot-build",
    title: "Build a dashboard chatbot feature",
    task: "Build a HivemindOS dashboard chatbot feature that lets a user ask project questions, recalls shared brain memory, selects an agent/runtime, streams responses with tool/status events, and includes a minimal API route plus React UI wiring. Return the implementation plan, key files, tests, and safety gates.",
    e2e: {
      responseKeys: ["answer", "files", "tests", "safety", "confidence"],
      responseExample: '{"answer":"short implementation plan","files":["path"],"tests":["command"],"safety":["gate"],"confidence":0.5}',
      outcome: {
        kind: "repository-paths",
        minimumPaths: 4,
        minimumExistingRatio: 0.8,
        requiredOwners: [
          "src/app/api/chat/agent-runtime",
          "src/lib/services/chat",
          "src/lib/services/runtime-adapters",
          "src/features/dashboard",
        ],
      },
    },
    baseline: {
      label: "Naive current-project sweep",
      paths: [
        "AGENTS.md",
        "README.md",
        "docs",
        "src/features/dashboard",
        "src/lib/services",
        "packaged-skills",
      ],
      maxFilesPerDirectory: 120,
    },
    hive: {
      label: "Hive-assimilate plus focused capability map",
      snippets: [
        "Use hive-capability-search before implementing chatbot, streaming, shared-brain, runtime-selection, or agent-routing features.",
        "Search the shared brain and context index for existing dashboard chat, task retrieval, runtime adapter, and streaming event surfaces.",
        "Reuse concrete files, tests, API routes, schemas, and UI conventions from the current project before adding new glue.",
      ],
      sections: [
        { path: "AGENTS.md", heading: "Shared Brain And Skills" },
        { path: "docs/for-users/features/token-and-cost-savings.md", heading: "Practical Rule" },
      ],
      paths: [
        "packaged-skills/auto-install/hive-assimilate/SKILL.md",
        "packaged-skills/auto-install/hive-capability-search/SKILL.md",
        "src/lib/services/chat/task-retrieval-context.ts",
      ],
      pathMaxChars: 14000,
    },
  },
  {
    id: "workflow-reuse",
    title: "Turn repeated work into a reusable workflow",
    task: "Convert a repeated multi-step HivemindOS task into reusable agent knowledge.",
    e2e: {
      outcome: {
        kind: "required-patterns",
        patterns: ["hive-capability-search", "hive-skill-fusion", "Skills/"],
        minimumRatio: 1,
      },
    },
    baseline: {
      label: "Naive packaged-skill catalog dump",
      paths: [
        "docs/for-users/features/hive-fusion.md",
        "docs/for-users/features/brain-vault-and-skills.md",
        "docs/for-users/packaged-skills",
        "packaged-skills/auto-install",
      ],
    },
    hive: {
      label: "Capability search and fusion skills only",
      snippets: [
        "Use hive-capability-search first, then compose either a skill, workflow, or AEON duty.",
        "Ask only when a choice changes quality, identity, cost, or external side effects.",
        "Store reusable procedures in Skills/<slug>/SKILL.md so future agents load a concise recipe.",
      ],
      paths: [
        "packaged-skills/auto-install/hive-capability-search/SKILL.md",
        "packaged-skills/auto-install/hive-skill-fusion/SKILL.md",
        "packaged-skills/auto-install/hive-workflow-fusion/SKILL.md",
        "packaged-skills/auto-install/hive-aeon-fusion/SKILL.md",
      ],
    },
  },
];

function toPosix(path) {
  return path.split(sep).join("/");
}

function parseArgs(argv) {
  const args = {
    json: false,
    scenario: "",
    pricePerMillion: DEFAULT_PRICE_PER_MILLION,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--scenario") {
      args.scenario = next || "";
      index += 1;
    } else if (arg === "--input-price-per-million") {
      args.pricePerMillion = Number(next || DEFAULT_PRICE_PER_MILLION);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!Number.isFinite(args.pricePerMillion) || args.pricePerMillion < 0) args.pricePerMillion = DEFAULT_PRICE_PER_MILLION;
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/benchmark-context-savings.mjs [--scenario ID] [--json] [--input-price-per-million N]

Compares estimated prompt/context token budgets for broad baseline context loading
versus targeted HivemindOS recall/capability/assimilation context packs.

Token counts are deterministic estimates based on text length. Use the price flag
for normalized cost comparison with your provider's current input-token price.

This is not a live E2E agent-run benchmark and does not read provider billing.`);
}

function readText(path, maxChars = Infinity) {
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) return "";
  const value = readFileSync(absolute, "utf8");
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n[truncated for benchmark]\n` : value;
}

function walkFiles(path, output = [], maxFiles = Infinity) {
  if (output.length >= maxFiles) return output;
  const absolute = join(ROOT, path);
  if (!existsSync(absolute)) return output;
  const current = statSync(absolute);
  if (current.isFile()) {
    if (READABLE_EXTENSIONS.has(extname(path))) output.push(path);
    return output;
  }
  if (!current.isDirectory()) return output;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (output.length >= maxFiles || SKIP_DIRS.has(entry.name)) continue;
    const child = toPosix(join(path, entry.name));
    if (entry.isDirectory()) {
      walkFiles(child, output, maxFiles);
    } else if (entry.isFile() && READABLE_EXTENSIONS.has(extname(entry.name))) {
      output.push(child);
    }
  }
  return output;
}

function extractSection(path, heading, maxChars = 5000) {
  const text = readText(path);
  if (!text) return "";
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^#{1,3}\\s+${escaped}\\s*$)([\\s\\S]*?)(?=^#{1,3}\\s+|$)`, "im");
  const match = text.match(pattern);
  const section = match ? `${match[1]}\n${match[2].trim()}\n` : "";
  return section.length > maxChars ? `${section.slice(0, maxChars)}\n[section truncated for benchmark]\n` : section;
}

export function buildContextPack(pack, task) {
  const chunks = [`Task:\n${task}\n`];
  for (const snippet of pack.snippets ?? []) {
    chunks.push(`Snippet:\n${snippet}\n`);
  }
  for (const section of pack.sections ?? []) {
    const text = extractSection(section.path, section.heading, section.maxChars);
    if (text) chunks.push(`Section ${section.path}#${section.heading}:\n${text}\n`);
  }
  const files = [];
  for (const sourcePath of pack.paths ?? []) {
    const absolute = join(ROOT, sourcePath);
    if (!existsSync(absolute)) continue;
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...walkFiles(sourcePath, [], pack.maxFilesPerDirectory ?? Infinity));
    } else if (stats.isFile() && READABLE_EXTENSIONS.has(extname(sourcePath))) {
      files.push(sourcePath);
    }
  }
  const uniqueFiles = [...new Set(files)].sort();
  for (const file of uniqueFiles) {
    chunks.push(`File ${file}:\n${readText(file, pack.pathMaxChars ?? Infinity)}\n`);
  }
  return {
    text: chunks.join("\n---\n"),
    files: uniqueFiles,
    snippets: pack.snippets?.length ?? 0,
    sections: pack.sections?.length ?? 0,
  };
}

export function estimateTokens(text) {
  if (!text.trim()) return 0;
  const charEstimate = Math.ceil(text.length / 4);
  const lexicalEstimate = (text.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? []).length;
  return Math.max(charEstimate, lexicalEstimate);
}

function cost(tokens, pricePerMillion) {
  return (tokens / 1_000_000) * pricePerMillion;
}

export function benchmarkScenario(scenario, pricePerMillion) {
  const baseline = buildContextPack(scenario.baseline, scenario.task);
  const hive = buildContextPack(scenario.hive, scenario.task);
  const baselineTokens = estimateTokens(baseline.text);
  const hiveTokens = estimateTokens(hive.text);
  const savedTokens = Math.max(0, baselineTokens - hiveTokens);
  const savedPercent = baselineTokens > 0 ? (savedTokens / baselineTokens) * 100 : 0;
  return {
    id: scenario.id,
    title: scenario.title,
    task: scenario.task,
    baselineLabel: scenario.baseline.label,
    hiveLabel: scenario.hive.label,
    baselineTokens,
    hiveTokens,
    savedTokens,
    savedPercent,
    baselineCost: cost(baselineTokens, pricePerMillion),
    hiveCost: cost(hiveTokens, pricePerMillion),
    savedCost: cost(savedTokens, pricePerMillion),
    baselineFiles: baseline.files.length,
    hiveFiles: hive.files.length,
    hiveSnippets: hive.snippets,
    hiveSections: hive.sections,
  };
}

export function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

function printTable(results, pricePerMillion) {
  console.log("HivemindOS context savings benchmark");
  console.log("Type: deterministic context-budget estimate, not live E2E agent-run/provider billing.");
  console.log(`Estimator: max(characters / 4, lexical tokens). Cost normalized at $${pricePerMillion}/1M input tokens.\n`);
  const header = [
    "Scenario",
    "Baseline ctx",
    "Hive ctx",
    "Saved",
    "Saved %",
    "Cost saved",
  ];
  const rows = results.map((result) => [
    result.id,
    formatNumber(result.baselineTokens),
    formatNumber(result.hiveTokens),
    formatNumber(result.savedTokens),
    `${result.savedPercent.toFixed(1)}%`,
    `$${result.savedCost.toFixed(4)}`,
  ]);
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => row[index].length)));
  const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(row));
  const totals = results.reduce((acc, result) => {
    acc.baselineTokens += result.baselineTokens;
    acc.hiveTokens += result.hiveTokens;
    acc.savedTokens += result.savedTokens;
    acc.savedCost += result.savedCost;
    return acc;
  }, { baselineTokens: 0, hiveTokens: 0, savedTokens: 0, savedCost: 0 });
  const totalSavedPercent = totals.baselineTokens > 0 ? (totals.savedTokens / totals.baselineTokens) * 100 : 0;
  console.log("");
  console.log(`Total baseline: ${formatNumber(totals.baselineTokens)} estimated tokens`);
  console.log(`Total hive:     ${formatNumber(totals.hiveTokens)} estimated tokens`);
  console.log(`Total saved:    ${formatNumber(totals.savedTokens)} estimated tokens (${totalSavedPercent.toFixed(1)}%, $${totals.savedCost.toFixed(4)} at normalized price)`);
  console.log("\nNotes:");
  console.log("- This benchmarks context-pack size, not model reasoning quality or final provider invoices.");
  console.log("- Baseline packs intentionally model broad context loading; Hive packs model targeted recall, capability search, and assimilation evidence.");
  console.log("- Pass --input-price-per-million with a current provider price for dollar estimates.");
}

function main() {
  const args = parseArgs(process.argv);
  const selected = args.scenario
    ? scenarios.filter((scenario) => scenario.id === args.scenario)
    : scenarios;
  if (!selected.length) {
    throw new Error(`No benchmark scenario matched ${args.scenario}. Available: ${scenarios.map((scenario) => scenario.id).join(", ")}`);
  }
  const results = selected.map((scenario) => benchmarkScenario(scenario, args.pricePerMillion));
  if (args.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      benchmarkType: "deterministic-context-budget",
      isLiveE2EAgentRun: false,
      usesProviderBilling: false,
      estimator: "max(characters / 4, lexical tokens)",
      inputPricePerMillion: args.pricePerMillion,
      results,
    }, null, 2));
    return;
  }
  printTable(results, args.pricePerMillion);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`benchmark-context-savings: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
