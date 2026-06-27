import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import type { InstallableServiceStatus } from "@/lib/services/installable-services";

const execFileAsync = promisify(execFile);

const PALMIER_PRO_VERSION = "0.3.4";
const PALMIER_PRO_SOURCE_URL = "https://github.com/palmier-io/palmier-pro";
const PALMIER_PRO_DMG_URL = `${PALMIER_PRO_SOURCE_URL}/releases/download/v${PALMIER_PRO_VERSION}/PalmierPro.dmg`;
const PALMIER_PRO_DMG_SHA256 = "ec672d1e31c220c72f7c4947e1e550704112ead0d461863ebf59951e9d36c47f";
const PALMIER_PRO_BUNDLE_ID = "io.palmier.pro";
const PALMIER_PRO_EXECUTABLE = "PalmierPro";
const PALMIER_PRO_MCP_URL = "http://127.0.0.1:19789/mcp";

const PALMIER_PRO_SECURITY_NOTES = [
  "Installed from the reviewed Palmier Pro GitHub release DMG with a pinned SHA-256 digest.",
  "HivemindOS mounts the DMG read-only and copies the app bundle; it does not run a shell installer.",
  `The Palmier Pro MCP endpoint is local-only at ${PALMIER_PRO_MCP_URL} and is available only while the app is open.`,
  "Palmier Pro can edit local video projects and media; confirm the target project before letting agents run timeline-changing MCP tools.",
  "The free editor and MCP server are open source; upstream generative AI processing requires Palmier login/subscription.",
];

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type PalmierProCompatibility = {
  platformOk: boolean;
  archOk: boolean;
  macosOk: boolean;
  macosVersion?: string;
};

function palmierProStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "palmier-pro",
    name: "Palmier Pro",
    installed: false,
    running: false,
    openUrl: PALMIER_PRO_MCP_URL,
    detail: "Palmier Pro is not installed.",
    installMethod: "dmg",
    requirements: ["macOS 26 Tahoe", "Apple Silicon Mac", "Network access to GitHub Releases"],
    sourceUrl: PALMIER_PRO_SOURCE_URL,
    provenance: {
      packageName: "PalmierPro.dmg",
      packageManager: "GitHub Releases DMG",
      installCommand: `curl -fL ${PALMIER_PRO_DMG_URL} && hdiutil attach PalmierPro.dmg && ditto PalmierPro.app /Applications/PalmierPro.app`,
      updatePolicy: `Pinned to reviewed v${PALMIER_PRO_VERSION} for HivemindOS install; Palmier Pro uses its upstream Sparkle feed after install.`,
    },
    securityNotes: PALMIER_PRO_SECURITY_NOTES,
    ...partial,
  };
}

async function run(command: string, args: string[], timeout = 20_000): Promise<CommandResult> {
  return execFileAsync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 500_000,
    env: process.env,
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const maybe = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: maybe.stdout ?? "", stderr: maybe.stderr ?? maybe.message ?? "" };
    },
  );
}

async function palmierProCompatibility(): Promise<PalmierProCompatibility> {
  const platformOk = process.platform === "darwin";
  const siliconResult = platformOk ? await run("sysctl", ["-n", "hw.optional.arm64"], 5_000) : undefined;
  const archOk = process.arch === "arm64" || siliconResult?.stdout.trim() === "1";
  if (!platformOk) return { platformOk, archOk, macosOk: false };
  const versionResult = await run("sw_vers", ["-productVersion"], 5_000);
  const macosVersion = versionResult.ok ? versionResult.stdout.trim() : undefined;
  const major = Number(macosVersion?.split(".")[0]);
  return { platformOk, archOk, macosOk: Number.isFinite(major) && major >= 26, macosVersion };
}

function palmierProCompatible(requirements: PalmierProCompatibility) {
  return requirements.platformOk && requirements.archOk && requirements.macosOk;
}

function palmierProAppPath() {
  for (const candidate of [
    "/Applications/PalmierPro.app",
    "/Applications/Palmier Pro.app",
    join(homedir(), "Applications", "PalmierPro.app"),
    join(homedir(), "Applications", "Palmier Pro.app"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function palmierProVersion(appPath: string | undefined) {
  if (!appPath) return undefined;
  const result = await run("defaults", ["read", join(appPath, "Contents", "Info"), "CFBundleShortVersionString"], 5_000);
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

async function palmierProMcpReachable() {
  if (process.platform !== "darwin") return false;
  return fetch(PALMIER_PRO_MCP_URL, { cache: "no-store", signal: AbortSignal.timeout(1_500) }).then(
    () => true,
    () => false,
  );
}

async function palmierProProcessRunning() {
  if (process.platform !== "darwin") return false;
  return (await run("pgrep", ["-x", PALMIER_PRO_EXECUTABLE], 5_000)).ok;
}

async function findMountedPalmierProApp(mountDir: string) {
  const result = await run("find", [mountDir, "-maxdepth", "2", "-name", "Palmier*.app", "-print", "-quit"], 5_000);
  return result.ok ? result.stdout.trim().split(/\r?\n/)[0] || undefined : undefined;
}

export async function installPalmierProFromDmg() {
  const compatibility = await palmierProCompatibility();
  if (!palmierProCompatible(compatibility)) throw new Error("Palmier Pro requires macOS 26 Tahoe on an Apple Silicon Mac.");
  const installDir = await mkdtemp(join(tmpdir(), "hivemindos-palmier-pro-"));
  const dmgPath = join(installDir, "PalmierPro.dmg");
  const mountDir = join(installDir, "mount");
  let attached = false;
  try {
    await mkdir(mountDir);
    const download = await run("curl", ["-fL", "--retry", "2", "-o", dmgPath, PALMIER_PRO_DMG_URL], 300_000);
    if (!download.ok) throw new Error(download.stderr || download.stdout || "Palmier Pro DMG download failed.");
    const hash = await run("shasum", ["-a", "256", dmgPath], 60_000);
    if (!hash.ok || !hash.stdout.trim().startsWith(PALMIER_PRO_DMG_SHA256)) throw new Error("Palmier Pro DMG digest did not match the reviewed release.");
    const attach = await run("hdiutil", ["attach", dmgPath, "-nobrowse", "-readonly", "-mountpoint", mountDir], 60_000);
    if (!attach.ok) throw new Error(attach.stderr || attach.stdout || "Could not mount the Palmier Pro DMG.");
    attached = true;
    const app = await findMountedPalmierProApp(mountDir);
    if (!app) throw new Error("The Palmier Pro DMG did not contain an app bundle.");
    const copy = await run("ditto", [app, join("/Applications", basename(app))], 120_000);
    if (!copy.ok) throw new Error(copy.stderr || copy.stdout || "Could not copy Palmier Pro into /Applications.");
  } finally {
    if (attached) await run("hdiutil", ["detach", mountDir, "-quiet"], 30_000);
    await rm(installDir, { recursive: true, force: true });
  }
}

export async function openPalmierProApp() {
  const appPath = palmierProAppPath();
  if (!appPath) throw new Error("Install Palmier Pro before opening it.");
  const opened = await run("open", [appPath], 10_000);
  if (!opened.ok) throw new Error(opened.stderr || opened.stdout || "Palmier Pro could not be opened.");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}

export async function quitPalmierProApp() {
  await run("osascript", ["-e", `tell application id "${PALMIER_PRO_BUNDLE_ID}" to quit`], 10_000);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

export async function readPalmierProInstallableServiceStatus(): Promise<InstallableServiceStatus> {
  const [compatibility, mcpReady, processRunning] = await Promise.all([
    palmierProCompatibility(),
    palmierProMcpReachable(),
    palmierProProcessRunning(),
  ]);
  const appPath = palmierProAppPath();
  const installed = Boolean(appPath);
  const version = await palmierProVersion(appPath);
  const compatible = palmierProCompatible(compatibility);
  const running = installed && (mcpReady || processRunning);
  const compatibilityDetail = !compatibility.platformOk
    ? "Palmier Pro is macOS-only."
    : !compatibility.archOk
      ? "Palmier Pro requires an Apple Silicon Mac."
      : !compatibility.macosOk
        ? `Palmier Pro requires macOS 26 Tahoe; this Mac reports ${compatibility.macosVersion || "an unknown macOS version"}.`
        : "This Mac meets Palmier Pro's macOS 26 Apple Silicon requirement.";
  const detail = !compatible
    ? "macOS 26 Tahoe on Apple Silicon is required before HivemindOS can install Palmier Pro."
    : installed
      ? mcpReady
        ? `Palmier Pro${version ? ` ${version}` : ""} is open and serving MCP at ${PALMIER_PRO_MCP_URL}.`
        : processRunning
          ? `Palmier Pro${version ? ` ${version}` : ""} is open; its MCP endpoint is still warming up at ${PALMIER_PRO_MCP_URL}.`
          : `Palmier Pro${version ? ` ${version}` : ""} is installed. Open it to expose the local MCP server at ${PALMIER_PRO_MCP_URL}.`
      : `Palmier Pro is ready to install from the reviewed v${PALMIER_PRO_VERSION} GitHub release DMG.`;

  return palmierProStatus({
    installed,
    running,
    version,
    detail,
    preflight: [
      { key: "platform", ok: compatible, detail: compatibilityDetail },
      {
        key: "app-bundle",
        ok: installed,
        detail: installed ? "Palmier Pro app bundle was found on this Mac." : "Install the Palmier Pro app bundle into Applications.",
      },
      {
        key: "mcp-endpoint",
        ok: mcpReady,
        detail: mcpReady ? `Local MCP endpoint answered at ${PALMIER_PRO_MCP_URL}.` : "Open Palmier Pro before adding or calling its local MCP endpoint.",
      },
    ],
  });
}
