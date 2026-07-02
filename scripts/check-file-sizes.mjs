#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MAX_LINES = 1500;
const root = process.cwd();

const ignoredDirectories = new Set([
  ".evo",
  ".git",
  ".next",
  ".next-tauri",
  ".next-tauri-build",
  ".next-tauri-static-build",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "promo-videos",
  "remotion",
]);

const ignoredRelativeDirectories = new Set([
  "apps/zimage-mobile-tauri/src-tauri/gen",
  "src-tauri/gen",
  "src-tauri/static",
  "src-tauri/target",
]);

const ignoredFiles = new Set([
  "CHANGELOG.md",
  "ASSIMILATION_LOG.md",
  "agents-lock.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const checkedExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".scss",
  ".ts",
  ".tsx",
]);

const legacyOversizedAllowances = new Map([
  ["src/app/api/chat/agent-runtime/route.ts", 580],
  ["src/app/chat.module.css", 3813],
  ["src/app/fleet.module.css", 4722],
  ["src/app/kanban-board.module.css", 4528],
  ["src/app/vault.module.css", 1568],
  ["src/features/dashboard/DashboardApp.tsx", 4724],
  ["src/lib/services/hive-actions/catalog.ts", 1633],
  ["src/features/dashboard/views/AeonAutopilotPanel.tsx", 3857],
  // Ratchet re-baselined 2026-07-02: watermarks set to then-current line counts
  // (files had silently grown past the old allowances while the gate wasn't run
  // in CI). Shrinking a file should lower its entry; growth fails the gate.
  ["scripts/agent-telemetry-collector.mjs", 8118],
  // 2026-07-02: +18 for the non-string task.result/body read+write coercion fix
  // (one poisoned task was 400ing every /api/kanban read).
  ["src/lib/services/kanban/local-kanban-store.ts", 2433],
  ["src/features/dashboard/hooks/use-dashboard-derived-state.tsx", 2244],
  ["src/features/dashboard/views/chat/HiveChatView.module.css", 1802],
  ["src/lib/services/obsidian/agent-memory/core.ts", 1850],
  ["src/components/wallets-drop-in/WalletsView.tsx", 1850],
  ["src/app/globals.css", 1719],
  ["src/lib/services/obsidian/brain-skills.ts", 1625],
  ["src/lib/services/context-index.ts", 1680],
  ["src/features/dashboard/hooks/use-status-chat-input-controller.tsx", 1660],
  ["src/features/dashboard/views/chat/AgentSettingsModal.tsx", 1640],
  ["src/components/fleet/fleet-tokens.module.css", 1540],
  ["src/features/dashboard/views/chat/UsePodSetup.module.css", 1540],
  ["src/features/dashboard/hooks/use-miroshark-brain-controller.tsx", 1580],
]);

function isIgnoredDirectory(directory) {
  const relativeDirectory = path.relative(root, directory);
  if (ignoredRelativeDirectories.has(relativeDirectory)) {
    return true;
  }

  return ignoredDirectories.has(path.basename(directory));
}

function isCheckedFile(filePath) {
  const basename = path.basename(filePath);

  if (ignoredFiles.has(basename)) {
    return false;
  }

  return checkedExtensions.has(path.extname(filePath));
}

function lineCount(filePath) {
  const source = readFileSync(filePath, "utf8");

  if (source.length === 0) {
    return 0;
  }

  return source.split(/\r\n|\r|\n/).length;
}

function walk(directory, results) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const entryPath = path.join(directory, entry.name);
      if (!isIgnoredDirectory(entryPath)) {
        walk(entryPath, results);
      }

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(directory, entry.name);

    if (!isCheckedFile(filePath)) {
      continue;
    }

    const stats = statSync(filePath);

    if (stats.size === 0) {
      continue;
    }

    const lines = lineCount(filePath);

    if (lines > MAX_LINES) {
      results.push({
        lines,
        relativePath: path.relative(root, filePath),
      });
    }
  }
}

const oversizedFiles = [];
walk(root, oversizedFiles);
oversizedFiles.sort((left, right) => right.lines - left.lines);

const newOversizedFiles = [];
const legacyOversizedFiles = [];

for (const file of oversizedFiles) {
  const allowedLines = legacyOversizedAllowances.get(file.relativePath);
  if (allowedLines && file.lines <= allowedLines) {
    legacyOversizedFiles.push({ ...file, allowedLines });
    continue;
  }

  newOversizedFiles.push({
    ...file,
    allowedLines,
  });
}

if (newOversizedFiles.length > 0) {
  console.error(`Files over ${MAX_LINES} lines:`);

  for (const file of newOversizedFiles) {
    const allowance = file.allowedLines ? `, legacy allowance ${file.allowedLines}` : "";
    console.error(`- ${file.relativePath} (${file.lines} lines${allowance})`);
  }

  process.exitCode = 1;
} else {
  console.log(`All checked files are ${MAX_LINES} lines or fewer.`);
  if (legacyOversizedFiles.length > 0) {
    console.log(`Legacy oversized files are within their no-growth allowance:`);
    for (const file of legacyOversizedFiles) {
      console.log(`- ${file.relativePath} (${file.lines}/${file.allowedLines} lines)`);
    }
  }
}
