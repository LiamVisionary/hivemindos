import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const releaseWorkflow = readFileSync(".github/workflows/tauri-cross-platform-release.yml", "utf8");
const dashboardApp = readFileSync("src/features/dashboard/DashboardApp.tsx", "utf8");
const versionRoute = readFileSync("src/app/api/app/version/route.ts", "utf8");

const cargoVersion = cargoToml.match(/^version = "([^"]+)"$/m)?.[1];
assert.ok(cargoVersion, "The desktop Cargo package must declare a version");
assert.equal(tauriConfig.version, packageJson.version, "Tauri config and package.json versions must match");
assert.equal(cargoVersion, packageJson.version, "Cargo.toml and package.json versions must match");

execFileSync(process.execPath, ["scripts/bump-app-version.mjs", "--check", packageJson.version], {
  stdio: "pipe",
});

const fixtureRoot = mkdtempSync(join(tmpdir(), "hivemindos-version-contract-"));
try {
  mkdirSync(join(fixtureRoot, "scripts"));
  mkdirSync(join(fixtureRoot, "src-tauri"));
  for (const path of [
    "scripts/bump-app-version.mjs",
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ]) {
    copyFileSync(path, join(fixtureRoot, path));
  }
  execFileSync(process.execPath, ["scripts/bump-app-version.mjs", "--set", "9.8.7"], {
    cwd: fixtureRoot,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["scripts/bump-app-version.mjs", "--check", "9.8.7"], {
    cwd: fixtureRoot,
    stdio: "pipe",
  });

  const mismatchedTauriConfigPath = join(fixtureRoot, "src-tauri/tauri.conf.json");
  const mismatchedTauriConfig = JSON.parse(readFileSync(mismatchedTauriConfigPath, "utf8"));
  mismatchedTauriConfig.version = "9.8.6";
  writeFileSync(mismatchedTauriConfigPath, `${JSON.stringify(mismatchedTauriConfig, null, 2)}\n`);
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/bump-app-version.mjs", "--check", "9.8.7"], {
      cwd: fixtureRoot,
      stdio: "pipe",
    }),
    "Manifest verification must fail closed when any app version drifts",
  );
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const { effectiveAppVersion } = await import("../src/lib/services/app-version-resolution.ts");
assert.equal(effectiveAppVersion("0.4.1", "0.4.5", "0.6.0"), "0.6.0", "Version resolution must select the newest valid source");
assert.equal(effectiveAppVersion("0.6.0", "not-semver", "0.4.5"), "0.6.0", "Invalid version candidates must be ignored");

const { selectDashboardAppVersion } = await import("../src/lib/native/app-version-selection.ts");
const native = { commit: "native", version: "0.4.1" };
const source = { commit: "source", version: "0.6.0" };
assert.equal(
  selectDashboardAppVersion({ ...native, packaged: true, sourceBuild: false, releaseChannel: "release" }, source)?.version,
  "0.4.1",
  "Packaged releases must display the installed native build version",
);
assert.equal(
  selectDashboardAppVersion({ ...native, packaged: false, sourceBuild: true, releaseChannel: "source" }, source)?.version,
  "0.6.0",
  "Source and dev builds must prefer the Git/release-aware source version",
);
assert.equal(selectDashboardAppVersion(native, null)?.version, "0.4.1", "Native metadata remains the offline fallback");

assert.match(versionRoute, /releases\/latest\/download\/latest\.json/, "Source version resolution must consult the stable updater manifest");
assert.ok(
  tauriConfig.plugins?.updater?.endpoints?.some((endpoint) => versionRoute.includes(endpoint)),
  "The source resolver and signed desktop updater must use the same stable-release manifest",
);
assert.match(dashboardApp, /selectDashboardAppVersion/, "Dashboard version polling must use the shared runtime-selection contract");
assert.doesNotMatch(
  releaseWorkflow,
  /description: Release version[^\n]*\n\s+required: true\n\s+default:/,
  "The release form must not carry a permanently stale version default",
);

const stampIndex = releaseWorkflow.indexOf("- name: Stamp release source");
const commitIndex = releaseWorkflow.indexOf("git commit", stampIndex);
const tagIndex = releaseWorkflow.indexOf("git tag -a", stampIndex);
const atomicPushIndex = releaseWorkflow.indexOf("git push --atomic origin \"HEAD:refs/heads/", tagIndex);
assert.ok(stampIndex >= 0, "Release publishing must stamp the source manifests");
assert.ok(commitIndex > stampIndex, "Release publishing must commit the synchronized manifests");
assert.ok(tagIndex > commitIndex, "The release tag must point at the synchronized version commit");
assert.ok(atomicPushIndex > tagIndex, "The source branch and release tag must publish atomically when the source is a branch");

console.log(`App version contract is synchronized at v${packageJson.version}.`);
