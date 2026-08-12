import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const packageJsonPath = "package.json";
const tauriConfigPath = "src-tauri/tauri.conf.json";
const cargoTomlPath = "src-tauri/Cargo.toml";
const cargoLockPath = "src-tauri/Cargo.lock";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected semver patch version, got ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const [lMajor, lMinor, lPatch] = parseVersion(left);
  const [rMajor, rMinor, rPatch] = parseVersion(right);
  return (lMajor - rMajor) || (lMinor - rMinor) || (lPatch - rPatch);
}

function nextPatchVersion(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function latestTagVersion() {
  try {
    const tags = execFileSync("git", ["tag", "--list", "v[0-9]*", "--sort=-v:refname"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    const latest = tags.split("\n")[0]?.replace(/^v/, "") ?? "";
    return /^\d+\.\d+\.\d+$/.test(latest) ? latest : "";
  } catch {
    return "";
  }
}

function replaceCargoPackageVersion(content, packageName, version) {
  const packageNameLine = `name = "${packageName}"`;
  const nameIndex = content.indexOf(packageNameLine);
  if (nameIndex < 0) throw new Error(`Could not find ${packageName} package section`);
  const start = content.lastIndexOf("[[package]]", nameIndex);
  if (start < 0) throw new Error(`Could not find ${packageName} package section`);
  const nextSection = content.indexOf("\n[[package]]", start + 1);
  const end = nextSection < 0 ? content.length : nextSection;
  const section = content.slice(start, end);
  const updatedSection = section.replace(/^version = "([^"]+)"$/m, `version = "${version}"`);
  if (updatedSection === section) {
    if (new RegExp(`^version = "${version}"$`, "m").test(section)) {
      return content;
    }
    throw new Error(`Could not replace ${packageName} package version`);
  }
  return content.slice(0, start) + updatedSection + content.slice(end);
}

function cargoLockPackageVersion(content, packageName) {
  const packageNameLine = `name = "${packageName}"`;
  const nameIndex = content.indexOf(packageNameLine);
  if (nameIndex < 0) throw new Error(`Could not find ${packageName} package section`);
  const start = content.lastIndexOf("[[package]]", nameIndex);
  if (start < 0) throw new Error(`Could not find ${packageName} package section`);
  const nextSection = content.indexOf("\n[[package]]", start + 1);
  const end = nextSection < 0 ? content.length : nextSection;
  const version = content.slice(start, end).match(/^version = "([^"]+)"$/m)?.[1];
  if (!version) throw new Error(`Could not read ${packageName} package version`);
  return version;
}

function manifestVersions() {
  const packageVersion = readJson(packageJsonPath).version;
  const tauriVersion = readJson(tauriConfigPath).version;
  const cargoVersion = readFileSync(cargoTomlPath, "utf8").match(/^version = "([^"]+)"$/m)?.[1];
  const cargoLockVersion = cargoLockPackageVersion(readFileSync(cargoLockPath, "utf8"), "hivemindos-desktop");
  return {
    [packageJsonPath]: packageVersion,
    [tauriConfigPath]: tauriVersion,
    [cargoTomlPath]: cargoVersion,
    [cargoLockPath]: cargoLockVersion,
  };
}

function assertManifestVersions(expectedVersion) {
  parseVersion(expectedVersion);
  const versions = manifestVersions();
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== expectedVersion)
    .map(([path, version]) => `${path}=${version ?? "<missing>"}`);
  if (mismatches.length > 0) {
    throw new Error(`HivemindOS app versions are out of sync; expected ${expectedVersion}: ${mismatches.join(", ")}`);
  }
  return versions;
}

function setAppVersion(currentVersion, nextVersion) {
  const packageJson = readJson(packageJsonPath);
  const tauriConfig = readJson(tauriConfigPath);

  packageJson.version = nextVersion;
  tauriConfig.version = nextVersion;

  writeJson(packageJsonPath, packageJson);
  writeJson(tauriConfigPath, tauriConfig);

  const cargoToml = readFileSync(cargoTomlPath, "utf8")
    .replace(/^version = "([^"]+)"$/m, `version = "${nextVersion}"`);
  writeFileSync(cargoTomlPath, cargoToml);

  const cargoLock = replaceCargoPackageVersion(readFileSync(cargoLockPath, "utf8"), "hivemindos-desktop", nextVersion);
  writeFileSync(cargoLockPath, cargoLock);

  assertManifestVersions(nextVersion);
  console.log(`Set HivemindOS app version ${currentVersion} -> ${nextVersion}`);
}

const [mode, value] = process.argv.slice(2);
const packageVersion = readJson(packageJsonPath).version;

if (mode === "--next") {
  // Print the next patch version without writing anything. Seeds from the
  // greatest of (latest v* git tag, package.json) so a stale tag floor or a
  // stale checked-in version can never walk the version backwards.
  assertManifestVersions(packageVersion);
  const tagVersion = latestTagVersion();
  const baseline = tagVersion && compareVersions(tagVersion, packageVersion) > 0 ? tagVersion : packageVersion;
  process.stdout.write(`${nextPatchVersion(baseline)}\n`);
} else if (mode === "--set") {
  parseVersion(value ?? "");
  setAppVersion(packageVersion, value);
} else if (mode === "--check") {
  const expectedVersion = value ?? packageVersion;
  assertManifestVersions(expectedVersion);
  console.log(`HivemindOS app manifests are synchronized at ${expectedVersion}`);
} else if (mode === undefined) {
  assertManifestVersions(packageVersion);
  setAppVersion(packageVersion, nextPatchVersion(packageVersion));
} else {
  console.error(`Unknown argument ${mode}. Usage: bump-app-version.mjs [--next | --set X.Y.Z | --check [X.Y.Z]]`);
  process.exit(1);
}
