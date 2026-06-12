import "server-only";

import { execFile } from "child_process";
import { access } from "fs/promises";
import { platform } from "os";
import { homedir } from "@/lib/home-dir";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type SystemBrowser = {
  id: string;
  label: string;
  appName: string;
  detectedPath: string;
};

type BrowserCandidate = {
  id: string;
  label: string;
  appName: string;
  paths: string[];
};

const MAC_BROWSER_CANDIDATES: BrowserCandidate[] = [
  macBrowser("chrome", "Chrome", "Google Chrome"),
  macBrowser("safari", "Safari", "Safari"),
  macBrowser("arc", "Arc", "Arc"),
  macBrowser("brave", "Brave", "Brave Browser"),
  macBrowser("firefox", "Firefox", "Firefox"),
  macBrowser("edge", "Microsoft Edge", "Microsoft Edge"),
  macBrowser("chromium", "Chromium", "Chromium"),
  macBrowser("opera", "Opera", "Opera"),
  macBrowser("vivaldi", "Vivaldi", "Vivaldi"),
];

function macBrowser(id: string, label: string, appName: string): BrowserCandidate {
  const bundleName = `${appName}.app`;
  return {
    id,
    label,
    appName,
    paths: [
      join("/Applications", bundleName),
      join(homedir(), "Applications", bundleName),
      join("/System/Applications", bundleName),
    ],
  };
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

export async function listSystemBrowsers(): Promise<SystemBrowser[]> {
  if (platform() !== "darwin") return [];

  const detected = await Promise.all(
    MAC_BROWSER_CANDIDATES.map(async (candidate) => {
      const detectedPath = await firstExistingPath(candidate.paths);
      return detectedPath ? {
        id: candidate.id,
        label: candidate.label,
        appName: candidate.appName,
        detectedPath,
      } : null;
    }),
  );

  return detected.filter((browser): browser is SystemBrowser => Boolean(browser));
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
    await execFileAsync("open", ["-a", browser.appName, url], { timeout: 10_000 });
    return;
  }

  if (selectedBrowserId) throw new Error("Browser selection is only available on macOS right now.");

  if (osPlatform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url], { timeout: 10_000 });
    return;
  }

  await execFileAsync("xdg-open", [url], { timeout: 10_000 });
}
