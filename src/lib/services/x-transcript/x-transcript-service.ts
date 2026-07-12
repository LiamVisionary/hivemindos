import "server-only";

import type { NextRequest } from "next/server";

import { normalizeHivemindosWalletPaidSlug } from "@/lib/config/hivemindos-wallet-paid-models";
import { getHivemindosModelCreditToken, listHivemindosModelCreditTokenSummaries } from "@/lib/services/hivemindos-model-credit-vault";
import { getManagedXConnections, proxyManagedXApiCall } from "@/lib/services/managed-x-api-client";
import {
  downloadTwimgMp4,
  downloadXAudio,
  downloadXCaptions,
  probeXMedia,
  resolveYtDlp,
  transcribeAudioFile,
  withTempDir,
} from "@/lib/services/x-transcript/media-transcribe";
import { summarizeTranscript } from "@/lib/services/x-transcript/summarize";
import { parseXPostUrl } from "@/lib/services/x-transcript/x-url";
import { numberEnv } from "@/lib/config/env";

// Safety ceiling on how long a clip we will send to a speech-to-text provider. X caps
// normal video at ~2h, but yt-dlp can also resolve multi-hour Spaces/broadcasts;
// this bounds a single paid run. Generous by default; override to raise.
const MAX_TRANSCRIBE_SECONDS = numberEnv("X_TRANSCRIPT_MAX_SECONDS", 10_800);

export type XTranscriptKind = "video" | "thread" | "single";

export type XTranscriptInspection = {
  kind: "video" | "post" | "unknown";
  canonicalUrl: string;
  durationSec?: number;
  title?: string;
  author?: { handle?: string; name?: string };
};

export type XThreadPost = {
  text: string;
  createdAt?: string;
};

export type XTranscriptResult = {
  kind: XTranscriptKind;
  url: string;
  canonicalUrl: string;
  tweetId: string;
  author?: { handle?: string; name?: string };
  title?: string;
  transcript: string;
  posts?: XThreadPost[];
  postCount?: number;
  durationSec?: number;
  source: string;
  summary?: string;
  followUpQuestion?: string;
  warnings: string[];
};

export type ResolveXTranscriptInput = {
  request: NextRequest;
  url: string;
  summarize?: boolean;
  /** Cache isolation only; transcript resolution never reads or mutates chat state. */
  threadId?: string;
};

type XTweet = {
  id?: string;
  text?: string;
  note_tweet?: { text?: string };
  conversation_id?: string;
  author_id?: string;
  created_at?: string;
  attachments?: { media_keys?: string[] };
};

type XMedia = {
  media_key?: string;
  type?: string;
  duration_ms?: number;
  variants?: Array<{ bit_rate?: number; content_type?: string; url?: string }>;
};

type XUser = { id?: string; username?: string; name?: string };

type XBody = { data?: unknown; includes?: { users?: XUser[]; media?: XMedia[] }; meta?: unknown };

type ManagedXContext = { creditToken: string; slug: string; connectionId?: string };

/** Resolve a funded hosted-credit token + xoauth connection for authed X reads. */
async function resolveManagedXContext(): Promise<ManagedXContext> {
  const slug = normalizeHivemindosWalletPaidSlug(null);
  const summaries = (await listHivemindosModelCreditTokenSummaries())
    .filter((record) => normalizeHivemindosWalletPaidSlug(record.slug) === slug);
  if (!summaries.length) {
    throw new Error("Thread mode needs a funded HivemindOS X credit account. Open Integrations → X and fund credits first.");
  }
  let creditToken = "";
  for (const record of summaries) {
    creditToken = await getHivemindosModelCreditToken(record.walletAgentId, slug).catch(() => "");
    if (creditToken) break;
  }
  if (!creditToken) {
    throw new Error("No hosted HivemindOS X credit token is stored. Fund X credits in Integrations → X first.");
  }
  const connectionId = await firstConnectionId(creditToken, slug);
  return { creditToken, slug, connectionId };
}

async function firstConnectionId(creditToken: string, slug: string): Promise<string | undefined> {
  const response = await getManagedXConnections(creditToken, slug);
  const body = await response.json().catch(() => null) as { connections?: unknown } | null;
  const connections = Array.isArray(body?.connections) ? body.connections : [];
  for (const connection of connections) {
    if (connection && typeof connection === "object") {
      const record = connection as Record<string, unknown>;
      const id = record.id ?? record.connectionId ?? record.connection_id;
      if (typeof id === "string" && id.trim()) return id.trim();
    }
  }
  return undefined;
}

/** The gateway proxies X reads; its exact envelope is not in this repo, so unwrap defensively. */
function pickXBody(raw: unknown): XBody {
  const candidates = [raw, (raw as { data?: unknown })?.data, (raw as { result?: unknown })?.result, (raw as { response?: unknown })?.response, (raw as { body?: unknown })?.body, (raw as { payload?: unknown })?.payload];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const body = candidate as XBody;
      const data = body.data;
      const looksTweet = Array.isArray(data) || (Boolean(data) && typeof data === "object" && ("id" in (data as object) || "text" in (data as object)));
      if (looksTweet || "includes" in body || "meta" in body) return body;
    }
  }
  return (raw && typeof raw === "object" ? raw : {}) as XBody;
}

async function xApiGet(context: ManagedXContext, request: NextRequest, path: string, query: Record<string, string>): Promise<XBody> {
  const response = await proxyManagedXApiCall({
    request,
    creditToken: context.creditToken,
    slug: context.slug,
    body: { connectionId: context.connectionId, method: "GET", path, query },
  });
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const message = raw && typeof raw === "object" && "error" in raw ? String((raw as { error?: unknown }).error) : `HTTP ${response.status}`;
    throw new Error(`X API read failed (${message}).`);
  }
  return pickXBody(raw);
}

function smallestMp4Variant(media: XMedia[] | undefined): string | undefined {
  const variants = (media ?? [])
    .flatMap((item) => item.variants ?? [])
    .filter((variant) => variant.content_type === "video/mp4" && typeof variant.url === "string");
  // Only the audio track is transcribed, so the LOWEST-bitrate mp4 carries the
  // same speech with the smallest download + in-memory footprint.
  const withRate = variants.filter((variant) => typeof variant.bit_rate === "number" && variant.bit_rate > 0);
  withRate.sort((a, b) => (a.bit_rate ?? 0) - (b.bit_rate ?? 0));
  return (withRate[0] ?? variants[0])?.url;
}

function tweetText(tweet: XTweet): string {
  const note = tweet.note_tweet?.text?.trim();
  return (note && note.length > (tweet.text ?? "").trim().length ? note : (tweet.text ?? "").trim()) || "";
}

async function transcribeFromMp4(url: string): Promise<string> {
  return withTempDir(async (dir) => {
    const mp4 = await downloadTwimgMp4(url, dir);
    // transcribeAudioFile extracts audio chunks from any media file internally.
    return transcribeAudioFile(mp4, dir);
  });
}

/** Fast, read-only media probe used to set expectations before transcription. */
export async function inspectXTranscript(url: string): Promise<XTranscriptInspection> {
  const parsed = parseXPostUrl(url);
  if (!parsed) throw new Error("That doesn't look like an X post link. Paste a link like https://x.com/user/status/123…");
  if (!resolveYtDlp()) {
    return { kind: "unknown", canonicalUrl: parsed.canonicalUrl, author: parsed.handle ? { handle: parsed.handle } : undefined };
  }
  const probe = await probeXMedia(parsed.canonicalUrl);
  return {
    kind: probe.hasVideo ? "video" : "post",
    canonicalUrl: parsed.canonicalUrl,
    durationSec: probe.durationSec,
    title: probe.title,
    author: probe.uploaderId || probe.uploader || parsed.handle
      ? { handle: probe.uploaderId ?? parsed.handle, name: probe.uploader }
      : undefined,
  };
}

export async function resolveXTranscript(input: ResolveXTranscriptInput): Promise<XTranscriptResult> {
  const parsed = parseXPostUrl(input.url);
  if (!parsed) throw new Error("That doesn't look like an X post link. Paste a link like https://x.com/user/status/123…");
  const warnings: string[] = [];

  const base = { url: input.url, canonicalUrl: parsed.canonicalUrl, tweetId: parsed.tweetId, warnings };

  // 1) Video-first via yt-dlp (needs no X credits for public posts).
  const ytdlp = resolveYtDlp();
  if (ytdlp) {
    let probe: Awaited<ReturnType<typeof probeXMedia>> | null = null;
    try {
      probe = await probeXMedia(parsed.canonicalUrl);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "yt-dlp probe failed.");
    }
    if (probe?.hasVideo && probe.durationSec && probe.durationSec > MAX_TRANSCRIBE_SECONDS) {
      throw new Error(`This video is ${Math.round(probe.durationSec / 60)} min, over the ${Math.round(MAX_TRANSCRIBE_SECONDS / 60)} min transcription limit. Raise X_TRANSCRIPT_MAX_SECONDS to allow it.`);
    }
    if (probe?.hasVideo) {
      if (probe.hasEnglishCaptions) {
        try {
          const transcript = await withTempDir((dir) => downloadXCaptions(parsed.canonicalUrl, dir));
          return withSummary({
            ...base,
            kind: "video",
            author: probe.uploaderId || probe.uploader ? { handle: probe.uploaderId ?? parsed.handle, name: probe.uploader } : parsed.handle ? { handle: parsed.handle } : undefined,
            title: probe.title,
            durationSec: probe.durationSec,
            transcript,
            source: `${ytdlp.join(" ")} captions`,
          }, input.summarize);
        } catch (error) {
          warnings.push(`Video captions could not be read (${error instanceof Error ? error.message : String(error)}); falling back to audio transcription.`);
        }
      }
      try {
        const transcript = await withTempDir(async (dir) => {
          const audio = await downloadXAudio(parsed.canonicalUrl, dir);
          return transcribeAudioFile(audio, dir);
        });
        return withSummary({
          ...base,
          kind: "video",
          author: probe.uploaderId || probe.uploader ? { handle: probe.uploaderId ?? parsed.handle, name: probe.uploader } : parsed.handle ? { handle: parsed.handle } : undefined,
          title: probe.title,
          durationSec: probe.durationSec,
          transcript,
          source: `${ytdlp.join(" ")} + speech-to-text`,
        }, input.summarize);
      } catch (error) {
        // Silent/music clip, empty transcript, or a no-ffmpeg box: fall through
        // to the authenticated X API (mp4 variant or the post's own text/thread)
        // instead of hard-failing.
        warnings.push(`Video audio transcription failed (${error instanceof Error ? error.message : String(error)}); retrying with authenticated X media.`);
      }
    }
  } else {
    warnings.push("yt-dlp is not installed; falling back to the authenticated X API for video and thread.");
  }

  // 2) Authenticated read for threads (and yt-dlp-missed videos).
  const context = await resolveManagedXContext();
  const rootBody = await xApiGet(context, input.request, `/2/tweets/${parsed.tweetId}`, {
    "tweet.fields": "note_tweet,conversation_id,author_id,created_at,text,attachments",
    expansions: "attachments.media_keys,author_id",
    "media.fields": "type,duration_ms,variants,preview_image_url",
    "user.fields": "username,name",
  });
  const root = (rootBody.data && typeof rootBody.data === "object" && !Array.isArray(rootBody.data) ? rootBody.data : {}) as XTweet;
  const rootAuthor = (rootBody.includes?.users ?? []).find((user) => user.id === root.author_id);
  const author = rootAuthor?.username || parsed.handle
    ? { handle: (rootAuthor?.username ?? parsed.handle)?.replace(/^@/, ""), name: rootAuthor?.name }
    : undefined;

  // 2a) The API sees a video yt-dlp missed → transcribe from the mp4 variant.
  const mp4 = smallestMp4Variant(rootBody.includes?.media);
  if (mp4) {
    try {
      const transcript = await transcribeFromMp4(mp4);
      const durationMs = (rootBody.includes?.media ?? []).find((item) => (item.duration_ms ?? 0) > 0)?.duration_ms;
      return withSummary({
        ...base,
        kind: "video",
        author,
        title: tweetText(root).slice(0, 140) || undefined,
        durationSec: durationMs ? Math.round(durationMs / 1000) : undefined,
        transcript,
        source: "x-api mp4 + speech-to-text",
      }, input.summarize);
    } catch (error) {
      warnings.push(`Authenticated X video transcription failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 2b) Thread reconstruction (always full thread, per user setting). Build the
  // whole conversation as a set keyed by tweet id and sort by created_at, so a
  // pasted MID-thread tweet lands in its true chronological place instead of the
  // front (conversation_id points at the thread head, not the pasted tweet).
  const byId = new Map<string, XThreadPost>();
  const rootText = tweetText(root);
  if (rootText) byId.set(root.id ?? `root-${parsed.tweetId}`, { text: rootText, createdAt: root.created_at });

  if (root.conversation_id) {
    try {
      // Scope to the author's self-thread (the insight thread) when we know them,
      // rather than everyone's replies.
      const query = author?.handle
        ? `conversation_id:${root.conversation_id} from:${author.handle}`
        : `conversation_id:${root.conversation_id}`;
      const searchBody = await xApiGet(context, input.request, "/2/tweets/search/recent", {
        query,
        max_results: "100",
        "tweet.fields": "note_tweet,created_at,author_id,text",
        sort_order: "recency",
      });
      const replies = (Array.isArray(searchBody.data) ? searchBody.data : []) as XTweet[];
      for (const tweet of replies) {
        const text = tweetText(tweet);
        if (text && tweet.id) byId.set(tweet.id, { text, createdAt: tweet.created_at });
      }
    } catch (error) {
      warnings.push(`Full-thread reconstruction unavailable (${error instanceof Error ? error.message : String(error)}). Showing the root post only.`);
    }
  }

  const posts = [...byId.values()].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  if (!posts.length) throw new Error("Could not read any text from that X post (it may be protected, deleted, or unavailable).");
  const transcript = posts.map((post) => post.text).join("\n\n");
  return withSummary({
    ...base,
    kind: posts.length > 1 ? "thread" : "single",
    author,
    title: posts[0]?.text.slice(0, 140),
    transcript,
    posts,
    postCount: posts.length,
    source: "x-api thread",
  }, input.summarize);
}

async function withSummary(result: Omit<XTranscriptResult, "summary" | "followUpQuestion">, summarize?: boolean): Promise<XTranscriptResult> {
  if (!summarize) return result;
  try {
    const { summary, followUpQuestion } = await summarizeTranscript({
      transcript: result.transcript,
      kind: result.kind,
      author: result.author?.handle,
      title: result.title,
    });
    return { ...result, summary, followUpQuestion };
  } catch (error) {
    return { ...result, warnings: [...result.warnings, `Summary unavailable: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
