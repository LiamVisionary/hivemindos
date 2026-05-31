#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const nextArgs = [];
let port = process.env.PORT || "5020";
let hostname = process.env.HIVEMINDOS_DASHBOARD_HOST || "127.0.0.1";
const rawBundler = (process.env.HIVEMINDOS_NEXT_DEV_BUNDLER || process.env.NEXT_DEV_BUNDLER || "webpack").trim().toLowerCase();

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];

  if ((arg === "-p" || arg === "--port") && args[i + 1]) {
    port = args[i + 1];
    i += 1;
    continue;
  }

  if (arg.startsWith("--port=")) {
    port = arg.slice("--port=".length);
    continue;
  }

  if (/^-p\d+$/.test(arg)) {
    port = arg.slice(2);
    continue;
  }

  if ((arg === "-H" || arg === "--hostname") && args[i + 1]) {
    hostname = args[i + 1];
    i += 1;
    continue;
  }

  if (arg.startsWith("--hostname=")) {
    hostname = arg.slice("--hostname=".length);
    continue;
  }

  nextArgs.push(arg);
}

const hasBundlerFlag = nextArgs.some((arg) => arg === "--webpack" || arg === "--turbo" || arg === "--turbopack");
const hasSourceMapFlag = nextArgs.includes("--disable-source-maps");
const bundlerArgs = (() => {
  if (hasBundlerFlag) return [];
  if (rawBundler === "webpack") return ["--webpack"];
  if (rawBundler === "turbo" || rawBundler === "turbopack") return ["--turbo"];
  console.warn(`Unknown HIVEMINDOS_NEXT_DEV_BUNDLER/NEXT_DEV_BUNDLER value "${rawBundler}"; using webpack.`);
  return ["--webpack"];
})();
const sourceMapArgs = process.env.NEXT_DEV_SOURCE_MAPS === "1" || hasSourceMapFlag ? [] : ["--disable-source-maps"];

const command = "scripts/run-with-memory-limit.sh";
const nodeOptionSet = new Set((process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean));
if (process.env.NEXT_DEV_EXPOSE_GC !== "0") {
  nodeOptionSet.add("--expose-gc");
}
const maxOldSpaceMb = process.env.NEXT_DEV_MAX_OLD_SPACE_MB ?? "3072";
if (maxOldSpaceMb !== "0" && ![...nodeOptionSet].some((option) => option.startsWith("--max-old-space-size="))) {
  nodeOptionSet.add(`--max-old-space-size=${maxOldSpaceMb}`);
}
const nodeOptions = [...nodeOptionSet].join(" ");
const commandArgs = [
  "--limit-mb",
  process.env.MEMORY_LIMIT_MB || "5000",
  "--",
  "pnpm",
  "exec",
  "next",
  "dev",
  ...bundlerArgs,
  ...sourceMapArgs,
  "-p",
  port,
  "-H",
  hostname,
  ...nextArgs,
];

const child = spawn(command, commandArgs, {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
