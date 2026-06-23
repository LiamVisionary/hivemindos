#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const MUTATING_METHOD_RE =
  /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\b/;
const ACTION_SEGMENTS = new Set([
  "send",
  "create",
  "update",
  "delete",
  "run",
  "sync",
  "prepare",
  "review",
  "execute",
  "install",
  "connect",
  "request",
  "provision",
  "deploy",
  "start",
  "stop",
  "mint",
  "trade",
  "swap",
  "transfer",
  "pay",
  "buy",
  "sell",
  "compile",
  "fix",
  "scan",
  "submit",
  "apply",
  "approve",
  "reject",
]);
const ACTION_CONTENT_RE =
  /(body\.(action|kind|intent)|action\s*[:=]|case\s+["'](?:create|update|delete|run|send|sync|prepare|review|execute|install|connect|request|provision|deploy|start|stop|mint|trade|swap|transfer|pay|buy|sell|compile|fix|scan|submit|apply|approve|reject)["'])/i;
const ALLOW_PRAGMA_RE = /guard:allow-hive-action-route\s+-\s+\S+/;
const ALLOW_PRAGMA_ANY_RE = /guard:allow-hive-action-route/;
const IGNORED_ROUTE_RE = [
  /^src\/app\/api\/auth\//,
  /\/callback\/route\.ts$/,
  /\/oauth\/route\.ts$/,
  /\/webhook(s)?\/route\.ts$/,
  /\/health\/route\.ts$/,
  /\/status\/route\.ts$/,
  /\/stream\/route\.ts$/,
  /\/snapshot\/route\.ts$/,
];

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root ?? process.cwd());
const baselinePath = path.resolve(
  root,
  args.baseline ?? "scripts/hive-action-route-drift-baseline.json",
);

const baseline = readBaseline(baselinePath);
const registeredRoutes = await loadHiveActionRoutes(root);
const routeFiles = listRouteFiles(root, args.includeUntracked === true);
const issues = [];
let candidateCount = 0;

for (const file of routeFiles) {
  const relativePath = toPosix(path.relative(root, file));
  if (IGNORED_ROUTE_RE.some((pattern) => pattern.test(relativePath))) continue;

  const source = readFileSync(file, "utf8");
  if (!MUTATING_METHOD_RE.test(source)) continue;

  const routePath = routePathFromFile(relativePath);
  const signal = actionSignal(relativePath, source);
  if (!signal) continue;

  candidateCount += 1;

  if (ALLOW_PRAGMA_RE.test(source)) continue;
  if (ALLOW_PRAGMA_ANY_RE.test(source)) {
    issues.push({
      path: relativePath,
      route: routePath,
      reason:
        "allow pragma must include a short reason, e.g. guard:allow-hive-action-route - OAuth callback",
    });
    continue;
  }
  if (registeredRoutes.has(routePath)) continue;
  if (baseline.has(relativePath)) continue;

  issues.push({
    path: relativePath,
    route: routePath,
    reason:
      "mutating action-like API route is not represented in the Hive action registry",
  });
}

if (issues.length > 0) {
  console.error("Hive action route drift guard failed:");
  for (const issue of issues) {
    console.error(`- ${issue.path} (${issue.route}): ${issue.reason}`);
  }
  console.error(
    "Model the route in src/lib/services/hive-actions/catalog.ts, add a reasoned guard:allow-hive-action-route pragma, or update the baseline intentionally.",
  );
  process.exitCode = 1;
} else {
  console.log(
    `Hive action route drift guard passed: ${candidateCount} action-like route(s), ${registeredRoutes.size} registered Hive action route(s).`,
  );
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--root") {
      parsed.root = values[index + 1];
      index += 1;
    } else if (value === "--baseline") {
      parsed.baseline = values[index + 1];
      index += 1;
    } else if (value === "--include-untracked") {
      parsed.includeUntracked = true;
    }
  }
  return parsed;
}

function readBaseline(file) {
  if (!existsSync(file)) return new Set();
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.routes)) {
    throw new Error(`${file} must contain a routes array`);
  }
  return new Set(parsed.routes.map((route) => toPosix(route)));
}

async function loadHiveActionRoutes(projectRoot) {
  const indexPath = path.join(
    projectRoot,
    "src/lib/services/hive-actions/index.ts",
  );
  if (!existsSync(indexPath)) return new Set();
  try {
    const actionModule = await import(pathToFileURL(indexPath).href);
    const actions = actionModule.listHiveActions?.() ?? [];
    return new Set(
      actions
        .map((action) => action?.contextIndex?.route)
        .filter((route) => typeof route === "string" && route.startsWith("/api/")),
    );
  } catch {
    return new Set();
  }
}

function listRouteFiles(projectRoot, includeUntracked) {
  const apiRoot = path.join(projectRoot, "src/app/api");
  if (!existsSync(apiRoot)) return [];
  if (!includeUntracked && isGitRepo(projectRoot)) {
    const result = spawnSync("git", ["ls-files", "src/app/api/**/route.ts"], {
      cwd: projectRoot,
      encoding: "utf8",
    });
    if (result.status === 0) {
      return result.stdout
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => path.join(projectRoot, value));
    }
  }
  return walkRouteFiles(apiRoot);
}

function isGitRepo(projectRoot) {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function walkRouteFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkRouteFiles(fullPath));
    } else if (entry.name === "route.ts") {
      files.push(fullPath);
    }
  }
  return files;
}

function actionSignal(relativePath, source) {
  const segments = relativePath
    .replace(/^src\/app\/api\//, "")
    .replace(/\/route\.ts$/, "")
    .split("/");
  const pathHit = segments.some((segment) =>
    ACTION_SEGMENTS.has(segment.replace(/^\[|\]$/g, "").toLowerCase()),
  );
  return pathHit || ACTION_CONTENT_RE.test(source);
}

function routePathFromFile(relativePath) {
  return `/${relativePath
    .replace(/^src\/app\//, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\/index$/, "")}`;
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}
