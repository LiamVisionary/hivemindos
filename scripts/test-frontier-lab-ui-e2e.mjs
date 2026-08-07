#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const authSecret = "f".repeat(64);
const deviceToken = "d".repeat(64);
const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-frontier-ui-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemindos-frontier-ui-vault-"));
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const desktopScreenshot = "/tmp/hivemindos-frontier-lab-desktop.png";
const mobileScreenshot = "/tmp/hivemindos-frontier-lab-mobile.png";
const hiveEnvFile = join(tempHome, ".hivemindos", ".env");
await mkdir(join(tempHome, ".hivemindos"), { recursive: true });
await writeFile(hiveEnvFile, "OPENAI_OAUTH_REFRESH_TOKEN=frontier-ui-fixture-refresh\n", { mode: 0o600 });
const child = spawn("pnpm", ["exec", "next", "dev", "--webpack", "--disable-source-maps", "-p", String(port), "-H", "127.0.0.1"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: tempHome,
    NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: vaultPath,
    HIVEMINDOS_DASHBOARD_AUTH_SECRET: authSecret,
    HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: deviceToken,
    HIVEMINDOS_TAURI_BUILD: "1",
    HIVEMINDOS_COMPANY_AUTONOMY_DRIVER: "0",
    QUEEN_BEE_AUTONOMOUS_PICKUP: "0",
    HIVEMINDOS_HIVE_COMPUTE_RESUME: "0",
    HIVEMINDOS_INBOX_TRIAGE: "0",
    HIVEMINDOS_RESEARCH_SYNC: "0",
    HIVEMINDOS_TELEGRAM_TIP_BOT_AUTOSTART: "0",
    HIVEMINDOS_MARKETPLACE_MONITOR: "0",
    HIVEMINDOS_SOCIAL_QUEUE_ENGINE: "0",
    OPENAI_OAUTH_ACCESS_TOKEN: "",
    OPENAI_OAUTH_REFRESH_TOKEN: "",
    OPENAI_OAUTH_ACCOUNT_ID: "",
    OPENAI_OAUTH_EXPIRES_AT: "",
    HIVE_ENV_FILE: hiveEnvFile,
    NEXT_TELEMETRY_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
let browser;

try {
  await waitForServer();
  const unauthenticated = await fetch(`${baseUrl}/api/companies/not-a-company/frontier-lab`);
  assert.equal(unauthenticated.status, 401, "the Frontier Lab company surface must reject unauthenticated reads");
  const session = await fetch(`${baseUrl}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: deviceToken }),
  });
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(cookie, /^hivemindos_session=/);

  const legalBundle = JSON.parse(await readFile(join(process.cwd(), "legal", "hivemindos-policies.json"), "utf8"));
  const accepted = await fetch(`${baseUrl}/api/dashboard/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      values: {
        "hivemindos.terms.acceptance.v1": JSON.stringify({ version: legalBundle.terms.version, acceptedAt: new Date().toISOString() }),
      },
    }),
  });
  assert.equal(accepted.status, 200, await accepted.text());

  const created = await fetch(`${baseUrl}/api/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      name: "Frontier Visual Lab",
      ticker: "FRNT",
      sector: "AI Research",
      blurb: "A governed one-person frontier lab test company.",
      charter: "Ship high-quality research and software under explicit budgets and independent review.",
      agentIds: ["frontier-builder-fixture", "frontier-reviewer-fixture"],
      apexGoal: { title: "Ship one verified frontier experiment", metric: "verified experiments", target: "1", current: "0", progress: 0, unit: "number" },
    }),
  });
  const createdPayload = await created.json();
  assert.equal(created.status, 200, JSON.stringify(createdPayload));
  const createdCompanyId = createdPayload?.company?.id;
  assert.equal(typeof createdCompanyId, "string");

  const frontierStateResponse = await fetch(`${baseUrl}/api/companies/${createdCompanyId}/frontier-lab`, { headers: { Cookie: cookie } });
  const frontierState = await frontierStateResponse.json();
  assert.equal(frontierStateResponse.status, 200, JSON.stringify(frontierState));
  const soloStaff = await fetch(`${baseUrl}/api/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action: "set-agents", id: createdCompanyId, agentIds: [] }),
  });
  assert.equal(soloStaff.status, 200, await soloStaff.text());
  const rejectedEnable = await fetch(`${baseUrl}/api/companies/${createdCompanyId}/frontier-lab`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ ...frontierState.policy, enabled: true }),
  });
  assert.equal(rejectedEnable.status, 409);
  assert.match(await rejectedEnable.text(), /two distinct company agent identities/i);
  const restoredStaff = await fetch(`${baseUrl}/api/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action: "set-agents", id: createdCompanyId, agentIds: ["frontier-builder-fixture", "frontier-reviewer-fixture"] }),
  });
  assert.equal(restoredStaff.status, 200, await restoredStaff.text());

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const [cookieName, cookieValue] = cookie.split("=");
  await context.addCookies([{ name: cookieName, value: cookieValue, url: baseUrl }]);
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto(`${baseUrl}/?view=governance`, { waitUntil: "domcontentloaded" });
  const welcomeDismiss = page.getByRole("button", { name: "Maybe later" });
  await welcomeDismiss.waitFor({ timeout: 15_000 }).then(() => welcomeDismiss.click()).catch(() => undefined);
  await page.getByText("Frontier Visual Lab", { exact: true }).first().waitFor({ timeout: 60_000 });
  const companyNavigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  await page.getByText("Frontier Visual Lab", { exact: true }).first().click();
  await companyNavigation;
  await dismissWelcome(page);
  const frontierTab = page.getByRole("button", { name: "Frontier Lab", exact: true });
  await frontierTab.waitFor({ timeout: 60_000 });
  await frontierTab.click();
  await page.getByRole("heading", { name: "Frontier Lab", exact: true }).waitFor({ timeout: 60_000 });
  // The governance shell may fall back from an RSC transition during the
  // isolated dev server's first compile. Audit the Frontier surface from its
  // own mounted boundary onward, including save, refresh, and responsive work.
  browserErrors.length = 0;

  await assertFrontierSurface(page);
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Save Frontier Lab" }).click();
  await page.getByText("Frontier Lab policy saved and enforced on new company work.", { exact: true }).waitFor();
  await page.getByRole("switch").getByText("Enabled", { exact: true }).waitFor();
  const savedPolicy = await page.evaluate(async (companyId) => {
    const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/frontier-lab`, { cache: "no-store" });
    const payload = await response.json();
    return payload?.policy;
  }, createdCompanyId);
  assert.equal(savedPolicy?.enabled, true, "the browser save path must persist the normalized policy through the authenticated API");
  assert.equal(savedPolicy?.provider, "openai-oauth");
  assert.deepEqual(savedPolicy?.models, { scout: "gpt-5.6-luna", builder: "gpt-5.6-terra", reviewer: "gpt-5.6-sol" });
  await dismissWelcome(page);
  const frontierRoot = page.getByRole("heading", { name: "Frontier Lab", exact: true }).locator("xpath=ancestor::section[1]/parent::div");
  await frontierRoot.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: desktopScreenshot, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "desktop layout must not overflow horizontally");

  await page.setViewportSize({ width: 390, height: 844 });
  await frontierRoot.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: mobileScreenshot });
  const frontierBox = await frontierRoot.boundingBox();
  assert(
    frontierBox && frontierBox.x >= 0 && frontierBox.x + frontierBox.width <= 391,
    `Frontier Lab panel must fit the mobile viewport: ${JSON.stringify(frontierBox)}`,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "mobile layout must not overflow horizontally");
  assert.deepEqual(browserErrors, [], `browser console/page errors:\n${browserErrors.join("\n")}`);
  await context.close();
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  await browser?.close();
  await terminateChild(child);
  await rm(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(vaultPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log(`Frontier Lab desktop/mobile UI end-to-end test passed (${desktopScreenshot}, ${mobileScreenshot})`);

async function assertFrontierSurface(page) {
  await page.getByText("OpenAI OAuth connected", { exact: true }).waitFor();
  await page.getByText("independent reviewer staffed", { exact: true }).waitFor();
  await page.getByText("No OpenRouter fallback", { exact: true }).waitFor();
  await page.getByText("gpt-5.6-luna", { exact: true }).waitFor();
  await page.getByText("gpt-5.6-terra", { exact: true }).waitFor();
  await page.getByText("gpt-5.6-sol", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^Pilot 4 parallel/ }).waitFor();
  await page.getByRole("button", { name: /^Team 12 parallel/ }).waitFor();
  await page.getByRole("button", { name: /^Frontier 24 parallel/ }).waitFor();
  await page.getByRole("button", { name: /Save Frontier Lab/ }).waitFor();
}

async function dismissWelcome(page) {
  const dismiss = page.getByRole("button", { name: "Maybe later" });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  await dismiss.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next dev server exited early (${child.exitCode}).`);
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // Dev server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the isolated Frontier Lab UI server.");
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

async function terminateChild(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode) return;
  processHandle.kill("SIGTERM");
  if (await waitForExit(processHandle, 3_000)) return;
  processHandle.kill("SIGKILL");
  await waitForExit(processHandle, 3_000);
}

function waitForExit(processHandle, timeoutMs) {
  if (processHandle.exitCode !== null || processHandle.signalCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      processHandle.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    processHandle.once("exit", onExit);
  });
}
