import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { collectorManualUpdateCommand } from "./collector-update-command.mjs";

// Version identity for git-free checkouts. The desktop app's setup bootstraps
// ~/.hivemindos/app-source from the GitHub main archive (no git on a stock
// Windows box), so `git rev-parse` yields nothing there. The archive
// downloaders record the source commit in this marker instead, and the
// collector falls back to it so the fleet dashboard can still tell "up to
// date" from "update available" and verify an update actually landed.
export const SOURCE_COMMIT_MARKER_FILENAME = ".hivemindos-source-commit";

const LATEST_MAIN_COMMIT_URL =
  "https://api.github.com/repos/LiamVisionary/hivemindos/commits/main";
// One lightweight probe per 10 minutes keeps a fleet of collectors far under
// GitHub's unauthenticated API limit (60/hour/IP) even with forced version
// refreshes; git checkouts never hit this path (they use `git ls-remote`).
const LATEST_COMMIT_CACHE_MS = 10 * 60_000;

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

export async function readSourceCommitMarker(appDir, dependencies = {}) {
  const read = dependencies.readFileImpl ?? readFile;
  try {
    const raw = await read(join(appDir, SOURCE_COMMIT_MARKER_FILENAME), "utf8");
    const value = String(raw).trim().toLowerCase();
    return COMMIT_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}

let latestMainCommitCache = null;

export async function fetchLatestMainCommit(dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const cacheMs = dependencies.cacheMs ?? LATEST_COMMIT_CACHE_MS;
  if (latestMainCommitCache && now() - latestMainCommitCache.checkedAt < cacheMs) {
    return latestMainCommitCache.value;
  }
  let value = "";
  try {
    const response = await fetchImpl(LATEST_MAIN_COMMIT_URL, {
      headers: {
        // This media type returns the bare commit SHA as text, no JSON parsing.
        accept: "application/vnd.github.sha",
        "user-agent": "hivemindos-collector",
      },
      signal: AbortSignal.timeout(dependencies.timeoutMs ?? 8_000),
    });
    if (response?.ok) {
      const text = String(await response.text()).trim().toLowerCase();
      if (COMMIT_PATTERN.test(text)) value = text;
    }
  } catch {
    // Offline or rate-limited: cache the miss too, so we do not hammer the API.
  }
  latestMainCommitCache = { checkedAt: now(), value };
  return value;
}

export function resetLatestMainCommitCacheForTests() {
  latestMainCommitCache = null;
}

// Untracked agent droppings must not mark the checkout dirty. Chat App
// Builder projects are created under <working-directory>/scratchpad/, and on
// fleet machines the working directory is often this checkout — dirty=true
// from those files made every fleet Update run a full reinstall that
// restarted the collector (killing app-preview children) without ever
// cleaning the files, looping forever (2026-07-18). scratchpad/ is gitignored
// now, but deployed checkouts only pick that up after their next pull, so the
// dirty computation excludes untracked scratchpad entries directly. Tracked
// files still count regardless of path: a modified tracked file is real local
// divergence the fleet should see.
const IGNORED_UNTRACKED_SEGMENTS = new Set(["scratchpad"]);

export function collectorCheckoutDirty(statusText) {
  return String(statusText || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .some((line) => {
      // Porcelain untracked entries are `?? <path>`; the collector trims the
      // whole output, so other status codes may have lost their leading space
      // on the first line — anything not untracked counts as dirty.
      if (!line.startsWith("?? ")) return true;
      const path = line.slice(3).trim().replace(/^"|"$/g, "");
      return !path
        .split("/")
        .some((segment) => IGNORED_UNTRACKED_SEGMENTS.has(segment));
    });
}

// The collector's /health version payload. Git checkouts read git directly;
// git-free checkouts (the desktop app bootstraps app-source from the GitHub
// archive, and stock Windows has no git) fall back to the commit recorded by
// the archive downloader plus a probed latest-main commit, so the fleet can
// still tell current from stale and verify that an update landed.
export async function readCollectorAppVersion(
  { appDir, collectorOnly, execText, readProjectCheckouts },
  dependencies = {},
) {
  const readMarker = dependencies.readMarker ?? readSourceCommitMarker;
  const fetchLatest = dependencies.fetchLatest ?? fetchLatestMainCommit;
  const platform = dependencies.platform ?? process.platform;
  const [gitCommit, gitBranch, statusText, remoteCommit, projects] = await Promise.all([
    execText("git", ["rev-parse", "HEAD"]),
    execText("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    execText("git", ["status", "--porcelain"]),
    execText("git", ["ls-remote", "origin", "main"]),
    readProjectCheckouts(),
  ]);
  const markerCommit = gitCommit ? "" : await readMarker(appDir);
  const commit = gitCommit || markerCommit;
  const branch = gitBranch || (markerCommit ? "main" : "");
  const probedLatestCommit =
    !remoteCommit && markerCommit ? await fetchLatest() : "";
  const latestCommit =
    remoteCommit.split(/\s+/)[0] || probedLatestCommit || commit;
  return {
    appDir,
    commit,
    shortCommit: commit.slice(0, 7),
    branch,
    dirty: collectorCheckoutDirty(statusText),
    latestCommit,
    latestShortCommit: latestCommit.slice(0, 7),
    updateCommand: collectorManualUpdateCommand({ appDir, collectorOnly, platform }),
    projects,
  };
}
