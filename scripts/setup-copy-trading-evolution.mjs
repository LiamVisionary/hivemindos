#!/usr/bin/env node
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

if (!process.argv.includes("--apply")) {
  console.error("Pass --apply to create one agent-analyzed twin for each original copy-trading config.");
  process.exit(1);
}

const { createEvolvedConfig, readConfigs } = await import("../src/lib/services/copy-trading/store.ts");
const configs = await readConfigs();
const originals = configs.filter((config) => !config.evolution);
const created = [];
for (const source of originals) {
  const id = `cte_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const evolved = await createEvolvedConfig(source.id, id);
  created.push({ sourceConfigId: source.id, evolvedConfigId: evolved.id, label: evolved.label, enabled: evolved.enabled, dryRun: evolved.dryRun });
}
console.log(JSON.stringify({ ok: true, pairs: created }, null, 2));
