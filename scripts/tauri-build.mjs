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
import { createHash } from "node:crypto";
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
// The same entitlements the Tauri bundler signs the app with. The bundled node
// sidecar JIT-compiles, so it must be signed WITH these (allow-jit /
// allow-unsigned-executable-memory) under the hardened runtime or macOS kills it
// on boot. Keep this in lockstep with tauri.conf.json's bundle.macOS.entitlements.
const macEntitlementsPath = join(projectRoot, "src-tauri", "Entitlements.plist");
const serverResourceDir = join(resourcesDir, "hivemindos-next");
const nodeResourceDir = join(resourcesDir, "hivemindos-node");
const backgroundHelperSource = join(
  projectRoot,
  "scripts",
  "hivemindos-background-helper.c",
);
const backgroundHelpers =
  process.platform === "darwin"
    ? [
        {
          resourceDir: "hivemindos-collector-helper",
          binaryName: "HivemindOS Collector",
          identifier: "com.hivemindos.collector-helper",
        },
        {
          resourceDir: "hivemindos-sync-helper",
          binaryName: "HivemindOS Sync",
          identifier: "com.hivemindos.sync-helper",
        },
        {
          resourceDir: "hivemindos-voice-worker-helper",
          binaryName: "HivemindOS Voice Worker",
          identifier: "com.hivemindos.voice-worker-helper",
        },
      ]
    : [];
const standaloneDir = join(nextBuildDir, "standalone");
const standaloneServer = join(standaloneDir, "server.js");
const embeddedFingerprintFile = join(
  nextBuildDir,
  ".hivemindos-embedded-fingerprint.json",
);
const packagedFingerprintFile = join(
  serverResourceDir,
  ".hivemindos-embedded-fingerprint.json",
);
const nodeBinaryName = process.platform === "win32" ? "node.exe" : "node";
const buildMemoryMb = process.env.TAURI_NEXT_BUILD_MEMORY_MB || "12000";
// V8 old-space heap for the EMBEDDED build's `next build`. The embedded build
// compiles all ~155 API routes (the static build hides them), which exceeds
// Node's ~4 GB default heap and OOMs. 8 GB is comfortable on a dev Mac; lower
// it (e.g. on a small CI runner) via TAURI_NEXT_BUILD_HEAP_MB. Keep it well
// under buildMemoryMb so the RSS watchdog above doesn't kill the build.
const buildHeapMb = process.env.TAURI_NEXT_BUILD_HEAP_MB || "8192";
const buildTimeoutSeconds =
  process.env.TAURI_NEXT_BUILD_TIMEOUT_SECONDS || "1800";
const embeddedNextMode = process.env.HIVEMINDOS_TAURI_EMBEDDED_NEXT === "1";
const forceEmbeddedNextBuild =
  process.env.HIVEMINDOS_TAURI_FORCE_NEXT_BUILD === "1";
const reuseEmbeddedNextBuild =
  process.env.HIVEMINDOS_TAURI_REUSE_EMBEDDED_NEXT !== "0";
const optimizePngAssets = process.env.HIVEMINDOS_TAURI_OPTIMIZE_PNGS === "1";
const originalNextEnv = existsSync(nextEnvPath)
  ? readFileSync(nextEnvPath, "utf8")
  : null;

const embeddedFingerprintInputs = [
  "components.json",
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "postcss.config.mjs",
  "scripts/tauri-build.mjs",
  "src",
  "tsconfig.json",
  "public",
];

const skippedFingerprintDirs = new Set([
  ".git",
  ".next",
  ".next-tauri",
  ".next-tauri-build",
  ".next-tauri-static-build",
  "node_modules",
  "out",
  "src-tauri/target",
]);

const skippedFingerprintFileNames = new Set([".DS_Store"]);

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
    throw new Error(
      `${command} ${args.join(" ")} failed to start: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`,
    );
  }
}

function runStaticNextBuild() {
  const env = {
    HIVEMINDOS_TAURI_STATIC_BUILD: "1",
  };
  const nextBuildArgs = ["exec", "next", "build", "--webpack"];

  if (process.platform === "win32") {
    run(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/c", "pnpm", ...nextBuildArgs],
      { env },
    );
    return;
  }

  run(
    "scripts/run-with-memory-limit.sh",
    [
      "--limit-mb",
      buildMemoryMb,
      "--timeout-seconds",
      buildTimeoutSeconds,
      "--",
      "pnpm",
      ...nextBuildArgs,
    ],
    { env },
  );
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

  if (
    !existsSync(nextEnvPath) ||
    readFileSync(nextEnvPath, "utf8") !== originalNextEnv
  ) {
    writeFileSync(nextEnvPath, originalNextEnv);
  }
}

function writeBuildNextEnv() {
  writeFileSync(
    nextEnvPath,
    [
      '/// <reference types="next" />',
      '/// <reference types="next/image-types/global" />',
      "",
      "// NOTE: This file should not be edited",
      "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
      "",
    ].join("\n"),
  );
}

function normalizePathForFingerprint(path) {
  return path.slice(projectRoot.length + 1).replace(/\\/g, "/");
}

function fingerprintPathIsSkipped(path) {
  const relativePath = normalizePathForFingerprint(path);
  return [...skippedFingerprintDirs].some(
    (skipped) =>
      relativePath === skipped || relativePath.startsWith(`${skipped}/`),
  );
}

function addFingerprintPath(hash, path, files) {
  if (!existsSync(path) || fingerprintPathIsSkipped(path)) {
    return;
  }

  const stats = statSync(path);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      addFingerprintPath(hash, join(path, entry.name), files);
    }
    return;
  }

  if (!stats.isFile()) {
    return;
  }

  if (skippedFingerprintFileNames.has(basename(path))) {
    return;
  }

  files.push(path);
}

function buildEmbeddedFingerprint() {
  const files = [];
  const hash = createHash("sha256");

  for (const input of embeddedFingerprintInputs) {
    addFingerprintPath(hash, join(projectRoot, input), files);
  }

  const sortedFiles = files.sort((left, right) =>
    normalizePathForFingerprint(left).localeCompare(
      normalizePathForFingerprint(right),
    ),
  );
  for (const file of sortedFiles) {
    const relativePath = normalizePathForFingerprint(file);
    const stats = statSync(file);
    hash.update("file\0");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(stats.size));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }

  for (const [name, value] of Object.entries(process.env).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    hash.update("env\0");
    hash.update(name);
    hash.update("\0");
    hash.update(value ?? "");
    hash.update("\0");
  }

  hash.update("node\0");
  hash.update(process.version);
  hash.update("\0");
  hash.update(process.platform);
  hash.update("\0");
  hash.update(process.arch);
  hash.update("\0");
  hash.update(buildHeapMb);
  hash.update("\0");
  hash.update(buildMemoryMb);

  return {
    version: 1,
    mode: "embedded-next-webpack",
    hash: hash.digest("hex"),
    fileCount: sortedFiles.length,
    inputs: embeddedFingerprintInputs,
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  };
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function fingerprintsMatch(left, right) {
  return Boolean(
    left &&
    right &&
    left.version === right.version &&
    left.mode === right.mode &&
    left.hash === right.hash,
  );
}

function packagedEmbeddedResourcesAreReusable(fingerprint) {
  if (forceEmbeddedNextBuild || !reuseEmbeddedNextBuild) {
    return false;
  }

  if (
    !existsSync(join(serverResourceDir, "server.js")) ||
    !existsSync(join(nodeResourceDir, nodeBinaryName))
  ) {
    return false;
  }

  return fingerprintsMatch(fingerprint, readJsonFile(packagedFingerprintFile));
}

function standaloneBuildIsReusable(fingerprint) {
  if (forceEmbeddedNextBuild || !reuseEmbeddedNextBuild) {
    return false;
  }

  if (!existsSync(standaloneServer)) {
    return false;
  }

  return fingerprintsMatch(fingerprint, readJsonFile(embeddedFingerprintFile));
}

function writeEmbeddedFingerprint(path, fingerprint) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        ...fingerprint,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function copyNodeBinary() {
  const nodeSource = process.execPath;
  const nodeTarget = join(nodeResourceDir, nodeBinaryName);

  if (!existsSync(nodeSource) || !statSync(nodeSource).isFile()) {
    throw new Error(
      `Unable to find the active Node.js binary at ${nodeSource}`,
    );
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
    const detail =
      result.stderr?.trim() || result.stdout?.trim() || "no output";
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
}

function optimizeMacosNodeBinary(path) {
  if (process.platform !== "darwin") {
    return;
  }

  runQuiet("/usr/bin/strip", ["-x", path]);
  const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
  // Sign node WITH the app entitlements (allow-jit etc.). Without them a
  // hardened-runtime node is killed by the kernel the instant V8 JITs, so the
  // embedded server never opens its port and the app crashes on launch. Ad-hoc
  // local builds (no Developer ID) also get the entitlements so a self-signed
  // dev DMG behaves like the released one.
  const entitlementsArgs = existsSync(macEntitlementsPath)
    ? ["--entitlements", macEntitlementsPath]
    : [];
  const signArgs = signingIdentity
    ? [
        "--force",
        "--timestamp",
        "--options",
        "runtime",
        ...entitlementsArgs,
        "--sign",
        signingIdentity,
        path,
      ]
    : ["--force", "--options", "runtime", ...entitlementsArgs, "--sign", "-", path];
  runQuiet("/usr/bin/codesign", signArgs);
  chmodExecutable(path);
}

function signMacosBackgroundHelper(path, identifier) {
  if (process.platform !== "darwin") {
    return;
  }

  const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
  const signArgs = signingIdentity
    ? [
        "--force",
        "--timestamp",
        "--options",
        "runtime",
        "--sign",
        signingIdentity,
        "-i",
        identifier,
        path,
      ]
    : [
        "--force",
        "--options",
        "runtime",
        "--sign",
        "-",
        "-i",
        identifier,
        path,
      ];
  runQuiet("/usr/bin/codesign", signArgs);
}

function buildBackgroundHelpers() {
  for (const helper of backgroundHelpers) {
    rmSync(join(resourcesDir, helper.resourceDir), {
      force: true,
      recursive: true,
    });
  }
  if (process.platform !== "darwin") {
    return;
  }
  if (!existsSync(backgroundHelperSource)) {
    throw new Error(`Missing background helper source at ${backgroundHelperSource}`);
  }

  for (const helper of backgroundHelpers) {
    const helperResourceDir = join(resourcesDir, helper.resourceDir);
    const helperTarget = join(helperResourceDir, helper.binaryName);
    mkdirSync(helperResourceDir, { recursive: true });
    run("cc", [
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      backgroundHelperSource,
      "-o",
      helperTarget,
    ]);
    chmodExecutable(helperTarget);
    signMacosBackgroundHelper(helperTarget, helper.identifier);
  }
}

function scrubPackagedResources() {
  for (const fileName of [
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
  ]) {
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

  for (const fileName of [
    "components.json",
    "eslint.config.mjs",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
  ]) {
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
  rmSync(join(serverResourceDir, "node_modules", ".pnpm"), {
    force: true,
    recursive: true,
  });
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
      rmSync(join(entryPath, ...packageParts), {
        force: true,
        recursive: true,
      });
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
    removeNestedNodePackage(
      join(serverResourceDir, "node_modules"),
      packageName,
    );
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
  rmSync(join(serverResourceDir, ".next-tauri-build", "cache"), {
    force: true,
    recursive: true,
  });
  rmSync(join(serverResourceDir, ".next-tauri-build", "diagnostics"), {
    force: true,
    recursive: true,
  });
  // Webpack persistent build caches (Remotion's bundler writes ~200 MB of
  // *.pack files into node_modules/.cache/webpack). They get traced into the
  // standalone copy but are build-time only — nothing reads them at runtime.
  // Dropping this roughly halves the packaged app size.
  rmSync(join(serverResourceDir, "node_modules", ".cache"), {
    force: true,
    recursive: true,
  });

  for (const filePath of collectFiles(serverResourceDir, (candidate) => {
    const fileName = basename(candidate);
    return (
      fileName.endsWith(".map") ||
      fileName.endsWith(".d.ts") ||
      fileName.endsWith(".tsbuildinfo") ||
      fileName.endsWith(".nft.json") ||
      fileName === ".DS_Store"
    );
  })) {
    rmSync(filePath, { force: true });
  }
}

function optimizePackagedPngAssets(root = join(serverResourceDir, "public")) {
  if (!optimizePngAssets) {
    return;
  }

  const versionResult = spawnSync("oxipng", ["--version"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (versionResult.status !== 0) {
    return;
  }

  const pngFiles = collectFiles(
    root,
    (filePath) => extname(filePath).toLowerCase() === ".png",
  );
  if (pngFiles.length === 0) {
    return;
  }

  const result = spawnSync(
    "oxipng",
    ["--strip", "safe", "-o", "4", ...pngFiles],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );
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

  for (const filePath of collectFiles(
    root,
    (candidate) => basename(candidate) === ".DS_Store",
  )) {
    rmSync(filePath, { force: true });
  }

  writeFileSync(
    join(root, "README.md"),
    "# Static Tauri UI\n\nGenerated by `pnpm tauri:prepare`.\n",
  );
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
  const source = join(
    projectRoot,
    "node_modules",
    ".pnpm",
    "node_modules",
    ...packageName.split("/"),
  );
  const target = join(
    serverResourceDir,
    "node_modules",
    ...packageName.split("/"),
  );

  if (!existsSync(source)) {
    throw new Error(
      `Unable to find required runtime package ${packageName} at ${source}`,
    );
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

function writeEmbeddedStaticStub() {
  mkdirSync(staticResourceDir, { recursive: true });
  writeFileSync(
    join(staticResourceDir, "README.md"),
    "# Static Tauri UI\n\nRun `pnpm tauri:prepare` without `HIVEMINDOS_TAURI_EMBEDDED_NEXT=1` to regenerate this directory.\n",
  );
}

function runEmbeddedNextBuild(fingerprint) {
  if (standaloneBuildIsReusable(fingerprint)) {
    console.log(
      `Reusing cached embedded Next standalone build (${fingerprint.hash.slice(0, 12)}). Set HIVEMINDOS_TAURI_FORCE_NEXT_BUILD=1 to rebuild it.`,
    );
    return;
  }

  try {
    writeBuildNextEnv();
    run(
      "scripts/run-with-memory-limit.sh",
      [
        "--limit-mb",
        buildMemoryMb,
        "--timeout-seconds",
        buildTimeoutSeconds,
        "--",
        "pnpm",
        "exec",
        "next",
        "build",
        // Use webpack like the static build does. Turbopack rejects this
        // codebase's `:global {}` CSS module block and the API routes' dynamic
        // execFile/fs patterns; webpack tolerates them.
        "--webpack",
      ],
      {
        env: {
          HIVEMINDOS_TAURI_BUILD: "1",
          NODE_OPTIONS:
            `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=${buildHeapMb}`.trim(),
        },
      },
    );
  } finally {
    restoreNextEnv();
  }

  if (!existsSync(standaloneServer)) {
    throw new Error(
      `Next standalone server was not generated at ${standaloneServer}`,
    );
  }

  writeEmbeddedFingerprint(embeddedFingerprintFile, fingerprint);
}

function copyEmbeddedNextResources(fingerprint) {
  rmSync(serverResourceDir, { force: true, recursive: true });
  rmSync(nodeResourceDir, { force: true, recursive: true });
  mkdirSync(serverResourceDir, { recursive: true });
  cpSync(standaloneDir, serverResourceDir, { recursive: true });

  const staticDir = join(nextBuildDir, "static");
  if (existsSync(staticDir)) {
    cpSync(staticDir, join(serverResourceDir, ".next-tauri-build", "static"), {
      recursive: true,
    });
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
  writeEmbeddedFingerprint(packagedFingerprintFile, fingerprint);

  console.log(
    `Prepared embedded Tauri Next server resources in ${basename(resourcesDir)}/`,
  );
}

function buildEmbeddedNextResources() {
  const fingerprint = buildEmbeddedFingerprint();
  mkdirSync(resourcesDir, { recursive: true });
  rmSync(staticResourceDir, { force: true, recursive: true });
  writeEmbeddedStaticStub();
  buildBackgroundHelpers();

  if (packagedEmbeddedResourcesAreReusable(fingerprint)) {
    console.log(
      `Reusing prepared embedded Tauri Next resources (${fingerprint.hash.slice(0, 12)}). Set HIVEMINDOS_TAURI_FORCE_NEXT_BUILD=1 to rebuild them.`,
    );
    return;
  }

  runEmbeddedNextBuild(fingerprint);
  copyEmbeddedNextResources(fingerprint);
}

function buildStaticNativeResources() {
  rmSync(staticResourceDir, { force: true, recursive: true });
  rmSync(serverResourceDir, { force: true, recursive: true });
  rmSync(nodeResourceDir, { force: true, recursive: true });
  rmSync(nextBuildDir, { force: true, recursive: true });
  rmSync(nextStaticBuildDir, { force: true, recursive: true });
  rmSync(nextStaticOutDir, { force: true, recursive: true });
  mkdirSync(resourcesDir, { recursive: true });
  buildBackgroundHelpers();

  hideApiRoutesForStaticBuild();
  try {
    writeBuildNextEnv();
    runStaticNextBuild();
  } finally {
    restoreStaticHiddenApiRoutes();
    restoreNextEnv();
  }

  const exportDir = nextStaticExportDirs.find((candidate) =>
    existsSync(join(candidate, "index.html")),
  );
  if (!exportDir) {
    throw new Error(
      `Next static export was not generated at ${nextStaticExportDirs.join(" or ")}`,
    );
  }

  mkdirSync(staticResourceDir, { recursive: true });
  cpSync(exportDir, staticResourceDir, { recursive: true });
  pruneStaticNativeResources(staticResourceDir);
  optimizePackagedPngAssets(staticResourceDir);
  console.log(
    `Prepared static Tauri UI resources in ${basename(staticResourceDir)}/`,
  );
}

if (embeddedNextMode) {
  buildEmbeddedNextResources();
} else {
  buildStaticNativeResources();
}
