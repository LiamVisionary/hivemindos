#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const extensionPath = resolve(import.meta.dirname, "../dist");
const userDataDir = await mkdtemp(join(tmpdir(), "hivemindos-cws-smoke-"));
const errors = [];
let context;

try {
  console.log("Launching isolated Chromium with the packaged extension…");
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const serviceWorker = context.serviceWorkers()[0]
    || await context.waitForEvent("serviceworker", { timeout: 15_000 });
  console.log("Extension service worker started.");
  const extensionId = new URL(serviceWorker.url()).hostname;
  assert.match(extensionId, /^[a-p]{32}$/);

  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.getByText("Browser Agent", { exact: true }).waitFor();
  await page.locator("#settings-panel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#dashboard-url").inputValue(), "http://127.0.0.1:5020");
  assert.equal(await page.locator("#activity-strip").isHidden(), true);
  assert.deepEqual(errors, []);
  console.log(`Chrome loaded HivemindOS Browser ${extensionId} with no page errors.`);
} finally {
  console.log("Closing isolated Chromium…");
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}
