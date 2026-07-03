import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.HIVEMINDOS_TEST_BASE_URL || process.argv.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length) || "http://127.0.0.1:5033";

// Dashboard /api routes 401 tokenless since the API auth gate moved to
// src/proxy.ts (same resolution order as scripts/fleet-health-watchdog.mjs).
function envFileValue(path, key) {
  if (!existsSync(path)) return "";
  const match = readFileSync(path, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+)\\s*$`, "m"));
  let value = match?.[1]?.trim() ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value.trim();
}

const deviceToken = (
  process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || envFileValue(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  || envFileValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
).trim();

function dashboardHeaders(extra = {}) {
  return deviceToken ? { ...extra, "x-hivemindos-device-token": deviceToken } : extra;
}
const missingKeys = {
  uriEnvKey: "HIVE_TEST_NEO4J_URI_MISSING",
  usernameEnvKey: "HIVE_TEST_NEO4J_USERNAME_MISSING",
  passwordEnvKey: "HIVE_TEST_NEO4J_PASSWORD_MISSING",
  databaseEnvKey: "HIVE_TEST_NEO4J_DATABASE_MISSING",
};

const params = new URLSearchParams(missingKeys);
const statusResponse = await fetch(`${baseUrl}/api/brain/neo4j/status?${params.toString()}`, { cache: "no-store", headers: dashboardHeaders() });
const statusData = await statusResponse.json();
assert.equal(statusResponse.ok, true, statusData.error || "status route should respond without Neo4j credentials");
assert.equal(statusData.ok, true);
assert.equal(statusData.status.connected, false, "status should not connect when env keys are missing");
assert.match(statusData.status.error, /HIVE_TEST_NEO4J_URI_MISSING/);
assert.equal(statusData.status.keyStatus.HIVE_TEST_NEO4J_URI_MISSING.present, false);
assert.equal(JSON.stringify(statusData).includes("neo4j://"), false, "status response must not include raw URI values");
assert.equal(JSON.stringify(statusData).includes("password"), true, "status may include password env key name");
assert.equal(JSON.stringify(statusData).includes("secret"), false, "status response should not leak secret values");

const writeQueryResponse = await fetch(`${baseUrl}/api/brain/neo4j/query`, {
  method: "POST",
  headers: dashboardHeaders({ "content-type": "application/json" }),
  body: JSON.stringify({
    neo4j: missingKeys,
    query: "MATCH (n) CREATE (m:Bad) RETURN n",
  }),
});
const writeQueryData = await writeQueryResponse.json();
assert.equal(writeQueryResponse.status, 400, "write Cypher should be rejected before any connection attempt");
assert.equal(writeQueryData.ok, false);
assert.match(writeQueryData.error, /Only read-only Cypher/);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  assertions: {
    missingEnvStatus: true,
    secretRedaction: true,
    writeCypherRejectedBeforeConnect: true,
  },
}, null, 2));
