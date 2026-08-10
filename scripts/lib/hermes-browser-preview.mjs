import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SESSION_NAME_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

export function isHermesBrowserToolName(value) {
  return /^browser_[a-z0-9_]+$/i.test(String(value || "").trim());
}

async function resolveAgentBrowserBin(hermesAgentProjectDir) {
  const candidates = [
    process.env.AGENT_BROWSER_BIN,
    join(hermesAgentProjectDir, "node_modules", ".bin", "agent-browser"),
    join(hermesAgentProjectDir, "node_modules", "agent-browser", "bin", "agent-browser.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next managed installation path.
    }
  }
  return "agent-browser";
}

async function ownedBrowserSocketDirectories(ownerPid, socketRoot) {
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return [];
  const entries = await readdir(socketRoot, { withFileTypes: true }).catch(() => []);
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("agent-browser-")) continue;
    const sessionName = entry.name.slice("agent-browser-".length);
    if (!SESSION_NAME_PATTERN.test(sessionName)) continue;
    const socketDirectory = join(socketRoot, entry.name);
    if (basename(socketDirectory) !== entry.name) continue;
    const recordedOwner = Number(
      String(
        await readFile(join(socketDirectory, `${sessionName}.owner_pid`), "utf8").catch(
          () => "",
        ),
      ).trim(),
    );
    if (recordedOwner !== ownerPid) continue;
    const modifiedAt = await stat(socketDirectory)
      .then((value) => value.mtimeMs)
      .catch(() => 0);
    matches.push({ modifiedAt, sessionName, socketDirectory });
  }
  return matches.sort((left, right) => right.modifiedAt - left.modifiedAt);
}

function streamPortFromOutput(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || ""));
    const port = Number(parsed?.data?.port);
    if (
      parsed?.success === true
      && parsed?.data?.enabled === true
      && Number.isInteger(port)
      && port > 0
      && port <= 65535
    ) {
      return port;
    }
  } catch {
    // A missing or older stream command means this browser cannot be previewed.
  }
  return 0;
}

export async function resolveHermesBrowserPreview({
  ownerPid,
  hermesAgentProjectDir,
  socketRoot = process.platform === "darwin" ? "/tmp" : tmpdir(),
  run = execFileAsync,
} = {}) {
  const sockets = await ownedBrowserSocketDirectories(Number(ownerPid), socketRoot);
  if (!sockets.length) return null;
  const browserBin = await resolveAgentBrowserBin(String(hermesAgentProjectDir || ""));
  for (const socket of sockets) {
    const result = await run(
      browserBin,
      ["--session", socket.sessionName, "--json", "stream", "status"],
      {
        timeout: 750,
        maxBuffer: 100_000,
        env: {
          ...process.env,
          AGENT_BROWSER_SOCKET_DIR: socket.socketDirectory,
        },
      },
    ).catch(() => null);
    const port = streamPortFromOutput(result?.stdout);
    if (!port) continue;
    return {
      path: `/app-proxy/${port}`,
      source: "agent-browser",
    };
  }
  return null;
}

export async function waitForHermesBrowserPreview(input = {}) {
  const attempts = Number.isInteger(input.attempts) ? Math.max(1, input.attempts) : 5;
  const retryMs = Number.isFinite(input.retryMs) ? Math.max(0, input.retryMs) : 100;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const preview = await resolveHermesBrowserPreview(input);
    if (preview) return preview;
    if (attempt + 1 < attempts && retryMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
    }
  }
  return null;
}

export function createHermesBrowserPreviewEventWriter({
  canWrite,
  hermesAgentProjectDir,
  ownerPid,
  resolvePreview = waitForHermesBrowserPreview,
  write,
} = {}) {
  let browserPreview = null;
  let pending = Promise.resolve();
  let resolving = null;
  return {
    drain: () => pending.catch(() => undefined),
    push(event) {
      if (!canWrite?.()) return Promise.resolve();
      const source = event?.event && typeof event.event === "object" ? event.event : event;
      const browserTool = isHermesBrowserToolName(source?.name);
      const browserSettled = /^(?:tool\.)?(?:completed|failed)$/i.test(
        String(source?.type || ""),
      );
      if (!browserTool || browserPreview || !browserSettled) {
        write?.(browserTool && browserPreview ? { ...event, browserPreview } : event);
        return Promise.resolve();
      }
      write?.(event);
      if (resolving) return resolving;
      resolving = (async () => {
        const resolvedOwnerPid = typeof ownerPid === "function" ? await ownerPid() : ownerPid;
        browserPreview = await resolvePreview({ ownerPid: resolvedOwnerPid, hermesAgentProjectDir });
        if (browserPreview && canWrite?.()) write?.({ ...event, browserPreview });
      })().catch(() => undefined).finally(() => {
        resolving = null;
      });
      pending = resolving;
      return pending;
    },
  };
}
