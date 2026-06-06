import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
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
const nextStaticBuildDir = join(projectRoot, ".next-tauri-static-build");
const nextStaticOutDir = join(projectRoot, "out");
const nextStaticExportDirs = [nextStaticBuildDir, nextStaticOutDir];
const appApiDir = join(projectRoot, "src", "app", "api");
const staticHiddenApiDir = join(projectRoot, ".next-tauri", "hidden-app-api");
const resourcesDir = join(projectRoot, "src-tauri", "resources");
const staticResourceDir = join(projectRoot, "src-tauri", "static");
const serverResourceDir = join(resourcesDir, "hivemindos-next");
const nodeResourceDir = join(resourcesDir, "hivemindos-node");
const standaloneDir = join(nextBuildDir, "standalone");
const standaloneServer = join(standaloneDir, "server.js");
const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
const buildMemoryMb = process.env.TAURI_NEXT_BUILD_MEMORY_MB || "9000";
const buildTimeoutSeconds = process.env.TAURI_NEXT_BUILD_TIMEOUT_SECONDS || "1800";
const embeddedNextMode = process.env.HIVEMINDOS_TAURI_EMBEDDED_NEXT === "1";
const originalNextEnv = existsSync(nextEnvPath) ? readFileSync(nextEnvPath, "utf8") : null;
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      ...options.env,
    },
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

function runStaticNextBuild() {
  const env = {
    HIVEMINDOS_TAURI_STATIC_BUILD: "1",
  };
  const nextBuildArgs = ["exec", "next", "build", "--webpack"];

  if (process.platform === "win32") {
    run(pnpmCommand, nextBuildArgs, { env });
    return;
  }

  run("scripts/run-with-memory-limit.sh", [
    "--limit-mb",
    buildMemoryMb,
    "--timeout-seconds",
    buildTimeoutSeconds,
    "--",
    "pnpm",
    ...nextBuildArgs,
  ], { env });
}

function restoreStaticHiddenApiRoutes() {
  if (existsSync(staticHiddenApiDir) && !existsSync(appApiDir)) {
    mkdirSync(dirname(appApiDir), { recursive: true });
    renameSync(staticHiddenApiDir, appApiDir);
  }
}

function hideApiRoutesForStaticBuild() {
  restoreStaticHiddenApiRoutes();
  rmSync(staticHiddenApiDir, { force: true, recursive: true });
  if (existsSync(appApiDir)) {
    mkdirSync(dirname(staticHiddenApiDir), { recursive: true });
    renameSync(appApiDir, staticHiddenApiDir);
  }
  if (existsSync(appApiDir)) {
    throw new Error("Static Tauri export could not hide src/app/api routes.");
  }
}

function restoreNextEnv() {
  if (originalNextEnv === null) {
    return;
  }

  if (!existsSync(nextEnvPath) || readFileSync(nextEnvPath, "utf8") !== originalNextEnv) {
    writeFileSync(nextEnvPath, originalNextEnv);
  }
}

function writeBuildNextEnv() {
  writeFileSync(nextEnvPath, [
    '/// <reference types="next" />',
    '/// <reference types="next/image-types/global" />',
    "",
    "// NOTE: This file should not be edited",
    "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
    "",
  ].join("\n"));
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

function prunePackagedBuildArtifacts() {
  rmSync(join(serverResourceDir, ".next-tauri-build", "cache"), { force: true, recursive: true });
  rmSync(join(serverResourceDir, ".next-tauri-build", "diagnostics"), { force: true, recursive: true });

  for (const filePath of collectFiles(serverResourceDir, (candidate) => {
    const fileName = basename(candidate);
    return fileName.endsWith(".map")
      || fileName.endsWith(".d.ts")
      || fileName.endsWith(".tsbuildinfo")
      || fileName.endsWith(".nft.json")
      || fileName === ".DS_Store";
  })) {
    rmSync(filePath, { force: true });
  }
}

function optimizePackagedPngAssets(root = join(serverResourceDir, "public")) {
  const versionResult = spawnSync("oxipng", ["--version"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (versionResult.status !== 0) {
    return;
  }

  const pngFiles = collectFiles(root, (filePath) => extname(filePath).toLowerCase() === ".png");
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

function pruneStaticNativeResources(root) {
  for (const path of [
    "AppIcon-large-bee.icon",
    "AppIcon-variation-1.icon",
    "AppIcon.icon",
    "app-icon-1024-imagegen-backup.png",
    "app-icon-1024.png",
    "app-icon-large-bee-1024.png",
    "app-icon-variation-1-1024.png",
    "favicon copy.png",
    "icons/generated/app-icon-large-bee-tauri",
    "icons/generated/app-icon-variation-1-tauri",
    "icons/generated/app-icon-variation-1-web",
    "icons/generated/hivemindos-bee-hives-large-transparent.png",
    "icons/generated/hivemindos-bee-hives-social-transparent.png",
    "icons/generated/hivemindos-bee-hives-transparent.png",
    "icons/generated/hivemindos-bee-hives-variation-1-social-transparent.png",
    "icons/generated/hivemindos-bee-hives-variation-1-transparent.png",
    "icons/generated/honey-hive-icon-key.png",
    "icons/generated/honey-pot-key.png",
    "readme",
  ]) {
    rmSync(join(root, path), { force: true, recursive: true });
  }

  for (const filePath of collectFiles(root, (candidate) => basename(candidate) === ".DS_Store")) {
    rmSync(filePath, { force: true });
  }

  writeFileSync(join(root, "README.md"), "# Static Tauri UI\n\nGenerated by `pnpm tauri:prepare`.\n");
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

function buildEmbeddedNextResources() {
  rmSync(serverResourceDir, { force: true, recursive: true });
  rmSync(nodeResourceDir, { force: true, recursive: true });
  rmSync(staticResourceDir, { force: true, recursive: true });
  mkdirSync(resourcesDir, { recursive: true });
  mkdirSync(staticResourceDir, { recursive: true });
  writeFileSync(join(staticResourceDir, "README.md"), "# Static Tauri UI\n\nRun `pnpm tauri:prepare` without `HIVEMINDOS_TAURI_EMBEDDED_NEXT=1` to regenerate this directory.\n");

  try {
    writeBuildNextEnv();
    run("scripts/run-with-memory-limit.sh", [
      "--limit-mb",
      buildMemoryMb,
      "--timeout-seconds",
      buildTimeoutSeconds,
      "--",
      "pnpm",
      "exec",
      "next",
      "build",
    ], {
      env: {
        HIVEMINDOS_TAURI_BUILD: "1",
      },
    });
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
  prunePackagedBuildArtifacts();
  optimizePackagedPngAssets();
  copyNodeBinary();

  console.log(`Prepared embedded Tauri Next server resources in ${basename(resourcesDir)}/`);
}

function buildStaticNativeResources() {
  rmSync(staticResourceDir, { force: true, recursive: true });
  rmSync(serverResourceDir, { force: true, recursive: true });
  rmSync(nodeResourceDir, { force: true, recursive: true });
  rmSync(nextBuildDir, { force: true, recursive: true });
  rmSync(nextStaticBuildDir, { force: true, recursive: true });
  rmSync(nextStaticOutDir, { force: true, recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  hideApiRoutesForStaticBuild();
  try {
    writeBuildNextEnv();
    runStaticNextBuild();
  } finally {
    restoreStaticHiddenApiRoutes();
    restoreNextEnv();
  }

  const exportDir = nextStaticExportDirs.find((candidate) => existsSync(join(candidate, "index.html")));
  if (!exportDir) {
    throw new Error(`Next static export was not generated at ${nextStaticExportDirs.join(" or ")}`);
  }

  mkdirSync(staticResourceDir, { recursive: true });
  cpSync(exportDir, staticResourceDir, { recursive: true });
  pruneStaticNativeResources(staticResourceDir);
  optimizePackagedPngAssets(staticResourceDir);
  console.log(`Prepared static Tauri UI resources in ${basename(staticResourceDir)}/`);
}

if (embeddedNextMode) {
  buildEmbeddedNextResources();
} else {
  buildStaticNativeResources();
}
