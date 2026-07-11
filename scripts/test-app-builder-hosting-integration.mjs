#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const paths = {
  client: "src/lib/services/app-hosting.ts",
  route: "src/app/api/app-builder/route.ts",
  action: "src/lib/services/hive-actions/app-builder.ts",
  mcp: "scripts/hivemind-mcp",
  types: "src/lib/types/gitlawb.ts",
};

assert.equal(existsSync(paths.client), true, "the official app-hosting client must exist");
const source = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readFileSync(path, "utf8")]));

assert.match(source.client, /https:\/\/hivemindos-app-hosting\.hivemindos\.workers\.dev/);
assert.match(source.client, /resolvePooledHivemindosModelCreditToken/);
assert.match(source.client, /x-hivemindos-credit-token/);
assert.doesNotMatch(source.client, /priceUsd\s*:\s*[0-9]/);
assert.doesNotMatch(source.client, /CLOUDFLARE_API_TOKEN|STRIPE_SECRET|payTo/);

for (const action of ["test_deploy", "hosting_catalog", "hosting_list", "hosting_get", "hosting_publish", "hosting_renew", "hosting_unpublish"]) {
  assert.match(source.action, new RegExp(`"${action}"`), `Hive Action is missing ${action}`);
}
assert.match(source.route, /publishHostedApp/);
assert.match(source.route, /prepareManagedCloudAppArtifact/);
assert.match(source.route, /APP_BUILDER_CONFIRMATIONS\.publishHosting/);
assert.match(source.mcp, /hosting_publish: APP_BUILDER_CONFIRMATIONS\.publishHosting/);
assert.match(source.mcp, /test_deploy: APP_BUILDER_CONFIRMATIONS\.temporaryDeploy/);
assert.match(source.types, /hostingSiteId\?: string/);
assert.match(source.types, /hostingUrl\?: string/);

console.log("App Builder exposes temporary and paid hosting through one confirmation-gated agent surface.");
