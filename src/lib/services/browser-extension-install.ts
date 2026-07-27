import { execFile } from "child_process";
import { access, cp, mkdir, readFile, rename, rm } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { homedir } from "@/lib/home-dir";

const execFileAsync = promisify(execFile);
const REQUIRED_EXTENSION_FILES = ["manifest.json", "background.js", "content.js", "sidepanel.html"] as const;

type InstallOptions = {
  projectRoot?: string;
  installRoot?: string;
  sourceDir?: string;
  browserTargets?: BrowserExtensionInstallStatus["browsers"];
};

type ExtensionManifest = {
  name?: unknown;
  version?: unknown;
};

export type BrowserExtensionInstallStatus = {
  available: boolean;
  prepared: boolean;
  version: string;
  installedVersion: string;
  installPath: string;
  rollbackAvailable: boolean;
  browsers: Array<{
    id: string;
    label: string;
    extensionManagementUrl: string;
  }>;
};

function installPaths(options: InstallOptions) {
  const installRoot = options.installRoot ?? join(homedir(), ".hivemindos");
  return {
    installRoot,
    destination: join(installRoot, "browser-extension"),
    previous: join(installRoot, "browser-extension.previous"),
  };
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readValidManifest(directory: string): Promise<{ version: string } | null> {
  try {
    await Promise.all(REQUIRED_EXTENSION_FILES.map((file) => access(join(directory, file))));
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as ExtensionManifest;
    if (typeof manifest.name !== "string" || !manifest.name.trim()) return null;
    if (typeof manifest.version !== "string" || !manifest.version.trim()) return null;
    return { version: manifest.version.trim() };
  } catch {
    return null;
  }
}

async function findPreparedSource(options: InstallOptions) {
  if (options.sourceDir) return (await readValidManifest(options.sourceDir)) ? options.sourceDir : "";
  const projectRoot = options.projectRoot ?? process.cwd();
  for (const candidate of [
    join(projectRoot, "public", "browser-extension"),
    join(projectRoot, "browser-extension", "dist"),
  ]) {
    if (await readValidManifest(candidate)) return candidate;
  }
  return "";
}

async function sourceVersion(options: InstallOptions) {
  const preparedSource = await findPreparedSource(options);
  if (preparedSource) return (await readValidManifest(preparedSource))?.version ?? "";
  const projectRoot = options.projectRoot ?? process.cwd();
  return (await readValidManifest(join(projectRoot, "browser-extension")))?.version ?? "";
}

async function ensurePreparedSource(options: InstallOptions) {
  const existing = await findPreparedSource(options);
  if (existing) return existing;
  if (options.sourceDir) throw new Error("The packaged browser extension is incomplete.");

  const projectRoot = options.projectRoot ?? process.cwd();
  const buildScript = join(projectRoot, "scripts", "build-browser-extension.mjs");
  if (!(await pathExists(buildScript))) {
    throw new Error("The HivemindOS browser extension is not included in this build.");
  }
  await execFileAsync(process.execPath, [buildScript], { cwd: projectRoot, timeout: 60_000 });
  const built = join(projectRoot, "browser-extension", "dist");
  if (!(await readValidManifest(built))) throw new Error("The browser extension build did not produce a loadable package.");
  return built;
}

async function readBrowserTargets(options: InstallOptions) {
  if (options.browserTargets) return options.browserTargets;
  const { listBrowserExtensionTargets } = await import("@/lib/services/system-browsers");
  return listBrowserExtensionTargets();
}

export async function readBrowserExtensionInstallStatus(
  options: InstallOptions = {},
): Promise<BrowserExtensionInstallStatus> {
  const { destination, previous } = installPaths(options);
  const [availableVersion, installedManifest, rollbackAvailable, browsers] = await Promise.all([
    sourceVersion(options),
    readValidManifest(destination),
    readValidManifest(previous).then(Boolean),
    readBrowserTargets(options),
  ]);
  return {
    available: Boolean(availableVersion),
    prepared: Boolean(installedManifest),
    version: availableVersion,
    installedVersion: installedManifest?.version ?? "",
    installPath: destination,
    rollbackAvailable,
    browsers: browsers.map(({ id, label, extensionManagementUrl }) => ({ id, label, extensionManagementUrl })),
  };
}

export async function prepareBrowserExtensionInstall(
  options: InstallOptions = {},
): Promise<BrowserExtensionInstallStatus> {
  const source = await ensurePreparedSource(options);
  const { installRoot, destination, previous } = installPaths(options);
  const temporary = join(installRoot, `.browser-extension-install-${process.pid}-${Date.now()}`);
  await mkdir(installRoot, { recursive: true });

  try {
    await cp(source, temporary, { recursive: true, dereference: true, errorOnExist: true });
    if (!(await readValidManifest(temporary))) throw new Error("The copied browser extension failed validation.");
    await rm(previous, { recursive: true, force: true });
    const hadDestination = await pathExists(destination);
    if (hadDestination) await rename(destination, previous);
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (hadDestination && await pathExists(previous) && !(await pathExists(destination))) {
        await rename(previous, destination);
      }
      throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  return readBrowserExtensionInstallStatus(options);
}
