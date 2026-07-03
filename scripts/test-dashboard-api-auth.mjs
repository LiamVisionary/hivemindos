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
    NEXT_TELEMETRY_DISABLED: "1",
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
  const cookie = await openSession(baseUrl);
  await assertWalletApprovalFlow(baseUrl, cookie);
  console.log("Dashboard API auth checks passed");
} finally {
  await stopChild();
}

async function assertSensitiveRoutesRejectAnonymous(url) {
  const probes = [
    // No in-route requireAuth — only the src/proxy.ts gate rejects this one,
    // so it fails if the proxy file ever stops loading (root middleware.ts
    // was silently ignored under the src/ layout until 2026-07-03).
    { path: "/api/notifications?limit=1", init: { method: "GET" } },
    { path: "/api/env", init: { method: "GET" } },
    { path: "/api/env", init: jsonPost({ sourceId: "shared", key: "TEST_SECRET", value: "nope" }) },
    { path: "/api/wallet/create", init: jsonPost({ agentId: "queen-bee" }) },
    { path: "/api/wallet/send", init: jsonPost({ agentId: "queen-bee", toAddress: "0x0000000000000000000000000000000000000000", amountUsd: 1, confirmation: "SEND_USDC" }) },
    { path: "/api/runtimes/aeon/deliverables", init: jsonPost({ action: "download", path: "/etc/hosts" }) },
  ];

  for (const probe of probes) {
    const response = await fetch(`${url}${probe.path}`, probe.init);
    assert.equal(response.status, 401, `${probe.init.method} ${probe.path} should require dashboard auth`);
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

function jsonPost(body) {
  return {
    method: "POST",
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
