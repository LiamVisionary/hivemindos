#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

const baseUrl = (process.env.HIVE_E2E_BASE_URL || process.env.DASHBOARD_URL || "http://127.0.0.1:5021").replace(/\/+$/, "");
const screenshotPath = process.env.HIVE_E2E_SCREENSHOT || "/tmp/hivemindos-socials-queue-e2e.png";
const generateDrafts = process.env.HIVE_E2E_GENERATE_DRAFTS === "1";
const generateEngagement = process.env.HIVE_E2E_GENERATE_ENGAGEMENT === "1";
const contextlessHandle = (process.env.HIVE_E2E_CONTEXTLESS_HANDLE || "").trim().replace(/^@/, "");

async function readEnvValue(filePath, key) {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

const dashboardDeviceToken = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || await readEnvValue(new URL("../.env.local", import.meta.url), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  || await readEnvValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN");

assert.ok(dashboardDeviceToken, "No dashboard device token is available for the authenticated UI smoke test.");

const browser = await chromium.launch({ headless: process.env.HIVE_E2E_HEADED !== "1" });
try {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-hivemindos-device-token": dashboardDeviceToken },
    viewport: { width: 1440, height: 1000 },
  });
  let session;
  try {
    session = await context.request.post(`${baseUrl}/api/auth/session`, {
      data: { token: dashboardDeviceToken },
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error(`Dashboard session setup could not connect to ${baseUrl}. Request headers were redacted.`);
  }
  assert.ok(session.ok(), `Dashboard session setup failed with HTTP ${session.status()}.`);

  const page = await context.newPage();
  const apiFailures = [];
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/socials/") && response.status() >= 400) {
      apiFailures.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.goto(`${baseUrl}/?view=socials`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("Socials", { exact: true }).first().waitFor({ state: "visible", timeout: 60_000 });

  const workspace = page.getByTestId("social-queue-workspace");
  await workspace.waitFor({ state: "visible", timeout: 60_000 });
  await page.getByTestId("social-queue-composer").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Process queue" }).waitFor({ state: "visible" });
  await page.getByTestId("social-drafting-automation").waitFor({ state: "visible" });
  const allAccounts = page.locator(".sc-account-chip").filter({ hasText: "All accounts" });
  await allAccounts.click();
  assert.equal(await allAccounts.getAttribute("data-active"), "true", "All accounts must load the aggregate review queue.");
  await page.getByTestId("social-queue-workspace").waitFor({ state: "visible" });
  const xAccount = page.locator(".sc-acct").filter({ hasText: "@TheHivemindOS" });
  if (await xAccount.count()) {
    await xAccount.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".sc-settings-route > nav").getByRole("button", { name: /^Connection/ }).click();
    await page.getByTestId("social-x-session").waitFor({ state: "visible" });
    await page.getByText("Agent Reach X session", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /^Review/ }).click();
    await page.getByTestId("social-engagement-discovery").waitFor({ state: "visible" });
  }
  if (contextlessHandle) {
    const contextlessAccount = page.locator(".sc-acct").filter({ hasText: `@${contextlessHandle}` });
    assert.equal(await contextlessAccount.count(), 1, `Expected one @${contextlessHandle} account in the Socials rail.`);
    await contextlessAccount.click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".sc-settings-route > nav").getByRole("button", { name: /^Connection/ }).click();
    await page.getByTestId("social-x-session").waitFor({ state: "visible" });
    await page.locator(".sc-settings-route > nav").getByRole("button", { name: /^Automation/ }).click();
    const drafting = page.getByTestId("social-drafting-automation");
    await drafting.getByText("Waiting for account-specific context", { exact: true }).waitFor({ state: "visible" });
    await drafting.getByText(/Add context first/).waitFor({ state: "visible" });
    assert.equal(
      await drafting.getByRole("button", { name: "Generate full pack" }).isDisabled(),
      true,
      "Standalone generation must stay disabled until account-specific context is configured.",
    );
    assert.equal(
      await drafting.locator(".sc-error").count(),
      0,
      "A stale drafting failure must not obscure the missing-context setup state.",
    );
    await page.getByRole("button", { name: /^Review/ }).click();
  }
  const engineStatus = (await page.getByTestId("social-queue-engine-status").innerText()).trim();
  assert.match(engineStatus, /Worker (live|waiting|paused)/, `Unexpected engine status: ${engineStatus}`);

  if (generateDrafts) {
    await page.getByRole("button", { name: "Generate full pack" }).click();
    await page.getByText(/Agent (post|reply|quote) draft ·/).first().waitFor({ state: "visible", timeout: 180_000 });
  }

  if (generateEngagement) {
    assert.ok(await xAccount.count(), "The live engagement smoke needs an @TheHivemindOS X account.");
    const findButton = page.getByRole("button", { name: "Find replies now" });
    await page.getByText(/Authenticated X discovery as @TheHivemindOS/).waitFor({ state: "visible", timeout: 60_000 });
    assert.equal(await findButton.isEnabled(), true, "Local X discovery must be authenticated before the live smoke runs.");
    await findButton.click();
    await page.getByTestId("social-engagement-target").first().waitFor({ state: "visible", timeout: 180_000 });
    await page.getByRole("link", { name: /Open target/ }).first().waitFor({ state: "visible" });
  }

  const scheduledTab = page.getByRole("button", { name: /^Scheduled/ });
  await scheduledTab.click();
  assert.equal(await scheduledTab.getAttribute("aria-current"), "page");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.locator(".sc-schedule-list").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await page.locator(".sc-week-grid").waitFor({ state: "visible" });
  const analyticsTab = page.getByRole("button", { name: "Analytics", exact: true });
  await analyticsTab.click();
  assert.equal(await analyticsTab.getAttribute("aria-current"), "page");
  await page.getByRole("button", { name: "Refresh analytics" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Posting voice", { exact: true }).waitFor({ state: "visible" });
  await page.locator(".sc-settings-route > nav").getByRole("button", { name: /^Schedule & mode/ }).click();
  await page.getByText("Posting mode", { exact: true }).waitFor({ state: "visible" });
  await page.locator(".sc-settings-route > nav").getByRole("button", { name: /^Automation/ }).click();
  await page.getByTestId("social-drafting-automation").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  await page.locator('[aria-label="Connect account step 1 of 3"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('[aria-label="Connect account step 2 of 3"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('[aria-label="Connect account step 3 of 3"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: /^Review/ }).click();

  const firstTarget = page.getByTestId("social-engagement-target").first();
  if (await firstTarget.count()) await firstTarget.scrollIntoViewIfNeeded();

  await page.waitForTimeout(400);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(apiFailures, [], `Socials API failures: ${apiFailures.join(", ")}`);
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join(" | ")}`);
  console.log(`Socials queue UI smoke passed (${engineStatus}); screenshot: ${screenshotPath}`);
} finally {
  await browser.close();
}
