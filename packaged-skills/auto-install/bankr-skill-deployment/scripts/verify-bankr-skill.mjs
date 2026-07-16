#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const HELP = `Usage:
  node verify-bankr-skill.mjs <skill-directory> [--remote-url <public-github-skill-url>]

Checks required frontmatter, local resource links, eval name/version parity, likely
secret leakage, and optional public GitHub SKILL.md parity. Secret values are never
printed.`;

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const args = { skillDirectory: "", remoteUrl: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--remote-url") {
      args.remoteUrl = argv[index + 1] ?? "";
      index += 1;
    } else if (!value.startsWith("-") && !args.skillDirectory) {
      args.skillDirectory = value;
    } else {
      throw new Error(`Unknown or incomplete argument: ${value}`);
    }
  }
  if (!args.skillDirectory) throw new Error("A skill directory is required.");
  return args;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.md is missing YAML frontmatter.");
  const values = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (field) values.set(field[1], field[2].replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

async function walkFiles(directory, base = directory, output = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if ([".git", "node_modules", ".hivemind-skill-source.json"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walkFiles(path, base, output);
    else if (entry.isFile()) output.push(relative(base, path));
  }
  return output;
}

function remoteSkillUrl(value) {
  const url = new URL(value);
  if (url.hostname === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "tree") {
      const [owner, repository, , branch, ...path] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repository}/${branch}/${path.join("/")}/SKILL.md`;
    }
    if (parts.length >= 5 && parts[2] === "blob") {
      const [owner, repository, , branch, ...path] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repository}/${branch}/${path.join("/")}`;
    }
  }
  return value.endsWith("/SKILL.md") ? value : `${value.replace(/\/$/, "")}/SKILL.md`;
}

async function verifyLocalLinks(skillRoot, skillMarkdown) {
  const missing = [];
  const linkPattern = /\[[^\]]+\]\((references\/[^)#?\s]+|scripts\/[^)#?\s]+)\)/g;
  for (const match of skillMarkdown.matchAll(linkPattern)) {
    const path = resolve(skillRoot, match[1]);
    const exists = await stat(path).then((value) => value.isFile()).catch(() => false);
    if (!exists) missing.push(match[1]);
  }
  if (missing.length) throw new Error(`Missing linked resources: ${[...new Set(missing)].join(", ")}`);
}

async function verifyNoLikelySecrets(skillRoot) {
  const files = await walkFiles(skillRoot);
  const checks = [
    { label: "Bankr API key", pattern: /\bbk_[A-Za-z0-9_-]{16,}\b/ },
    { label: "private-key PEM", pattern: /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/ },
  ];
  const findings = [];
  for (const file of files) {
    const contents = await readFile(join(skillRoot, file), "utf8").catch(() => "");
    for (const check of checks) {
      if (check.pattern.test(contents)) findings.push(`${file}: ${check.label}`);
    }
  }
  if (findings.length) throw new Error(`Possible secret material found (values suppressed): ${findings.join("; ")}`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(HELP);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(HELP);
    return;
  }

  const skillRoot = resolve(args.skillDirectory);
  const skillPath = join(skillRoot, "SKILL.md");
  const skillMarkdown = await readFile(skillPath, "utf8");
  const frontmatter = parseFrontmatter(skillMarkdown);
  const name = frontmatter.get("name") ?? "";
  const description = frontmatter.get("description") ?? "";
  const version = Number(frontmatter.get("version"));

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Frontmatter name must be a lowercase kebab-case slug.");
  if (description.length < 40) throw new Error("Frontmatter description must clearly say what the skill does and when to use it.");
  if (!Number.isInteger(version) || version < 1) throw new Error("Frontmatter version must be a positive integer.");

  await verifyLocalLinks(skillRoot, skillMarkdown);
  await verifyNoLikelySecrets(skillRoot);

  const evalPath = join(skillRoot, "evals", "evals.json");
  const evalManifest = JSON.parse(await readFile(evalPath, "utf8"));
  if (evalManifest.skill !== name) throw new Error(`Eval skill name does not match SKILL.md (${evalManifest.skill} != ${name}).`);
  if (evalManifest.version !== version) throw new Error(`Eval version does not match SKILL.md (${evalManifest.version} != ${version}).`);
  if (!Array.isArray(evalManifest.evals) || evalManifest.evals.length === 0) throw new Error("Eval manifest must contain at least one eval.");

  if (args.remoteUrl) {
    const response = await fetch(remoteSkillUrl(args.remoteUrl), { redirect: "follow" });
    if (!response.ok) throw new Error(`Public SKILL.md fetch failed with HTTP ${response.status}.`);
    const remoteMarkdown = await response.text();
    if (remoteMarkdown !== skillMarkdown) throw new Error("Public SKILL.md does not exactly match the local package.");
  }

  const files = await walkFiles(skillRoot);
  console.log(`Verified ${name} v${version}: ${files.length} authored files, eval parity, local links, and secret scan${args.remoteUrl ? ", plus public SKILL.md parity" : ""}.`);
}

await main();
