#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

import { chromium } from "playwright";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const artifactRoot = join(projectRoot, ".hivemindos-dogfood", "socials-route-redesign");
const screenshotRoot = join(artifactRoot, "screenshots");
const tempRoot = await mkdtemp(join(tmpdir(), "hivemindos-socials-redesign-e2e-"));
const tempHome = join(tempRoot, "home");
const tempVault = join(tempRoot, "vault");
const hiveEnvFile = join(tempHome, ".hivemindos", ".env");
const deviceToken = "socials-e2e-device-token-000000000000000000000000000000000000000000000000";
const authSecret = "a".repeat(64);
const serverLog = [];
const observedDefects = [];
let child = null;
let browser = null;

await mkdir(screenshotRoot, { recursive: true });
await mkdir(join(tempHome, ".hivemindos"), { recursive: true });
await mkdir(join(tempVault, "Skills", "e2e-social"), { recursive: true });
await writeFile(hiveEnvFile, "# Intentionally empty: provider credentials are unavailable in this E2E fixture.\n", { mode: 0o600 });
await writeFile(join(tempVault, "Skills", "e2e-social", "SOUL.md"), "# E2E Social Voice\n\nWrite with direct, concrete language.\n");

const isolatedEnv = {
  ...process.env,
  HOME: tempHome,
  NEXT_PUBLIC_OBSIDIAN_VAULT_PATH: tempVault,
  HIVE_ENV_FILE: hiveEnvFile,
  HIVEMINDOS_DASHBOARD_AUTH_SECRET: authSecret,
  HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: deviceToken,
  HIVEMINDOS_TAURI_BUILD: "0",
  HIVEMINDOS_TAURI_DEV: "1",
  HIVEMINDOS_TAURI_NEXT_DIST_DIR: ".next-tauri/verify-socials-redesign-e2e",
  HIVEMINDOS_DEV_WARM_ROUTES: "0",
  HIVEMINDOS_DEV_FS_CACHE: "0",
  HIVEMINDOS_COMPANY_AUTONOMY_DRIVER: "0",
  QUEEN_BEE_AUTONOMOUS_PICKUP: "0",
  HIVEMINDOS_HIVE_COMPUTE_RESUME: "0",
  HIVEMINDOS_INBOX_TRIAGE: "0",
  HIVEMINDOS_RESEARCH_SYNC: "0",
  HIVEMINDOS_TELEGRAM_TIP_BOT_AUTOSTART: "0",
  HIVEMINDOS_MARKETPLACE_MONITOR: "0",
  HIVEMINDOS_SOCIAL_QUEUE_ENGINE: "1",
  HIVEMINDOS_SOCIAL_QUEUE_TICK_MS: "60000",
  HIVEMINDOS_SOCIAL_QUEUE_DRIVER_LEASE_FILE: join(tempRoot, "socials-driver-lease.json"),
  HIVEMINDOS_X_API_GATEWAY_BASE_URL: "not-a-url",
  NEXT_TELEMETRY_DISABLED: "1",
  OPENAI_API_KEY: "",
  OPENAI_OAUTH_ACCESS_TOKEN: "",
  OPENAI_OAUTH_REFRESH_TOKEN: "",
  OPENAI_OAUTH_ACCOUNT_ID: "",
  OPENAI_OAUTH_EXPIRES_AT: "",
  ANTHROPIC_API_KEY: "",
  GOOGLE_GENERATIVE_AI_API_KEY: "",
  GEMINI_API_KEY: "",
  X_API_BEARER_TOKEN: "",
  X_API_KEY: "",
  X_API_SECRET: "",
  X_ACCESS_TOKEN: "",
  X_ACCESS_TOKEN_SECRET: "",
  REDDIT_CLIENT_ID: "",
  REDDIT_CLIENT_SECRET: "",
  REDDIT_REFRESH_TOKEN: "",
  TELEGRAM_BOT_TOKEN: "",
};

Object.assign(process.env, isolatedEnv);
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const store = await import("../src/lib/services/socials/socials-store.ts");
const service = await import("../src/lib/services/socials/social-queue-service.ts");

const now = new Date();
const isoOffset = (minutes) => new Date(now.getTime() + minutes * 60_000).toISOString();
const xAccount = await store.connectSocialAccount({
  platform: "x",
  handle: "e2e-social",
  displayName: "E2E Social",
  method: "api-token",
});
const redditAccount = await store.connectSocialAccount({
  platform: "reddit",
  handle: "e2e-reddit",
  displayName: "E2E Reddit",
  method: "api-token",
  binding: { defaultSubreddit: "hivemindos" },
});
const managedAccount = await store.connectSocialAccount({
  platform: "x",
  handle: "e2e-managed",
  displayName: "E2E Managed",
  method: "managed-oauth",
  binding: { connectionSlug: "e2e-managed-connection", creditAccountId: "credits:e2e", creditSlug: "e2e" },
});

const targetBase = {
  platform: "x",
  url: "https://x.com/hivemindos/status/2000000000000000001",
  authorHandle: "hivemindos",
  authorName: "HivemindOS",
  text: "Local-first agents need explicit approval boundaries and durable receipts.",
  createdAt: isoOffset(-120),
  discoveredAt: isoOffset(-90),
  source: "search",
  sourceQuery: "local-first agents",
  metrics: { likes: 84, reposts: 12, replies: 9, quotes: 3, views: 4200 },
};
const generated = await service.enqueueGeneratedSocialDrafts({
  accountId: xAccount.id,
  model: "e2e-fixture-model",
  contextSourceIds: ["src-e2e-seed"],
  now: new Date(now.getTime() - 10 * 60_000),
  drafts: [
    {
      kind: "post",
      text: "Agent post seed: every autonomous action should leave a durable, inspectable receipt.",
      rationale: "Grounded product update for the account audience.",
      relevanceScore: 96,
    },
    {
      kind: "reply",
      text: "That approval boundary is the difference between automation and unaccountable execution.",
      replyTo: "2000000000000000001",
      target: { ...targetBase, externalId: "2000000000000000001" },
      rationale: "Directly advances the source conversation.",
      relevanceScore: 91,
    },
    {
      kind: "quote",
      text: "Durable receipts are the missing interface between agent autonomy and human trust.",
      quoteOf: "2000000000000000002",
      target: {
        ...targetBase,
        externalId: "2000000000000000002",
        url: "https://x.com/hivemindos/status/2000000000000000002",
        text: "The most useful agents make their decisions legible.",
      },
      rationale: "Adds a standalone point of view to the source.",
      relevanceScore: 88,
    },
  ],
});

const editable = await service.enqueueSocialPost({ accountId: xAccount.id, text: "Editable human draft seed", origin: "human" });
const discardable = await service.enqueueSocialPost({ accountId: xAccount.id, text: "Discard candidate seed", origin: "human" });
const pickTime = await service.enqueueSocialPost({ accountId: xAccount.id, text: "Pick-time candidate seed", origin: "human" });
await service.enqueueSocialPost({ accountId: redditAccount.id, text: "Reddit draft seed body", title: "Reddit draft seed", subreddit: "hivemindos", origin: "human" });

const weekStart = new Date(now);
weekStart.setDate(weekStart.getDate() - (weekStart.getDay() === 0 ? 6 : weekStart.getDay() - 1));
weekStart.setHours(0, 0, 0, 0);
const friday = new Date(weekStart);
friday.setDate(friday.getDate() + 4);
friday.setHours(15, 30, 0, 0);
const saturday = new Date(weekStart);
saturday.setDate(saturday.getDate() + 5);
saturday.setHours(15, 30, 0, 0);
const scheduledSeed = await service.enqueueSocialPost({ accountId: xAccount.id, text: "Scheduled Friday seed", origin: "human" });
await service.scheduleSocialQueueItem(scheduledSeed.id, friday.toISOString());

const postedSeed = await service.enqueueSocialPost({ accountId: xAccount.id, text: "Published analytics seed", origin: "agent", forceReview: true });
const failedSeed = await service.enqueueSocialPost({ accountId: xAccount.id, text: "Known failed delivery seed", origin: "human" });
await store.mutateSocialQueue((queue) => queue.map((item) => {
  if (item.id === postedSeed.id) return {
    ...item,
    state: "posted",
    approval: { at: isoOffset(-60), by: "human" },
    result: {
      externalId: "posted-e2e-1",
      url: "https://x.com/e2e-social/status/posted-e2e-1",
      postedAt: isoOffset(-55),
      metrics: { impressions: 12400, engagements: 620, likes: 470, replies: 38 },
    },
    updatedAt: isoOffset(-55),
    stateHistory: [...item.stateHistory, { state: "posted", at: isoOffset(-55), by: "tick" }],
  };
  if (item.id === failedSeed.id) return {
    ...item,
    state: "failed",
    failure: { at: isoOffset(-40), error: "Fixture provider rejected credentials", attempts: 1, kind: "definite", retryable: true },
    updatedAt: isoOffset(-40),
    stateHistory: [...item.stateHistory, { state: "failed", at: isoOffset(-40), by: "tick" }],
  };
  return item;
}));
await store.appendSocialMetricSnapshots([
  { at: isoOffset(-180), accountId: xAccount.id, metrics: { followers: 1337, following: 42 } },
  { at: isoOffset(-170), accountId: xAccount.id, externalId: "posted-e2e-1", metrics: { impressions: 6200, engagements: 255 } },
  { at: isoOffset(-70), accountId: xAccount.id, externalId: "posted-e2e-1", metrics: { impressions: 12400, engagements: 620 } },
]);
await store.setSocialQueueEngineEnabled(false);

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

function collectLog(chunk) {
  serverLog.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  if (serverLog.length > 160) serverLog.splice(0, serverLog.length - 160);
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-hivemindos-device-token": deviceToken,
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function persistedAccount(id) {
  const result = await api("/api/socials/accounts");
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.accounts.find((account) => account.id === id);
}

async function queueItem(id) {
  const result = await api("/api/socials/queue");
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.queue.find((item) => item.id === id);
}

async function waitUntil(check, message, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(message);
}

async function selectAccount(page, handle) {
  await dismissGlobalOverlays(page);
  const chip = page.locator(".sc-account-chip").filter({ hasText: `@${handle}` });
  await chip.click();
  await page.getByTestId("social-queue-workspace").waitFor({ state: "visible" }).catch(() => undefined);
  assert.equal(await chip.getAttribute("data-active"), "true", `@${handle} must become the active account`);
}

async function dismissGlobalOverlays(page) {
  const tailscaleDismiss = page.getByRole("button", { name: "Dismiss Tailscale warning" });
  if (await tailscaleDismiss.isVisible().catch(() => false)) {
    await tailscaleDismiss.click();
    await tailscaleDismiss.waitFor({ state: "hidden" }).catch(() => undefined);
  }
  const rewardDismiss = page.getByRole("button", { name: "Close progress reward" });
  if (await rewardDismiss.isVisible().catch(() => false)) {
    await rewardDismiss.click();
    await rewardDismiss.waitFor({ state: "hidden" }).catch(() => undefined);
  }
  const maybeLater = page.getByRole("button", { name: "Maybe later" }).last();
  if (await maybeLater.isVisible().catch(() => false)) await maybeLater.click();
}

async function selectQueueItem(page, copy) {
  const row = page.locator(".sc-review-order-list > button").filter({ hasText: copy });
  await row.click();
  await page.locator(".sc-focus-card").getByText(copy, { exact: true }).waitFor({ state: "visible" }).catch(() => undefined);
}

async function acceptDialogFor(page, action, pattern) {
  const dialogPromise = page.waitForEvent("dialog");
  let actionError;
  const actionPromise = action().catch((error) => { actionError = error; });
  const dialog = await dialogPromise;
  assert.match(dialog.message(), pattern);
  await dialog.accept();
  await actionPromise;
  if (actionError) throw actionError;
}

async function dismissDialogFor(page, action, pattern) {
  const dialogPromise = page.waitForEvent("dialog");
  let actionError;
  const actionPromise = action().catch((error) => { actionError = error; });
  const dialog = await dialogPromise;
  assert.match(dialog.message(), pattern);
  await dialog.dismiss();
  await actionPromise;
  if (actionError) throw actionError;
}

try {
  child = spawn(process.execPath, ["scripts/dev-server.mjs", "--port", String(port)], {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: isolatedEnv,
  });
  child.stdout.on("data", collectLog);
  child.stderr.on("data", collectLog);
  await waitForServer(baseUrl);

  const unauthenticatedAccounts = await fetch(`${baseUrl}/api/socials/accounts`);
  const unauthenticatedQueue = await fetch(`${baseUrl}/api/socials/queue`);
  assert.equal(unauthenticatedAccounts.status, 401, "account reads must reject unauthenticated requests");
  assert.equal(unauthenticatedQueue.status, 401, "queue reads must reject unauthenticated requests");

  const forbiddenAuto = await api("/api/socials/accounts", {
    method: "POST",
    body: JSON.stringify({ action: "set-mode", id: xAccount.id, mode: "auto" }),
  });
  assert.equal(forbiddenAuto.response.status, 403, "auto mode must require explicit opt-in");
  assert.match(forbiddenAuto.body?.error ?? "", /explicit opt-in/i);

  const aggregate = await api("/api/socials/queue");
  assert.equal(aggregate.response.status, 200);
  assert.ok(aggregate.body.queue.length >= 10, "the authenticated aggregate queue must expose the fixture");
  assert.equal(aggregate.body.analytics.posted, 1);
  assert.equal(aggregate.body.analytics.failed, 1);

  browser = await chromium.launch({ headless: process.env.HIVE_E2E_HEADED !== "1" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const session = await context.request.post(`${baseUrl}/api/auth/session`, { data: { token: deviceToken }, headers: { accept: "application/json" } });
  assert.ok(session.ok(), `browser session setup failed with HTTP ${session.status()}`);
  const legalBundle = JSON.parse(await readFile(join(projectRoot, "legal", "hivemindos-policies.json"), "utf8"));
  const rewardResponse = await context.request.get(`${baseUrl}/api/progress-rewards?timezoneOffsetMinutes=240`, { headers: { accept: "application/json" } });
  const rewardPayload = await rewardResponse.json();
  assert.ok(rewardResponse.ok() && rewardPayload?.snapshot?.daily?.id, "isolated progress-reward fixture must load");
  const accepted = await context.request.post(`${baseUrl}/api/dashboard/state`, {
    data: {
      values: {
        "hivemindos.terms.acceptance.v1": JSON.stringify({ version: legalBundle.terms.version, acceptedAt: new Date().toISOString() }),
        "hivemindos.nativeFirstRun.dismissed.v3": "1",
        "hivemindos.progressRewards.dailyShown.v1": rewardPayload.snapshot.daily.id,
        ...(rewardPayload.snapshot.weekly?.id ? { "hivemindos.progressRewards.weeklyShown.v1": rewardPayload.snapshot.weekly.id } : {}),
      },
    },
    headers: { accept: "application/json" },
  });
  assert.ok(accepted.ok(), `isolated terms acceptance failed with HTTP ${accepted.status()}`);

  const page = await context.newPage();
  const browserErrors = [];
  const unexpectedSocialFailures = [];
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) browserErrors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/socials/") && response.status() >= 400) {
      unexpectedSocialFailures.push({ status: response.status(), method: response.request().method(), path: url.pathname, body: response.request().postData() ?? "" });
    }
  });

  await page.goto(`${baseUrl}/?view=socials`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const welcomeDismiss = page.getByRole("button", { name: "Maybe later" });
  if (await welcomeDismiss.isVisible().catch(() => false)) await welcomeDismiss.click();
  await page.getByRole("heading", { name: "Socials", exact: true }).waitFor({ timeout: 90_000 });
  await page.getByTestId("social-queue-workspace").waitFor({ state: "visible", timeout: 90_000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const lateDismiss = page.getByRole("button", { name: "Maybe later" }).last();
    if (await lateDismiss.isVisible().catch(() => false)) {
      await lateDismiss.click();
      await page.waitForTimeout(150);
      continue;
    }
    await page.waitForTimeout(250);
  }
  await page.getByTestId("social-queue-engine-status").getByText("Worker paused", { exact: true }).waitFor();
  await dismissGlobalOverlays(page);
  await page.locator(".sc-account-chip").filter({ hasText: "All accounts" }).click();
  assert.match(await page.getByRole("button", { name: /^Review/ }).innerText(), /\d/);

  for (const filter of ["Posts", "Replies", "Quotes", "All"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${filter}`) });
    await tab.click();
    assert.equal(await tab.getAttribute("aria-selected"), "true");
  }
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  const beforeSkip = await page.locator("[data-social-focus-editor]").inputValue();
  await page.keyboard.press("x");
  const afterSkip = await page.locator("[data-social-focus-editor]").inputValue();
  assert.notEqual(afterSkip, beforeSkip, "X must skip to another review item when focus is outside a field");
  await page.keyboard.press("e");
  assert.equal(await page.locator("[data-social-focus-editor]").evaluate((element) => element === document.activeElement), true, "E must focus the review editor");

  await selectQueueItem(page, editable.text);
  const focusEditor = page.locator("[data-social-focus-editor]");
  await focusEditor.fill("Editable human draft persisted through the real route");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).waitFor({ state: "hidden" });
  assert.equal((await queueItem(editable.id))?.text, "Editable human draft persisted through the real route");

  await selectQueueItem(page, generated[1].text);
  assert.equal(await page.locator(".sc-focus-card").getByRole("button", { name: "Post now" }).isDisabled(), true, "failed connection must block reply publishing");
  assert.equal((await queueItem(generated[1].id))?.state, "suggested", "blocked reply publishing must preserve the suggestion");
  await selectQueueItem(page, generated[2].text);
  assert.equal(await page.locator(".sc-focus-card").getByRole("button", { name: "Post now" }).isDisabled(), true, "failed connection must block quote publishing");
  assert.equal((await queueItem(generated[2].id))?.state, "suggested", "blocked quote publishing must preserve the suggestion");

  await selectQueueItem(page, discardable.text);
  await dismissDialogFor(page, () => page.locator(".sc-focus-card").getByRole("button", { name: "Discard", exact: true }).click(), /Discard this draft/i);
  assert.equal((await queueItem(discardable.id))?.state, "draft");
  await acceptDialogFor(page, () => page.locator(".sc-focus-card").getByRole("button", { name: "Discard", exact: true }).click(), /Discard this draft/i);
  await page.locator(".sc-review-order-list > button").filter({ hasText: discardable.text }).waitFor({ state: "hidden" });
  assert.equal((await queueItem(discardable.id))?.state, "canceled");

  await selectQueueItem(page, pickTime.text);
  assert.equal(await page.getByRole("button", { name: "Pick a time" }).isDisabled(), true, "failed connection must block review scheduling");
  assert.equal((await queueItem(pickTime.id))?.state, "draft", "blocked review scheduling must preserve the draft");
  await selectQueueItem(page, generated[0].text);
  assert.equal(await page.locator(".sc-focus-card").getByRole("button", { name: "Approve & schedule" }).isDisabled(), true, "failed connection must block approve-and-schedule");

  await selectAccount(page, "e2e-social");
  const composer = page.getByTestId("social-queue-composer");
  await composer.locator("textarea").fill("Composer draft persisted E2E");
  await composer.getByRole("button", { name: "Save draft" }).click();
  await composer.locator("textarea").waitFor({ state: "visible" });
  await waitUntil(async () => (await api(`/api/socials/queue?accountId=${encodeURIComponent(xAccount.id)}`)).body.queue.some((item) => item.text === "Composer draft persisted E2E"), "composer draft did not persist");

  await composer.locator("textarea").fill("Composer scheduled E2E");
  assert.equal(await composer.getByRole("button", { name: "Schedule", exact: true }).isDisabled(), true, "failed connection must block composer scheduling");

  await composer.getByRole("button", { name: "+ Reply or quote a post" }).click();
  await composer.locator("textarea").fill("Composer reply draft E2E");
  await composer.getByPlaceholder("Reply-to post ID").fill("reply-e2e-42");
  await composer.getByRole("button", { name: "Save draft" }).click();
  await waitUntil(async () => (await api(`/api/socials/queue?accountId=${encodeURIComponent(xAccount.id)}`)).body.queue.find((item) => item.text === "Composer reply draft E2E")?.replyTo === "reply-e2e-42", "composer reply target did not persist");

  await composer.getByPlaceholder("Reply-to post ID").fill("");
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByTestId("social-queue-engine-status").getByText("Worker live", { exact: true }).waitFor({ timeout: 20_000 });
  await waitUntil(() => page.getByRole("button", { name: "Process queue" }).isEnabled(), "process-queue control did not enable");
  await page.getByRole("button", { name: "Process queue" }).click();
  await waitUntil(() => page.getByRole("button", { name: "Process queue" }).isEnabled(), "process-queue tick did not settle", 20_000);
  await composer.locator("textarea").fill("Credential-safe post now E2E");
  const composerPostNow = composer.getByRole("button", { name: "Post now" });
  assert.equal(await composerPostNow.isDisabled(), true, "failed connection must disable post-now");
  assert.equal(await composer.getByRole("button", { name: "Schedule" }).isDisabled(), true, "failed connection must disable scheduling");
  await composer.getByRole("button", { name: "Save draft" }).click();
  await waitUntil(async () => (await api(`/api/socials/queue?accountId=${encodeURIComponent(xAccount.id)}`)).body.queue.find((item) => item.text === "Credential-safe post now E2E")?.state === "draft", "failed connection must still allow a saved draft", 20_000);
  const savedBlockedDraft = (await api(`/api/socials/queue?accountId=${encodeURIComponent(xAccount.id)}`)).body.queue.find((item) => item.text === "Credential-safe post now E2E");
  const blockedSend = await api("/api/socials/queue", { method: "POST", body: JSON.stringify({ action: "send-now", id: savedBlockedDraft.id }) });
  assert.equal(blockedSend.response.status, 409, "send-now API must reject a failed connection before approval");
  assert.equal((await queueItem(savedBlockedDraft.id))?.state, "draft", "blocked send must preserve draft state");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByTestId("social-queue-engine-status").getByText("Worker paused", { exact: true }).waitFor();

  await selectAccount(page, "e2e-reddit");
  const redditComposer = page.getByTestId("social-queue-composer");
  await redditComposer.locator("textarea").fill("Reddit title validation E2E");
  await redditComposer.getByPlaceholder("Reddit post title").fill("");
  const redditFailure = page.waitForResponse((response) => response.url().endsWith("/api/socials/queue") && response.request().method() === "POST" && response.status() === 400);
  await redditComposer.getByRole("button", { name: "Save draft" }).click();
  assert.match(JSON.stringify(await (await redditFailure).json()), /title is required/i);
  await redditComposer.getByPlaceholder("Reddit post title").fill("Valid Reddit title E2E");
  await redditComposer.getByRole("button", { name: "Save draft" }).click();
  await waitUntil(async () => (await api(`/api/socials/queue?accountId=${encodeURIComponent(redditAccount.id)}`)).body.queue.some((item) => item.title === "Valid Reddit title E2E"), "valid Reddit post did not persist");

  await selectAccount(page, "e2e-social");
  await page.getByRole("button", { name: /^Scheduled/ }).click();
  await page.locator(".sc-week-grid").waitFor();
  const fridayCard = page.locator(".sc-schedule-card").filter({ hasText: scheduledSeed.text });
  const saturdayColumn = page.locator(".sc-week-day").filter({ has: page.getByText("Sat", { exact: true }) });
  await fridayCard.dragTo(saturdayColumn);
  await waitUntil(async () => new Date((await queueItem(scheduledSeed.id))?.scheduledFor).getDay() === 6, "dragged schedule did not move to Saturday");
  assert.equal((await queueItem(scheduledSeed.id))?.scheduledFor, saturday.toISOString());
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.locator(".sc-schedule-list").getByText(scheduledSeed.text, { exact: true }).waitFor();
  const scheduleRow = page.locator(".sc-schedule-list article").filter({ hasText: scheduledSeed.text });
  await scheduleRow.getByRole("button", { name: "Cancel" }).click();
  await scheduleRow.waitFor({ state: "hidden" });
  assert.equal((await queueItem(scheduledSeed.id))?.state, "canceled");
  await page.getByText("Published analytics seed", { exact: true }).waitFor();
  await page.getByText("Known failed delivery seed", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await page.getByText("12.4K", { exact: true }).first().waitFor();
  await page.getByText("1,337", { exact: true }).waitFor();
  await page.getByText("Published analytics seed", { exact: true }).waitFor();

  await selectAccount(page, "e2e-managed");
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await page.getByText(/20 of 20 daily operations remain/).waitFor();
  await page.getByText("Daily read budget").locator("select").selectOption("50");
  await waitUntil(async () => (await persistedAccount(managedAccount.id))?.maxDailyReadOps === 50, "managed read budget did not persist");
  await dismissDialogFor(page, () => page.getByRole("button", { name: "Refresh analytics" }).click(), /metered hosted X API reads/i);

  await selectAccount(page, "e2e-social");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsNav = page.locator(".sc-settings-route > nav");
  const voiceCard = page.getByText("Posting voice", { exact: true }).locator("xpath=ancestor::section[1]");
  await voiceCard.locator("select").selectOption("Skills/e2e-social");
  await waitUntil(async () => (await persistedAccount(xAccount.id))?.soulPath === "Skills/e2e-social", "voice binding did not persist");

  await page.getByRole("button", { name: "Add context" }).click();
  await page.getByPlaceholder("https://github.com/owner/repo").fill("https://github.com/hivemindos/e2e");
  await page.getByPlaceholder("Note (optional)").fill("E2E source one");
  await page.getByRole("button", { name: "Add another" }).click();
  const contextRows = page.locator(".sc-card").filter({ hasText: "Context sources" }).locator(".sc-row");
  await contextRows.nth(1).locator("select").selectOption("website");
  await contextRows.nth(1).locator("input").nth(0).fill("https://example.com/e2e-social");
  await contextRows.nth(1).locator("input").nth(1).fill("E2E source two");
  const contextSaveResponse = page.waitForResponse((response) => response.url().endsWith("/api/socials/accounts")
    && response.request().method() === "POST"
    && (response.request().postData() ?? "").includes("add-context-sources"));
  await page.getByRole("button", { name: "Save 2 sources" }).click();
  const contextSave = await contextSaveResponse;
  const contextSavePayload = await contextSave.json();
  assert.equal(contextSave.status(), 200, `context multi-save failed: ${JSON.stringify(contextSavePayload)}`);
  const accountAfterContextSave = await persistedAccount(xAccount.id);
  assert.deepEqual(accountAfterContextSave?.contextSources.map((source) => source.ref), [
    "https://github.com/hivemindos/e2e",
    "https://example.com/e2e-social",
  ], `context multi-save persisted unexpected rows: ${JSON.stringify(accountAfterContextSave?.contextSources)}`);
  await page.locator(".sc-src-ref").filter({ hasText: "https://example.com/e2e-social" }).waitFor();
  assert.equal(accountAfterContextSave.contextSources.length, 2);
  await page.getByRole("button", { name: "Remove https://example.com/e2e-social" }).click();
  await page.locator(".sc-src-ref").filter({ hasText: "https://example.com/e2e-social" }).waitFor({ state: "hidden" });
  assert.equal((await persistedAccount(xAccount.id))?.contextSources.length, 1);

  await settingsNav.getByRole("button", { name: /^Schedule & mode/ }).click();
  await page.getByLabel("Restrict posting to a window").check();
  const awakeCard = page.getByText("Awake hours", { exact: true }).locator("xpath=ancestor::section[1]");
  await awakeCard.locator("input[type=time]").nth(0).fill("08:15");
  await awakeCard.locator("input[type=time]").nth(1).fill("21:45");
  await awakeCard.locator("select").selectOption("America/Los_Angeles");
  await awakeCard.getByRole("button", { name: "Sun" }).click();
  await awakeCard.getByRole("button", { name: "Save window" }).click();
  await waitUntil(async () => (await persistedAccount(xAccount.id))?.awakeHours.timezone === "America/Los_Angeles", "awake-hours timezone did not persist");
  assert.equal((await persistedAccount(xAccount.id))?.awakeHours.enabled, true);
  await acceptDialogFor(page, () => page.getByRole("button", { name: /Auto \(opt in\)/ }).click(), /Enable auto mode/i);
  await waitUntil(async () => (await persistedAccount(xAccount.id))?.postingMode === "auto", "explicit auto opt-in did not persist");
  await page.getByRole("button", { name: /^Manual/ }).click();
  await waitUntil(async () => (await persistedAccount(xAccount.id))?.postingMode === "manual", "manual mode did not persist");

  await settingsNav.getByRole("button", { name: /^Automation/ }).click();
  await page.getByRole("button", { name: "Pause drafts" }).click();
  await waitUntil(async () => (await persistedAccount(xAccount.id))?.drafting.enabled === false, "drafting pause did not persist");
  await page.getByRole("button", { name: "Enable drafts" }).click();
  await page.getByText("Cadence").locator("xpath=ancestor::label[1]").locator("select").selectOption("48");
  await page.getByText("Drafts per pack").locator("xpath=ancestor::label[1]").locator("select").selectOption("5");
  await page.getByRole("button", { name: "Pause comments" }).click();
  await page.getByRole("button", { name: "Enable comments" }).click();
  await page.getByText("Replies per pack").locator("xpath=ancestor::label[1]").locator("select").selectOption("2");
  await page.getByText(/Standalone quote posts per pack/).locator("xpath=ancestor::label[1]").locator("select").selectOption("1");
  await page.getByText("Target freshness").locator("xpath=ancestor::label[1]").locator("select").selectOption("24");
  await waitUntil(async () => {
    const drafting = (await persistedAccount(xAccount.id))?.drafting;
    return drafting?.enabled === true
      && drafting.cadenceHours === 48
      && drafting.draftsPerRun === 5
      && drafting.engagementEnabled === true
      && drafting.replyDraftsPerRun === 2
      && drafting.quoteDraftsPerRun === 1
      && drafting.engagementLookbackHours === 24;
  }, "drafting and engagement policy did not persist");
  assert.equal(await page.getByRole("button", { name: "Find replies now" }).isDisabled(), true, "Comment finder must stay disabled without an authenticated local X session");

  await settingsNav.getByRole("button", { name: /^Connection/ }).click();
  const sessionCard = page.getByTestId("social-x-session");
  await sessionCard.locator("select").selectOption("machine-default");
  await sessionCard.getByRole("button", { name: "Use machine default" }).click();
  await sessionCard.getByText("Using the machine-default Agent Reach X session.", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Connect social account" });
  await modal.waitFor();
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Connect account", exact: true }).click();
  await modal.locator(".sc-plat").filter({ hasText: "Telegram" }).click();
  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.locator('[aria-label="Connect account step 2 of 3"]').waitFor();
  await modal.getByRole("button", { name: "Back" }).click();
  await modal.locator('[aria-label="Connect account step 1 of 3"]').waitFor();
  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.locator('[aria-label="Connect account step 2 of 3"]').waitFor();
  await modal.getByRole("button", { name: "Continue" }).click();
  await modal.locator('[aria-label="Connect account step 3 of 3"]').waitFor();
  assert.equal(await modal.getByRole("button", { name: "Connect account" }).isDisabled(), true, "connector must require a handle");
  await modal.getByPlaceholder("channel name").fill("e2e-telegram");
  await modal.getByPlaceholder("-100…").fill("-100424242");
  await page.screenshot({ path: join(screenshotRoot, "connect-modal-desktop.png") });
  await modal.getByRole("button", { name: "Connect account" }).click();
  await modal.waitFor({ state: "hidden" });
  await page.locator(".sc-account-chip").filter({ hasText: "@e2e-telegram" }).waitFor();
  const telegram = await persistedAccount("telegram:e2e-telegram");
  assert.equal(telegram?.binding?.chatId, "-100424242");
  assert.equal(telegram?.postingMode, "manual");

  await selectAccount(page, "e2e-telegram");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".sc-settings-route > nav").getByRole("button", { name: /^Connection/ }).click();
  await acceptDialogFor(page, () => page.getByRole("button", { name: "Remove account" }).click(), /Remove @e2e-telegram/i);
  await page.locator(".sc-account-chip").filter({ hasText: "@e2e-telegram" }).waitFor({ state: "hidden" });
  assert.equal(await persistedAccount("telegram:e2e-telegram"), undefined);

  await selectAccount(page, "e2e-social");
  await page.getByRole("button", { name: /^Review/ }).click();
  const socialsRoot = page.locator(".sc-shell");
  for (const width of [390, 520, 720, 960, 1180, 1440]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.waitForTimeout(80);
    const overflow = await socialsRoot.evaluate((element) => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      root: element.scrollWidth - element.clientWidth,
    }));
    assert.ok(overflow.document <= 1, `document overflowed by ${overflow.document}px at ${width}px`);
    assert.ok(overflow.root <= 1, `Socials root overflowed by ${overflow.root}px at ${width}px`);
    if (width === 390) await page.screenshot({ path: join(screenshotRoot, "review-mobile-390.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(screenshotRoot, "review-desktop-1440.png"), fullPage: true });
  const darkBefore = await socialsRoot.evaluate((element) => getComputedStyle(element).backgroundColor);
  await socialsRoot.evaluate((element) => element.setAttribute("data-fr-theme", "light"));
  const lightAfter = await socialsRoot.evaluate((element) => getComputedStyle(element).backgroundColor);
  assert.ok(lightAfter.trim(), "light theme must resolve Socials color tokens");
  assert.notEqual(lightAfter.trim(), darkBefore.trim(), "light theme must switch the Socials background token");
  await page.screenshot({ path: join(screenshotRoot, "review-light-theme.png"), fullPage: true });

  const removableAccounts = [xAccount.id, redditAccount.id, managedAccount.id];
  for (const id of removableAccounts) {
    const deleted = await api("/api/socials/accounts", { method: "POST", body: JSON.stringify({ action: "delete", id }) });
    assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  if (await welcomeDismiss.isVisible().catch(() => false)) await welcomeDismiss.click();
  await page.getByRole("heading", { name: "One desk for every account your agents write for" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Connect your first account" }).waitFor();
  await page.getByRole("button", { name: "Connect your first account" }).click();
  await page.getByRole("dialog", { name: "Connect social account" }).waitFor();
  await page.getByRole("dialog", { name: "Connect social account" }).getByRole("button", { name: "Close" }).click();
  await page.screenshot({ path: join(screenshotRoot, "empty-state.png"), fullPage: true });

  const expectedRedditFailureIndex = unexpectedSocialFailures.findIndex((failure) => failure.status === 400 && failure.path === "/api/socials/queue" && failure.body.includes("Reddit title validation E2E"));
  assert.notEqual(expectedRedditFailureIndex, -1, "the browser must observe the expected Reddit title validation response");
  unexpectedSocialFailures.splice(expectedRedditFailureIndex, 1);
  assert.deepEqual(unexpectedSocialFailures, [], `unexpected Socials API failures: ${JSON.stringify(unexpectedSocialFailures, null, 2)}`);
  assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join("\n")}`);
  await context.close();

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    fixture: {
      accounts: 3,
      generatedKinds: generated.map((item) => item.generation?.kind),
      providerCredentials: "scrubbed",
    },
    screenshots: screenshotRoot,
    observedDefects,
    assertions: "auth, queue, filters, keyboard, edit, confirmations, discard, schedule, composer, safe-send failure, Reddit validation, drag-reschedule, analytics, settings, connector, responsive, empty-state",
  }, null, 2));
} catch (error) {
  console.error(`\nIsolated Socials server log (tail):\n${serverLog.join("\n")}\n`);
  throw error;
} finally {
  await browser?.close();
  await stopChild();
  await rm(tempRoot, { recursive: true, force: true });
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

async function waitForServer(url, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Isolated Next server exited with ${child.exitCode}.`);
    try {
      const response = await fetch(`${url}/api/socials/accounts`, {
        headers: { "x-hivemindos-device-token": deviceToken },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
    } catch {
      // The isolated server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for the isolated Socials server.");
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
