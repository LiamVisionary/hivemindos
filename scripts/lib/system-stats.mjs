// Host resource telemetry for the collector /health `system` object.
//
// Extracted from agent-telemetry-collector.mjs so that oversized legacy file
// stops growing (CLAUDE.md file-size rule). Everything here is pure,
// cross-platform (macOS / Linux, graceful null elsewhere), and non-blocking:
// each probe does a single counter read, and disk/network throughput is derived
// from deltas between successive samples. Metrics a platform can't measure
// sudo-free (temperature and disk I/O on macOS) return null rather than a
// fabricated value.
//
// The exported entry point is systemStats(); the discovery route forwards its
// result verbatim to the dashboard (src/app/api/fleet/discover/route.ts), typed
// as CollectorSystemStats / MachineSystemStats / FleetMachineSystem.

import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { arch, cpus, freemem, loadavg, platform, release, totalmem, uptime as osUptime } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const bytesToGb = (bytes) => Math.round((bytes / 1024 ** 3) * 10) / 10;

async function darwinRamUsedBytes() {
  const { stdout } = await execFileAsync("vm_stat", [], { timeout: 4_000 });
  const pageSize = Number(
    /page size of (\d+) bytes/.exec(stdout)?.[1] || 16_384,
  );
  const pages = (label) =>
    Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)?.[1] || 0);
  // Approximates Activity Monitor's "Memory Used": active + wired + compressed.
  return (
    (pages("Pages active") +
      pages("Pages wired down") +
      pages("Pages occupied by compressor")) *
    pageSize
  );
}

async function linuxRamUsedBytes() {
  const meminfo = await readFile("/proc/meminfo", "utf8");
  const kb = (label) =>
    Number(new RegExp(`^${label}:\\s+(\\d+) kB`, "m").exec(meminfo)?.[1] || 0);
  const totalKb = kb("MemTotal");
  const availableKb = kb("MemAvailable");
  if (!totalKb || !availableKb)
    throw new Error("MemAvailable missing from /proc/meminfo.");
  return (totalKb - availableKb) * 1024;
}

async function rootDiskUsage() {
  // On macOS "/" is the sealed system volume; user data lives on the Data volume.
  const target = platform() === "darwin" ? "/System/Volumes/Data" : "/";
  const { stdout } = await execFileAsync("df", ["-kP", target], {
    timeout: 4_000,
  });
  const parts = (stdout.trim().split("\n").at(-1) || "").split(/\s+/);
  const totalKb = Number(parts[1] || 0);
  const usedKb = Number(parts[2] || 0);
  if (!totalKb) return null;
  return { totalKb, usedKb };
}

// macOS "Cached Files" ≈ file-backed + purgeable pages.
async function darwinCacheBytes() {
  const { stdout } = await execFileAsync("vm_stat", [], { timeout: 4_000 });
  const pageSize = Number(
    /page size of (\d+) bytes/.exec(stdout)?.[1] || 16_384,
  );
  const pages = (label) =>
    Number(new RegExp(`${label}:\\s+(\\d+)`).exec(stdout)?.[1] || 0);
  return (pages("File-backed pages") + pages("Pages purgeable")) * pageSize;
}

// Swap usage. darwin: sysctl vm.swapusage; linux: /proc/meminfo. null elsewhere.
async function readSwap() {
  if (platform() === "darwin") {
    const { stdout } = await execFileAsync("sysctl", ["-n", "vm.swapusage"], {
      timeout: 4_000,
    });
    // "total = 2048.00M  used = 512.00M  free = 1536.00M  (encrypted)"
    const bytesFor = (label) => {
      const match = new RegExp(`${label}\\s*=\\s*([\\d.]+)([KMG])`).exec(stdout);
      if (!match) return null;
      const unit = match[2];
      const mult = unit === "G" ? 1024 ** 3 : unit === "M" ? 1024 ** 2 : 1024;
      return Number(match[1]) * mult;
    };
    const total = bytesFor("total");
    if (total == null) return null;
    const used = bytesFor("used");
    return {
      usedGb: used == null ? null : bytesToGb(used),
      totalGb: bytesToGb(total),
    };
  }
  if (platform() === "linux") {
    const meminfo = await readFile("/proc/meminfo", "utf8");
    const kb = (label) =>
      Number(new RegExp(`^${label}:\\s+(\\d+) kB`, "m").exec(meminfo)?.[1] || 0);
    const total = kb("SwapTotal") * 1024;
    const free = kb("SwapFree") * 1024;
    if (!total) return { usedGb: 0, totalGb: 0 };
    return { usedGb: bytesToGb(total - free), totalGb: bytesToGb(total) };
  }
  return null;
}

async function readCacheGb() {
  if (platform() === "darwin") return bytesToGb(await darwinCacheBytes());
  if (platform() === "linux") {
    const meminfo = await readFile("/proc/meminfo", "utf8");
    const kb = (label) =>
      Number(new RegExp(`^${label}:\\s+(\\d+) kB`, "m").exec(meminfo)?.[1] || 0);
    return bytesToGb((kb("Cached") + kb("Buffers") + kb("SReclaimable")) * 1024);
  }
  return null;
}

// CPU/SoC temperature. linux exposes it sudo-free via thermal zones; macOS
// needs root (powermetrics) so it stays null there — an honest gap, not a fake.
async function readTempC() {
  if (platform() !== "linux") return null;
  const base = "/sys/class/thermal";
  const zones = await readdir(base).catch(() => []);
  let max = null;
  for (const zone of zones) {
    if (!zone.startsWith("thermal_zone")) continue;
    const raw = await readFile(join(base, zone, "temp"), "utf8").catch(() => "");
    const milli = Number(raw.trim());
    if (Number.isFinite(milli) && milli > 0) {
      const celsius = milli / 1000;
      if (max == null || celsius > max) max = celsius;
    }
  }
  return max == null ? null : Math.round(max);
}

// Cumulative disk-sector counters (linux /proc/diskstats). Whole disks only, so
// partitions don't double-count. Rates are derived from deltas between samples.
async function readDiskCounters() {
  if (platform() !== "linux") return null;
  const raw = await readFile("/proc/diskstats", "utf8").catch(() => "");
  if (!raw) return null;
  const wholeDisk = /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+|xvd[a-z]+|mmcblk\d+|hd[a-z]+)$/;
  let readBytes = 0;
  let writeBytes = 0;
  let matched = false;
  for (const line of raw.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || !wholeDisk.test(fields[2])) continue;
    readBytes += Number(fields[5]) * 512;
    writeBytes += Number(fields[9]) * 512;
    matched = true;
  }
  return matched ? { readBytes, writeBytes } : null;
}

// Cumulative network byte counters across non-loopback interfaces.
async function readNetCounters() {
  if (platform() === "linux") {
    const raw = await readFile("/proc/net/dev", "utf8").catch(() => "");
    if (!raw) return null;
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of raw.split("\n")) {
      const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
      if (!match || match[1].trim() === "lo") continue;
      const cols = match[2].trim().split(/\s+/).map(Number);
      rxBytes += cols[0] || 0;
      txBytes += cols[8] || 0;
    }
    return { rxBytes, txBytes };
  }
  if (platform() === "darwin") {
    const { stdout } = await execFileAsync("netstat", ["-ibn"], {
      timeout: 4_000,
    });
    const lines = stdout.split("\n");
    // Columns end with: … Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll. Index from
    // the RIGHT (Coll is always last) because the Link# rows leave Address blank,
    // which shifts a left-anchored index by one. → Ibytes = len-5, Obytes = len-2.
    // netstat prints one row per address; the byte counters repeat per interface,
    // so key by interface and take the max to avoid summing the same NIC twice.
    const perIface = new Map();
    for (const line of lines.slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 7) continue;
      const iface = cols[0];
      if (!iface || iface.startsWith("lo")) continue;
      const ib = Number(cols[cols.length - 5]);
      const ob = Number(cols[cols.length - 2]);
      if (!Number.isFinite(ib) || !Number.isFinite(ob)) continue;
      const prev = perIface.get(iface);
      if (!prev || ib > prev.rxBytes) perIface.set(iface, { rxBytes: ib, txBytes: ob });
    }
    let rxBytes = 0;
    let txBytes = 0;
    for (const entry of perIface.values()) {
      rxBytes += entry.rxBytes;
      txBytes += entry.txBytes;
    }
    return { rxBytes, txBytes };
  }
  return null;
}

// Total process count + the top resident processes by RSS, from one ps walk.
async function readProcessTable() {
  const { stdout } = await execFileAsync("ps", ["-axo", "rss=,comm="], {
    timeout: 4_000,
    maxBuffer: 4_000_000,
  });
  const rows = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const rssKb = Number(match[1]);
    const name = basename(match[2].trim().split(" ")[0]) || match[2].trim();
    if (!name) continue;
    rows.push({ name, rssMb: Math.round((rssKb / 1024) * 10) / 10 });
  }
  if (!rows.length) return null;
  const top = [...rows].sort((left, right) => right.rssMb - left.rssMb).slice(0, 6);
  return { count: rows.length, top };
}

// Previous cumulative-counter sample, for deriving disk/network throughput.
let ioCounterSample = null;
// Short single-flight cache so concurrent /health probes don't recompute (and
// so the rate deltas span a real interval instead of a few milliseconds).
let systemStatsCache = null;
let systemStatsInflight = null;

async function computeSystemStats() {
  const toGb = bytesToGb;
  const clampPct = (value) => Math.max(0, Math.min(100, Math.round(value)));
  const cores = cpus();
  const coreCount = cores.length || 1;
  const load1m = loadavg()[0];
  const ramTotal = totalmem();
  const [ramUsed, disk, swap, cacheGb, tempC, procTable, diskCounters, netCounters] =
    await Promise.all([
      (platform() === "darwin"
        ? darwinRamUsedBytes()
        : platform() === "linux"
          ? linuxRamUsedBytes()
          : Promise.resolve(ramTotal - freemem())
      ).catch(() => ramTotal - freemem()),
      rootDiskUsage().catch(() => null),
      readSwap().catch(() => null),
      readCacheGb().catch(() => null),
      readTempC().catch(() => null),
      readProcessTable().catch(() => null),
      readDiskCounters().catch(() => null),
      readNetCounters().catch(() => null),
    ]);

  const now = Date.now();
  let diskReadMBs = null;
  let diskWriteMBs = null;
  let netRxMBs = null;
  let netTxMBs = null;
  const prev = ioCounterSample;
  if (prev) {
    const dtSec = (now - prev.at) / 1000;
    if (dtSec >= 0.25) {
      // Guard against counter resets (reboot, tailscaled restart) → floor at 0.
      const rate = (cur, was) =>
        cur != null && was != null && cur >= was
          ? Math.round(((cur - was) / dtSec / 1e6) * 100) / 100
          : null;
      if (diskCounters && prev.disk) {
        diskReadMBs = rate(diskCounters.readBytes, prev.disk.readBytes);
        diskWriteMBs = rate(diskCounters.writeBytes, prev.disk.writeBytes);
      }
      if (netCounters && prev.net) {
        netRxMBs = rate(netCounters.rxBytes, prev.net.rxBytes);
        netTxMBs = rate(netCounters.txBytes, prev.net.txBytes);
      }
    }
  }
  ioCounterSample = { at: now, disk: diskCounters, net: netCounters };

  return {
    checkedAt: now,
    cpuPct: clampPct((load1m / coreCount) * 100),
    cpuCores: coreCount,
    cpuModel: cores[0]?.model?.trim() || "",
    loadAvg1m: Math.round(load1m * 100) / 100,
    ramPct: ramTotal ? clampPct((ramUsed / ramTotal) * 100) : 0,
    ramUsedGb: toGb(ramUsed),
    ramTotalGb: toGb(ramTotal),
    diskPct: disk ? clampPct((disk.usedKb / disk.totalKb) * 100) : null,
    diskUsedGb: disk ? toGb(disk.usedKb * 1024) : null,
    diskTotalGb: disk ? toGb(disk.totalKb * 1024) : null,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    uptimeSec: Math.round(osUptime()),
    swapUsedGb: swap ? swap.usedGb : null,
    swapTotalGb: swap ? swap.totalGb : null,
    cacheGb,
    tempC,
    diskReadMBs,
    diskWriteMBs,
    netRxMBs,
    netTxMBs,
    procCount: procTable ? procTable.count : null,
    topProcesses: procTable ? procTable.top : [],
  };
}

// ── rolling history for sparklines ──────────────────────────────────────────
// Real recent samples the collector accumulates *while it is being actively
// polled*, so the dashboard shows a genuine recent trend line immediately
// instead of one that only fills in over ~12 minutes of 15s live polling. Only
// the cheap-ish cpu/ram/net subset is sampled on a short timer (the heavier
// ps/df/swap probes stay on-demand per /health). The buffer + single timer live
// on globalThis so a collector self-reload reuses them instead of leaking
// intervals, and the timer idles when nothing has polled /health recently.
const HISTORY_MAX = 48;
const HISTORY_SAMPLE_MS = 4_000;
const HISTORY_ACTIVE_WINDOW_MS = 90_000;

const historyState = (globalThis.__hivemindSysHistory ??= {
  samples: [],
  lastRequestAt: 0,
  prevNet: null,
});

async function sampleHistoryPoint() {
  const cores = cpus();
  const coreCount = cores.length || 1;
  const cpuPct = Math.max(0, Math.min(100, Math.round((loadavg()[0] / coreCount) * 100)));
  const ramTotal = totalmem();
  const ramUsed = platform() === "darwin"
    ? await darwinRamUsedBytes().catch(() => ramTotal - freemem())
    : platform() === "linux"
      ? await linuxRamUsedBytes().catch(() => ramTotal - freemem())
      : ramTotal - freemem();
  const ramPct = ramTotal ? Math.max(0, Math.min(100, Math.round((ramUsed / ramTotal) * 100))) : 0;
  const net = await readNetCounters().catch(() => null);
  const now = Date.now();
  let netRx = 0;
  let netTx = 0;
  if (net && historyState.prevNet) {
    const dtSec = (now - historyState.prevNet.at) / 1000;
    if (dtSec >= 0.25) {
      const rate = (cur, was) => (cur >= was ? Math.round(((cur - was) / dtSec / 1e6) * 100) / 100 : 0);
      netRx = rate(net.rxBytes, historyState.prevNet.rxBytes);
      netTx = rate(net.txBytes, historyState.prevNet.txBytes);
    }
  }
  if (net) historyState.prevNet = { at: now, rxBytes: net.rxBytes, txBytes: net.txBytes };
  historyState.samples.push({ cpu: cpuPct, ram: ramPct, netRx, netTx });
  if (historyState.samples.length > HISTORY_MAX) {
    historyState.samples.splice(0, historyState.samples.length - HISTORY_MAX);
  }
}

if (!globalThis.__hivemindSysHistoryTimer) {
  const timer = setInterval(() => {
    if (Date.now() - historyState.lastRequestAt > HISTORY_ACTIVE_WINDOW_MS) return;
    void sampleHistoryPoint();
  }, HISTORY_SAMPLE_MS);
  if (typeof timer.unref === "function") timer.unref();
  globalThis.__hivemindSysHistoryTimer = timer;
}

function historyArrays() {
  const s = historyState.samples;
  if (s.length < 2) return undefined;
  return {
    cpu: s.map((point) => point.cpu),
    ram: s.map((point) => point.ram),
    netRx: s.map((point) => point.netRx),
    netTx: s.map((point) => point.netTx),
  };
}

export async function systemStats() {
  historyState.lastRequestAt = Date.now();
  // History is attached fresh on every call (never cached) so the sparkline is
  // as current as the sampler; the heavy point-in-time stats keep their 3s cache.
  const withHistory = (value) => {
    const history = historyArrays();
    return history ? { ...value, history } : value;
  };
  const now = Date.now();
  if (systemStatsCache && now - systemStatsCache.at < 3_000) {
    return withHistory(systemStatsCache.value);
  }
  if (systemStatsInflight) return systemStatsInflight.then(withHistory);
  systemStatsInflight = computeSystemStats()
    .then((value) => {
      systemStatsCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      systemStatsInflight = null;
    });
  return systemStatsInflight.then(withHistory);
}
