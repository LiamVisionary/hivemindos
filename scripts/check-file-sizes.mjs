#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MAX_LINES = 1500;
const root = process.cwd();

const ignoredDirectories = new Set([
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
]);

const ignoredRelativeDirectories = new Set([
  "src-tauri/gen",
  "src-tauri/static",
  "src-tauri/target",
]);

const ignoredFiles = new Set([
  "CHANGELOG.md",
  "ASSIMILATION_LOG.md",
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
  ["scripts/agent-telemetry-collector.mjs", 4281],
  ["src/app/api/chat/agent-runtime/route.ts", 1767],
  ["src/app/chat.module.css", 3685],
  ["src/app/fleet.module.css", 4360],
  ["src/app/kanban-board.module.css", 3735],
  ["src/app/vault.module.css", 1568],
  ["src/features/dashboard/DashboardApp.tsx", 2756],
  ["src/features/dashboard/views/AeonAutopilotPanel.tsx", 3857],
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
