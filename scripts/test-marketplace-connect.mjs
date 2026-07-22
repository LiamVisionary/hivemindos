#!/usr/bin/env node
// Connect-rail contract: probe URL-redirect logic (login/checkpoint ⇒
// needs-attention, marketplace page ⇒ connected), start-login creates the
// marketplace account + mirrored socials facebook record with a machine
// binding and opens a HEADED window, probes persist status to both records,
// disconnect keeps the profile on disk, and the profile lock is mutually
// exclusive. Fake browser runner throughout — no real browser.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// Tripwire: capture the REAL vault's marketplace/socials state BEFORE the env
// override, and assert at the end that this run never touched it. A leaked
// facebook:primary record reached the live vault once during development
// (2026-07-18); this makes any regression fail loudly instead of silently
// polluting Liam's real stores.
import { stat } from "node:fs/promises";
const realHome = process.env.HOME ?? ""; // pre-override HOME
const realVault = join(realHome, "Documents", "Obsidian", "hivemindos-vault", "Operations");
async function realVaultSnapshot() {
  const out = {};
  for (const file of ["Marketplace/marketplace.json", "Socials/socials.json"]) {
    out[file] = await stat(join(realVault, file)).then((s) => s.mtimeMs).catch(() => null);
  }
  return JSON.stringify(out);
}
const realVaultBefore = await realVaultSnapshot();

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-marketplace-connect-"));
const tempVault = join(tempHome, "vault");
await mkdir(tempVault, { recursive: true });
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = tempVault;

const { probeBrowserProfileLogin, extractCurrentUrl, looksLoggedOutUrl, evalReadsTrue } = await import("../src/lib/services/browser-profile-connect.ts");
const { acquireMarketplaceProfileLock, MarketplaceProfileBusyError } = await import("../src/lib/services/marketplace/marketplace-profile-lock.ts");
const { startMarketplaceProfileLogin, probeMarketplaceConnectStatus, disconnectMarketplaceAccount } = await import(
  "../src/lib/services/marketplace/marketplace-connect.ts"
);
const { getMarketplaceAccount } = await import("../src/lib/services/marketplace/marketplace-store.ts");
const { getSocialAccount } = await import("../src/lib/services/socials/socials-store.ts");

function fakeRunner(script) {
  const calls = [];
  return {
    calls,
    run: async (input) => {
      calls.push(input);
      const result = script(input, calls);
      return { ok: true, id: "fake", action: input.action ?? "state", args: [], stdout: result ?? "", stderr: "", logPath: "", startedAt: "", finishedAt: "" };
    },
  };
}

// Fake dedicated-browser bootstrap: records headed/headless requests, returns a
// stable CDP endpoint, never spawns anything.
function fakeEnsure() {
  const calls = [];
  return {
    calls,
    ensure: async (profileName, options) => {
      calls.push({ profileName, headed: options?.headed ?? false });
      return { cdpUrl: "http://127.0.0.1:9333", pid: 4242, headed: options?.headed ?? false, launched: false };
    },
  };
}

// ── URL parsing ─────────────────────────────────────────────────────────────
assert.equal(extractCurrentUrl('noise "https://www.facebook.com/login/?next=x" done'), "https://www.facebook.com/login/?next=x");
assert.ok(looksLoggedOutUrl("https://www.facebook.com/checkpoint/12"), "checkpoint = signed out");
assert.ok(!looksLoggedOutUrl("https://www.facebook.com/marketplace/you/selling"));

// ── eval boolean parsing ────────────────────────────────────────────────────
// The real browser-use CLI is Python: booleans print as "result: True". The
// live sign-in poll shipped matching lowercase /\btrue\b/ and never connected
// (2026-07-18) — pin the REAL casing and reject chatter false-positives.
assert.ok(evalReadsTrue("result: True"), "real CLI capital-True output reads as true");
assert.ok(evalReadsTrue("result: true"), "lowercase result still accepted");
assert.ok(!evalReadsTrue("result: False"), "False is not true");
assert.ok(!evalReadsTrue("headed=True session=mkt-x\nresult: False"), "runner chatter containing True never false-positives");
assert.ok(!evalReadsTrue(""), "empty output is not signed in");

// ── probe helper against a fake runner ──────────────────────────────────────
const loggedOut = fakeRunner((input) => (input.action === "current-url" ? "https://www.facebook.com/login/?next=selling" : ""));
const ensure1 = fakeEnsure();
const probe1 = await probeBrowserProfileLogin({ profileName: "marketplace-facebook", probeUrl: "https://www.facebook.com/marketplace/you/selling", runBrowserUseImpl: loggedOut.run, ensureBrowserImpl: ensure1.ensure });
assert.equal(probe1.status, "needs-attention");
assert.match(probe1.detail, /Signed out/);
assert.equal(ensure1.calls[0].profileName, "marketplace-facebook");
assert.equal(ensure1.calls[0].headed, false, "probes run the dedicated browser headless");
assert.equal(loggedOut.calls[0].action, "open");
assert.equal(loggedOut.calls[0].cdpUrl, "http://127.0.0.1:9333", "probes attach over CDP, never --profile (real Chrome) or throwaway sessions");
assert.ok(!loggedOut.calls[0].profile, "the real-Chrome --profile flag is never used");

const loggedIn = fakeRunner((input) => (input.action === "current-url" ? "https://www.facebook.com/marketplace/you/selling" : ""));
assert.equal((await probeBrowserProfileLogin({ profileName: "marketplace-facebook", probeUrl: "https://x.example/probe", runBrowserUseImpl: loggedIn.run, ensureBrowserImpl: fakeEnsure().ensure })).status, "connected");

const broken = fakeRunner(() => {
  throw new Error("browser-use exploded");
});
const probe3 = await probeBrowserProfileLogin({ profileName: "marketplace-facebook", probeUrl: "https://x.example/probe", runBrowserUseImpl: broken.run, ensureBrowserImpl: fakeEnsure().ensure });
assert.equal(probe3.status, "needs-attention", "runner failure degrades, never throws");
assert.match(probe3.detail, /exploded/);

// PASSIVE mode (the sign-in poll): NEVER navigates — reads the current tab +
// signed-in cookie presence only. The first version navigated the tab the
// user was signing in on every 3s, which fed Facebook's ?_rdr redirect loop.
const passiveWaiting = fakeRunner((input) =>
  input.action === "current-url" ? "https://www.facebook.com/" : input.action === "eval" ? "result: False" : "");
const passiveProbe1 = await probeBrowserProfileLogin({
  profileName: "marketplace-facebook",
  probeUrl: "https://www.facebook.com/marketplace/you/selling",
  mode: "passive",
  signedInCookie: "c_user",
  runBrowserUseImpl: passiveWaiting.run,
  ensureBrowserImpl: fakeEnsure().ensure,
});
assert.equal(passiveProbe1.status, "needs-attention");
assert.match(passiveProbe1.detail, /Waiting for you to finish signing in/);
assert.ok(passiveWaiting.calls.every((call) => call.action !== "open"), "passive probe NEVER navigates");
assert.ok(passiveWaiting.calls.some((call) => call.action === "eval" && /c_user/.test(call.script) && /startsWith/.test(call.script)), "cookie check is presence-only");

// Fakes emit the REAL Python casing ("result: True") — a lowercase fake here
// is exactly how the broken matcher stayed green while live never connected.
const passiveSignedIn = fakeRunner((input) =>
  input.action === "current-url" ? "https://www.facebook.com/" : input.action === "eval" ? "result: True" : "");
assert.equal(
  (await probeBrowserProfileLogin({ profileName: "marketplace-facebook", probeUrl: "https://x.example/probe", mode: "passive", signedInCookie: "c_user", runBrowserUseImpl: passiveSignedIn.run, ensureBrowserImpl: fakeEnsure().ensure })).status,
  "connected",
);

const passiveOnLogin = fakeRunner((input) => (input.action === "current-url" ? "https://www.facebook.com/login/?next=x" : "result: False"));
assert.equal(
  (await probeBrowserProfileLogin({ profileName: "marketplace-facebook", probeUrl: "https://x.example/probe", mode: "passive", signedInCookie: "c_user", runBrowserUseImpl: passiveOnLogin.run, ensureBrowserImpl: fakeEnsure().ensure })).status,
  "needs-attention",
  "sitting on the login page reads as not signed in",
);

// A dead browser bootstrap also degrades instead of throwing.
const probe4 = await probeBrowserProfileLogin({
  profileName: "marketplace-facebook",
  probeUrl: "https://x.example/probe",
  runBrowserUseImpl: loggedIn.run,
  ensureBrowserImpl: async () => {
    throw new Error("No Chrome or Playwright Chromium found");
  },
});
assert.equal(probe4.status, "needs-attention");
assert.match(probe4.detail, /No Chrome/);

// ── start-login creates both records + opens a headed window ────────────────
const headed = fakeRunner(() => "");
const headedEnsure = fakeEnsure();
const started = await startMarketplaceProfileLogin("facebook", { runBrowserUseImpl: headed.run, ensureBrowserImpl: headedEnsure.ensure });
assert.equal(started.reconnect, false);
assert.equal(started.account.id, "facebook:primary");
assert.equal(started.profileName, "marketplace-facebook");
assert.equal(started.account.machine.machineKey, hostname(), "profile born on the machine serving the request");
assert.equal(started.account.autonomy, "autonomous");
assert.equal(headed.calls[0].action, "open");
assert.equal(headedEnsure.calls[0].headed, true, "sign-in brings the dedicated browser up HEADED");
assert.equal(headedEnsure.calls[0].profileName, "marketplace-facebook");
assert.equal(headed.calls[0].cdpUrl, "http://127.0.0.1:9333", "sign-in navigation rides the same CDP endpoint");
assert.match(headed.calls[0].url, /^https:\/\/www\.facebook\.com\//, "sign-in opens plain facebook.com (the /marketplace bounce feeds the ?_rdr loop)");
const mirroredSocial = await getSocialAccount("facebook:primary");
assert.ok(mirroredSocial, "socials facebook record mirrored");
assert.equal(mirroredSocial.method, "browser-profile");
assert.equal(mirroredSocial.binding?.profileId, "marketplace-facebook");
assert.ok(!("password" in (mirroredSocial.binding ?? {})), "binding carries no secrets");

// Reconnect reuses the same account + profile.
const reconnect = await startMarketplaceProfileLogin("facebook", { accountId: started.account.id, runBrowserUseImpl: headed.run, ensureBrowserImpl: headedEnsure.ensure });
assert.equal(reconnect.reconnect, true);
assert.equal(reconnect.account.id, started.account.id);

// A fresh Connect click WITHOUT an accountId also reuses the locally-homed
// account — retrying the flow must never mint facebook:account-2 (live bug:
// two clicks created two accounts + two browser profiles).
const reclick = await startMarketplaceProfileLogin("facebook", { runBrowserUseImpl: headed.run, ensureBrowserImpl: headedEnsure.ensure });
assert.equal(reclick.account.id, started.account.id, "no-accountId connect reuses the existing local account");
assert.equal(reclick.reconnect, true);
assert.equal((await import("../src/lib/services/marketplace/marketplace-store.ts").then((m) => m.readMarketplaceAccounts())).length, 1, "still exactly one account");

// ── probe persists status to BOTH records ───────────────────────────────────
const probeOk = await probeMarketplaceConnectStatus(started.account.id, { runBrowserUseImpl: loggedIn.run, ensureBrowserImpl: fakeEnsure().ensure });
assert.equal(probeOk.status, "connected");
assert.equal((await getMarketplaceAccount(started.account.id)).status, "connected");
assert.equal((await getSocialAccount("facebook:primary")).status, "connected");

const probeDead = await probeMarketplaceConnectStatus(started.account.id, { runBrowserUseImpl: loggedOut.run, ensureBrowserImpl: fakeEnsure().ensure });
assert.equal(probeDead.status, "needs-attention");
assert.equal((await getMarketplaceAccount(started.account.id)).status, "needs-attention");

// ── disconnect flips status; profile stays on disk by design ────────────────
await disconnectMarketplaceAccount(started.account.id);
assert.equal((await getMarketplaceAccount(started.account.id)).status, "disconnected");
assert.equal((await getSocialAccount("facebook:primary")).status, "disconnected");

// ── profile lock is mutually exclusive ──────────────────────────────────────
const release = await acquireMarketplaceProfileLock("marketplace-facebook");
await assert.rejects(() => acquireMarketplaceProfileLock("marketplace-facebook", 300), MarketplaceProfileBusyError);
await release();
const release2 = await acquireMarketplaceProfileLock("marketplace-facebook", 300);
await release2();
await assert.rejects(() => acquireMarketplaceProfileLock("../evil", 100), /Invalid marketplace profile name/);

assert.equal(await realVaultSnapshot(), realVaultBefore, "TRIPWIRE: this run modified the REAL vault's marketplace/socials files — isolation is broken");

console.log("marketplace connect tests passed");
