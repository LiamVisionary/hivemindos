#!/usr/bin/env node
// Fleet health watchdog.
//
// From this machine, probe every connected HivemindOS machine's agent collector
// and force-restart it via the hive-native linkd shell when it's FUNCTIONALLY
// down — covering the failure launchd KeepAlive / systemd Restart cannot: the
// daemon is alive but broken (e.g. `spawn EBADF`, a wedged event loop), or a
// prolonged outage. No SSH, and no pinned tailnet IPs (machines are rediscovered
// each cycle, so addresses can change freely).
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
const APP_PORTS = String(process.env.FLEET_WATCHDOG_APP_PORTS || "5020,5021,5111,5121,3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const RUN_ONCE = process.env.FLEET_WATCHDOG_ONCE === "1";

const STATE_DIR = join(homedir(), ".hivemindos");
const MACHINES_CACHE = join(STATE_DIR, "fleet-health-watchdog-machines.json");
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

function remediationCommand(os) {
  if (os.includes("linux")) {
    return [
      "kicked=0",
      "for U in $(systemctl --user list-units --type=service --no-legend 2>/dev/null | grep -iE 'telemetry|collector' | awk '{print $1}'); do systemctl --user restart \"$U\" 2>/dev/null && kicked=$((kicked+1)); done",
      "for S in $(systemctl list-units --type=service --no-legend 2>/dev/null | grep -iE 'telemetry|collector' | awk '{print $1}'); do sudo -n systemctl restart \"$S\" 2>/dev/null && kicked=$((kicked+1)); done",
      'echo "watchdog restarted $kicked collector service(s)"',
    ].join("; ");
  }
  // macOS: kickstart any loaded telemetry/collector LaunchAgent (machine-agnostic label match).
  return [
    "U=$(id -u); kicked=0",
    "for L in $(launchctl list 2>/dev/null | awk 'NR>1 && tolower($3) ~ /telemetry|collector/ {print $3}'); do launchctl kickstart -k \"gui/$U/$L\" 2>/dev/null && kicked=$((kicked+1)); done",
    'echo "watchdog kicked $kicked collector service(s)"',
  ].join("; ");
}

// Remediate via the linkd shell directly on the target (same path /api/fleet/shell
// uses): POST a kickstart command to the machine's own linkd `/_hivemind/shell`.
async function remediate(collectorUrl, os) {
  try {
    const { ok, status } = await fetchJson(
      `${collectorUrl}/_hivemind/shell/sessions/${SHELL_SESSION}/command`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: remediationCommand(os) }) },
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
  const machines = await discoverMachines();
  if (!machines.length) {
    await log("no remote machines discovered (dashboard unreachable and no cache)");
    return;
  }
  const deep = cycle % CHAT_EVERY === 0;
  let healthy = 0;
  let unhealthy = 0;
  let offline = 0;
  for (const machine of machines) {
    const url = machine.collectorUrl;
    if (machine.online === false) {
      offline += 1;
      consecutiveFailures.set(url, 0);
      continue;
    }
    const result = await probeCollector(url, deep);
    if (result.healthy) {
      healthy += 1;
      if (consecutiveFailures.get(url)) await log(`${machine.name}: recovered`);
      consecutiveFailures.set(url, 0);
      continue;
    }
    unhealthy += 1;
    const fails = (consecutiveFailures.get(url) || 0) + 1;
    consecutiveFailures.set(url, fails);
    await log(`${machine.name}: unhealthy ${fails}/${FAIL_THRESHOLD} — ${result.reason}`);
    if (fails >= FAIL_THRESHOLD && (cooldownUntil.get(url) || 0) < Date.now()) {
      await log(`${machine.name}: REMEDIATING — kickstart collector via linkd shell`);
      const ok = await remediate(url, machine.os);
      await log(`${machine.name}: remediation ${ok ? "sent" : "FAILED"}; cooling down ${Math.round(COOLDOWN_MS / 1000)}s`);
      cooldownUntil.set(url, Date.now() + COOLDOWN_MS);
      consecutiveFailures.set(url, 0);
    }
  }
  await log(`cycle ${cycle}: ${healthy} healthy, ${unhealthy} unhealthy${offline ? `, ${offline} offline` : ""} of ${machines.length}${deep ? " (deep probe)" : ""}`);
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
