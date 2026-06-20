import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);

const files = {
  worker: "workers/paid-agent-gateway/src/index.ts",
  packageJson: "workers/paid-agent-gateway/package.json",
  wrangler: "workers/paid-agent-gateway/wrangler.jsonc",
  schema: "workers/paid-agent-gateway/schema.sql",
  readme: "workers/paid-agent-gateway/README.md",
  docs: "docs/features/wallets-honey-and-x402.md",
};

const contents = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, path]) => [
    key,
    await readFile(new URL(path, ROOT), "utf8"),
  ])),
);

const checks = [
  ["worker imports x402 resource server", contents.worker.includes("x402ResourceServer")],
  ["worker registers exact evm scheme", contents.worker.includes("registerExactEvmScheme")],
  ["worker settles only after upstream response", contents.worker.includes("settlePayment(payment, upstream.body")],
  ["worker cancels verified payment on upstream failure", contents.worker.includes("cancelVerifiedPayment(payment")],
  ["worker requires payTo env", contents.worker.includes("HIVEMINDOS_PAID_AGENT_PAY_TO")],
  ["worker requires upstream env", contents.worker.includes("HIVEMINDOS_PAID_AGENT_UPSTREAM_URL")],
  ["worker stores idempotency receipts", contents.worker.includes("findReceiptByIdempotencyKey")],
  ["worker does not forward payment headers upstream", !contents.worker.includes("payment-signature\", \"x-payment")],
  ["package declares x402 deps", contents.packageJson.includes("\"@x402/core\"") && contents.packageJson.includes("\"@x402/evm\"")],
  ["wrangler uses node compatibility", contents.wrangler.includes("\"nodejs_compat\"")],
  ["wrangler declares d1 binding", contents.wrangler.includes("\"binding\": \"DB\"")],
  ["schema stores paid receipts", contents.schema.includes("paid_agent_receipts")],
  ["schema has idempotency unique index", contents.schema.includes("idx_paid_agent_receipts_slug_idempotency_key")],
  ["readme documents deploy", contents.readme.includes("pnpm d1:create") && contents.readme.includes("pnpm deploy")],
  ["readme names downloaded app base url", contents.readme.includes("HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL")],
  ["docs mention worker path", contents.docs.includes("workers/paid-agent-gateway")],
];

const failures = checks.filter(([, passed]) => !passed);
if (failures.length) {
  console.error("Paid agent Worker checks failed:");
  for (const [label] of failures) console.error(`- ${label}`);
  process.exit(1);
}

console.log(`Paid agent Worker checks passed (${checks.length} assertions).`);
