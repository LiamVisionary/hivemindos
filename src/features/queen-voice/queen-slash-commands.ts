// General slash-command dispatch for the app-wide "Ask the hive" pill.
//
// The pill advertises the whole slash-command menu (CHAT_SLASH_COMMANDS) but,
// before this, forwarded every "/command" straight to the Queen, who answered
// it as conversation ("I can't fetch that directly"). This is the one place the
// pill recognizes the ENTIRE namespace and acts on it deterministically:
//   • /transcript <x-link>        → pull the transcript (the x-transcript route)
//   • dashboard commands          → translated to intent + driven via Bee Pilot
//     (/work, /brain, /doctor, /note, /swarm, /image-gen, …)
//   • /clear · /new · /reset      → clear the conversation
//   • /help                       → what the pill can do
//   • other Hermes/CLI commands   → honest "runs in the Chat view / CLI"
//   • unknown /xyz                → honest "no such command"
// Anything that is NOT a slash command returns { kind: "none" } so the caller
// runs the normal Queen turn.

import { CHAT_SLASH_COMMANDS } from "@/features/chat/hermes-slash-commands";
import { resolveDashboardSlashCommand, type DashboardSlashCommandAction } from "@/features/chat/dashboard-slash-commands";
import { transcriptCommandUrl } from "@/features/dashboard/hooks/status-chat-transcript";
import { pollXTranscriptJob, startXTranscriptJobRequest } from "@/lib/services/x-transcript/x-transcript-client";
import { looksLikeXPost } from "@/lib/services/x-transcript/x-url";
import type { XTranscriptInspection } from "@/lib/services/x-transcript/x-transcript-service";
import type { QueenChatTurn } from "./queen-chat-store";

const CLEAR_ALIASES = new Set(["clear", "new", "reset"]);

export type QueenSlashRoute =
  | { kind: "none" }
  | { kind: "transcript"; display: string; url: string }
  | { kind: "clear" }
  | { kind: "help"; display: string }
  | { kind: "dashboard"; display: string; command: DashboardSlashCommandAction; intent: string }
  | { kind: "cli"; display: string; name: string; description: string }
  | { kind: "unknown"; display: string; name: string };

/** A leading "/word" is a command; a bare "/" or "/ foo" (path-ish) is not. */
function slashCommandName(input: string): string | null {
  const match = input.trim().match(/^\/([a-zA-Z][\w-]*)(?:\s|$)/);
  return match ? match[1].toLowerCase() : null;
}

function argsAfterCommand(input: string): string {
  return input.trim().replace(/^\/[a-zA-Z][\w-]*\s*/, "").trim();
}

/** Natural-language intent for Bee Pilot from a dashboard command + its args. */
function dashboardIntent(command: DashboardSlashCommandAction, args: string): string {
  const base = command.description.trim().replace(/\.$/, "");
  return args ? `${base}: ${args}` : base;
}

/** Pure classification — no side effects, so the routing is unit-testable. */
export function classifyQueenSlashCommand(input: string): QueenSlashRoute {
  const trimmed = input.trim();
  const name = slashCommandName(trimmed);
  if (!name) return { kind: "none" };

  const transcriptArg = transcriptCommandUrl(trimmed);
  if (transcriptArg !== null) return { kind: "transcript", display: trimmed, url: transcriptArg };

  if (CLEAR_ALIASES.has(name)) return { kind: "clear" };
  if (name === "help") return { kind: "help", display: trimmed };

  const command = resolveDashboardSlashCommand(trimmed);
  if (command) {
    return { kind: "dashboard", display: trimmed, command, intent: dashboardIntent(command, argsAfterCommand(trimmed)) };
  }

  const known = CHAT_SLASH_COMMANDS.find((entry) => (
    entry.name.toLowerCase() === name || entry.aliases?.some((alias) => alias.toLowerCase() === name)
  ));
  if (known) return { kind: "cli", display: trimmed, name, description: known.description };

  return { kind: "unknown", display: trimmed, name };
}

const HELP_TEXT = [
  "From here I can run:",
  "- `/transcript <x-link>` — pull the transcript of an X video or thread",
  "- dashboard commands like `/work`, `/brain`, `/doctor`, `/alerts`, `/note`, `/swarm` — I open the view and do it",
  "- `/clear` — start a fresh conversation",
  "",
  "Model, goal, and session commands (`/model`, `/goal`, `/new`…) run in the Chat view or the CLI. Or just talk to me without a slash.",
].join("\n");

export type QueenSlashAdapter = {
  appendTurn: (turn: Omit<QueenChatTurn, "id"> & { id?: string }) => string;
  updateTurn: (id: string, patch: Partial<QueenChatTurn>) => void;
  clear: () => void;
  /** Bee Pilot drive (the pill's dashboard-driving capability); absent = decline nav. */
  drive?: (command: string) => Promise<string>;
};

const LONG_TRANSCRIPT_SECONDS = 5 * 60;

function transcriptExpectation(inspection: XTranscriptInspection | null): string {
  if (inspection?.kind !== "video") return "Okay, I’m on it.";
  if (!inspection.durationSec || inspection.durationSec <= 0) {
    return "Okay, I’m on it — this is a video, so transcription may take a few minutes.";
  }
  const minutes = Math.max(1, Math.round(inspection.durationSec / 60));
  const unit = minutes === 1 ? "minute" : "minutes";
  if (inspection.durationSec >= LONG_TRANSCRIPT_SECONDS) {
    return `Okay, I’m on it — this video is ${minutes} ${unit}, so transcription may take a few minutes.`;
  }
  return `Okay, I’m on it — this video is ${minutes} ${unit}, so it should be ready shortly.`;
}

async function runTranscript(display: string, url: string, adapter: QueenSlashAdapter) {
  adapter.appendTurn({ who: "you", text: display, source: "text" });
  if (!url || !looksLikeXPost(url)) {
    adapter.appendTurn({
      who: "queen",
      text: "Add an X link after `/transcript`, for example `/transcript https://x.com/user/status/1780000000000000001`.",
      source: "text",
    });
    return;
  }
  const queenId = adapter.appendTurn({ who: "queen", text: "", live: true, pending: true, working: "Checking the video…", source: "text" });
  try {
    const started = await startXTranscriptJobRequest(url);
    adapter.updateTurn(queenId, {
      text: transcriptExpectation(started.inspection),
      live: true,
      pending: true,
      working: "Transcribing…",
    });
    const result = await pollXTranscriptJob(started.jobId);
    const meta = [
      result.author?.handle ? `@${result.author.handle}` : result.kind === "thread" ? "thread" : "post",
      result.durationSec ? `${Math.round(result.durationSec / 60)} min video` : typeof result.postCount === "number" && result.postCount > 1 ? `${result.postCount}-post thread` : "",
    ].filter(Boolean).join(" · ");
    const spoken = [result.summary, result.followUpQuestion].filter(Boolean).join("\n\n") || `Transcript ready${meta ? ` (${meta})` : ""}.`;
    adapter.updateTurn(queenId, { text: spoken, detail: `**Transcript${meta ? ` — ${meta}` : ""}**\n\n${result.transcript}`, live: false, pending: false, working: undefined });
  } catch (error) {
    adapter.updateTurn(queenId, { text: `I couldn't pull that transcript: ${error instanceof Error ? error.message : String(error)}`, live: false, pending: false, working: undefined });
  }
}

async function runDashboard(route: Extract<QueenSlashRoute, { kind: "dashboard" }>, adapter: QueenSlashAdapter) {
  adapter.appendTurn({ who: "you", text: route.display, source: "text" });
  const working = route.command.reply.replace(/\.$/, "");
  const queenId = adapter.appendTurn({ who: "queen", text: "", live: true, pending: true, working: `${working}…`, source: "text" });
  if (!adapter.drive) {
    adapter.updateTurn(queenId, { text: route.command.reply, live: false, pending: false, working: undefined });
    return;
  }
  try {
    const reply = (await adapter.drive(route.intent)).trim();
    adapter.updateTurn(queenId, { text: reply || route.command.reply, live: false, pending: false, working: undefined });
  } catch {
    adapter.updateTurn(queenId, { text: route.command.reply, live: false, pending: false, working: undefined });
  }
}

/** Handle a slash command from the pill. Returns true when handled (caller returns early). */
export async function dispatchQueenSlashCommand(input: string, adapter: QueenSlashAdapter): Promise<boolean> {
  const route = classifyQueenSlashCommand(input);
  switch (route.kind) {
    case "none":
      return false;
    case "transcript":
      await runTranscript(route.display, route.url, adapter);
      return true;
    case "clear":
      adapter.clear();
      return true;
    case "help":
      adapter.appendTurn({ who: "you", text: route.display, source: "text" });
      adapter.appendTurn({ who: "queen", text: HELP_TEXT, source: "text" });
      return true;
    case "dashboard":
      await runDashboard(route, adapter);
      return true;
    case "cli":
      adapter.appendTurn({ who: "you", text: route.display, source: "text" });
      adapter.appendTurn({
        who: "queen",
        text: `\`/${route.name}\` — ${route.description}. That one runs in the Chat view or the CLI; from here I can run \`/transcript\`, the dashboard commands (\`/work\`, \`/brain\`, \`/doctor\`…), and chat. Type \`/help\` to see.`,
        source: "text",
      });
      return true;
    case "unknown":
      adapter.appendTurn({ who: "you", text: route.display, source: "text" });
      adapter.appendTurn({
        who: "queen",
        text: `I don't have a \`/${route.name}\` command. Type without the slash to ask the hive, or \`/help\` to see what I can do.`,
        source: "text",
      });
      return true;
  }
}
