#!/usr/bin/env node
// Hermetic unit test for the chat preview pane's pure helpers
// the target selector (chat-preview-targets.ts) and the SSRF gate
// (chat-preview-guard.ts). No network, no app, no fleet — just fixtures. Run standalone:
//   pnpm test:chat-preview-targets
import assert from "node:assert/strict";

const { selectChatPreviewTargets } = await import(
  "../src/lib/services/chat/chat-preview-targets.ts"
);
// The SSRF gate is server-only (it pulls in `local-collector-url`, which needs
// `fs/promises`), so it lives in a sibling module the client never imports.
const { isAllowedChatPreviewUrl } = await import(
  "../src/lib/services/chat/chat-preview-guard.ts"
);

// Fixtures shaped like the discovered hosted apps (ChatPreviewHostedApp — a
// structural subset of FoundryHostedApp). URLs use the fleet host surface the
// allowlist trusts: loopback linkd peer-proxy + a Tailscale CGNAT IP.
const localApp = {
  id: "local-1",
  name: "z-image",
  machine: "This Mac",
  port: 8801,
  state: "running",
  openUrl: "http://127.0.0.1:8801",
  healthUrl: "http://127.0.0.1:8801/health",
  interactive: true,
};
const remoteApp = {
  id: "remote-1",
  name: "comfyui",
  machine: "Atlas",
  port: 8792,
  state: "running",
  openUrl: "http://100.100.1.20:8792",
  healthUrl: "http://100.100.1.20:8792/system_stats",
  interactive: false,
};
const remoteInteractive = {
  id: "remote-2",
  name: "brainboard",
  machine: "Atlas",
  port: 8793,
  state: "running",
  openUrl: "http://100.100.1.20:8793",
  interactive: true,
};
const stoppedApp = {
  id: "stopped-1",
  name: "stopped-svc",
  machine: "Atlas",
  port: 8794,
  state: "stopped",
  openUrl: "http://100.100.1.20:8794",
  interactive: true,
};
const noUrlApp = {
  id: "nourl-1",
  name: "ghost",
  machine: "Atlas",
  port: 0,
  state: "running",
  openUrl: "",
  interactive: true,
};

const allApps = [remoteApp, localApp, remoteInteractive, stoppedApp, noUrlApp];

// --- selectChatPreviewTargets -------------------------------------------------

// Empty machineName => all live apps across machines; stopped + no-url dropped.
const all = selectChatPreviewTargets(allApps, "");
assert.equal(all.length, 3, "stopped and url-less apps must be excluded");
assert.ok(!all.some((t) => t.id === "stopped-1"), "stopped app excluded");
assert.ok(!all.some((t) => t.id === "nourl-1"), "url-less app excluded");

// Stable sort: interactive first, then by name. Interactive live apps here are
// brainboard (remote-2) and z-image (local-1); non-interactive is comfyui.
assert.deepEqual(
  all.map((t) => t.id),
  ["remote-2", "local-1", "remote-1"],
  "interactive-first then name-sorted",
);
assert.deepEqual(
  all.map((t) => t.name),
  ["brainboard", "z-image", "comfyui"],
);

// Target shape carries the real url + metadata (no fabricated fields).
const brain = all[0];
assert.deepEqual(brain, {
  id: "remote-2",
  name: "brainboard",
  machine: "Atlas",
  port: 8793,
  url: "http://100.100.1.20:8793",
  interactive: true,
});

// machineName filter is case-insensitive and scopes to that machine only.
const atlasOnly = selectChatPreviewTargets(allApps, "atlas");
assert.deepEqual(atlasOnly.map((t) => t.id), ["remote-2", "remote-1"]);
assert.ok(!atlasOnly.some((t) => t.machine === "This Mac"));

const thisMac = selectChatPreviewTargets(allApps, "This Mac");
assert.deepEqual(thisMac.map((t) => t.id), ["local-1"]);

// Unknown machine => no targets (never invents one).
assert.deepEqual(selectChatPreviewTargets(allApps, "does-not-exist"), []);
// Defensive: undefined/empty input never throws.
assert.deepEqual(selectChatPreviewTargets([], undefined), []);

// --- isAllowedChatPreviewUrl (the SSRF gate) ---------------------------------

// Positive: an exact discovered openUrl / healthUrl on the fleet surface passes.
assert.equal(isAllowedChatPreviewUrl("http://100.100.1.20:8792", allApps), true);
assert.equal(
  isAllowedChatPreviewUrl("http://100.100.1.20:8792/system_stats", allApps),
  true,
  "a discovered healthUrl is allowed",
);
assert.equal(isAllowedChatPreviewUrl("http://127.0.0.1:8801", allApps), true);
// Trailing-slash tolerant (normalizeCollectorUrl strips it), still exact host+port.
assert.equal(isAllowedChatPreviewUrl("http://127.0.0.1:8801/", allApps), true);

// SSRF #1 — look-alike: SAME fleet host, DIFFERENT port. The host passes the
// allowlist, but it is not a discovered app URL, so it must be rejected. This
// is the port-scan-your-own-loopback / tailnet attack the exact-match layer
// exists to stop.
assert.equal(
  isAllowedChatPreviewUrl("http://100.100.1.20:22", allApps),
  false,
  "same fleet host + different port must be rejected",
);
assert.equal(
  isAllowedChatPreviewUrl("http://127.0.0.1:6379", allApps),
  false,
  "loopback look-alike port must be rejected",
);

// SSRF #2 — attacker-controlled host that is NOT on the fleet surface. Rejected
// on both layers (unknown URL AND fails the host allowlist).
assert.equal(
  isAllowedChatPreviewUrl("http://evil.example.com:8792", allApps),
  false,
  "off-fleet attacker host must be rejected",
);
assert.equal(isAllowedChatPreviewUrl("http://169.254.169.254/latest/meta-data/", allApps), false);

// SSRF #3 — belt-and-suspenders: even if a "discovered" app URL somehow points
// off-fleet (public IP), the host-allowlist layer still refuses it.
const offFleetDiscovered = [
  { id: "x", name: "leaky", machine: "Atlas", port: 80, state: "running", openUrl: "http://8.8.8.8:80", interactive: false },
];
assert.equal(
  isAllowedChatPreviewUrl("http://8.8.8.8:80", offFleetDiscovered),
  false,
  "a discovered-but-off-fleet URL must still fail the host allowlist",
);

// Empty / garbage inputs never pass.
assert.equal(isAllowedChatPreviewUrl("", allApps), false);
assert.equal(isAllowedChatPreviewUrl("not a url", allApps), false);
assert.equal(isAllowedChatPreviewUrl("http://100.100.1.20:8792", []), false);

console.log("chat-preview-targets: all assertions passed");
