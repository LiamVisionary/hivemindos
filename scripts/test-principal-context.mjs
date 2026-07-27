#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = "p".repeat(40);
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = "principal-device-token-123";
process.env.OPENCLAW_NEXT_USER_ID = "test-user";

const auth = await import("../src/lib/utils/server-auth.ts");

const deviceResult = await auth.verifyAuth(new Request("http://127.0.0.1/api/test", {
  headers: { "x-hivemindos-device-token": "principal-device-token-123" },
}));
assert.equal(deviceResult.userId, "test-user");
assert.equal(deviceResult.principal?.principalId, "test-user");
assert.equal(deviceResult.principal?.kind, "dashboard-device");
assert.equal(deviceResult.principal?.source, "device-token");
assert.ok(deviceResult.principal?.claims.includes("local:admin"));
assert.ok(deviceResult.principal?.claims.includes("connectors:invoke"));

const cookie = await auth.createDashboardSessionCookieValue();
const sessionResult = await auth.verifyAuth(new Request("http://127.0.0.1/api/test", {
  headers: { cookie: `${auth.DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(cookie)}` },
}));
assert.equal(sessionResult.userId, "test-user");
assert.equal(sessionResult.principal?.kind, "local-user");
assert.equal(sessionResult.principal?.source, "session");

const missing = await auth.verifyAuth(new Request("http://127.0.0.1/api/test"));
assert.equal(missing.userId, null);
assert.match(missing.reason ?? "", /authentication is required/i);

console.log("Principal context auth tests passed.");
