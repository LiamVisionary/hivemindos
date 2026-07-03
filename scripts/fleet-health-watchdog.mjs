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
// v2 additions:
//   - SELF monitoring: this machine's own collector and its hivemind-linkd
//     daemon are probed too (remediated via local exec — linkd being down is
//     exactly when the shell rail is unavailable). A dead-but-configured linkd
//     LaunchAgent is re-bootstrapped, and an auth-needed linkd raises an alert
//     with its auth URL instead of a pointless restart.
//   - Severe (deep-probe) failures are CONFIRMED with a second probe after a
//     short delay before remediating, so a DERP-relay blip can't trigger a
//     spurious restart on a healthy machine.
//   - Discovery falls back to `tailscale status --json` + collector port
//     probing when no local dashboard is running, so the watchdog works on
//     collector-only machines (VPS, headless boxes).
//   - Remote linkd builds are checked on deep cycles via /_hivemind/version
//     and stale binaries are reported (once per day per machine).
//   - Alerts: remediations, failures, and linkd auth-needed go to Telegram when
//     FLEET_WATCHDOG_TELEGRAM_CHAT_ID (+ a bot token) is configured in
//     ~/.hivemindos/.env; otherwise they are log-only.
//
// v3 additions:
//   - ESCALATION: when a target's deep functional probe keeps failing across
//     consecutive checks DESPITE remediation attempts (the 2026-07-03 NYC
//     machine-wide MLX synth deadlock: kickstart loops for hours, health green,
//     nobody told), the watchdog raises a human-visible alert — a Telegram
//     alert AND an urgent entry in the dashboard notifications feed
//     (POST /api/notifications on the local dashboard) — naming the machine,
//     the last probe error, and the consecutive-failure count. Policy lives in
//     scripts/lib/fleet-watchdog-escalation.mjs (hermetically tested by
//     test:fleet-watchdog-escalation).
//   - Local dashboard API calls send the HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
//     (env, then ~/.hivemindos/.env, then the checkout's .env.local). The
//     dashboard's API auth gate (src/proxy.ts) 401s tokenless requests, so
//     discovery and notification POSTs need it.
//
// Liveness uses the collector's /health; a DEEP probe (an actual /chat dispatch)
// runs every Nth cycle to catch the alive-but-can't-spawn case. After
// FAIL_THRESHOLD consecutive failures it kickstarts the collector service on the
// target (launchctl on macOS, systemctl on Linux), then cools down to avoid
// restart storms.
//
// Env knobs (all optional):
//   FLEET_WATCHDOG_POLL_MS            cycle interval (default 60000)
//   FLEET_WATCHDOG_FAIL_THRESHOLD     consecutive failures before remediation (default 3)
//   FLEET_WATCHDOG_COOLDOWN_MS        min gap between remediations per machine (default 300000)
//   FLEET_WATCHDOG_DEEP_PROBES=1      OPT-IN deep functional probes (agent /chat dispatch +
//                                     TTS synth — these consume tokens/compute); off by default,
//                                     toggleable from the Fleet view (writes the shared hive env)
//   FLEET_WATCHDOG_CHAT_EVERY         run the deep /chat probe every Nth cycle (default 15)
//   FLEET_WATCHDOG_SEVERE_RECHECK_MS  delay before confirming a severe failure (default 10000)
//   FLEET_WATCHDOG_APP_PORTS          local dashboard ports to try for discovery (default 5020,5021,5111,5121,3000)
//   FLEET_WATCHDOG_SELF=0             disable self collector/linkd monitoring
//   FLEET_WATCHDOG_TELEGRAM_CHAT_ID   Telegram chat id for alerts (enables push alerts)
//   FLEET_WATCHDOG_TELEGRAM_BOT_TOKEN bot token override (default: HIVE_TELEGRAM_BOT_TOKEN
//                                     from ~/.hivemindos/.env)
//   FLEET_WATCHDOG_ESCALATE_AFTER     consecutive deep failures (despite remediation) before
//                                     a human-visible escalation (default 3)
//   FLEET_WATCHDOG_ESCALATE_REPEAT_MS repeat interval for escalations while still failing (default 1800000)
//   FLEET_WATCHDOG_ONCE=1             run a single cycle and exit (for testing)

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createEscalationTracker, formatEscalationAlert } from "./lib/fleet-watchdog-escalation.mjs";

const execFileAsync = promisify(execFile);

const POLL_MS = Number(process.env.FLEET_WATCHDOG_POLL_MS || 60_000);
const FAIL_THRESHOLD = Number(process.env.FLEET_WATCHDOG_FAIL_THRESHOLD || 3);
const COOLDOWN_MS = Number(process.env.FLEET_WATCHDOG_COOLDOWN_MS || 300_000);
const CHAT_EVERY = Math.max(1, Number(process.env.FLEET_WATCHDOG_CHAT_EVERY || 15));
const SEVERE_RECHECK_MS = Number(process.env.FLEET_WATCHDOG_SEVERE_RECHECK_MS || 10_000);
// Deep TTS synth probe: generous timeout so a cold model LOAD (slow but real) is
// not mistaken for a wedged backend — we judge by the result (real PCM bytes),
// not by latency. A small/fast model keeps the probe cheap.
const TTS_DEEP_TIMEOUT_MS = Number(process.env.FLEET_WATCHDOG_TTS_DEEP_TIMEOUT_MS || 60_000);
const TTS_PROBE_MODEL = process.env.FLEET_WATCHDOG_TTS_MODEL || "chatterbox-turbo";
const TTS_PROBE_VOICE = process.env.FLEET_WATCHDOG_TTS_VOICE || "voice01";
const TTS_MIN_PCM_BYTES = 2_000;
const APP_PORTS = String(process.env.FLEET_WATCHDOG_APP_PORTS || "5020,5021,5111,5121,3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const SELF_ENABLED = process.env.FLEET_WATCHDOG_SELF !== "0";
const RUN_ONCE = process.env.FLEET_WATCHDOG_ONCE === "1";
// Same collector port range fleet discovery probes; collectors relocate when
// their preferred local port is taken.
const COLLECTOR_PORTS = Array.from({ length: 24 }, (_, i) => 8787 + i);
const ALERT_REPEAT_MS = 30 * 60_000;
const STALE_BUILD_ALERT_MS = 24 * 60 * 60_000;
const ESCALATE_AFTER = Math.max(1, Number(process.env.FLEET_WATCHDOG_ESCALATE_AFTER || 3));
const ESCALATE_REPEAT_MS = Number(process.env.FLEET_WATCHDOG_ESCALATE_REPEAT_MS || 30 * 60_000);

const STATE_DIR = join(homedir(), ".hivemindos");
const MACHINES_CACHE = join(STATE_DIR, "fleet-health-watchdog-machines.json");
const TTS_CACHE = join(STATE_DIR, "fleet-health-watchdog-tts.json");
const PORTS_CACHE = join(STATE_DIR, "fleet-health-watchdog-ports.json");
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

function parseEnvFile(path) {
  try {
    const env = {};
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

const collectorEnv = parseEnvFile(join(STATE_DIR, "collector.env"));
const hiveEnv = parseEnvFile(join(STATE_DIR, ".env"));
const checkoutEnv = parseEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));

// Local dashboard APIs (/api/fleet/*, /api/notifications) sit behind dashboard
// auth when it is configured; without the device token every call 401s
// silently. Same resolution order as scripts/hivemind-mcp.
const DASHBOARD_DEVICE_TOKEN = (
  process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || hiveEnv.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || checkoutEnv.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || ""
).trim();

function dashboardHeaders(extra = {}) {
  return DASHBOARD_DEVICE_TOKEN ? { ...extra, "x-hivemindos-device-token": DASHBOARD_DEVICE_TOKEN } : extra;
}

const TELEGRAM_CHAT_ID = (process.env.FLEET_WATCHDOG_TELEGRAM_CHAT_ID || hiveEnv.FLEET_WATCHDOG_TELEGRAM_CHAT_ID || "").trim();
const TELEGRAM_BOT_TOKEN = (
  process.env.FLEET_WATCHDOG_TELEGRAM_BOT_TOKEN
  || hiveEnv.FLEET_WATCHDOG_TELEGRAM_BOT_TOKEN
  || hiveEnv.HIVE_TELEGRAM_BOT_TOKEN
  || ""
).trim();

const lastAlertAt = new Map();

// Push watchdog events somewhere a human actually sees. Telegram when
// configured; always the log. Never throws, rate-limits repeats per key.
async function alert(key, message) {
  const now = Date.now();
  if ((lastAlertAt.get(key) || 0) + ALERT_REPEAT_MS > now) return;
  lastAlertAt.set(key, now);
  await log(`ALERT ${message}`);
  if (!TELEGRAM_CHAT_ID || !TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: `🩺 fleet-watchdog: ${message}` }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    await log(`  alert delivery failed: ${error.message}`);
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

// Escalations must land where a human actually looks: the dashboard's
// notifications feed (the bell + urgent badge every dashboard shows). Posted to
// the first local dashboard that answers; best-effort — the Telegram alert and
// the log still fire when no dashboard is up.
async function postDashboardNotification(title, body) {
  for (const port of APP_PORTS) {
    try {
      const { ok, status } = await fetchJson(`http://127.0.0.1:${port}/api/notifications`, {
        method: "POST",
        headers: dashboardHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          notification: {
            title,
            body,
            priority: "urgent",
            kind: "alert",
            agentId: "fleet-health-watchdog",
            agentName: "Fleet Watchdog",
            source: "fleet-health-watchdog",
            tags: ["fleet-health", "escalation"],
          },
        }),
      }, 8_000);
      if (ok) return true;
      await log(`  dashboard notification POST :${port} returned HTTP ${status}`);
    } catch {
      // no dashboard on this port — try the next
    }
  }
  return false;
}

const escalations = createEscalationTracker({ threshold: ESCALATE_AFTER, repeatMs: ESCALATE_REPEAT_MS });

// Remediation has demonstrably not fixed this target: make it loud. Telegram
// (via the shared alert rail) + an urgent dashboard notification, both naming
// machine, probe error, and consecutive-failure count.
async function escalate(target, due) {
  const message = formatEscalationAlert({ name: target.name, kind: target.kind, ...due });
  await alert(`escalate:${target.key}`, message);
  const posted = await postDashboardNotification(`${target.name}: ${target.kind} needs human attention`, message);
  if (!posted) await log("  escalation dashboard notification undelivered (no local dashboard reachable)");
}

let portsByHost = {};
try {
  portsByHost = JSON.parse(readFileSync(PORTS_CACHE, "utf8"));
} catch {
  portsByHost = {};
}

async function rememberPort(host, port) {
  if (portsByHost[host] === port) return;
  portsByHost[host] = port;
  await writeFile(PORTS_CACHE, JSON.stringify(portsByHost)).catch(() => {});
}

function tailscaleCli() {
  return [
    "tailscale",
    "/opt/homebrew/bin/tailscale",
    "/opt/homebrew/opt/tailscale/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/usr/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ];
}

function localMachineId() {
  try {
    return readFileSync(join(STATE_DIR, "machine-id"), "utf8").trim();
  } catch {
    return "";
  }
}

// Dashboard-less discovery: enumerate online tailnet peers and find each one's
// collector by probing the shared port range (cached port first). Lets the
// watchdog run on collector-only machines and keeps working when the local
// dashboard is closed. Phones never host collectors and are skipped.
async function discoverViaTailscale() {
  let status = null;
  for (const cli of tailscaleCli()) {
    try {
      const { stdout } = await execFileAsync(cli, ["status", "--json"], { timeout: 10_000 });
      status = JSON.parse(stdout);
      break;
    } catch {
      // try the next CLI location
    }
  }
  if (!status) return [];
  const ownId = localMachineId();
  const machines = [];
  const seenMachineIds = new Set();
  for (const peer of Object.values(status.Peer || {})) {
    if (!peer || peer.Online === false) continue;
    const os = String(peer.OS || "").toLowerCase();
    if (os === "ios" || os === "android") continue;
    const ip = (peer.TailscaleIPs || []).find((v) => /^\d+\.\d+\.\d+\.\d+$/.test(String(v)));
    if (!ip) continue;
    const name = String(peer.DNSName || "").replace(/\.$/, "").split(".")[0] || ip;
    const cached = portsByHost[ip];
    const ports = cached ? [cached, ...COLLECTOR_PORTS.filter((p) => p !== cached)] : COLLECTOR_PORTS;
    for (const port of ports) {
      try {
        const { ok, data } = await fetchJson(`http://${ip}:${port}/health`, {}, 2_500);
        if (!ok || data?.ok !== true || !data?.machineId) continue;
        if (data.machineId === ownId || seenMachineIds.has(data.machineId)) break; // own/duplicate linkd node
        seenMachineIds.add(data.machineId);
        await rememberPort(ip, port);
        machines.push({ name, self: false, online: true, os: os || "", collectorUrl: `http://${ip}:${port}` });
        break;
      } catch {
        // closed port — keep probing
      }
    }
  }
  return machines;
}

// Rediscover the fleet each cycle: local dashboard first (richest view), then
// tailscale CLI + port probing, then the last good cached list.
async function discoverMachines() {
  for (const port of APP_PORTS) {
    try {
      const { ok, data } = await fetchJson(`http://127.0.0.1:${port}/api/fleet/discover`, { headers: dashboardHeaders() }, 8_000);
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
  const viaTailscale = await discoverViaTailscale().catch(() => []);
  if (viaTailscale.length) {
    await writeFile(MACHINES_CACHE, JSON.stringify(viaTailscale)).catch(() => {});
    return viaTailscale;
  }
  try {
    return JSON.parse(await readFile(MACHINES_CACHE, "utf8"));
  } catch {
    return [];
  }
}

// TTS apps live behind each machine's linkd at /app-proxy/8799. Discover the
// remote ones (their `machineBase` is the linkd base — strip the /app-proxy
// suffix — used to kickstart the TTS service on the owning machine). The
// dashboard is the richest source; when it is unreachable or its auth is
// misconfigured, probe each discovered machine's linkd app-proxy directly —
// otherwise a dashboard outage strands whatever URL is in the cache
// (2026-07-03: a stale cached URL produced a false unhealthy on NYC TTS).
let lastTtsSource = "";
async function logTtsSourceChange(source, detail = "") {
  if (lastTtsSource === source) return;
  lastTtsSource = source;
  await log(`tts discovery via ${source}${detail ? ` — ${detail}` : ""}`);
}

async function discoverTtsApps(machines) {
  for (const port of APP_PORTS) {
    try {
      const { ok, data } = await fetchJson(`http://127.0.0.1:${port}/api/fleet/apps?fast=1`, { headers: dashboardHeaders() }, 8_000);
      if (!ok) continue;
      const apps = (data.apps || [])
        .filter((a) => Number(a.port) === 8799 || /universal.?tts/i.test(String(a.name || "")))
        .map((a) => {
          const apiBaseUrl = String(a.apiBaseUrl || "").trim().replace(/\/+$/, "");
          return { apiBaseUrl, machineBase: apiBaseUrl.replace(/\/app-proxy\/.*$/, ""), machineName: a.machineName || a.name || "TTS" };
        })
        .filter((a) => a.apiBaseUrl && a.machineBase && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(a.machineBase));
      if (apps.length) {
        await logTtsSourceChange("dashboard");
        await writeFile(TTS_CACHE, JSON.stringify(apps)).catch(() => {});
        return apps;
      }
    } catch {
      // try the next port
    }
  }
  // Dashboard unavailable: the machines list (dashboard → tailscale → cache)
  // still knows every linkd base, and a machine that runs TTS answers
  // /app-proxy/8799/v1/models with a non-empty catalog. Machines without a
  // TTS app fail the probe and are skipped, never reported unhealthy.
  const probed = [];
  for (const machine of machines || []) {
    if (machine.online === false || !machine.collectorUrl) continue;
    const apiBaseUrl = `${machine.collectorUrl}/app-proxy/8799`;
    try {
      const { ok, data } = await fetchJson(`${apiBaseUrl}/v1/models`, {}, 5_000);
      const models = data?.data || data?.models || [];
      if (!ok || !Array.isArray(models) || models.length === 0) continue;
      probed.push({ apiBaseUrl, machineBase: machine.collectorUrl, machineName: machine.name || "TTS" });
    } catch {
      // no TTS app-proxy on this machine
    }
  }
  if (probed.length) {
    await logTtsSourceChange("linkd app-proxy probe", `dashboard unreachable; found ${probed.length}`);
    await writeFile(TTS_CACHE, JSON.stringify(probed)).catch(() => {});
    return probed;
  }
  try {
    const cached = JSON.parse(await readFile(TTS_CACHE, "utf8"));
    await logTtsSourceChange("stale cache", `${Array.isArray(cached) ? cached.length : 0} cached targets, unverified`);
    return cached;
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
      return { healthy: false, severe: true, reason: `synth HTTP ${response.status} ${text.slice(0, 50)}` };
    }
    const bytes = (await response.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
    // A working synth returns real PCM; a wedged backend returns a tiny proxy-error blob.
    if (bytes < TTS_MIN_PCM_BYTES) return { healthy: false, severe: true, reason: `synth returned ${bytes}B (backend wedged)` };
  } catch (error) {
    return { healthy: false, severe: true, reason: `synth failed: ${error.message}` };
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
      return { healthy: false, severe: true, reason: `chat HTTP ${chat.status} ${String(chat.data?.error || chat.text).slice(0, 80)}` };
    }
  } catch (error) {
    return { healthy: false, severe: true, reason: `chat dispatch failed: ${error.message}` };
  }
  return { healthy: true };
}

// This machine's own linkd daemon, via its loopback control API. The honest
// /health (ok = tailscale backend Running) distinguishes daemon-down from
// daemon-up-but-tailnet-broken; auth-needed is remediation-proof and needs a
// human, so it alerts with the auth URL instead of restarting.
async function probeLocalLinkd(controlUrl) {
  try {
    const res = await fetchJson(`${controlUrl}/health`, {}, 8_000);
    if (res.data?.authNeeded) {
      return { healthy: false, severe: true, authNeeded: true, reason: `linkd needs tailscale auth${res.data?.authUrl ? `: ${res.data.authUrl}` : ""}` };
    }
    if (res.data?.ok !== true) {
      // Legacy builds always reply {ok:true}; a non-ok reply is the new honest
      // health telling us the tailscale backend is down.
      return { healthy: false, reason: `linkd backend ${String(res.data?.backendState || res.data?.error || res.text).slice(0, 60)}` };
    }
    return { healthy: true };
  } catch (error) {
    return { healthy: false, reason: `linkd control unreachable: ${error.message}` };
  }
}

function remediationCommand(os, kind) {
  // Specific label patterns so we kickstart the right daemon and nothing else
  // (e.g. "universal-tts", NOT the unrelated mlx image sidecar).
  if (kind === "linkd") {
    const label = collectorEnv.HIVE_LINK_LABEL || "com.hivemindos.linkd.agent";
    if (os.includes("linux")) {
      return "systemctl --user restart hivemindos-linkd.service 2>/dev/null && echo 'watchdog restarted linkd' || echo 'linkd unit missing'";
    }
    // kickstart the loaded agent; if it is not registered at all (the failure
    // that silently killed linkd on 2026-07-02), bootstrap the existing plist.
    return [
      "U=$(id -u)",
      `launchctl kickstart -k "gui/$U/${label}" 2>/dev/null && echo "watchdog kicked linkd" && exit 0`,
      `PLIST="$HOME/Library/LaunchAgents/${label}.plist"`,
      `[ -f "$PLIST" ] && launchctl bootstrap "gui/$U" "$PLIST" 2>/dev/null && echo "watchdog bootstrapped linkd" && exit 0`,
      "echo 'linkd LaunchAgent missing — rerun install-telemetry-collector.sh'",
    ].join("; ");
  }
  const pattern = kind === "tts" ? "universal.?tts|mlx.?audio" : "telemetry|collector";
  const label = kind === "tts" ? "TTS" : "collector";
  if (os.includes("linux")) {
    // --all: a STOPPED (inactive/dead) unit is invisible to plain list-units,
    // and a deliberate `systemctl stop` also disarms Restart=always — exactly
    // the case that needs the watchdog. Restart covers dead units too.
    return [
      "kicked=0",
      `for U in $(systemctl --user list-units --all --type=service --no-legend 2>/dev/null | grep -iE '${pattern}' | awk '{print $1}'); do systemctl --user restart "$U" 2>/dev/null && kicked=$((kicked+1)); done`,
      `for S in $(systemctl list-units --all --type=service --no-legend 2>/dev/null | grep -iE '${pattern}' | awk '{print $1}'); do sudo -n systemctl restart "$S" 2>/dev/null && kicked=$((kicked+1)); done`,
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

// Remediate a SELF target with a local shell — the local linkd being down is
// exactly the case where the linkd-shell rail cannot help this machine.
async function remediateLocal(kind) {
  const os = platform() === "darwin" ? "macos" : platform();
  try {
    const { stdout } = await execFileAsync("/bin/sh", ["-c", remediationCommand(os, kind)], { timeout: 30_000 });
    const summary = String(stdout || "").trim().split("\n").pop();
    if (summary) await log(`  local remediation: ${summary}`);
    return true;
  } catch (error) {
    await log(`  local remediation failed: ${error.message}`);
    return false;
  }
}

// Self targets: this machine's collector (loopback) and its linkd daemon.
// Remote watchdogs can't always see either (a dead linkd hides them both), so
// every machine watches its own.
function selfTargets() {
  if (!SELF_ENABLED) return [];
  const targets = [];
  const port = collectorEnv.AGENT_TELEMETRY_PORT || "8787";
  targets.push({
    key: "self:collector",
    name: "self collector",
    os: platform() === "darwin" ? "macos" : platform(),
    kind: "collector",
    local: true,
    probe: (deep) => probeCollector(`http://127.0.0.1:${port}`, deep),
  });
  if (collectorEnv.HIVE_LINK_LABEL) {
    const control = collectorEnv.HIVE_LINK_CONTROL || "127.0.0.1:8788";
    targets.push({
      key: "self:linkd",
      name: "self linkd",
      os: platform() === "darwin" ? "macos" : platform(),
      kind: "linkd",
      local: true,
      probe: () => probeLocalLinkd(`http://${control}`),
    });
  }
  return targets;
}

const staleBuildAlertAt = new Map();

// Deep-cycle check: does the remote linkd daemon report a build commit, and
// does it match the checkout its collector is serving from? A mismatch means
// the machine pulled new code but is still running an old linkd binary — the
// silent-staleness gap. Pre-version linkd builds proxy this path through to
// the collector (a JSON without service=hivemind-linkd), which is itself the
// "update pending" signal.
async function checkLinkdBuild(machine) {
  const key = `stale:${machine.name}`;
  if ((staleBuildAlertAt.get(key) || 0) + STALE_BUILD_ALERT_MS > Date.now()) return;
  try {
    const [version, health] = await Promise.all([
      fetchJson(`${machine.collectorUrl}/_hivemind/version`, {}, 8_000),
      fetchJson(`${machine.collectorUrl}/health`, {}, 8_000),
    ]);
    const repoCommit = String(health.data?.version?.shortCommit || "").trim();
    if (version.data?.service !== "hivemind-linkd") {
      staleBuildAlertAt.set(key, Date.now());
      await log(`${machine.name}: linkd build has no version endpoint yet (pre-stamp binary; update pending)`);
      return;
    }
    const linkdCommit = String(version.data?.commit || "").trim();
    if (repoCommit && linkdCommit && linkdCommit !== "unknown" && !repoCommit.startsWith(linkdCommit) && !linkdCommit.startsWith(repoCommit)) {
      staleBuildAlertAt.set(key, Date.now());
      await alert(key, `${machine.name}: linkd binary is stale (built at ${linkdCommit}, checkout at ${repoCommit}) — rerun install-telemetry-collector.sh there`);
    }
  } catch {
    // version telemetry is best-effort; the health probes are the gate
  }
}

const consecutiveFailures = new Map();
const cooldownUntil = new Map();

// Deep functional probes dispatch a REAL agent chat (and a real TTS synth) —
// they cost the user tokens/compute every cycle they run, so they are opt-in:
// FLEET_WATCHDOG_DEEP_PROBES=1, settable from the dashboard (it writes the
// shared hive env, which replicates fleet-wide). Re-read every cycle so the
// toggle applies without a service restart. Cheap liveness probes always run.
let deepProbesEnabledLogged = null;
function deepProbesEnabled() {
  const raw = (
    process.env.FLEET_WATCHDOG_DEEP_PROBES
    ?? parseEnvFile(join(STATE_DIR, ".env")).FLEET_WATCHDOG_DEEP_PROBES
    ?? ""
  ).trim();
  const enabled = raw === "1" || raw.toLowerCase() === "true";
  if (deepProbesEnabledLogged !== enabled) {
    deepProbesEnabledLogged = enabled;
    void log(`deep functional probes ${enabled ? "ENABLED (agent chat + TTS synth)" : "off (cheap liveness only; enable via FLEET_WATCHDOG_DEEP_PROBES=1)"}`);
  }
  return enabled;
}

async function runCycle(cycle) {
  const deep = deepProbesEnabled() && cycle % CHAT_EVERY === 0;
  const machines = await discoverMachines();
  const ttsApps = await discoverTtsApps(machines);
  // One unified target list. Collector and TTS on the same machine are keyed
  // separately, so a TTS flap restarts ONLY the TTS daemon (and vice versa).
  const targets = [
    ...selfTargets(),
    ...machines.filter((m) => m.online !== false).map((m) => ({
      key: m.collectorUrl,
      name: m.name,
      machineBase: m.collectorUrl,
      os: m.os,
      kind: "collector",
      probe: (isDeep) => probeCollector(m.collectorUrl, isDeep),
    })),
    ...ttsApps.map((a) => ({
      key: `tts:${a.apiBaseUrl}`,
      name: `${a.machineName} TTS`,
      machineBase: a.machineBase,
      os: "",
      kind: "tts",
      probe: (isDeep) => probeTts(a.apiBaseUrl, isDeep),
    })),
  ];
  if (!targets.length) {
    await log("no targets discovered (dashboard + tailscale unreachable and no cache)");
    return;
  }
  let healthy = 0;
  let unhealthy = 0;
  for (const target of targets) {
    let result = await target.probe(deep);
    // A deep functional probe failing is a definitive wedge — but a single
    // sample can also be a relay blip (DERP paths EOF transiently), which used
    // to trigger spurious restarts of healthy machines. Confirm severe
    // failures with a second probe before acting.
    if (!result.healthy && result.severe && !result.authNeeded) {
      await log(`${target.name}: severe failure (${result.reason}) — confirming in ${Math.round(SEVERE_RECHECK_MS / 1000)}s`);
      await sleep(SEVERE_RECHECK_MS);
      const recheck = await target.probe(deep);
      if (recheck.healthy) {
        await log(`${target.name}: recovered on confirmation probe (transient blip, no remediation)`);
        result = recheck;
      } else {
        result = { ...recheck, severe: true };
      }
    }
    if (result.healthy) {
      healthy += 1;
      if (consecutiveFailures.get(target.key)) await log(`${target.name}: recovered`);
      consecutiveFailures.set(target.key, 0);
      // Only a passing DEEP probe proves a wedge cleared — cheap probes stay
      // green through a wedged backend (the whole NYC incident).
      if (deep) {
        const recovery = escalations.recordDeepRecovery(target.key);
        if (recovery.wasEscalated) {
          await alert(`recovered:${target.key}`, `${target.name}: ${target.kind} deep probe healthy again after escalation (${recovery.streak} failed checks)`);
        }
      }
      continue;
    }
    unhealthy += 1;
    const fails = (consecutiveFailures.get(target.key) || 0) + 1;
    consecutiveFailures.set(target.key, fails);
    const threshold = result.severe ? 1 : FAIL_THRESHOLD;
    await log(`${target.name}: unhealthy ${fails}/${threshold}${result.severe ? " (severe)" : ""} — ${result.reason}`);
    if (result.authNeeded) {
      // Restarting cannot re-authenticate a logged-out tsnet node; a human must
      // click the auth URL (or provision HIVE_LINK_AUTH_KEY and restart).
      await alert(`auth:${target.key}`, `${target.name} ${result.reason}`);
      continue;
    }
    if (result.severe) escalations.recordSevereFailure(target.key, result.reason);
    if (fails >= threshold && (cooldownUntil.get(target.key) || 0) < Date.now()) {
      await log(`${target.name}: REMEDIATING — restart ${target.kind} via ${target.local ? "local shell" : "linkd shell"}`);
      const ok = target.local
        ? await remediateLocal(target.kind)
        : await remediate(target.machineBase, target.os, target.kind);
      escalations.recordRemediationAttempt(target.key);
      await log(`${target.name}: remediation ${ok ? "sent" : "FAILED"}; cooling down ${Math.round(COOLDOWN_MS / 1000)}s`);
      await alert(`remediate:${target.key}`, `${target.name} was down (${result.reason}) — restart ${ok ? "sent" : "FAILED"}`);
      cooldownUntil.set(target.key, Date.now() + COOLDOWN_MS);
      consecutiveFailures.set(target.key, 0);
    }
    // Escalate AFTER any remediation attempt this cycle: a deep wedge that has
    // now outlasted ESCALATE_AFTER consecutive deep failures with at least one
    // restart attempt is beyond the watchdog — tell a human, visibly.
    if (result.severe) {
      const due = escalations.escalationDue(target.key, Date.now());
      if (due) await escalate(target, due);
    }
  }
  if (deep) {
    for (const machine of machines) {
      if (machine.collectorUrl) await checkLinkdBuild(machine);
    }
  }
  await log(`cycle ${cycle}: ${healthy} healthy, ${unhealthy} unhealthy of ${targets.length}${deep ? " (deep probe: collector chat + TTS synth)" : ""}`);
}

await log(`fleet-health-watchdog up — poll ${POLL_MS}ms, threshold ${FAIL_THRESHOLD}, cooldown ${COOLDOWN_MS}ms, deep every ${CHAT_EVERY} cycles, self=${SELF_ENABLED ? "on" : "off"}, alerts=${TELEGRAM_CHAT_ID && TELEGRAM_BOT_TOKEN ? "telegram" : "log-only"}, escalate after ${ESCALATE_AFTER} deep fails (dashboard token ${DASHBOARD_DEVICE_TOKEN ? "found" : "MISSING — dashboard notifications will 401 if auth is on"})${RUN_ONCE ? " (ONCE)" : ""}`);
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
