import "server-only";

import { execFile } from "child_process";
import { access } from "fs/promises";
import { platform } from "os";
import { optionalEnv } from "@/lib/config/env";
import { homedir } from "@/lib/home-dir";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type SystemBrowser = {
  id: string;
  label: string;
  appName: string;
  detectedPath: string;
  extensionManagementUrl?: string;
};

export type BrowserExtensionTarget = SystemBrowser & {
  extensionManagementUrl: string;
};

type BrowserCandidate = {
  id: string;
  label: string;
  appName: string;
  paths: string[];
  commandNames: string[];
  extensionManagementUrl?: string;
};

const MAC_BROWSER_CANDIDATES: BrowserCandidate[] = [
  macBrowser("chrome", "Chrome", "Google Chrome", "chrome://extensions"),
  macBrowser("safari", "Safari", "Safari"),
  macBrowser("arc", "Arc", "Arc"),
  macBrowser("brave", "Brave", "Brave Browser", "brave://extensions"),
  macBrowser("firefox", "Firefox", "Firefox"),
  macBrowser("edge", "Microsoft Edge", "Microsoft Edge", "edge://extensions"),
  macBrowser("chromium", "Chromium", "Chromium", "chrome://extensions"),
  macBrowser("opera", "Opera", "Opera", "opera://extensions"),
  macBrowser("vivaldi", "Vivaldi", "Vivaldi", "vivaldi://extensions"),
];

function macBrowser(
  id: string,
  label: string,
  appName: string,
  extensionManagementUrl?: string,
): BrowserCandidate {
  const bundleName = `${appName}.app`;
  return {
    id,
    label,
    appName,
    extensionManagementUrl,
    commandNames: [],
    paths: [
      join("/Applications", bundleName),
      join(homedir(), "Applications", bundleName),
      join("/System/Applications", bundleName),
    ],
  };
}

function executableBrowser(
  id: string,
  label: string,
  commandNames: string[],
  extensionManagementUrl: string,
  paths: string[] = [],
): BrowserCandidate {
  return { id, label, appName: commandNames[0] ?? label, paths: paths.filter(Boolean), commandNames, extensionManagementUrl };
}

function windowsPath(root: string, ...segments: string[]) {
  return root ? join(root, ...segments) : "";
}

function platformBrowserCandidates() {
  const osPlatform = platform();
  if (osPlatform === "darwin") return MAC_BROWSER_CANDIDATES;
  if (osPlatform === "win32") {
    const programFiles = optionalEnv("PROGRAMFILES");
    const programFilesX86 = optionalEnv("PROGRAMFILES(X86)");
    const localAppData = optionalEnv("LOCALAPPDATA");
    return [
      executableBrowser("chrome", "Chrome", ["chrome.exe"], "chrome://extensions", [
        windowsPath(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        windowsPath(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      ]),
      executableBrowser("edge", "Microsoft Edge", ["msedge.exe"], "edge://extensions", [
        windowsPath(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        windowsPath(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]),
      executableBrowser("brave", "Brave", ["brave.exe"], "brave://extensions", [
        windowsPath(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        windowsPath(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      ]),
      executableBrowser("chromium", "Chromium", ["chromium.exe"], "chrome://extensions", [
        windowsPath(localAppData, "Chromium", "Application", "chrome.exe"),
      ]),
      executableBrowser("opera", "Opera", ["opera.exe", "launcher.exe"], "opera://extensions", [
        windowsPath(localAppData, "Programs", "Opera", "launcher.exe"),
      ]),
      executableBrowser("vivaldi", "Vivaldi", ["vivaldi.exe"], "vivaldi://extensions", [
        windowsPath(localAppData, "Vivaldi", "Application", "vivaldi.exe"),
      ]),
    ];
  }
  return [
    executableBrowser("chrome", "Chrome", ["google-chrome", "google-chrome-stable"], "chrome://extensions"),
    executableBrowser("edge", "Microsoft Edge", ["microsoft-edge", "microsoft-edge-stable"], "edge://extensions"),
    executableBrowser("brave", "Brave", ["brave-browser", "brave"], "brave://extensions"),
    executableBrowser("chromium", "Chromium", ["chromium", "chromium-browser"], "chrome://extensions"),
    executableBrowser("opera", "Opera", ["opera"], "opera://extensions"),
    executableBrowser("vivaldi", "Vivaldi", ["vivaldi", "vivaldi-stable"], "vivaldi://extensions"),
  ];
}

async function firstExistingPath(paths: string[]) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Keep scanning; the app may be in a user-local or system app folder.
    }
  }
  return "";
}

async function firstExistingCommand(commandNames: string[]) {
  const finder = platform() === "win32" ? "where.exe" : "which";
  for (const command of commandNames) {
    try {
      const { stdout } = await execFileAsync(finder, [command], { encoding: "utf8", timeout: 5_000 });
      const detected = String(stdout).split(/\r?\n/).find(Boolean)?.trim() ?? "";
      if (detected) return detected;
    } catch {
      // Continue to the next standard executable name.
    }
  }
  return "";
}

export async function listSystemBrowsers(): Promise<SystemBrowser[]> {
  const detected = await Promise.all(
    platformBrowserCandidates().map(async (candidate): Promise<SystemBrowser | null> => {
      const detectedPath = await firstExistingPath(candidate.paths) || await firstExistingCommand(candidate.commandNames);
      return detectedPath ? {
        id: candidate.id,
        label: candidate.label,
        appName: candidate.appName,
        detectedPath,
        extensionManagementUrl: candidate.extensionManagementUrl,
      } : null;
    }),
  );

  return detected.filter((browser): browser is SystemBrowser => Boolean(browser));
}

async function launchSelectedBrowser(browser: SystemBrowser, url: string) {
  if (platform() === "darwin") {
    await execFileAsync("open", ["-a", browser.appName, url], { timeout: 10_000 });
    return;
  }
  await execFileAsync(browser.detectedPath, [url], { timeout: 10_000 });
}

export async function listBrowserExtensionTargets(): Promise<BrowserExtensionTarget[]> {
  return (await listSystemBrowsers()).filter(
    (browser): browser is BrowserExtensionTarget => Boolean(browser.extensionManagementUrl),
  );
}

export async function openBrowserExtensionsPage(browserId: unknown) {
  if (typeof browserId !== "string" || !browserId.trim()) {
    throw new Error("Choose a supported browser first.");
  }
  const browser = (await listBrowserExtensionTargets()).find((candidate) => candidate.id === browserId.trim());
  if (!browser) throw new Error("That supported browser is not installed on this device.");
  await launchSelectedBrowser(browser, browser.extensionManagementUrl);
}

export function normalizeOpenUrl(rawUrl: unknown) {
  if (typeof rawUrl !== "string") throw new Error("Funding URL is missing.");
  const trimmed = rawUrl.trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Funding URL must be HTTP or HTTPS.");
  }
  return parsed.toString();
}

export async function openUrlInSystemBrowser(rawUrl: unknown, browserId?: unknown) {
  const url = normalizeOpenUrl(rawUrl);
  const selectedBrowserId = typeof browserId === "string" ? browserId.trim() : "";
  const osPlatform = platform();

  if (osPlatform === "darwin") {
    if (!selectedBrowserId) {
      await execFileAsync("open", [url], { timeout: 10_000 });
      return;
    }
    const browser = (await listSystemBrowsers()).find((candidate) => candidate.id === selectedBrowserId);
    if (!browser) throw new Error("That browser is not installed on this Mac.");
    await launchSelectedBrowser(browser, url);
    return;
  }

  if (selectedBrowserId) {
    const browser = (await listSystemBrowsers()).find((candidate) => candidate.id === selectedBrowserId);
    if (!browser) throw new Error("That browser is not installed on this device.");
    await launchSelectedBrowser(browser, url);
    return;
  }

  if (osPlatform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url], { timeout: 10_000 });
    return;
  }

  await execFileAsync("xdg-open", [url], { timeout: 10_000 });
}
