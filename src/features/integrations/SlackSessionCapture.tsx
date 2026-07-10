"use client";

import * as React from "react";

import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { invokeNative } from "@/lib/native/invoke";
import type { LongRunningProcessProgress } from "@/lib/types/long-running-processes";
import { BBtn, BIcon } from "./integrations-primitives";

type CapturedPayload = { xoxc?: string; d?: string; team_id?: string; team_name?: string };
type SessionStatus = { ok?: boolean; team?: string; teamId?: string; user?: string; error?: string };
type SlackChannelOption = { id: string; name: string; isPrivate: boolean };
type SlackRetrievalSummary = {
  saveDir?: string;
  messages?: number;
  files?: number;
  ignoredFiles?: number;
  downloaded?: number;
  failedFiles?: string[];
  linkedLinksFound?: number;
  linkedItemsDiscovered?: number;
  linkedItemsProcessed?: number;
  linkedPages?: number;
  linkedNotionPages?: number;
  linkedFiles?: number;
  linkedIgnoredFiles?: number;
  linkedSkippedByLimit?: number;
  linkedMaxGraphDepth?: number;
  linkedComplete?: boolean;
  linkedFailures?: string[];
};
type SlackRetrievalJob = {
  id?: string;
  status?: "running" | "succeeded" | "failed";
  progress?: LongRunningProcessProgress;
  result?: SlackRetrievalSummary | null;
  error?: string | null;
};

/**
 * "Retrieve from another workspace" — the consented, session-based Slack path for
 * workspaces where our OAuth app can't be installed. Desktop-only: it invokes the
 * native `slack_session_capture` command (embedded Slack login → captures the
 * xoxc token + d cookie), persists them, then lets the user pull a channel's files.
 */
export function SlackSessionCapture({ actionView = false }: { actionView?: boolean }) {
  const desktop = isTauriDesktopRuntime();
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState<"" | "capture" | "retrieve">("");
  const [note, setNote] = React.useState("");
  const [session, setSession] = React.useState<SessionStatus | null>(null);
  const [channel, setChannel] = React.useState("");
  const [deepDownload, setDeepDownload] = React.useState(true);
  const [ignoreImages, setIgnoreImages] = React.useState(false);
  const [channels, setChannels] = React.useState<SlackChannelOption[]>([]);
  const [channelsLoading, setChannelsLoading] = React.useState(false);
  const [channelsError, setChannelsError] = React.useState("");
  const [retrievalProgress, setRetrievalProgress] = React.useState<LongRunningProcessProgress | null>(null);
  const unlistenRef = React.useRef<Array<() => void>>([]);
  const retrievalPollTokenRef = React.useRef(0);

  const refreshChannels = React.useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError("");
    try {
      const res = await fetch("/api/integrations/slack/session/channels", { cache: "no-store" });
      const data = (await res.json()) as { channels?: SlackChannelOption[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load Slack channels.");
      setChannels(Array.isArray(data.channels) ? data.channels : []);
      setChannel("");
    } catch (error) {
      setChannels([]);
      setChannel("");
      setChannelsError(error instanceof Error ? error.message : "Could not load Slack channels.");
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  const refreshSession = React.useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/slack/session/retrieve", { cache: "no-store" });
      const data = (await res.json()) as SessionStatus;
      setSession(res.ok ? data : null);
      if (res.ok && data.ok) {
        void refreshChannels();
      } else {
        setChannels([]);
        setChannel("");
      }
    } catch {
      setSession(null);
      setChannels([]);
      setChannel("");
    }
  }, [refreshChannels]);

  React.useEffect(() => {
    let active = true;
    if (desktop) {
      queueMicrotask(() => {
        if (active) void refreshSession();
      });
    }
    return () => {
      active = false;
      retrievalPollTokenRef.current += 1;
      for (const off of unlistenRef.current) off();
      unlistenRef.current = [];
    };
  }, [desktop, refreshSession]);

  if (!desktop) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {!actionView ? <div className="fm-sec" style={{ margin: "2px 0 0" }}>Retrieve from another workspace</div> : null}
        <div className="fm-note">
          <BIcon name="shield" size={15} />
          <span>Available in the HivemindOS desktop app — it uses an embedded Slack sign-in to read workspaces where the official app can’t be installed.</span>
        </div>
      </div>
    );
  }

  async function persist(payload: CapturedPayload) {
    const res = await fetch("/api/integrations/slack/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; team_name?: string };
    if (!res.ok) throw new Error(data.error || "Could not save the Slack session.");
    await refreshSession();
    setNote(`Session connected${data.team_name ? ` — ${data.team_name}` : ""}. You can retrieve a channel below.`);
  }

  async function startCapture() {
    setBusy("capture");
    setNote("Opening Slack sign-in… complete it in the window, then this updates on its own.");
    try {
      const { listen } = await import("@tauri-apps/api/event");
      for (const off of unlistenRef.current) off();
      unlistenRef.current = [];
      const onCaptured = await listen<CapturedPayload>("slack-session-captured", (event) => {
        void (async () => {
          setNote("Slack sign-in complete. Saving session…");
          try {
            await persist(event.payload);
          } catch (error) {
            setNote(error instanceof Error ? error.message : "Could not save the Slack session.");
          } finally {
            setBusy("");
          }
        })();
      });
      const onError = await listen<{ error?: string }>("slack-session-capture-error", (event) => {
        setNote(event.payload?.error || "Slack sign-in was not completed.");
        setBusy("");
      });
      unlistenRef.current = [onCaptured, onError];
      await invokeNative("slack_session_capture");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not open Slack sign-in.");
      setBusy("");
    }
  }

  async function pollRetrievalJob(
    jobId: string,
    pollToken: number,
  ): Promise<SlackRetrievalSummary | null> {
    let transientFailures = 0;
    while (retrievalPollTokenRef.current === pollToken) {
      let response: Response;
      let data: { error?: string; job?: SlackRetrievalJob };
      try {
        response = await fetch(
          `/api/integrations/slack/session/retrieve?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        data = (await response.json()) as typeof data;
        transientFailures = 0;
      } catch (error) {
        transientFailures += 1;
        if (transientFailures >= 3) throw error;
        setNote("The download is still running. Reconnecting to its status…");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2_500));
        continue;
      }
      if (!response.ok) throw new Error(data.error || "Could not read download status.");
      if (data.job?.progress) {
        setRetrievalProgress(data.job.progress);
      }
      if (data.job?.status === "failed") throw new Error(data.job.error || "Retrieval failed.");
      if (data.job?.status === "succeeded" && data.job.result) return data.job.result;
      if (data.job?.status !== "running") throw new Error("The Slack retrieval job returned an unknown status.");
      const progress = data.job.progress;
      setNote(
        progress
          ? `${progress.label}${progress.detail ? ` — ${progress.detail}` : ""}`
          : `${deepDownload ? "Deep download" : "Download"} is running in the background…`,
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500));
    }
    return null;
  }

  async function retrieve() {
    if (!channel.trim()) return;
    const pollToken = retrievalPollTokenRef.current + 1;
    retrievalPollTokenRef.current = pollToken;
    setBusy("retrieve");
    setRetrievalProgress({
      stage: "starting",
      label: "Starting Slack download",
      detail: channel.trim(),
    });
    setNote(`Starting ${deepDownload ? "deep download" : "download"} for ${channel.trim()}…`);
    try {
      const res = await fetch("/api/integrations/slack/session/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: channel.trim(),
          deepDownload,
          ignoreFileTypes: ignoreImages ? ["image"] : [],
        }),
      });
      const started = (await res.json()) as { error?: string; jobId?: string };
      if (!res.ok) throw new Error(started.error || "Could not start retrieval.");
      if (!started.jobId) throw new Error("The retrieval route did not return a job id.");
      const result = await pollRetrievalJob(started.jobId, pollToken);
      if (!result) return;

      const ignoredFiles = result.ignoredFiles ?? 0;
      const downloadableFiles = Math.max(0, (result.files ?? 0) - ignoredFiles);
      const failed = result.failedFiles?.length ? ` (${result.failedFiles.length} failed)` : "";
      const ignored = ignoredFiles
        ? ` Ignored ${ignoredFiles} image file${ignoredFiles === 1 ? "" : "s"}.`
        : "";
      const linkedFailures = result.linkedFailures?.length
        ? ` ${result.linkedFailures.length} linked item${result.linkedFailures.length === 1 ? "" : "s"} failed.`
        : "";
      const linkedLimit = result.linkedSkippedByLimit
        ? ` ${result.linkedSkippedByLimit} linked item${result.linkedSkippedByLimit === 1 ? " was" : "s were"} skipped at the safety limit.`
        : "";
      const deep = deepDownload
        ? ` Deep download found ${result.linkedLinksFound ?? 0} message links and discovered ${result.linkedItemsDiscovered ?? 0} linked items across ${result.linkedMaxGraphDepth ?? 0} link levels. It processed ${result.linkedItemsProcessed ?? 0} items, saved ${result.linkedPages ?? 0} pages as Markdown (${result.linkedNotionPages ?? 0} from Notion), and downloaded ${result.linkedFiles ?? 0} linked files.${result.linkedComplete ? " Every discovered item completed successfully." : " The extraction did not complete every discovered item."}`
        : "";
      const linkedIgnored = result.linkedIgnoredFiles
        ? ` Ignored ${result.linkedIgnoredFiles} linked image${result.linkedIgnoredFiles === 1 ? "" : "s"}.`
        : "";
      setNote(`Saved ${result.messages ?? 0} messages and downloaded ${result.downloaded ?? 0}/${downloadableFiles} Slack files${failed} to ${result.saveDir}.${deep}${ignored}${linkedIgnored}${linkedFailures}${linkedLimit}`);
    } catch (error) {
      if (retrievalPollTokenRef.current === pollToken) {
        setNote(error instanceof Error ? error.message : "Retrieval failed.");
      }
    } finally {
      if (retrievalPollTokenRef.current === pollToken) setBusy("");
    }
  }

  const connected = Boolean(session?.ok);

  return (
    <div style={{ display: "grid", gap: 10, borderTop: actionView ? undefined : "1px solid var(--line-2, rgba(255,255,255,0.08))", paddingTop: actionView ? 0 : 12, marginTop: actionView ? 0 : 4 }}>
      {!actionView ? <div className="fm-sec" style={{ margin: 0 }}>Retrieve from another workspace (session)</div> : null}
      <div className="fm-note">
        <BIcon name="shield" size={15} />
        <span>
          Reads a Slack workspace using <strong>your own signed-in session</strong> — for workspaces where the official app isn’t installed. This is an unofficial method (against Slack’s API terms) and is your responsibility; use it only for content you’re allowed to access.
        </span>
      </div>

      {connected ? (
        <div className="fm-note" style={{ color: "var(--ok, #6fcdba)" }}>
          <BIcon name="check" size={15} />
          <span>
            {`Session connected${session?.team ? ` — ${session.team}` : ""}${session?.user ? ` (as ${session.user})` : ""}.`}
          </span>
        </div>
      ) : null}

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I understand this uses my own Slack session and accept responsibility for using it.</span>
      </label>

      <BBtn
        variant="primary"
        onClick={() => void startCapture()}
        disabled={!consent || Boolean(busy)}
        style={{ justifySelf: "start", padding: "11px 18px", fontSize: 13.5 }}
      >
        {busy === "capture" ? <span className="ni-spin" /> : <BIcon name="key" size={15} />}
        {connected ? "Re-connect a workspace session" : "Open Slack workspace sign-in"}
      </BBtn>

      {connected ? (
        <div style={{ display: "grid", gap: 8 }}>
          {channelsLoading ? (
            <div role="status" aria-label="Loading Slack channels" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-3)", fontSize: 12 }}>
              <span className="ni-spin" /> Loading channels…
            </div>
          ) : (
            <label className="fb-label">Channel
              <select
                className="fb-select fb-mono"
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value);
                  setRetrievalProgress(null);
                }}
                disabled={!channels.length}
              >
                <option value="">{channels.length ? "Choose a channel…" : "No visible channels found"}</option>
                {channels.map((option) => (
                  <option key={option.id} value={`#${option.name}`}>
                    #{option.name}{option.isPrivate ? " — private" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {channelsError ? <p className="ni-note">{channelsError}</p> : null}
          <div className="fb-label">
            <span>Download depth</span>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "var(--fg-2)", fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={deepDownload}
                onChange={(event) => setDeepDownload(event.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong style={{ display: "block", color: "var(--fg)" }}>Deep download linked pages</strong>
                Follow public links up to two page levels, save readable pages and Notion notes as Markdown, and download their linked files.
              </span>
            </label>
          </div>
          <div className="fb-label">
            <span>Ignore file types</span>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "var(--fg-2)", fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={ignoreImages}
                onChange={(event) => setIgnoreImages(event.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong style={{ display: "block", color: "var(--fg)" }}>Ignore images</strong>
                Don’t download image attachments. Their metadata remains in messages.json.
              </span>
            </label>
          </div>
          <BBtn
            onClick={() => void retrieve()}
            disabled={!channel.trim() || Boolean(busy)}
            style={{ justifySelf: "start", padding: "9px 16px", fontSize: 13 }}
          >
            {busy === "retrieve" ? <span className="ni-spin" /> : <BIcon name="download" size={14} />} Download channel
          </BBtn>
          {retrievalProgress ? <SlackRetrievalProgress progress={retrievalProgress} /> : null}
        </div>
      ) : null}

      {note ? <p className="ni-note">{note}</p> : null}
    </div>
  );
}

function SlackRetrievalProgress({ progress }: { progress: LongRunningProcessProgress }) {
  const determinate = typeof progress.total === "number" && progress.total > 0;
  const completed = determinate
    ? Math.max(0, Math.min(progress.total as number, progress.completed ?? 0))
    : 0;
  const percent = determinate ? Math.round((completed / (progress.total as number)) * 100) : 0;
  const countLabel = determinate ? `${completed}/${progress.total}` : progress.completed ? `${progress.completed} found` : "Working";

  return (
    <div className="ni-process-progress" role="status" aria-label={progress.label}>
      <div className="ni-process-progress-head">
        <strong>{progress.label}</strong>
        <span>{countLabel}</span>
      </div>
      <div
        className="ni-process-progress-track"
        role="progressbar"
        aria-label={progress.label}
        aria-valuemin={determinate ? 0 : undefined}
        aria-valuemax={determinate ? progress.total : undefined}
        aria-valuenow={determinate ? completed : undefined}
        aria-valuetext={determinate ? `${percent}%` : "In progress"}
        data-indeterminate={determinate ? undefined : ""}
      >
        <span style={determinate ? { width: `${percent}%` } : undefined} />
      </div>
      {progress.detail ? <p>{progress.detail}</p> : null}
    </div>
  );
}
