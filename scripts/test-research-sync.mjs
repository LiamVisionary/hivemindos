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

const instrumentation = await readSource("src/instrumentation.ts");
assert.match(instrumentation, /\/api\/research-sync/);
assert.match(instrumentation, /HIVEMINDOS_RESEARCH_SYNC/);

console.log("research-sync + research-bridge checks passed");
