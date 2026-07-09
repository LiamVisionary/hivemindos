import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { runtimeCommandExists } from "@/lib/services/runtime-command-env";
import { transcribeAudioWithWhisper } from "@/lib/services/phone/transcription";

const execFileAsync = promisify(execFile);

// gpt-4o-mini-transcribe caps at ~1500s / 25MB per request; whisper-1 caps at
// 25MB. Chunk audio to stay safely under the tighter (duration) bound so an
// hour-long X video transcribes in order across a few requests.
const CHUNK_SECONDS = 1_200;
const YTDLP_TIMEOUT_MS = 180_000;
const FFMPEG_TIMEOUT_MS = 300_000;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
// Only ever download media from X's own CDN hosts. Both yt-dlp and the X API
// hand back video.twimg.com URLs; refusing anything else keeps a hostile tweet
// from steering a server-side fetch at an internal host (SSRF).
const TWIMG_HOST_RE = /(^|\.)twimg\.com$/i;

export type XMediaProbe = {
  hasVideo: boolean;
  title?: string;
  uploader?: string;
  uploaderId?: string;
  durationSec?: number;
  /** Raw yt-dlp stderr when it could not resolve media (for honest errors). */
  note?: string;
};

/** Resolve an argv prefix for yt-dlp: installed binary first, then `uvx yt-dlp`. */
export function resolveYtDlp(): string[] | null {
  if (runtimeCommandExists("yt-dlp")) return ["yt-dlp"];
  if (runtimeCommandExists("uvx")) return ["uvx", "yt-dlp"];
  return null;
}

export function ffmpegAvailable(): boolean {
  return runtimeCommandExists("ffmpeg");
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "x-transcript-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function assertTwimgHost(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Video URL is not a valid absolute URL.");
  }
  if (url.protocol !== "https:" || !TWIMG_HOST_RE.test(url.hostname)) {
    throw new Error("Refusing to download media from a non-X host.");
  }
  return url;
}

async function runYtDlp(args: string[], timeout = YTDLP_TIMEOUT_MS) {
  const prefix = resolveYtDlp();
  if (!prefix) throw new Error("yt-dlp is not available. Install it with `brew install yt-dlp` (or `uv tool install yt-dlp`).");
  const [command, ...base] = prefix;
  return execFileAsync(command, [...base, ...args], {
    timeout,
    maxBuffer: MAX_STDOUT_BYTES,
  });
}

/**
 * Ask yt-dlp what's at this X URL without downloading. Returns hasVideo=false
 * (rather than throwing) when the post simply has no video, so the caller can
 * fall through to thread mode.
 */
export async function probeXMedia(url: string): Promise<XMediaProbe> {
  try {
    const { stdout } = await runYtDlp(["-J", "--no-warnings", "--no-playlist", "--", url], 90_000);
    const info = JSON.parse(stdout) as {
      title?: string;
      description?: string;
      uploader?: string;
      uploader_id?: string;
      duration?: number;
      formats?: unknown[];
      entries?: unknown[];
    };
    const hasVideo = Array.isArray(info.formats) ? info.formats.length > 0 : Boolean(info.entries?.length);
    return {
      hasVideo,
      title: (info.title || info.description || "").trim() || undefined,
      uploader: info.uploader?.trim() || undefined,
      uploaderId: info.uploader_id?.replace(/^@/, "").trim() || undefined,
      durationSec: typeof info.duration === "number" ? info.duration : undefined,
    };
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const message = `${stderr} ${error instanceof Error ? error.message : ""}`.toLowerCase();
    // "no video could be found" / "no media" ⇒ a text/thread post, not a failure.
    if (/no video|no media|there'?s no video|unsupported url/.test(message)) {
      return { hasVideo: false, note: stderr.trim() || undefined };
    }
    // Auth-gated (protected/NSFW) or extractor breakage ⇒ surface honestly.
    if (/nsfw|age|log in|authenticat|cookies|private|protected/.test(message)) {
      throw new Error("This post's video needs an authenticated X session (protected, age-restricted, or NSFW). yt-dlp could not fetch it anonymously.");
    }
    throw new Error(`Could not inspect the X media: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Download and extract the post's audio track to a single mp3 via yt-dlp. */
export async function downloadXAudio(url: string, workDir: string): Promise<string> {
  await runYtDlp([
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "--no-playlist",
    "--no-warnings",
    "-o", join(workDir, "audio.%(ext)s"),
    "--", url,
  ]);
  const files = await readdir(workDir);
  const audio = files.find((name) => name.endsWith(".mp3"));
  if (!audio) throw new Error("yt-dlp finished but produced no audio file.");
  return join(workDir, audio);
}

/** Fallback path: fetch an X-hosted mp4 variant directly, then extract audio. */
export async function downloadTwimgMp4(url: string, workDir: string): Promise<string> {
  assertTwimgHost(url);
  const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(120_000) });
  // fetch follows redirects by default, so the allowlist on the initial URL does
  // not constrain the final host — re-check where we actually landed.
  if (response.url && response.url !== url) assertTwimgHost(response.url);
  if (!response.ok) throw new Error(`Video download failed with HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Downloaded video was empty.");
  const mp4Path = join(workDir, "video.mp4");
  await writeFile(mp4Path, buffer);
  return mp4Path;
}

/**
 * Turn any audio/video file into ordered mp3 chunks that each fit the STT
 * request limits. The segment muxer always writes at least one chunk_000.mp3,
 * so short inputs come back as a single chunk and long ones are split by time —
 * with no dependence on reading the container's declared duration first (which
 * some X streams omit), a long video is never sent as one over-limit request.
 */
export async function extractAudioChunks(inputPath: string, workDir: string): Promise<string[]> {
  if (!ffmpegAvailable()) {
    throw new Error("ffmpeg is required to process this media but is not installed.");
  }
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
    "-f", "segment", "-segment_time", String(CHUNK_SECONDS),
    join(workDir, "chunk_%03d.mp3"),
  ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: MAX_STDOUT_BYTES });
  const chunks = (await readdir(workDir)).filter((name) => /^chunk_\d+\.mp3$/.test(name)).sort();
  if (!chunks.length) throw new Error("ffmpeg produced no audio chunks.");
  return chunks.map((name) => join(workDir, name));
}

// A whole 1500s chunk transcribes in ~60s, so a 3h video is 9 serial requests
// (~9min). Bound-parallel the requests instead: fast for long videos, but capped
// so a very long clip can't fan out dozens of concurrent Whisper calls at once.
const MAX_CONCURRENT_TRANSCRIPTIONS = 4;

/**
 * Map over items with bounded concurrency, preserving INPUT ORDER in the output
 * array (results[i] corresponds to items[i] regardless of completion order).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Transcribe a prepared audio file's chunks (bounded-parallel), concatenated in playback order. */
export async function transcribeAudioFile(audioPath: string, workDir: string): Promise<string> {
  const chunks = await extractAudioChunks(audioPath, workDir);
  const parts = await mapWithConcurrency(chunks, MAX_CONCURRENT_TRANSCRIPTIONS, async (chunkPath, index) => {
    const bytes = await readFile(chunkPath);
    const file = new File([bytes], `chunk_${String(index).padStart(3, "0")}.mp3`, { type: "audio/mpeg" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FFMPEG_TIMEOUT_MS);
    try {
      return (await transcribeAudioWithWhisper(file, controller.signal)).trim();
    } finally {
      clearTimeout(timer);
    }
  });
  const transcript = parts.filter(Boolean).join("\n\n").trim();
  if (!transcript) throw new Error("Transcription produced no text.");
  return transcript;
}
