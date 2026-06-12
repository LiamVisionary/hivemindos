#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";

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

// run-with-memory-limit.sh exits 137 after killing a Next dev server that
// crossed the memory cap. Respawning here (instead of letting the whole dev
// stack die) keeps the Tauri proxy and webview alive through the restart;
// the warm-keeper below then recompiles the heavy routes before the next
// user request has to pay for them.
const MEMORY_KILL_EXIT_CODE = 137;
const RESPAWN_WINDOW_MS = 10 * 60_000;
const MAX_RESPAWNS_PER_WINDOW = 5;
let respawnTimestamps = [];
let child = null;

function spawnNextDev() {
  child = spawn(command, commandArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
    },
  });
  child.on("exit", handleChildExit);
  kickWarmKeeper();
}

function handleChildExit(code, signal) {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code === MEMORY_KILL_EXIT_CODE) {
    const now = Date.now();
    respawnTimestamps = respawnTimestamps.filter((at) => now - at < RESPAWN_WINDOW_MS);
    if (respawnTimestamps.length < MAX_RESPAWNS_PER_WINDOW) {
      respawnTimestamps.push(now);
      console.warn(
        `Next dev exceeded the memory limit and was killed (exit ${code}); restarting it in place (${respawnTimestamps.length}/${MAX_RESPAWNS_PER_WINDOW} in the last ${RESPAWN_WINDOW_MS / 60000} min).`,
      );
      // A straggler from the killed tree can hold the port for a moment;
      // spawning into that races into EADDRINUSE and kills the whole stack.
      void waitForPortFree(Number(port), hostname).then((free) => {
        if (!free) {
          console.warn(`Port ${port} is still in use after the memory kill; starting Next dev anyway.`);
        }
        spawnNextDev();
      });
      return;
    }
    console.error(
      `Next dev hit the memory limit ${MAX_RESPAWNS_PER_WINDOW} times within ${RESPAWN_WINDOW_MS / 60000} minutes; exiting instead of looping.`,
    );
  }
  process.exit(code ?? 0);
}

function portFree(checkPort, host) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(checkPort, host);
  });
}

async function waitForPortFree(checkPort, host, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portFree(checkPort, host)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Warm-keeper: Next dev (webpack) compiles routes on demand and disposes
// inactive entries, so the first chat message after an idle stretch or a
// restart used to stall ~15s behind a recompile of the agent-runtime route.
// OPTIONS requests load (compile) a route module without running any
// exported handler, so pinging the heavy routes keeps them permanently warm.
const warmHost = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
const warmRoutesRaw = process.env.HIVEMINDOS_DEV_WARM_ROUTES;
const warmRoutes = warmRoutesRaw === "0"
  ? []
  : (warmRoutesRaw ?? "")
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean);
if (!warmRoutes.length && warmRoutesRaw !== "0") {
  warmRoutes.push(
    "/api/chat/agent-runtime",
    "/api/chat/image-generation",
    "/api/queen-bee/voice",
  );
}
const WARM_INTERVAL_MS = 20_000;
const WARM_STARTUP_RETRY_MS = 3_000;
const WARM_STARTUP_RETRY_LIMIT = 100;
let warmedSinceSpawn = false;
let warmStartupAttempts = 0;
let warmInFlight = false;

async function warmRoutesOnce() {
  if (!warmRoutes.length || warmInFlight) return false;
  warmInFlight = true;
  let allOk = true;
  try {
    for (const route of warmRoutes) {
      try {
        await fetch(`http://${warmHost}:${port}${route}`, {
          method: "OPTIONS",
          signal: AbortSignal.timeout(90_000),
        });
      } catch {
        allOk = false;
      }
    }
  } finally {
    warmInFlight = false;
  }
  return allOk;
}

function kickWarmKeeper() {
  warmedSinceSpawn = false;
  warmStartupAttempts = 0;
  const startupTick = async () => {
    if (warmedSinceSpawn) return;
    warmStartupAttempts += 1;
    if (await warmRoutesOnce()) {
      warmedSinceSpawn = true;
      console.log(`Dev warm-keeper compiled ${warmRoutes.length} route(s); re-pinging every ${WARM_INTERVAL_MS / 1000}s.`);
      return;
    }
    if (warmStartupAttempts < WARM_STARTUP_RETRY_LIMIT) {
      setTimeout(startupTick, WARM_STARTUP_RETRY_MS).unref();
    }
  };
  if (warmRoutes.length) setTimeout(startupTick, WARM_STARTUP_RETRY_MS).unref();
}

if (warmRoutes.length) {
  setInterval(() => {
    if (warmedSinceSpawn) void warmRoutesOnce();
  }, WARM_INTERVAL_MS).unref();
}

spawnNextDev();
