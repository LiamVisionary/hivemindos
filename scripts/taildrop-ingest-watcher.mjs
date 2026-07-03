#!/usr/bin/env node
// Taildrop ingest watcher — "share from your phone straight into the hive".
//
// Tailscale's native file transfer (Taildrop) delivers files into a per-machine
// inbox that nothing reads by default. This watcher drains that inbox into a
// HiveDrop ingest directory and announces each arrival in the dashboard
// notifications feed, so the iOS/Android share sheet (Share → Tailscale →
// <this machine>) becomes a first-class way to drop files into the fleet.
//
// It deliberately complements — not replaces — the HiveDrop HTTP rail
// (/api/fleet/send-file → linkd /_hivemind/file): that rail reaches
// linkd-only machines, carries destination directories and progress, and works
// from the dashboard. Taildrop is the phone-native ingest edge.
//
// Mechanics — two delivery variants, both covered:
//   1. CLI inbox (Linux, headless tailscaled): `tailscale file get --wait
//      <dir>` blocks until at least one file is in the Taildrop inbox, moves
//      everything into <dir> (renaming on conflict), then exits — we loop it.
//      If the CLI errors (tailscaled down / logged out) we log and back off.
//   2. GUI-owned inbox (macOS Tailscale.app): the GUI claims received files
//      itself and saves them to its configured folder — the CLI inbox stays
//      empty forever (verified live 2026-07-03). For this variant, point the
//      GUI's "save incoming files" folder at the ingest dir once (Tailscale →
//      Settings), and the watcher's directory watch announces arrivals.
//
// Env knobs (all optional):
//   HIVE_TAILDROP_INGEST_DIR   where received files land (default ~/HiveDrop)
//   HIVE_TAILDROP_RETRY_MS     backoff after an error or empty run (default 30000)
//   HIVE_TAILDROP_APP_PORTS    local dashboard ports for notifications
//                              (default 5020,5021,5111,5121,3000)
//   HIVE_TAILDROP_ONCE=1       run a single drain pass and exit (for testing)

import { mkdir, readdir, appendFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, watch } from "node:fs";

const execFileAsync = promisify(execFile);

const INGEST_DIR = process.env.HIVE_TAILDROP_INGEST_DIR || join(homedir(), "HiveDrop");
const RETRY_MS = Number(process.env.HIVE_TAILDROP_RETRY_MS || 30_000);
const APP_PORTS = String(process.env.HIVE_TAILDROP_APP_PORTS || "5020,5021,5111,5121,3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const RUN_ONCE = process.env.HIVE_TAILDROP_ONCE === "1";

const STATE_DIR = join(homedir(), ".hivemindos");
const LOG_PATH = join(STATE_DIR, "taildrop-ingest.log");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await appendFile(LOG_PATH, line);
  } catch {
    // logging must never crash the watcher
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
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[line.slice(0, eq).trim()] = value;
    }
    return env;
  } catch {
    return {};
  }
}

// Same token chain the fleet-health-watchdog uses for dashboard APIs.
const hiveEnv = parseEnvFile(join(STATE_DIR, ".env"));
const DASHBOARD_DEVICE_TOKEN = (
  process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || hiveEnv.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN
  || ""
).trim();

function tailscaleCliCandidates() {
  return [
    process.env.HIVE_TAILSCALE_CLI || "",
    "tailscale",
    "/opt/homebrew/bin/tailscale",
    "/opt/homebrew/opt/tailscale/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/usr/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ].filter(Boolean);
}

async function resolveTailscaleCli() {
  for (const cli of tailscaleCliCandidates()) {
    try {
      await execFileAsync(cli, ["version"], { timeout: 10_000 });
      return cli;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Announce an arrival where a human looks: the dashboard notification feed.
// Best-effort — the file is already safe on disk either way.
async function postDashboardNotification(fileName) {
  for (const port of APP_PORTS) {
    try {
      const headers = { "content-type": "application/json" };
      if (DASHBOARD_DEVICE_TOKEN) headers["x-hivemindos-device-token"] = DASHBOARD_DEVICE_TOKEN;
      const response = await fetch(`http://127.0.0.1:${port}/api/notifications`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          notification: {
            title: `HiveDrop: received "${fileName}" via Taildrop`,
            body: `Saved to ${INGEST_DIR}. Sent from another of your Tailscale devices (share sheet or tailscale file cp).`,
            kind: "info",
            agentId: "taildrop-ingest",
            agentName: "HiveDrop",
            source: "taildrop-ingest",
            tags: ["hivedrop", "taildrop"],
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return true;
    } catch {
      // no dashboard on this port — try the next
    }
  }
  return false;
}

async function listDir(dir) {
  try {
    return new Set(await readdir(dir));
  } catch {
    return new Set();
  }
}

// One drain pass: block until the inbox has files, move them into INGEST_DIR,
// report what arrived. Returns { received: string[] } or { error }.
export async function drainOnce(cli) {
  await mkdir(INGEST_DIR, { recursive: true });
  const before = await listDir(INGEST_DIR);
  try {
    await execFileAsync(cli, ["file", "get", "--wait", "--conflict=rename", INGEST_DIR], {
      timeout: 24 * 60 * 60_000, // --wait blocks until a file arrives; a day per cycle is fine
      maxBuffer: 1_000_000,
    });
  } catch (error) {
    return { error: String(error.stderr || error.message || error).trim().slice(0, 200) };
  }
  const after = await listDir(INGEST_DIR);
  const received = [...after].filter((name) => !before.has(name));
  return { received };
}

// Names already announced (or present before we started) — the inbox drain
// and the directory watch both feed the same dedupe so a file that the drain
// moved into the watched dir is not announced twice.
const announced = new Set();

async function announce(name) {
  if (announced.has(name)) return;
  announced.add(name);
  await log(`received ${name} -> ${join(INGEST_DIR, name)}`);
  await postDashboardNotification(name);
}

function looksPartial(name) {
  return name.startsWith(".") || /\.(download|part|crdownload|tmp)$/i.test(name);
}

// Directory watch: catches files delivered INTO the ingest dir by something
// other than our own drain — chiefly the macOS GUI variant configured to save
// incoming files there. Waits for the size to hold still before announcing so
// a mid-write file is not reported early.
function watchIngestDir() {
  let scanning = false;
  const scan = async () => {
    if (scanning) return;
    scanning = true;
    try {
      for (const name of await listDir(INGEST_DIR)) {
        if (announced.has(name) || looksPartial(name)) continue;
        const path = join(INGEST_DIR, name);
        try {
          const first = await stat(path);
          await sleep(1_500);
          const second = await stat(path);
          if (first.size === second.size && second.isFile()) {
            await announce(name);
          }
        } catch {
          // vanished mid-scan (renamed away or partial cleanup) — skip
        }
      }
    } finally {
      scanning = false;
    }
  };
  try {
    watch(INGEST_DIR, () => { void scan(); });
  } catch (error) {
    void log(`ingest dir watch unavailable (${error.message}); relying on inbox drain only`);
  }
}

async function main() {
  const cli = await resolveTailscaleCli();
  if (!cli) {
    await log("tailscale CLI not found — install Tailscale or set HIVE_TAILSCALE_CLI; exiting");
    process.exit(1);
  }
  await mkdir(INGEST_DIR, { recursive: true });
  for (const name of await listDir(INGEST_DIR)) announced.add(name); // pre-existing files are old news
  await log(`taildrop-ingest up — inbox drains to ${INGEST_DIR} (cli: ${cli})${RUN_ONCE ? " (ONCE)" : ""}`);
  if (!RUN_ONCE) watchIngestDir();
  for (;;) {
    const startedAt = Date.now();
    const result = await drainOnce(cli);
    if (result.error) {
      // Common cases: tailscaled down / logged out, or a macOS GUI variant
      // that owns the inbox (nothing for the CLI to drain — the directory
      // watch carries that variant). Log once per pass and back off.
      await log(`drain error: ${result.error}; retrying in ${Math.round(RETRY_MS / 1000)}s`);
      if (RUN_ONCE) break;
      await sleep(RETRY_MS);
      continue;
    }
    for (const name of result.received) {
      await announce(name);
    }
    if (RUN_ONCE) break;
    // A --wait that returned instantly with nothing new means this variant
    // does not block (or the inbox is drained elsewhere) — avoid hot-looping.
    if (result.received.length === 0 && Date.now() - startedAt < 2_000) {
      await sleep(RETRY_MS);
    }
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  await main();
}
