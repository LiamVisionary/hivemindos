#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const nextArgs = [];
let port = process.env.PORT || "5020";
let hostname = process.env.HIVEMINDOS_DASHBOARD_HOST || "127.0.0.1";
// Default dev to Turbopack. On this app (243 routes, 4755-line DashboardApp)
// webpack dev compiles route module-graphs on demand and holds them in the Node
// heap (multi-GB RSS), which is slow AND tripped the memory cap below. Turbopack
// compiles in a native engine: ~290ms ready, ~40MB Node RSS, far faster route
// loads + HMR. Set HIVEMINDOS_NEXT_DEV_BUNDLER=webpack to fall back.
const rawBundler = (process.env.HIVEMINDOS_NEXT_DEV_BUNDLER || process.env.NEXT_DEV_BUNDLER || "turbopack").trim().toLowerCase();

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

const nodeOptionSet = new Set((process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean));
if (process.env.NEXT_DEV_EXPOSE_GC !== "0") {
  nodeOptionSet.add("--expose-gc");
}
const maxOldSpaceMb = process.env.NEXT_DEV_MAX_OLD_SPACE_MB ?? "3072";
if (maxOldSpaceMb !== "0" && ![...nodeOptionSet].some((option) => option.startsWith("--max-old-space-size="))) {
  nodeOptionSet.add(`--max-old-space-size=${maxOldSpaceMb}`);
}
const nodeOptions = [...nodeOptionSet].join(" ");

const nextDevArgs = [
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
// The OOM guard belongs to the *production* build (package.json `build` wraps
// `next build` in run-with-memory-limit.sh). DEV does not need it and it actively
// caused the misery: under webpack the dev process grew past the 5 GB RSS cap, got
// killed mid-session, and was respawned into a full cold recompile ("always
// recompiling" / stuck on the loading screen). Under Turbopack the Node process is
// ~40 MB, so a cap is pointless. The dev memory cap is therefore OFF by default;
// set MEMORY_LIMIT_MB=<mb> to opt back into the kill+respawn behavior.
const rawMemoryLimitMb = (process.env.MEMORY_LIMIT_MB ?? "").trim();
const memoryCapEnabled = /^\d+$/.test(rawMemoryLimitMb) && Number(rawMemoryLimitMb) > 0;
const command = memoryCapEnabled ? "scripts/run-with-memory-limit.sh" : "pnpm";
const commandArgs = memoryCapEnabled
  ? ["--limit-mb", rawMemoryLimitMb, "--", "pnpm", ...nextDevArgs]
  : nextDevArgs;

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
// API routes use OPTIONS to load (compile) the module without running an
// exported handler. Page routes use HEAD because Next pages reject OPTIONS.
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
    "/stake",
    "/api/chat/agent-runtime",
    "/api/chat/image-generation",
    "/api/queen-bee/chat",
    "/api/queen-bee/voice",
  );
}
// Re-ping cadence. Entry disposal is a WEBPACK dev behavior (onDemandEntries
// evicts idle routes, so warmth decays); Turbopack keeps compiled modules for
// the life of the process, so one warm pass after each (re)spawn suffices and
// the perpetual 20s re-ping — a full /stake SSR plus three middleware runs,
// forever — is pure background load on the single dev-server process. 0 = warm
// once per spawn, no re-ping.
const usingWebpack = bundlerArgs.includes("--webpack") || nextArgs.includes("--webpack");
const WARM_INTERVAL_MS = Number(
  process.env.HIVEMINDOS_DEV_WARM_INTERVAL_MS ?? (usingWebpack ? 20_000 : 0),
);
const WARM_STARTUP_RETRY_MS = 3_000;
const WARM_STARTUP_RETRY_LIMIT = 100;
let warmedSinceSpawn = false;
let warmStartupAttempts = 0;
let warmInFlight = false;

// The API auth gate (src/proxy.ts) 401s tokenless /api requests BEFORE the
// route module loads, which both fails the ok-check and defeats the warmup.
// Same token resolution order as scripts/fleet-health-watchdog.mjs.
function warmEnvFileValue(path, key) {
  if (!existsSync(path)) return "";
  const match = readFileSync(path, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+)\\s*$`, "m"));
  let value = match?.[1]?.trim() ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value.trim();
}

function warmDeviceToken() {
  return (
    process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
    || warmEnvFileValue(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
    || warmEnvFileValue(join(homedir(), ".hivemindos", ".env"), "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN")
  ).trim();
}

async function warmRoutesOnce() {
  if (!warmRoutes.length || warmInFlight) return false;
  warmInFlight = true;
  const token = warmDeviceToken();
  let allOk = true;
  try {
    for (const route of warmRoutes) {
      try {
        const response = await fetch(`http://${warmHost}:${port}${route}`, {
          method: route.startsWith("/api/") ? "OPTIONS" : "HEAD",
          headers: token ? { "x-hivemindos-device-token": token } : undefined,
          signal: AbortSignal.timeout(90_000),
        });
        if (!response.ok) allOk = false;
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
      console.log(
        WARM_INTERVAL_MS > 0
          ? `Dev warm-keeper compiled ${warmRoutes.length} route(s); re-pinging every ${WARM_INTERVAL_MS / 1000}s.`
          : `Dev warm-keeper compiled ${warmRoutes.length} route(s); no re-ping needed under turbopack.`,
      );
      return;
    }
    if (warmStartupAttempts < WARM_STARTUP_RETRY_LIMIT) {
      setTimeout(startupTick, WARM_STARTUP_RETRY_MS).unref();
    }
  };
  if (warmRoutes.length) setTimeout(startupTick, WARM_STARTUP_RETRY_MS).unref();
}

if (warmRoutes.length && WARM_INTERVAL_MS > 0) {
  setInterval(() => {
    if (warmedSinceSpawn) void warmRoutesOnce();
  }, WARM_INTERVAL_MS).unref();
}

spawnNextDev();
