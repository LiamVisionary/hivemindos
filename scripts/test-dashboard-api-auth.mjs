import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const authSecret = "a".repeat(64);
const deviceToken = "b".repeat(64);

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn("pnpm", [
  "exec",
  "next",
  "dev",
  "--webpack",
  "--disable-source-maps",
  "-p",
  String(port),
  "-H",
  "127.0.0.1",
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HIVEMINDOS_DASHBOARD_AUTH_SECRET: authSecret,
    HIVEMINDOS_DASHBOARD_DEVICE_TOKEN: deviceToken,
    HIVEMINDOS_TAURI_BUILD: "1",
    HIVEMINDOS_COMPANY_AUTONOMY_DRIVER: "0",
    HIVEMINDOS_HIVE_COMPUTE_RESUME: "0",
    HIVEMINDOS_INBOX_TRIAGE: "0",
    HIVEMINDOS_RESEARCH_SYNC: "0",
    HIVEMINDOS_TELEGRAM_TIP_BOT_AUTOSTART: "0",
    NEXT_TELEMETRY_DISABLED: "1",
    // Pin the paid seller surface to deterministic, network-free states:
    // gateway disabled (404 from the route) and an official base URL that
    // fails https validation (424 from the route, no upstream fetch). Empty
    // strings beat any .env.local values since Next never overrides set env.
    HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED: "",
    HIVEMINDOS_PAID_AGENT_SELLER_MODE: "",
    HIVEMINDOS_PAID_AGENT_CATALOG_JSON: "",
    HIVEMINDOS_PAID_AGENT_CATALOG_PATH: "",
    HIVEMINDOS_PAID_AGENT_PROFILE_JSON: "",
    HIVEMINDOS_PAID_AGENT_PROFILE_PATH: "",
    HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL: "http://127.0.0.1:9",
    HIVEMINDOS_OFFICIAL_PAID_AGENT_ALLOW_INSECURE: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForServer(baseUrl);
  await assertSensitiveRoutesRejectAnonymous(baseUrl);
  await assertBrowserExtensionPreflight(baseUrl);
  await assertPaidSellerRoutesReachPaymentAuth(baseUrl);
  const cookie = await openSession(baseUrl);
  await assertWalletApprovalFlow(baseUrl, cookie);
  console.log("Dashboard API auth checks passed");
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await stopChild();
}

async function assertSensitiveRoutesRejectAnonymous(url) {
  const probes = [
    // No in-route requireAuth — only the src/proxy.ts gate rejects this one,
    // so it fails if the proxy file ever stops loading (root middleware.ts
    // was silently ignored under the src/ layout until 2026-07-03).
    { path: "/api/notifications?limit=1", init: { method: "GET" } },
    // Proxy bypasses this route for credential-less CORS preflight, so its own
    // explicit auth check must still reject an anonymous data request.
    { path: "/api/browser-extension", init: { method: "GET" } },
    // Passkey authentication endpoints bypass the proxy so a locked browser can
    // complete a challenge. Enrollment and management must still reject an
    // anonymous caller inside their own routes.
    { path: "/api/auth/passkeys", init: { method: "GET" } },
    { path: "/api/auth/passkeys", init: jsonPost({ id: "not-a-real-passkey" }, "DELETE") },
    { path: "/api/auth/passkeys/registration/options", init: { method: "POST" } },
    { path: "/api/env", init: { method: "GET" } },
    { path: "/api/env", init: jsonPost({ sourceId: "shared", key: "TEST_SECRET", value: "nope" }) },
    { path: "/api/wallet/create", init: jsonPost({ agentId: "queen-bee" }) },
    { path: "/api/wallet/send", init: jsonPost({ agentId: "queen-bee", toAddress: "0x0000000000000000000000000000000000000000", amountUsd: 1, confirmation: "SEND_USDC" }) },
    { path: "/api/runtimes/aeon/deliverables", init: jsonPost({ action: "download", path: "/etc/hosts" }) },
    // Buyer-side route: spends the LOCAL wallet, so it must stay fleet-gated
    // even though the seller routes below are payment-authenticated.
    { path: "/api/hivemindos/models/chat/completions", init: jsonPost({ messages: [{ role: "user", content: "hi" }] }) },
  ];

  for (const probe of probes) {
    const response = await fetch(`${url}${probe.path}`, probe.init);
    assert.equal(response.status, 401, `${probe.init.method} ${probe.path} should require dashboard auth`);
  }
}

async function assertBrowserExtensionPreflight(url) {
  const origin = `chrome-extension://${"a".repeat(32)}`;
  const response = await fetch(`${url}/api/browser-extension`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
  assert.match(response.headers.get("access-control-allow-headers") ?? "", /Authorization/);
}

// External buyers authenticate by PAYING (x402 402-challenge handshake or
// X-HivemindOS-Credit-Token), never with fleet credentials, so the proxy gate
// must let tokenless requests through to the seller routes' own checks. With
// the pinned test env the routes answer 404/424/200 — any 401 here means the
// proxy gate regressed and the revenue rail is dead-ended again.
async function assertPaidSellerRoutesReachPaymentAuth(url) {
  const completion = jsonPost({ messages: [{ role: "user", content: "hi" }] });
  const probes = [
    { path: "/api/paid-agents/default/chat/completions", init: { method: "GET" }, status: 200 },
    { path: "/api/paid-agents/default/chat/completions", init: completion, status: 404, error: /gateway is disabled/i },
    { path: "/api/official-paid-agents/default/chat/completions", init: { method: "GET" }, status: 200 },
    { path: "/api/official-paid-agents/default/chat/completions", init: completion, status: 424, error: /not configured/i },
    { path: "/api/official-paid-agents/default/credits/balance", init: { method: "GET" }, status: 424, error: /not configured/i },
    { path: "/api/official-paid-agents/default/credits/top-up", init: jsonPost({ amountUsd: 5 }), status: 424, error: /not configured/i },
    { path: "/api/official-paid-agents/default/credits/checkout", init: jsonPost({ amountUsd: 5 }), status: 424, error: /not configured/i },
  ];

  for (const probe of probes) {
    const response = await fetch(`${url}${probe.path}`, probe.init);
    const label = `${probe.init.method} ${probe.path}`;
    assert.notEqual(response.status, 401, `${label} must reach the seller route, not the proxy auth gate`);
    assert.equal(response.status, probe.status, `${label} should answer from the seller route`);
    if (probe.error) {
      assert.match((await response.json()).error ?? "", probe.error, `${label} should return the route's own error`);
    }
  }
}

async function openSession(url) {
  const response = await fetch(`${url}/api/auth/session`, jsonPost({ token: deviceToken }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(cookie, /^hivemindos_session=/);
  assert(!response.headers.get("set-cookie")?.includes("Secure"), "local HTTP dashboard sessions must not use Secure cookies");
  return cookie;
}

async function assertWalletApprovalFlow(url, cookie) {
  const payment = {
    action: "send",
    agentId: "queen-bee",
    toAddress: "0x0000000000000000000000000000000000000000",
    amountUsd: 1,
    maxPaymentUsd: 5,
    confirmation: "SEND_USDC",
  };
  const withoutApproval = await fetch(`${url}/api/wallet/send`, withCookie(cookie, jsonPost(payment)));
  assert.equal(withoutApproval.status, 400);
  assert.match((await withoutApproval.json()).error, /fresh server approval/i);

  const approval = await fetch(`${url}/api/wallet/send`, withCookie(cookie, jsonPost({ ...payment, action: "approve" })));
  assert.equal(approval.status, 200);
  const approvalBody = await approval.json();
  assert.equal(approvalBody.ok, true);
  assert.equal(typeof approvalBody.approvalToken, "string");

  const firstUse = await fetch(`${url}/api/wallet/send`, withCookie(cookie, jsonPost({ ...payment, approvalToken: approvalBody.approvalToken })));
  assert.equal(firstUse.status, 404);
  assert.match((await firstUse.json()).error, /No local wallet/i);

  const replay = await fetch(`${url}/api/wallet/send`, withCookie(cookie, jsonPost({ ...payment, approvalToken: approvalBody.approvalToken })));
  assert.equal(replay.status, 400);
  assert.match((await replay.json()).error, /fresh server approval/i);
}

function jsonPost(body, method = "POST") {
  return {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function withCookie(cookie, init) {
  return {
    ...init,
    headers: {
      ...init.headers,
      cookie,
    },
  };
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Next dev exited early:\n${output}`);
    const response = await fetch(`${url}/api/env`).catch(() => null);
    if (response?.status === 401) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Next dev:\n${output}`);
}

async function stopChild() {
  if (child.exitCode != null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode == null && !child.signalCode) child.kill("SIGKILL");
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
