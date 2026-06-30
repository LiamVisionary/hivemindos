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
const startupLoadingAssetDirName = "loading";
const startupBeeLottieSource = join(
  projectRoot,
  "public",
  "animations",
  "Honey bee.lottie",
);
const startupBeeLoaderSource = join(
  projectRoot,
  "src-tauri",
  "loading",
  "bee-lottie-loader.js",
);
const dotLottieWebDistDir = join(
  projectRoot,
  "node_modules",
  "@lottiefiles",
  "dotlottie-web",
  "dist",
);
const dotLottieRuntimeSource = join(dotLottieWebDistDir, "index.js");
const dotLottieWasmSource = join(dotLottieWebDistDir, "dotlottie-player.wasm");
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
const embeddedNextMode = process.env.HIVEMINDOS_TAURI_EMBEDDED_NEXT === "1";
const forceEmbeddedNextBuild =
  process.env.HIVEMINDOS_TAURI_FORCE_NEXT_BUILD === "1";
const reuseEmbeddedNextBuild =
  process.env.HIVEMINDOS_TAURI_REUSE_EMBEDDED_NEXT !== "0";
// Build ONLY the arch-independent Next standalone (no per-platform staging), so
// a single CI job can produce it once and share it to every platform build.
const standaloneOnly =
  process.env.HIVEMINDOS_TAURI_STANDALONE_ONLY === "1";
// A platform build trusts a standalone that a prior job already built and
// downloaded here, skipping its own ~20-min `next build`. The fingerprint is
// platform-specific so the normal reuse check can't match across jobs — this
// flag is the explicit cross-job handoff.
const usePrebuiltStandalone =
  process.env.HIVEMINDOS_TAURI_PREBUILT_STANDALONE === "1";
const embeddedBuildHeapFloorMb = 12288;
const embeddedBuildMemoryReserveMb = 1024;
const buildMemoryMb = String(
  parsePositiveIntegerEnv(
    "TAURI_NEXT_BUILD_MEMORY_MB",
    process.env.TAURI_NEXT_BUILD_MEMORY_MB ||
      (embeddedNextMode ? "14000" : "12000"),
  ),
);
// V8 old-space heap for the EMBEDDED build's `next build`. The embedded build
// compiles all API routes (the static build hides them), which exceeds Node's
// default heap and the old 10 GB local override. Keep it below buildMemoryMb so
// the RSS watchdog has room for non-heap process memory.
const buildHeapMb = String(
  resolveBuildHeapMb(
    parsePositiveIntegerEnv(
      "TAURI_NEXT_BUILD_HEAP_MB",
      process.env.TAURI_NEXT_BUILD_HEAP_MB ||
        (embeddedNextMode ? String(embeddedBuildHeapFloorMb) : "8192"),
    ),
    Number(buildMemoryMb),
  ),
);
const buildTimeoutSeconds =
  process.env.TAURI_NEXT_BUILD_TIMEOUT_SECONDS ||
  (embeddedNextMode ? "3600" : "1800");
const optimizePngAssets = process.env.HIVEMINDOS_TAURI_OPTIMIZE_PNGS === "1";
const originalNextEnv = existsSync(nextEnvPath)
  ? readFileSync(nextEnvPath, "utf8")
  : null;

function parsePositiveIntegerEnv(name, value) {
  if (!/^[0-9]+$/.test(value) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}.`);
  }
  return Number(value);
}

function resolveBuildHeapMb(requestedHeapMb, memoryLimitMb) {
  if (!embeddedNextMode) {
    return requestedHeapMb;
  }

  const maxHeapMb = memoryLimitMb - embeddedBuildMemoryReserveMb;
  if (maxHeapMb < embeddedBuildHeapFloorMb) {
    throw new Error(
      `Embedded Tauri production builds need at least ${embeddedBuildHeapFloorMb} MB of V8 heap plus ${embeddedBuildMemoryReserveMb} MB RSS reserve. ` +
        `Set TAURI_NEXT_BUILD_MEMORY_MB to ${embeddedBuildHeapFloorMb + embeddedBuildMemoryReserveMb} or higher.`,
    );
  }

  if (requestedHeapMb < embeddedBuildHeapFloorMb) {
    console.warn(
      `TAURI_NEXT_BUILD_HEAP_MB=${requestedHeapMb} is below the embedded production floor; using ${embeddedBuildHeapFloorMb} MB.`,
    );
    return embeddedBuildHeapFloorMb;
  }

  if (requestedHeapMb > maxHeapMb) {
    throw new Error(
      `TAURI_NEXT_BUILD_HEAP_MB=${requestedHeapMb} leaves less than ${embeddedBuildMemoryReserveMb} MB RSS reserve under TAURI_NEXT_BUILD_MEMORY_MB=${memoryLimitMb}. ` +
        `Increase TAURI_NEXT_BUILD_MEMORY_MB or lower TAURI_NEXT_BUILD_HEAP_MB.`,
    );
  }

  return requestedHeapMb;
}

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

// Bundle the canonical brain content (skills, packaged skills, For Users / For
// Investors docs) + the sync engine into resources/brain-seed/ so the packaged
// app can seed/refresh the user's vault on first run after an update — the
// release bundle otherwise ships no setup scripts or brain content. The layout
// mirrors what scripts/hive-brain-sync.mjs expects as its --content-base.
function stageBrainSeed() {
  const brainSeedDir = join(resourcesDir, "brain-seed");
  rmSync(brainSeedDir, { force: true, recursive: true });
  mkdirSync(brainSeedDir, { recursive: true });
  const copyTree = (srcRel, destRel) => {
    const src = join(projectRoot, srcRel);
    if (!existsSync(src)) return;
    const dest = join(brainSeedDir, destRel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  };
  copyTree("skills", "skills");
  copyTree("packaged-skills/auto-install", "packaged-skills/auto-install");
  copyTree("docs/for-users", "docs/for-users");
  copyTree("docs/for-investors", "docs/for-investors");
  copyFileSync(
    join(projectRoot, "scripts", "hive-brain-sync.mjs"),
    join(brainSeedDir, "hive-brain-sync.mjs"),
  );
  console.log("Staged brain-seed (skills, packaged skills, docs, sync engine) into resources/brain-seed/");
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

function readRuntimePackageDependencies(packageDir) {
  const packageJsonPath = join(packageDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return [];
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return Object.keys(packageJson.dependencies ?? {});
}

function packageNodeModulesDirForSource(packageDir, packageName) {
  const segments = packageName.split("/");
  return segments.length === 2 && segments[0].startsWith("@")
    ? dirname(dirname(packageDir))
    : dirname(packageDir);
}

function resolveRuntimePackageSource(packageName, sourceNodeModulesDirs = []) {
  // Resolve the package's REAL directory. pnpm puts DIRECT deps (react,
  // react-dom) behind a top-level symlink and hoists TRANSITIVE deps
  // (scheduler, @next/env, ...) under .pnpm/node_modules — check both, then
  // dereference the symlink so we copy real files, not a (possibly dangling)
  // link. This is why the original `.pnpm/node_modules`-only lookup could never
  // stage react/react-dom: they don't live there.
  const segments = packageName.split("/");
  const candidates = [
    ...sourceNodeModulesDirs.map((nodeModulesDir) => join(nodeModulesDir, ...segments)),
    join(projectRoot, "node_modules", ...segments),
    join(projectRoot, "node_modules", ".pnpm", "node_modules", ...segments),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Unable to find required runtime package ${packageName} (looked in: ${candidates.join(", ")})`,
    );
  }
  return realpathSync(found);
}

function copyRuntimePackageIntoNodeModules(packageName, targetNodeModulesDir, seen = new Set(), options = {}) {
  const seenKey = `${targetNodeModulesDir}\0${packageName}`;
  if (seen.has(seenKey)) {
    return;
  }
  seen.add(seenKey);

  const segments = packageName.split("/");
  const source = resolveRuntimePackageSource(packageName, options.sourceNodeModulesDirs ?? []);
  const target = join(targetNodeModulesDir, ...segments);

  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    // Skip native addons (*.node) when staging the runtime closure. An UNSIGNED
    // .node anywhere in the .app fails Apple notarization ("binary is not signed
    // with a valid Developer ID certificate") and rejects the whole archive.
    // The staged crypto packages fall back to pure JS when their native addon is
    // absent (e.g. bigint-buffer: try require('bindings') -> catch -> JS path),
    // so dropping the .node keeps the runtime working AND lets the app notarize.
    // (If a future dep hard-requires its addon, codesign it here instead.)
    cpSync(source, target, {
      dereference: true,
      recursive: true,
      filter: (src) => !src.endsWith(".node"),
    });
  }

  if (options.sourceStack?.includes(source)) {
    return;
  }

  const sourceNodeModulesDir = packageNodeModulesDirForSource(source, packageName);
  const sourceStack = [...(options.sourceStack ?? []), source];
  for (const dependencyName of readRuntimePackageDependencies(source)) {
    copyRuntimePackageIntoNodeModules(dependencyName, targetNodeModulesDir, seen, {
      sourceNodeModulesDirs: [sourceNodeModulesDir, ...(options.sourceNodeModulesDirs ?? [])],
      sourceStack,
    });
  }
}

function copyRequiredRuntimePackage(packageName, seen = new Set()) {
  copyRuntimePackageIntoNodeModules(packageName, join(serverResourceDir, "node_modules"), seen);
}

function copyPackageLocalRuntimeDependencyIsland(packageName, dependencyNames, seen = new Set()) {
  const packageSource = resolveRuntimePackageSource(packageName);
  const packageTarget = join(serverResourceDir, "node_modules", ...packageName.split("/"));
  const sourceNodeModulesDir = packageNodeModulesDirForSource(packageSource, packageName);
  const targetNodeModulesDir = join(packageTarget, "node_modules");

  for (const dependencyName of dependencyNames) {
    copyRuntimePackageIntoNodeModules(dependencyName, targetNodeModulesDir, seen, {
      sourceNodeModulesDirs: [sourceNodeModulesDir],
      sourceStack: [packageSource],
    });
  }
}

function copyRequiredRuntimePackages() {
  const seen = new Set();
  for (const packageName of [
    "@next/env",
    "@swc/helpers",
    "baseline-browser-mapping",
    "caniuse-lite",
    "postcss",
    "styled-jsx",
    // The Lottie loading animation route (/loading/dotlottie-player.wasm) reads
    // node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm at
    // runtime. Next's trace keeps it only under .pnpm, which materialize+prune
    // deletes — so the packaged server 500s on that route. Stage the package so
    // its dist/*.wasm lands at the top-level node_modules path the route expects.
    "@lottiefiles/dotlottie-web",
    // Wallet/trading routes are imported by shared chat/status modules at
    // route-load time. Stage the root packages and their dependency closure so
    // production chat cannot crash before the route handler starts.
    "@solana/kit",
    "@solana/spl-token",
    "@solana/web3.js",
    "viem",
    "@noble/curves",
    "@noble/hashes",
    "@scure/base",
    "@scure/bip32",
    "@scure/bip39",
    // React runtime — required for SSR / RSC. materializeResourceSymlinks drops
    // these as dangling pnpm symlinks and the standalone trace does not re-add
    // them, so the embedded server crashed on boot with "Cannot find module
    // 'react'" (verified: staging react + react-dom + scheduler makes server.js
    // boot and serve / + /api/* correctly). react / react-dom are direct deps
    // (top-level symlinks); scheduler is react-dom's hoisted transitive dep.
    "react",
    "react-dom",
    "scheduler",
  ]) {
    copyRequiredRuntimePackage(packageName, seen);
  }
  copyPackageLocalRuntimeDependencyIsland("@solana/spl-token-metadata", ["@solana/codecs"], seen);
}

function copyStartupBeeLottieAssets(destinationRoot) {
  const loadingAssetDir = join(destinationRoot, startupLoadingAssetDirName);
  mkdirSync(loadingAssetDir, { recursive: true });
  copyFileSync(
    startupBeeLoaderSource,
    join(loadingAssetDir, "bee-lottie-loader.js"),
  );
  copyFileSync(
    startupBeeLottieSource,
    join(loadingAssetDir, "Honey bee.lottie"),
  );
  copyFileSync(dotLottieRuntimeSource, join(loadingAssetDir, "dotlottie.js"));
  copyFileSync(
    dotLottieWasmSource,
    join(loadingAssetDir, "dotlottie-player.wasm"),
  );
}

function writeEmbeddedStaticStub() {
  mkdirSync(staticResourceDir, { recursive: true });
  // In embedded mode the real UI is served by the bundled Node server, which
  // takes ~1-3s to boot. Rust's setup() now spawns that server on a BACKGROUND
  // thread and navigates the window to it once ready, so the Tauri window needs
  // an instant frontendDist to paint meanwhile. Ship the branded loading shell
  // (src-tauri/loading-shell/) as that frontendDist so first paint is immediate
  // (and it reads live native data via window.__TAURI__) instead of a blank page.
  const loadingShellDir = join(projectRoot, "src-tauri", "loading-shell");
  if (existsSync(join(loadingShellDir, "index.html"))) {
    cpSync(loadingShellDir, staticResourceDir, { recursive: true });
    copyStartupBeeLottieAssets(staticResourceDir);
  } else {
    // Fallback: never ship a window with no index.html (blank/404 on boot).
    writeFileSync(
      join(staticResourceDir, "index.html"),
      '<!doctype html><meta charset="utf-8"><title>HivemindOS</title><body style="margin:0;height:100vh;background:#080a0f"></body>',
    );
  }
}

function runEmbeddedNextBuild(fingerprint) {
  if (standaloneBuildIsReusable(fingerprint)) {
    console.log(
      `Reusing cached embedded Next standalone build (${fingerprint.hash.slice(0, 12)}). Set HIVEMINDOS_TAURI_FORCE_NEXT_BUILD=1 to rebuild it.`,
    );
    return;
  }

  if (usePrebuiltStandalone) {
    if (!existsSync(standaloneServer)) {
      throw new Error(
        `HIVEMINDOS_TAURI_PREBUILT_STANDALONE=1 but no prebuilt standalone at ${standaloneServer} — the shared standalone artifact was not downloaded into ${nextBuildDir}.`,
      );
    }
    console.log(
      `Using prebuilt Next standalone at ${standaloneServer} (skipping the ~20-min next build).`,
    );
    return;
  }

  try {
    writeBuildNextEnv();
    const embeddedEnv = {
      HIVEMINDOS_TAURI_BUILD: "1",
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=${buildHeapMb}`.trim(),
    };
    // Build with Turbopack (the Next 16 default). Webpack needs 14-20 GB to
    // compile all ~250 API routes (it OOMs CI); Turbopack peaks ~5 GB. The old
    // ":global {} / dynamic execFile" rationale for forcing --webpack was stale
    // and inaccurate (0 such occurrences). The one real Turbopack gotcha: it
    // statically resolves an execFile/spawn binary STRING-LITERAL as a module,
    // so keep binary names behind an opaque indirection (see
    // scheduler/skill-action/route.ts). Turbopack's standalone trace also omits
    // a couple of Next runtime deps — ensureStandaloneFrameworkDeps() backfills
    // them below.
    const nextBuildArgs = ["exec", "next", "build"];
    if (process.platform === "win32") {
      // Windows can't exec the bash run-with-memory-limit.sh wrapper (the static
      // path handles this the same way). Run next directly via cmd; the
      // NODE_OPTIONS heap cap still bounds memory.
      run(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/c", "pnpm", ...nextBuildArgs],
        { env: embeddedEnv },
      );
    } else {
      run(
        "scripts/run-with-memory-limit.sh",
        ["--limit-mb", buildMemoryMb, "--timeout-seconds", buildTimeoutSeconds, "--", "pnpm", ...nextBuildArgs],
        { env: embeddedEnv },
      );
    }
  } finally {
    restoreNextEnv();
  }

  if (!existsSync(standaloneServer)) {
    throw new Error(
      `Next standalone server was not generated at ${standaloneServer}`,
    );
  }

  completeTurbopackStandalone();

  writeEmbeddedFingerprint(embeddedFingerprintFile, fingerprint);
}

// Turbopack's `output: "standalone"` (Next 16.2.x) produces an INCOMPLETE
// standalone and must be backfilled, or the packaged server.js boots but fails
// at runtime. Two gaps, both confirmed by booting the standalone:
//   (a) Compiled server chunks under <distDir>/server are not copied — only ~2
//       of ~1400 land, so page rendering dies with
//       `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`.
//   (b) Several Next framework runtime deps are missing from standalone
//       node_modules: @swc/helpers + @next/env (server won't even boot),
//       styled-jsx + scheduler + client-only (pages 500 at render).
// Webpack's standalone is complete; since we build with Turbopack we complete it
// here. Validated on a real build: homepage HTTP 200 + API routes respond.
const STANDALONE_FRAMEWORK_DEPS = [
  "@swc/helpers",
  "@next/env",
  "styled-jsx",
  "scheduler",
  "client-only",
  "server-only",
];
const STANDALONE_BOOT_CRITICAL_DEPS = new Set(["@swc/helpers", "@next/env"]);

function resolvePnpmPackageDir(pkg) {
  const hoisted = join(projectRoot, "node_modules", ...pkg.split("/"));
  if (existsSync(join(hoisted, "package.json"))) return hoisted;
  const pnpmRoot = join(projectRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmRoot)) return null;
  const prefix = `${pkg.replace("/", "+")}@`;
  const match = readdirSync(pnpmRoot).find((d) => d.startsWith(prefix));
  if (!match) return null;
  const dir = join(pnpmRoot, match, "node_modules", ...pkg.split("/"));
  return existsSync(join(dir, "package.json")) ? dir : null;
}

function completeTurbopackStandalone() {
  // (a) Copy the full compiled server tree (chunks the standalone trace missed)
  // into the standalone, skipping .map files the runtime doesn't need.
  const distName = basename(nextBuildDir);
  const fullServer = join(nextBuildDir, "server");
  const standaloneServerDir = join(standaloneDir, distName, "server");
  if (existsSync(fullServer)) {
    cpSync(fullServer, standaloneServerDir, {
      recursive: true,
      dereference: true,
      filter: (src) => !src.endsWith(".map"),
    });
    console.log(
      `[embedded] completed standalone server chunks from ${distName}/server`,
    );
  }
  // (b) Stage the framework runtime deps the trace omits.
  const destRoot = join(standaloneDir, "node_modules");
  for (const pkg of STANDALONE_FRAMEWORK_DEPS) {
    const dest = join(destRoot, ...pkg.split("/"));
    if (existsSync(join(dest, "package.json"))) continue;
    const src = resolvePnpmPackageDir(pkg);
    if (!src) {
      if (STANDALONE_BOOT_CRITICAL_DEPS.has(pkg)) {
        throw new Error(
          `Could not locate ${pkg} to stage into the Next standalone; ` +
            `the packaged server.js will not boot without it.`,
        );
      }
      console.warn(`[embedded] ${pkg} not found to stage into standalone (skipping)`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, dereference: true });
    console.log(`[embedded] staged ${pkg} into standalone node_modules`);
  }
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
  // Always (re)stage brain-seed — it's cheap and must be present even when the
  // heavy standalone resources are reused from a prior build.
  stageBrainSeed();

  if (packagedEmbeddedResourcesAreReusable(fingerprint)) {
    console.log(
      `Reusing prepared embedded Tauri Next resources (${fingerprint.hash.slice(0, 12)}). Set HIVEMINDOS_TAURI_FORCE_NEXT_BUILD=1 to rebuild them.`,
    );
    return;
  }

  runEmbeddedNextBuild(fingerprint);
  copyEmbeddedNextResources(fingerprint);
}

function buildEmbeddedNextStandaloneOnly() {
  // Produce ONLY the arch-independent Next standalone (server.js + traced
  // node_modules) plus the .next static assets, so ONE CI job can build it and
  // every platform job consumes it via HIVEMINDOS_TAURI_PREBUILT_STANDALONE=1.
  // No node binary copy / signing here — those are per-platform and run in the
  // platform job's staging step (copyEmbeddedNextResources).
  const fingerprint = buildEmbeddedFingerprint();
  mkdirSync(nextBuildDir, { recursive: true });
  runEmbeddedNextBuild(fingerprint);
  if (!existsSync(standaloneServer)) {
    throw new Error(
      `Standalone-only build did not produce ${standaloneServer}`,
    );
  }
  // Dereference pnpm symlinks NOW so the uploaded artifact is portable across
  // OSes — Windows artifact extraction can't restore Unix symlinks, which would
  // leave node_modules dangling on the Windows platform build. After this the
  // standalone is plain files; the platform job's own materialize is then a
  // no-op. (Skipped on a cache hit where it's already materialized.)
  materializeResourceSymlinks(standaloneDir);
  console.log(
    `Standalone-only build ready (symlinks materialized): ${standaloneServer} (+ ${join(nextBuildDir, "static")})`,
  );
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

if (standaloneOnly) {
  if (!embeddedNextMode) {
    throw new Error(
      "HIVEMINDOS_TAURI_STANDALONE_ONLY=1 requires HIVEMINDOS_TAURI_EMBEDDED_NEXT=1",
    );
  }
  buildEmbeddedNextStandaloneOnly();
} else if (embeddedNextMode) {
  buildEmbeddedNextResources();
} else {
  buildStaticNativeResources();
}
