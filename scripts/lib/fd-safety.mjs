// Helpers born from the 2026-07-03 NYC collector fd-exhaustion incident
// (burst fd-table pegging made child spawns die with EBADF and killed the
// fleet-critical daemon): keep bulk fs work from pegging the process fd
// table, and make fd pressure visible in telemetry.
import { readdir } from "node:fs/promises";

// Run tasks over items with a fixed-size worker pool. A bare Promise.all over
// thousands of fs-touching tasks opens fds far faster than it closes them
// (libuv's FIFO threadpool completes all the opens before the reads/closes),
// which is how a 28k-dir skills scan exhausted the fd table on the NYC box.
export async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// /dev/fd is the process's OWN descriptor table on macOS and Linux (Linux
// aliases /proc/self/fd) — a cheap fd count with no lsof spawn. The
// active-resource breakdown points at what is holding fds (sockets vs child
// processes vs timers), so a leak shows up in fleet telemetry before it kills.
export async function processResourceStats() {
  const openFds = await readdir("/dev/fd")
    .then((entries) => entries.length)
    .catch(() => null);
  const activeResources = {};
  try {
    for (const kind of process.getActiveResourcesInfo()) {
      activeResources[kind] = (activeResources[kind] || 0) + 1;
    }
  } catch {
    // experimental API — absence just means no breakdown
  }
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    openFds,
    activeResources,
  };
}
