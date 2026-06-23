#!/usr/bin/env node
// Offline routing diagnostic: why does one agent win repeatedly? Uses the REAL
// router + REAL outcome stats + the live fleet snapshot. No LLM spend.
import { register } from "node:module";
import { readFile } from "node:fs/promises";
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { chooseQueenBeeDelegate, inferQueenBeeWorkerClass } = await import("../src/lib/services/queen-bee/router.ts");
const { readQueenBeeOutcomeStats } = await import("../src/lib/services/queen-bee/outcome-stats.ts");

const DASH = "http://127.0.0.1:5021";
const raw = await readFile(new URL("../.env.local", import.meta.url), "utf8").catch(() => "");
const TOKEN = (raw.match(/^HIVEMINDOS_DASHBOARD_DEVICE_TOKEN=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");

const res = await fetch(`${DASH}/api/fleet/discover?includeSnapshots=0&fresh=1`, { headers: { "x-hivemindos-device-token": TOKEN } });
const fleet = await res.json();
const machines = (fleet.machines || []).filter((m) => (m.device?.name || "") === "hivemindos-ubuntu-8gb-hel1-2");
const outcomes = await readQueenBeeOutcomeStats().catch(() => ({}));

console.log("Ubuntu agents:", machines.flatMap((m) => (m.agents || []).map((a) => `${a.name}[${a.id}] class=${a.workerClass}`)));
console.log("\nOutcome stats (completed/failed) for these agents:");
for (const m of machines) for (const a of m.agents || []) {
  const o = outcomes[a.id] || outcomes[a.agentId];
  if (o) console.log(`  ${a.name}: ${o.completed}/${o.completed + o.failed}`);
}

const tasks = [
  { label: "research", title: "Research", body: "Research the market landscape and compare sources.", skills: ["research"] },
  { label: "general", title: "Improve activation", body: "Propose one experiment to improve activation.", skills: [] },
  { label: "writer", title: "Write announcement", body: "Write a 3-sentence launch announcement.", skills: [] },
  { label: "code", title: "Fix bug", body: "Fix an off-by-one bug in a function and run tests.", skills: ["code"] },
];
console.log("\nRouting decisions (winner + reason):");
for (const t of tasks) {
  const cls = inferQueenBeeWorkerClass(t);
  const d = chooseQueenBeeDelegate(t, machines, { outcomes });
  console.log(`\n[${t.label}] inferred=${cls} -> ${d.agent?.name} (score ${d.score})`);
  console.log(`   reason: ${d.reason}`);
}
