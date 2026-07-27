#!/usr/bin/env node
// Run a command on a fleet machine via the in-app shell (/api/fleet/shell -> linkd PTY).
// Usage: node scripts/agent-shell-exec.mjs --collector http://host:8787 --cmd "..." [--timeout 180] [--session id]
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; }

const DASH = (process.env.DASHBOARD_URL || "http://127.0.0.1:5021").replace(/\/+$/, "");
const collector = arg("collector");
const cmd = arg("cmd");
const timeoutMs = Number(arg("timeout", 180)) * 1000;
const session = arg("session", `agentshell-${Math.random().toString(36).slice(2, 10)}`);
if (!collector || !cmd) { console.error("need --collector and --cmd"); process.exit(2); }

const raw = await readFile(new URL("../.env.local", import.meta.url), "utf8").catch(() => "");
const TOKEN = (raw.match(/^HIVEMINDOS_DASHBOARD_DEVICE_TOKEN=(.*)$/m)?.[1] || "").trim().replace(/^["']|["']$/g, "");
const headers = { "x-hivemindos-device-token": TOKEN, "content-type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getHistory() {
  const q = `collectorUrl=${encodeURIComponent(collector)}&session=${encodeURIComponent(session)}`;
  const res = await fetch(`${DASH}/api/fleet/shell?${q}`, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  return res.json();
}

// Send the command, then poll history until the shell is idle.
await fetch(`${DASH}/api/fleet/shell`, { method: "POST", headers, body: JSON.stringify({ collectorUrl: collector, session, action: "command", command: cmd }) });
const deadline = Date.now() + timeoutMs;
let lines = [];
await sleep(1500);
while (Date.now() < deadline) {
  const h = await getHistory().catch(() => null);
  if (h?.ok === false) { console.error("shell error:", h.error); process.exit(1); }
  lines = h?.lines || lines;
  if (h && h.busy === false) break;
  await sleep(3000);
}
console.log(lines.join("\n"));
