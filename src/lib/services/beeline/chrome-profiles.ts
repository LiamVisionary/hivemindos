import "server-only";

import { execFile as nodeExecFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform as currentPlatform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { optionalEnv } from "@/lib/config/env";
import { homedir } from "@/lib/home-dir";
import { listSystemBrowsers, type SystemBrowser } from "@/lib/services/system-browsers";

const execFileAsync = promisify(nodeExecFile);

export type ChromeProfile = { directory: string; name: string };

type ChromeProfileOptions = {
  localStatePath?: string;
  platform?: NodeJS.Platform;
  chrome?: Pick<SystemBrowser, "appName" | "detectedPath">;
  execFile?: (command: string, args: string[]) => Promise<unknown>;
};

function chromeLocalStatePath(osPlatform: NodeJS.Platform) {
  if (osPlatform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Google", "Chrome", "Local State");
  }
  if (osPlatform === "win32") {
    return join(optionalEnv("LOCALAPPDATA") || homedir(), "Google", "Chrome", "User Data", "Local State");
  }
  return join(homedir(), ".config", "google-chrome", "Local State");
}

function cleanProfileText(value: unknown, maximumLength = 120) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximumLength) : "";
}

export async function listChromeProfiles(options: ChromeProfileOptions = {}): Promise<ChromeProfile[]> {
  const path = options.localStatePath || chromeLocalStatePath(options.platform ?? currentPlatform());
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(raw) as { profile?: { info_cache?: Record<string, { name?: unknown }> } };
  const cache = parsed.profile?.info_cache;
  if (!cache || typeof cache !== "object") return [];
  return Object.entries(cache)
    .map(([directory, metadata]) => ({
      directory: cleanProfileText(directory),
      name: cleanProfileText(metadata?.name) || cleanProfileText(directory),
    }))
    .filter((profile) => profile.directory && profile.name)
    .sort((left, right) => left.directory === "Default" ? -1 : right.directory === "Default" ? 1 : left.directory.localeCompare(right.directory));
}

export async function openChromeProfile(profileDirectory: string, options: ChromeProfileOptions = {}) {
  const directory = cleanProfileText(profileDirectory);
  const profiles = await listChromeProfiles(options);
  const profile = profiles.find((candidate) => candidate.directory === directory);
  if (!profile) throw new Error("That Chrome profile is no longer available on this device.");
  const chrome = options.chrome ?? (await listSystemBrowsers()).find((browser) => browser.id === "chrome");
  if (!chrome) throw new Error("Google Chrome is not installed on this device.");
  const run = options.execFile ?? (async (command: string, args: string[]) => {
    await execFileAsync(command, args, { timeout: 10_000 });
  });
  const osPlatform = options.platform ?? currentPlatform();
  if (osPlatform === "darwin") {
    await run("open", ["-a", chrome.appName, "--args", `--profile-directory=${profile.directory}`]);
  } else {
    await run(chrome.detectedPath, [`--profile-directory=${profile.directory}`]);
  }
  return {
    profile,
    automation: {
      browserUseFactory: "Browser.from_system_chrome",
      profileDirectory: profile.directory,
      note: "Chrome may need to be fully closed before trusted automation attaches to this profile.",
    },
  };
}

