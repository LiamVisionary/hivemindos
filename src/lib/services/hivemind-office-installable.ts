import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { homedir } from "@/lib/home-dir";
import { inspectHivemindOfficeDocument } from "@/lib/services/hivemind-office-bridge";
import type { InstallableServiceStatus } from "@/lib/services/installable-services";

const execFileAsync = promisify(execFile);

export const HIVEMIND_OFFICE_SOURCE_URL = "https://github.com/criptogus/HermesOffice";
export const HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT = "70374e037e1afa97f42948d31df238c0b38250ae";
export const HIVEMIND_OFFICE_SOURCE_ARCHIVE_SHA256 = "aa6f1d98ea96d753928f697dd6b290b5d9d8a33b852053f6a82c5fbe7375aeae";
export const HIVEMIND_OFFICE_UPSTREAM_URL = "https://github.com/genspark-ai/genoffice";
export const HIVEMIND_OFFICE_UPSTREAM_COMMIT = "8f523289d6c34f940cd691472ee56b2013d148c8";
export const HIVEMIND_OFFICE_HERMES_GATEWAY_HEALTH_URL = "http://127.0.0.1:8642/health";

type OfficeAppCandidate = {
  displayName: string;
  sourceName: "Hivemind Office" | "HermesOffice" | "GenOffice";
  path: string;
  bundleId?: "com.hivemindos.office" | "com.hermesoffice.app" | "com.genoffice.app";
  executableName: string;
  auditedCommit?: string;
};

type InstalledOfficeApp = OfficeAppCandidate & {
  buildCommit?: string;
};

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

const HIVEMIND_OFFICE_SECURITY_NOTES = [
  `Integration code is scoped to the audited HermesOffice source commit ${HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT.slice(0, 12)} (source-tree sha256:${HIVEMIND_OFFICE_SOURCE_ARCHIVE_SHA256}).`,
  "Automatic installation is blocked because HermesOffice has no signed, immutable release artifact with a reviewed binary digest.",
  "HivemindOS does not run HermesOffice's mutable-main updater, ad-hoc bundle replacement, Genspark login, or in-app credential storage.",
  "Agent work uses the HivemindOS-owned local file bridge and bundled MCP server. Do not paste HivemindOS shared gateway keys into the companion app.",
  "Document writes default to a new copy. Replacing an original requires a separate confirmation, an unchanged source hash, and a sibling backup.",
];

function macCandidates(): OfficeAppCandidate[] {
  const roots = ["/Applications", join(homedir(), "Applications")];
  return roots.flatMap((root) => [
    {
      displayName: "Hivemind Office",
      sourceName: "Hivemind Office" as const,
      path: join(root, "Hivemind Office.app"),
      bundleId: "com.hivemindos.office" as const,
      executableName: "Hivemind Office",
    },
    {
      displayName: "Hivemind Office (HermesOffice)",
      sourceName: "HermesOffice" as const,
      path: join(root, "HermesOffice.app"),
      bundleId: "com.hermesoffice.app" as const,
      executableName: "HermesOffice",
      auditedCommit: HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT,
    },
    {
      displayName: "Hivemind Office (GenOffice)",
      sourceName: "GenOffice" as const,
      path: join(root, "GenOffice.app"),
      bundleId: "com.genoffice.app" as const,
      executableName: "GenOffice",
      auditedCommit: HIVEMIND_OFFICE_UPSTREAM_COMMIT,
    },
  ]);
}

function windowsCandidates(): OfficeAppCandidate[] {
  const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
    .filter((value): value is string => Boolean(value?.trim()));
  return roots.flatMap((root) => [
    {
      displayName: "Hivemind Office",
      sourceName: "Hivemind Office" as const,
      path: join(root, "Hivemind Office", "Hivemind Office.exe"),
      executableName: "Hivemind Office.exe",
    },
    {
      displayName: "Hivemind Office (HermesOffice)",
      sourceName: "HermesOffice" as const,
      path: join(root, "HermesOffice", "HermesOffice.exe"),
      executableName: "HermesOffice.exe",
      auditedCommit: HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT,
    },
    {
      displayName: "Hivemind Office (GenOffice)",
      sourceName: "GenOffice" as const,
      path: join(root, "GenOffice", "GenOffice.exe"),
      executableName: "GenOffice.exe",
      auditedCommit: HIVEMIND_OFFICE_UPSTREAM_COMMIT,
    },
  ]);
}

function officeAppCandidates() {
  if (process.platform === "darwin") return macCandidates();
  if (process.platform === "win32") return windowsCandidates();
  return [];
}

async function run(command: string, args: string[], timeout = 10_000): Promise<CommandResult> {
  return execFileAsync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 256 * 1024,
    env: process.env,
  }).then(
    ({ stdout, stderr }) => ({ ok: true, stdout, stderr }),
    (error: unknown) => {
      const value = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, stdout: value.stdout ?? "", stderr: value.stderr ?? value.message ?? "" };
    },
  );
}

async function readBuildCommit(candidate: OfficeAppCandidate) {
  if (process.platform !== "darwin") return undefined;
  const buildInfoPath = join(candidate.path, "Contents", "Resources", "build-info.json");
  try {
    const parsed = JSON.parse(await readFile(buildInfoPath, "utf8")) as { commit?: unknown };
    return typeof parsed.commit === "string" && /^[a-f0-9]{40}$/i.test(parsed.commit)
      ? parsed.commit.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

async function installedOfficeApp(): Promise<InstalledOfficeApp | undefined> {
  const candidate = officeAppCandidates().find((entry) => existsSync(entry.path));
  if (!candidate) return undefined;
  return { ...candidate, buildCommit: await readBuildCommit(candidate) };
}

async function appVersion(app: InstalledOfficeApp | undefined) {
  if (!app || process.platform !== "darwin") return undefined;
  const result = await run("defaults", ["read", join(app.path, "Contents", "Info"), "CFBundleShortVersionString"], 5_000);
  return result.ok ? result.stdout.trim() || undefined : undefined;
}

async function appRunning(app: InstalledOfficeApp | undefined) {
  if (!app) return false;
  if (process.platform === "darwin") return (await run("pgrep", ["-x", app.executableName], 5_000)).ok;
  if (process.platform === "win32") {
    const result = await run("tasklist.exe", ["/FI", `IMAGENAME eq ${app.executableName}`, "/FO", "CSV", "/NH"], 5_000);
    return result.ok && result.stdout.toLowerCase().includes(app.executableName.toLowerCase());
  }
  return false;
}

async function gatewayReachable() {
  return fetch(HIVEMIND_OFFICE_HERMES_GATEWAY_HEALTH_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(1_200),
  }).then((response) => response.ok, () => false);
}

async function appSignatureVerified(app: InstalledOfficeApp | undefined) {
  if (!app || process.platform !== "darwin") return undefined;
  return (await run("codesign", ["--verify", "--deep", "--strict", app.path], 15_000)).ok;
}

function sourceRevisionDetail(app: InstalledOfficeApp | undefined) {
  if (!app) return { ok: false, detail: "No compatible app bundle is installed." };
  if (!app.auditedCommit) {
    return {
      ok: false,
      detail: "This Hivemind Office build does not declare a reviewed source revision; treat it as a local development build.",
    };
  }
  if (!app.buildCommit) {
    return {
      ok: false,
      detail: `${app.sourceName} is installed, but its build-info.json source revision is unavailable.`,
    };
  }
  if (app.buildCommit !== app.auditedCommit) {
    return {
      ok: false,
      detail: `${app.sourceName} was built from ${app.buildCommit.slice(0, 12)}, not the reviewed ${app.auditedCommit.slice(0, 12)} revision.`,
    };
  }
  return {
    ok: true,
    detail: `${app.sourceName} build metadata matches reviewed source revision ${app.auditedCommit.slice(0, 12)}.`,
  };
}

function baseStatus(partial: Partial<InstallableServiceStatus> = {}): InstallableServiceStatus {
  return {
    id: "hivemind-office",
    name: "Hivemind Office",
    installed: false,
    running: false,
    detail: "A signed reviewed release is required before HivemindOS can install Hivemind Office.",
    installMethod: "dmg",
    requirements: [
      "macOS or Windows desktop",
      "A compatible Hivemind Office, HermesOffice, or GenOffice app bundle",
      "HivemindOS local agent runtime for agent document workflows",
    ],
    sourceUrl: HIVEMIND_OFFICE_SOURCE_URL,
    provenance: {
      packageName: `HermesOffice source archive ${HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT.slice(0, 12)}`,
      packageManager: "Reviewed source only; automatic binary install blocked",
      installCommand: "Blocked until a signed immutable release artifact and binary SHA-256 digest pass sandbox review.",
      updatePolicy: `No mutable-main updates. Re-audit source and dependencies, then pin a signed artifact before changing ${HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT.slice(0, 12)}.`,
    },
    securityNotes: HIVEMIND_OFFICE_SECURITY_NOTES,
    ...partial,
  };
}

export async function readHivemindOfficeInstallableServiceStatus(): Promise<InstallableServiceStatus> {
  const app = await installedOfficeApp();
  const [version, running, gatewayReady, signatureVerified] = await Promise.all([
    appVersion(app),
    appRunning(app),
    gatewayReachable(),
    appSignatureVerified(app),
  ]);
  const platformOk = process.platform === "darwin" || process.platform === "win32";
  const revision = sourceRevisionDetail(app);
  const detail = !platformOk
    ? "Hivemind Office companion discovery currently supports macOS and Windows."
    : app
      ? `${app.displayName}${version ? ` ${version}` : ""} is ${running ? "open" : "installed"}. Agent document work stays in the HivemindOS bridge; ${gatewayReady ? "the local agent gateway is available" : "the local agent gateway is offline"}.`
      : "A signed reviewed release is required before HivemindOS can install Hivemind Office. Existing compatible app bundles are detected without running installers.";

  return baseStatus({
    installed: Boolean(app),
    running,
    version,
    detail,
    preflight: [
      {
        key: "platform",
        ok: platformOk,
        blocking: true,
        detail: platformOk ? `${process.platform === "darwin" ? "macOS" : "Windows"} companion discovery is supported.` : "Use macOS or Windows for the desktop companion.",
      },
      {
        key: "app-bundle",
        ok: Boolean(app),
        detail: app ? `${app.displayName} app files were found.` : "No compatible app bundle was found.",
      },
      {
        key: "source-revision",
        ok: revision.ok,
        blocking: false,
        detail: revision.detail,
      },
      {
        key: "code-signature",
        ok: signatureVerified === true,
        blocking: false,
        detail: signatureVerified === undefined
          ? "Code-signature verification is reported on macOS after an app is installed."
          : signatureVerified
            ? "The installed macOS app bundle passes strict code-signature verification."
            : "The installed macOS app does not pass strict code-signature verification.",
      },
      {
        key: "agent-gateway",
        ok: gatewayReady,
        blocking: false,
        detail: gatewayReady
          ? "The credentialless local agent gateway health endpoint answered on loopback."
          : "Start the HivemindOS local agent runtime before asking agents to work with office documents.",
      },
      {
        key: "reviewed-release",
        ok: false,
        blocking: true,
        detail: "HermesOffice has no signed immutable release artifact approved for automated HivemindOS installation.",
      },
    ],
  });
}

export async function openHivemindOfficeApp(documentPath?: string) {
  const app = await installedOfficeApp();
  if (!app) throw new Error("Install a compatible Hivemind Office app before opening it.");
  const path = documentPath
    ? (await inspectHivemindOfficeDocument({ path: documentPath, includeText: false })).path
    : undefined;
  if (process.platform === "darwin") {
    const result = await run("open", ["-a", app.path, ...(path ? [path] : [])], 10_000);
    if (!result.ok) throw new Error(result.stderr || result.stdout || `${app.displayName} could not be opened.`);
    return { app: app.displayName, path };
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(app.path, path ? [path] : [], { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolvePromise();
      });
    });
    return { app: app.displayName, path };
  }
  throw new Error("Hivemind Office desktop opening currently supports macOS and Windows.");
}

export async function quitHivemindOfficeApp() {
  const app = await installedOfficeApp();
  if (!app) return;
  if (process.platform === "darwin" && app.bundleId) {
    const result = await run("osascript", ["-e", `tell application id "${app.bundleId}" to quit`], 10_000);
    if (!result.ok && !/not running/i.test(result.stderr)) throw new Error(result.stderr || `${app.displayName} could not be closed.`);
    return;
  }
  if (process.platform === "win32") {
    const result = await run("taskkill.exe", ["/IM", app.executableName, "/T"], 10_000);
    if (!result.ok && !/not found|no running instance/i.test(result.stderr)) throw new Error(result.stderr || `${app.displayName} could not be closed.`);
    return;
  }
  throw new Error("Hivemind Office desktop closing currently supports macOS and Windows.");
}

export function blockedHivemindOfficeInstall() {
  throw new Error(
    `Hivemind Office automatic install is blocked: ${HIVEMIND_OFFICE_SOURCE_URL} has no signed immutable release artifact with a reviewed binary digest. The audited source revision is ${HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT}.`,
  );
}
