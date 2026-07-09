import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";

/**
 * Session-based Slack access — uses the user's OWN logged-in Slack session (the
 * `xoxc-` web token + the `d` cookie captured by the native flow) to read content
 * from workspaces where our OAuth app can't be installed. This is the unofficial
 * `slackdump`-style path; it's gated behind explicit in-app consent at capture time.
 *
 * Reads never expose the token/cookie to the client; retrieval runs server-side.
 */

const SLACK_API = "https://slack.com/api";
const SESSION_TOKEN_ENV = "SLACK_SESSION_TOKEN";
const SESSION_COOKIE_ENV = "SLACK_SESSION_COOKIE_D";

type SessionCreds = { token: string; cookie: string };

export async function slackSessionCreds(): Promise<SessionCreds | null> {
  const env = await readSharedAgentEnv();
  const token = sharedEnvValue(SESSION_TOKEN_ENV, env);
  const cookie = sharedEnvValue(SESSION_COOKIE_ENV, env);
  if (!token || !cookie) return null;
  return { token, cookie };
}

/** The `d` cookie value is stored percent-encoded; Slack expects `d=<value>` as-is. */
function cookieHeader(creds: SessionCreds): string {
  return `d=${creds.cookie}`;
}

async function sessionCall(
  method: string,
  params: Record<string, string>,
  creds: SessionCreds,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      cookie: cookieHeader(creds),
    },
    body: new URLSearchParams({ token: creds.token, ...params }).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || data.ok !== true) {
    throw new Error(`Slack ${method} failed: ${(data?.error as string) || `HTTP ${response.status}`}`);
  }
  return data;
}

/** Confirm the session works and report which workspace it belongs to. */
export async function slackSessionAuthTest(): Promise<{ ok: boolean; team?: string; teamId?: string; user?: string; error?: string }> {
  const creds = await slackSessionCreds();
  if (!creds) return { ok: false, error: "No Slack session connected." };
  try {
    const data = await sessionCall("auth.test", {}, creds);
    return { ok: true, team: data.team as string, teamId: data.team_id as string, user: data.user as string };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "auth.test failed" };
  }
}

type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
};

type SlackMessage = { ts?: string; files?: SlackFile[] };

function safeName(name: string, fallback: string): string {
  const clean = name.replace(/[\/\\:\0]+/g, "-").trim();
  return clean || fallback;
}

/**
 * Pull a channel's full history and download every file into `saveDir` (default
 * ~/Downloads/hivemindos-slack/<channel>/). Returns a summary. External links in
 * messages are collected but not fetched here (they're not Slack files).
 */
export async function retrieveSlackChannel(
  channelId: string,
  saveDir?: string,
): Promise<{ saveDir: string; messages: number; files: number; downloaded: number; failedFiles: string[] }> {
  const creds = await slackSessionCreds();
  if (!creds) throw new Error("No Slack session connected. Capture a Slack session first.");

  const dir = saveDir?.trim() || join(homedir(), "Downloads", "hivemindos-slack", safeName(channelId, "channel"));
  await mkdir(dir, { recursive: true });

  // Paginate the whole history.
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const data = await sessionCall(
      "conversations.history",
      { channel: channelId, limit: "200", ...(cursor ? { cursor } : {}) },
      creds,
    );
    messages.push(...((data.messages as SlackMessage[]) || []));
    cursor = ((data.response_metadata as { next_cursor?: string })?.next_cursor || "").trim() || undefined;
  } while (cursor);

  await writeFile(join(dir, "messages.json"), JSON.stringify(messages, null, 2), "utf8");

  const files = messages.flatMap((m) => m.files || []).filter((f) => f && (f.url_private_download || f.url_private));
  const failedFiles: string[] = [];
  let downloaded = 0;
  const filesDir = join(dir, "files");
  if (files.length) await mkdir(filesDir, { recursive: true });

  for (const file of files) {
    const url = file.url_private_download || file.url_private!;
    const name = safeName(file.name || file.title || file.id || "file", file.id || "file");
    try {
      const res = await fetch(url, {
        headers: { cookie: cookieHeader(creds), authorization: `Bearer ${creds.token}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(join(filesDir, `${file.id ? `${file.id}-` : ""}${name}`), buf);
      downloaded += 1;
    } catch (error) {
      failedFiles.push(`${name}: ${error instanceof Error ? error.message : "download failed"}`);
    }
  }

  return { saveDir: dir, messages: messages.length, files: files.length, downloaded, failedFiles };
}
