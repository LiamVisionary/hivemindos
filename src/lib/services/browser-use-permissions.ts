import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "@/lib/home-dir";

const PERMISSIONS_FILE = join(homedir(), ".hivemindos", "browser-use", "permissions.json");

export type BrowserUsePermissions = {
  fullAccess: boolean;
  approvedAt?: string;
  updatedAt?: string;
};

export async function readBrowserUsePermissions(): Promise<BrowserUsePermissions> {
  const raw = await readFile(PERMISSIONS_FILE, "utf8").catch(() => "");
  if (!raw.trim()) return { fullAccess: false };
  try {
    const parsed = JSON.parse(raw) as Partial<BrowserUsePermissions>;
    return {
      fullAccess: parsed.fullAccess === true,
      approvedAt: typeof parsed.approvedAt === "string" ? parsed.approvedAt : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch {
    return { fullAccess: false };
  }
}

export async function setBrowserUseFullAccess(fullAccess: boolean): Promise<BrowserUsePermissions> {
  const now = new Date().toISOString();
  const next: BrowserUsePermissions = {
    fullAccess,
    approvedAt: fullAccess ? now : undefined,
    updatedAt: now,
  };
  await mkdir(dirname(PERMISSIONS_FILE), { recursive: true, mode: 0o700 });
  await writeFile(PERMISSIONS_FILE, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return next;
}
