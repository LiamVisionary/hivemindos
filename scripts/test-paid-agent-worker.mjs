#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);

const files = {
  appGateway: "src/lib/services/paid-agent-gateway.ts",
  officialClient: "src/lib/services/paid-agent-cloud-client.ts",
  boundary: "workers/README.md",
  docs: "docs/for-users/features/wallets-honey-and-x402.md",
  gitignore: ".gitignore",
  packageJson: "package.json",
};

const contents = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, path]) => [
    key,
    await readFile(new URL(path, ROOT), "utf8"),
  ])),
);

assert.equal(
  existsSync(new URL("workers/paid-agent-gateway/src/index.ts", ROOT)),
  false,
  "official paid-agent Worker source should stay out of the public repo",
);

assert.match(contents.boundary, /Hosted Service Boundary/);
assert.match(contents.boundary, /not distributed from this public repository/);
assert.match(contents.boundary, /official paid-agent gateway/);
assert.match(contents.gitignore, /workers\/\*/);
assert.match(contents.gitignore, /!workers\/README\.md/);

assert.match(contents.officialClient, /DEFAULT_OFFICIAL_PAID_AGENT_BASE_URL/);
assert.match(contents.officialClient, /https:\/\/hivemindos-paid-agent-gateway\.hivemindos\.workers\.dev/);
assert.match(contents.officialClient, /official-hosted-client/);
assert.match(contents.officialClient, /must call a hosted HivemindOS paid-agent resource server/);

assert.match(contents.appGateway, /HIVEMINDOS_PAID_AGENT_SELLER_MODE/);
assert.match(contents.appGateway, /self-hosted/);
assert.match(contents.appGateway, /x402ResourceServer/);
assert.match(contents.appGateway, /registerExactEvmScheme/);
assert.match(contents.appGateway, /declareBuilderCodeExtension/);
assert.match(contents.appGateway, /HIVEMINDOS_PAID_AGENT_PAY_TO/);

assert.match(contents.packageJson, /"@coinbase\/x402"/);
assert.match(contents.packageJson, /"@x402\/core"/);
assert.match(contents.packageJson, /"@x402\/evm"/);
assert.match(contents.packageJson, /"@x402\/extensions"/);

assert.match(contents.docs, /Official downloaded-app setup is intentionally light/);
assert.match(contents.docs, /HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL/);
assert.match(contents.docs, /official hosted paid-agent gateway/);
assert.doesNotMatch(contents.docs, /workers\/paid-agent-gateway/);

console.log("Paid-agent public/private boundary checks passed.");
