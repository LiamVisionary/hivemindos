#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const configuredUrl = process.env.HIVE_E2E_AGENT_CALL_URL
  || process.env.HIVE_E2E_BASE_URL
  || process.env.DASHBOARD_URL
  || "http://127.0.0.1:5020";
const targetUrl = configuredUrl.includes("/e2e/agent-call")
  ? configuredUrl
  : new URL("/e2e/agent-call", `${configuredUrl.replace(/\/+$/, "")}/`).toString();

async function readEnvValue(filePath, key) {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

// The /api auth gate (src/proxy.ts) fails closed, so the harness page's real
// fetches (/api/fleet/discover, /api/phone?action=voice-config) 401 without a
// session. Resolve the device token the same way the sibling e2e scripts do,
// with the shared hive env as a final fallback.
const dashboardDeviceToken = process.env.HIVE_E2E_DASHBOARD_TOKEN
  || process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || await readEnvValue(new URL("../.env.local", import.meta.url), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  || await readEnvValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN");

async function newDashboardContext(browser) {
  const context = await browser.newContext({
    extraHTTPHeaders: dashboardDeviceToken ? { "x-hivemindos-device-token": dashboardDeviceToken } : {},
  });
  if (!dashboardDeviceToken) {
    console.warn("No HIVEMINDOS_DASHBOARD_DEVICE_TOKEN found (env, .env.local, ~/.hivemindos/.env); real /api calls will 401 when dashboard auth is enabled.");
    return context;
  }
  // context.request shares the context cookie jar, so the minted
  // hivemindos_session cookie is visible to every page in this context.
  const response = await context.request.post(new URL("/api/auth/session", targetUrl).toString(), {
    data: { token: dashboardDeviceToken },
    headers: { Accept: "application/json" },
  }).catch(() => null);
  if (!response?.ok()) {
    console.warn(`Dashboard session seeding failed (${response ? response.status() : "request failed"}); relying on device-token header auth.`);
  }
  return context;
}

function observeApiAuthFailures(page) {
  const authFailures = [];
  page.on("response", (response) => {
    let url;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (!url.pathname.startsWith("/api/")) return;
    if (response.status() === 401 || response.status() === 403) {
      authFailures.push(`${response.status()} ${url.pathname}${url.search}`);
    }
  });
  return authFailures;
}

function byokCallPayload() {
  return {
    ok: true,
    result: {
      call: {
        id: "e2e-agent-call",
        mode: "byok",
        voiceReady: true,
        realtime: {
          provider: "openai",
          model: "gpt-4o-realtime-preview",
          voice: "alloy",
          clientSecret: "e2e-client-secret",
          instructions: "You are the HivemindOS agent-call E2E harness.",
          tools: [
            {
              type: "function",
              name: "ask_computer_agent",
              description: "Ask the paired computer agent for a response.",
              parameters: {
                type: "object",
                properties: { message: { type: "string" } },
                required: ["message"],
              },
            },
          ],
        },
        runtimeAgent: {
          hubUrl: new URL(targetUrl).origin,
          agent: { id: "harness-agent", name: "HarnessAgent", runtime: "Hermes" },
          machine: { id: "harness-mac", name: "Harness Mac" },
        },
      },
    },
  };
}

async function installPhoneApiMock(page) {
  await page.route("**/api/phone", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "dashboard-agent-call") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(byokCallPayload()),
      });
      return;
    }
    if (body?.action === "agent-voice-turn") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, text: "Harness agent response." }),
      });
      return;
    }
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: `Unexpected /api/phone action: ${body?.action || "missing"}` }),
    });
  });
}

async function installOpenAiSdpMock(page) {
  await page.route("**/v1/realtime/calls", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Headers": "authorization, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Origin": "*",
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/sdp",
      },
      body: "v=0\r\ns=hivemindos-agent-call-e2e\r\n",
    });
  });
}

async function installWorkingRealtimeBrowserMocks(page) {
  await page.addInitScript(() => {
    const mediaDevices = {
      async getUserMedia() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return new MediaStream();
        const audioContext = new AudioContextClass();
        const oscillator = audioContext.createOscillator();
        const destination = audioContext.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        destination.stream.getTracks().forEach((track) => {
          const originalStop = track.stop.bind(track);
          track.stop = () => {
            originalStop();
            void audioContext.close().catch(() => undefined);
          };
        });
        return destination.stream;
      },
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      get: () => mediaDevices,
    });

    class MockDataChannel extends EventTarget {
      constructor() {
        super();
        this.readyState = "connecting";
        this.responseCount = 0;
        window.setTimeout(() => {
          this.readyState = "open";
          this.dispatchEvent(new Event("open"));
        }, 20);
      }

      emitAgentResponse(text, delayOffset = 0) {
        window.setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({ type: "response.created", response: { id: `response-${this.responseCount}` } }),
          }));
        }, delayOffset + 10);
        window.setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({ type: "response.output_audio.delta" }),
          }));
        }, delayOffset + 20);
        window.setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({ type: "response.audio_transcript.delta", delta: text }),
          }));
        }, delayOffset + 30);
        window.setTimeout(() => {
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({ type: "response.done" }),
          }));
        }, delayOffset + 60);
      }

      send(raw) {
        const payload = JSON.parse(String(raw));
        if (payload.type === "session.update") {
          window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", {
              data: JSON.stringify({ type: "session.updated" }),
            }));
          }, 10);
        }
        if (payload.type === "response.create") {
          this.responseCount += 1;
          this.emitAgentResponse("First agent response.");
          this.emitAgentResponse("Second agent response.", 120);
        }
      }

      close() {
        this.readyState = "closed";
      }
    }

    class MockPeerConnection extends EventTarget {
      constructor() {
        super();
        this.mockConnectionState = "new";
        this.mockLocalDescription = null;
        this.mockRemoteDescription = null;
        this.createDataChannel = () => new MockDataChannel();
        this.addTrack = () => {};
        this.getConfiguration = () => ({});
        this.createOffer = async () => ({ type: "offer", sdp: "v=0\r\ns=hivemindos-agent-call-e2e-offer\r\n" });
        this.setLocalDescription = async (description) => {
          this.mockLocalDescription = description;
        };
        this.setRemoteDescription = async (description) => {
          this.mockRemoteDescription = description;
          window.setTimeout(() => {
            this.mockConnectionState = "connected";
            this.dispatchEvent(new Event("connectionstatechange"));
          }, 25);
        };
        this.close = () => {
          this.mockConnectionState = "closed";
        };
      }

      get connectionState() {
        return this.mockConnectionState;
      }

      get localDescription() {
        return this.mockLocalDescription;
      }

      get remoteDescription() {
        return this.mockRemoteDescription;
      }
    }

    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: true,
      writable: true,
      value: MockPeerConnection,
    });
    Object.defineProperty(globalThis, "RTCPeerConnection", {
      configurable: true,
      writable: true,
      value: MockPeerConnection,
    });
    Object.defineProperty(window, "webkitRTCPeerConnection", {
      configurable: true,
      writable: true,
      value: MockPeerConnection,
    });
    window.RTCPeerConnection = MockPeerConnection;
    globalThis.RTCPeerConnection = MockPeerConnection;
  });
}

async function installUnsupportedMediaMocks(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      get: () => undefined,
    });
    class MockDataChannel extends EventTarget {
      constructor() {
        super();
        this.readyState = "connecting";
        window.setTimeout(() => {
          this.readyState = "open";
          this.dispatchEvent(new Event("open"));
        }, 20);
      }

      send(raw) {
        const payload = JSON.parse(String(raw));
        if (payload.type === "session.update") {
          window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", {
              data: JSON.stringify({ type: "session.updated" }),
            }));
          }, 10);
        }
        if (payload.type === "response.create") {
          window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", {
              data: JSON.stringify({ type: "response.done" }),
            }));
          }, 20);
        }
      }

      close() {
        this.readyState = "closed";
      }
    }

    class MockPeerConnection extends EventTarget {
      constructor() {
        super();
        this.mockConnectionState = "new";
        this.createDataChannel = () => new MockDataChannel();
        this.addTrack = () => {};
        this.addTransceiver = () => {};
        this.createOffer = async () => ({ type: "offer", sdp: "v=0\r\ns=hivemindos-agent-call-speaker-only-offer\r\n" });
        this.setLocalDescription = async () => {};
        this.setRemoteDescription = async () => {
          window.setTimeout(() => {
            this.mockConnectionState = "connected";
            this.dispatchEvent(new Event("connectionstatechange"));
          }, 25);
        };
        this.close = () => {
          this.mockConnectionState = "closed";
        };
      }

      get connectionState() {
        return this.mockConnectionState;
      }
    }

    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: true,
      writable: true,
      value: MockPeerConnection,
    });
    Object.defineProperty(globalThis, "RTCPeerConnection", {
      configurable: true,
      writable: true,
      value: MockPeerConnection,
    });
  });
}

function observePageErrors(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return pageErrors;
}

async function clickStartAndWaitForSetup(page) {
  await page.locator("[data-testid='agent-call-harness-start'][data-hydrated='true']").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(1_000);
  const setupRequest = page.waitForRequest((request) => (
    request.url().endsWith("/api/phone")
    && request.method() === "POST"
    && String(request.postData() || "").includes("dashboard-agent-call")
  ), { timeout: 10_000 });
  await page.getByTestId("agent-call-harness-start").click();
  await setupRequest;
}

// With dashboard auth seeded, /api/fleet/discover returns the real fleet, so
// the harness targets a real agent (fallback "HarnessAgent" only on an empty
// fleet). Read the resolved name instead of hardcoding the fallback.
async function harnessAgentName(page) {
  const targetText = (await page.getByTestId("agent-call-harness-target").textContent()) || "";
  const name = targetText.split(" on ")[0].trim();
  assert.ok(name && name !== "Discovering real agent...", `Harness target not resolved: "${targetText}"`);
  return name;
}

async function waitForHarnessPhase(page, pageErrors, phase, timeout = 10_000) {
  try {
    await page.waitForFunction((expectedPhase) => (
      document.querySelector("[data-testid='agent-call-harness-phase']")?.textContent === expectedPhase
    ), phase, { timeout });
  } catch (error) {
    const currentPhase = await page.getByTestId("agent-call-harness-phase").textContent().catch(() => "missing");
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Timed out waiting for harness phase ${phase}; current phase: ${currentPhase}; page errors: ${pageErrors.join(" | ") || "none"}; body: ${body.slice(0, 1000)}`, { cause: error });
  }
}

async function runWorkingCallScenario(context) {
  const page = await context.newPage();
  const pageErrors = observePageErrors(page);
  const apiAuthFailures = observeApiAuthFailures(page);
  await installWorkingRealtimeBrowserMocks(page);
  await installPhoneApiMock(page);
  await installOpenAiSdpMock(page);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await clickStartAndWaitForSetup(page);
  await waitForHarnessPhase(page, pageErrors, "talking");
  const agentName = await harnessAgentName(page);
  // "is on the line." only renders until the first transcript turn, and the
  // mocked agent responses land within ~200ms of connecting — accept either
  // the note or a transcript turn attributed to the agent.
  const onTheLineNote = page.getByText(`${agentName} is on the line.`);
  const agentTurnSpeaker = page.getByText(agentName.split("-")[0].toUpperCase().slice(0, 7), { exact: true });
  await onTheLineNote.or(agentTurnSpeaker).first().waitFor({ state: "visible", timeout: 5_000 });
  await expectAgentTranscriptText(page, "Second agent response.");

  assert.equal(
    pageErrors.filter((message) => /getUserMedia|mediaDevices|RTCPeerConnection|undefined is not an object/i.test(message)).length,
    0,
    `Working call scenario had browser API errors: ${pageErrors.join(" | ")}`,
  );
  assert.equal(
    apiAuthFailures.length,
    0,
    `Working call scenario hit unauthenticated /api responses (is HIVEMINDOS_DASHBOARD_DEVICE_TOKEN set and matching the server's .env.local?): ${apiAuthFailures.join(" | ")}`,
  );
  await page.close();
}

async function runUnsupportedMediaScenario(context) {
  const page = await context.newPage();
  const pageErrors = observePageErrors(page);
  const apiAuthFailures = observeApiAuthFailures(page);
  await installUnsupportedMediaMocks(page);
  await installPhoneApiMock(page);
  await installOpenAiSdpMock(page);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await clickStartAndWaitForSetup(page);
  await waitForHarnessPhase(page, pageErrors, "talking");
  // The rewritten call modal (a6bd2c2a) degrades to speaker-only with one
  // combined notice (shown in the status line and the transcript note)
  // instead of the old standalone "Speaker-only" copy and hard failure text.
  await page.getByText("Microphone capture is not available in this browser or desktop webview. Connecting speaker-only.")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "End call", exact: true }).waitFor({ state: "visible", timeout: 5_000 });
  const agentName = await harnessAgentName(page);
  assert.equal(await page.getByText(`${agentName} answered. Connecting audio...`).count(), 0, "Unsupported media should not show answered copy before audio connects.");
  assert.equal(
    await page.getByTestId("agent-call-harness-phase").textContent(),
    "talking",
    "Unsupported media should keep the call in the talking phase, not fail it.",
  );

  assert.equal(
    pageErrors.filter((message) => /getUserMedia|mediaDevices|RTCPeerConnection|undefined is not an object/i.test(message)).length,
    0,
    `Unsupported media scenario threw instead of failing gracefully: ${pageErrors.join(" | ")}`,
  );
  assert.equal(
    apiAuthFailures.length,
    0,
    `Unsupported media scenario hit unauthenticated /api responses (is HIVEMINDOS_DASHBOARD_DEVICE_TOKEN set and matching the server's .env.local?): ${apiAuthFailures.join(" | ")}`,
  );
  await page.close();
}

// The 2026-06-10 call-modal rewrite (a6bd2c2a) replaced the caption element
// (data-testid="agent-call-agent-caption") with a transcript turn log, so the
// agent's spoken text is asserted as a transcript turn instead.
async function expectAgentTranscriptText(page, expected) {
  await page.getByText(expected, { exact: true }).first().waitFor({ state: "visible", timeout: 5_000 });
}

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  headless: process.env.HIVE_E2E_HEADFUL !== "1",
});
try {
  const context = await newDashboardContext(browser);
  await runWorkingCallScenario(context);
  await runUnsupportedMediaScenario(context);
  console.log(`Agent call E2E harness passed: ${targetUrl}`);
} finally {
  await browser.close();
}
