import "server-only";

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { readSharedAgentEnv, sharedEnvValue } from "@/lib/services/integrations/shared-env";
import { downloadSlackLinkedContent } from "@/lib/services/integrations/slack-linked-content";
import type { LongRunningProcessProgress } from "@/lib/types/long-running-processes";

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
type SlackConversation = { id?: string; name?: string; is_private?: boolean };

export type SlackChannel = {
  id: string;
  name: string;
  isPrivate: boolean;
};

export type SlackIgnoredFileType = "image";

export type SlackRetrievalOptions = {
  ignoreFileTypes?: SlackIgnoredFileType[];
  deepDownload?: boolean;
  onProgress?: (progress: LongRunningProcessProgress) => void;
};

const SLACK_CHANNEL_ID_RE = /^[CGD][A-Z0-9]+$/;

function safeName(name: string, fallback: string): string {
  const clean = name.replace(/[\/\\:\0]+/g, "-").trim();
  return clean || fallback;
}

function shouldIgnoreSlackFile(
  file: SlackFile,
  ignoredFileTypes: ReadonlySet<SlackIgnoredFileType>,
): boolean {
  const mimeType = file.mimetype?.trim().toLowerCase() || "";
  return ignoredFileTypes.has("image") && mimeType.startsWith("image/");
}

function publishSlackRetrievalProgress(
  options: SlackRetrievalOptions | undefined,
  progress: LongRunningProcessProgress,
): void {
  try {
    options?.onProgress?.(progress);
  } catch {
    // Progress reporting is observational and must never interrupt a download.
  }
}

async function* slackConversationPages(
  creds: SessionCreds,
): AsyncGenerator<SlackConversation[]> {
  let cursor: string | undefined;
  do {
    const data = await sessionCall(
      "conversations.list",
      {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: "200",
        ...(cursor ? { cursor } : {}),
      },
      creds,
    );
    yield (data.channels as SlackConversation[]) || [];
    cursor = ((data.response_metadata as { next_cursor?: string })?.next_cursor || "").trim() || undefined;
  } while (cursor);
}

export async function listSlackChannels(): Promise<SlackChannel[]> {
  const creds = await slackSessionCreds();
  if (!creds) throw new Error("No Slack session connected. Capture a Slack session first.");

  const channels: SlackChannel[] = [];
  for await (const page of slackConversationPages(creds)) {
    for (const channel of page) {
      if (!channel.id || !channel.name) continue;
      channels.push({
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private === true,
      });
    }
  }

  return channels.sort((left, right) => left.name.localeCompare(right.name));
}

async function resolveSlackChannelReference(
  reference: string,
  creds: SessionCreds,
): Promise<{ id: string; name?: string }> {
  const clean = reference.trim();
  if (SLACK_CHANNEL_ID_RE.test(clean)) return { id: clean };

  const requestedName = clean.replace(/^#/, "").trim().toLowerCase();
  if (!requestedName) throw new Error("Enter a Slack channel name or id.");

  for await (const page of slackConversationPages(creds)) {
    const channel = page.find(
      (candidate) => candidate.name?.toLowerCase() === requestedName && candidate.id,
    );
    if (channel?.id) return { id: channel.id, name: channel.name || requestedName };
  }

  throw new Error(
    `Slack channel #${requestedName} was not found. Make sure this signed-in account can see it.`,
  );
}

/**
 * Pull a channel's full history and download every file into `saveDir` (default
 * ~/Downloads/hivemindos-slack/<channel>/). When deep download is enabled,
 * public linked pages are saved as Markdown and their linked assets are fetched
 * through the bounded linked-content crawler.
 */
export async function retrieveSlackChannel(
  channelReference: string,
  saveDir?: string,
  options?: SlackRetrievalOptions,
): Promise<{
  saveDir: string;
  channelId: string;
  channelName?: string;
  messages: number;
  files: number;
  ignoredFiles: number;
  downloaded: number;
  failedFiles: string[];
  linkedLinksFound: number;
  linkedItemsDiscovered: number;
  linkedItemsProcessed: number;
  linkedPages: number;
  linkedNotionPages: number;
  linkedFiles: number;
  linkedIgnoredFiles: number;
  linkedSkippedByLimit: number;
  linkedMaxGraphDepth: number;
  linkedComplete: boolean;
  linkedFailures: string[];
}> {
  const creds = await slackSessionCreds();
  if (!creds) throw new Error("No Slack session connected. Capture a Slack session first.");
  publishSlackRetrievalProgress(options, {
    stage: "resolving-channel",
    label: "Finding Slack channel",
    detail: channelReference.trim(),
  });
  const channel = await resolveSlackChannelReference(channelReference, creds);

  const dir = saveDir?.trim()
    || join(homedir(), "Downloads", "hivemindos-slack", safeName(channel.name || channel.id, "channel"));
  await mkdir(dir, { recursive: true });

  // Paginate the whole history.
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  let historyPages = 0;
  do {
    const data = await sessionCall(
      "conversations.history",
      { channel: channel.id, limit: "200", ...(cursor ? { cursor } : {}) },
      creds,
    );
    messages.push(...((data.messages as SlackMessage[]) || []));
    historyPages += 1;
    publishSlackRetrievalProgress(options, {
      stage: "slack-history",
      label: "Reading Slack message history",
      completed: messages.length,
      detail: `${messages.length} message${messages.length === 1 ? "" : "s"} across ${historyPages} page${historyPages === 1 ? "" : "s"}`,
    });
    cursor = ((data.response_metadata as { next_cursor?: string })?.next_cursor || "").trim() || undefined;
  } while (cursor);

  publishSlackRetrievalProgress(options, {
    stage: "saving-history",
    label: "Saving Slack message history",
    completed: messages.length,
    detail: "Writing messages.json",
  });
  await writeFile(join(dir, "messages.json"), JSON.stringify(messages, null, 2), "utf8");

  const files = messages.flatMap((m) => m.files || []).filter((f) => f && (f.url_private_download || f.url_private));
  const ignoredFileTypes = new Set(options?.ignoreFileTypes || []);
  const downloadableFiles = files.filter((file) => !shouldIgnoreSlackFile(file, ignoredFileTypes));
  const failedFiles: string[] = [];
  let downloaded = 0;
  const filesDir = join(dir, "files");
  if (downloadableFiles.length) await mkdir(filesDir, { recursive: true });

  publishSlackRetrievalProgress(options, {
    stage: "slack-files",
    label: "Downloading Slack files",
    completed: 0,
    total: downloadableFiles.length,
    detail: downloadableFiles.length
      ? `${downloadableFiles.length} file${downloadableFiles.length === 1 ? "" : "s"} queued`
      : "No Slack files to download",
  });
  for (const [index, file] of downloadableFiles.entries()) {
    const url = file.url_private_download || file.url_private!;
    const name = safeName(file.name || file.title || file.id || "file", file.id || "file");
    let detail = `Downloading ${name}`;
    publishSlackRetrievalProgress(options, {
      stage: "slack-files",
      label: "Downloading Slack files",
      completed: index,
      total: downloadableFiles.length,
      detail,
    });
    try {
      const res = await fetch(url, {
        headers: { cookie: cookieHeader(creds), authorization: `Bearer ${creds.token}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      await writeFile(join(filesDir, `${file.id ? `${file.id}-` : ""}${name}`), bytes);
      downloaded += 1;
      detail = `Downloaded ${name}`;
    } catch (error) {
      failedFiles.push(`${name}: ${error instanceof Error ? error.message : "download failed"}`);
      detail = `Could not download ${name}`;
    } finally {
      publishSlackRetrievalProgress(options, {
        stage: "slack-files",
        label: "Downloading Slack files",
        completed: index + 1,
        total: downloadableFiles.length,
        detail,
      });
    }
  }

  const linkedSummary = options?.deepDownload
    ? await downloadSlackLinkedContent(messages, dir, {
        ignoreFileTypes: options.ignoreFileTypes,
        onProgress: options.onProgress,
      })
    : {
        linksFound: 0,
        itemsDiscovered: 0,
        itemsProcessed: 0,
        pagesDownloaded: 0,
        notionPagesDownloaded: 0,
        filesDownloaded: 0,
        ignoredFiles: 0,
        skippedByLimit: 0,
        maxGraphDepth: 0,
        complete: true,
        failed: [],
      };

  publishSlackRetrievalProgress(options, {
    stage: "finalizing",
    label: "Finalizing Slack download",
    completed: 1,
    total: 1,
    detail: `Saved to ${dir}`,
  });

  return {
    saveDir: dir,
    channelId: channel.id,
    ...(channel.name ? { channelName: channel.name } : {}),
    messages: messages.length,
    files: files.length,
    ignoredFiles: files.length - downloadableFiles.length,
    downloaded,
    failedFiles,
    linkedLinksFound: linkedSummary.linksFound,
    linkedItemsDiscovered: linkedSummary.itemsDiscovered,
    linkedItemsProcessed: linkedSummary.itemsProcessed,
    linkedPages: linkedSummary.pagesDownloaded,
    linkedNotionPages: linkedSummary.notionPagesDownloaded,
    linkedFiles: linkedSummary.filesDownloaded,
    linkedIgnoredFiles: linkedSummary.ignoredFiles,
    linkedSkippedByLimit: linkedSummary.skippedByLimit,
    linkedMaxGraphDepth: linkedSummary.maxGraphDepth,
    linkedComplete: linkedSummary.complete,
    linkedFailures: linkedSummary.failed,
  };
}
