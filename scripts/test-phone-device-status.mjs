import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const calls = [];
const gatewayStatus = {
  ok: true,
  device: {
    id: "vdev_test",
    platform: "ios",
    environment: "sandbox",
    appVersion: "1.0.0",
    lastSeenAt: "2026-07-09T07:31:00.000Z",
    tokenPreview: "secret-preview",
  },
  count: 1,
  apns: {
    configured: true,
    missing: [],
    keyId: "KEY",
    teamId: "TEAM",
    bundleId: "com.example.mobile",
    topic: "com.example.mobile.voip",
    apnsHost: "api.sandbox.push.apple.com",
    environment: "sandbox",
  },
};

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  calls.push({ url: href, method: init.method ?? "GET" });
  if (href.endsWith("/voice/calls/ring-now") && init.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (href.endsWith("/voice/devices/status")) {
    return Response.json(gatewayStatus);
  }
  return Response.json({ ok: false, error: `Unexpected URL ${href}` }, { status: 500 });
};

const { readGatewayVoiceDeviceStatus } = await import("../src/lib/services/phone/call-gateway.ts");

const status = await readGatewayVoiceDeviceStatus();

assert.equal(status.ok, true);
assert.equal(status.gateway, "http://127.0.0.1:5000");
assert.deepEqual(status.result, gatewayStatus);
const callPaths = calls.map((call) => ({ method: call.method, path: new URL(call.url).pathname }));
assert.ok(
  callPaths.some((call) => call.method === "OPTIONS" && call.path === "/voice/calls/ring-now"),
  "gateway discovery should probe the ring endpoint",
);
assert.equal(
  callPaths.filter((call) => call.method === "GET" && call.path === "/voice/devices/status").length,
  1,
  "device status should be fetched once from the selected gateway",
);

const phoneRoute = readFileSync("src/app/api/phone/route.ts", "utf8");
assert.match(phoneRoute, /device:\s*device\s*\?\s*{/);
assert.doesNotMatch(phoneRoute, /tokenPreview\s*:/, "phone device-status response must not expose token previews");
assert.doesNotMatch(phoneRoute, /authKey\s*:/, "phone device-status response must not expose APNs auth keys");

const callsPanel = readFileSync("src/features/dashboard/views/chat/AgentSettingsCallsPanel.tsx", "utf8");
assert.match(callsPanel, /usePairingQr\(true\)/, "Calls panel should reuse the shared pairing QR hook");
assert.doesNotMatch(callsPanel, /from "qrcode"/, "Calls panel should not duplicate QR generation");
assert.doesNotMatch(callsPanel, /clawMobilePairingUrl|hubUrlForPairingHost/, "Calls panel should not duplicate pairing URL construction");
assert.match(callsPanel, /const statusResponse = await statusRequest;[\s\S]*await updatePhoneStatusFromResponse\(statusResponse\);[\s\S]*Promise\.all\(\[voiceRequest, localTtsRequest\]\)/, "device status should update before slower voice/local TTS discovery settles");
assert.match(callsPanel, /const phoneChecking = !phoneStatus\.checked/, "Calls panel should model unchecked phone status explicitly");
assert.match(callsPanel, /phoneStatus\.checked && !phoneStatus\.connected/, "unpaired setup UI should wait for a completed status check");
assert.match(callsPanel, /Checking mobile pairing/, "unchecked state should show an animated checking status instead of unpaired copy");
assert.match(callsPanel, /className="animate-spin"[\s\S]*Generating pairing code/, "pairing QR generation should include an animated pending indicator");

console.log("phone device-status gateway proxy checks passed");
