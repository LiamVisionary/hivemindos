import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const authSecret = "a".repeat(64);
const deviceToken = "b".repeat(64);
const home = await mkdtemp(join(tmpdir(), "hivemindos-passkeys-"));
const passkeyStorePath = join(home, ".hivemindos", "dashboard-passkeys.json");
const policyBundle = JSON.parse(await readFile(join(process.cwd(), "legal", "hivemindos-policies.json"), "utf8"));
const acceptedTerms = JSON.stringify({ version: policyBundle.terms.version, acceptedAt: "2026-07-14T12:00:00.000Z" });
const port = await freePort();
const baseUrl = `http://localhost:${port}`;
await assertNativeBiometricBridge();
const child = spawn(process.execPath, [
  join(process.cwd(), "node_modules", "next", "dist", "bin", "next"),
  "dev",
  "--webpack",
  "--disable-source-maps",
  "-p",
  String(port),
  "-H",
  "127.0.0.1",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HIVEMINDOS_DASHBOARD_AUTH_SECRET: authSecret,
    HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: deviceToken,
    HIVEMINDOS_NATIVE: "",
    HIVEMINDOS_TAURI_BUILD: "1",
    HIVEMINDOS_COMPANY_AUTONOMY_DRIVER: "0",
    HIVEMINDOS_HIVE_COMPUTE_RESUME: "0",
    HIVEMINDOS_INBOX_TRIAGE: "0",
    HIVEMINDOS_RESEARCH_SYNC: "0",
    HIVEMINDOS_TELEGRAM_TIP_BOT_AUTOSTART: "0",
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

let browser;
try {
  await waitForServer();
  await assertAnonymousPasskeyBoundary();

  browser = await chromium.launch({ headless: true });
  await assertNativeTouchIdOffer(browser);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session" || url.pathname.startsWith("/api/auth/passkeys")) {
      await route.continue();
      return;
    }
    if (url.pathname === "/api/dashboard/state") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          values: {
            "hivemindos.terms.acceptance.v1": acceptedTerms,
          },
        }),
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.locator('input[name="token"]').fill(deviceToken);
  await page.getByRole("button", { name: "Unlock dashboard" }).click({ noWaitAfter: true });
  const securityButton = page.locator('button[aria-label="Dashboard security"]:visible');
  await securityButton.waitFor({ state: "visible", timeout: 180_000 });

  await assertFooterTooltipKeepsShelfExpanded(page, securityButton, "Manage security and passkeys");
  const themeButton = page.locator('button[aria-label^="Switch to "]:visible');
  const themeTooltipText = await themeButton.getAttribute("aria-label");
  assert.ok(themeTooltipText, "Theme control should expose its tooltip text as an accessible label");
  await assertFooterTooltipKeepsShelfExpanded(page, themeButton, themeTooltipText);

  await securityButton.click();
  await page.getByRole("dialog", { name: "Face ID, Touch ID & passkeys" }).waitFor({ state: "visible" });
  const addButton = page.getByRole("button", { name: "Add this device" });
  await assertEventually(async () => addButton.isEnabled(), "Add this device should become available with a platform authenticator");
  await addButton.click();
  await page.getByText("Device passkey added.", { exact: false }).waitFor({ state: "visible", timeout: 30_000 });

  const stored = JSON.parse(await readFile(passkeyStorePath, "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.passkeys.length, 1);
  assert.equal(stored.passkeys[0].rpId, "localhost");
  assert.match(stored.passkeys[0].id, /^[A-Za-z0-9_-]+$/);
  assert.match(stored.passkeys[0].publicKey, /^[A-Za-z0-9_-]+$/);
  assert.equal("privateKey" in stored.passkeys[0], false, "server store must contain only the public credential material");
  if (process.platform !== "win32") assert.equal((await stat(passkeyStorePath)).mode & 0o777, 0o600);

  await page.getByRole("button", { name: "Lock now" }).click();
  await page.getByRole("heading", { name: "Dashboard locked" }).waitFor({ state: "visible", timeout: 30_000 });
  const biometricUnlock = page.getByRole("button", { name: /Unlock with (device biometrics|Face ID or Touch ID|Windows Hello)/ });
  await biometricUnlock.waitFor({ state: "visible", timeout: 30_000 });
  await biometricUnlock.click();
  await page.locator('button[aria-label="Dashboard security"]:visible').waitFor({ state: "visible", timeout: 180_000 });

  const afterUse = JSON.parse(await readFile(passkeyStorePath, "utf8"));
  assert.equal(typeof afterUse.passkeys[0].lastUsedAt, "string", "successful biometric unlock should record last use");

  await page.locator('button[aria-label="Dashboard security"]:visible').click();
  await page.getByRole("dialog", { name: "Face ID, Touch ID & passkeys" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Confirm remove" }).click();
  await page.getByText("No device passkeys yet", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Lock now" }).click();
  await page.getByRole("heading", { name: "Dashboard locked" }).waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(750);
  assert.equal(await page.getByRole("button", { name: /Unlock with/ }).count(), 0, "removed passkey should fall back to token-only unlock");
  assert.equal(await page.locator('input[name="token"]').count(), 1, "device token fallback should remain available");

  assert.deepEqual(consoleErrors, [], `Browser console should stay clean:\n${consoleErrors.join("\n")}`);
  console.log("Dashboard passkey enrollment, biometric unlock, removal, and token fallback checks passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  await stopChild();
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

async function assertAnonymousPasskeyBoundary() {
  const status = await fetch(`${baseUrl}/api/auth/passkeys/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { ok: true, available: false, secureContext: true });

  const protectedRequests = [
    fetch(`${baseUrl}/api/auth/passkeys`),
    fetch(`${baseUrl}/api/auth/passkeys`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "invalid" }) }),
    fetch(`${baseUrl}/api/auth/passkeys/registration/options`, { method: "POST" }),
  ];
  for (const response of await Promise.all(protectedRequests)) {
    assert.equal(response.status, 401, "passkey enrollment and management must require an authenticated dashboard session");
  }

  const authenticationOptions = await fetch(`${baseUrl}/api/auth/passkeys/authentication/options`, { method: "POST" });
  assert.equal(authenticationOptions.status, 400, "locked authentication route should remain reachable and fail without a registered passkey");
}

async function assertNativeTouchIdOffer(browser) {
  const nativeContext = await browser.newContext({ viewport: { width: 900, height: 760 } });
  try {
    await nativeContext.addInitScript(() => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {
          invoke: async (command) => {
            if (command === "native_dashboard_biometric_status") {
              return { available: true, kind: "touch-id" };
            }
            throw new Error(`Unexpected native command: ${command}`);
          },
        },
      });
    });
    const nativePage = await nativeContext.newPage();
    await nativePage.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await nativePage.getByRole("heading", { name: "Dashboard locked" }).waitFor({ state: "visible", timeout: 180_000 });
    await nativePage.getByRole("button", { name: "Unlock with Touch ID" }).waitFor({ state: "visible", timeout: 30_000 });
    await nativePage.getByRole("button", { name: "Unlock with saved desktop token" }).waitFor({ state: "visible", timeout: 30_000 });
    await nativePage.getByText("or enter device token manually", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await nativePage.locator('input[name="token"]').count(), 1, "the native Touch ID offer must retain the token fallback");
  } finally {
    await nativeContext.close();
  }
}

async function assertNativeBiometricBridge() {
  const [nativeCargo, nativeBackend, tauriSource, unlockSource, securitySource] = await Promise.all([
    readFile(join(process.cwd(), "src-tauri", "biometric-native", "Cargo.toml"), "utf8"),
    readFile(join(process.cwd(), "src-tauri", "biometric-native", "src", "mac.rs"), "utf8"),
    readFile(join(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8"),
    readFile(join(process.cwd(), "src", "app", "DashboardPasskeyUnlock.tsx"), "utf8"),
    readFile(join(process.cwd(), "src", "features", "dashboard", "DashboardSecurityControl.tsx"), "utf8"),
  ]);
  assert.match(nativeCargo, /objc2-local-authentication/, "native bridge should use Apple's LocalAuthentication framework bindings");
  assert.match(nativeBackend, /LAPolicy::DeviceOwnerAuthenticationWithBiometrics/, "native unlock must require biometrics instead of silently accepting the device passcode");
  assert.match(nativeBackend, /recv_timeout\(AUTHENTICATION_TIMEOUT\)/, "native prompt should have a bounded wait");
  assert.match(tauriSource, /native_dashboard_biometric_unlock[\s\S]*?spawn_blocking[\s\S]*?hivemindos_biometric_native::authenticate/, "Tauri should keep biometric evaluation off the UI thread");
  assert.match(tauriSource, /std::env::var\(DASHBOARD_DEVICE_TOKEN_KEY\)/, "the native shell should accept the dev launcher's saved-token handoff");
  assert.match(tauriSource, /native_dashboard_biometric_status,[\s\S]*?native_dashboard_biometric_unlock,[\s\S]*?native_dashboard_unlock_token,/, "native status, biometric unlock, and token fallback commands should all be registered");
  assert.match(unlockSource, /invoke<string \| null>\("native_dashboard_biometric_unlock"\)/, "locked UI should call the gated native unlock command");
  assert.match(unlockSource, /Unlock with saved desktop token/, "the native saved-token action should be explicit");
  assert.match(unlockSource, /or enter device token manually/, "the manual token divider should stay distinct from the saved-token action");
  assert.match(securitySource, /native_dashboard_biometric_status/, "Security UI should describe native biometric availability accurately");
  assert.match(securitySource, /if \(nativeWindow\.__TAURI_INTERNALS__\)/, "native UI should require Tauri's internal runtime marker instead of a browser-visible API stub");
  assert.doesNotMatch(securitySource, /nativeWindow\.__TAURI__ \|\|/, "a browser-visible Tauri API stub must not switch the modal into native mode");
  assert.match(securitySource, /desktop biometric bridge is unavailable/i, "a failed native bridge should not be mislabeled as a browser-context limitation");
  assert.match(securitySource, /className=\{styles\.readyStatus\}/, "native biometric readiness should render as status instead of a disabled Add button");
  assert.doesNotMatch(securitySource, /disabled=\{[^}]*nativeBiometricName/, "native biometric readiness should not disable an apparent Add action");
  assert.match(securitySource, /already enabled for this Mac/, "native users should be told there is nothing to enroll in HivemindOS");
  assert.match(securitySource, /No browser passkeys registered/, "native Touch ID should remain distinct from optional browser passkeys");
}

async function assertEventually(check, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
}

async function assertFooterTooltipKeepsShelfExpanded(page, trigger, tooltipText) {
  const shelf = page.locator("nav.fr-shelf");
  await shelf.hover({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(450);
  await trigger.hover();
  const tooltip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: tooltipText });
  await tooltip.waitFor({ state: "visible", timeout: 10_000 });
  const tooltipBox = await tooltip.boundingBox();
  assert.ok(tooltipBox, `${tooltipText} tooltip should have a measurable surface`);
  await page.mouse.move(tooltipBox.x + tooltipBox.width - 2, tooltipBox.y + tooltipBox.height / 2);
  await page.waitForTimeout(450);
  const shelfBox = await shelf.boundingBox();
  assert.ok(shelfBox && shelfBox.width >= 230, `${tooltipText} tooltip should keep the navigation shelf expanded; received ${shelfBox?.width ?? 0}px`);
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Next dev exited early:\n${output}`);
    const response = await fetch(`${baseUrl}/api/auth/passkeys/status`).catch(() => null);
    if (response?.status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for passkey test server:\n${output}`);
}

async function stopChild() {
  if (child.exitCode != null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode == null && !child.signalCode) child.kill("SIGKILL");
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert(address && typeof address === "object");
  return address.port;
}
