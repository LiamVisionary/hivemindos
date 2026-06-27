#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildSmokeChecklistFromHealth } = await import("../src/lib/services/system/smoke-checklist.ts");
const { searchTroubleshootingCookbook } = await import("../src/lib/services/system/troubleshooting-cookbook.ts");
const { recommendModelFit } = await import("../src/lib/services/system/model-fit.ts");

const smoke = buildSmokeChecklistFromHealth({
  ok: true,
  status: "ok",
  generatedAt: "2026-06-16T12:00:00.000Z",
  checks: [
    { id: "dashboard-auth", label: "Dashboard auth", status: "ok", detail: "configured" },
    { id: "shared-vault", label: "Vault", status: "ok", detail: "readable" },
    { id: "shared-env", label: "Env", status: "disabled", detail: "not present" },
    { id: "project-workspace", label: "Project", status: "ok", detail: "ready" },
  ],
});
assert.equal(smoke.generatedAt, "2026-06-16T12:00:00.000Z");
assert.equal(smoke.items.find((item) => item.id === "dashboard-auth")?.status, "pass");
assert.equal(smoke.items.find((item) => item.id === "shared-env")?.status, "warn");
assert.equal(smoke.items.find((item) => item.id === "runtime-chat")?.status, "manual");
assert.equal(smoke.items.find((item) => item.id === "handoff-path")?.status, "manual");

const collectorFixes = searchTroubleshootingCookbook("collector peer link", 3);
assert.ok(collectorFixes.some((entry) => entry.id === "collector-unreachable"), "collector cookbook entry should be searchable");
assert.ok(!JSON.stringify(collectorFixes).includes("100."), "cookbook should not embed private Tailnet IPs");

const fit = recommendModelFit([
  {
    id: "big-linux",
    name: "Big Linux",
    os: "Ubuntu",
    system: { cpuCores: 32, ramTotalGb: 128, ramPct: 44 },
    capabilities: { runtimes: ["hivemind-os"] },
  },
  {
    id: "tiny",
    name: "Tiny",
    os: "linux",
    system: { cpuCores: 2, ramTotalGb: 4, ramPct: 30 },
  },
]);
assert.equal(fit[0].tier, "local-large");
assert.ok(fit[0].preferredProviders.includes("local OpenAI-compatible"));
assert.equal(fit[1].tier, "hosted-or-remote");
assert.ok(fit[1].preferredProviders.includes("Bankr LLM"));

console.log("System cockpit surface checks passed.");
