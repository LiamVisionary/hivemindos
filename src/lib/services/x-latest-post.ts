import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  XAccountReadToolInput,
} from "@/lib/services/x-account-tool-contract";

const execFileAsync = promisify(execFile);

export type LatestXPost = {
  id: string;
  text: string;
  createdAt: string;
  username: string;
  url: string;
};

export type LatestXReply = {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  url: string;
};

export type LatestXCommentResult = {
  post: LatestXPost;
  reply: LatestXReply | null;
};

type XurlRunner = (args: string[]) => Promise<unknown>;

export function xAccountReadSessionPresent() {
  return existsSync(join(homedir(), ".xurl"));
}

export function parseXurlIdentity(payload: unknown) {
  const data = payload && typeof payload === "object"
    ? (payload as { data?: unknown }).data
    : null;
  if (!data || typeof data !== "object") return null;
  const id = String((data as { id?: unknown }).id ?? "").trim();
  const username = String((data as { username?: unknown }).username ?? "").trim().replace(/^@/, "");
  if (!/^\d+$/.test(id) || !/^[A-Za-z0-9_]{1,15}$/.test(username)) return null;
  return { id, username };
}

export function parseXurlTimelinePosts(payload: unknown, username: string): LatestXPost[] {
  const posts = payload && typeof payload === "object"
    ? (payload as { data?: unknown }).data
    : null;
  const normalizedUsername = username.trim().replace(/^@/, "");
  if (!Array.isArray(posts) || !/^[A-Za-z0-9_]{1,15}$/.test(normalizedUsername)) return [];
  return posts.flatMap((post) => {
    if (!post || typeof post !== "object") return [];
    const id = String((post as { id?: unknown }).id ?? "").trim();
    const text = String((post as { text?: unknown }).text ?? "").trim();
    const createdAt = String((post as { created_at?: unknown }).created_at ?? "").trim();
    if (!/^\d+$/.test(id) || !text) return [];
    return [{
      id,
      text,
      createdAt,
      username: normalizedUsername,
      url: `https://x.com/${normalizedUsername}/status/${id}`,
    }];
  });
}

export function parseXurlTimeline(payload: unknown, username: string): LatestXPost | null {
  return parseXurlTimelinePosts(payload, username)[0] ?? null;
}

export function parseXurlLatestReply(
  payload: unknown,
  input: { conversationId: string; ownUserId: string },
): LatestXReply | null {
  const record = payload && typeof payload === "object"
    ? payload as { data?: unknown; includes?: { users?: unknown } }
    : {};
  const users = Array.isArray(record.includes?.users) ? record.includes.users : [];
  const userById = new Map(
    users
      .filter((user): user is Record<string, unknown> => Boolean(user) && typeof user === "object")
      .map((user) => [String(user.id ?? ""), user]),
  );
  const replies = Array.isArray(record.data) ? record.data : [];
  return replies
    .filter((reply): reply is Record<string, unknown> => Boolean(reply) && typeof reply === "object")
    .filter((reply) => {
      const references = Array.isArray(reply.referenced_tweets) ? reply.referenced_tweets : [];
      return (
        String(reply.conversation_id ?? "") === input.conversationId &&
        String(reply.author_id ?? "") !== input.ownUserId &&
        references.some((reference) => (
          Boolean(reference) &&
          typeof reference === "object" &&
          (reference as { type?: unknown }).type === "replied_to"
        ))
      );
    })
    .map((reply): LatestXReply | null => {
      const id = String(reply.id ?? "").trim();
      const text = String(reply.text ?? "").trim();
      const createdAt = String(reply.created_at ?? "").trim();
      const authorId = String(reply.author_id ?? "").trim();
      const author = userById.get(authorId);
      const authorUsername = String(author?.username ?? "").trim().replace(/^@/, "");
      if (!/^\d+$/.test(id) || !text || !/^\d+$/.test(authorId)) return null;
      return {
        id,
        text,
        createdAt,
        authorId,
        authorName: String(author?.name ?? "").trim(),
        authorUsername,
        url: authorUsername
          ? `https://x.com/${authorUsername}/status/${id}`
          : `https://x.com/i/status/${id}`,
      };
    })
    .filter((reply): reply is LatestXReply => Boolean(reply))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

async function resolveXurlBin() {
  const candidates = [
    join(homedir(), ".local", "bin", "xurl"),
    "/opt/homebrew/bin/xurl",
    "/usr/local/bin/xurl",
    "xurl",
  ];
  for (const candidate of candidates) {
    if (candidate === "xurl") return candidate;
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next portable install location.
    }
  }
  return "xurl";
}

async function runInstalledXurl(args: string[]) {
  const { stdout } = await execFileAsync(await resolveXurlBin(), args, {
    timeout: 5_000,
    maxBuffer: 1_000_000,
    env: process.env,
  });
  return JSON.parse(stdout);
}

function ownTimelinePath(
  userId: string,
  options: { maxResults?: number; untilId?: string } = {},
) {
  const query = new URLSearchParams({
    max_results: String(options.maxResults ?? 5),
    exclude: "retweets,replies",
    "tweet.fields": "created_at,author_id,conversation_id",
    ...(options.untilId ? { until_id: options.untilId } : {}),
  }).toString().replaceAll("%2C", ",");
  return `/2/users/${userId}/tweets?${query}`;
}

async function latestOwnXPostWithIdentity(runXurl: XurlRunner) {
  const identity = parseXurlIdentity(await runXurl(["whoami"]));
  if (!identity) return null;
  const timeline = await runXurl([ownTimelinePath(identity.id)]);
  const post = parseXurlTimeline(timeline, identity.username);
  return post ? { identity, post } : null;
}

export async function latestOwnXPostFromXurl(
  options: { runXurl?: XurlRunner } = {},
): Promise<LatestXPost | null> {
  const runXurl = options.runXurl ?? runInstalledXurl;
  return (await latestOwnXPostWithIdentity(runXurl))?.post ?? null;
}

function normalizedCanonicalXPostId(value: string) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.match(
    /^https:\/\/(?:www\.)?x\.com\/[A-Za-z0-9_]+\/status\/(\d+)(?:\?.*)?$/i,
  )?.[1] ?? null;
}

export async function ownXPostsFromXurl(
  options: { runXurl?: XurlRunner; beforePostId?: string; limit?: number } = {},
): Promise<LatestXPost[]> {
  const requestedLimit = xAccountReadLimit(options.limit);
  const beforePostId = options.beforePostId
    ? normalizedCanonicalXPostId(options.beforePostId)
    : null;
  if (options.beforePostId && !beforePostId) {
    throw new Error("beforePostId must be a numeric X post id or canonical x.com post URL.");
  }
  const runXurl = options.runXurl ?? runInstalledXurl;
  const identity = parseXurlIdentity(await runXurl(["whoami"]));
  if (!identity) return [];
  const timeline = await runXurl([
    ownTimelinePath(identity.id, {
      maxResults: Math.max(5, requestedLimit),
      ...(beforePostId ? { untilId: beforePostId } : {}),
    }),
  ]);
  return parseXurlTimelinePosts(timeline, identity.username).slice(0, requestedLimit);
}

export async function latestCommentOnOwnLatestXPostFromXurl(
  options: { runXurl?: XurlRunner } = {},
): Promise<LatestXCommentResult | null> {
  const runXurl = options.runXurl ?? runInstalledXurl;
  const latest = await latestOwnXPostWithIdentity(runXurl);
  if (!latest) return null;
  const query = new URLSearchParams({
    query: `conversation_id:${latest.post.id} -from:${latest.identity.username}`,
    max_results: "10",
    sort_order: "recency",
    "tweet.fields": "created_at,author_id,conversation_id,referenced_tweets",
    expansions: "author_id",
    "user.fields": "username,name",
  })
    .toString()
    .replaceAll("%2C", ",")
    .replaceAll("+", "%20");
  const replies = await runXurl([`/2/tweets/search/recent?${query}`]);
  return {
    post: latest.post,
    reply: parseXurlLatestReply(replies, {
      conversationId: latest.post.id,
      ownUserId: latest.identity.id,
    }),
  };
}

export function formatLatestXPostReply(post: LatestXPost) {
  return `Your latest original X post is:\n\n${post.text}\n\n${post.url}`;
}

export function formatLatestXCommentReply(result: LatestXCommentResult) {
  if (!result.reply) {
    return `Your latest X post has no external comments yet.\n\n${result.post.url}`;
  }
  const author = result.reply.authorUsername
    ? `@${result.reply.authorUsername}`
    : result.reply.authorName || "another X user";
  const ownMention = new RegExp(`^@${result.post.username}\\s*`, "i");
  const comment = result.reply.text.replace(ownMention, "").trim() || result.reply.text;
  return `The latest comment on your latest X post is from ${author}:\n\n${comment}\n\n${result.reply.url}\n\nOriginal post: ${result.post.url}`;
}

function xAccountReadLimit(value: unknown, minimum = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(25, Math.max(minimum, Math.trunc(numeric)))
    : Math.max(10, minimum);
}

function formatXAccountToolPayload(operation: string, payload: unknown) {
  const serialized = JSON.stringify({ ok: true, operation, data: payload }, null, 2);
  return serialized.length <= 30_000
    ? serialized
    : `${serialized.slice(0, 30_000)}\n... response truncated`;
}

export async function runXAccountReadTool(
  input: XAccountReadToolInput,
  options: { runXurl?: XurlRunner } = {},
) {
  const runXurl = options.runXurl ?? runInstalledXurl;
  switch (input.operation) {
    case "latest_post": {
      const post = await latestOwnXPostFromXurl({ runXurl });
      if (!post) throw new Error("The connected X account returned no original posts.");
      return formatLatestXPostReply(post);
    }
    case "own_posts": {
      const posts = await ownXPostsFromXurl({
        runXurl,
        beforePostId: input.beforePostId,
        limit: input.limit,
      });
      return formatXAccountToolPayload(input.operation, posts);
    }
    case "latest_reply_to_latest_post": {
      const result = await latestCommentOnOwnLatestXPostFromXurl({ runXurl });
      if (!result) throw new Error("The connected X account returned no original posts.");
      return formatLatestXCommentReply(result);
    }
    case "mentions":
    case "timeline":
    case "bookmarks":
    case "likes": {
      const minimum = input.operation === "mentions" ? 5 : 1;
      const payload = await runXurl([
        input.operation,
        "-n",
        String(xAccountReadLimit(input.limit, minimum)),
      ]);
      return formatXAccountToolPayload(input.operation, payload);
    }
    case "search": {
      const query = input.query?.trim() ?? "";
      if (!query) throw new Error("An X search query is required.");
      const payload = await runXurl([
        "search",
        query,
        "-n",
        String(xAccountReadLimit(input.limit, 10)),
      ]);
      return formatXAccountToolPayload(input.operation, payload);
    }
    case "read_post": {
      const postId = input.postId?.trim() ?? "";
      if (!/^\d+$/.test(postId) && !/^https:\/\/(?:www\.)?x\.com\/[A-Za-z0-9_]+\/status\/\d+(?:\?.*)?$/.test(postId)) {
        throw new Error("A numeric X post id or canonical x.com post URL is required.");
      }
      const payload = await runXurl(["read", postId]);
      return formatXAccountToolPayload(input.operation, payload);
    }
    default:
      throw new Error(`Unsupported X account read operation: ${String(input.operation || "missing")}.`);
  }
}
