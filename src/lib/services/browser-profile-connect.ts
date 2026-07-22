import { runBrowserUse } from "@/lib/services/browser-use-runner";
import { ensureMarketplaceBrowser, type EnsureMarketplaceBrowser } from "@/lib/services/marketplace/marketplace-browser-runtime";
import { acquireMarketplaceProfileLock } from "@/lib/services/marketplace/marketplace-profile-lock";

/**
 * Shared "managed browser profile" connect rail: a dedicated persistent
 * Chrome instance HivemindOS launches with its own user-data-dir (see
 * marketplace-browser-runtime.ts — the browser-use CLI's `--profile` means
 * the user's REAL Chrome and its sessions don't persist, so we own the
 * browser and attach every browser-use call via `--cdp-url`). The user signs
 * in once in the headed window; services then probe or automate the same
 * instance. Used by the Marketplace connect flow and the Socials facebook
 * adapter. The session lives on THIS machine, never in env keys or records.
 */

/** URL fragments that mean a session is signed out or checkpointed. */
export const LOGGED_OUT_URL_MARKERS = ["/login", "/checkpoint", "/recover", "login.php"];

export type BrowserProfileRunner = typeof runBrowserUse;

export function extractCurrentUrl(stdout: string): string {
  // `current-url` evaluates location.href; the CLI prints the value with
  // runner chatter around it. Take the last http(s) URL in the output.
  const matches = stdout.match(/https?:\/\/[^\s"']+/g);
  return matches?.length ? matches[matches.length - 1] : "";
}

export function looksLoggedOutUrl(url: string): boolean {
  if (!url) return false;
  return LOGGED_OUT_URL_MARKERS.some((marker) => url.includes(marker));
}

/**
 * The browser-use CLI is Python — a JS boolean eval prints as "result: True".
 * Match only the result line, case-insensitively, so incidental runner chatter
 * (e.g. "headed=True") can never read as a signed-in session.
 */
export function evalReadsTrue(stdout: string): boolean {
  return /\bresult:\s*true\b/i.test(stdout);
}

export type BrowserProfileProbeResult = {
  status: "connected" | "needs-attention";
  detail?: string;
};

/**
 * One browser-use call attached to the profile's dedicated browser. Each
 * profile gets its own CLI session name, and a stale session daemon (the CDP
 * port changes whenever the browser relaunches) is closed and retried once —
 * the CLI refuses mismatched configs with "already running with different
 * config" instead of re-attaching.
 */
export async function runBrowserUseOverCdp(
  browserUse: BrowserProfileRunner,
  profileName: string,
  cdpUrl: string,
  input: Parameters<BrowserProfileRunner>[0],
): ReturnType<BrowserProfileRunner> {
  const session = `mkt-${profileName}`;
  try {
    return await browserUse({ ...input, cdpUrl, session });
  } catch (error) {
    if (error instanceof Error && /already running with different config/i.test(error.message)) {
      await browserUse({ action: "close", session }).catch(() => undefined);
      return await browserUse({ ...input, cdpUrl, session });
    }
    throw error;
  }
}

/**
 * Check whether the profile's dedicated browser is signed in.
 *
 * mode "navigate" (default): open `probeUrl` and read where the browser
 * actually landed — a login/checkpoint redirect means signed out. Used by the
 * monitor and settings probes.
 *
 * mode "passive": NEVER navigates — reads the current tab's URL and (when the
 * provider declares a signed-in cookie) evaluates a boolean cookie-presence
 * check. This is the sign-in poll: the first version navigated the very tab
 * the user was signing in on every few seconds, which both fought the user
 * and fed Facebook's ?_rdr redirect loop.
 *
 * Never throws for a dead session — only for programmer errors.
 */
export async function probeBrowserProfileLogin(input: {
  profileName: string;
  probeUrl: string;
  mode?: "navigate" | "passive";
  /** Cookie name whose presence means signed-in (e.g. facebook "c_user"); required for a conclusive passive probe. */
  signedInCookie?: string;
  runBrowserUseImpl?: BrowserProfileRunner;
  ensureBrowserImpl?: EnsureMarketplaceBrowser;
  signedOutDetail?: string;
}): Promise<BrowserProfileProbeResult> {
  const browserUse = input.runBrowserUseImpl ?? runBrowserUse;
  const ensureBrowser = input.ensureBrowserImpl ?? ensureMarketplaceBrowser;
  const passive = input.mode === "passive";
  try {
    const release = await acquireMarketplaceProfileLock(input.profileName);
    try {
      const browser = await ensureBrowser(input.profileName, { headed: passive });
      if (!passive) {
        await runBrowserUseOverCdp(browserUse, input.profileName, browser.cdpUrl, { action: "open", url: input.probeUrl });
      }
      const result = await runBrowserUseOverCdp(browserUse, input.profileName, browser.cdpUrl, { action: "current-url" });
      const url = extractCurrentUrl(result.stdout);
      if (looksLoggedOutUrl(url)) {
        return { status: "needs-attention", detail: input.signedOutDetail ?? "Signed out — run Connect to sign in again." };
      }
      if (passive) {
        if (!input.signedInCookie) {
          return { status: "needs-attention", detail: "Waiting for sign-in (no signed-in cookie configured for a passive check)." };
        }
        // Boolean-only eval: presence of the signed-in cookie, never its value.
        const cookieCheck = await runBrowserUseOverCdp(browserUse, input.profileName, browser.cdpUrl, {
          action: "eval",
          script: `document.cookie.split("; ").some((entry) => entry.startsWith(${JSON.stringify(input.signedInCookie)} + "="))`,
        });
        return evalReadsTrue(cookieCheck.stdout)
          ? { status: "connected" }
          : { status: "needs-attention", detail: "Waiting for you to finish signing in inside the browser window." };
      }
      if (!url) {
        return { status: "needs-attention", detail: "Could not read the browser session state. Try the probe again." };
      }
      return { status: "connected" };
    } finally {
      await release();
    }
  } catch (error) {
    return { status: "needs-attention", detail: error instanceof Error ? error.message : "Browser probe failed." };
  }
}

/**
 * Kick off the one-time sign-in: bring up the profile's dedicated browser
 * HEADED on this machine and navigate it to the provider's login page. The
 * user signs in by hand; the caller then polls probeBrowserProfileLogin until
 * it flips to connected. Requires browser-use Full permissions (the runner
 * gates cdp attach — surface its error verbatim).
 */
export async function openBrowserProfileLogin(input: {
  profileName: string;
  loginUrl: string;
  runBrowserUseImpl?: BrowserProfileRunner;
  ensureBrowserImpl?: EnsureMarketplaceBrowser;
}): Promise<void> {
  const browserUse = input.runBrowserUseImpl ?? runBrowserUse;
  const ensureBrowser = input.ensureBrowserImpl ?? ensureMarketplaceBrowser;
  const release = await acquireMarketplaceProfileLock(input.profileName);
  try {
    const browser = await ensureBrowser(input.profileName, { headed: true });
    await runBrowserUseOverCdp(browserUse, input.profileName, browser.cdpUrl, { action: "open", url: input.loginUrl });
  } finally {
    await release();
  }
}
