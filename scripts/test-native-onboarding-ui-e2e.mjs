#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const projectRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const artifacts = join(projectRoot, ".outputs", "dogfood", "native-onboarding");
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const serverLog = [];
let child;
let browser;

await mkdir(artifacts, { recursive: true });

try {
  child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HIVEMINDOS_ONBOARDING_PREVIEW: "1",
      HIVEMINDOS_TAURI_BUILD: "0",
      HIVEMINDOS_TAURI_DEV: "0",
      HIVEMINDOS_DEV_WARM_ROUTES: "0",
      HIVEMINDOS_DEV_FS_CACHE: "0",
      HIVEMINDOS_COMPANY_AUTONOMY_DRIVER: "0",
      HIVEMINDOS_HIVE_COMPUTE_RESUME: "0",
      HIVEMINDOS_INBOX_TRIAGE: "0",
      HIVEMINDOS_MARKETPLACE_MONITOR: "0",
      HIVEMINDOS_RESEARCH_SYNC: "0",
      HIVEMINDOS_SOCIAL_QUEUE_ENGINE: "0",
      HIVEMINDOS_TELEGRAM_TIP_BOT_AUTOSTART: "0",
      HIVEMINDOS_X_COMMAND_DRIVER: "0",
      QUEEN_BEE_AUTONOMOUS_PICKUP: "0",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  child.stdout.on("data", collectLog);
  child.stderr.on("data", collectLog);
  await waitForServer(`${baseUrl}/onboarding-preview?platform=macos`);

  browser = await chromium.launch({ headless: process.env.HIVE_E2E_HEADED !== "1" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) browserErrors.push(`console: ${message.text()}`);
  });

  for (const fixture of [
    { platform: "macos", device: "Mac" },
    { platform: "windows", device: "PC" },
    { platform: "linux", device: "computer" },
  ]) {
    await page.goto(`${baseUrl}/onboarding-preview?platform=${fixture.platform}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Let’s make HivemindOS useful." }).waitFor({ timeout: 30_000 });
    const closeBox = await dialog.getByRole("button", { name: "Close setup" }).boundingBox();
    const stepRailBox = await dialog.locator("header span[aria-hidden='true']").last().boundingBox();
    assert(closeBox && stepRailBox, `${fixture.platform}: close button and step rail must be measurable`);
    const stepRailGap = closeBox.x - (stepRailBox.x + stepRailBox.width);
    assert.ok(stepRailGap >= 12, `${fixture.platform}: step rail must clear the close button by at least 12px (gap ${stepRailGap}px)`);
    assert.equal(await page.locator("body > *[inert]").count() > 0, true, `${fixture.platform}: background must be inert`);
    assert.doesNotMatch(await dialog.innerText(), /takes about a minute|runs entirely on your computer/i);
    await assertThreeActionLayout(dialog, {
      label: `${fixture.platform}: welcome actions`,
      primary: "See setup choices",
      secondary: "Not now — ask next time",
      tertiary: "Use without setup",
    });
    await page.screenshot({ path: join(artifacts, `${fixture.platform}-welcome.png`), fullPage: true });
    await dialog.getByRole("button", { name: "See setup choices" }).click();

    const localChoice = dialog.getByRole("radio", { name: new RegExp(`Only this ${fixture.device}`, "i") });
    const multiChoice = dialog.getByRole("radio", { name: /Connect my other computers/i });
    assert.equal(await localChoice.getAttribute("aria-checked"), "true", `${fixture.platform}: local-only must be default`);
    assert.equal(await multiChoice.getAttribute("aria-checked"), "false", `${fixture.platform}: networking must be opt-in`);
    assert.equal(await dialog.getByRole("switch", { name: /Install web research tools/i }).getAttribute("aria-checked"), "false");
    assert.equal(await dialog.getByRole("switch", { name: /Enable public Code Proof/i }).getAttribute("aria-checked"), "false");
    assert.match(await dialog.innerText(), /Ready to connect/i);
    assert.match(await dialog.innerText(), /Can add later/i);
    await assertTwoActionLayout(dialog, {
      label: `${fixture.platform}: setup actions`,
      primary: new RegExp(`Set up this ${fixture.device}`, "i"),
      secondary: "Back",
    });

    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => {
        const active = document.activeElement;
        const openDialog = document.querySelector('[role="dialog"]');
        return Boolean(active && openDialog?.contains(active));
      }), true, `${fixture.platform}: focus escaped the modal`);
    }

    await multiChoice.click();
    assert.equal(await multiChoice.getAttribute("aria-checked"), "true");
    assert.equal(await dialog.getByRole("switch", { name: /full system Tailscale/i }).getAttribute("aria-checked"), "false");
    await dialog.getByRole("switch", { name: /Install web research tools/i }).click();
    assert.equal(await dialog.getByRole("switch", { name: /Install web research tools/i }).getAttribute("aria-checked"), "true");
    await page.screenshot({ path: join(artifacts, `${fixture.platform}-choices.png`), fullPage: true });

    await dialog.getByRole("button", { name: new RegExp(`Set up this ${fixture.device}`, "i") }).click();
    const progress = dialog.getByRole("progressbar", { name: "Setup progress" });
    await progress.waitFor({ state: "visible" });
    assert(await dialog.getByRole("log").isVisible(), `${fixture.platform}: live setup log must be visible`);
    await assertTwoActionLayout(dialog, {
      label: `${fixture.platform}: running actions`,
      primary: "Working…",
      secondary: "Close — setup keeps running",
    });
    await dialog.getByRole("heading", { name: `This ${fixture.device} is ready.` }).waitFor({ timeout: 10_000 });
    await assertThreeActionLayout(dialog, {
      label: `${fixture.platform}: completion actions`,
      primary: "Try a first task",
      secondary: "Show me around",
      tertiary: "Go to dashboard",
    });
    await page.screenshot({ path: join(artifacts, `${fixture.platform}-ready.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/onboarding-preview?platform=windows`, { waitUntil: "domcontentloaded" });
  const mobileDialog = page.getByRole("dialog");
  await mobileDialog.getByRole("heading", { name: "Let’s make HivemindOS useful." }).waitFor();
  await assertStackedActionLayout(mobileDialog, {
    label: "390px: welcome actions",
    actions: ["See setup choices", "Use without setup", "Not now — ask next time"],
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `mobile onboarding must not overflow horizontally (delta ${overflow}px)`);
  await page.screenshot({ path: join(artifacts, "windows-mobile-390.png"), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseUrl}/onboarding-preview?platform=macos`, { waitUntil: "domcontentloaded" });
  const finalDialog = page.getByRole("dialog");
  await page.evaluate(() => {
    window.addEventListener("hivemindos:start-first-task", (event) => {
      window.__firstTaskPrompt = event.detail?.prompt || "";
    }, { once: true });
  });
  await finalDialog.getByRole("button", { name: "See setup choices" }).click();
  await finalDialog.getByRole("button", { name: "Set up this Mac" }).click();
  await finalDialog.getByRole("heading", { name: "This Mac is ready." }).waitFor({ timeout: 10_000 });
  await finalDialog.getByRole("button", { name: "Try a first task" }).click();
  assert.equal(await page.evaluate(() => window.__firstTaskPrompt), "What can you help me accomplish today?");
  await page.getByTestId("onboarding-handoff").getByText("chat", { exact: true }).waitFor();
  await page.getByRole("dialog").waitFor({ state: "detached" });

  await page.goto(`${baseUrl}/onboarding-preview?platform=windows&agents=none`, { waitUntil: "domcontentloaded" });
  const noAgentDialog = page.getByRole("dialog");
  await noAgentDialog.getByRole("heading", { name: "Let’s make HivemindOS useful." }).waitFor();
  await noAgentDialog.getByRole("button", { name: "See setup choices" }).click();
  await noAgentDialog.getByRole("button", { name: "Set up this PC" }).click();
  await noAgentDialog.getByRole("heading", { name: "This PC is ready." }).waitFor({ timeout: 10_000 });
  assert.match(await noAgentDialog.innerText(), /No AI helper was detected yet/i);
  await page.screenshot({ path: join(artifacts, "windows-no-agent-ready.png"), fullPage: true });
  await noAgentDialog.getByRole("button", { name: "Add your first agent" }).click();
  await page.getByTestId("onboarding-handoff").getByText("agent-setup", { exact: true }).waitFor();
  await page.getByRole("dialog").waitFor({ state: "detached" });

  assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join("\n")}`);
  console.log(JSON.stringify({
    ok: true,
    platforms: ["macos", "windows", "linux"],
    assertions: "defaults, consent, parity, focus trap, action geometry, progress semantics, completion, first task, no-agent setup handoff, responsive layout, console",
    screenshots: artifacts,
  }, null, 2));
} catch (error) {
  console.error(`\nIsolated onboarding server log (tail):\n${serverLog.slice(-80).join("\n")}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopChild();
}

function collectLog(chunk) {
  serverLog.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  if (serverLog.length > 400) serverLog.splice(0, serverLog.length - 400);
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

async function buttonBox(dialog, name, label) {
  const box = await dialog.getByRole("button", { name }).boundingBox();
  assert(box, `${label}: button must be measurable`);
  return box;
}

async function assertTwoActionLayout(dialog, { label, primary, secondary }) {
  const primaryBox = await buttonBox(dialog, primary, label);
  const secondaryBox = await buttonBox(dialog, secondary, label);
  assert.ok(Math.abs(primaryBox.y - secondaryBox.y) <= 1, `${label}: controls must share one row`);
  assert.ok(Math.abs(primaryBox.width - secondaryBox.width) <= 1, `${label}: controls must have equal widths`);
  assert.ok(Math.abs(primaryBox.height - secondaryBox.height) <= 1, `${label}: controls must have equal heights`);
}

async function assertThreeActionLayout(dialog, { label, primary, secondary, tertiary }) {
  const primaryBox = await buttonBox(dialog, primary, label);
  const secondaryBox = await buttonBox(dialog, secondary, label);
  const tertiaryBox = await buttonBox(dialog, tertiary, label);
  assert.ok(primaryBox.y + primaryBox.height < secondaryBox.y, `${label}: primary action must occupy the first row`);
  assert.ok(Math.abs(secondaryBox.y - tertiaryBox.y) <= 1, `${label}: supporting actions must share the second row`);
  assert.ok(Math.abs(secondaryBox.width - tertiaryBox.width) <= 1, `${label}: supporting actions must have equal widths`);
  assert.ok(Math.abs(primaryBox.x - Math.min(secondaryBox.x, tertiaryBox.x)) <= 1, `${label}: rows must align on the left`);
  assert.ok(Math.abs(primaryBox.x + primaryBox.width - Math.max(secondaryBox.x + secondaryBox.width, tertiaryBox.x + tertiaryBox.width)) <= 1, `${label}: rows must align on the right`);
}

async function assertStackedActionLayout(dialog, { label, actions }) {
  const boxes = await Promise.all(actions.map((action) => buttonBox(dialog, action, label)));
  for (let index = 1; index < boxes.length; index += 1) {
    assert.ok(boxes[index - 1].y + boxes[index - 1].height < boxes[index].y, `${label}: controls must follow one consistent vertical order`);
    assert.ok(Math.abs(boxes[0].x - boxes[index].x) <= 1, `${label}: controls must align on the left`);
    assert.ok(Math.abs(boxes[0].width - boxes[index].width) <= 1, `${label}: controls must have equal widths`);
  }
}

async function waitForServer(url, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Isolated Next server exited with ${child.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}
