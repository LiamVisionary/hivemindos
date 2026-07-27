#!/usr/bin/env node
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { compareCopyTradeEvolution } = await import("../src/lib/services/copy-trading/evolution.ts");

const args = parseArgs(process.argv.slice(2));
const configPath = process.env.COPY_TRADING_CONFIG_FILE || join(homedir(), ".hivemindos", "copy-trading.json");
const statePath = process.env.COPY_TRADING_STATE_FILE || join(homedir(), ".hivemindos", "copy-trading-state.json");
const startedAt = new Date().toISOString();
const [configFile, stateFile] = await Promise.all([readJson(configPath), readJson(statePath)]);
const configs = Array.isArray(configFile?.configs) ? configFile.configs : [];
const states = stateFile?.states && typeof stateFile.states === "object" ? stateFile.states : {};
const evolvedConfigs = configs.filter((config) => config?.evolution?.sourceConfigId);

const tasks = {};
const details = evolvedConfigs.map((config) => {
  const sourceConfigId = config.evolution.sourceConfigId;
  const comparison = compareCopyTradeEvolution(states[config.id], states[sourceConfigId]);
  const score = comparison.promotion.score;
  tasks[config.id] = score;
  return {
    evolvedConfigId: config.id,
    sourceConfigId,
    label: config.label || config.id,
    score,
    ...comparison,
  };
});

const ready = details.filter((detail) => detail.promotion.status === "eligible");
if (args.gate && (details.length === 0 || ready.length !== details.length)) {
  console.error(`Copy-trading EVO requires every pair to pass 200 matured cost-aware outcomes, a frozen 50-trade holdout, a positive 95% confidence edge, no worse drawdown, and at most 5% review failures (${ready.length}/${details.length} eligible).`);
  process.exit(1);
}

const score = ready.length
  ? ready.reduce((sum, detail) => sum + detail.score, 0) / ready.length
  : 0;
const result = {
  score,
  tasks,
  details,
  promotion_gate: {
    min_matured_per_pair: 200,
    holdout_trades_per_pair: 50,
    eligible_pairs: ready.length,
    total_pairs: details.length,
  },
  started_at: startedAt,
  ended_at: new Date().toISOString(),
};

await writeEvoResult(result);
if (!process.env.EVO_RESULT_PATH) console.log(JSON.stringify(result, null, 2));

function parseArgs(argv) {
  return { gate: argv.includes("--gate") };
}

async function readJson(path) {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeEvoResult(result) {
  const resultPath = process.env.EVO_RESULT_PATH;
  if (!resultPath) return;
  await mkdir(dirname(resultPath), { recursive: true });
  const handle = await open(resultPath, "wx");
  await handle.close();
  await writeFile(`${resultPath}.tmp`, JSON.stringify(result, null, 2), "utf8");
  await rename(`${resultPath}.tmp`, resultPath);
}
