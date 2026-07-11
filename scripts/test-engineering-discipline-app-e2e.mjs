#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const baseUrl = (process.env.ENGINEERING_DISCIPLINE_E2E_URL || "http://127.0.0.1:5021").replace(/\/+$/, "");
const outputDir = join(root, ".outputs", "dogfood", "engineering-discipline");

async function envValue(filePath, key) {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

const dashboardToken = process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || await envValue(join(root, ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  || await envValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN");

assert(dashboardToken, "Dashboard token is required for the authenticated app E2E.");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const session = await context.request.post(`${baseUrl}/api/auth/session`, {
    data: { token: dashboardToken },
    headers: {
      Accept: "application/json",
      "x-hivemindos-device-token": dashboardToken,
    },
  });
  assert.equal(session.status(), 200, "authenticated dashboard session should be created");

  const packsResponse = await context.request.get(`${baseUrl}/api/skills/packs`);
  assert.equal(packsResponse.status(), 200, "authenticated pack catalog should load");
  const packsBody = await packsResponse.json();
  const engineeringPack = packsBody.packs?.find((pack) => pack.id === "hivemind-engineering-discipline");
  assert(engineeringPack, "Engineering Discipline should be present in the live pack API");
  assert.equal(engineeringPack.skills.length, 13, "live pack API should expose the orchestrator plus 12 donor methods");

  const page = await context.newPage();
  const consoleErrors = [];
  const authFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/") && [401, 403].includes(response.status())) {
      authFailures.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.goto(`${baseUrl}/?view=vault`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Dashboard locked"), null, { timeout: 30_000 });
  await page.getByRole("tab", { name: "Shared Skills", exact: true }).click();
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  const skillDialog = page.getByRole("dialog", { name: "Skill browser" });
  await skillDialog.waitFor({ state: "visible", timeout: 30_000 });
  await skillDialog.getByRole("tab", { name: "Packs", exact: true }).click();
  const packCard = skillDialog.locator(".sb-pack").filter({ hasText: "HivemindOS Engineering Discipline" });
  await packCard.waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await packCard.count(), 1, "Skill Browser should render one Engineering Discipline pack card");
  assert((await packCard.innerText()).includes("13"), "pack card should report all 13 included skills");
  assert(await packCard.getByRole("button", { name: /Install|Installed/ }).isVisible(), "pack card should expose its install state");
  await packCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outputDir, "skill-pack.png"), fullPage: false });
  await skillDialog.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto(`${baseUrl}/?view=kanban`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Dashboard locked"), null, { timeout: 30_000 });
  await page.getByRole("button", { name: "Add task to Ideas", exact: true }).click();
  await page.getByRole("button", { name: "Add attachment", exact: true }).click();
  await page.getByRole("menuitem", { name: "Template", exact: true }).click();
  const templateDialog = page.getByRole("dialog", { name: "Attach template to task" });
  await templateDialog.waitFor({ state: "visible", timeout: 20_000 });
  await templateDialog.getByLabel("Search templates", { exact: true }).fill("Engineering discipline");
  const engineeringTemplate = templateDialog.locator("button").filter({ hasText: "Engineering discipline" });
  await engineeringTemplate.waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(await engineeringTemplate.count(), 1, "template picker should show one Engineering Discipline template");
  await page.screenshot({ path: join(outputDir, "work-board-template.png"), fullPage: false });
  await engineeringTemplate.click();
  await page.getByLabel("Task draft template and skills").waitFor({ state: "visible", timeout: 10_000 });
  const selectedDraft = await page.getByLabel("Task draft template and skills").innerText();
  assert(selectedDraft.includes("Engineering discipline"), "quick-add draft should retain the selected template");
  assert(selectedDraft.includes("engineering-discipline"), "quick-add draft should attach the canonical orchestrator skill");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  assert.deepEqual(authFailures, [], `dashboard E2E should not produce auth failures: ${authFailures.join(", ")}`);
  assert.deepEqual(consoleErrors, [], `dashboard E2E should not produce console errors: ${consoleErrors.join(" | ")}`);
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    packSkills: engineeringPack.skills.length,
    screenshots: [join(outputDir, "skill-pack.png"), join(outputDir, "work-board-template.png")],
  }, null, 2));
} finally {
  await browser.close();
}
