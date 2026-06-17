#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "a".repeat(64);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "b".repeat(32);

const { collectSystemHealth, summarizeSystemHealth } = await import("../src/lib/services/system/system-health.ts");

const dir = await mkdtemp(join(tmpdir(), "hivemindos-system-health-"));
const vault = join(dir, "vault");
const project = join(dir, "project");

try {
  await mkdir(join(vault, "Skills"), { recursive: true });
  await mkdir(join(vault, "Operations", "Brain Services"), { recursive: true });
  await writeFile(join(vault, "AGENTS.md"), "# Agent rules\n", "utf8");
  await writeFile(join(vault, "Skills", "README.md"), "# Skills\n", "utf8");
  await writeFile(join(vault, "Operations", "Brain Services", "Agent Memory Index.jsonl"), "", "utf8");
  await writeFile(join(vault, "Operations", "Brain Services", "Full Vault Search Index.jsonl"), "", "utf8");

  await mkdir(join(project, "docs"), { recursive: true });
  await writeFile(join(project, "package.json"), "{}", "utf8");
  await writeFile(join(project, "CHANGELOG.md"), "# Changelog\n", "utf8");
  await writeFile(join(project, "docs", "THREAT_MODEL.md"), "# Threat Model\n", "utf8");

  const report = await collectSystemHealth({
    now: new Date("2026-06-16T12:00:00.000Z"),
    root: project,
    vaultPath: vault,
  });

  assert.equal(report.status, "ok");
  assert.equal(report.ok, true);
  assert.equal(report.generatedAt, "2026-06-16T12:00:00.000Z");
  assert.equal(report.checks.find((item) => item.id === "dashboard-auth")?.status, "ok");
  assert.equal(report.checks.find((item) => item.id === "shared-vault")?.status, "ok");
  assert.equal(report.checks.find((item) => item.id === "project-workspace")?.status, "ok");
  assert.equal(summarizeSystemHealth([
    { id: "a", label: "A", status: "disabled", detail: "" },
    { id: "b", label: "B", status: "degraded", detail: "" },
    { id: "c", label: "C", status: "ok", detail: "" },
  ]), "degraded");

  console.log("System health checks passed.");
} finally {
  await rm(dir, { recursive: true, force: true });
}
