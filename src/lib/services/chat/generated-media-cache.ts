import "server-only";

import { createHash } from "crypto";
import { mkdir, stat, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { extname, join } from "path";

// Hub-local cache for generated images that phone clients need to download.
// Connected image apps frequently return URLs that only resolve from the hub
// machine itself (http://127.0.0.1:7860/…, LAN-only hosts) or inline data:
// URLs. The dashboard browser runs on the hub so it can fetch those directly;
// the phone cannot. The hub therefore pulls each image onto its own disk once
// and serves it to the phone through /api/chat/generated-media with a signed
// URL — so the image always travels exactly one hop, hub → phone, over the
// tailnet.

const CACHE_DIR = join(homedir(), ".hivemindos", "cache", "generated-media");
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function sniffedExtension(data: Buffer): string {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return ".png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data.length >= 3 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return ".gif";
  if (
    data.length >= 12 &&
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return ".webp";
  return "";
}

async function writeCacheFile(data: Buffer, identity: string, preferredExtension: string): Promise<string> {
  if (data.length === 0) throw new Error("Generated image download was empty.");
  if (data.length > MAX_IMAGE_BYTES) throw new Error("Generated image is too large to cache for the phone.");
  // Trust the bytes over any declared type — the serving route re-validates
  // the magic number against the extension and would 415 a mismatch.
  const extension = sniffedExtension(data) || preferredExtension;
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Generated image is not a supported image format.");
  }
  const name = `${createHash("sha256").update(identity).digest("hex").slice(0, 40)}${extension}`;
  const path = join(CACHE_DIR, name);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, new Uint8Array(data));
  return path;
}

function dataUrlBuffer(url: string): { data: Buffer; extension: string } {
  const match = /^data:(image\/[a-z+.-]+)?(;base64)?,(.*)$/is.exec(url);
  if (!match) throw new Error("Generated image data URL could not be parsed.");
  const [, mediaType = "", base64Flag, payload] = match;
  const data = base64Flag
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "binary");
  return { data, extension: EXTENSION_BY_MEDIA_TYPE[mediaType.toLowerCase()] ?? "" };
}

async function fetchImageBuffer(url: string): Promise<{ data: Buffer; extension: string }> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Could not download the generated image from the connected app: ${error instanceof Error ? error.message : "fetch failed"}`);
  }
  if (!response.ok) throw new Error(`The connected app returned ${response.status} for the generated image.`);
  const data = Buffer.from(await response.arrayBuffer());
  const mediaType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const urlExtension = extname(new URL(url).pathname).toLowerCase();
  const extension = EXTENSION_BY_MEDIA_TYPE[mediaType] ?? (ALLOWED_EXTENSIONS.has(urlExtension) ? urlExtension : "");
  return { data, extension };
}

/**
 * Resolve one generated-image URL (as produced by runChatImageGeneration) to
 * an absolute file path on this hub's disk, downloading into the cache when
 * the source is remote or inline. Throws when the image can't be obtained.
 */
export async function cacheGeneratedImageForPhone(url: string): Promise<string> {
  const trimmed = url.trim();

  // Already a hub-local file behind the generated-media route.
  const localMatch = /^\/api\/chat\/generated-media\?path=([^&]+)/.exec(trimmed);
  if (localMatch) {
    const path = decodeURIComponent(localMatch[1]);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Generated media path is not a file.");
    return path;
  }

  if (/^data:image\//i.test(trimmed)) {
    const { data, extension } = dataUrlBuffer(trimmed);
    return writeCacheFile(data, createHash("sha256").update(new Uint8Array(data)).digest("hex"), extension);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const { data, extension } = await fetchImageBuffer(trimmed);
    return writeCacheFile(data, trimmed, extension);
  }

  throw new Error("Generated image URL is not reachable from the phone.");
}
