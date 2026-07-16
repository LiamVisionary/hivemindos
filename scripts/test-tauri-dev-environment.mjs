#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTauriDevEnvironment } from "./lib/tauri-dev-environment.mjs";

const dashboardTokenKey = "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN";
const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-tauri-dev-env-"));
const projectRoot = join(tempRoot, "project");
const homeDir = join(tempRoot, "home");
const projectToken = "p".repeat(64);
const sharedToken = "s".repeat(64);
const processToken = "e".repeat(64);

try {
  await mkdir(join(homeDir, ".hivemindos"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, ".env.local"), `${dashboardTokenKey}=${projectToken}\n`, "utf8");
  await writeFile(join(homeDir, ".hivemindos", ".env"), `${dashboardTokenKey}=${sharedToken}\n`, "utf8");

  const projectEnvironment = resolveTauriDevEnvironment({
    baseEnvironment: { PATH: "/usr/bin" },
    homeDir,
    projectRoot,
  });
  assert.equal(projectEnvironment.HIVE_ENV_PROJECT_ROOT, projectRoot);
  assert.equal(projectEnvironment[dashboardTokenKey], projectToken, "the checkout token should reach the signed Tauri app");
  assert.equal(projectEnvironment.PATH, "/usr/bin", "the normal launch environment should be preserved");

  const processEnvironment = resolveTauriDevEnvironment({
    baseEnvironment: { [dashboardTokenKey]: processToken },
    homeDir,
    projectRoot,
  });
  assert.equal(processEnvironment[dashboardTokenKey], processToken, "an explicit process token should keep precedence");

  await rm(join(projectRoot, ".env.local"));
  const sharedEnvironment = resolveTauriDevEnvironment({
    baseEnvironment: {},
    homeDir,
    projectRoot,
  });
  assert.equal(sharedEnvironment[dashboardTokenKey], sharedToken, "the shared hive token should remain the fallback");

  console.log("Tauri dev dashboard token handoff checks passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
