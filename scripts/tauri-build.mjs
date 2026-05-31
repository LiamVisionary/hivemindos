import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const nextEnvPath = join(projectRoot, "next-env.d.ts");
const nextBuildDir = join(projectRoot, ".next-tauri-build");
const resourcesDir = join(projectRoot, "src-tauri", "resources");
const serverResourceDir = join(resourcesDir, "hivemindos-next");
const nodeResourceDir = join(resourcesDir, "hivemindos-node");
const standaloneDir = join(nextBuildDir, "standalone");
const standaloneServer = join(standaloneDir, "server.js");
const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
const buildTimeoutSeconds = process.env.TAURI_NEXT_BUILD_TIMEOUT_SECONDS || "1800";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      HIVEMINDOS_TAURI_BUILD: "1",
      ...options.env,
    },
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

function restoreNextEnv() {
  if (!existsSync(nextEnvPath)) {
    return;
  }

  const current = readFileSync(nextEnvPath, "utf8");
  const restored = current.replace(
    'import "./.next-tauri-build/types/routes.d.ts";',
    'import "./.next/dev/types/routes.d.ts";',
  );
  if (restored !== current) {
    writeFileSync(nextEnvPath, restored);
  }
}

function copyNodeBinary() {
  const nodeSource = process.execPath;
  const nodeTarget = join(nodeResourceDir, nodeBinaryName);

  if (!existsSync(nodeSource) || !statSync(nodeSource).isFile()) {
    throw new Error(`Unable to find the active Node.js binary at ${nodeSource}`);
  }

  mkdirSync(dirname(nodeTarget), { recursive: true });
  copyFileSync(nodeSource, nodeTarget);

  if (process.platform !== "win32") {
    chmodExecutable(nodeTarget);
    optimizeMacosNodeBinary(nodeTarget);
  }
}

function chmodExecutable(path) {
  chmodSync(path, 0o755);
}

function runQuiet(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || "no output";
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function optimizeMacosNodeBinary(path) {
  if (process.platform !== "darwin") {
    return;
  }

  runQuiet("/usr/bin/strip", ["-x", path]);
  runQuiet("/usr/bin/codesign", ["--force", "--sign", "-", path]);
  chmodExecutable(path);
}

function scrubPackagedResources() {
  for (const fileName of [".env", ".env.local", ".env.development", ".env.production"]) {
    rmSync(join(serverResourceDir, fileName), { force: true });
  }
  rmSync(join(serverResourceDir, "public", ".DS_Store"), { force: true });

  for (const path of [
    ".git",
    ".next",
    ".next-tauri",
    "artifacts",
    "bin",
    "docs",
    "emoji-atlas-visual-asset",
    "emoji-site",
    "skills",
    "src-tauri",
    "workers",
  ]) {
    rmSync(join(serverResourceDir, path), { force: true, recursive: true });
  }

  for (const fileName of [
    "AGENTS.md",
    "ASSIMILATION.json",
    "ASSIMILATION_LOG.jsonl",
    "ASSIMILATION_LOG.md",
    "CHANGELOG.md",
    "ROADMAP.md",
    "README.md",
    "go.mod",
    "go.sum",
    "setup.ps1",
    "setup.sh",
    "tsconfig.tsbuildinfo",
    "uninstall.ps1",
    "uninstall.sh",
  ]) {
    rmSync(join(serverResourceDir, fileName), { force: true });
  }
}

function pruneNativeOnlyResources() {
  for (const path of [
    "cmd",
    "scripts",
    "src",
    "public/readme",
    "public/icons/generated/honey-hive-icon-key.png",
    "public/icons/generated/honey-pot-key.png",
  ]) {
    rmSync(join(serverResourceDir, path), { force: true, recursive: true });
  }

  for (const fileName of ["components.json", "eslint.config.mjs", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json"]) {
    rmSync(join(serverResourceDir, fileName), { force: true });
  }
}

function collectFiles(root, predicate, files = []) {
  if (!existsSync(root)) {
    return files;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      collectFiles(entryPath, predicate, files);
      continue;
    }

    if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

function prunePnpmPackages(prefixes) {
  const pnpmDir = join(serverResourceDir, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) {
    return;
  }

  for (const entry of readdirSync(pnpmDir)) {
    if (prefixes.some((prefix) => entry.startsWith(prefix))) {
      rmSync(join(pnpmDir, entry), { force: true, recursive: true });
    }
  }
}

function pruneMaterializedPnpmStore() {
  rmSync(join(serverResourceDir, "node_modules", ".pnpm"), { force: true, recursive: true });
}

function removeNestedNodePackage(root, packageName) {
  if (!existsSync(root)) {
    return;
  }

  const packageParts = packageName.split("/");
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === "node_modules") {
      rmSync(join(entryPath, ...packageParts), { force: true, recursive: true });
    }

    removeNestedNodePackage(entryPath, packageName);
  }
}

function pruneImageOptimizerRuntime() {
  prunePnpmPackages(["sharp@", "@img+sharp-", "@img+colour@", "detect-libc@"]);

  for (const packageName of [
    "@img/colour",
    "@img/sharp-darwin-arm64",
    "@img/sharp-libvips-darwin-arm64",
    "detect-libc",
    "sharp",
  ]) {
    removeNestedNodePackage(join(serverResourceDir, "node_modules"), packageName);
  }

  for (const path of [
    "node_modules/sharp",
    "node_modules/detect-libc",
    "node_modules/@img/colour",
    "node_modules/@img/sharp-darwin-arm64",
    "node_modules/@img/sharp-libvips-darwin-arm64",
    "node_modules/.pnpm/node_modules/sharp",
    "node_modules/.pnpm/node_modules/detect-libc",
    "node_modules/.pnpm/node_modules/@img/colour",
    "node_modules/.pnpm/node_modules/@img/sharp-darwin-arm64",
    "node_modules/.pnpm/node_modules/@img/sharp-libvips-darwin-arm64",
  ]) {
    rmSync(join(serverResourceDir, path), { force: true, recursive: true });
  }
}

function optimizePackagedPngAssets() {
  const versionResult = spawnSync("oxipng", ["--version"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (versionResult.status !== 0) {
    return;
  }

  const pngFiles = collectFiles(join(serverResourceDir, "public"), (filePath) => extname(filePath).toLowerCase() === ".png");
  if (pngFiles.length === 0) {
    return;
  }

  const result = spawnSync("oxipng", ["--strip", "safe", "-o", "4", ...pngFiles], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`oxipng failed with exit code ${result.status ?? 1}`);
  }
}

function materializeResourceSymlinks(root) {
  if (!existsSync(root)) {
    return;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);

    if (entry.isSymbolicLink()) {
      if (!existsSync(entryPath)) {
        rmSync(entryPath, { force: true });
        continue;
      }

      const targetPath = realpathSync(entryPath);
      rmSync(entryPath, { force: true, recursive: true });
      cpSync(targetPath, entryPath, { dereference: true, recursive: true });
    }

    if (statSync(entryPath).isDirectory()) {
      materializeResourceSymlinks(entryPath);
    }
  }
}

function copyRequiredRuntimePackage(packageName) {
  const source = join(projectRoot, "node_modules", ".pnpm", "node_modules", ...packageName.split("/"));
  const target = join(serverResourceDir, "node_modules", ...packageName.split("/"));

  if (!existsSync(source)) {
    throw new Error(`Unable to find required runtime package ${packageName} at ${source}`);
  }
  if (existsSync(target)) {
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { dereference: true, recursive: true });
}

function copyRequiredRuntimePackages() {
  for (const packageName of [
    "@next/env",
    "@swc/helpers",
    "baseline-browser-mapping",
    "caniuse-lite",
    "postcss",
    "styled-jsx",
  ]) {
    copyRequiredRuntimePackage(packageName);
  }
}

rmSync(serverResourceDir, { force: true, recursive: true });
rmSync(nodeResourceDir, { force: true, recursive: true });
mkdirSync(resourcesDir, { recursive: true });

try {
  run("scripts/run-with-memory-limit.sh", [
    "--limit-mb",
    "5000",
    "--timeout-seconds",
    buildTimeoutSeconds,
    "--",
    "pnpm",
    "exec",
    "next",
    "build",
  ]);
} finally {
  restoreNextEnv();
}

if (!existsSync(standaloneServer)) {
  throw new Error(`Next standalone server was not generated at ${standaloneServer}`);
}

mkdirSync(serverResourceDir, { recursive: true });
cpSync(standaloneDir, serverResourceDir, { recursive: true });

const staticDir = join(nextBuildDir, "static");
if (existsSync(staticDir)) {
  cpSync(staticDir, join(serverResourceDir, ".next-tauri-build", "static"), { recursive: true });
}

const publicDir = join(projectRoot, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, join(serverResourceDir, "public"), { recursive: true });
}

scrubPackagedResources();
materializeResourceSymlinks(serverResourceDir);
copyRequiredRuntimePackages();
pruneImageOptimizerRuntime();
pruneNativeOnlyResources();
pruneMaterializedPnpmStore();
optimizePackagedPngAssets();
copyNodeBinary();

console.log(`Prepared Tauri Next server resources in ${basename(resourcesDir)}/`);
