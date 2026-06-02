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

function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected semver patch version, got ${version}`);
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
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
  if (updatedSection === section) throw new Error(`Could not replace ${packageName} package version`);
  return content.slice(0, start) + updatedSection + content.slice(end);
}

const packageJson = readJson(packageJsonPath);
const tauriConfig = readJson(tauriConfigPath);
const currentVersion = packageJson.version;
const nextVersion = nextPatchVersion(currentVersion);

packageJson.version = nextVersion;
tauriConfig.version = nextVersion;

writeJson(packageJsonPath, packageJson);
writeJson(tauriConfigPath, tauriConfig);

const cargoToml = readFileSync(cargoTomlPath, "utf8")
  .replace(/^version = "([^"]+)"$/m, `version = "${nextVersion}"`);
writeFileSync(cargoTomlPath, cargoToml);

const cargoLock = replaceCargoPackageVersion(readFileSync(cargoLockPath, "utf8"), "hivemindos-desktop", nextVersion);
writeFileSync(cargoLockPath, cargoLock);

console.log(`Bumped HivemindOS app version ${currentVersion} -> ${nextVersion}`);
