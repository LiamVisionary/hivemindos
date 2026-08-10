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
//     and stale binaries are reported (once per day per machine). Stale means
//     linkd SOURCES changed between the binary's stamp and the checkout — the
//     same criterion the installer's rebuild-skip uses (lib/linkd-staleness.mjs);
//     a stamp that merely trails HEAD after unrelated commits is current.
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
// runs every Nth cycle to catch the alive-but-can't-spawn case, but only when
// /health advertises chat plus the Hermes runtime. After FAIL_THRESHOLD
// consecutive failures it kickstarts the collector service on the target
// (launchctl on macOS, systemctl on Linux), then cools down to avoid restart
// storms.
//
// Env knobs (all optional):
//   FLEET_WATCHDOG_POLL_MS            cycle interval (default 60000)
//   FLEET_WATCHDOG_FAIL_THRESHOLD     consecutive failures before remediation (default 3)
//   FLEET_WATCHDOG_COOLDOWN_MS        min gap between remediations per machine (default 300000)
//   FLEET_WATCHDOG_DEEP_PROBES=1      OPT-IN deep functional probes (agent /chat dispatch +
//                                     TTS synth — these consume tokens/compute); off by default,
//                                     toggleable from the Fleet view (writes the shared hive env)
//   FLEET_WATCHDOG_CHAT_EVERY         run the deep /chat probe every Nth cycle (default 15)
//   FLEET_WATCHDOG_PROBE_PROFILE      hermes localDataDir the deep /chat probe runs under
//                                     (default ~/.hermes/profiles/runtime-capability-probe — a
//                                     RESERVED slug the collector hides from the agent roster, so
//                                     probe turns never pollute the dashboard chat tree)
//   FLEET_WATCHDOG_PROBE_MODEL        model for the deep /chat probe (default
//                                     meta-llama/llama-3.3-70b-instruct — cheap + reliable; avoid
//                                     `:free` ids, they 429 and false-fail the probe)
//   FLEET_WATCHDOG_PROBE_PROVIDER     provider for the deep /chat probe (default openrouter)
//   FLEET_WATCHDOG_TTS_MODELS         comma list of models the deep TTS probe synthesizes
//                                     (default chatterbox-turbo,qwen3-tts-1.7b-custom —
//                                     every backend the voice pipeline depends on;
//                                     FLEET_WATCHDOG_TTS_MODEL still honored as fallback).
//                                     Models a target's catalog doesn't serve are skipped;
//                                     if none match, the first loaded catalog model is
//                                     synthesized with the provider's default voice.
//   FLEET_WATCHDOG_TTS_VOICE          voice for the deep synth (default voice01); if the
//                                     target rejects it (HTTP 200 + 0 bytes) but synths
//                                     fine voiceless, the watchdog alerts a human instead
//                                     of restarting — a restart can't fix a missing voice
//   FLEET_WATCHDOG_SEVERE_RECHECK_MS  delay before confirming a severe failure (default 10000)
//   FLEET_WATCHDOG_APP_PORTS          local dashboard ports to try for discovery (default 5020,5021,5111,5121,3000)
//   FLEET_WATCHDOG_MACHINE_CACHE_TTL_MS maximum age of a fleet discovery snapshot before it
//                                     is ignored (default max of 5 poll cycles or 5 minutes)
//   FLEET_WATCHDOG_SELF=0             disable self collector/linkd monitoring
//   FLEET_WATCHDOG_TELEGRAM_CHAT_ID   Telegram chat id for alerts (enables push alerts)
//   FLEET_WATCHDOG_TELEGRAM_BOT_TOKEN bot token override (default: HIVE_TELEGRAM_BOT_TOKEN
//                                     from ~/.hivemindos/.env)
//   FLEET_WATCHDOG_ESCALATE_AFTER     consecutive deep failures (despite remediation) before
//                                     a human-visible escalation (default 3)
//   FLEET_WATCHDOG_ESCALATE_REPEAT_MS repeat interval for escalations while still failing (default 1800000)
//   FLEET_WATCHDOG_ONCE=1             run a single cycle and exit (for testing)

import { readFile, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createEscalationTracker, formatEscalationAlert } from "./lib/fleet-watchdog-escalation.mjs";
import {
  localCollectorPortCandidates,
  selectHealthyLocalCollector,
} from "./lib/fleet-watchdog-local-collector.mjs";
import {
  collectorChatFailureResult,
  collectorChatProbeDecision,
  createMachineCacheSnapshot,
  readFreshMachineCache,
  shouldAttemptRemediation,
} from "./lib/fleet-watchdog-discovery.mjs";
import { linkdSourcesChangedBetween } from "./lib/linkd-staleness.mjs";
import { shouldUseTailscaleCliFallback } from "./lib/tailscale-optional.mjs";

const execFileAsync = promisify(execFile);

const POLL_MS = Number(process.env.FLEET_WATCHDOG_POLL_MS || 60_000);
const FAIL_THRESHOLD = Number(process.env.FLEET_WATCHDOG_FAIL_THRESHOLD || 3);
const COOLDOWN_MS = Number(process.env.FLEET_WATCHDOG_COOLDOWN_MS || 300_000);
const CHAT_EVERY = Math.max(1, Number(process.env.FLEET_WATCHDOG_CHAT_EVERY || 15));
const SEVERE_RECHECK_MS = Number(process.env.FLEET_WATCHDOG_SEVERE_RECHECK_MS || 10_000);
// Deep /chat probe identity. A health probe must NOT pollute a box's real agent
// history: route it at a RESERVED hermes profile (runtime-capability-probe),
// whose sessions the collector excludes from the agent roster
// (RESERVED_HERMES_PROFILE_SLUGS), so probe turns never surface in the dashboard
// chat tree. `~` is expanded to the TARGET box's home by the collector, so a
// single path works for every machine and existing collectors already honor it
// (localDataDir -> HERMES_HOME; provider/model -> hermes -m/--provider). Pin a
// cheap, reliable model — the OpenRouter key is fleet-wide, whereas a box's
// default may be a premium model (gpt-5.5) and a `:free` model rate-limits (429)
// and would false-fail the probe.
const PROBE_PROFILE_DIR =
  process.env.FLEET_WATCHDOG_PROBE_PROFILE || "~/.hermes/profiles/runtime-capability-probe";
const PROBE_MODEL = process.env.FLEET_WATCHDOG_PROBE_MODEL || "meta-llama/llama-3.3-70b-instruct";
const PROBE_PROVIDER = process.env.FLEET_WATCHDOG_PROBE_PROVIDER || "openrouter";
// Deep TTS synth probe: generous timeout so a cold model LOAD (slow but real) is
// not mistaken for a wedged backend — we judge by the result (real PCM bytes),
// not by latency. Every model the voice pipeline depends on must synth: backends
// wedge independently (2026-07-03: the qwen3 MLX sidecar hung mid-stream for
// 30+ min while chatterbox kept passing the single-model probe, so no alert
// fired while the Queen was voiceless). Timeout is per model; a qwen3 sidecar
// (re)load mid-synth measured >60s but well under 180s, and a severe TTS
// failure force-restarts after ONE confirmation — a too-tight timeout here
// means every sidecar reload becomes a restart loop.
const TTS_DEEP_TIMEOUT_MS = Number(process.env.FLEET_WATCHDOG_TTS_DEEP_TIMEOUT_MS || 180_000);
const TTS_PROBE_MODELS = String(
  process.env.FLEET_WATCHDOG_TTS_MODELS || process.env.FLEET_WATCHDOG_TTS_MODEL
    || "chatterbox-turbo,qwen3-tts-1.7b-custom",
).split(",").map((s) => s.trim()).filter(Boolean);
const TTS_PROBE_VOICE = process.env.FLEET_WATCHDOG_TTS_VOICE || "voice01";
const TTS_MIN_PCM_BYTES = 2_000;
// 5122: the Tauri debug app spawns its dev dashboard there — without it the
// watchdog can't reach the only dashboard that's up in a desktop-dev session.
const APP_PORTS = String(process.env.FLEET_WATCHDOG_APP_PORTS || "5020,5021,5111,5121,5122,3000")
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
const configuredMachineCacheTtlMs = Number(process.env.FLEET_WATCHDOG_MACHINE_CACHE_TTL_MS);
const MACHINE_CACHE_TTL_MS = Number.isFinite(configuredMachineCacheTtlMs) && configuredMachineCacheTtlMs > 0
  ? configuredMachineCacheTtlMs
  : Math.max(5 * 60_000, POLL_MS * 5);
const UNREACHABLE_ALERT_REPEAT_MS = 7 * 24 * 60 * 60_000;

const STATE_DIR = join(homedir(), ".hivemindos");
const MACHINES_CACHE = join(STATE_DIR, "fleet-health-watchdog-machines.json");
const TTS_CACHE = join(STATE_DIR, "fleet-health-watchdog-tts.json");
const PORTS_CACHE = join(STATE_DIR, "fleet-health-watchdog-ports.json");
const LOG_PATH = join(STATE_DIR, "fleet-health-watchdog.log");
const ALERT_STATE_PATH = join(STATE_DIR, "fleet-health-watchdog-alerts.json");
const SHELL_SESSION = "fleet-health-watchdog";
const WATCHDOG_SOURCE = (process.env.FLEET_WATCHDOG_SOURCE || hostname() || "unknown-host").trim();
const WATCHDOG_REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const COLLECTOR_LAUNCH_AGENT = join(homedir(), "Library", "LaunchAgents", "com.agent-control-room.telemetry.plist");
const COLLECTOR_SYSTEMD_UNIT = join(homedir(), ".config", "systemd", "user", "agent-telemetry.service");

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
const ALERT_STATE_TTL_MS = 7 * 24 * 60 * 60_000;
let persistedAlertState = null;

async function readAlertState() {
  try {
    const parsed = JSON.parse(await readFile(ALERT_STATE_PATH, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAlertState(state) {
  await mkdir(dirname(ALERT_STATE_PATH), { recursive: true });
  const tmp = `${ALERT_STATE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await rename(tmp, ALERT_STATE_PATH);
}

function pruneAlertState(state, now) {
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== "number" || value + ALERT_STATE_TTL_MS < now) delete state[key];
  }
}

async function getAlertState() {
  if (!persistedAlertState) persistedAlertState = await readAlertState();
  return persistedAlertState;
}

async function clearAlert(key) {
  const sourceKey = `${WATCHDOG_SOURCE}:${key}`;
  const state = await getAlertState();
  const existed = Object.hasOwn(state, sourceKey) || lastAlertAt.has(sourceKey);
  if (!existed) return false;
  delete state[sourceKey];
  lastAlertAt.delete(sourceKey);
  await writeAlertState(state).catch((error) => log(`  alert state write failed: ${error.message}`));
  return true;
}

// Push watchdog events somewhere a human actually sees. Telegram when
// configured; always the log. Never throws, rate-limits repeats per key.
async function alert(key, message, { repeatMs = ALERT_REPEAT_MS } = {}) {
  const now = Date.now();
  const sourceKey = `${WATCHDOG_SOURCE}:${key}`;
  const state = await getAlertState();
  pruneAlertState(state, now);
  const lastSentAt = Math.max(Number(lastAlertAt.get(sourceKey) || 0), Number(state[sourceKey] || 0));
  if (lastSentAt + repeatMs > now) return false;
  lastAlertAt.set(sourceKey, now);
  state[sourceKey] = now;
  await writeAlertState(state).catch((error) => log(`  alert state write failed: ${error.message}`));
  await log(`ALERT ${message}`);
  if (!TELEGRAM_CHAT_ID || !TELEGRAM_BOT_TOKEN) return true;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: `🩺 fleet-watchdog (${WATCHDOG_SOURCE}): ${message}` }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    await log(`  alert delivery failed: ${error.message}`);
  }
  return true;
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

function expandHomePath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "~") return homedir();
  if (text.startsWith("~/")) return join(homedir(), text.slice(2));
  return text;
}

function configuredVaultPath() {
  return expandHomePath(
    process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH
      || hiveEnv.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH
      || checkoutEnv.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH
      || "~/Documents/Obsidian/hivemindos-vault",
  );
}

function normalizeMachineName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function machineIdentityStem(value) {
  const raw = String(value || "").trim();
  const dotLocal = /^(.*?)(?:-\d+)?\.local$/i.exec(raw);
  return normalizeMachineName(dotLocal ? dotLocal[1] : raw);
}

function sameMachineIdentity(a, b) {
  const na = normalizeMachineName(a);
  const nb = normalizeMachineName(b);
  if (na && na === nb) return true;
  const stem = machineIdentityStem(a);
  return Boolean(stem) && stem === machineIdentityStem(b);
}

function companyRecord(entry) {
  return entry?.company && typeof entry.company === "object" ? entry.company : entry;
}

function isAutonomousCompany(entry) {
  const company = companyRecord(entry);
  return Boolean(company?.autonomy && !company?.frozen);
}

function companyNeedsThisDriver(entry) {
  const company = companyRecord(entry);
  if (!isAutonomousCompany(company)) return false;
  const home = String(company?.homeMachineKey || "").trim();
  if (!home) return true;
  return sameMachineIdentity(home, WATCHDOG_SOURCE) || sameMachineIdentity(home, hostname());
}

function summarizeCompanyDriverNeed(entries, source) {
  const companies = Array.isArray(entries) ? entries : [];
  const active = companies.filter(isAutonomousCompany);
  const localActive = active.filter(companyNeedsThisDriver);
  return {
    available: true,
    source,
    totalCount: companies.length,
    activeCount: active.length,
    localActiveCount: localActive.length,
    localActiveNames: localActive.map((entry) => companyRecord(entry)?.name).filter(Boolean).slice(0, 3),
  };
}

async function readJsonArray(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

async function readCompanyDriverNeedFromDisk() {
  const vaultFile = resolve(configuredVaultPath(), "Operations", "Companies", "companies.json");
  try {
    return summarizeCompanyDriverNeed(await readJsonArray(vaultFile), `vault:${vaultFile}`);
  } catch (vaultError) {
    const localFile = join(STATE_DIR, "companies.json");
    try {
      return summarizeCompanyDriverNeed(await readJsonArray(localFile), `local:${localFile}`);
    } catch (localError) {
      return {
        available: false,
        source: "unavailable",
        reason: `vault ${vaultError?.code || vaultError?.message || "error"}; local ${localError?.code || localError?.message || "error"}`,
        totalCount: 0,
        activeCount: 0,
        localActiveCount: -1,
        localActiveNames: [],
      };
    }
  }
}

function companyNeedDetail(need) {
  if (!need?.available) return `company state unavailable (${need?.reason || "unknown"})`;
  const names = need.localActiveNames?.length ? `: ${need.localActiveNames.join(", ")}` : "";
  return `${need.localActiveCount} launched local/unclaimed compan${need.localActiveCount === 1 ? "y" : "ies"}${names}`;
}

function noDashboardCompanyDriverAlert(need) {
  if (!need?.available) {
    return `company autonomy driver lease is dead/stale and NO local dashboard is reachable; company state could not be checked (${need?.reason || "unknown"}). Start the HivemindOS app or dev server if companies should be running.`;
  }
  return `company autonomy driver lease is dead/stale and NO local dashboard is reachable — ${companyNeedDetail(need)} ${need.localActiveCount === 1 ? "is" : "are"} not being driven. Start the HivemindOS app or dev server.`;
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

// Root-cause analysis is deliberately downstream of the watchdog's fixed,
// deterministic remediation policy. The watchdog supplies only a bounded
// incident bundle; the dashboard redacts it, persists it, and decides whether
// the pinned loopback SRE provider is ready. No recommendation is executed here.
async function postSreInvestigation(target, due, message) {
  for (const port of APP_PORTS) {
    try {
      const { ok, status, data } = await fetchJson(`http://127.0.0.1:${port}/api/ops/investigations`, {
        method: "POST",
        headers: dashboardHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          action: "investigate",
          enqueue: true,
          incident: {
            summary: `${target.kind} remained unhealthy after deterministic remediation`,
            description: message,
            severity: "critical",
            source: "fleet-watchdog",
            target: { key: target.key, name: target.name, kind: target.kind },
            symptoms: [due.reason],
            evidence: {
              consecutiveDeepFailures: due.streak,
              remediationAttempts: due.remediations,
              lastProbeError: due.reason,
              watchdogSource: WATCHDOG_SOURCE,
            },
            remediationAttempts: [{
              action: `restart ${target.kind}`,
              outcome: `${due.remediations} attempts did not restore a passing deep probe`,
            }],
            correlationId: `fleet-watchdog:${target.key}`,
          },
        }),
      }, 8_000);
      if (ok) {
        await log(`  SRE incident ${data?.incident?.id || "captured"} queued via dashboard :${port}`);
        return true;
      }
      await log(`  SRE investigation POST :${port} returned HTTP ${status}`);
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
  const investigationPosted = await postSreInvestigation(target, due, message);
  if (!investigationPosted) await log("  SRE incident capture undelivered (no local dashboard reachable)");
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

let lastMachineDiscoverySource = "";
async function logMachineDiscoverySourceChange(source, detail = "") {
  const key = `${source}:${detail}`;
  if (lastMachineDiscoverySource === key) return;
  lastMachineDiscoverySource = key;
  await log(`fleet discovery via ${source}${detail ? ` — ${detail}` : ""}`);
}

async function writeMachinesCache(machines) {
  await mkdir(dirname(MACHINES_CACHE), { recursive: true });
  await writeFile(MACHINES_CACHE, JSON.stringify(createMachineCacheSnapshot(machines))).catch(() => {});
}

// Dashboard-less discovery: enumerate online tailnet peers and find each one's
// collector by probing the shared port range (cached port first). Lets the
// watchdog run on collector-only machines and keeps working when the local
// dashboard is closed. Phones never host collectors and are skipped.
async function discoverViaTailscale() {
  if (!shouldUseTailscaleCliFallback()) return [];
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
// tailscale CLI + port probing, then a short-lived snapshot. A legacy raw-array
// cache has no observation time, so it cannot prove that a peer is still online
// and is deliberately ignored instead of resurrecting retired/offline targets.
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
      // A reachable dashboard returning zero remote machines is authoritative:
      // cache the empty result so an older non-empty list cannot reappear.
      await writeMachinesCache(machines);
      await logMachineDiscoverySourceChange("dashboard", `:${port}; ${machines.length} remote targets`);
      return machines;
    } catch {
      // try the next port
    }
  }
  const viaTailscale = await discoverViaTailscale().catch(() => []);
  if (viaTailscale.length) {
    await writeMachinesCache(viaTailscale);
    await logMachineDiscoverySourceChange("tailscale", `${viaTailscale.length} remote targets`);
    return viaTailscale;
  }
  try {
    const cached = readFreshMachineCache(await readFile(MACHINES_CACHE, "utf8"), {
      ttlMs: MACHINE_CACHE_TTL_MS,
    });
    if (cached.fresh) {
      await logMachineDiscoverySourceChange(
        "fresh cache",
        `${cached.machines.length} remote targets; ${Math.round(cached.ageMs / 1000)}s old`,
      );
      return cached.machines;
    }
    await logMachineDiscoverySourceChange(
      "none",
      `fleet discovery cache ${cached.reason} ignored; no remote targets without fresh online proof`,
    );
  } catch (error) {
    await logMachineDiscoverySourceChange(
      "none",
      `fleet discovery cache unavailable ignored; no remote targets without fresh online proof (${error?.code || "read error"})`,
    );
  }
  return [];
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

async function ttsCatalogAlive(apiBaseUrl) {
  try {
    const { ok, data } = await fetchJson(`${apiBaseUrl}/v1/models`, {}, 5_000);
    const models = data?.data || data?.models || [];
    return ok && Array.isArray(models) && models.length > 0;
  } catch {
    return false;
  }
}

// A dashboard-advertised base can be stale: the feed's cache has resurrected
// URLs carrying a peer's local COLLECTOR port (e.g. ip:8792), dead from the
// tailnet since collectors moved behind linkd (door pinned :8787). Verify the
// base before trusting it; when it is dead, retry the same host through the
// pinned linkd door, then any machines-list linkd base on that same host.
// Same-host only — re-pointing at another machine's TTS would silently mask
// an outage. When nothing answers, keep the advertised base so a genuinely
// down TTS still probes unhealthy and alerts instead of vanishing.
async function resolveTtsBase(app, machines) {
  if (await ttsCatalogAlive(app.apiBaseUrl)) return app;
  const candidates = [];
  let advertisedHost = "";
  try {
    const url = new URL(app.machineBase);
    advertisedHost = url.hostname;
    if (url.port !== "8787") {
      url.port = "8787";
      candidates.push(url.toString().replace(/\/+$/, ""));
    }
  } catch {
    return app;
  }
  for (const machine of machines || []) {
    if (machine.online === false || !machine.collectorUrl) continue;
    try {
      if (new URL(machine.collectorUrl).hostname === advertisedHost) candidates.push(machine.collectorUrl);
    } catch {
      // unparseable collectorUrl — skip
    }
  }
  for (const machineBase of [...new Set(candidates)]) {
    const apiBaseUrl = `${machineBase}/app-proxy/8799`;
    if (await ttsCatalogAlive(apiBaseUrl)) {
      await log(`tts discovery: advertised base ${app.apiBaseUrl} unreachable — using live ${apiBaseUrl}`);
      return { ...app, apiBaseUrl, machineBase };
    }
  }
  return app;
}

async function discoverTtsApps(machines) {
  for (const port of APP_PORTS) {
    try {
      const { ok, data } = await fetchJson(`http://127.0.0.1:${port}/api/fleet/apps?fast=1`, { headers: dashboardHeaders() }, 8_000);
      if (!ok) continue;
      const advertised = (data.apps || [])
        .filter((a) => Number(a.port) === 8799 || /universal.?tts/i.test(String(a.name || "")))
        .map((a) => {
          const apiBaseUrl = String(a.apiBaseUrl || "").trim().replace(/\/+$/, "");
          return { apiBaseUrl, machineBase: apiBaseUrl.replace(/\/app-proxy\/.*$/, ""), machineName: a.machineName || a.name || "TTS" };
        })
        .filter((a) => a.apiBaseUrl && a.machineBase && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(a.machineBase));
      const apps = [];
      for (const app of advertised) {
        const resolved = await resolveTtsBase(app, machines);
        if (!apps.some((existing) => existing.apiBaseUrl === resolved.apiBaseUrl)) apps.push(resolved);
      }
      if (apps.length) {
        await logTtsSourceChange("dashboard");
        await writeFile(TTS_CACHE, JSON.stringify(createMachineCacheSnapshot(apps))).catch(() => {});
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
    await writeFile(TTS_CACHE, JSON.stringify(createMachineCacheSnapshot(probed))).catch(() => {});
    return probed;
  }
  try {
    const cached = readFreshMachineCache(await readFile(TTS_CACHE, "utf8"), {
      ttlMs: MACHINE_CACHE_TTL_MS,
    });
    if (cached.fresh) {
      await logTtsSourceChange("fresh cache", `${cached.machines.length} cached targets; ${Math.round(cached.ageMs / 1000)}s old`);
      return cached.machines;
    }
    await logTtsSourceChange("none", `TTS discovery cache ${cached.reason} ignored`);
  } catch {
    await logTtsSourceChange("none", "TTS discovery cache unavailable");
  }
  return [];
}

// TTS health. Cheap (every cycle): /v1/models reachable + populated — it fails
// (proxy EOF / connection refused) when the app + its linkd proxy are down (the
// flapping/down case that broke voice). (/v1/voices 307-redirects through the
// app-proxy, so it's unusable as a probe.) Deep (every Nth cycle): actually
// synthesize a tiny clip through EACH configured probe model that the target's
// catalog serves — this catches frontend-up but model-backend-WEDGED, where
// /v1/models still returns the static catalog and the other backends keep
// answering (a wedged backend can even return HTTP 200 with 0 bytes). Judged
// by result bytes under a generous timeout so a cold model load (slow but
// real) passes. Genericity: the shipped model/voice defaults are ONE
// deployment's ids, so configured models missing from the catalog are skipped
// (the catalog is static even through a wedge, so the filter can't hide one),
// and if none match, the first loaded catalog model is synthesized voiceless
// (provider default voice) — a deep probe must always synth SOMETHING real. A
// synth that returns HTTP 200 with too few bytes is ambiguous: an unknown
// voice produces the exact same signature as a wedged backend (live-verified
// 2026-07-03), so a voiceless retry disambiguates — retry works means the
// backend is fine and the VOICE is missing/broken, which no restart can fix.
async function probeTts(apiBaseUrl, deep) {
  let catalog = [];
  try {
    const res = await fetchJson(`${apiBaseUrl}/v1/models`, {}, 10_000);
    if (!res.ok) return { healthy: false, reason: `models HTTP ${res.status} ${String(res.text).slice(0, 50)}` };
    const models = res.data?.data || res.data?.models || [];
    if (!Array.isArray(models) || models.length === 0) return { healthy: false, reason: "models empty" };
    catalog = models
      .map((m) => ({ id: String(m?.id ?? m ?? ""), loaded: m?.loaded === true }))
      .filter((m) => m.id);
  } catch (error) {
    return { healthy: false, unreachable: true, reason: `models unreachable: ${error.message}` };
  }
  if (!deep) return { healthy: true };
  const servedIds = new Set(catalog.map((m) => m.id));
  const skipped = TTS_PROBE_MODELS.filter((id) => !servedIds.has(id));
  if (skipped.length) await logTtsSkippedModels(apiBaseUrl, skipped);
  let attempts = TTS_PROBE_MODELS
    .filter((id) => servedIds.has(id))
    .map((model) => ({ model, voice: TTS_PROBE_VOICE }));
  if (!attempts.length && catalog.length) {
    attempts = [{ model: (catalog.find((m) => m.loaded) || catalog[0]).id, voice: "" }];
  }
  for (const { model, voice } of attempts) {
    try {
      const first = await ttsSynthAttempt(apiBaseUrl, model, voice);
      if (first.ok) continue;
      if (first.httpError) return { healthy: false, severe: true, reason: `synth(${model}) ${first.httpError}` };
      if (voice) {
        const retry = await ttsSynthAttempt(apiBaseUrl, model, "");
        if (retry.ok) {
          // Voiceless works — either the voice is broken/missing on this
          // target, or the first attempt straddled a transient mid-stream
          // drop (live-observed: the same voiced request returned 0B, then
          // real PCM seconds later). One more voiced attempt disambiguates.
          const confirm = await ttsSynthAttempt(apiBaseUrl, model, voice);
          if (confirm.ok) continue;
          return {
            healthy: false,
            remediationProof: true,
            reason: `synth(${model}) returned ${first.bytes ?? 0}B then ${confirm.httpError || `${confirm.bytes ?? 0}B`} with voice "${voice}" but ${retry.bytes}B voiceless — voice missing/broken on this target; a restart won't fix it (repair the voice ref or set FLEET_WATCHDOG_TTS_VOICE)`,
          };
        }
      }
      // A working synth returns real PCM; a wedged backend returns a tiny
      // proxy-error blob or an HTTP 200 with 0 bytes (hung mid-stream).
      return { healthy: false, severe: true, reason: `synth(${model}) returned ${first.bytes}B (backend wedged)` };
    } catch (error) {
      return { healthy: false, severe: true, reason: `synth(${model}) failed: ${error.message}` };
    }
  }
  return { healthy: true };
}

async function ttsSynthAttempt(apiBaseUrl, model, voice) {
  const body = { model, input: "ok", response_format: "pcm", sample_rate: 24_000, realtime_pacing: false };
  if (voice) body.voice = voice;
  const response = await fetch(`${apiBaseUrl}/v1/audio/speech-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TTS_DEEP_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, httpError: `HTTP ${response.status} ${text.slice(0, 50)}` };
  }
  const bytes = (await response.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
  return { ok: bytes >= TTS_MIN_PCM_BYTES, bytes };
}

const ttsSkipLoggedKeys = new Set();
async function logTtsSkippedModels(apiBaseUrl, skipped) {
  const key = `${apiBaseUrl} ${skipped.join(",")}`;
  if (ttsSkipLoggedKeys.has(key)) return;
  ttsSkipLoggedKeys.add(key);
  await log(`tts deep probe: skipping ${skipped.join(", ")} — not in the catalog at ${apiBaseUrl}`);
}

async function probeCollector(collectorUrl, deep) {
  let healthData;
  try {
    const health = await fetchJson(`${collectorUrl}/health`, {}, 8_000);
    if (!health.ok || health.data?.ok === false) {
      return { healthy: false, reason: `health HTTP ${health.status} ${String(health.text).slice(0, 60)}` };
    }
    healthData = health.data;
  } catch (error) {
    return { healthy: false, unreachable: true, reason: `health unreachable: ${error.message}` };
  }
  if (!deep) return { healthy: true };
  const probeDecision = collectorChatProbeDecision(healthData, "hermes");
  if (!probeDecision.supported) {
    return { healthy: true, deepProbeSkipped: true, reason: probeDecision.reason };
  }
  try {
    const chat = await fetchJson(`${collectorUrl}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "reply with the single word OK",
        stream: false,
        agent: {
          name: "Runtime capability probe",
          runtime: "hermes",
          localDataDir: PROBE_PROFILE_DIR,
          provider: PROBE_PROVIDER,
          model: PROBE_MODEL,
        },
      }),
    }, 30_000);
    if (!chat.ok || chat.data?.ok === false) {
      return collectorChatFailureResult(chat.status, chat.data?.error || chat.text);
    }
  } catch (error) {
    return { healthy: false, severe: true, reason: `chat dispatch failed: ${error.message}` };
  }
  return { healthy: true };
}

function optionalFileText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

const loggedSelfCollectorPortMismatches = new Set();
async function probeSelfCollector(deep) {
  const candidates = localCollectorPortCandidates({
    configuredPort: collectorEnv.AGENT_TELEMETRY_PORT,
    launchAgentText: platform() === "darwin" ? optionalFileText(COLLECTOR_LAUNCH_AGENT) : "",
    systemdUnitText: platform() === "linux" ? optionalFileText(COLLECTOR_SYSTEMD_UNIT) : "",
    scanPorts: COLLECTOR_PORTS,
  });
  const probeCandidates = (items) => Promise.all(items.map(async (candidate) => {
    try {
      const response = await fetchJson(`http://127.0.0.1:${candidate.port}/health`, {}, 1_500);
      return { candidate, health: response.ok ? response.data : null };
    } catch (error) {
      return { candidate, health: null, error: error instanceof Error ? error.message : "fetch failed" };
    }
  }));
  const primaryCandidates = candidates.filter((candidate) => candidate.source !== "scan");
  let checks = await probeCandidates(primaryCandidates);
  let selected = selectHealthyLocalCollector(checks, WATCHDOG_REPO_ROOT);
  if (!selected) {
    const fallbackChecks = await probeCandidates(candidates.filter((candidate) => candidate.source === "scan"));
    checks = [...checks, ...fallbackChecks];
    selected = selectHealthyLocalCollector(checks, WATCHDOG_REPO_ROOT);
  }
  if (!selected) {
    const configured = collectorEnv.AGENT_TELEMETRY_PORT || "unset";
    return {
      healthy: false,
      reason: `no owned local collector answered /health (collector.env=${configured}; checked ${candidates.length} candidate ports)`,
    };
  }

  const configuredPort = Number.parseInt(String(collectorEnv.AGENT_TELEMETRY_PORT || ""), 10);
  if (Number.isInteger(configuredPort) && configuredPort !== selected.candidate.port) {
    const mismatchKey = `${configuredPort}->${selected.candidate.port}`;
    if (!loggedSelfCollectorPortMismatches.has(mismatchKey)) {
      loggedSelfCollectorPortMismatches.add(mismatchKey);
      await log(
        `self collector metadata stale (collector.env=${configuredPort}, live ${selected.candidate.source}=${selected.candidate.port}); using the owned live collector and refusing a false restart`,
      );
    }
  }

  if (!deep) return { healthy: true };
  return probeCollector(`http://127.0.0.1:${selected.candidate.port}`, true);
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
    // Recycle the whole job instead of only kickstarting it. A prior linkd can
    // outlive launchd ownership while still holding the control port; in that
    // state every replacement exits with EADDRINUSE and kickstart loops forever.
    // Match the installer's exact-name cleanup, wait briefly for a graceful
    // exit, then force only the stale hivemind-linkd executable before loading
    // the managed plist again.
    return [
      "U=$(id -u)",
      `PLIST="$HOME/Library/LaunchAgents/${label}.plist"`,
      `[ -f "$PLIST" ] || { echo "linkd LaunchAgent missing — rerun install-telemetry-collector.sh"; exit 1; }`,
      `launchctl bootout "gui/$U/${label}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true`,
      "pkill -x hivemind-linkd 2>/dev/null || true",
      "for I in 1 2 3 4 5; do pgrep -x hivemind-linkd >/dev/null 2>&1 || break; sleep 1; done",
      "pgrep -x hivemind-linkd >/dev/null 2>&1 && pkill -9 -x hivemind-linkd 2>/dev/null || true",
      "for I in 1 2 3; do pgrep -x hivemind-linkd >/dev/null 2>&1 || break; sleep 1; done",
      `pgrep -x hivemind-linkd >/dev/null 2>&1 && { echo "watchdog could not stop stale linkd processes"; exit 1; } || true`,
      `launchctl bootstrap "gui/$U" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || { echo "watchdog failed to load linkd LaunchAgent"; exit 1; }`,
      `launchctl kickstart -k "gui/$U/${label}" 2>/dev/null || { echo "watchdog failed to start linkd LaunchAgent"; exit 1; }`,
      "echo 'watchdog recycled linkd and cleared stale daemon processes'",
    ].join("; ");
  }
  const pattern = "universal.?tts|mlx.?audio";
  const label = kind === "tts" ? "TTS" : "collector";
  if (os.includes("linux")) {
    if (kind === "collector") {
      return "systemctl --user restart agent-telemetry.service 2>/dev/null && echo 'watchdog restarted collector' || { echo 'collector unit missing'; exit 1; }";
    }
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
  if (kind === "collector") {
    return [
      "U=$(id -u)",
      'launchctl kickstart -k "gui/$U/com.agent-control-room.telemetry" 2>/dev/null || { echo "collector LaunchAgent missing"; exit 1; }',
      "echo 'watchdog restarted collector'",
    ].join("; ");
  }
  // macOS TTS: kickstart only loaded TTS LaunchAgents.
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
  targets.push({
    key: "self:collector",
    name: "self collector",
    os: platform() === "darwin" ? "macos" : platform(),
    kind: "collector",
    local: true,
    probe: (deep) => probeSelfCollector(deep),
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
const linkdCurrentLogged = new Set();
const LINKD_REPO_ROOT = WATCHDOG_REPO_ROOT;

// Deep-cycle check: does the remote linkd daemon report a build commit, and
// did the linkd SOURCES change between that commit and the checkout its
// collector is serving from? A bare stamp-vs-HEAD mismatch is not staleness:
// the installer skips the Go rebuild when no linkd source changed, so after
// any unrelated commit every healthy box keeps its old stamp forever and a
// HEAD-equality alert can never clear (live 2026-07-03:
// hivemindos-ubuntu-8gb-hel1-2, built b535fb9 vs checkout 09dfaa9, zero linkd
// changes between). Alert only when a rebuild would actually change the
// binary — the same criterion the installer's skip uses. Pre-version linkd
// builds proxy this path through to the collector (a JSON without
// service=hivemind-linkd), which is itself the "update pending" signal.
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
    if (!repoCommit || !linkdCommit || linkdCommit === "unknown") return;
    if (repoCommit.startsWith(linkdCommit) || linkdCommit.startsWith(repoCommit)) return;
    const changed = await linkdSourcesChangedBetween(LINKD_REPO_ROOT, linkdCommit, repoCommit);
    if (changed === true) {
      staleBuildAlertAt.set(key, Date.now());
      await alert(key, `${machine.name}: linkd binary is stale (built at ${linkdCommit}, checkout at ${repoCommit}, linkd sources changed between them) — rerun install-telemetry-collector.sh there`);
    } else if (changed === null) {
      // One of the commits is unknown to THIS clone (usually: this checkout
      // is behind the remote box's). We cannot prove staleness, so don't
      // alert on it — a false "rerun the installer" is exactly the noise
      // this check exists to avoid. Log once a day instead.
      staleBuildAlertAt.set(key, Date.now());
      await log(`${machine.name}: linkd stamp ${linkdCommit} vs checkout ${repoCommit} — commit(s) unknown to this clone (behind?); cannot judge staleness, not alerting`);
    } else if (!linkdCurrentLogged.has(`${key} ${linkdCommit} ${repoCommit}`)) {
      linkdCurrentLogged.add(`${key} ${linkdCommit} ${repoCommit}`);
      await log(`${machine.name}: linkd built at ${linkdCommit}, checkout at ${repoCommit} — no linkd source changes between them; binary is current`);
    }
  } catch {
    // version telemetry is best-effort; the health probes are the gate
  }
}

const consecutiveFailures = new Map();
const cooldownUntil = new Map();
const deepProbeSkipLogged = new Set();

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
    await log("no watchdog targets discovered (no self targets and no fresh fleet discovery)");
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
      if (result.deepProbeSkipped) {
        if (!deepProbeSkipLogged.has(target.key)) {
          deepProbeSkipLogged.add(target.key);
          await log(`${target.name}: collector deep chat probe skipped — ${result.reason}`);
        }
      } else if (deep) {
        deepProbeSkipLogged.delete(target.key);
        await clearAlert(`humanfix:${target.key}`);
      }
      const unreachableAlertCleared = await clearAlert(`unreachable:${target.key}`);
      if (unreachableAlertCleared) {
        await alert(`reachable:${target.key}`, `${target.name}: reachable again after an unreachable peer outage`);
      }
      if (consecutiveFailures.get(target.key)) await log(`${target.name}: recovered`);
      consecutiveFailures.set(target.key, 0);
      // Only a passing DEEP probe proves a wedge cleared — cheap probes stay
      // green through a wedged backend (the whole NYC incident).
      if (deep) {
        const recovery = escalations.recordDeepRecovery(target.key);
        if (!result.deepProbeSkipped && recovery.wasEscalated) {
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
    if (result.authNeeded || result.remediationProof) {
      // Remediation-proof failures: restarting cannot re-authenticate a
      // logged-out tsnet node, install a missing runtime executable, or restore
      // a missing TTS voice ref — a human must act (auth URL /
      // HIVE_LINK_AUTH_KEY / runtime install / FLEET_WATCHDOG_TTS_VOICE).
      await alert(
        `${result.authNeeded ? "auth" : "humanfix"}:${target.key}`,
        `${target.name} ${result.reason}`,
        { repeatMs: result.remediationProof ? UNREACHABLE_ALERT_REPEAT_MS : ALERT_REPEAT_MS },
      );
      continue;
    }
    if (!shouldAttemptRemediation(target, result)) {
      // The collector/linkd control path is the same network path that just
      // timed out. A remote restart POST therefore cannot succeed; treating
      // the failed POST as a second incident created the Telegram storm this
      // guard prevents. Alert once per sustained outage and wait for fresh
      // discovery/a passing probe to clear the incident.
      if (fails >= threshold) {
        if (target.kind === "collector") {
          const finalProbe = await target.probe(false);
          if (finalProbe.healthy) {
            unhealthy -= 1;
            healthy += 1;
            consecutiveFailures.set(target.key, 0);
            await log(`${target.name}: recovered before unreachable alert (final safety probe passed)`);
            continue;
          }
        }
        await alert(
          `unreachable:${target.key}`,
          `${target.name} is unreachable (${result.reason}) — restart not attempted because the control path is also unreachable`,
          { repeatMs: UNREACHABLE_ALERT_REPEAT_MS },
        );
      }
      continue;
    }
    if (result.severe) escalations.recordSevereFailure(target.key, result.reason);
    if (fails >= threshold && (cooldownUntil.get(target.key) || 0) < Date.now()) {
      if (target.kind === "collector") {
        const finalProbe = await target.probe(result.severe ? deep : false);
        if (finalProbe.healthy) {
          unhealthy -= 1;
          healthy += 1;
          consecutiveFailures.set(target.key, 0);
          if (deep && result.severe) escalations.recordDeepRecovery(target.key);
          await log(`${target.name}: recovered before remediation (final safety probe passed; no restart)`);
          continue;
        }
      }
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

// ── Company autonomy driver liveness ─────────────────────────────────────────
// Launched "zero human companies" are driven by a machine-wide loop that lives
// INSIDE a dashboard server process and holds a lease file. When the holder
// process dies with no standby (e.g. the only driver-hosting dev server was
// killed), every company silently stops dispatching while still looking
// "running" in the UI — this stranded the Website Outreach Agency for ~7h on
// 2026-07-03. The watchdog is the outside observer: verify the lease holder is
// alive and fresh, revive the driver on any reachable local dashboard, and
// escalate loudly when no dashboard can host it.
//   FLEET_WATCHDOG_COMPANY_DRIVER=0        disable this check
//   FLEET_WATCHDOG_DRIVER_STALE_MS         lease freshness window (default 15 min)
const DRIVER_LEASE_PATH = join(STATE_DIR, "company-autonomy-driver.lease.json");
const DRIVER_LEASE_STALE_MS = Number(process.env.FLEET_WATCHDOG_DRIVER_STALE_MS || 15 * 60_000);
const DRIVER_CHECK_ENABLED = process.env.FLEET_WATCHDOG_COMPANY_DRIVER !== "0";

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // EPERM = alive but not ours
  }
}

// Healthy = holder pid alive AND lease renewed recently. The driver renews the
// lease every loop iteration (≤5 min ticking, ≤60s standby), so a 15-min-old
// renewedAt means the loop is wedged or gone even if the pid survives.
function driverLeaseHealthy() {
  try {
    const parsed = JSON.parse(readFileSync(DRIVER_LEASE_PATH, "utf8"));
    if (!Number.isInteger(parsed?.pid) || parsed.pid <= 0) return false;
    if (!pidAlive(parsed.pid)) return false;
    return Date.now() - Number(parsed.renewedAt || 0) < DRIVER_LEASE_STALE_MS;
  } catch {
    return false; // missing/corrupt lease → treat as not driven; dashboards decide below
  }
}

async function checkCompanyAutonomyDriver() {
  if (!DRIVER_CHECK_ENABLED) return;
  if (driverLeaseHealthy()) return;
  let sawDashboard = false;
  let autonomousCompanies = -1;
  const candidateFailures = [];
  for (const port of APP_PORTS) {
    // Next dev servers bind IPv4 or IPv6 loopback depending on how they were
    // spawned (the Tauri-launched dev server answers ONLY on [::1] — probing
    // 127.0.0.1 alone missed a live dashboard in the 2026-07-03 drill).
    for (const host of ["127.0.0.1", "[::1]"]) {
      try {
        // GET /api/companies doubles as the self-heal hook: the route revives the
        // driver whenever an autonomous company exists. The response also tells
        // us whether anything needs driving at all.
        const companies = await fetchJson(`http://${host}:${port}/api/companies`, { headers: dashboardHeaders() }, 15_000);
        if (!companies.ok || !Array.isArray(companies.data?.companies)) {
          candidateFailures.push(`${host}:${port} HTTP ${companies.status}`);
          continue;
        }
        sawDashboard = true;
        const need = summarizeCompanyDriverNeed(companies.data.companies, `dashboard:${host}:${port}`);
        autonomousCompanies = need.localActiveCount;
        if (autonomousCompanies === 0) {
          await log(`company driver: lease dead/stale but ${host}:${port} reports no launched companies for ${WATCHDOG_SOURCE} (${need.activeCount} active total) — no alert`);
          return;
        }
        const started = await fetchJson(`http://${host}:${port}/api/company-autonomy-driver`, {
          method: "POST",
          headers: dashboardHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ action: "start" }),
        }, 15_000);
        if (started.ok && started.data?.status === "running") {
          await log(`company driver: lease was dead/stale — ensured driver running on dashboard ${host}:${port}`);
          return;
        }
        candidateFailures.push(`${host}:${port} start→${started.status}/${started.data?.status ?? "?"}`);
      } catch (error) {
        candidateFailures.push(`${host}:${port} ${error?.cause?.code || error?.code || error?.name || "error"}`);
      }
    }
  }
  // The failure detail is the difference between "no dashboard is running" and
  // "a dashboard is up but refusing us" (auth, bind family, proxy) — log it.
  await log(`company driver check found no usable dashboard: ${candidateFailures.join(", ")}`);
  if (!sawDashboard) {
    const need = await readCompanyDriverNeedFromDisk();
    if (need.available && need.localActiveCount === 0) {
      await log(`company driver: lease dead/stale and no dashboard is reachable, but disk state reports no launched companies for ${WATCHDOG_SOURCE} (${need.activeCount} active total via ${need.source}) — no alert`);
      return;
    }
    await alert(
      "company-driver-down",
      noDashboardCompanyDriverAlert(need),
    );
    return;
  }
  await alert(
    "company-driver-down",
    `company autonomy driver could not be revived via any local dashboard (${APP_PORTS.map((p) => `:${p}`).join(", ")}) — ${autonomousCompanies} launched local/unclaimed compan${autonomousCompanies === 1 ? "y is" : "ies are"} stalled.`,
  );
  await postDashboardNotification(
    "Company autonomy driver down",
    "The machine-wide company autonomy driver is not running and could not be restarted automatically. Launched zero-human companies are NOT dispatching work until it is revived.",
  );
}

await log(`fleet-health-watchdog up — source=${WATCHDOG_SOURCE}, poll ${POLL_MS}ms, threshold ${FAIL_THRESHOLD}, cooldown ${COOLDOWN_MS}ms, deep every ${CHAT_EVERY} cycles, self=${SELF_ENABLED ? "on" : "off"}, alerts=${TELEGRAM_CHAT_ID && TELEGRAM_BOT_TOKEN ? "telegram" : "log-only"}, escalate after ${ESCALATE_AFTER} deep fails (dashboard token ${DASHBOARD_DEVICE_TOKEN ? "found" : "MISSING — dashboard notifications will 401 if auth is on"})${RUN_ONCE ? " (ONCE)" : ""}`);
let cycle = 0;
for (;;) {
  try {
    await runCycle(cycle);
  } catch (error) {
    await log(`cycle error: ${error.message}`);
  }
  try {
    await checkCompanyAutonomyDriver();
  } catch (error) {
    await log(`company driver check error: ${error.message}`);
  }
  cycle += 1;
  if (RUN_ONCE) break;
  await sleep(POLL_MS);
}
