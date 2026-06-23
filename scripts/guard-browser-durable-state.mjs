#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const STORAGE_RE = /\b(localStorage|sessionStorage|indexedDB)\b/;
const ALLOW_PRAGMA_RE = /guard:allow-browser-storage\s+-\s+\S+/;
const ALLOW_PRAGMA_ANY_RE = /guard:allow-browser-storage/;

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root ?? process.cwd());
const baselinePath = path.resolve(
  root,
  args.baseline ?? "scripts/browser-durable-state-baseline.json",
);
const baseline = readBaseline(baselinePath);
const issues = [];

for (const file of scanFiles(root, args.includeUntracked === true)) {
  const relativePath = toPosix(path.relative(root, file));
  const lines = readFileSync(file, "utf8").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const normalizedLine = normalizeLine(lines[index]);
    if (!normalizedLine || !STORAGE_RE.test(normalizedLine)) continue;

    const nearby = lines
      .slice(Math.max(0, index - 2), index + 1)
      .map(normalizeForPragma)
      .join("\n");
    if (ALLOW_PRAGMA_RE.test(nearby)) continue;
    if (ALLOW_PRAGMA_ANY_RE.test(nearby)) {
      issues.push({
        file: relativePath,
        line: index + 1,
        reason:
          "allow pragma must include a short reason, e.g. guard:allow-browser-storage - disposable per-tab draft",
      });
      continue;
    }

    if (baseline.has(baselineKey(relativePath, normalizedLine))) continue;

    issues.push({
      file: relativePath,
      line: index + 1,
      reason:
        "browser storage is not allowed for durable HivemindOS state without a reasoned disposable-storage pragma",
    });
  }
}

if (issues.length > 0) {
  console.error("Browser durable-state guard failed:");
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line}: ${issue.reason}`);
  }
  console.error(
    "Use /api/dashboard/state, dashboard-state-client, or a server-side store for durable state.",
  );
  process.exitCode = 1;
} else {
  console.log("Browser durable-state guard passed.");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--root") {
      parsed.root = values[index + 1];
      index += 1;
    } else if (values[index] === "--baseline") {
      parsed.baseline = values[index + 1];
      index += 1;
    } else if (values[index] === "--include-untracked") {
      parsed.includeUntracked = true;
    }
  }
  return parsed;
}

function readBaseline(file) {
  if (!existsSync(file)) return new Set();
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${file} must contain an entries array`);
  }
  return new Set(
    parsed.entries.map((entry) =>
      baselineKey(toPosix(entry.file), normalizeLine(entry.line)),
    ),
  );
}

function scanFiles(projectRoot, includeUntracked) {
  if (!includeUntracked && isGitRepo(projectRoot)) {
    const result = spawnSync("git", ["ls-files", "src/**/*.ts", "src/**/*.tsx"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    if (result.status === 0) {
      return result.stdout
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => path.join(projectRoot, value))
        .filter((file) => existsSync(file));
    }
  }
  const srcRoot = path.join(projectRoot, "src");
  return existsSync(srcRoot) ? walkSourceFiles(srcRoot) : [];
}

function isGitRepo(projectRoot) {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function walkSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) return "";
  return trimmed.replace(/\s+/g, " ");
}

function normalizeForPragma(line) {
  return String(line ?? "").trim().replace(/\s+/g, " ");
}

function baselineKey(file, line) {
  return `${file}\n${line}`;
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}
