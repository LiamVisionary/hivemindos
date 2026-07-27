import "server-only";

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { homedir } from "@/lib/home-dir";
import { listSystemBrowsers } from "@/lib/services/system-browsers";

/**
 * The persistent browser behind a marketplace "browser-profile" connection.
 *
 * Why this exists: the browser-use CLI's `--profile` flag selects one of the
 * user's REAL Chrome profiles (and errors on unknown names), and its
 * profile-less sessions run Chromium on a THROWAWAY temp user-data-dir — a
 * Facebook login there would evaporate on close (confirmed against the
 * installed CLI source + a live session, 2026-07-18). So HivemindOS owns the
 * browser: we launch a dedicated Chrome/Chromium instance with a persistent
 * user-data-dir under ~/.hivemindos/marketplace/profiles/<name>/ and a CDP
 * endpoint, and every browser-use call attaches via `--cdp-url`. This never
 * touches the user's own Chrome (separate user-data-dir = separate instance),
 * survives reboots (cookies live in our dir; the instance relaunches on
 * demand), and needs no port picking (`--remote-debugging-port=0` + Chrome's
 * DevToolsActivePort file).
 */

const PROFILES_ROOT = () => join(homedir(), ".hivemindos", "marketplace", "profiles");

type BrowserRuntimeState = {
  pid: number;
  headed: boolean;
  startedAt: string;
};

export type MarketplaceBrowserInfo = {
  cdpUrl: string;
  pid: number;
  headed: boolean;
  /** True when this call launched the instance (vs reusing a live one). */
  launched: boolean;
};

function safeProfileName(profileName: string): string {
  const safe = profileName.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(safe)) throw new Error(`Invalid marketplace profile name: ${profileName}`);
  return safe;
}

function profileDir(profileName: string): string {
  return join(PROFILES_ROOT(), safeProfileName(profileName));
}

function stateFile(profileName: string): string {
  return join(PROFILES_ROOT(), `${safeProfileName(profileName)}.runtime.json`);
}

/** Chrome writes "<port>\n<browser-target>" here once DevTools is listening. */
async function readDevToolsPort(directory: string): Promise<number | null> {
  try {
    const text = await fs.readFile(join(directory, "DevToolsActivePort"), "utf8");
    const port = Number.parseInt(text.split("\n")[0]?.trim() ?? "", 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * The endpoint handed to browser-use is the browser's WebSocket debugger URL,
 * not the plain http one: the CLI's session daemon stores the resolved ws URL
 * in its config, so re-invocations only match (and reuse the daemon instead
 * of erroring "already running with different config") when we pass the same
 * ws URL. It is stable for the life of the Chrome process.
 */
async function cdpEndpoint(port: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { webSocketDebuggerUrl?: string };
    return body.webSocketDebuggerUrl?.trim() || `http://127.0.0.1:${port}`;
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readState(profileName: string): Promise<BrowserRuntimeState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile(profileName), "utf8")) as BrowserRuntimeState;
    return typeof parsed?.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeState(profileName: string, state: BrowserRuntimeState): Promise<void> {
  await fs.mkdir(PROFILES_ROOT(), { recursive: true, mode: 0o700 });
  await fs.writeFile(stateFile(profileName), JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** A macOS .app bundle path needs its inner MacOS binary for a direct spawn. */
async function bundleExecutable(detectedPath: string, appName: string): Promise<string | null> {
  if (!detectedPath.endsWith(".app")) return detectedPath;
  const named = join(detectedPath, "Contents", "MacOS", appName);
  if (await fs.access(named).then(() => true, () => false)) return named;
  const macosDir = join(detectedPath, "Contents", "MacOS");
  const entries = await fs.readdir(macosDir).catch(() => [] as string[]);
  return entries.length ? join(macosDir, entries[0]) : null;
}

/** Prefer the user's real Chrome binary (best marketplace fingerprint); fall back to Playwright's Chromium. */
export async function resolveBrowserExecutable(): Promise<string> {
  const browsers = await listSystemBrowsers().catch(() => []);
  const chrome = browsers.find((browser) => browser.id === "chrome" && browser.detectedPath);
  if (chrome?.detectedPath) {
    const executable = await bundleExecutable(chrome.detectedPath, chrome.appName);
    if (executable) return executable;
  }
  // Playwright's Chromium (installed by `browser-use install`).
  const cacheRoots = [
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
  ];
  for (const root of cacheRoots) {
    const entries = await fs.readdir(root).catch(() => [] as string[]);
    for (const entry of entries.filter((name) => name.startsWith("chromium")).sort().reverse()) {
      for (const candidate of [
        join(root, entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(root, entry, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(root, entry, "chrome-linux", "chrome"),
      ]) {
        if (await fs.access(candidate).then(() => true, () => false)) return candidate;
      }
    }
  }
  throw new Error("No Chrome or Playwright Chromium found for the marketplace browser. Install Google Chrome, or run `browser-use install`.");
}

async function killOwnInstance(profileName: string): Promise<void> {
  const state = await readState(profileName);
  if (state && processAlive(state.pid)) {
    // Our own spawned child, never someone else's process (pid recorded at spawn).
    try {
      process.kill(state.pid);
    } catch {
      // already gone
    }
    for (let i = 0; i < 20 && processAlive(state.pid); i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await fs.rm(join(profileDir(profileName), "DevToolsActivePort"), { force: true }).catch(() => undefined);
}

/**
 * Ensure the profile's dedicated browser is running and return its CDP URL.
 * `headed: true` (the sign-in flow) needs a visible window: a live headless
 * instance is OUR child, so it is restarted headed; a live headed instance is
 * reused either way.
 */
export async function ensureMarketplaceBrowser(
  profileName: string,
  options?: { headed?: boolean; fetchImpl?: typeof fetch },
): Promise<MarketplaceBrowserInfo> {
  const headed = options?.headed ?? false;
  const directory = profileDir(profileName);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const state = await readState(profileName);
  if (state && processAlive(state.pid)) {
    const port = await readDevToolsPort(directory);
    const endpoint = port ? await cdpEndpoint(port, options?.fetchImpl) : null;
    if (endpoint) {
      if (!headed || state.headed) {
        return { cdpUrl: endpoint, pid: state.pid, headed: state.headed, launched: false };
      }
      // Need a window but the live instance is headless — swap our own child.
      await killOwnInstance(profileName);
    }
  }

  const executable = await resolveBrowserExecutable();
  await fs.rm(join(directory, "DevToolsActivePort"), { force: true }).catch(() => undefined);
  const args = [
    `--user-data-dir=${directory}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    ...(headed ? [] : ["--headless=new"]),
    "about:blank",
  ];
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error("The marketplace browser failed to spawn.");
  await writeState(profileName, { pid, headed, startedAt: new Date().toISOString() });

  // Wait for DevTools to come up (Chrome writes DevToolsActivePort when ready).
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const port = await readDevToolsPort(directory);
    const endpoint = port ? await cdpEndpoint(port, options?.fetchImpl) : null;
    if (endpoint) {
      return { cdpUrl: endpoint, pid, headed, launched: true };
    }
    if (!processAlive(pid)) break;
  }
  throw new Error(
    "The marketplace browser started but its DevTools endpoint never came up. If Chrome showed a profile-lock dialog, close it and try again.",
  );
}

/** Stop the profile's dedicated browser (our own child only). */
export async function stopMarketplaceBrowser(profileName: string): Promise<void> {
  await killOwnInstance(profileName);
  await fs.rm(stateFile(profileName), { force: true }).catch(() => undefined);
}

export type EnsureMarketplaceBrowser = typeof ensureMarketplaceBrowser;

export type ReadBrowserTabResult = { url: string; text: string };
export type ReadBrowserTab = (profileName: string, url: string, options?: { settleMs?: number }) => Promise<ReadBrowserTabResult>;

/**
 * Load a URL in a NEW tab of the profile's dedicated browser, read back where
 * it landed plus the visible text, and close the tab — the user's own tab is
 * never touched. This is the dispatcher's INDEPENDENT observation for claims
 * agents make: a session fabricated a Marketplace listing id AND its own
 * "read-back" (2026-07-18, VeniceAgent, externalId "1234567890"), so state
 * flips must be grounded in a page THIS process saw. Needs the Node ≥22
 * global WebSocket; callers must treat its absence as "cannot observe",
 * never as a verification pass.
 */
export async function readBrowserTab(
  profileName: string,
  url: string,
  options?: { settleMs?: number },
): Promise<ReadBrowserTabResult> {
  if (typeof WebSocket === "undefined") {
    throw new Error("Browser tab observation needs Node >= 22 (global WebSocket).");
  }
  const browser = await ensureMarketplaceBrowser(profileName, { headed: false });
  const socket = new WebSocket(browser.cdpUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("Could not open the browser CDP socket."));
  });
  let nextId = 0;
  const call = (method: string, params: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const handler = (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as { id?: number; error?: { message?: string }; result?: Record<string, unknown> };
        if (message.id !== id) return;
        socket.removeEventListener("message", handler);
        if (message.error) reject(new Error(message.error.message ?? "CDP call failed"));
        else resolve(message.result ?? {});
      };
      socket.addEventListener("message", handler);
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  try {
    const { targetId } = (await call("Target.createTarget", { url })) as { targetId: string };
    try {
      const { sessionId } = (await call("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
      await new Promise((resolve) => setTimeout(resolve, options?.settleMs ?? 8_000));
      const evaluated = await call("Runtime.evaluate", {
        expression: `JSON.stringify({ url: location.href, text: (document.body ? document.body.innerText : "").slice(0, 5000) })`,
        returnByValue: true,
      }, sessionId);
      const raw = (evaluated as { result?: { value?: string } }).result?.value ?? "";
      const parsed = raw ? (JSON.parse(raw) as ReadBrowserTabResult) : { url: "", text: "" };
      return { url: parsed.url ?? "", text: parsed.text ?? "" };
    } finally {
      await call("Target.closeTarget", { targetId }).catch(() => undefined);
    }
  } finally {
    socket.close();
  }
}
