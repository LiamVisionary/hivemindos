import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { isAbsolute, join, normalize, resolve, sep } from "path";

import { NextRequest } from "next/server";

import { shellBaseFromCollectorUrl } from "../shell/shell-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends a single file to a fleet machine over the tailnet by PUTing its bytes to
// the machine's hivemind-linkd `/_hivemind/file` endpoint — the same channel,
// peer proxy, and self-user gate the Shell button rides. So a file reaches any
// machine the Shell button reaches, with no system sshd / Tailscale SSH needed.
// The dashboard's own machine is written to disk directly (no link hop).

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB, mirrors fileReceiveMaxBytes in linkd
const LINK_TIMEOUT_MS = 180_000;

function badRequest(error: string) {
  return Response.json({ ok: false, error }, { status: 400 });
}

function normalizeCollectorUrl(url?: string | null) {
  const trimmed = url?.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const peerPrefix = "/peer/";
    if (parsed.pathname.startsWith(peerPrefix)) {
      // Hivemind Link peer-proxy URL: the real tailnet host lives in the path.
      const peer = decodeURIComponent(parsed.pathname.slice(peerPrefix.length)).replace(/\/+$/, "");
      if (peer) return `http://${peer}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function isLocalCollectorUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

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

/** Strip any directory components so a sent file can only land as a basename. */
function safeBaseName(name: string) {
  const base = (name || "").split(/[\\/]/).pop() ?? "";
  // Drop control characters; keep spaces and other printable name characters.
  const cleaned = base.replace(/[ -]/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  return cleaned.slice(0, 255);
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("expected multipart/form-data with a file");
  }

  const destDir = String(form.get("destDir") ?? "").trim() || "~/Downloads";
  const machineLabel = String(form.get("machineName") ?? "").trim() || "the machine";

  // The bytes arrive one of two ways: an uploaded File (the browser picker /
  // HTML5 drop) or a sourcePath on this machine (a Tauri-native file drop only
  // hands us the OS path, so the server reads it locally).
  let buffer: Buffer;
  let fileName: string;
  const file = form.get("file");
  const sourcePath = String(form.get("sourcePath") ?? "").trim();
  if (file instanceof File) {
    fileName = safeBaseName(file.name);
    if (!fileName) return badRequest("invalid file name");
    buffer = Buffer.from(await file.arrayBuffer());
  } else if (sourcePath) {
    fileName = safeBaseName(String(form.get("fileName") ?? "") || sourcePath);
    if (!fileName) return badRequest("invalid file name");
    try {
      const localPath = expandHomePath(sourcePath);
      const info = await stat(localPath);
      if (!info.isFile()) return badRequest("dropped item is not a file");
      if (info.size > MAX_FILE_BYTES) {
        return badRequest(`file is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB limit`);
      }
      buffer = await readFile(localPath);
    } catch (error) {
      return badRequest(error instanceof Error ? `could not read dropped file: ${error.message}` : "could not read dropped file");
    }
  } else {
    return badRequest("missing file");
  }

  if (buffer.length === 0) return badRequest("file is empty");
  if (buffer.length > MAX_FILE_BYTES) {
    return badRequest(`file is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB limit`);
  }

  const rawCollectorUrl = String(form.get("collectorUrl") ?? "");
  const normalized = normalizeCollectorUrl(rawCollectorUrl);
  // No implicit fallback: an empty collector URL must not silently write to the
  // dashboard machine itself.
  if (!normalized) return badRequest("this machine has no collector URL to reach it by");

  // Local / self machine: write straight to disk, no link hop.
  if (isLocalCollectorUrl(normalized)) {
    try {
      const expanded = expandHomePath(destDir);
      const absolute = normalize(isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded));
      await mkdir(absolute, { recursive: true });
      const outPath = join(absolute, fileName);
      await writeFile(outPath, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
      return Response.json({ ok: true, path: displayPath(outPath), host: machineLabel, local: true });
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : "local file write failed" },
        { status: 500 },
      );
    }
  }

  // Remote machine: PUT the bytes to its linkd file endpoint, reached exactly
  // like the Shell button reaches it (peer proxy or direct tailnet base).
  const base = shellBaseFromCollectorUrl(rawCollectorUrl);
  if (!base) return badRequest("could not resolve a link path to this machine");
  const url = `${base}/_hivemind/file?dir=${encodeURIComponent(destDir)}&name=${encodeURIComponent(fileName)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      // Zero-copy view of the bytes; cast because BodyInit rejects the generic
      // Uint8Array<ArrayBufferLike> even though undici accepts it at runtime.
      body: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as BodyInit,
      cache: "no-store",
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: `couldn't reach ${machineLabel} over the link — it may be offline (${error instanceof Error ? error.message : "network error"}).` },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => null)) as { ok?: boolean; path?: string; error?: string } | null;
  if (!upstream.ok || !data?.ok) {
    // An older linkd has no /_hivemind/file route, so the request falls through
    // to its collector proxy and 404s.
    if (upstream.status === 404) {
      return Response.json(
        { ok: false, error: `${machineLabel} can't receive files yet — its hivemind-linkd needs updating to a build with the file endpoint.` },
        { status: 502 },
      );
    }
    return Response.json(
      { ok: false, error: data?.error || `transfer to ${machineLabel} failed (HTTP ${upstream.status}).` },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, path: data.path ?? `${destDir.replace(/\/+$/, "")}/${fileName}`, host: machineLabel });
}
