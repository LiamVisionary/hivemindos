// Headless E2E for the Queen Bee voice overlay frontend path: load the dev
// dashboard, fire the same toggle event the tray emits (DOM fallback), and
// assert the overlay (glow + control bar) mounts. Fake mic devices let the
// voice loop reach the listening state without real hardware.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl =
  process.env.QUEEN_VOICE_E2E_URL || "http://localhost:5021/?view=agents";

function dashboardDeviceToken() {
  if (process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN)
    return process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN.trim();
  try {
    const envLocal = readFileSync(
      fileURLToPath(new URL("../.env.local", import.meta.url)),
      "utf8",
    );
    const match = /^HIVEMINDOS_DASHBOARD_DEVICE_TOKEN=(.+)$/m.exec(envLocal);
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) =>
  consoleErrors.push(`pageerror: ${error.message}`),
);

console.log(`Loading ${baseUrl} ...`);
await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

const lockInput = page.locator('input[name="token"]');
if (await lockInput.count()) {
  const token = dashboardDeviceToken();
  if (!token) {
    console.error(
      "FAIL: dashboard is locked and no HIVEMINDOS_DASHBOARD_DEVICE_TOKEN was found.",
    );
    await browser.close();
    process.exit(1);
  }
  console.log("Dashboard locked; unlocking with the local device token.");
  await lockInput.fill(token);
  await page.locator('button[type="submit"], form button').first().click();
  // The unlock can navigate more than once; poll until the lock screen is gone.
  const unlockDeadline = Date.now() + 30_000;
  for (;;) {
    await page.waitForTimeout(1_000);
    try {
      if ((await page.locator('input[name="token"]').count()) === 0) break;
    } catch {
      // Execution context destroyed by a navigation; keep polling.
    }
    if (Date.now() > unlockDeadline) {
      console.error("FAIL: dashboard did not unlock in time.");
      await browser.close();
      process.exit(1);
    }
  }
}
await page.waitForTimeout(12_000); // let the dashboard hydrate and lazy chunks load

await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("hivemindos:queen-bee-voice"));
});
console.log("Dispatched hivemindos:queen-bee-voice toggle event.");
await page.waitForTimeout(5_000);

const result = await page.evaluate(() => {
  const dialog = document.querySelector(
    '[role="dialog"][aria-label="Queen Bee voice chat"]',
  );
  const glowRoot = document.querySelector("[data-queen-glow-root]");
  const glowFrame = document.querySelector("[data-queen-glow-frame]");
  const glowRootRect = glowRoot?.getBoundingClientRect();
  const glowFrameRect = glowFrame?.getBoundingClientRect();
  const glowFrameBoxShadow = glowFrame ? getComputedStyle(glowFrame).boxShadow : "";
  const statusText = dialog?.textContent ?? "";
  return {
    overlayMounted: Boolean(dialog),
    glowFrameBoxShadow,
    glowRootRect: glowRootRect
      ? {
          top: glowRootRect.top,
          left: glowRootRect.left,
          width: glowRootRect.width,
          height: glowRootRect.height,
        }
      : null,
    glowFrameRect: glowFrameRect
      ? {
          top: glowFrameRect.top,
          left: glowFrameRect.left,
          width: glowFrameRect.width,
          height: glowFrameRect.height,
        }
      : null,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    statusText: statusText.slice(0, 300),
  };
});

console.log(JSON.stringify(result, null, 2));
if (consoleErrors.length) {
  console.log("Console errors:");
  for (const error of consoleErrors.slice(0, 12)) console.log(`  - ${error}`);
}
await page.screenshot({ path: "/tmp/queen-voice-e2e.png", fullPage: false });
console.log("Screenshot: /tmp/queen-voice-e2e.png");
await browser.close();

const glowCoversViewport =
  result.glowRootRect
  && Math.abs(result.glowRootRect.top) <= 1
  && Math.abs(result.glowRootRect.left) <= 1
  && result.glowRootRect.width >= result.viewport.width - 2
  && result.glowRootRect.height >= result.viewport.height - 2;
const glowFramePurpleGlow =
  result.glowFrameRect
  && /inset/.test(result.glowFrameBoxShadow || "")
  && /(124,\s*77,\s*255|184,\s*91,\s*255|99,\s*110,\s*241)/.test(
    result.glowFrameBoxShadow || "",
  )
  && result.glowFrameRect.width >= result.viewport.width - 2
  && result.glowFrameRect.height >= result.viewport.height - 2;

if (!result.overlayMounted || !glowCoversViewport || !glowFramePurpleGlow) {
  console.error("FAIL: overlay did not mount or perimeter glow missing.");
  process.exit(1);
}
console.log("PASS: overlay mounted with perimeter glow and control bar.");
