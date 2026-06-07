import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.HIVEMINDOS_E2E_URL || "http://127.0.0.1:5021").replace(/\/+$/, "");
const screenshotPath = process.env.HIVEMINDOS_SWARM_E2E_SCREENSHOT || "/tmp/hivemindos-swarm-e2e.png";
const realMode = process.argv.includes("--real") || process.env.HIVEMINDOS_SWARM_E2E_REAL === "1";
const requireRealCompletion = process.argv.includes("--require-completion") || process.env.HIVEMINDOS_SWARM_E2E_REQUIRE_COMPLETION === "1";
const agentRuntimeCalls = [];
const dashboardDeviceToken = process.env.HIVE_E2E_DASHBOARD_TOKEN
  || process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || await readEnvValue(join(process.cwd(), ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN");

const fixtureAgents = [
  {
    id: "swarm-planner",
    name: "Swarm Planner",
    runtime: "hermes",
    beeRole: "queen",
    workerClass: "planner",
    runtimeCapabilities: { chat: true },
    collectorCapabilities: { chat: true },
    machineName: "This Mac",
    telemetryUrl: "http://127.0.0.1:8787",
    gatewayUrl: "",
  },
  {
    id: "swarm-coder",
    name: "Swarm Coder",
    runtime: "hermes",
    beeRole: "worker",
    workerClass: "code",
    runtimeCapabilities: { chat: true },
    collectorCapabilities: { chat: true },
    machineName: "This Mac",
    telemetryUrl: "http://127.0.0.1:8787",
    gatewayUrl: "",
  },
  {
    id: "swarm-qa",
    name: "Swarm QA",
    runtime: "hermes",
    beeRole: "worker",
    workerClass: "qa",
    runtimeCapabilities: { chat: true },
    collectorCapabilities: { chat: true },
    machineName: "This Mac",
    telemetryUrl: "http://127.0.0.1:8787",
    gatewayUrl: "",
  },
  {
    id: "swarm-writer",
    name: "Swarm Writer",
    runtime: "hermes",
    beeRole: "worker",
    workerClass: "writer",
    runtimeCapabilities: { chat: true },
    collectorCapabilities: { chat: true },
    machineName: "This Mac",
    telemetryUrl: "http://127.0.0.1:8787",
    gatewayUrl: "",
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  extraHTTPHeaders: dashboardAuthHeaders(),
  viewport: { width: 1440, height: 980 },
});
if (dashboardDeviceToken) {
  await context.request.post(`${baseUrl}/api/auth/session`, {
    data: { token: dashboardDeviceToken },
    headers: { Accept: "application/json" },
  }).catch(() => null);
}
const page = await context.newPage();

try {
  const seedAgents = realMode ? await discoverRealAgents(context.request) : fixtureAgents;
  if (!realMode) {
    await page.route("**/api/chat/agent-runtime", async (route) => {
      const body = route.request().postDataJSON();
      agentRuntimeCalls.push({
        agentId: body?.agent?.id,
        agentName: body?.agent?.name,
        prompt: body?.messages?.[0]?.content ?? "",
        runType: route.request().headers()["x-hivemind-run-type"],
      });
      const text = `Stubbed swarm pass from ${body?.agent?.name ?? "agent"}.`;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
        body: [
          `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
      });
    });
  }

  const selectedAgent = realMode
    ? seedAgents.find((agent) => agent.name === "AdaptiveAgent") ?? seedAgents[0]
    : fixtureAgents[0];
  assert.ok(selectedAgent, "Expected at least one selected agent for swarm smoke");
  const taskMarker = `e2e-${Date.now()}`;
  const taskText = realMode
    ? `fix a tiny code issue by saying your role only ${taskMarker}`
    : `fix a TypeScript bug and add tests ${taskMarker}`;
  const prompt = `/swarm 2 ${taskText}`;
  const chatLeaf = `e2e-swarm-${Date.now()}`;

  await page.goto(`${baseUrl}/`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await seedDashboardState(page, seedAgents);

  await page.goto(`${baseUrl}/?view=chat&agent=${encodeURIComponent(selectedAgent.id)}&chatLeaf=${encodeURIComponent(chatLeaf)}`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  const textarea = page.getByPlaceholder(`Message ${selectedAgent.name}...`);
  await textarea.waitFor({ state: "visible", timeout: 45_000 });
  await assertSelectedAgent(page, selectedAgent.name);
  await textarea.fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await page.waitForFunction((marker) => {
    const bodyText = document.body?.innerText ?? "";
    return bodyText.includes(marker) && /Swarm packet[\s\S]*Completed:\s*\d+\/2/.test(bodyText);
  }, taskMarker, {
    timeout: realMode ? 180_000 : 45_000,
  });
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const transcript = await page.locator("body").innerText({ timeout: 10_000 });
  assert.match(transcript, /## Swarm packet|Swarm packet/);
  const freshPacket = swarmExcerpt(transcript, taskMarker);
  if (realMode) {
    assert.doesNotMatch(freshPacket, /Missing OpenClaw gateway URL|Add the OpenClaw gateway URL/i);
    const completed = Number(freshPacket.match(/Completed:\s*(\d+)\/2/)?.[1] ?? 0);
    if (requireRealCompletion) {
      assert.ok(completed > 0, `Real /swarm 2 returned no completed agent passes.\n${freshPacket}`);
    }
    const outcome = completed > 0
      ? `${completed}/2 completed real agent passes`
      : "0/2 completed real agent passes; runtime providers returned no assistant text";
    console.log(`Dashboard /swarm 2 real browser orchestration smoke passed with ${outcome}.`);
    if (completed === 0) console.warn(freshPacket);
  } else {
    assert.equal(agentRuntimeCalls.length, 2, "The /swarm 2 command should call exactly two subagents");
    assert.deepEqual(agentRuntimeCalls.map((call) => call.agentId), ["swarm-planner", "swarm-coder"]);
    assert.ok(agentRuntimeCalls.every((call) => call.runType === "swarm-agent"), "Runtime calls should be marked as swarm-agent runs");
    assert.ok(agentRuntimeCalls.every((call) => call.prompt.includes(`Swarm task: ${taskText}`)));
    assert.match(freshPacket, /Swarm Planner/);
    assert.match(freshPacket, /Swarm Coder/);
    assert.doesNotMatch(freshPacket, /Swarm QA - QA/);
    console.log(`Dashboard /swarm 2 mocked browser smoke passed with ${agentRuntimeCalls.length} intercepted runtime calls.`);
  }
  console.log(`Screenshot: ${screenshotPath}`);
} finally {
  await context.close();
  await browser.close();
}

async function discoverRealAgents(request) {
  const response = await request.get(`${baseUrl}/api/fleet/discover?includeSnapshots=0`, {
    headers: { Accept: "application/json" },
    timeout: 30_000,
  });
  const data = await response.json();
  const machines = Array.isArray(data?.machines) ? data.machines : [];
  const localMachine = machines.find((machine) => machine?.collector === "ready" && machine?.device?.self)
    ?? machines.find((machine) => machine?.collector === "ready" && /this mac/i.test(String(machine?.device?.name ?? "")))
    ?? machines.find((machine) => machine?.collector === "ready");
  const agents = Array.isArray(localMachine?.agents) ? localMachine.agents : [];
  const chatAgents = agents
    .filter((agent) => agent && agent.beeRole !== "human" && agent.beeRole !== "observer")
    .map((agent) => ({
      ...agent,
      runtimeCapabilities: { ...(agent.runtimeCapabilities ?? {}), chat: true },
      collectorCapabilities: { ...(agent.collectorCapabilities ?? {}), chat: true },
      gatewayUrl: agent.gatewayUrl || "",
      telemetryUrl: agent.telemetryUrl || "",
      machineName: agent.machineName || localMachine?.device?.name || "This Mac",
    }));
  assert.ok(chatAgents.length >= 2, "Real swarm smoke needs at least two discovered chat-capable agents");
  return chatAgents;
}

async function seedDashboardState(page, seedAgents) {
  await page.evaluate((agents) => {
    window.localStorage.setItem("hivemindos.agentProfiles.v1", JSON.stringify(agents));
    window.localStorage.setItem("hivemindos.chatMessages.v1", "{}");
    window.localStorage.setItem("hivemindos.honeyLedger.enabled.v1", "false");
  }, seedAgents);
}

async function assertSelectedAgent(page, agentName) {
  await page.waitForFunction((name) => (document.body?.innerText ?? "").includes(name), agentName, { timeout: 45_000 });
}

function swarmExcerpt(transcript, marker = "") {
  const markerIndex = marker ? transcript.lastIndexOf(marker) : -1;
  const index = markerIndex >= 0
    ? transcript.lastIndexOf("Swarm packet", markerIndex)
    : transcript.lastIndexOf("Swarm packet");
  return (index >= 0 ? transcript.slice(index) : transcript).slice(0, 2_000);
}

async function readEnvValue(filePath, key) {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

function dashboardAuthHeaders() {
  return dashboardDeviceToken ? { "x-hivemindos-device-token": dashboardDeviceToken } : {};
}
