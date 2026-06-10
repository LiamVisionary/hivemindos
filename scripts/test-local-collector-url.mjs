import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function has(text, needle, label) {
  assert.ok(text.includes(needle), label);
}

const resolver = await source("src/lib/services/local-collector-url.ts");
has(resolver, "export async function canonicalLocalCollectorUrl", "local collector resolver exports canonical URL helper");
has(resolver, "export function remoteCollectorLocalServiceUrl", "local collector resolver exports remote local-service proxy helper");
has(resolver, "/app-proxy/${port}", "remote local-service proxy helper routes loopback app ports through the collector proxy");
has(resolver, "AGENT_TELEMETRY_PORT", "local collector resolver reads active collector port");
has(resolver, "parsed.pathname.startsWith(\"/peer/\")", "local collector resolver preserves Link peer URLs");
has(resolver, "localInterfaceHosts().has(host)", "local collector resolver rewrites only local interfaces");

const snapshotRoute = await source("src/app/api/fleet/snapshot/route.ts");
has(snapshotRoute, "canonicalLocalCollectorUrl", "fleet snapshot route canonicalizes collector URLs");
has(snapshotRoute, "const baseUrl = await collectorUrlForSnapshot(agent)", "fleet snapshot awaits dynamic collector URL resolution");

const chatRoute = await source("src/app/api/chat/agent-runtime/route.ts");
has(chatRoute, "@/lib/services/local-collector-url", "chat runtime uses shared collector URL resolver");
has(chatRoute, "remoteCollectorLocalServiceUrl(profile", "OpenAI-compatible chat URLs proxy remote loopback runtimes through collectors");
assert.equal(
  /function canonicalLocalCollectorUrl/.test(chatRoute),
  false,
  "chat runtime must not keep a private collector URL resolver",
);

for (const path of [
  "src/app/api/chat/agent-session/route.ts",
  "src/app/api/scheduler/import/route.ts",
  "src/app/api/runtimes/[runtime]/integrations/route.ts",
  "src/app/api/handoff/route.ts",
]) {
  const text = await source(path);
  has(text, "canonicalLocalCollectorUrl", `${path} canonicalizes collector URLs`);
}

console.log("Local collector URL regression checks passed.");
