#!/usr/bin/env node
// Hermetic coverage for importing an existing repo as a Zero Human Company:
// - scan Git, GitHub Actions, Supabase pg_cron, Render services, package scripts
// - persist the imported systems on the company definition
// - link the repo into the shared project registry
// - re-import the same repo as an update, not a duplicate company
import { register } from "node:module";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const execFile = promisify(execFileCallback);
const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-import-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-import-vault-"));
const repoPath = await mkdtemp(join(tmpdir(), "hivemind-company-import-repo-"));

process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0";

async function writeFixture(relativePath, content) {
  const file = join(repoPath, relativePath);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, content);
}

try {
  await writeFixture("package.json", JSON.stringify({
    name: "imported-company-app",
    scripts: {
      dev: "next dev",
      build: "next build",
      test: "vitest run",
      deploy: "wrangler deploy",
    },
    dependencies: {
      next: "15.0.0",
      react: "19.0.0",
    },
  }, null, 2));
  await writeFixture(".github/workflows/health.yml", `
name: Nightly Health
on:
  workflow_dispatch:
  schedule:
    - cron: "17 3 * * *"
  push:
    branches: [main]
jobs:
  health:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
`);
  await writeFixture("supabase/migrations/20260101000000_company_cron.sql", `
select cron.schedule('nightly-company-score', '0 3 * * *', $$ select 1 $$);
`);
  await writeFixture("render.yaml", `
services:
  - type: web
    name: imported-company-web
  - type: cron
    name: imported-company-nightly
    schedule: "0 5 * * *"
`);

  await execFile("git", ["init"], { cwd: repoPath });
  await execFile("git", ["remote", "add", "origin", "git@github.com:example/imported-company.git"], { cwd: repoPath });

  const { importCompanyFromRepo, previewCompanyImport } = await import("../src/lib/services/company-importer.ts");
  const { readCompanies } = await import("../src/lib/services/companies-store.ts");
  const { readProjectRegistry } = await import("../src/lib/services/projects/project-registry.ts");

  const preview = await previewCompanyImport({ repoPath });
  assert.equal(preview.importedOperations.git?.remoteUrl, "git@github.com:example/imported-company.git");
  assert.equal(preview.importedOperations.git?.repoName, "example/imported-company");
  assert.ok(preview.importedOperations.workflows.some((workflow) => workflow.name === "Nightly Health"), "GitHub Actions workflow is detected");
  assert.ok(preview.importedOperations.schedules.some((schedule) => schedule.kind === "github-actions" && schedule.schedule === "17 3 * * *"), "scheduled GitHub Actions cron is detected");
  assert.ok(preview.importedOperations.schedules.some((schedule) => schedule.kind === "supabase-cron" && schedule.name === "nightly-company-score"), "Supabase pg_cron schedule is detected");
  assert.ok(preview.importedOperations.schedules.some((schedule) => schedule.kind === "render-cron" && schedule.name === "imported-company-nightly"), "Render cron schedule is detected");
  assert.ok(preview.importedOperations.services.some((service) => service.name === "imported-company-web"), "Render web service is detected");
  assert.ok(preview.importedOperations.scripts.some((script) => script.name === "deploy" && script.category === "ops"), "package scripts are categorized");

  const first = await importCompanyFromRepo({
    repoPath,
    companyName: "Imported Company",
    ticker: "IMPT",
    sector: "Imported SaaS",
    apexGoalTitle: "Keep imported systems visible",
  });
  assert.equal(first.updatedExisting, false, "first import creates a new company");
  assert.equal(first.company.name, "Imported Company");
  assert.equal(first.company.ticker, "IMPT");
  assert.equal(first.company.projectId, first.project.id);
  assert.equal(first.company.importedOperations?.projectPath, repoPath);
  assert.equal(first.company.importedOperations?.workflows.length, 1);
  assert.ok((first.company.importedOperations?.schedules.length ?? 0) >= 3, "company stores discovered schedules");

  const registry = await readProjectRegistry();
  const importedProject = registry.projects.find((project) => project.id === first.project.id);
  assert.ok(importedProject, "project registry stores the imported repo");
  assert.equal(importedProject.localPath, repoPath);
  assert.equal(importedProject.gitlawbRepo?.remoteUrl, "git@github.com:example/imported-company.git");

  const second = await importCompanyFromRepo({
    repoPath,
    companyName: "Imported Company",
    ticker: "IMPT",
    sector: "Imported SaaS",
    apexGoalTitle: "Keep imported systems visible",
  });
  assert.equal(second.updatedExisting, true, "re-import updates the existing company");
  assert.equal(second.company.id, first.company.id, "re-import does not duplicate the company");
  assert.equal(second.company.importedOperations?.importedAt, first.company.importedOperations?.importedAt, "original import timestamp is retained");

  const companies = await readCompanies();
  assert.equal(companies.filter((company) => company.importedOperations?.projectPath === repoPath).length, 1, "only one imported company is stored for the repo path");

  console.log("company importer test passed");
} finally {
  await rm(tempHome, { recursive: true, force: true });
  await rm(vaultPath, { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
}
