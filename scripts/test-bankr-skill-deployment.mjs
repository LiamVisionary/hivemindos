#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const root = process.cwd();
const skillRoot = resolve(root, "packaged-skills/auto-install/bankr-skill-deployment");
const readSkill = (path) => readFile(resolve(skillRoot, path), "utf8");

const [skill, models, publish, security, evalsSource, packagedReadme, hiveSkillsDoc] = await Promise.all([
  readSkill("SKILL.md"),
  readSkill("references/deployment-models.md"),
  readSkill("references/publish-install-verify.md"),
  readSkill("references/security-commercial-boundaries.md"),
  readSkill("evals/evals.json"),
  readFile(resolve(root, "packaged-skills/README.md"), "utf8"),
  readFile(resolve(root, "docs/for-users/packaged-skills/hive-skills.md"), "utf8"),
]);

assert.match(skill, /^name: bankr-skill-deployment$/m);
assert.match(skill, /^version: 1$/m);
assert.match(skill, /Installing a skill does not create a continuously running daemon/);
assert.match(skill, /`202 Accepted` means queued, not installed or completed/);
assert.match(skill, /Do not force x402 into a post-trade fee or subscription/);
assert.match(skill, /Apply company spend restrictions only when the action carries a validated active company-task context/);
assert.match(models, /30-second execution limit and 256 MB memory limit/);
assert.match(models, /First 1,000 settled requests per month: 0% platform fee/);
assert.match(models, /Bankr skill\/app -> HivemindOS hosted monitor -> Bankr Wallet API -> independent Base verification/);
assert.match(models, /monthly service cost per active user/);
assert.match(publish, /A local directory or unpushed branch is not remotely installable/);
assert.match(publish, /Poll `GET https:\/\/api\.bankr\.bot\/agent\/job\/\{jobId\}`/);
assert.match(publish, /An unpaid request should return `402`/);
assert.match(publish, /partially updated package/);
assert.match(security, /HivemindOS Shared Hive Env/);
assert.match(security, /Existing selected variable: primary action says \*\*Continue\*\*/);
assert.match(security, /New variable: primary action says \*\*Save\*\*/);
assert.match(security, /Do not create a second HivemindOS custody wallet/);
assert.match(security, /Write an `executing` or equivalent claim record before calling Bankr/);

const evals = JSON.parse(evalsSource);
assert.equal(evals.skill, "bankr-skill-deployment");
assert.equal(evals.version, 1);
assert.ok(evals.evals.length >= 9);
assert.ok(evals.evals.some((entry) => entry.id === "stale-version-resources"));
assert.ok(evals.evals.some((entry) => entry.id === "ambiguous-transaction"));

const verifierPath = resolve(skillRoot, "scripts/verify-bankr-skill.mjs");
const verification = spawnSync(process.execPath, [verifierPath, skillRoot], { encoding: "utf8" });
assert.equal(verification.status, 0, verification.stderr || verification.stdout);
assert.match(verification.stdout, /Verified bankr-skill-deployment v1/);

const help = spawnSync(process.execPath, [verifierPath, "--help"], { encoding: "utf8" });
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /--remote-url/);

assert.match(packagedReadme, /`bankr-skill-deployment` for choosing between a Bankr skill/);
assert.match(hiveSkillsDoc, /\| `bankr-skill-deployment` \| Chooses the correct Bankr skill/);

const packagedSkills = await import("../src/lib/services/context-index/packaged-skills.ts");
const stats = await packagedSkills.packagedSkillFileStats();
const deploymentStat = stats.find((entry) => entry.path === resolve(skillRoot, "SKILL.md"));
assert.ok(deploymentStat, "the auto-install catalog should discover the Bankr deployment skill");
const catalogItem = await packagedSkills.packagedSkillItem(deploymentStat);
assert.equal(catalogItem.id, "skill:packaged:auto-install:bankr-skill-deployment");
assert.match(catalogItem.summary, /paid x402 endpoint/);

console.log("Bankr skill deployment package, eval/version, verifier, docs, and catalog contract passed.");
