#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const [setupSh, setupPs, uninstallSh, uninstallPs, runtimeSetup, collector, runtimeInstaller] = await Promise.all([
  readFile(new URL("../setup.sh", import.meta.url), "utf8"),
  readFile(new URL("../setup.ps1", import.meta.url), "utf8"),
  readFile(new URL("../uninstall.sh", import.meta.url), "utf8"),
  readFile(new URL("../uninstall.ps1", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/views/chat/RuntimeInstallSetup.tsx", import.meta.url), "utf8"),
  readFile(new URL("./agent-telemetry-collector.mjs", import.meta.url), "utf8"),
  import("../src/lib/services/runtime-installer.ts"),
]);

const failures = [];
function test(name, callback) {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`FAIL ${name}`);
  }
}

test("Corepack works without system shim permissions", () => {
  assert.doesNotMatch(setupSh, /\bcorepack enable\b/);
  assert.doesNotMatch(setupPs, /\bcorepack enable\b/);
  assert.match(setupSh, /corepack pnpm --version/);
  assert.match(setupPs, /corepack pnpm @Arguments/);
});

test("GitLawb bootstrap has a checksum-verified GitHub release fallback", () => {
  assert.match(setupSh, /GITLAWB_FALLBACK_VERSION/);
  assert.match(setupSh, /github\.com\/gitlawb\/releases\/releases\/download/);
  assert.match(setupSh, /sha256sum|shasum -a 256/);
});

test("local-only setup skips the optional mobile backend", () => {
  assert.match(setupSh, /network_mode.*local[\s\S]*Skipping optional HivemindOS Mobile backend/);
});

test("setup distinguishes core readiness from optional feature failures", () => {
  assert.match(setupSh, /optional_setup_issues/);
  assert.match(setupSh, /Core setup ready/);
  assert.match(setupSh, /Optional features need attention/);
  assert.match(setupSh, /Code Proof \(GitLawb registration\)/);
});

test("protected Shared Brain folders do not abort core setup", () => {
  assert.match(setupSh, /shared_vault_ready="false"/);
  assert.match(setupSh, /HIVEMINDOS_SETUP_WARNING/);
  assert.match(setupSh, /macOS blocked access to Documents/);

  const root = mkdtempSync(join(tmpdir(), "hivemindos-protected-vault-"));
  const blockedVault = join(root, "not-a-directory");
  writeFileSync(blockedVault, "blocks mkdir");
  try {
    const result = spawnSync("bash", ["scripts/import-agent-memory.sh", "--sources", "none"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: blockedVault },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /HIVEMINDOS_SETUP_WARNING: Memory import paused/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime installation shows animated, elapsed progress", () => {
  assert.match(runtimeSetup, /ProgressBar/);
  assert.match(runtimeSetup, /installElapsedSeconds/);
  assert.match(runtimeSetup, /This can take several minutes/);
});

test("in-app runtime installs collapse the terminal command as a manual fallback", () => {
  assert.match(
    runtimeSetup,
    /<details[\s\S]*?<summary[^>]*>Manual install<\/summary>[\s\S]*?<div style=\{codeRowStyle\}>[\s\S]*?\{installCommand\}/,
  );
  assert.doesNotMatch(runtimeSetup, /<details[^>]*\sopen(?:=|\s|>)/);
});

test("OpenClaw Codex plugin trust merges without replacing existing allow entries", () => {
  assert.equal(typeof runtimeInstaller.mergeOpenClawPluginAllowlist, "function");
  assert.deepEqual(
    runtimeInstaller.mergeOpenClawPluginAllowlist(["custom-plugin", "codex"], "codex"),
    ["custom-plugin", "codex"],
  );
  assert.deepEqual(
    runtimeInstaller.mergeOpenClawPluginAllowlist(["custom-plugin"], "codex"),
    ["custom-plugin", "codex"],
  );
  assert.match(setupSh, /configure_openclaw_codex_plugin_trust/);
  assert.match(collector, /configureCollectorOpenClawCodexPluginTrust/);
  assert.match(setupSh, /openclaw-codex-plugin-trust\.json/);
  assert.match(collector, /openclaw-codex-plugin-trust\.json/);
  assert.match(uninstallSh, /Remove the HivemindOS-added Codex entry from OpenClaw's plugin allowlist/);
  assert.match(uninstallSh, /openclaw-codex-plugin-trust\.json/);
  assert.match(uninstallPs, /Remove the HivemindOS-added Codex entry from OpenClaw's plugin allowlist/);
  assert.match(uninstallPs, /openclaw-codex-plugin-trust\.json/);
});

if (failures.length) {
  console.error(`\n${failures.length} runtime setup resilience checks failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("runtime setup resilience checks passed");
