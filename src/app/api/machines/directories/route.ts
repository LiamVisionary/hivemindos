import { execFile } from "child_process";
import { constants } from "fs";
import { access, readdir, stat } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { isAbsolute, join, normalize, resolve, sep } from "path";
import { promisify } from "util";
import { isFleetCollectorUrl } from "@/lib/services/local-collector-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory";
};

const execFileAsync = promisify(execFile);

function expandHomePath(path: string) {
  const trimmed = path.trim() || "~";
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function displayPath(path: string) {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}${sep}`) ? `~/${path.slice(home.length + 1)}` : path;
}

function normalizeCollectorUrl(url?: string | null) {
  const trimmed = url?.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const peerPrefix = "/peer/";
    if (parsed.pathname.startsWith(peerPrefix)) {
      const peer = decodeURIComponent(parsed.pathname.slice(peerPrefix.length)).replace(/\/+$/, "");
      if (peer) return `http://${peer}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function isLocalCollectorUrl(url?: string | null) {
  const normalized = normalizeCollectorUrl(url);
  if (!normalized) return true;
  const hostname = new URL(normalized).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

async function listLocalDirectories(path: string) {
  const expanded = expandHomePath(path);
  const absolute = normalize(isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded));
  await access(absolute, constants.R_OK);
  const stats = await stat(absolute);
  if (!stats.isDirectory()) throw new Error("Path is not a directory.");
  const entries = await readdir(absolute, { withFileTypes: true });
  const directories: DirectoryEntry[] = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const childPath = join(absolute, entry.name);
      return { name: entry.name, path: displayPath(childPath), kind: "directory" as const };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
  const parentPath = absolute === homedir() || absolute === sep ? "" : displayPath(resolve(absolute, ".."));
  return { path: displayPath(absolute), parentPath, directories };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function remoteHostFromCollectorUrl(collectorUrl: string) {
  const hostname = new URL(collectorUrl).hostname;
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function parseRemoteDirectoryOutput(stdout: string) {
  let currentPath = "";
  let parentPath = "";
  const directories: DirectoryEntry[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const [first, ...rest] = rawLine.split("\t");
    const value = rest.join("\t");
    if (first === "__PATH__") {
      currentPath = value;
      continue;
    }
    if (first === "__PARENT__") {
      parentPath = value;
      continue;
    }
    if (!first || !value) continue;
    directories.push({ name: first, path: value, kind: "directory" });
  }

  if (!currentPath) throw new Error("Remote machine did not return a directory path.");
  return { path: currentPath, parentPath, directories };
}

async function listRemoteDirectoriesViaTailscale(collectorUrl: string, path: string) {
  const host = remoteHostFromCollectorUrl(collectorUrl);
  if (!host) throw new Error("Remote agent bridge URL is missing a host.");
  const quotedPath = shellQuote(path.trim() || "~");
  const script = [
    "set -eu",
    `p=${quotedPath}`,
    "case \"$p\" in",
    "  \"~\") p=\"$HOME\" ;;",
    "  \"~/\"*) p=\"$HOME/${p#~/}\" ;;",
    "esac",
    "if [ ! -d \"$p\" ]; then",
    "  printf '%s\\n' 'Path is not a directory.' >&2",
    "  exit 2",
    "fi",
    "real_path=$(cd \"$p\" && pwd -P)",
    "printf '__PATH__\\t%s\\n' \"$real_path\"",
    "if [ \"$real_path\" != '/' ]; then",
    "  parent_path=$(dirname \"$real_path\")",
    "  printf '__PARENT__\\t%s\\n' \"$parent_path\"",
    "fi",
    "find \"$real_path\" -maxdepth 1 -mindepth 1 -type d ! -name '.*' -printf '%f\\t%p\\n' 2>/dev/null | sort -f",
  ].join("\n");

  const targets = [host, `ubuntu@${host}`, `root@${host}`];
  const errors: string[] = [];
  for (const target of targets) {
    try {
      const { stdout } = await execFileAsync("tailscale", ["ssh", target, "sh", "-lc", script], {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return parseRemoteDirectoryOutput(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Tailscale SSH error.";
      errors.push(message.replaceAll(host, "<machine>"));
    }
  }
  throw new Error(errors.at(-1) ?? "Could not browse remote directories over Tailscale SSH.");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const collectorUrl = normalizeCollectorUrl(url.searchParams.get("collectorUrl"));
    const path = url.searchParams.get("path") || "~";
    if (collectorUrl && !isLocalCollectorUrl(collectorUrl)) {
      // SSRF guard: only browse a client-supplied collector when it resolves to
      // a fleet host — this gates both the HTTP fetch and the Tailscale SSH
      // fallback below against arbitrary internal hosts.
      if (!isFleetCollectorUrl(collectorUrl)) {
        throw new Error("Refusing to browse a machine outside the fleet host set.");
      }
      const remoteUrl = new URL(`${collectorUrl}/directories`);
      remoteUrl.searchParams.set("path", path);
      let collectorError = "";
      try {
        const response = await fetch(remoteUrl, { cache: "no-store" });
        const data = await response.json().catch(() => null) as unknown;
        if (response.ok) return Response.json(data);
        collectorError = data && typeof data === "object" && "error" in data
          ? String(data.error)
          : `Remote agent bridge returned HTTP ${response.status}.`;
      } catch (error) {
        collectorError = error instanceof Error ? error.message : "Remote agent bridge request failed.";
      }
      try {
        return Response.json({ ok: true, ...(await listRemoteDirectoriesViaTailscale(collectorUrl, path)) });
      } catch (error) {
        const sshError = error instanceof Error ? error.message : "Tailscale SSH fallback failed.";
        throw new Error(`Remote agent bridge could not list directories${collectorError ? ` (${collectorError})` : ""}; Tailscale SSH fallback failed: ${sshError}`);
      }
    }
    return Response.json({ ok: true, ...(await listLocalDirectories(path)) });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not list directories.",
    }, { status: 400 });
  }
}
