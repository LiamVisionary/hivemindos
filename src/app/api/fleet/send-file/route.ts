import { createReadStream, createWriteStream } from "fs";
import { mkdir, stat } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { isAbsolute, join, normalize, resolve, sep } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

import { NextRequest } from "next/server";

import { shellBaseFromCollectorUrl } from "../shell/shell-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends a single file to a fleet machine over the tailnet by PUTing its bytes to
// the machine's hivemind-linkd `/_hivemind/file` endpoint. Browser-selected
// files use a raw upload path so the dashboard can show progress; Tauri-native
// drops send the local path and stream from disk server-side.

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB, mirrors fileReceiveMaxBytes in linkd
const LINK_TIMEOUT_MS = 10 * 60_000;
const PROGRESS_TTL_MS = 5 * 60_000;
const TRANSFER_ID_PATTERN = /^[a-zA-Z0-9._-]{1,128}$/;

type HiveDropPhase = "preparing" | "sending" | "done" | "error";

type HiveDropProgress = {
  transferId: string;
  phase: HiveDropPhase;
  bytesSent: number;
  totalBytes: number | null;
  startedAt: number;
  updatedAt: number;
  path?: string;
  error?: string;
};

type HiveDropInput = {
  transferId: string;
  fileName: string;
  destDir: string;
  machineLabel: string;
  rawCollectorUrl: string;
  totalBytes: number | null;
  stream: NodeJS.ReadableStream;
};

class HiveDropRequestError extends Error {}

const globalProgress = globalThis as typeof globalThis & {
  __hiveDropProgress?: Map<string, HiveDropProgress>;
};

function progressStore() {
  if (!globalProgress.__hiveDropProgress) globalProgress.__hiveDropProgress = new Map();
  return globalProgress.__hiveDropProgress;
}

function badRequest(error: string) {
  return Response.json({ ok: false, error }, { status: 400 });
}

function cleanupProgressStore() {
  const now = Date.now();
  const store = progressStore();
  for (const [id, progress] of store) {
    if (now - progress.updatedAt > PROGRESS_TTL_MS) store.delete(id);
  }
}

function readProgress(transferId: string) {
  cleanupProgressStore();
  return progressStore().get(transferId) ?? null;
}

function writeProgress(transferId: string, next: Partial<Omit<HiveDropProgress, "transferId" | "startedAt" | "updatedAt">>) {
  cleanupProgressStore();
  const now = Date.now();
  const previous = progressStore().get(transferId);
  progressStore().set(transferId, {
    transferId,
    phase: "preparing",
    bytesSent: 0,
    totalBytes: null,
    startedAt: previous?.startedAt ?? now,
    ...previous,
    ...next,
    updatedAt: now,
  });
}

function normalizeTransferId(raw: string | null | undefined) {
  const trimmed = raw?.trim() ?? "";
  if (TRANSFER_ID_PATTERN.test(trimmed)) return trimmed;
  return crypto.randomUUID();
}

function requireTransferId(raw: string | null | undefined) {
  const trimmed = raw?.trim() ?? "";
  return TRANSFER_ID_PATTERN.test(trimmed) ? trimmed : "";
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
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  return cleaned.slice(0, 255);
}

function parseByteCount(value: FormDataEntryValue | string | null | undefined) {
  const numberValue = Number(String(value ?? "").trim());
  if (!Number.isFinite(numberValue) || numberValue < 0) return null;
  return Math.floor(numberValue);
}

function fileTooLargeMessage() {
  return `file is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))}MB limit`;
}

function webStreamToNode(stream: ReadableStream<Uint8Array>) {
  return Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]);
}

function assertByteLimit(totalBytes: number | null) {
  if (totalBytes === 0) throw new HiveDropRequestError("file is empty");
  if (totalBytes !== null && totalBytes > MAX_FILE_BYTES) throw new HiveDropRequestError(fileTooLargeMessage());
}

function createProgressStream(input: HiveDropInput) {
  let bytesSent = 0;
  writeProgress(input.transferId, {
    phase: "sending",
    bytesSent,
    totalBytes: input.totalBytes,
  });

  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesSent += chunk.byteLength;
      if (bytesSent > MAX_FILE_BYTES) {
        callback(new Error(fileTooLargeMessage()));
        return;
      }
      writeProgress(input.transferId, {
        phase: "sending",
        bytesSent,
        totalBytes: input.totalBytes,
      });
      callback(null, chunk);
    },
  });
  return input.stream.pipe(progress);
}

function finishProgress(input: HiveDropInput, path: string) {
  writeProgress(input.transferId, {
    phase: "done",
    bytesSent: input.totalBytes ?? readProgress(input.transferId)?.bytesSent ?? 0,
    totalBytes: input.totalBytes,
    path,
  });
}

function failProgress(input: HiveDropInput, error: string) {
  writeProgress(input.transferId, {
    phase: "error",
    bytesSent: readProgress(input.transferId)?.bytesSent ?? 0,
    totalBytes: input.totalBytes,
    error,
  });
}

async function inputFromRawRequest(request: NextRequest): Promise<HiveDropInput> {
  const url = new URL(request.url);
  const fileName = safeBaseName(url.searchParams.get("fileName") || request.headers.get("x-hivedrop-file-name") || "");
  if (!fileName) throw new HiveDropRequestError("invalid file name");
  if (!request.body) throw new HiveDropRequestError("missing file");

  const totalBytes = parseByteCount(url.searchParams.get("size") || request.headers.get("content-length"));
  assertByteLimit(totalBytes);

  return {
    transferId: normalizeTransferId(url.searchParams.get("transferId") || request.headers.get("x-hivedrop-transfer-id")),
    fileName,
    destDir: url.searchParams.get("destDir")?.trim() || "~/Downloads",
    machineLabel: url.searchParams.get("machineName")?.trim() || "the machine",
    rawCollectorUrl: url.searchParams.get("collectorUrl") ?? "",
    totalBytes,
    stream: webStreamToNode(request.body),
  };
}

async function inputFromFormRequest(request: NextRequest): Promise<HiveDropInput> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HiveDropRequestError("expected multipart/form-data with a file");
  }

  const destDir = String(form.get("destDir") ?? "").trim() || "~/Downloads";
  const machineLabel = String(form.get("machineName") ?? "").trim() || "the machine";
  const transferId = normalizeTransferId(String(form.get("transferId") ?? ""));

  // The bytes arrive one of two ways: an uploaded File (legacy browser path)
  // or a sourcePath on this machine (Tauri-native drag-drop).
  const file = form.get("file");
  const sourcePath = String(form.get("sourcePath") ?? "").trim();
  if (file instanceof File) {
    const fileName = safeBaseName(file.name);
    if (!fileName) throw new HiveDropRequestError("invalid file name");
    assertByteLimit(file.size);
    return {
      transferId,
      fileName,
      destDir,
      machineLabel,
      rawCollectorUrl: String(form.get("collectorUrl") ?? ""),
      totalBytes: file.size,
      stream: webStreamToNode(file.stream()),
    };
  }

  if (sourcePath) {
    const fileName = safeBaseName(String(form.get("fileName") ?? "") || sourcePath);
    if (!fileName) throw new HiveDropRequestError("invalid file name");
    try {
      const localPath = expandHomePath(sourcePath);
      const info = await stat(localPath);
      if (!info.isFile()) throw new HiveDropRequestError("dropped item is not a file");
      assertByteLimit(info.size);
      return {
        transferId,
        fileName,
        destDir,
        machineLabel,
        rawCollectorUrl: String(form.get("collectorUrl") ?? ""),
        totalBytes: info.size,
        stream: createReadStream(localPath),
      };
    } catch (error) {
      if (error instanceof HiveDropRequestError) throw error;
      throw new HiveDropRequestError(error instanceof Error ? `could not read dropped file: ${error.message}` : "could not read dropped file");
    }
  }

  throw new HiveDropRequestError("missing file");
}

async function readHiveDropInput(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get("transport") === "raw" || request.headers.has("x-hivedrop-file-name")) {
    return inputFromRawRequest(request);
  }
  return inputFromFormRequest(request);
}

export async function GET(request: NextRequest) {
  const transferId = requireTransferId(new URL(request.url).searchParams.get("transferId"));
  if (!transferId) return badRequest("missing transfer id");
  const progress = readProgress(transferId);
  if (!progress) return Response.json({ ok: false, error: "transfer progress not found" }, { status: 404 });
  return Response.json({ ok: true, progress });
}

export async function POST(request: NextRequest) {
  let input: HiveDropInput;
  try {
    input = await readHiveDropInput(request);
  } catch (error) {
    if (error instanceof HiveDropRequestError) return badRequest(error.message);
    return badRequest("could not read HiveDrop request");
  }

  writeProgress(input.transferId, {
    phase: "preparing",
    bytesSent: 0,
    totalBytes: input.totalBytes,
  });

  const normalized = normalizeCollectorUrl(input.rawCollectorUrl);
  if (!normalized) {
    failProgress(input, "this machine has no collector URL to reach it by");
    return badRequest("this machine has no collector URL to reach it by");
  }

  // Local / self machine: write straight to disk, no link hop.
  if (isLocalCollectorUrl(normalized)) {
    try {
      const trackedStream = createProgressStream(input);
      const expanded = expandHomePath(input.destDir);
      const absolute = normalize(isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded));
      await mkdir(absolute, { recursive: true });
      const outPath = join(absolute, input.fileName);
      await pipeline(trackedStream, createWriteStream(outPath));
      const path = displayPath(outPath);
      finishProgress(input, path);
      return Response.json({ ok: true, transferId: input.transferId, path, host: input.machineLabel, local: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "local file write failed";
      failProgress(input, message);
      return Response.json(
        { ok: false, transferId: input.transferId, error: message },
        { status: message === fileTooLargeMessage() ? 400 : 500 },
      );
    }
  }

  // Remote machine: PUT the bytes to its linkd file endpoint, reached exactly
  // like the Shell button reaches it (peer proxy or direct tailnet base).
  const base = shellBaseFromCollectorUrl(input.rawCollectorUrl);
  if (!base) {
    failProgress(input, "could not resolve a link path to this machine");
    return badRequest("could not resolve a link path to this machine");
  }

  // A peer must prove setup already prepared its destination before we start
  // consuming the upload stream. In particular, this keeps macOS's Downloads
  // permission prompt inside setup instead of surfacing on a remote transfer.
  const readinessUrl = `${base}/_hivemind/file/readiness?dir=${encodeURIComponent(input.destDir)}`;
  let readinessResponse: Response;
  try {
    readinessResponse = await fetch(readinessUrl, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = `couldn't verify file access on ${input.machineLabel} — it may be offline (${error instanceof Error ? error.message : "network error"}). No file was sent.`;
    failProgress(input, message);
    return Response.json({ ok: false, transferId: input.transferId, error: message }, { status: 502 });
  }

  const readiness = (await readinessResponse.json().catch(() => null)) as {
    ok?: boolean;
    ready?: boolean;
    code?: string;
    error?: string;
  } | null;
  if (readinessResponse.status === 404 || !readiness) {
    const error = `${input.machineLabel} must update HivemindOS Link before Hive Drop can verify destination access. No file was sent.`;
    failProgress(input, error);
    return Response.json({ ok: false, transferId: input.transferId, error }, { status: 409 });
  }
  if (!readinessResponse.ok || !readiness.ok || readiness.ready !== true) {
    const error = readiness.code === "downloads_access_not_prepared"
      ? `Hive Drop needs Downloads access on ${input.machineLabel}. Re-run Setup on that Mac before sending; no file was sent.`
      : readiness.error || `Hive Drop could not verify destination access on ${input.machineLabel}. No file was sent.`;
    failProgress(input, error);
    return Response.json({ ok: false, transferId: input.transferId, error }, { status: 409 });
  }

  const trackedStream = createProgressStream(input);
  const url = `${base}/_hivemind/file?dir=${encodeURIComponent(input.destDir)}&name=${encodeURIComponent(input.fileName)}`;
  const headers: HeadersInit = { "content-type": "application/octet-stream" };
  if (input.totalBytes !== null) headers["content-length"] = String(input.totalBytes);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "PUT",
      headers,
      body: trackedStream as unknown as BodyInit,
      cache: "no-store",
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch (error) {
    const message = error instanceof Error && error.message === fileTooLargeMessage()
      ? error.message
      : `couldn't reach ${input.machineLabel} over the link — it may be offline (${error instanceof Error ? error.message : "network error"}).`;
    failProgress(input, message);
    return Response.json(
      { ok: false, transferId: input.transferId, error: message },
      { status: message === fileTooLargeMessage() ? 400 : 502 },
    );
  }

  const data = (await upstream.json().catch(() => null)) as {
    ok?: boolean;
    path?: string;
    bytes?: number;
    sha256?: string;
    error?: string;
  } | null;
  if (!upstream.ok || !data?.ok) {
    // An older linkd has no /_hivemind/file route, so the request falls through
    // to its collector proxy and 404s.
    const error = upstream.status === 404
      ? `${input.machineLabel} can't receive files yet — its hivemind-linkd needs updating to a build with the file endpoint.`
      : data?.error || `transfer to ${input.machineLabel} failed (HTTP ${upstream.status}).`;
    failProgress(input, error);
    return Response.json({ ok: false, transferId: input.transferId, error }, { status: 502 });
  }

  const path = data.path ?? `${input.destDir.replace(/\/+$/, "")}/${input.fileName}`;
  finishProgress(input, path);
  return Response.json({
    ok: true,
    transferId: input.transferId,
    path,
    host: input.machineLabel,
    bytes: data.bytes,
    sha256: data.sha256,
  });
}
