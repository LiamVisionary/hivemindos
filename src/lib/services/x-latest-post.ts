import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LatestXPost = {
  id: string;
  text: string;
  createdAt: string;
  username: string;
  url: string;
};

type XurlRunner = (args: string[]) => Promise<unknown>;

export function isLatestOwnXPostRequest(input: string) {
  const text = input.replace(/\s+/g, " ").trim().toLowerCase();
  if (!text || !/\b(?:x|twitter|tweet|post(?:ed)?)\b/.test(text)) return false;
  if (!/\b(?:my|i)\b/.test(text)) return false;
  if (!/\b(?:latest|newest|most recent|last)\b/.test(text)) return false;
  return /\b(?:grab|get|fetch|show|find|what(?:'s| is)|which|read|pull)\b/.test(text);
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

export function parseXurlTimeline(payload: unknown, username: string): LatestXPost | null {
  const posts = payload && typeof payload === "object"
    ? (payload as { data?: unknown }).data
    : null;
  const first = Array.isArray(posts) ? posts[0] : null;
  if (!first || typeof first !== "object") return null;
  const id = String((first as { id?: unknown }).id ?? "").trim();
  const text = String((first as { text?: unknown }).text ?? "").trim();
  const createdAt = String((first as { created_at?: unknown }).created_at ?? "").trim();
  const normalizedUsername = username.trim().replace(/^@/, "");
  if (!/^\d+$/.test(id) || !text || !/^[A-Za-z0-9_]{1,15}$/.test(normalizedUsername)) return null;
  return {
    id,
    text,
    createdAt,
    username: normalizedUsername,
    url: `https://x.com/${normalizedUsername}/status/${id}`,
  };
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

export async function latestOwnXPostFromXurl(
  options: { runXurl?: XurlRunner } = {},
): Promise<LatestXPost | null> {
  const runXurl = options.runXurl ?? runInstalledXurl;
  const identity = parseXurlIdentity(await runXurl(["whoami"]));
  if (!identity) return null;
  const query = new URLSearchParams({
    max_results: "5",
    exclude: "retweets,replies",
    "tweet.fields": "created_at,author_id,conversation_id",
  }).toString().replaceAll("%2C", ",");
  const timeline = await runXurl([`/2/users/${identity.id}/tweets?${query}`]);
  return parseXurlTimeline(timeline, identity.username);
}

export function formatLatestXPostReply(post: LatestXPost) {
  return `Your latest original X post is:\n\n${post.text}\n\n${post.url}`;
}

export async function latestOwnXPostAnswer(input: string) {
  if (!isLatestOwnXPostRequest(input)) return null;
  const post = await latestOwnXPostFromXurl().catch(() => null);
  return post ? formatLatestXPostReply(post) : null;
}
