#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const MAX_LINES = 1500;
const root = process.cwd();

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
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
      if (!ignoredDirectories.has(entry.name)) {
        walk(path.join(directory, entry.name), results);
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

if (oversizedFiles.length > 0) {
  console.error(`Files over ${MAX_LINES} lines:`);

  for (const file of oversizedFiles) {
    console.error(`- ${file.relativePath} (${file.lines} lines)`);
  }

  process.exitCode = 1;
} else {
  console.log(`All checked files are ${MAX_LINES} lines or fewer.`);
}
