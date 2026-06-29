#!/usr/bin/env node
// Fleet health watchdog.
//
// From this machine, probe every connected HivemindOS machine's agent collector
// AND its Universal TTS server, and force-restart whichever is FUNCTIONALLY down
// via the hive-native linkd shell — covering the failure launchd KeepAlive /
// systemd Restart cannot: the daemon is alive but broken (e.g. `spawn EBADF`, a
// wedged event loop), or a prolonged outage. Collector and TTS are tracked
// separately, so a TTS flap restarts only the TTS daemon (and vice versa). No
// SSH, and no pinned tailnet IPs (machines are rediscovered each cycle, so
// addresses can change freely).
//
// Liveness uses the collector's /health; a DEEP probe (an actual /chat dispatch)
// runs every Nth cycle to catch the alive-but-can't-spawn case. After
// FAIL_THRESHOLD consecutive failures it kickstarts the collector service on the
// target (launchctl on macOS, systemctl on Linux), then cools down to avoid
// restart storms.
//
// Env knobs (all optional):
//   FLEET_WATCHDOG_POLL_MS         cycle interval (default 60000)
//   FLEET_WATCHDOG_FAIL_THRESHOLD  consecutive failures before remediation (default 3)
//   FLEET_WATCHDOG_COOLDOWN_MS     min gap between remediations per machine (default 300000)
//   FLEET_WATCHDOG_CHAT_EVERY      run the deep /chat probe every Nth cycle (default 5)
//   FLEET_WATCHDOG_APP_PORTS       local dashboard ports to try for discovery (default 5020,5021,5111,5121,3000)
//   FLEET_WATCHDOG_ONCE=1          run a single cycle and exit (for testing)

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const POLL_MS = Number(process.env.FLEET_WATCHDOG_POLL_MS || 60_000);
const FAIL_THRESHOLD = Number(process.env.FLEET_WATCHDOG_FAIL_THRESHOLD || 3);
const COOLDOWN_MS = Number(process.env.FLEET_WATCHDOG_COOLDOWN_MS || 300_000);
const CHAT_EVERY = Math.max(1, Number(process.env.FLEET_WATCHDOG_CHAT_EVERY || 15));
// Deep TTS synth probe: generous timeout so a cold model LOAD (slow but real) is
// not mistaken for a wedged backend — we judge by the result (real PCM bytes),
// not by latency. A small/fast model keeps the probe cheap.
const TTS_DEEP_TIMEOUT_MS = Number(process.env.FLEET_WATCHDOG_TTS_DEEP_TIMEOUT_MS || 60_000);
const TTS_PROBE_MODEL = process.env.FLEET_WATCHDOG_TTS_MODEL || "chatterbox-turbo";
const TTS_PROBE_VOICE = process.env.FLEET_WATCHDOG_TTS_VOICE || "voice01";
const TTS_MIN_PCM_BYTES = 2_000;
const APP_PORTS = String(process.env.FLEET_WATCHDOG_APP_PORTS || "5020,5021,5111,5121,3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const RUN_ONCE = process.env.FLEET_WATCHDOG_ONCE === "1";

const STATE_DIR = join(homedir(), ".hivemindos");
const MACHINES_CACHE = join(STATE_DIR, "fleet-health-watchdog-machines.json");
const TTS_CACHE = join(STATE_DIR, "fleet-health-watchdog-tts.json");
const LOG_PATH = join(STATE_DIR, "fleet-health-watchdog.log");
const SHELL_SESSION = "fleet-health-watchdog";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await appendFile(LOG_PATH, line);
  } catch {
    // logging must never crash the watchdog
  }
}

async function fetchJson(url, init, timeoutMs) {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text().catch(() => "");
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  return { ok: response.ok, status: response.status, data, text };
}

// Rediscover the fleet each cycle from the local dashboard (no pinned IPs). Falls
// back to the last good list so a closed dashboard doesn't blind the watchdog.
async function discoverMachines() {
  for (const port of APP_PORTS) {
    try {
      const { ok, data } = await fetchJson(`http://127.0.0.1:${port}/api/fleet/discover`, {}, 8_000);
      if (!ok) continue;
      const raw = data.machines || data.result?.machines || [];
      const machines = raw
        .map((m) => ({
          name: m.device?.name || m.name || m.key || "machine",
          self: Boolean(m.self || m.device?.self),
          online: (m.device?.online ?? m.online) !== false,
          os: String(m.device?.os || m.os || "").toLowerCase(),
          collectorUrl: String(m.device?.collectorUrl || m.collectorUrl || "").trim().replace(/\/+$/, ""),
        }))
        .filter((m) => m.collectorUrl && !m.self && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(m.collectorUrl));
      if (machines.length) {
        await writeFile(MACHINES_CACHE, JSON.stringify(machines)).catch(() => {});
        return machines;
      }
    } catch {
      // try the next port
    }
  }
  try {
    return JSON.parse(await readFile(MACHINES_CACHE, "utf8"));
  } catch {
    return [];
  }
}

// TTS apps live behind each machine's linkd at /app-proxy/8799. Discover the
// remote ones (their `machineBase` is the linkd base — strip the /app-proxy
// suffix — used to kickstart the TTS service on the owning machine).
async function discoverTtsApps() {
  for (const port of APP_PORTS) {
    try {
      const { ok, data } = await fetchJson(`http://127.0.0.1:${port}/api/fleet/apps?fast=1`, {}, 8_000);
      if (!ok) continue;
      const apps = (data.apps || [])
        .filter((a) => Number(a.port) === 8799 || /universal.?tts/i.test(String(a.name || "")))
        .map((a) => {
          const apiBaseUrl = String(a.apiBaseUrl || "").trim().replace(/\/+$/, "");
          return { apiBaseUrl, machineBase: apiBaseUrl.replace(/\/app-proxy\/.*$/, ""), machineName: a.machineName || a.name || "TTS" };
        })
        .filter((a) => a.apiBaseUrl && a.machineBase && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(a.machineBase));
      if (apps.length) {
        await writeFile(TTS_CACHE, JSON.stringify(apps)).catch(() => {});
        return apps;
      }
    } catch {
      // try the next port
    }
  }
  try {
    return JSON.parse(await readFile(TTS_CACHE, "utf8"));
  } catch {
    return [];
  }
}

// TTS health. Cheap (every cycle): /v1/models reachable + populated — it fails
// (proxy EOF / connection refused) when the app + its linkd proxy are down (the
// flapping/down case that broke voice). (/v1/voices 307-redirects through the
// app-proxy, so it's unusable as a probe.) Deep (every Nth cycle): actually
// synthesize a tiny clip — this catches frontend-up but model-backend-WEDGED,
// where /v1/models still returns the static catalog. Judged by result bytes
// under a generous timeout so a cold model load (slow but real) passes.
async function probeTts(apiBaseUrl, deep) {
  try {
    const res = await fetchJson(`${apiBaseUrl}/v1/models`, {}, 10_000);
    if (!res.ok) return { healthy: false, reason: `models HTTP ${res.status} ${String(res.text).slice(0, 50)}` };
    const models = res.data?.data || res.data?.models || [];
    if (!Array.isArray(models) || models.length === 0) return { healthy: false, reason: "models empty" };
  } catch (error) {
    return { healthy: false, reason: `models unreachable: ${error.message}` };
  }
  if (!deep) return { healthy: true };
  try {
    const response = await fetch(`${apiBaseUrl}/v1/audio/speech-stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: TTS_PROBE_MODEL, voice: TTS_PROBE_VOICE, input: "ok", response_format: "pcm", sample_rate: 24_000, realtime_pacing: false }),
      cache: "no-store",
      signal: AbortSignal.timeout(TTS_DEEP_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { healthy: false, reason: `synth HTTP ${response.status} ${text.slice(0, 50)}` };
    }
    const bytes = (await response.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
    // A working synth returns real PCM; a wedged backend returns a tiny proxy-error blob.
    if (bytes < TTS_MIN_PCM_BYTES) return { healthy: false, reason: `synth returned ${bytes}B (backend wedged)` };
  } catch (error) {
    return { healthy: false, reason: `synth failed: ${error.message}` };
  }
  return { healthy: true };
}

async function probeCollector(collectorUrl, deep) {
  try {
    const health = await fetchJson(`${collectorUrl}/health`, {}, 8_000);
    if (!health.ok || health.data?.ok === false) {
      return { healthy: false, reason: `health HTTP ${health.status} ${String(health.text).slice(0, 60)}` };
    }
  } catch (error) {
    return { healthy: false, reason: `health unreachable: ${error.message}` };
  }
  if (!deep) return { healthy: true };
  try {
    const chat = await fetchJson(`${collectorUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "reply with the single word OK", stream: false, agent: { name: "Hermes", runtime: "hermes" } }),
    }, 30_000);
    if (!chat.ok || chat.data?.ok === false) {
      return { healthy: false, reason: `chat HTTP ${chat.status} ${String(chat.data?.error || chat.text).slice(0, 80)}` };
    }
  } catch (error) {
    return { healthy: false, reason: `chat dispatch failed: ${error.message}` };
  }
  return { healthy: true };
}

function remediationCommand(os, kind) {
  // Specific label patterns so we kickstart the right daemon and nothing else
  // (e.g. "universal-tts", NOT the unrelated mlx image sidecar).
  const pattern = kind === "tts" ? "universal.?tts|mlx.?audio" : "telemetry|collector";
  const label = kind === "tts" ? "TTS" : "collector";
  if (os.includes("linux")) {
    return [
      "kicked=0",
      `for U in $(systemctl --user list-units --type=service --no-legend 2>/dev/null | grep -iE '${pattern}' | awk '{print $1}'); do systemctl --user restart "$U" 2>/dev/null && kicked=$((kicked+1)); done`,
      `for S in $(systemctl list-units --type=service --no-legend 2>/dev/null | grep -iE '${pattern}' | awk '{print $1}'); do sudo -n systemctl restart "$S" 2>/dev/null && kicked=$((kicked+1)); done`,
      `echo "watchdog restarted $kicked ${label} service(s)"`,
    ].join("; ");
  }
  // macOS: kickstart any loaded matching LaunchAgent (machine-agnostic label match).
  return [
    "U=$(id -u); kicked=0",
    `for L in $(launchctl list 2>/dev/null | awk 'NR>1 && tolower($3) ~ /${pattern}/ {print $3}'); do launchctl kickstart -k "gui/$U/$L" 2>/dev/null && kicked=$((kicked+1)); done`,
    `echo "watchdog kicked $kicked ${label} service(s)"`,
  ].join("; ");
}

// Remediate via the linkd shell directly on the owning machine (same path
// /api/fleet/shell uses): POST a kickstart command to its linkd `/_hivemind/shell`.
async function remediate(machineBase, os, kind) {
  try {
    const { ok, status } = await fetchJson(
      `${machineBase}/_hivemind/shell/sessions/${SHELL_SESSION}/command`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: remediationCommand(os, kind) }) },
      15_000,
    );
    if (!ok) await log(`  remediation shell returned HTTP ${status}`);
    return ok;
  } catch (error) {
    await log(`  remediation shell POST failed: ${error.message}`);
    return false;
  }
}

const consecutiveFailures = new Map();
const cooldownUntil = new Map();

async function runCycle(cycle) {
  const deep = cycle % CHAT_EVERY === 0;
  const machines = await discoverMachines();
  const ttsApps = await discoverTtsApps();
  // One unified target list. Collector and TTS on the same machine are keyed
  // separately, so a TTS flap restarts ONLY the TTS daemon (and vice versa).
  const targets = [
    ...machines.filter((m) => m.online !== false).map((m) => ({
      key: m.collectorUrl,
      name: m.name,
      machineBase: m.collectorUrl,
      os: m.os,
      kind: "collector",
      probe: () => probeCollector(m.collectorUrl, deep),
    })),
    ...ttsApps.map((a) => ({
      key: `tts:${a.apiBaseUrl}`,
      name: `${a.machineName} TTS`,
      machineBase: a.machineBase,
      os: "",
      kind: "tts",
      probe: () => probeTts(a.apiBaseUrl, deep),
    })),
  ];
  if (!targets.length) {
    await log("no targets discovered (dashboard unreachable and no cache)");
    return;
  }
  let healthy = 0;
  let unhealthy = 0;
  for (const target of targets) {
    const result = await target.probe();
    if (result.healthy) {
      healthy += 1;
      if (consecutiveFailures.get(target.key)) await log(`${target.name}: recovered`);
      consecutiveFailures.set(target.key, 0);
      continue;
    }
    unhealthy += 1;
    const fails = (consecutiveFailures.get(target.key) || 0) + 1;
    consecutiveFailures.set(target.key, fails);
    await log(`${target.name}: unhealthy ${fails}/${FAIL_THRESHOLD} — ${result.reason}`);
    if (fails >= FAIL_THRESHOLD && (cooldownUntil.get(target.key) || 0) < Date.now()) {
      await log(`${target.name}: REMEDIATING — restart ${target.kind} via linkd shell`);
      const ok = await remediate(target.machineBase, target.os, target.kind);
      await log(`${target.name}: remediation ${ok ? "sent" : "FAILED"}; cooling down ${Math.round(COOLDOWN_MS / 1000)}s`);
      cooldownUntil.set(target.key, Date.now() + COOLDOWN_MS);
      consecutiveFailures.set(target.key, 0);
    }
  }
  await log(`cycle ${cycle}: ${healthy} healthy, ${unhealthy} unhealthy of ${targets.length}${deep ? " (deep probe: collector chat + TTS synth)" : ""}`);
}

await log(`fleet-health-watchdog up — poll ${POLL_MS}ms, threshold ${FAIL_THRESHOLD}, cooldown ${COOLDOWN_MS}ms, deep every ${CHAT_EVERY} cycles${RUN_ONCE ? " (ONCE)" : ""}`);
let cycle = 0;
for (;;) {
  try {
    await runCycle(cycle);
  } catch (error) {
    await log(`cycle error: ${error.message}`);
  }
  cycle += 1;
  if (RUN_ONCE) break;
  await sleep(POLL_MS);
}
