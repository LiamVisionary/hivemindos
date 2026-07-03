#!/usr/bin/env node
// Tailnet-facing app URL repair (src/app/api/fleet/apps-normalize.ts):
// peer /peer/<host:port> portal URLs unwrap to the peer's own tailnet door,
// and cached cross-machine app-proxy URLs carrying a dead local collector
// port heal to the pinned linkd door :8787. Guards the 2026-07-03 regression
// where the apps feed kept resurrecting ip:8792 bases for NYC TTS (collector
// localhost-scoped behind linkd), driving false fleet-watchdog alerts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/app/api/fleet/apps-normalize.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(
  source.replace(/\bexport\s+/g, "") +
    "\n;globalThis.__appsNormalize = { peerPortalToTailnetUrl, pinPeerAppProxyUrl, HIVEMIND_LINK_TAILNET_PORT };",
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const context = vm.createContext({ URL, decodeURIComponent, encodeURIComponent });
vm.runInContext(compiled, context, { filename: "apps-normalize.ts" });
const { peerPortalToTailnetUrl, pinPeerAppProxyUrl, HIVEMIND_LINK_TAILNET_PORT } =
  context.__appsNormalize;

assert.equal(HIVEMIND_LINK_TAILNET_PORT, 8787, "linkd tailnet door stays pinned");

// --- peerPortalToTailnetUrl: unwrap the localhost-scoped portal ---
assert.equal(
  peerPortalToTailnetUrl("http://127.0.0.1:8788/peer/100.84.93.113%3A8787/app-proxy/8799"),
  "http://100.84.93.113:8787/app-proxy/8799",
  "portal apiBaseUrl unwraps to the peer tailnet door",
);
assert.equal(
  peerPortalToTailnetUrl("http://127.0.0.1:8788/peer/100.84.93.113%3A8787"),
  "http://100.84.93.113:8787",
  "bare portal collector base unwraps",
);
assert.equal(
  peerPortalToTailnetUrl("http://127.0.0.1:8788/peer/100.84.93.113%3A8787/apps?refresh=1"),
  "http://100.84.93.113:8787/apps?refresh=1",
  "query string survives the unwrap",
);
assert.equal(
  peerPortalToTailnetUrl("http://100.84.93.113:8787/app-proxy/8799"),
  "http://100.84.93.113:8787/app-proxy/8799",
  "already-tailnet URLs pass through",
);
assert.equal(
  peerPortalToTailnetUrl("http://127.0.0.1:8788/peer/not-a-hostport/app-proxy/8799"),
  "http://127.0.0.1:8788/peer/not-a-hostport/app-proxy/8799",
  "malformed peer identity is left alone",
);
assert.equal(peerPortalToTailnetUrl("not a url"), "not a url", "garbage passes through");
assert.equal(peerPortalToTailnetUrl(undefined), "", "empty input stays empty");

// --- pinPeerAppProxyUrl: heal dead collector ports to the linkd door ---
assert.equal(
  pinPeerAppProxyUrl("http://100.84.93.113:8792/app-proxy/8799"),
  "http://100.84.93.113:8787/app-proxy/8799",
  "direct collector-port base heals to :8787 (observed NYC stale cache)",
);
assert.equal(
  pinPeerAppProxyUrl("http://100.84.93.113:8792/app-proxy/8799/health"),
  "http://100.84.93.113:8787/app-proxy/8799/health",
  "healthUrl heals too",
);
assert.equal(
  pinPeerAppProxyUrl("http://100.84.93.113:8787/app-proxy/8799"),
  "http://100.84.93.113:8787/app-proxy/8799",
  "already-pinned URL is unchanged",
);
assert.equal(
  pinPeerAppProxyUrl("http://127.0.0.1:8792/app-proxy/8799"),
  "http://127.0.0.1:8792/app-proxy/8799",
  "loopback host is the machine's own collector — never rewritten",
);
assert.equal(
  pinPeerAppProxyUrl("http://100.84.93.113:8799/v1/models"),
  "http://100.84.93.113:8799/v1/models",
  "non-app-proxy paths are not app-proxy URLs — unchanged",
);
assert.equal(
  pinPeerAppProxyUrl("http://127.0.0.1:8788/peer/100.84.93.113%3A8792/app-proxy/8799/"),
  "http://127.0.0.1:8788/peer/100.84.93.113%3A8787/app-proxy/8799/",
  "stale /peer/ identity port heals while the portal shape is kept",
);
assert.equal(
  pinPeerAppProxyUrl("http://127.0.0.1:8788/peer/100.84.93.113%3A8792/apps"),
  "http://127.0.0.1:8788/peer/100.84.93.113%3A8792/apps",
  "portal URLs without an app-proxy path are left alone",
);
assert.equal(pinPeerAppProxyUrl("not a url"), "not a url", "garbage passes through");
assert.equal(pinPeerAppProxyUrl(undefined), "", "empty input stays empty");

// --- composition: the cache-heal chain used by the apps route ---
const heal = (value) => pinPeerAppProxyUrl(peerPortalToTailnetUrl(value));
assert.equal(
  heal("http://127.0.0.1:8788/peer/100.84.93.113%3A8792/app-proxy/8799"),
  "http://100.84.93.113:8787/app-proxy/8799",
  "stale portal apiBaseUrl unwraps AND heals to the pinned door",
);
assert.equal(
  heal("http://100.84.93.113:8792/app-proxy/8766"),
  "http://100.84.93.113:8787/app-proxy/8766",
  "stale direct apiBaseUrl heals",
);

console.log("fleet apps tailnet URL repair: all assertions passed");
