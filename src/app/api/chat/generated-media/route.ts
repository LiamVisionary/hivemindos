import { createReadStream } from "fs";
import { access, constants, realpath, readFile, stat } from "fs/promises";
import { extname, isAbsolute } from "path";
import { Readable } from "stream";
import { requireAuth } from "@/lib/utils/server-auth";
import { verifySignedGeneratedMedia } from "@/lib/services/chat/generated-media-signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const VIDEO_MEDIA_TYPES: Record<string, string> = {
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

function mediaTypeFor(path: string) {
  const extension = extname(path).toLowerCase();
  return IMAGE_MEDIA_TYPES[extension] ?? VIDEO_MEDIA_TYPES[extension] ?? "";
}

function isImageType(type: string) {
  return type.startsWith("image/");
}

function hasImageSignature(data: ArrayLike<number>, type: string) {
  if (type === "image/png") {
    return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  }
  if (type === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (type === "image/gif") {
    return data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46;
  }
  if (type === "image/webp") {
    return data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
      && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50;
  }
  return false;
}

async function assertAllowedGeneratedMedia(path: string) {
  const type = mediaTypeFor(path);
  if (!type) throw new Error("Only generated image and video files can be displayed in chat.");
  if (!isAbsolute(path)) throw new Error("Generated media path must be absolute.");
  const resolved = await realpath(path);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("Generated media path is not a file.");
  if (isImageType(type) && info.size > MAX_IMAGE_BYTES) throw new Error("Generated image is too large to display in chat.");
  if (!isImageType(type) && info.size > MAX_VIDEO_BYTES) throw new Error("Generated video is too large to display in chat.");
  await access(resolved, constants.R_OK);
  return { path: resolved, type, size: info.size };
}

function rangeBounds(rangeHeader: string | null, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (!match) return null;
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const path = params.get("path")?.trim() ?? "";

  // Phone clients fetch with native image loaders that carry no session
  // cookie or device-token header; the hub hands them short-lived HMAC-signed
  // URLs instead (see generated-media-signing.ts). A valid path-scoped
  // signature is an alternative to dashboard auth, never a replacement.
  const signed = await verifySignedGeneratedMedia(
    path,
    params.get("exp")?.trim() ?? "",
    params.get("sig")?.trim() ?? "",
  );
  if (!signed) {
    const unauthorized = await requireAuth(request);
    if (unauthorized) return unauthorized;
  }

  if (!path) {
    return Response.json({ ok: false, error: "Missing generated media path." }, { status: 400 });
  }

  try {
    const media = await assertAllowedGeneratedMedia(path);
    if (isImageType(media.type)) {
      const data = await readFile(media.path);
      if (!hasImageSignature(data, media.type)) {
        return Response.json({ ok: false, error: "Generated media is not a valid image file." }, { status: 415 });
      }
      const body = new Uint8Array(data.byteLength);
      body.set(data);
      return new Response(body.buffer, {
        headers: {
          "Cache-Control": "private, max-age=3600",
          "Content-Type": media.type,
        },
      });
    }
    const range = rangeBounds(request.headers.get("range"), media.size);
    const stream = range
      ? createReadStream(media.path, { start: range.start, end: range.end })
      : createReadStream(media.path);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Type": media.type,
      "Content-Length": String(range ? range.end - range.start + 1 : media.size),
    });
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${media.size}`);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Generated media could not be loaded.",
    }, { status: 404 });
  }
}
