import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "fs/promises";
import { delimiter, dirname, join, win32 } from "path";
import { promisify } from "util";
import { homedir } from "@/lib/home-dir";

const execFileAsync = promisify(execFile);

export const HYPERFRAMES_RUNTIME_VERSION = "0.7.17";
export const HYPERFRAMES_RUNTIME_PACKAGE_INTEGRITY =
  "sha512-fc7WOk5NRa2w+ciShWNPVVvU8MfP7DkjGXCy2FI3RpiuqQ8sZWz2sO9w5jL1Uu7z69CasYnVL1ca/k/MIfCBeg==";
export const HYPERFRAMES_RUNTIME_TARBALL_SHA256 =
  "716884b7469d0a19de1a7cf894f4ae16d2bf17e3fd43288d9cfe0a227165963e";
export const HYPERFRAMES_SKILLS_COMMIT = "3351fb1a6d7f0202d07db9bf9ad335fd0d1ec344";
export const HYPERFRAMES_SOURCE_REPOSITORY = "https://github.com/heygen-com/hyperframes";

const INSTALL_PACKAGE_URL = new URL("../../../third-party/hyperframes-runtime/package.json", import.meta.url);
const INSTALL_LOCK_URL = new URL("../../../third-party/hyperframes-runtime/package-lock.json", import.meta.url);

export type HyperframesRuntimeComponent = {
  id: "node" | "npm" | "ffmpeg" | "hyperframes";
  label: string;
  ready: boolean;
  version?: string;
  detail: string;
};

export type HyperframesRuntimeStatus = {
  ready: boolean;
  installed: boolean;
  expectedVersion: string;
  installPath: string;
  cliEntrypoint: string;
  components: HyperframesRuntimeComponent[];
  provenance: {
    packageName: "hyperframes";
    version: string;
    integrity: string;
    tarballSha256: string;
    sourceRepository: string;
    sourceCommit: string;
    updatePolicy: "manual-pinned";
    telemetry: "disabled-by-managed-wrapper";
  };
};

type SupportedPlatform = NodeJS.Platform | "linux" | "darwin" | "win32";

export function hyperframesManagedRuntimePaths(
  homeDirectory = homedir(),
  platform: SupportedPlatform = process.platform,
) {
  const pathApi = platform === "win32" ? win32 : { join };
  const root = pathApi.join(homeDirectory, ".hivemindos", "tools", "hyperframes");
  return {
    root,
    packageJson: pathApi.join(root, "package.json"),
    packageLock: pathApi.join(root, "package-lock.json"),
    cliPackageJson: pathApi.join(root, "node_modules", "hyperframes", "package.json"),
    cliEntrypoint: pathApi.join(root, "node_modules", "hyperframes", "dist", "cli.js"),
    privateHome: pathApi.join(root, ".runtime-home"),
  };
}

function majorVersion(value: string) {
  const major = Number.parseInt(value.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 0;
}

function cleanVersionOutput(value: string) {
  return value.trim().split(/\r?\n/, 1)[0]?.replace(/^v/, "") ?? "";
}

async function probeExecutable(candidates: string[], args: string[]) {
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, args, {
        encoding: "utf8",
        env: { ...platformEnvironment(), PATH: safePathEntries() },
        timeout: 8_000,
        maxBuffer: 256_000,
        windowsHide: true,
      });
      return {
        path: candidate,
        version: cleanVersionOutput(String(stdout || stderr || "")),
      };
    } catch {
      // Try the next portable or standard command location.
    }
  }
  return null;
}

function npmCandidates() {
  const executableDirectory = dirname(process.execPath);
  const extension = process.platform === "win32" ? ".cmd" : "";
  return [
    process.env.HIVEMINDOS_NPM_BIN ?? "",
    join(executableDirectory, `npm${extension}`),
    process.platform === "darwin" ? "/opt/homebrew/bin/npm" : "",
    process.platform !== "win32" ? "/usr/local/bin/npm" : "",
    process.platform !== "win32" ? "/usr/bin/npm" : "",
    `npm${extension}`,
  ];
}

function ffmpegCandidates() {
  const extension = process.platform === "win32" ? ".exe" : "";
  return [
    process.env.HIVEMINDOS_FFMPEG_BIN ?? "",
    process.platform === "darwin" ? "/opt/homebrew/bin/ffmpeg" : "",
    process.platform !== "win32" ? "/usr/local/bin/ffmpeg" : "",
    process.platform !== "win32" ? "/usr/bin/ffmpeg" : "",
    `ffmpeg${extension}`,
  ];
}

async function installedHyperframesVersion(paths: ReturnType<typeof hyperframesManagedRuntimePaths>) {
  try {
    const parsed = JSON.parse(await readFile(paths.cliPackageJson, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function readHyperframesRuntimeStatus(
  options: { homeDirectory?: string } = {},
): Promise<HyperframesRuntimeStatus> {
  const paths = hyperframesManagedRuntimePaths(options.homeDirectory);
  const [npm, ffmpeg, installedVersion] = await Promise.all([
    probeExecutable(npmCandidates(), ["--version"]),
    probeExecutable(ffmpegCandidates(), ["-version"]),
    installedHyperframesVersion(paths),
  ]);
  const nodeVersion = process.versions.node;
  const nodeReady = majorVersion(nodeVersion) >= 22;
  const installed = Boolean(installedVersion && existsSync(paths.cliEntrypoint));
  const exactVersion = installedVersion === HYPERFRAMES_RUNTIME_VERSION;
  const components: HyperframesRuntimeComponent[] = [
    {
      id: "node",
      label: "Node.js",
      ready: nodeReady,
      version: nodeVersion,
      detail: nodeReady ? "Node.js meets the renderer requirement." : "Install Node.js 22 or newer.",
    },
    {
      id: "npm",
      label: "npm",
      ready: Boolean(npm),
      version: npm?.version,
      detail: npm ? "npm is available for the pinned install." : "npm was not found in a standard app-safe location.",
    },
    {
      id: "ffmpeg",
      label: "FFmpeg",
      ready: Boolean(ffmpeg),
      version: ffmpeg?.version,
      detail: ffmpeg ? "FFmpeg is available for MP4 rendering." : "Install FFmpeg before rendering video.",
    },
    {
      id: "hyperframes",
      label: "HyperFrames",
      ready: installed && exactVersion,
      version: installedVersion ?? undefined,
      detail: !installed
        ? `Pinned renderer ${HYPERFRAMES_RUNTIME_VERSION} is not installed.`
        : exactVersion
          ? "The audited pinned renderer is installed."
          : `Installed version ${installedVersion} does not match the audited pin.`,
    },
  ];
  return {
    ready: nodeReady && Boolean(ffmpeg) && installed && exactVersion,
    installed,
    expectedVersion: HYPERFRAMES_RUNTIME_VERSION,
    installPath: paths.root,
    cliEntrypoint: paths.cliEntrypoint,
    components,
    provenance: {
      packageName: "hyperframes",
      version: HYPERFRAMES_RUNTIME_VERSION,
      integrity: HYPERFRAMES_RUNTIME_PACKAGE_INTEGRITY,
      tarballSha256: HYPERFRAMES_RUNTIME_TARBALL_SHA256,
      sourceRepository: HYPERFRAMES_SOURCE_REPOSITORY,
      sourceCommit: HYPERFRAMES_SKILLS_COMMIT,
      updatePolicy: "manual-pinned",
      telemetry: "disabled-by-managed-wrapper",
    },
  };
}

function safePathEntries() {
  const entries = [
    dirname(process.execPath),
    process.platform === "darwin" ? "/opt/homebrew/bin" : "",
    process.platform !== "win32" ? "/usr/local/bin" : "",
    process.platform !== "win32" ? "/usr/bin" : "",
    process.platform !== "win32" ? "/bin" : "",
    process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "",
  ];
  return [...new Set(entries.filter(Boolean))].join(delimiter);
}

function platformEnvironment() {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["SystemRoot", "ComSpec", "PATHEXT", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

export function hyperframesRuntimeEnvironment(privateHome: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...platformEnvironment(),
    PATH: safePathEntries(),
    HOME: privateHome,
    USERPROFILE: privateHome,
    CI: "1",
    DO_NOT_TRACK: "1",
    HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    NO_COLOR: "1",
  };
  return environment;
}

async function readPinnedInstallFiles() {
  const [packageJson, packageLock] = await Promise.all([
    readFile(INSTALL_PACKAGE_URL, "utf8"),
    readFile(INSTALL_LOCK_URL, "utf8"),
  ]);
  const parsedLock = JSON.parse(packageLock) as {
    packages?: Record<string, { version?: unknown; integrity?: unknown }>;
  };
  const lockedPackage = parsedLock.packages?.["node_modules/hyperframes"];
  if (
    lockedPackage?.version !== HYPERFRAMES_RUNTIME_VERSION
    || lockedPackage.integrity !== HYPERFRAMES_RUNTIME_PACKAGE_INTEGRITY
  ) {
    throw new Error("The bundled HyperFrames lockfile does not match the reviewed renderer provenance.");
  }
  return { packageJson, packageLock };
}

export async function installHyperframesRuntime(
  options: { homeDirectory?: string } = {},
): Promise<HyperframesRuntimeStatus> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const paths = hyperframesManagedRuntimePaths(homeDirectory);
  if (majorVersion(process.versions.node) < 22) {
    throw new Error(`HyperFrames requires Node.js 22 or newer; this app is running ${process.versions.node}.`);
  }
  const npm = await probeExecutable(npmCandidates(), ["--version"]);
  if (!npm) throw new Error("npm is required to install the pinned HyperFrames renderer.");
  const installFiles = await readPinnedInstallFiles();
  const toolsRoot = dirname(paths.root);
  await mkdir(toolsRoot, { recursive: true });
  const stagingRoot = await mkdtemp(join(toolsRoot, ".hyperframes-install-"));
  const stagingPaths = hyperframesManagedRuntimePaths(homeDirectory);
  const stagingPrivateHome = join(stagingRoot, ".runtime-home");
  const cacheDirectory = join(stagingRoot, ".npm-cache");
  const backupRoot = `${paths.root}.previous`;
  try {
    await mkdir(stagingPrivateHome, { recursive: true });
    await writeFile(join(stagingRoot, "package.json"), installFiles.packageJson, "utf8");
    await writeFile(join(stagingRoot, "package-lock.json"), installFiles.packageLock, "utf8");
    const installEnvironment = {
      ...hyperframesRuntimeEnvironment(stagingPrivateHome),
      npm_config_cache: cacheDirectory,
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    };
    await execFileAsync(npm.path, [
      "ci",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
    ], {
      encoding: "utf8",
      cwd: stagingRoot,
      env: installEnvironment,
      timeout: 10 * 60_000,
      maxBuffer: 2_000_000,
      windowsHide: true,
    });
    const installedVersion = await installedHyperframesVersion({
      ...stagingPaths,
      root: stagingRoot,
      packageJson: join(stagingRoot, "package.json"),
      packageLock: join(stagingRoot, "package-lock.json"),
      cliPackageJson: join(stagingRoot, "node_modules", "hyperframes", "package.json"),
      cliEntrypoint: join(stagingRoot, "node_modules", "hyperframes", "dist", "cli.js"),
      privateHome: stagingPrivateHome,
    });
    const stagingEntrypoint = join(stagingRoot, "node_modules", "hyperframes", "dist", "cli.js");
    if (installedVersion !== HYPERFRAMES_RUNTIME_VERSION || !existsSync(stagingEntrypoint)) {
      throw new Error("The pinned HyperFrames install completed without the expected CLI artifact.");
    }
    await rm(cacheDirectory, { recursive: true, force: true });
    await rm(backupRoot, { recursive: true, force: true });
    if (existsSync(paths.root)) await rename(paths.root, backupRoot);
    try {
      await rename(stagingRoot, paths.root);
    } catch (error) {
      if (existsSync(backupRoot) && !existsSync(paths.root)) await rename(backupRoot, paths.root);
      throw error;
    }
    await rm(backupRoot, { recursive: true, force: true });
    return readHyperframesRuntimeStatus({ homeDirectory });
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`Pinned HyperFrames installation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function uninstallHyperframesRuntime(
  options: { homeDirectory?: string } = {},
): Promise<HyperframesRuntimeStatus> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const paths = hyperframesManagedRuntimePaths(homeDirectory);
  await rm(paths.root, { recursive: true, force: true });
  await rm(`${paths.root}.previous`, { recursive: true, force: true });
  return readHyperframesRuntimeStatus({ homeDirectory });
}

export async function resolveHyperframesRuntimeCommand() {
  const paths = hyperframesManagedRuntimePaths();
  const version = await installedHyperframesVersion(paths);
  if (version !== HYPERFRAMES_RUNTIME_VERSION || !existsSync(paths.cliEntrypoint)) {
    throw new Error(`Install the pinned HyperFrames ${HYPERFRAMES_RUNTIME_VERSION} renderer from the guided video card first.`);
  }
  await mkdir(paths.privateHome, { recursive: true });
  return {
    executable: process.execPath,
    argsPrefix: [paths.cliEntrypoint],
    env: hyperframesRuntimeEnvironment(paths.privateHome),
  };
}
