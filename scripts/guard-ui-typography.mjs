#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CSS_FILE_RE = /\.css$/;
const JSX_FILE_RE = /\.[jt]sx$/;
const CSS_RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
const CONTROL_SELECTOR_RE = /(?:^|[\s>+~,])button(?:[\s>+~,:.#\[]|$)|\.[A-Za-z0-9_-]*(?:btn|button|cta)[A-Za-z0-9_-]*/i;
const FONT_WEIGHT_RE = /font-weight\s*:\s*(bold(?:er)?|[1-9]00|var\(\s*--[^)]*(?:bold|black)[^)]*\))/gi;
const HEAVY_TAILWIND_RE = /\bfont-(?:bold|extrabold|black|\[(?:[7-9]00)\])\b/;
const INLINE_WEIGHT_RE = /fontWeight\s*:\s*["']?(bold(?:er)?|[7-9]00)["']?/i;
const ALLOW_PRAGMA_RE = /guard:allow-heavy-control\s+-\s+\S+/;
const ALLOW_PRAGMA_ANY_RE = /guard:allow-heavy-control/;

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root ?? process.cwd());
const baselinePath = path.resolve(
  root,
  args.baseline ?? "scripts/ui-typography-baseline.json",
);
const baseline = readBaseline(baselinePath);
const issues = [];

for (const file of walkUiFiles(path.join(root, "src"))) {
  const relativePath = toPosix(path.relative(root, file));
  const source = readFileSync(file, "utf8");

  if (CSS_FILE_RE.test(file)) {
    inspectCss(relativePath, source, baseline, issues);
  } else if (JSX_FILE_RE.test(file)) {
    inspectJsx(relativePath, source, baseline, issues);
  }
}

if (args.printBaseline === true) {
  const entries = issues
    .map(({ file, selector, weight }) => ({ file, selector, weight }))
    .sort((left, right) =>
      `${left.file}\n${left.selector}\n${left.weight}`.localeCompare(
        `${right.file}\n${right.selector}\n${right.weight}`,
      ),
    );
  console.log(`${JSON.stringify({
    version: 1,
    note: "Legacy heavy control-label treatments. Do not add entries; remove them as controls migrate to the design system.",
    entries,
  }, null, 2)}\n`);
  process.exit(0);
}

if (issues.length > 0) {
  console.error("UI typography guard failed:");
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line}: ${issue.reason}`);
  }
  console.error(
    "Interactive control labels must use weight 400–600 (500 by default). Use the design-system Button primitive where practical.",
  );
  process.exitCode = 1;
} else {
  console.log("UI typography guard passed.");
}

function inspectCss(file, source, knownBaseline, foundIssues) {
  for (const match of source.matchAll(CSS_RULE_RE)) {
    const selector = normalize(match[1]);
    const body = match[2];
    if (!CONTROL_SELECTOR_RE.test(selector)) continue;

    for (const weightMatch of body.matchAll(FONT_WEIGHT_RE)) {
      const rawWeight = weightMatch[1];
      if (!isHeavyWeight(rawWeight)) continue;

      const signature = baselineKey(file, selector, normalize(rawWeight));
      if (knownBaseline.has(signature)) continue;

      const nearby = source.slice(Math.max(0, match.index - 180), match.index + match[0].length);
      const pragmaIssue = pragmaReason(nearby);
      if (pragmaIssue === null) continue;

      foundIssues.push({
        file,
        line: lineNumber(source, match.index + match[0].indexOf(weightMatch[0])),
        reason: pragmaIssue ?? `${selector} uses heavy control-label weight ${rawWeight}`,
        selector,
        weight: normalize(rawWeight),
      });
    }
  }
}

function inspectJsx(file, source, knownBaseline, foundIssues) {
  const controlTagRe = /<(button|Button)\b([^>]*)>/g;
  for (const match of source.matchAll(controlTagRe)) {
    const tag = match[1];
    const attributes = match[2];
    const selector = normalize(match[0]);
    const heavyClass = attributes.match(HEAVY_TAILWIND_RE)?.[0];
    const inlineWeight = attributes.match(INLINE_WEIGHT_RE)?.[1];
    const rawWeight = heavyClass ?? inlineWeight;
    if (!rawWeight) continue;

    const signature = baselineKey(file, selector, normalize(rawWeight));
    if (knownBaseline.has(signature)) continue;

    const nearby = source.slice(Math.max(0, match.index - 180), match.index + match[0].length);
    const pragmaIssue = pragmaReason(nearby);
    if (pragmaIssue === null) continue;

    foundIssues.push({
      file,
      line: lineNumber(source, match.index),
      reason: pragmaIssue ?? `<${tag}> uses heavy control-label weight ${rawWeight}`,
      selector,
      weight: normalize(rawWeight),
    });
  }
}

function pragmaReason(source) {
  if (ALLOW_PRAGMA_RE.test(source)) return null;
  if (ALLOW_PRAGMA_ANY_RE.test(source)) {
    return "allow pragma must include a short reason, e.g. guard:allow-heavy-control - icon-only branded control";
  }
  return undefined;
}

function isHeavyWeight(value) {
  const normalized = normalize(value).toLowerCase();
  if (normalized === "bold" || normalized === "bolder") return true;
  if (normalized.startsWith("var(")) return true;
  return Number.parseInt(normalized, 10) > 600;
}

function readBaseline(file) {
  if (!existsSync(file)) return new Set();
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${file} must contain an entries array`);
  }
  return new Set(
    parsed.entries.map((entry) =>
      baselineKey(toPosix(entry.file), normalize(entry.selector), normalize(entry.weight)),
    ),
  );
}

function walkUiFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkUiFiles(fullPath));
    } else if (CSS_FILE_RE.test(entry.name) || JSX_FILE_RE.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
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
    } else if (values[index] === "--print-baseline") {
      parsed.printBaseline = true;
    }
  }
  return parsed;
}

function baselineKey(file, selector, weight) {
  return `${file}\n${selector}\n${weight}`;
}

function lineNumber(source, index) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}
