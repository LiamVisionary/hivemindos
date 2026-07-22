import "server-only";

import { hostname } from "node:os";

import { openBrowserProfileLogin, probeBrowserProfileLogin, type BrowserProfileRunner } from "@/lib/services/browser-profile-connect";
import type { EnsureMarketplaceBrowser } from "@/lib/services/marketplace/marketplace-browser-runtime";
import { sameMachineIdentity } from "@/features/fleet/fleet-identity";
import { marketplaceProviderRow } from "@/lib/services/marketplace/marketplace-provider-matrix";
import {
  createMarketplaceAccount,
  getMarketplaceAccount,
  readMarketplaceAccounts,
  updateMarketplaceAccount,
} from "@/lib/services/marketplace/marketplace-store";
import {
  createSocialAccount,
  getSocialAccount,
  socialAccountId,
  updateSocialAccount,
} from "@/lib/services/socials/socials-store";
import type { MarketplaceAccount, MarketplaceProvider } from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace connect flow — the browser-profile method.
 *
 * v1 rule: the managed browser profile is born on the machine SERVING the
 * connect request (opening a headed window on a remote machine is a later
 * rail); the account records the machine binding so all future agent ops pin
 * to it. Connecting also creates the matching Socials facebook account, so
 * the connection shows in both surfaces from one sign-in.
 */

const LOCAL_COLLECTOR_URL = "http://127.0.0.1:8787";

function nextAccountSlug(existing: MarketplaceAccount[], provider: MarketplaceProvider): string {
  const count = existing.filter((account) => account.provider === provider).length;
  return count === 0 ? "primary" : `account-${count + 1}`;
}

function browserProfileSpec(provider: MarketplaceProvider) {
  const method = marketplaceProviderRow(provider).methods.find((candidate) => candidate.method === "browser-profile");
  if (!method?.browserProfile) {
    throw new Error(`${provider} does not support the browser-profile connect method.`);
  }
  return method.browserProfile;
}

export type StartMarketplaceLoginResult = {
  account: MarketplaceAccount;
  profileName: string;
  /** True when the account already existed and we only reopened the sign-in window. */
  reconnect: boolean;
};

/**
 * Open the headed sign-in window under the managed profile and make sure the
 * account records (marketplace + socials facebook) exist. Requires browser-use
 * Full permissions — the runner's own error is surfaced verbatim.
 */
export async function startMarketplaceProfileLogin(
  provider: MarketplaceProvider,
  options?: { accountId?: string; runBrowserUseImpl?: BrowserProfileRunner; ensureBrowserImpl?: EnsureMarketplaceBrowser },
): Promise<StartMarketplaceLoginResult> {
  const spec = browserProfileSpec(provider);
  const accounts = await readMarketplaceAccounts();
  const machineKey = hostname();
  // Without an explicit accountId, REUSE the provider's account homed on this
  // machine — every fresh "Connect" click used to mint another account
  // (facebook:primary, facebook:account-2, …) because the flow never passes an
  // id. Additional accounts are a deliberate future affordance, not a side
  // effect of retrying the connect flow.
  const existing = options?.accountId
    ? accounts.find((account) => account.id === options.accountId) ?? null
    : accounts.find((account) => account.provider === provider && sameMachineIdentity(account.machine.machineKey, machineKey)) ?? null;
  if (existing && !sameMachineIdentity(existing.machine.machineKey, machineKey)) {
    throw new Error(
      `This account's browser session lives on ${existing.machine.machineName}. Open the dashboard on that machine to sign in again.`,
    );
  }
  let account = existing;
  let reconnect = Boolean(existing);
  if (!account) {
    const slug = nextAccountSlug(accounts, provider);
    const profileName = slug === "primary" ? spec.namePrefix : `${spec.namePrefix}-${slug}`;
    account = await createMarketplaceAccount({
      provider,
      slug,
      method: "browser-profile",
      machine: { machineKey, machineName: machineKey, collectorUrl: LOCAL_COLLECTOR_URL, profileName },
      socialAccountId: socialAccountId("facebook", slug),
    });
    reconnect = false;
    // Mirror into the Socials tab (facebook is connection-only there). A
    // pre-existing socials record for this slug is fine — keep it.
    const socialId = socialAccountId("facebook", slug);
    if (!(await getSocialAccount(socialId))) {
      await createSocialAccount({
        platform: "facebook",
        handle: slug,
        method: "browser-profile",
        binding: { machineKey, machineLabel: machineKey, profileId: profileName },
      });
    }
  }
  await openBrowserProfileLogin({
    profileName: account.machine.profileName,
    loginUrl: spec.loginUrl,
    ...(options?.runBrowserUseImpl ? { runBrowserUseImpl: options.runBrowserUseImpl } : {}),
    ...(options?.ensureBrowserImpl ? { ensureBrowserImpl: options.ensureBrowserImpl } : {}),
  });
  return { account, profileName: account.machine.profileName, reconnect };
}

export type MarketplaceConnectProbeResult = {
  status: MarketplaceAccount["status"];
  detail?: string;
};

/**
 * Probe the account's browser session and persist the resulting status on
 * both the marketplace account and its mirrored socials record. On a foreign
 * machine the stored status is returned untouched (the session can only be
 * observed where it lives).
 */
export async function probeMarketplaceConnectStatus(
  accountId: string,
  options?: { passive?: boolean; runBrowserUseImpl?: BrowserProfileRunner; ensureBrowserImpl?: EnsureMarketplaceBrowser },
): Promise<MarketplaceConnectProbeResult> {
  const account = await getMarketplaceAccount(accountId);
  if (!account) throw new Error(`Unknown marketplace account: ${accountId}`);
  if (!sameMachineIdentity(account.machine.machineKey, hostname())) {
    return {
      status: account.status,
      detail: `The browser session lives on ${account.machine.machineName}; probe it from that machine.`,
    };
  }
  const spec = browserProfileSpec(account.provider);
  const probe = await probeBrowserProfileLogin({
    profileName: account.machine.profileName,
    probeUrl: spec.probeUrl,
    // Passive = the sign-in poll: reads the current tab + signed-in cookie
    // presence, NEVER navigates (navigating fought the user mid-sign-in and
    // fed Facebook's redirect loop).
    ...(options?.passive ? { mode: "passive" as const, ...(spec.signedInCookie ? { signedInCookie: spec.signedInCookie } : {}) } : {}),
    ...(options?.runBrowserUseImpl ? { runBrowserUseImpl: options.runBrowserUseImpl } : {}),
    ...(options?.ensureBrowserImpl ? { ensureBrowserImpl: options.ensureBrowserImpl } : {}),
    signedOutDetail: "Signed out — finish signing in inside the managed browser window, then probe again.",
  });
  // During a passive sign-in poll, a not-yet-signed-in read is expected — keep
  // the stored status untouched (also avoids rewriting the vault file every 3s).
  const status: MarketplaceAccount["status"] =
    probe.status === "connected" ? "connected" : options?.passive ? account.status : "needs-attention";
  if (status !== account.status) {
    await updateMarketplaceAccount(account.id, { status });
    if (account.socialAccountId) {
      await updateSocialAccount(account.socialAccountId, (record) => ({ ...record, status, updatedAt: new Date().toISOString() })).catch(() => null);
    }
  }
  return { status: probe.status, ...(probe.detail ? { detail: probe.detail } : {}) };
}

export async function disconnectMarketplaceAccount(accountId: string): Promise<void> {
  const account = await getMarketplaceAccount(accountId);
  if (!account) return;
  await updateMarketplaceAccount(accountId, { status: "disconnected" });
  if (account.socialAccountId) {
    await updateSocialAccount(account.socialAccountId, (record) => ({ ...record, status: "disconnected", updatedAt: new Date().toISOString() })).catch(() => null);
  }
  // Stop the dedicated browser when we own it (local machine); the persistent
  // profile directory stays on disk by design, so a re-connect reuses the
  // signed-in session if it is still valid.
  if (sameMachineIdentity(account.machine.machineKey, hostname())) {
    const { stopMarketplaceBrowser } = await import("@/lib/services/marketplace/marketplace-browser-runtime");
    await stopMarketplaceBrowser(account.machine.profileName).catch(() => undefined);
  }
}
