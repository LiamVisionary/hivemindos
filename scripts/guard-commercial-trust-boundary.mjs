#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ALLOW_PRAGMA_RE = /guard:allow-commercial-trust-boundary\s+-\s+\S+/;
const ALLOW_PRAGMA_ANY_RE = /guard:allow-commercial-trust-boundary/;

const RULES = [
  {
    id: "client-payto-authority",
    message:
      "client-supplied payTo/fee recipient must not be authoritative for official value",
    pattern:
      /\b(?:const|let|var)\s+\w*(?:payTo|feeRecipient)\w*\s*=\s*(?:body|payload|requestBody)\.(?:payTo|feeRecipient)\b|\b(?:payTo|feeRecipient)\s*:\s*(?:body|payload|requestBody)\.(?:payTo|feeRecipient)\b/i,
    allow: selfHostedSellerBoundary,
  },
  {
    id: "client-entitlement-authority",
    message:
      "client-supplied entitlement/paid-access flags must not grant official access",
    pattern:
      /\bif\s*\(\s*(?:body|payload|requestBody)\.(?:entitled|hasEntitlement|paidAccess|enterprise|hosted)\s*\)|\bgrant\w*\([^)]*(?:body|payload|requestBody)\.(?:entitled|hasEntitlement|paidAccess|enterprise|hosted)\b/i,
  },
  {
    id: "client-credit-authority",
    message:
      "client-supplied managed credit, quota, or entitlement balances must not be authoritative",
    pattern:
      /\b(?:managedHoneyBalance|managedCreditBalance|creditBalance|quota|entitlement)\s*[:=]\s*(?:body|payload|requestBody)\./i,
  },
  {
    id: "browser-commercial-authority",
    message:
      "browser storage must not be authoritative for managed credits, quotas, or entitlements",
    pattern:
      /\b(?:localStorage|sessionStorage|indexedDB)\b[\s\S]{0,160}\b(?:managedHoney|managedCredit|entitlement|quota|paidAccess|enterprise)\b/i,
  },
];

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root ?? process.cwd());
const issues = [];

for (const file of scanFiles(root)) {
  const relativePath = toPosix(path.relative(root, file));
  const source = readFileSync(file, "utf8");
  if (ALLOW_PRAGMA_RE.test(source)) continue;
  if (ALLOW_PRAGMA_ANY_RE.test(source)) {
    issues.push({
      file: relativePath,
      line: 1,
      rule: "malformed-allow-pragma",
      message:
        "allow pragma must include a short reason, e.g. guard:allow-commercial-trust-boundary - self-hosted seller config",
    });
    continue;
  }

  for (const rule of RULES) {
    if (!rule.pattern.test(source)) continue;
    if (rule.allow?.(source, relativePath)) continue;
    issues.push({
      file: relativePath,
      line: lineNumberFor(source, rule.pattern),
      rule: rule.id,
      message: rule.message,
    });
  }
}

if (issues.length > 0) {
  console.error("Commercial trust-boundary guard failed:");
  for (const issue of issues) {
    console.error(
      `- ${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`,
    );
  }
  console.error(
    "Keep official settlement, entitlement, quota, managed-credit, and fee-recipient authority server-side or settlement-backed.",
  );
  process.exitCode = 1;
} else {
  console.log("Commercial trust-boundary guard passed.");
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--root") {
      parsed.root = values[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function scanFiles(projectRoot) {
  const files = [];
  for (const target of scanTargets(projectRoot)) {
    if (!existsSync(target.path)) continue;
    if (target.file) {
      files.push(target.path);
    } else {
      files.push(...walk(target.path, target.extensions));
    }
  }
  return [...new Set(files)];
}

function scanTargets(projectRoot) {
  return [
    {
      path: path.join(projectRoot, "src/app/api"),
      extensions: new Set([".ts", ".tsx"]),
    },
    {
      path: path.join(projectRoot, "src/lib/services/wallet"),
      extensions: new Set([".ts", ".tsx"]),
    },
    {
      path: path.join(projectRoot, "src/lib/services/paid-agent-gateway.ts"),
      file: true,
    },
    {
      path: path.join(projectRoot, "workers"),
      extensions: new Set([".ts", ".tsx", ".md"]),
    },
    {
      path: path.join(projectRoot, "docs/for-users/features/wallets-honey-and-x402.md"),
      file: true,
    },
    {
      path: path.join(projectRoot, "docs/for-users/architecture/api-and-storage.md"),
      file: true,
    },
  ];
}

function walk(dir, extensions) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".wrangler") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, extensions));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function selfHostedSellerBoundary(source) {
  return (
    /self-hosted|self_hosted|selfhosted/i.test(source) &&
    /HIVEMINDOS_PAID_AGENT_SELLER_MODE|HIVEMINDOS_PAID_AGENT_PAY_TO/.test(source)
  );
}

function lineNumberFor(source, pattern) {
  const match = pattern.exec(source);
  if (!match) return 1;
  return source.slice(0, match.index).split("\n").length;
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}
