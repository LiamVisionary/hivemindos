#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  CONNECTOR_MANIFESTS,
  CONNECTOR_MANIFESTS_BY_KEY,
} = await import("../src/lib/services/integrations/connector-manifests.ts");
const { connectionProvider } = await import("../src/lib/services/integrations/provider-connections.ts");

assert.ok(CONNECTOR_MANIFESTS.length >= 8, "Expected the first-class connector manifest list.");
for (const manifest of CONNECTOR_MANIFESTS) {
  assert.equal(CONNECTOR_MANIFESTS_BY_KEY[manifest.key], manifest);
  assert.ok(manifest.auth.tokenEnvKey, `${manifest.key} should name its credential env key.`);
  assert.ok(manifest.operations.some((operation) => operation.id === "connection-status"), `${manifest.key} should expose deterministic status.`);
  assert.ok(manifest.operations.every((operation) => Array.isArray(operation.sideEffects) && operation.risk), `${manifest.key} operations need policy metadata.`);
  const provider = connectionProvider(manifest.key);
  assert.ok(provider, `Provider ${manifest.key} should derive from connector manifests.`);
  assert.equal(provider.label, manifest.label);
  assert.equal(provider.auth.tokenEnvKey, manifest.auth.tokenEnvKey);
}

const googleCloud = CONNECTOR_MANIFESTS_BY_KEY["google-cloud"];
assert.ok(googleCloud.auth.oauthClientEnvKeys?.includes("GOOGLE_CLOUD_OAUTH_CLIENT_ID"));
assert.ok(googleCloud.auth.oauthClientEnvKeys?.includes("GOOGLE_CLOUD_OAUTH_CLIENT_SECRET"));

console.log("Connector manifest tests passed.");
