#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [client, service, domain, route, catalog, hostedActions, context, manifest, gate] = await Promise.all([
  readFile(new URL("src/lib/services/paid-agent-cloud-client.ts", root), "utf8"),
  readFile(new URL("src/lib/services/hosted-media-generation.ts", root), "utf8"),
  readFile(new URL("src/lib/services/hosted-media-generation-domain.ts", root), "utf8"),
  readFile(new URL("src/app/api/hivemindos/media/route.ts", root), "utf8"),
  readFile(new URL("src/lib/services/hive-actions/catalog.ts", root), "utf8"),
  readFile(new URL("src/lib/services/hive-actions/hosted-media.ts", root), "utf8"),
  readFile(new URL("src/lib/services/context-index.ts", root), "utf8"),
  readFile(new URL("package.json", root), "utf8"),
  readFile(new URL("scripts/test-gate.mjs", root), "utf8"),
]);

assert.match(client, /managedMediaBaseUrl/);
assert.match(service, /resolvePooledHivemindosModelCreditToken/);
assert.match(service, /x-hivemindos-credit-token/i);
assert.doesNotMatch(service, /MUAPI_API_KEY/);
assert.match(service, /evaluateSpend/);
assert.match(service, /kind:\s*"api"/);
assert.match(service, /approvalToken/);
assert.match(domain, /maximumDebitUsd/);
assert.match(route, /okJson/);
assert.match(route, /errorJson/);
assert.match(route, /quoteHostedMedia/);
assert.match(route, /generateHostedMedia/);
assert.match(route, /getHostedMediaJob/);
assert.match(catalog, /hostedMediaCatalogAction/);
assert.match(hostedActions, /hosted[- ]media/i);
assert.match(hostedActions, /HivemindOS credits/i);
assert.match(context, /hiveActionContextIndexItems/);
assert.match(manifest, /"test:hosted-media-generation"/);
assert.match(gate, /"test:hosted-media-generation"/);

console.log("Hosted media generation static checks passed.");
