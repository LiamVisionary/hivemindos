import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = join(projectRoot, "src-tauri", "link-runtime");
const runtimeScripts = join(runtimeRoot, "scripts");
const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
const linkBinaryName = process.platform === "win32" ? "hivemind-linkd.exe" : "hivemind-linkd";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "no output";
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "no output";
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function copyLicenseFile(source, target) {
  copyFileSync(source, target);
  chmodSync(target, 0o644);
}

const runtimeScriptEntrypoints = [
  "scripts/agent-telemetry-collector.mjs",
  "scripts/fleet-health-watchdog.mjs",
  "scripts/install-fleet-health-watchdog.sh",
  "scripts/install-telemetry-collector.ps1",
  "scripts/install-telemetry-collector.sh",
  "scripts/macos-background-helpers.sh",
  "scripts/hivemindos-background-helper.c",
  "scripts/run-syncthing.sh",
  "scripts/lib/app-builder-static-server.mjs",
];
const copiedRuntimeFiles = new Set();
const copiedNodePackages = new Map();

function resolvePackageManifest(requireFromParent, packageName) {
  try {
    return requireFromParent.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  }
  let directory = dirname(requireFromParent.resolve(packageName));
  while (dirname(directory) !== directory) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, "utf8"));
      if (manifest.name === packageName) return candidate;
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not locate the package manifest for ${packageName}`);
}

function copyRuntimeFile(relativePath) {
  const normalized = relativePath.split(sep).join("/");
  if (copiedRuntimeFiles.has(normalized)) return;
  const source = resolve(projectRoot, normalized);
  const relativeSource = relative(projectRoot, source);
  if (relativeSource.startsWith(`..${sep}`) || relativeSource === "..") {
    throw new Error(`Runtime dependency escaped the project root: ${normalized}`);
  }
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`Runtime dependency was not found: ${normalized}`);
  }

  const target = join(runtimeRoot, normalized);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (process.platform !== "win32" && /\.(?:sh|mjs)$/.test(normalized)) {
    chmodSync(target, 0o755);
  }
  copiedRuntimeFiles.add(normalized);

  if (!/[.]mjs$/.test(normalized)) return;
  const contents = readFileSync(source, "utf8");
  const relativeImport = /(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g;
  for (const match of contents.matchAll(relativeImport)) {
    const dependency = resolve(dirname(source), match[1]);
    const candidates = extname(dependency)
      ? [dependency]
      : [dependency, `${dependency}.mjs`, `${dependency}.js`, `${dependency}.json`];
    const resolvedDependency = candidates.find((candidate) => existsSync(candidate));
    if (!resolvedDependency) {
      throw new Error(`Could not resolve ${match[1]} imported by ${normalized}`);
    }
    copyRuntimeFile(relative(projectRoot, resolvedDependency));
  }
}

function copyNodePackage(packageName, manifestPath) {
  if (copiedNodePackages.has(packageName)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const packageRoot = dirname(manifestPath);
  const targetRoot = join(runtimeRoot, "node_modules", ...packageName.split("/"));
  cpSync(packageRoot, targetRoot, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const nested = relative(packageRoot, source);
      return nested === "" || nested.split(sep)[0] !== "node_modules";
    },
  });
  copiedNodePackages.set(packageName, String(manifest.version || "unknown"));

  const requireFromPackage = createRequire(manifestPath);
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    copyNodePackage(dependency, resolvePackageManifest(requireFromPackage, dependency));
  }
}

function signMacBinary(path) {
  if (process.platform !== "darwin") return;
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || "-";
  const entitlements = join(projectRoot, "src-tauri", "LinkEntitlements.plist");
  const args = ["--force", "--options", "runtime"];
  if (identity !== "-") args.push("--timestamp");
  if (existsSync(entitlements)) args.push("--entitlements", entitlements);
  args.push("--sign", identity, path);
  run("/usr/bin/codesign", args);
}

async function copyNodeLicense(licenseRoot) {
  const target = join(licenseRoot, "Node.js-LICENSE");
  const nodeDirectory = dirname(process.execPath);
  const localLicense = [
    join(nodeDirectory, "LICENSE"),
    resolve(nodeDirectory, "../LICENSE"),
    resolve(nodeDirectory, "../../LICENSE"),
  ].find((candidate) => existsSync(candidate));
  if (localLicense) {
    copyLicenseFile(localLicense, target);
    return;
  }

  const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
  const response = await fetch(licenseUrl);
  if (!response.ok) {
    throw new Error(`Could not download the Node.js ${process.version} license: HTTP ${response.status}`);
  }
  const contents = await response.text();
  if (!contents.startsWith("Node.js is licensed for use as follows:") || contents.length < 100_000) {
    throw new Error(`Downloaded Node.js ${process.version} license did not match the expected format`);
  }
  writeFileSync(target, contents);
  chmodSync(target, 0o644);
}

async function copyRuntimeLicenses() {
  const licenseRoot = join(runtimeRoot, "licenses");
  mkdirSync(licenseRoot, { recursive: true });
  copyLicenseFile(join(projectRoot, "LICENSE"), join(licenseRoot, "HivemindOS-LICENSE"));
  await copyNodeLicense(licenseRoot);

  const goModules = capture("go", [
    "list",
    "-m",
    "-f",
    "{{if .Dir}}{{.Path}}\t{{.Version}}\t{{.Dir}}{{end}}",
    "all",
  ]);
  const moduleNotices = [];
  for (const line of goModules.split(/\r?\n/).filter(Boolean)) {
    const [modulePath, version, directory] = line.split("\t");
    if (!modulePath || !directory) continue;
    const noticeFiles = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[.].*)?$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (noticeFiles.length === 0) continue;
    const moduleDirectory = join(
      licenseRoot,
      "go",
      `${modulePath.replace(/[^a-zA-Z0-9._-]+/g, "_")}${version ? `@${version}` : ""}`,
    );
    mkdirSync(moduleDirectory, { recursive: true });
    for (const notice of noticeFiles) {
      copyLicenseFile(join(directory, notice), join(moduleDirectory, notice));
    }
    moduleNotices.push({ module: modulePath, version: version || null, notices: noticeFiles });
  }
  writeFileSync(
    join(licenseRoot, "go-modules.json"),
    `${JSON.stringify({ schemaVersion: 1, modules: moduleNotices }, null, 2)}\n`,
  );
  return moduleNotices.length;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  throw new Error(`HivemindOS Link runtime requires Node 22+; active builder is ${process.version}`);
}
if (!existsSync(process.execPath) || !statSync(process.execPath).isFile()) {
  throw new Error(`Active Node executable was not found at ${process.execPath}`);
}

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeScripts, { recursive: true });

for (const entrypoint of runtimeScriptEntrypoints) copyRuntimeFile(entrypoint);
copyRuntimeFile("contracts/app-builder/v1.json");
const requireFromProject = createRequire(join(projectRoot, "package.json"));
copyNodePackage(
  "bonjour-service",
  resolvePackageManifest(requireFromProject, "bonjour-service"),
);

const nodeTarget = join(runtimeRoot, nodeBinaryName);
copyFileSync(process.execPath, nodeTarget);
if (process.platform !== "win32") chmodSync(nodeTarget, 0o755);

const linkTarget = join(runtimeRoot, linkBinaryName);
const buildCommit = process.env.GITHUB_SHA?.slice(0, 12) || "unknown";
const buildTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
run("go", [
  "build",
  "-trimpath",
  "-ldflags",
  `-X main.buildCommit=${buildCommit} -X main.buildTime=${buildTime}`,
  "-o",
  linkTarget,
  "./cmd/hivemind-linkd",
]);
if (process.platform !== "win32") chmodSync(linkTarget, 0o755);

signMacBinary(nodeTarget);
signMacBinary(linkTarget);
const licensedGoModules = await copyRuntimeLicenses();

writeFileSync(
  join(runtimeRoot, "runtime-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      nodeSha256: sha256(nodeTarget),
      linkSha256: sha256(linkTarget),
      collectorSha256: sha256(join(runtimeScripts, "agent-telemetry-collector.mjs")),
      nodePackages: Object.fromEntries([...copiedNodePackages].sort(([a], [b]) => a.localeCompare(b))),
      licensedGoModules,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

console.log(`Prepared HivemindOS Link runtime in ${runtimeRoot}`);
