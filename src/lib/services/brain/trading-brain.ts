import { constants } from "fs";
import { access, mkdir, readdir, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

const SERVICE_NOTE = "Trading Brain.md";
const MODULE_ROOT = "TRADING-BRAIN";

type TradingBrainInput = {
  vaultPath?: string;
  brainServicesFolder?: string;
};

export type TradingBrainStatus = {
  ok: boolean;
  installed: boolean;
  vaultPath: string;
  moduleRoot: string;
  serviceNotePath: string;
  folders: Array<{ path: string; exists: boolean }>;
  files: Array<{ path: string; exists: boolean }>;
  counts: {
    openTrades: number;
    closedTrades: number;
    weeklyAnalyses: number;
    monthlyEdgeReports: number;
    patternReports: number;
    marketBriefs: number;
    preTradeBriefs: number;
    journalEntries: number;
  };
  error?: string;
};

const REQUIRED_FOLDERS = [
  "trades/open",
  "trades/closed",
  "trades/watchlist",
  "analysis/performance/weekly",
  "analysis/performance/monthly",
  "analysis/patterns",
  "analysis/edge-reports",
  "intelligence/instruments",
  "intelligence/sectors",
  "intelligence/market-conditions",
  "pre-trade",
  "journal",
  "system/prompts",
  "system/templates",
] as const;

const REQUIRED_FILES = [
  "system/CLAUDE.md",
  "system/AGENTS.md",
  "system/runtime-instructions.md",
  "system/edge-definition.md",
  "system/rules.md",
  "system/templates/trade-open.md",
  "system/templates/trade-close.md",
  "system/templates/daily-trading-journal.md",
  "system/prompts/weekly-performance-analyzer.md",
  "system/prompts/monthly-edge-report.md",
  "system/prompts/realtime-pattern-alert.md",
  "system/prompts/pre-trade-intelligence.md",
  "system/prompts/weekly-market-intelligence.md",
] as const;

function safeVaultFolder(folder: string | undefined, fallback: string) {
  const value = (folder || fallback).trim();
  if (!value) return fallback;
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Trading Brain folders must be relative paths inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function brainServicesRoot(vaultPath: string, folder?: string) {
  return join(vaultPath, safeVaultFolder(folder, DEFAULT_SHARED_VAULT.brainServicesFolder));
}

function moduleRoot(vaultPath: string) {
  return join(vaultPath, MODULE_ROOT);
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function countMarkdownFiles(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const nested: number[] = await Promise.all(entries.map(async (entry): Promise<number> => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return countMarkdownFiles(path);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".md") ? 1 : 0;
  }));
  return nested.reduce((sum: number, count: number) => sum + count, 0);
}

function tradingBrainFiles(now: string) {
  return new Map<string, string>([
    ["system/CLAUDE.md", [
      "# Trading Brain - CLAUDE.md",
      "",
      "Claude-specific entrypoint. Agent-agnostic operating instructions live in `runtime-instructions.md`; keep this file as a compatibility adapter for Claude Desktop, Claude Code, and Claude MCP setups.",
      "",
      "## Trader Profile",
      "Name: [YOUR NAME]",
      "Trading style: [DAY/SWING/POSITION]",
      "Primary markets: [CRYPTO/EQUITIES/FUTURES/FX]",
      "Account size: [APPROXIMATE RANGE]",
      "Trading frequency: [APPROXIMATE TRADES PER WEEK]",
      "Experience: [YEARS TRADING]",
      "",
      "## My Strategy",
      "[Describe your strategy in specific terms]",
      "[What setups do you look for]",
      "[What conditions must be present for a valid setup]",
      "[What conditions invalidate a setup]",
      "",
      "## My Edge Definition",
      "Current hypothesis: [YOUR EDGE HYPOTHESIS]",
      "Supporting evidence: [WHAT YOUR HISTORY SHOWS]",
      "Contrary evidence: [WHERE THE HYPOTHESIS HAS FAILED]",
      "",
      "## My Known Weaknesses",
      "- [WEAKNESS 1 WITH EVIDENCE]",
      "- [WEAKNESS 2 WITH EVIDENCE]",
      "",
      "## Performance Benchmarks",
      "Win rate target: [YOUR TARGET]",
      "Average R target: [YOUR TARGET]",
      "Maximum drawdown tolerance: [YOUR LIMIT]",
      "Best performing conditions: [WHAT YOU KNOW SO FAR]",
      "Worst performing conditions: [WHAT YOU KNOW SO FAR]",
      "",
      "## Rules",
      "Rule 1: [RULE]",
      "Rule 2: [RULE]",
      "Rule 3: [RULE]",
      "",
      "## Analysis Preferences",
      "[How you want analysis presented]",
      "[What metrics matter most]",
      "[What questions you most want answered]",
      "",
    ].join("\n")],
    ["system/AGENTS.md", [
      "# Trading Brain - AGENTS.md",
      "",
      "These instructions are for any agent runtime connected to this vault: Hermes, Aeon, OpenClaw, Codex, OpenAI-compatible runtimes, Claude, or another local agent.",
      "",
      "Before making durable changes in this module, read `runtime-instructions.md`, `edge-definition.md`, and `rules.md`.",
      "",
      "Do not place trades, sign transactions, move funds, connect brokerage accounts, or treat analysis as financial advice. This module is a local evidence and journaling system only.",
      "",
      "Preserve the structured frontmatter in trade notes so every runtime can extract consistent data.",
      "",
    ].join("\n")],
    ["system/runtime-instructions.md", [
      "# Trading Brain Runtime Instructions",
      "",
      "Use this module as a local Obsidian trading brain for structured trade capture, performance analysis, pre-trade historical context, market intelligence, and emotional pattern review.",
      "",
      "## Runtime Contract",
      "- Read `TRADING-BRAIN/system/edge-definition.md` and `TRADING-BRAIN/system/rules.md` before analyzing trades.",
      "- Read trade notes from `TRADING-BRAIN/trades/open/` and `TRADING-BRAIN/trades/closed/`.",
      "- Save generated reports only into the matching `TRADING-BRAIN/analysis/`, `TRADING-BRAIN/intelligence/`, `TRADING-BRAIN/pre-trade/`, or `TRADING-BRAIN/journal/` folder.",
      "- Keep all output in markdown with clear evidence links to the trade notes or journal entries used.",
      "- Frame pre-trade output as historical decision support, not as a buy/sell recommendation.",
      "- Never place trades, execute orders, sign transactions, or request brokerage credentials.",
      "",
      "## Core Questions",
      "- What conditions consistently produce positive expectancy?",
      "- Which setups, days, sessions, market regimes, or emotional states correlate with losses?",
      "- Which rules are protecting the trader versus which rules appear unnecessarily restrictive?",
      "- Does the current trade match past winners, past losers, or a known weakness pattern?",
      "",
      "## Preferred Metrics",
      "- Total trades, win rate, average winner, average loser, expectancy, profit factor, total P&L, total R, average R, best/worst setup type, rule adherence, and emotional-state correlation.",
      "",
    ].join("\n")],
    ["system/edge-definition.md", [
      "# Edge Definition",
      "",
      "## Current Hypothesis",
      "[Where you believe your repeatable edge lives.]",
      "",
      "## Supporting Evidence",
      "- [Evidence from closed trades and analysis reports.]",
      "",
      "## Contrary Evidence",
      "- [Conditions where the edge has failed.]",
      "",
      "## Update Log",
      `- ${now}: Trading Brain scaffold created.`,
      "",
    ].join("\n")],
    ["system/rules.md", [
      "# Trading Rules",
      "",
      "## Non-Negotiable Rules",
      "1. [RULE]",
      "2. [RULE]",
      "3. [RULE]",
      "",
      "## Rule Audit Notes",
      "Each closed trade should state whether these rules were followed and why.",
      "",
    ].join("\n")],
    ["system/templates/trade-open.md", [
      "---",
      "type: trade",
      "status: open",
      "ticker: [TICKER]",
      "direction: [LONG/SHORT]",
      "entry_date: [YYYY-MM-DD]",
      "entry_time: [HH:MM]",
      "entry_price: [PRICE]",
      "position_size: [SIZE]",
      "account_percentage: [% OF ACCOUNT]",
      "setup_type: [YOUR SETUP NAME]",
      "strategy: [YOUR STRATEGY NAME]",
      "timeframe: [PRIMARY TIMEFRAME]",
      "market_condition: [TRENDING/RANGING/VOLATILE/CHOPPY]",
      "thesis_confidence: [1-10]",
      "tags:",
      "  - trading",
      "  - trade",
      "---",
      "",
      "# [TICKER] - [DIRECTION] - [DATE]",
      "",
      "## Setup",
      "[Describe exactly what made this a valid entry.]",
      "",
      "## Thesis",
      "[Why do you expect this trade to work?]",
      "",
      "## Plan",
      "Entry: [PRICE]",
      "Stop loss: [PRICE] - R risk: [$ AMOUNT]",
      "Target 1: [PRICE] - R reward: [R RATIO]",
      "Target 2: [PRICE] - R reward: [R RATIO]",
      "Max hold time: [DURATION]",
      "",
      "## Risk Check",
      "Rule 1 compliance: [YES/NO - WHY]",
      "Rule 2 compliance: [YES/NO - WHY]",
      "Rule 3 compliance: [YES/NO - WHY]",
      "",
      "## Mental State",
      "Energy level: [1-10]",
      "Focus level: [1-10]",
      "Emotional state: [CALM/ANXIOUS/OVERCONFIDENT/FRUSTRATED/NEUTRAL]",
      "External pressures: [ANYTHING AFFECTING FOCUS]",
      "Confidence in setup: [1-10]",
      "",
    ].join("\n")],
    ["system/templates/trade-close.md", [
      "## Close",
      "",
      "close_date: [YYYY-MM-DD]",
      "close_time: [HH:MM]",
      "close_price: [PRICE]",
      "result_r: [R MULTIPLE - e.g. +2.3R or -1R]",
      "result_pnl: [$ AMOUNT]",
      "hold_duration: [HOURS/DAYS]",
      "exit_reason: [TARGET HIT/STOP HIT/MANUAL EXIT/TIME STOP]",
      "",
      "### What Happened",
      "[What did price do versus what you expected?]",
      "",
      "### Execution Quality",
      "Did the trade follow the plan: [YES/PARTIALLY/NO]",
      "If no: [What changed and why did you deviate]",
      "",
      "### What I Learned",
      "[One specific insight from this trade.]",
      "",
      "### Rule Adherence",
      "[Which rules were followed or broken and why.]",
      "",
    ].join("\n")],
    ["system/templates/daily-trading-journal.md", [
      "# Trading Journal - [DATE]",
      "",
      "## Morning State",
      "Energy level: [1-10]",
      "Focus level: [1-10]",
      "Emotional state: [CALM/ANXIOUS/OVERCONFIDENT/FRUSTRATED/NEUTRAL]",
      "External pressures today: [ANYTHING AFFECTING FOCUS]",
      "Market attitude: [BULLISH/BEARISH/NEUTRAL/UNCERTAIN]",
      "",
      "## During Session",
      "Notable emotional moments: [ANY SIGNIFICANT EMOTIONAL REACTIONS]",
      "Decision quality: [FELT IN CONTROL/REACTIVE/DISCIPLINED/IMPULSIVE]",
      "",
      "## End of Day",
      "Satisfaction with execution: [1-10]",
      "Biggest mental challenge today: [WHAT TESTED YOU]",
      "One thing to do differently tomorrow: [SPECIFIC CHANGE]",
      "",
    ].join("\n")],
    ["system/prompts/weekly-performance-analyzer.md", [
      "# Weekly Performance Analyzer",
      "",
      "Run every Sunday at 7PM.",
      "",
      "Read all closed trade files from the past 7 days in `TRADING-BRAIN/trades/closed/`.",
      "Also read `TRADING-BRAIN/system/CLAUDE.md` for strategy, rules, and current edge definition.",
      "",
      "Produce: raw performance, pattern analysis, rule adherence audit, setup performance breakdown, edge signal, and next week focus.",
      "",
      "Required metrics: total trades, win rate, average winner, average loser, expectancy, total P&L in dollars and R, profit factor, best/worst setup conditions.",
      "",
      "Save to `TRADING-BRAIN/analysis/performance/weekly/[DATE]-weekly-performance.md`.",
      "",
    ].join("\n")],
    ["system/prompts/monthly-edge-report.md", [
      "# Monthly Edge Report",
      "",
      "Run on the first of every month.",
      "",
      "Read weekly performance analyses and closed trades from the past 30 days, plus `TRADING-BRAIN/system/CLAUDE.md`.",
      "",
      "Produce: statistical performance summary, edge validation, weakness confirmation/refutation, rule effectiveness analysis, optimal conditions analysis, emotional performance correlation, and an updated edge definition.",
      "",
      "Save to `TRADING-BRAIN/analysis/edge-reports/[DATE]-edge-analysis.md`.",
      "",
    ].join("\n")],
    ["system/prompts/realtime-pattern-alert.md", [
      "# Real-Time Pattern Alert",
      "",
      "Run whenever a trade is closed.",
      "",
      "Inputs: `[TRADE FILE PATH]`.",
      "",
      "Read the closed trade note, `TRADING-BRAIN/system/CLAUDE.md`, and the last 10 closed trades. If the trade matches a known weakness or failure pattern, create `TRADING-BRAIN/analysis/patterns/PATTERN-ALERT-[DATE]-[TICKER].md`.",
      "",
      "Include: matched pattern, how this trade fits, historical outcome of the pattern, and implications for future setups.",
      "",
    ].join("\n")],
    ["system/prompts/pre-trade-intelligence.md", [
      "# Pre-Trade Intelligence",
      "",
      "Use before entering a significant trade.",
      "",
      "Inputs: ticker, direction, setup, market condition, timeframe, and optional mental state.",
      "",
      "Read the Trading Brain vault and answer: historical precedent, pattern match, rule check, market context match, mental state consideration, and verdict.",
      "",
      "The verdict must be framed as historical decision support, not a recommendation.",
      "",
    ].join("\n")],
    ["system/prompts/weekly-market-intelligence.md", [
      "# Weekly Market Intelligence",
      "",
      "Run every Sunday morning before performance analysis.",
      "",
      "Search for market developments relevant to the markets named in `TRADING-BRAIN/system/CLAUDE.md`.",
      "",
      "Produce: macro context, sector rotation, volatility regime, key levels, upcoming catalysts, and trading environment assessment.",
      "",
      "Save to `TRADING-BRAIN/intelligence/market-conditions/[DATE]-market-context.md`.",
      "",
    ].join("\n")],
  ]);
}

async function writeIfMissing(path: string, content: string) {
  if (await exists(path)) return false;
  await writeFile(path, content, "utf8");
  return true;
}

async function writeServiceNote(input: TradingBrainInput, summary: string) {
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const root = brainServicesRoot(vault, input.brainServicesFolder);
  await mkdir(root, { recursive: true });
  const now = new Date().toISOString();
  const notePath = join(root, SERVICE_NOTE);
  const body = [
    "---",
    "type: brain-service",
    "service: trading-brain",
    "enabled: true",
    `moduleRoot: ${JSON.stringify(MODULE_ROOT)}`,
    `updatedAt: ${JSON.stringify(now)}`,
    "---",
    "",
    "# Trading Brain",
    "",
    "Optional HivemindOS brain module for structured trade capture, performance analysis, pre-trade intelligence, market context, and emotional pattern tracking.",
    "",
    "## Managed Paths",
    "",
    `- Module root: \`${MODULE_ROOT}\``,
    "- Trade capture: `trades/open`, `trades/closed`, `trades/watchlist`",
    "- Analysis: `analysis/performance`, `analysis/patterns`, `analysis/edge-reports`",
    "- Intelligence: `intelligence/instruments`, `intelligence/sectors`, `intelligence/market-conditions`",
    "- Prompts and templates: `system/prompts`, `system/templates`",
    "",
    "## Latest Dashboard Event",
    "",
    `- ${now}: ${summary}`,
    "",
    "This module stores local markdown only. It does not place trades, connect brokerage accounts, or store secrets.",
    "",
  ].join("\n");
  await writeFile(notePath, body, "utf8");
  return { path: relative(vault, notePath), absolutePath: notePath };
}

export async function getTradingBrainStatus(input: TradingBrainInput = {}): Promise<TradingBrainStatus> {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const root = moduleRoot(vault);
  const serviceNotePath = join(brainServicesRoot(vault, input.brainServicesFolder), SERVICE_NOTE);
  // Every check is an independent fs walk — run them all together.
  const [folders, files, serviceNoteExists, counts] = await Promise.all([
    Promise.all(REQUIRED_FOLDERS.map(async (folder) => ({
      path: `${MODULE_ROOT}/${folder}`,
      exists: await exists(join(root, folder)),
    }))),
    Promise.all(REQUIRED_FILES.map(async (file) => ({
      path: `${MODULE_ROOT}/${file}`,
      exists: await exists(join(root, file)),
    }))),
    exists(serviceNotePath),
    Promise.all([
      countMarkdownFiles(join(root, "trades/open")),
      countMarkdownFiles(join(root, "trades/closed")),
      countMarkdownFiles(join(root, "analysis/performance/weekly")),
      countMarkdownFiles(join(root, "analysis/edge-reports")),
      countMarkdownFiles(join(root, "analysis/patterns")),
      countMarkdownFiles(join(root, "intelligence/market-conditions")),
      countMarkdownFiles(join(root, "pre-trade")),
      countMarkdownFiles(join(root, "journal")),
    ]).then(([openTrades, closedTrades, weeklyAnalyses, monthlyEdgeReports, patternReports, marketBriefs, preTradeBriefs, journalEntries]) => ({
      openTrades, closedTrades, weeklyAnalyses, monthlyEdgeReports, patternReports, marketBriefs, preTradeBriefs, journalEntries,
    })),
  ]);
  const installed = folders.every((folder) => folder.exists) && files.every((file) => file.exists) && serviceNoteExists;
  return {
    ok: installed,
    installed,
    vaultPath: vault,
    moduleRoot: MODULE_ROOT,
    serviceNotePath: relative(vault, serviceNotePath),
    folders,
    files,
    counts,
    error: installed ? undefined : "Trading Brain has not been installed in the shared vault yet.",
  };
}

export async function installTradingBrain(input: TradingBrainInput = {}) {
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const root = moduleRoot(vault);
  await mkdir(root, { recursive: true });
  await Promise.all(REQUIRED_FOLDERS.map((folder) => mkdir(join(root, folder), { recursive: true })));

  const now = new Date().toISOString();
  const files = tradingBrainFiles(now);
  const written: string[] = [];
  for (const [file, content] of files.entries()) {
    const absolutePath = join(root, file);
    await mkdir(dirname(absolutePath), { recursive: true });
    if (await writeIfMissing(absolutePath, content)) written.push(`${MODULE_ROOT}/${file}`);
  }

  const serviceNote = await writeServiceNote(input, `Installed Trading Brain scaffold with ${written.length} new file${written.length === 1 ? "" : "s"}.`);
  return {
    status: await getTradingBrainStatus(input),
    written,
    serviceNote,
  };
}
