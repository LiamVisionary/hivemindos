// Hermetic checks for the Hive Research brain bridge (both directions):
// pure import-mapping functions, bridge origin/CORS policy, and static
// route/proxy invariants. No network, no vault writes, no live app.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { join, resolve } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  analysisMemoryContent,
  analysisMemoryKey,
  analysisMemoryTitle,
  frameworkMemoryContent,
  frameworkMemoryKey,
  frameworkMemoryTitle,
  researchGatewayBaseUrl,
} = await import("../src/lib/services/hive-research-sync.ts");
const {
  RESEARCH_BRIDGE_PROTOCOL,
  RESEARCH_BRIDGE_TOKEN_HEADER,
  researchBridgeCorsHeaders,
  researchBridgeOrigin,
  takeResearchBridgeRecallToken,
} = await import("../src/lib/services/research-bridge.ts");

const root = resolve(import.meta.dirname, "..");
const readSource = (path) => readFile(join(root, path), "utf8");

// --- import mapping (web -> app) ------------------------------------------------

assert.equal(frameworkMemoryKey("rfw_abc"), "hive-research:framework:rfw_abc");
assert.equal(analysisMemoryKey("ranal_xyz"), "hive-research:analysis:ranal_xyz");

const framework = {
  id: "rfw_abc",
  name: "Receipts First (yours)",
  version: 3,
  source: "learned",
  body: {
    stance: "Receipts or it did not happen.",
    focus: ["liquidity receipts"],
    redFlags: [{ rule: "tax > 5%", severity: "kill" }],
    greenFlags: ["locked liquidity"],
    reRatingTriggers: [{ watch: "liquidity", condition: "drops below $50k", action: "alert" }],
    verdictBias: "conservative",
    notes: ["2026-07-12: user feedback — distrust fresh deployers"],
  },
  createdAt: "2026-07-13T00:00:00.000Z",
};
const frameworkContent = frameworkMemoryContent(framework);
assert.match(frameworkContent, /Receipts First \(yours\)/);
assert.match(frameworkContent, /version 3, learned/);
assert.match(frameworkContent, /\[kill\] tax > 5%/);
assert.match(frameworkContent, /distrust fresh deployers/);
assert.match(frameworkContent, /rfw_abc v3/);
assert.equal(frameworkMemoryTitle(framework), "Hive Research lens: Receipts First (yours)");

const analysis = {
  id: "ranal_xyz",
  chain: "base",
  tokenAddress: `0x${"ab".repeat(20)}`,
  tokenSymbol: "TEST",
  tokenName: "Test Token",
  verdict: "avoid",
  score: 22,
  reportMd: "## Verdict\n\nAvoid.",
  frameworkId: "rfw_abc",
  frameworkVersion: 3,
  finishedAt: "2026-07-13T01:00:00.000Z",
};
const analysisContent = analysisMemoryContent(analysis);
assert.match(analysisContent, /avoid \(score 22\/100\)/);
assert.match(analysisContent, /framework rfw_abc v3/);
assert.match(analysisContent, /## Verdict/);
assert.equal(analysisMemoryTitle(analysis), "Hive Research: TEST — avoid (22)");

// Long reports are clipped with an explicit truncation notice, never silently.
const longReport = { ...analysis, reportMd: "x".repeat(9000) };
const clipped = analysisMemoryContent(longReport);
assert.ok(clipped.length < 9000);
assert.match(clipped, /\[Report truncated for memory/);

// Null verdict/score degrade to honest wording, not crashes.
const bare = analysisMemoryContent({ ...analysis, verdict: null, score: null, reportMd: null });
assert.match(bare, /: unknown\./);

// --- gateway base URL -------------------------------------------------------------

assert.equal(researchGatewayBaseUrl(), "https://hivemindos-research-gateway.hivemindos.workers.dev");
process.env.HIVEMINDOS_RESEARCH_GATEWAY_BASE_URL = "https://example.test/gw///";
assert.equal(researchGatewayBaseUrl(), "https://example.test/gw");
delete process.env.HIVEMINDOS_RESEARCH_GATEWAY_BASE_URL;

// --- bridge origin policy (app -> web) ----------------------------------------------

assert.equal(RESEARCH_BRIDGE_PROTOCOL, "hivemind.research-bridge.v1");
assert.equal(RESEARCH_BRIDGE_TOKEN_HEADER, "x-hivemindos-research-bridge-token");
assert.equal(researchBridgeOrigin("https://hivemindos.app"), "https://hivemindos.app");
assert.equal(researchBridgeOrigin("https://www.hivemindos.app"), "https://www.hivemindos.app");
assert.equal(researchBridgeOrigin("https://attacker.example"), "");
assert.equal(researchBridgeOrigin("https://hivemindos.app.attacker.example"), "");
assert.equal(researchBridgeOrigin(null), "");

const allowedHeaders = researchBridgeCorsHeaders("https://hivemindos.app");
assert.equal(allowedHeaders.get("Access-Control-Allow-Origin"), "https://hivemindos.app");
assert.match(allowedHeaders.get("Access-Control-Allow-Headers") ?? "", /x-hivemindos-research-bridge-token/);
const deniedHeaders = researchBridgeCorsHeaders("https://attacker.example");
assert.equal(deniedHeaders.get("Access-Control-Allow-Origin"), null);

// --- recall rate limit (stolen-token bulk-exfiltration guard) -------------------------

// One shared per-process bucket: 10 recalls/minute. Injected clock; the
// bucket starts full.
const t0 = 1_000_000;
for (let i = 0; i < 10; i += 1) {
  assert.equal(takeResearchBridgeRecallToken(t0), true, `recall ${i + 1} of 10 must pass`);
}
assert.equal(takeResearchBridgeRecallToken(t0), false, "11th recall in the same minute must be limited");
assert.equal(takeResearchBridgeRecallToken(t0 + 5_999), false, "still limited before a full token refills");
assert.equal(takeResearchBridgeRecallToken(t0 + 6_001), true, "one token refills after ~6s");
assert.equal(takeResearchBridgeRecallToken(t0 + 6_001), false, "refill is gradual, not a burst");
for (let i = 0; i < 10; i += 1) {
  assert.equal(takeResearchBridgeRecallToken(t0 + 66_001), true, "bucket refills fully after a quiet minute");
}
assert.equal(takeResearchBridgeRecallToken(t0 + 66_001), false, "full refill still caps at capacity");

// --- static route/proxy invariants ---------------------------------------------------

const proxySource = await readSource("src/proxy.ts");
assert.ok(proxySource.includes('"/api/research-bridge/hello"'), "hello must be self-authenticating");
assert.ok(proxySource.includes('"/api/research-bridge/recall"'), "recall must be self-authenticating");
assert.ok(!proxySource.includes('"/api/research-bridge/token"'),
  "the bridge token-mint route must stay behind the dashboard auth gate");
assert.ok(!proxySource.includes('"/api/research-sync"'),
  "the sync action route must stay behind the dashboard auth gate");

const recallSource = await readSource("src/app/api/research-bridge/recall/route.ts");
assert.match(recallSource, /verifyResearchBridgeToken/);
assert.match(recallSource, /verifyAuth/); // bridge token is an alternative, never a replacement
assert.match(recallSource, /takeResearchBridgeRecallToken/); // stolen tokens can't bulk-exfiltrate
assert.match(recallSource, /429/);

const bridgeService = await readSource("src/lib/services/research-bridge.ts");
assert.match(bridgeService, /redactSecretText/); // outbound excerpts are scrubbed
assert.match(bridgeService, /Operations\\\/Secure/); // secure notes never leave the machine
// The outbound hit shape is exactly title/type/createdAt/excerpt — no
// machine/tailnet/collector/path/proof metadata may be read off a hit.
for (const forbidden of ["hit.machineName", "hit.machineId", "hit.tailnet", "hit.collectorUrl", "hit.proof"]) {
  assert.ok(!bridgeService.includes(forbidden), `bridge output must not carry ${forbidden}`);
}
assert.match(
  bridgeService,
  /export type ResearchBridgeHit = \{\s*title: string;\s*type: string;\s*createdAt: string;\s*excerpt: string;\s*\};/,
  "ResearchBridgeHit must stay exactly title/type/createdAt/excerpt",
);

const syncRouteSource = await readSource("src/app/api/research-sync/route.ts");
assert.match(syncRouteSource, /guard:allow-hive-action-route/);
assert.ok(!syncRouteSource.includes("syncToken"), "the sync token must never reach a route response");

// --- deep link pairing (hivemindos://research/sync?code=hrsc_...) ---------------------

const {
  RESEARCH_SYNC_CODE_EVENT,
  stashResearchSyncCode,
  subscribeResearchSyncCode,
} = await import("../src/lib/services/research-sync-code.ts");

assert.equal(RESEARCH_SYNC_CODE_EVENT, "hivemindos:research-sync-code");

// Exactly-once claim semantics: codes are single-use on the gateway, so a
// parked code is delivered to one subscriber once, and claimed codes are
// never handed out again (duplicate deep-link deliveries, replays).
const claimed = [];
assert.equal(stashResearchSyncCode("not-a-code"), false, "non-hrsc_ strings are rejected");
assert.equal(stashResearchSyncCode(null), false);
assert.equal(stashResearchSyncCode(" hrsc_first "), true, "codes are trimmed and parked");
const unsubscribe = subscribeResearchSyncCode((code) => claimed.push(code));
assert.deepEqual(claimed, ["hrsc_first"], "subscribing claims the parked code");
assert.equal(stashResearchSyncCode("hrsc_first"), false, "a claimed code is never redeemed twice");
assert.equal(stashResearchSyncCode("hrsc_second"), true);
assert.deepEqual(claimed, ["hrsc_first", "hrsc_second"], "live codes are claimed immediately");
unsubscribe();
assert.equal(stashResearchSyncCode("hrsc_third"), true);
assert.deepEqual(claimed, ["hrsc_first", "hrsc_second"], "no delivery after unsubscribe");
const unsubscribeLate = subscribeResearchSyncCode((code) => claimed.push(code));
assert.deepEqual(claimed, ["hrsc_first", "hrsc_second", "hrsc_third"], "re-subscribing claims the parked code");
unsubscribeLate();

// Static invariants: the native deep-link branch, the cold-start park/take
// command, and the frontend consumers stay wired together.
const deepLinkRust = await readSource("src-tauri/src/desktop_navigation.rs");
assert.match(deepLinkRust, /hivemindos:research-sync-code/);
assert.match(deepLinkRust, /host == "research" && path == "sync"/);
assert.match(deepLinkRust, /fn take_pending_research_sync_code/);
const tauriLib = await readSource("src-tauri/src/lib.rs");
assert.match(tauriLib, /desktop_navigation::take_pending_research_sync_code/,
  "the cold-start take command must be registered in the invoke handler");
const integrationsViewSource = await readSource("src/features/integrations/IntegrationsView.tsx");
assert.match(integrationsViewSource, /RESEARCH_SYNC_CODE_EVENT/);
const syncCardSource = await readSource("src/features/integrations/HiveResearchSyncCard.tsx");
assert.match(syncCardSource, /subscribeResearchSyncCode/);
const navControllerSource = await readSource("src/features/dashboard/hooks/use-dashboard-navigation-controller.ts");
assert.match(navControllerSource, /listenForResearchSyncCodes/,
  "the always-mounted dashboard-root listener must stay registered (the Integrations view unmounts when inactive)");

const instrumentation = await readSource("src/instrumentation.ts");
assert.match(instrumentation, /\/api\/research-sync/);
assert.match(instrumentation, /HIVEMINDOS_RESEARCH_SYNC/);

console.log("research-sync + research-bridge checks passed");
