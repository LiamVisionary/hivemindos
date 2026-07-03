import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);

const files = {
  service: "src/lib/services/paid-agent-gateway.ts",
  officialClient: "src/lib/services/paid-agent-cloud-client.ts",
  route: "src/app/api/paid-agents/[slug]/chat/completions/route.ts",
  officialRoute: "src/app/api/official-paid-agents/[slug]/chat/completions/route.ts",
  builderHelper: "src/lib/services/wallet/x402-builder-code.ts",
  contextIndex: "src/lib/services/context-index.ts",
  docs: "docs/for-users/features/wallets-honey-and-x402.md",
  proxy: "src/proxy.ts",
};

const contents = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, path]) => [
    key,
    await readFile(new URL(path, ROOT), "utf8"),
  ])),
);

// The seller routes must stay exempt from the dashboard auth gate: the x402
// handshake needs the first request to arrive credential-less so the resource
// server can answer with the 402 challenge. Live regression coverage lives in
// scripts/test-dashboard-api-auth.mjs (excluded from the hermetic gate).
const proxyAllowlist = contents.proxy.match(/SELF_AUTHENTICATING_API_PREFIXES = \[[\s\S]*?\]/)?.[0] ?? "";

const checks = [
  ["service uses x402 resource server", contents.service.includes("x402ResourceServer")],
  ["service uses x402 HTTP server", contents.service.includes("x402HTTPResourceServer")],
  ["service registers exact EVM scheme", contents.service.includes("registerExactEvmScheme")],
  ["service supports x402 builder codes", contents.service.includes("declareBuilderCodeExtension") && contents.builderHelper.includes("HIVEMINDOS_PAID_AGENT_BUILDER_CODE")],
  ["service uses Coinbase CDP facilitator helper", contents.service.includes("createFacilitatorConfig") && contents.service.includes("CDP_API_KEY_ID") && contents.service.includes("CDP_API_KEY_SECRET")],
  ["service makes testnet explicit opt-in", contents.service.includes("HIVEMINDOS_PAID_AGENT_TESTNET_MODE") && contents.service.includes("defaultPaidAgentNetwork")],
  ["service settles verified payments", contents.service.includes("processSettlement")],
  ["service fails closed on payTo", contents.service.includes("HIVEMINDOS_PAID_AGENT_PAY_TO")],
  ["service fails closed on facilitator", contents.service.includes("HIVEMINDOS_PAID_AGENT_FACILITATOR_URL")],
  ["service requires explicit seller mode", contents.service.includes("HIVEMINDOS_PAID_AGENT_SELLER_MODE")],
  ["service blocks local packaged seller mode", contents.service.includes("Downloaded apps must call a hosted HivemindOS paid-agent endpoint")],
  ["service has non-production dev bypass", contents.service.includes("HIVEMINDOS_PAID_AGENT_DEV_BYPASS")],
  ["service exposes runtime matrix", contents.service.includes("PAID_AGENT_RUNTIME_MATRIX")],
  ["service mirrors managed HONEY optionally", contents.service.includes("HIVEMINDOS_PAID_AGENT_MIRROR_MANAGED_HONEY")],
  ["official client uses hosted base env", contents.officialClient.includes("HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL")],
  ["official client has deployed Worker default", contents.officialClient.includes("https://hivemindos-paid-agent-gateway.hivemindos.workers.dev")],
  ["official client requires https by default", contents.officialClient.includes("must use https for official paid-agent traffic")],
  ["official client rejects local/private hosts", contents.officialClient.includes("not localhost or a private network host")],
  ["official client allowlists forwarded headers", contents.officialClient.includes("REQUEST_HEADER_ALLOWLIST")],
  ["official client does not forward authorization", !contents.officialClient.includes("\"authorization\"")],
  ["official client proxies x402 payment headers", contents.officialClient.includes("x-payment") && contents.officialClient.includes("payment-response")],
  ["route delegates to paid gateway service", contents.route.includes("processPaidAgentGatewayRequest")],
  ["route exposes readiness", contents.route.includes("getPaidAgentGatewayStatus")],
  ["official route delegates to hosted client", contents.officialRoute.includes("proxyOfficialPaidAgentRequest")],
  ["official route exposes hosted readiness", contents.officialRoute.includes("getOfficialPaidAgentStatus")],
  ["proxy self-auth allowlist exempts seller route", proxyAllowlist.includes("\"/api/paid-agents\"")],
  ["proxy self-auth allowlist exempts official seller route", proxyAllowlist.includes("\"/api/official-paid-agents\"")],
  ["context index has paid gateway capability", contents.contextIndex.includes("tool-schema:paid-agent-x402-gateway")],
  ["context index names OpenAI-compatible endpoint", contents.contextIndex.includes("/api/paid-agents/<slug>/chat/completions")],
  ["context index names official hosted endpoint", contents.contextIndex.includes("/api/official-paid-agents/<slug>/chat/completions")],
  ["context index documents testnet flag", contents.contextIndex.includes("HIVEMINDOS_PAID_AGENT_TESTNET_MODE=true")],
  ["docs describe production env", contents.docs.includes("HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED=true")],
  ["docs describe official hosted client env", contents.docs.includes("HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL=<https-hivemindos-hosted-base-url>")],
  ["docs warn not to package payTo", contents.docs.includes("Do not package an official `payTo` address")],
  ["docs name official downloaded-app route", contents.docs.includes("/api/official-paid-agents/<slug>/chat/completions")],
  ["docs publish current hosted chat price", contents.docs.includes("$0.001 per successful chat completion")],
  ["docs describe runtime policy", contents.docs.includes("Runtime policy:")],
  ["docs describe builder code attribution", contents.docs.includes("HIVEMINDOS_PAID_AGENT_BUILDER_CODE=<base-builder-code>")],
  ["docs describe CDP facilitator auth", contents.docs.includes("CDP_API_KEY_ID=<cdp-api-key-id>") && contents.docs.includes("@coinbase/x402")],
  ["docs describe testnet flag opt-in", contents.docs.includes("HIVEMINDOS_PAID_AGENT_TESTNET_MODE=true") && contents.docs.includes("disabled by default")],
  ["docs distinguish x402 from HONEY/HIVE", contents.docs.includes("x402 remains the external per-call charge")],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  console.error("Paid agent gateway checks failed:");
  for (const [label] of failures) console.error(`- ${label}`);
  process.exit(1);
}

console.log(`Paid agent gateway checks passed (${checks.length} assertions).`);
