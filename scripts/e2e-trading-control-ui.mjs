#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const temp = await mkdtemp(join(tmpdir(), "hivemindos-trading-e2e-"));
const token = "trading-e2e-device-token-000000000000000000000000000000000000000000000000";
const suppliedBaseUrl = process.env.HIVE_E2E_BASE_URL?.replace(/\/+$/, "");
let child = null;
let baseUrl = suppliedBaseUrl;
const serverLog = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function collectLog(chunk) {
  const lines = String(chunk).split(/\r?\n/).filter(Boolean);
  serverLog.push(...lines);
  if (serverLog.length > 120) serverLog.splice(0, serverLog.length - 120);
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Isolated Next server exited with ${child.exitCode}.\n${serverLog.join("\n")}`);
    try {
      const response = await fetch(`${url}/api/trading/control`, { headers: { "x-hivemindos-device-token": token }, signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch {
      // The child is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Isolated Next server did not become ready.\n${serverLog.join("\n")}`);
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { accept: "application/json", "content-type": "application/json", "x-hivemindos-device-token": token, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

try {
  if (!baseUrl) {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ["scripts/dev-server.mjs", "--port", String(port)], {
      cwd: projectRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: token,
        HIVEMINDOS_TRADING_CONTROL_PATH: join(temp, "trading-control.json"),
        HIVEMINDOS_DEV_WARM_ROUTES: "0",
        HIVEMINDOS_DEV_FS_CACHE: "0",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });
    child.stdout.on("data", collectLog);
    child.stderr.on("data", collectLog);
    await waitForServer(baseUrl);
  }

  const unauthorized = await fetch(`${baseUrl}/api/trading/control`, { headers: { accept: "application/json" } });
  assert.equal(unauthorized.status, 401, "the real control route must reject unauthenticated reads");

  let result = await api("/api/trading/control");
  assert.equal(result.response.status, 200);
  assert.equal(result.body?.overview?.config?.executionMode, "paper");
  assert.ok(Array.isArray(result.body?.brokerPacks));

  result = await api("/api/trading/control", {
    method: "POST",
    body: JSON.stringify({ action: "config.update", config: { executionMode: "paper", snapshotCadenceMinutes: 15 } }),
  });
  assert.equal(result.response.status, 200);

  result = await api("/api/trading/control", {
    method: "POST",
    body: JSON.stringify({
      action: "plan.create",
      title: "E2E paper AAPL plan",
      proposal: {
        accountId: "e2e:paper",
        agentId: "e2e-agent",
        assetClass: "stock",
        asset: "AAPL",
        side: "buy",
        orderType: "limit",
        timeInForce: "day",
        quantity: 1,
        notionalUsd: 100,
        estimatedPrice: 100,
        limitPrice: 100,
        venue: "e2e-fixture",
        quote: { capturedAt: new Date().toISOString(), source: "e2e-fixture", slippageBps: 10, liquidityUsd: 1_000_000, feeUsd: 0 },
        portfolio: { totalValueUsd: 1_000, currentAssetValueUsd: 0, dailyPnlPct: 0, drawdownPct: 0 },
      },
      thesis: "Verify the authenticated server and browser lifecycle without moving funds.",
      evidence: ["isolated e2e fixture"],
    }),
  });
  assert.equal(result.response.status, 201);
  const planId = result.body?.plan?.id;
  assert.ok(planId);

  result = await api("/api/trading/control", { method: "POST", body: JSON.stringify({ action: "plan.approve", id: planId }) });
  assert.equal(result.body?.plan?.status, "approved");
  result = await api("/api/trading/control", { method: "POST", body: JSON.stringify({ action: "plan.simulate", id: planId }) });
  assert.equal(result.body?.plan?.status, "filled");
  assert.equal(result.body?.plan?.execution?.kind, "simulation");

  const browser = await chromium.launch({ headless: process.env.HIVE_E2E_HEADED !== "1" });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { "x-hivemindos-device-token": token }, reducedMotion: "reduce" });
    const session = await context.request.post(`${baseUrl}/api/auth/session`, { data: { token }, headers: { accept: "application/json" } });
    assert.ok(session.ok(), `browser session setup failed with HTTP ${session.status()}`);

    const page = await context.newPage();
    const pageErrors = [];
    const controlFailures = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname === "/api/trading/control" && response.status() >= 400) controlFailures.push(`${response.status()} ${response.request().method()}`);
    });

    await page.goto(`${baseUrl}/?view=trade`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const nav = page.getByRole("navigation", { name: "Trading workspace" });
    await nav.waitFor({ state: "visible", timeout: 90_000 });
    const tradeRoot = nav.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' fr-root ')][1]");
    for (const label of ["Trade", "Research", "Portfolio", "Plans", "Activity", "Automations"]) {
      await nav.getByRole("button", { name: new RegExp(`^${label}`) }).waitFor({ state: "visible" });
    }

    await nav.getByRole("button", { name: /^Plans/ }).click();
    await page.getByRole("heading", { name: "Trade Plans" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "filled", exact: true }).click();
    await page.getByText("E2E paper AAPL plan", { exact: true }).waitFor({ state: "visible" });
    await page.getByText(/Paper fill:/).first().waitFor({ state: "visible" });

    await nav.getByRole("button", { name: "Research" }).click();
    await page.getByRole("heading", { name: "Research before you route" }).waitFor({ state: "visible" });
    await nav.getByRole("button", { name: "Portfolio" }).click();
    await page.getByRole("heading", { name: "Every account, one accountable history" }).waitFor({ state: "visible" });
    await nav.getByRole("button", { name: "Activity" }).click();
    await page.getByRole("heading", { name: "Activity" }).waitFor({ state: "visible" });
    await nav.getByRole("button", { name: "Automations" }).click();
    await page.getByRole("heading", { name: "Automations & controls" }).waitFor({ state: "visible" });
    const advancedRisk = page.getByText("Advanced risk policy", { exact: true });
    await advancedRisk.click();
    await page.getByText("Require known portfolio exposure in live mode", { exact: true }).waitFor({ state: "visible" });

    await page.getByRole("radio", { name: "Research" }).click();
    await page.waitForFunction(async () => {
      const response = await fetch("/api/trading/control", { headers: { accept: "application/json" } });
      const body = await response.json();
      return body?.overview?.config?.executionMode === "research";
    });

    const darkBackground = await tradeRoot.evaluate((element) => getComputedStyle(element).getPropertyValue("--bg"));
    await tradeRoot.evaluate((element) => element.setAttribute("data-fr-theme", "light"));
    const lightBackground = await tradeRoot.evaluate((element) => getComputedStyle(element).getPropertyValue("--bg"));
    assert.notEqual(lightBackground.trim(), darkBackground.trim(), "light and dark trading tokens should resolve differently");

    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(50);
      const overflow = await tradeRoot.evaluate((element) => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, root: element.scrollWidth - element.clientWidth }));
      assert.ok(overflow.document <= 1, `document overflowed by ${overflow.document}px at ${width}px`);
      assert.ok((overflow.root ?? 0) <= 1, `Trade root overflowed by ${overflow.root}px at ${width}px`);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "/tmp/hivemindos-trading-control-desktop.png" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: "/tmp/hivemindos-trading-control-mobile.png" });
    assert.deepEqual(controlFailures, [], `control API failures in browser: ${controlFailures.join(", ")}`);
    assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join(" | ")}`);
  } finally {
    await browser.close();
  }

  result = await api("/api/trading/control");
  assert.equal(result.body?.overview?.config?.executionMode, "research");
  assert.ok(result.body?.overview?.snapshots?.some((snapshot) => snapshot.reason === "event"));
  assert.ok(result.body?.overview?.events?.some((event) => event.kind === "plan.simulated"));
  console.log("Trading control real API + responsive browser E2E passed. Screenshots: /tmp/hivemindos-trading-control-desktop.png, /tmp/hivemindos-trading-control-mobile.png");
} finally {
  await stopChild();
  await rm(temp, { recursive: true, force: true });
}
