import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { shellBaseFromCollectorUrl } from "@/app/api/fleet/shell/shell-target";

const MAX_REMOTE_DELIVERABLE_BYTES = 200 * 1024 * 1024;
const REMOTE_DELIVERABLE_TIMEOUT_MS = 10 * 60_000;

type DownloadRemoteDeliverableOptions = {
  collectorUrl: string;
  fetcher?: typeof fetch;
  machineName: string;
  remotePath: string;
  targetDirectory?: string;
};

export class DeliverableDownloadError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "DeliverableDownloadError";
  }
}

function cleanRemotePath(value: string) {
  const path = String(value || "").trim().replace(/[\0\r\n]/g, "");
  const absolute = path.startsWith("/")
    || path.startsWith("~/")
    || /^[a-zA-Z]:[\\/]/.test(path)
    || /^\\\\[^\\]+\\[^\\]+/.test(path);
  if (!path || !absolute) throw new DeliverableDownloadError("The remote deliverable path must be absolute.", 400);
  return path;
}

export function deliverableDownloadFileName(remotePath: string) {
  const base = remotePath.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, "").trim() ?? "";
  if (!base || base === "." || base === "..") {
    throw new DeliverableDownloadError("The remote deliverable does not have a valid file name.", 400);
  }
  return base.slice(0, 255);
}

function numberedFileName(fileName: string, copy: number) {
  if (copy === 0) return fileName;
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return `${stem} (${copy})${extension}`;
}

async function reserveDownloadPath(directory: string, fileName: string) {
  for (let copy = 0; copy < 10_000; copy += 1) {
    const path = join(directory, numberedFileName(fileName, copy));
    try {
      const handle = await open(path, "wx", 0o600);
      return { handle, path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new DeliverableDownloadError("Could not choose an unused file name in Downloads.");
}

function transferStream(body: ReadableStream<Uint8Array>) {
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      if (received > MAX_REMOTE_DELIVERABLE_BYTES) {
        callback(new DeliverableDownloadError("The remote file exceeds the 200 MB transfer limit.", 413));
        return;
      }
      callback(null, chunk);
    },
  });
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(limit);
}

function displayDownloadPath(path: string) {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

async function upstreamError(response: Response, machineName: string) {
  const data = await response.json().catch(() => null) as { error?: string } | null;
  if (response.status === 404 && !data?.error) {
    return `${machineName} cannot send files to this device yet. Update HivemindOS Link on that machine, then try again.`;
  }
  return data?.error
    ? `${machineName}: ${data.error}`
    : `Could not download the file from ${machineName} (HTTP ${response.status}).`;
}

export async function downloadRemoteDeliverable(options: DownloadRemoteDeliverableOptions) {
  const remotePath = cleanRemotePath(options.remotePath);
  const machineName = String(options.machineName || "the other device").trim().replace(/[\0\r\n]/g, "") || "the other device";
  const base = shellBaseFromCollectorUrl(options.collectorUrl);
  if (!base) throw new DeliverableDownloadError("Could not resolve a secure fleet link to that device.", 400);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `${base}/_hivemind/file?${new URLSearchParams({ path: remotePath }).toString()}`,
      {
        cache: "no-store",
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(REMOTE_DELIVERABLE_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new DeliverableDownloadError(
      `Could not reach ${machineName} over Hivemind Link (${error instanceof Error ? error.message : "network error"}).`,
      502,
    );
  }
  if (!response.ok) throw new DeliverableDownloadError(await upstreamError(response, machineName), response.status === 413 ? 413 : 502);
  if (!response.body) throw new DeliverableDownloadError(`${machineName} returned an empty file response.`, 502);

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_DELIVERABLE_BYTES) {
    await response.body.cancel().catch(() => undefined);
    throw new DeliverableDownloadError("The remote file exceeds the 200 MB transfer limit.", 413);
  }

  const targetDirectory = options.targetDirectory ?? join(homedir(), "Downloads", "HivemindOS");
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const reserved = await reserveDownloadPath(targetDirectory, deliverableDownloadFileName(remotePath));
  try {
    await pipeline(transferStream(response.body), createWriteStream("", { fd: reserved.handle.fd, autoClose: true }));
  } catch (error) {
    await reserved.handle.close().catch(() => undefined);
    await rm(reserved.path, { force: true }).catch(() => undefined);
    if (error instanceof DeliverableDownloadError) throw error;
    throw new DeliverableDownloadError(
      `Could not save the file on this device (${error instanceof Error ? error.message : "write failed"}).`,
    );
  }

  return {
    bytes: Number.isFinite(contentLength) ? contentLength : undefined,
    displayPath: displayDownloadPath(reserved.path),
    path: reserved.path,
  };
}
