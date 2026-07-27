import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

export type DeliverableOpenApp = {
  id: string;
  name: string;
  isDefault: boolean;
};

type MacApplicationRecord = {
  bundleId?: unknown;
  name?: unknown;
  path?: unknown;
};

const execFileAsync = promisify(execFile);
const BLOCKED_MAC_BUNDLE_IDS = new Set([
  "com.apple.Notes",
  "com.apple.dt.Instruments",
  "com.google.chrome.for.testing",
]);
const MAC_APPLICATION_ROOTS = ["/Applications/", "/System/Applications/", "/System/Library/CoreServices/"];
const MAC_APP_QUERY = String.raw`
ObjC.import("AppKit");
function bundleRecord(appUrl) {
  if (!appUrl) return null;
  const bundle = $.NSBundle.bundleWithURL(appUrl);
  return {
    name: ObjC.unwrap(appUrl.lastPathComponent.stringByDeletingPathExtension),
    bundleId: ObjC.unwrap(bundle.bundleIdentifier),
    path: ObjC.unwrap(appUrl.path),
  };
}
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const workspace = $.NSWorkspace.sharedWorkspace;
  const urls = workspace.URLsForApplicationsToOpenURL(url);
  const apps = [];
  for (let index = 0; index < urls.count; index += 1) {
    apps.push(bundleRecord(urls.objectAtIndex(index)));
  }
  return JSON.stringify({
    defaultApp: bundleRecord(workspace.URLForApplicationToOpenURL(url)),
    apps,
  });
}`;

function applicationPriority(app: DeliverableOpenApp) {
  const name = app.name.toLowerCase();
  if (name.includes("visual studio code") || name === "cursor" || name === "zed") return 10;
  if (name.includes("sublime") || name.includes("bbedit") || name.includes("nova")) return 20;
  if (name === "xcode" || name.includes("pycharm") || name.includes("webstorm")) return 30;
  if (name === "textedit" || name === "preview") return 40;
  if (name === "safari" || name === "google chrome" || name === "firefox") return 50;
  return 100;
}

export function normalizeMacOpenApplications(
  records: MacApplicationRecord[],
  defaultBundleId: string,
): DeliverableOpenApp[] {
  const seen = new Set<string>();
  return records.flatMap((record): DeliverableOpenApp[] => {
    const bundleId = typeof record.bundleId === "string" ? record.bundleId.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const installedInApplicationFolder = MAC_APPLICATION_ROOTS.some((root) => path.startsWith(root));
    if (
      !bundleId
      || !name
      || !installedInApplicationFolder
      || path.includes("/Contents/Applications/")
      || BLOCKED_MAC_BUNDLE_IDS.has(bundleId)
      || seen.has(bundleId)
    ) return [];
    seen.add(bundleId);
    return [{ id: `bundle:${bundleId}`, name, isDefault: bundleId === defaultBundleId }];
  }).sort((left, right) => (
    Number(right.isDefault) - Number(left.isDefault)
    || applicationPriority(left) - applicationPriority(right)
    || left.name.localeCompare(right.name)
  )).slice(0, 8);
}

async function macOpenApplications(path: string) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", [
    "-l",
    "JavaScript",
    "-e",
    MAC_APP_QUERY,
    path,
  ], { maxBuffer: 256 * 1024, timeout: 5_000 });
  const payload = JSON.parse(stdout) as { defaultApp?: MacApplicationRecord | null; apps?: MacApplicationRecord[] };
  const defaultBundleId = typeof payload.defaultApp?.bundleId === "string" ? payload.defaultApp.bundleId : "";
  return normalizeMacOpenApplications(Array.isArray(payload.apps) ? payload.apps : [], defaultBundleId);
}

async function commandAvailable(command: string) {
  const detector = platform() === "win32" ? "where.exe" : "which";
  return execFileAsync(detector, [command], { timeout: 2_000 }).then(() => true).catch(() => false);
}

export async function discoverDeliverableOpenApps(path: string): Promise<DeliverableOpenApp[]> {
  if (platform() === "darwin") return macOpenApplications(path).catch(() => []);
  return (await commandAvailable("code"))
    ? [{ id: "vscode", name: "Visual Studio Code", isDefault: false }]
    : [];
}

export async function openDeliverableInApp(path: string, appId: string) {
  if (platform() === "darwin" && appId.startsWith("bundle:")) {
    const bundleId = appId.slice("bundle:".length);
    if (!/^[A-Za-z0-9.-]{3,160}$/.test(bundleId)) throw new Error("The selected application is invalid.");
    const available = await discoverDeliverableOpenApps(path);
    if (!available.some((app) => app.id === appId)) {
      throw new Error("That application is not registered to open this file type.");
    }
    await execFileAsync("/usr/bin/open", ["-b", bundleId, path], { timeout: 10_000 });
    return;
  }
  if (appId === "vscode" && await commandAvailable("code")) {
    await execFileAsync("code", [path], { timeout: 10_000 });
    return;
  }
  throw new Error("That application is not available for this file.");
}

export function deliverableFileManagerLabel() {
  if (platform() === "darwin") return "Finder";
  if (platform() === "win32") return "File Explorer";
  return "file manager";
}
