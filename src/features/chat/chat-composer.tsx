import { ArrowUp, Check, ChevronDown, Clock3, Cpu, FileText, FileUp, FolderOpen, Mic, Minus, Paperclip, Plus, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";

import chatStyles from "@/app/chat.module.css";
import kanbanStyles from "@/app/kanban-board.module.css";
import { LottiePlayer } from "@/components/ui/lottie-player";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { attachmentSizeLabel, linkedDirectoryLabel } from "@/features/chat/chat-formatters";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { KanbanLinkedDirectory, KanbanTaskAttachment } from "@/lib/types/kanban";
import type { RecentDirectory } from "@/lib/types/recent-directories";

export { attachmentSizeLabel, linkedDirectoryLabel } from "@/features/chat/chat-formatters";

const chatClass = createStyleClass(chatStyles);
const kanbanClass = createStyleClass(kanbanStyles);

type HermesSlashCommand = {
  name: string;
  category: string;
  description: string;
  argsHint?: string;
  aliases?: string[];
  cliOnly?: boolean;
  gatewayOnly?: boolean;
};

export type ComposerModelPicker = {
  /** Short label for the current model, shown on the button (e.g. "gpt-4o"). */
  label: string;
  /** Slug of the currently active provider, used to mark the active model. */
  provider?: string;
  /** Id of the currently active model, used to mark the active model. */
  model?: string;
  providers: Array<{
    slug: string;
    name: string;
    models: Array<{ id: string; name?: string }>;
  }>;
  loading?: boolean;
  emptyHint?: string;
  onSelect: (provider: string, model: string) => void;
  /** Called when the menu opens, so the caller can lazily load the model list. */
  onOpen?: () => void;
  onRefresh?: () => void;
};

export const HERMES_SLASH_COMMANDS: HermesSlashCommand[] = [
  { name: "new", category: "Session", description: "Start a fresh session", argsHint: "[name]", aliases: ["reset"] },
  { name: "topic", category: "Session", description: "Enable or inspect Telegram DM topic sessions", argsHint: "[off|help|session-id]", gatewayOnly: true },
  { name: "clear", category: "Session", description: "Clear screen and start a new session", cliOnly: true },
  { name: "redraw", category: "Session", description: "Force a full UI repaint", cliOnly: true },
  { name: "history", category: "Session", description: "Show conversation history", cliOnly: true },
  { name: "save", category: "Session", description: "Save the current conversation", cliOnly: true },
  { name: "retry", category: "Session", description: "Retry the last message" },
  { name: "undo", category: "Session", description: "Remove the last user/assistant exchange" },
  { name: "title", category: "Session", description: "Set a title for the current session", argsHint: "[name]" },
  { name: "handoff", category: "Session", description: "Hand off this session to a messaging platform", argsHint: "<platform>", cliOnly: true },
  { name: "branch", category: "Session", description: "Branch the current session", argsHint: "[name]", aliases: ["fork"] },
  { name: "compress", category: "Session", description: "Manually compress conversation context", argsHint: "[focus topic]" },
  { name: "rollback", category: "Session", description: "List or restore filesystem checkpoints", argsHint: "[number]" },
  { name: "snapshot", category: "Session", description: "Create or restore Hermes config/state snapshots", argsHint: "[create|restore <id>|prune]", aliases: ["snap"], cliOnly: true },
  { name: "stop", category: "Session", description: "Kill running background processes" },
  { name: "approve", category: "Session", description: "Approve a pending dangerous command", argsHint: "[session|always]", gatewayOnly: true },
  { name: "deny", category: "Session", description: "Deny a pending dangerous command", gatewayOnly: true },
  { name: "background", category: "Session", description: "Run a prompt in the background", argsHint: "<prompt>", aliases: ["bg", "btw"] },
  { name: "agents", category: "Session", description: "Show active agents and running tasks", aliases: ["tasks"] },
  { name: "queue", category: "Session", description: "Queue a prompt for the next turn", argsHint: "<prompt>", aliases: ["q"] },
  { name: "steer", category: "Session", description: "Inject a note after the next tool call", argsHint: "<prompt>" },
  { name: "goal", category: "Session", description: "Set or manage a persistent goal", argsHint: "[text|pause|resume|clear|status]" },
  { name: "subgoal", category: "Session", description: "Add or manage criteria on the active goal", argsHint: "[text|remove N|clear]" },
  { name: "status", category: "Session", description: "Show session info" },
  { name: "whoami", category: "Info", description: "Show slash command access" },
  { name: "profile", category: "Info", description: "Show active profile and home directory" },
  { name: "sethome", category: "Session", description: "Set this chat as the home channel", aliases: ["set-home"], gatewayOnly: true },
  { name: "resume", category: "Session", description: "Resume a named session", argsHint: "[name]" },
  { name: "sessions", category: "Session", description: "Browse and resume previous sessions" },
  { name: "config", category: "Configuration", description: "Show current configuration", cliOnly: true },
  { name: "model", category: "Configuration", description: "Switch model for this session", argsHint: "[model] [--provider name] [--global]", aliases: ["provider"] },
  { name: "codex-runtime", category: "Configuration", description: "Toggle Codex app-server runtime", argsHint: "[auto|codex_app_server]", aliases: ["codex_runtime"] },
  { name: "gquota", category: "Info", description: "Show Google Gemini Code Assist quota usage", cliOnly: true },
  { name: "personality", category: "Configuration", description: "Set a predefined personality", argsHint: "[name]" },
  { name: "statusbar", category: "Configuration", description: "Toggle the context/model status bar", aliases: ["sb"], cliOnly: true },
  { name: "verbose", category: "Configuration", description: "Cycle tool progress display", cliOnly: true },
  { name: "footer", category: "Configuration", description: "Toggle gateway runtime metadata footer", argsHint: "[on|off|status]" },
  { name: "yolo", category: "Configuration", description: "Toggle approval-free YOLO mode" },
  { name: "reasoning", category: "Configuration", description: "Manage reasoning effort and display", argsHint: "[level|show|hide]" },
  { name: "fast", category: "Configuration", description: "Toggle provider fast mode", argsHint: "[normal|fast|status]" },
  { name: "skin", category: "Configuration", description: "Show or change the display skin/theme", argsHint: "[name]", cliOnly: true },
  { name: "indicator", category: "Configuration", description: "Pick the TUI busy indicator style", argsHint: "[kaomoji|emoji|unicode|ascii]", cliOnly: true },
  { name: "voice", category: "Configuration", description: "Toggle voice mode", argsHint: "[on|off|tts|status]" },
  { name: "busy", category: "Configuration", description: "Control Enter behavior while Hermes is working", argsHint: "[queue|steer|interrupt|status]", cliOnly: true },
  { name: "tools", category: "Tools & Skills", description: "Manage tools", argsHint: "[list|disable|enable] [name...]", cliOnly: true },
  { name: "toolsets", category: "Tools & Skills", description: "List available toolsets", cliOnly: true },
  { name: "skills", category: "Tools & Skills", description: "Search, install, inspect, or manage skills", cliOnly: true },
  { name: "bundles", category: "Tools & Skills", description: "List skill bundles and aliases" },
  { name: "cron", category: "Tools & Skills", description: "Manage scheduled tasks", argsHint: "[subcommand]", cliOnly: true },
  { name: "curator", category: "Tools & Skills", description: "Background skill maintenance", argsHint: "[status|run|pin|archive]" },
  { name: "kanban", category: "Tools & Skills", description: "Use the collaboration board", argsHint: "[subcommand]" },
  { name: "reload", category: "Tools & Skills", description: "Reload env variables", cliOnly: true },
  { name: "reload-mcp", category: "Tools & Skills", description: "Reload MCP servers from config", aliases: ["reload_mcp"] },
  { name: "reload-skills", category: "Tools & Skills", description: "Re-scan installed skills", aliases: ["reload_skills"] },
  { name: "browser", category: "Tools & Skills", description: "Connect browser tools through CDP", argsHint: "[connect|disconnect|status]", cliOnly: true },
  { name: "plugins", category: "Tools & Skills", description: "List installed plugins and status", cliOnly: true },
  { name: "commands", category: "Info", description: "Browse all commands and skills", argsHint: "[page]", gatewayOnly: true },
  { name: "help", category: "Info", description: "Show available commands" },
  { name: "restart", category: "Session", description: "Gracefully restart the gateway", gatewayOnly: true },
  { name: "usage", category: "Info", description: "Show token usage and rate limits" },
  { name: "insights", category: "Info", description: "Show usage analytics", argsHint: "[days]" },
  { name: "platforms", category: "Info", description: "Show gateway platform status", aliases: ["gateway"], cliOnly: true },
  { name: "platform", category: "Info", description: "Pause, resume, or list a gateway platform", argsHint: "<pause|resume|list> [name]", gatewayOnly: true },
  { name: "copy", category: "Info", description: "Copy the last assistant response", argsHint: "[number]", cliOnly: true },
  { name: "paste", category: "Info", description: "Attach a clipboard image", cliOnly: true },
  { name: "image", category: "Info", description: "Attach a local image file", argsHint: "<path>", cliOnly: true },
  { name: "update", category: "Info", description: "Update Hermes Agent" },
  { name: "debug", category: "Info", description: "Upload a debug report" },
  { name: "quit", category: "Exit", description: "Exit the CLI", argsHint: "[--delete]", aliases: ["exit"], cliOnly: true },
  { name: "<skill-name>", category: "Dynamic", description: "Invoke any installed Hermes skill by name" },
];

const RESPONSE_LOADING_PHRASES = [
  "thinking",
  "cooking",
  "making magic",
  "connecting the pieces",
  "mapping the honeycomb",
  "scouting the next move",
  "warming up the tools",
];

function shouldKeepEnterAsNewline() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

type ChatAttachment = KanbanTaskAttachment;
type LinkedDirectory = KanbanLinkedDirectory;
type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

type ChatMessage = { role?: string; content: string; attachments?: ChatAttachment[] };
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
};

export type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

export type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function cleanActivityTitle(title: string) {
  const cleaned = title
    .replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[,.\d]*\s*/u, "")
    .replace(/^INFO\s+/i, "")
    .replace(/^Loaded main app package\s+/i, "Opened ")
    .trim();
  // Hide raw JSON / log payloads from primary surfaces (philosophy rule 6).
  // If the title looks like structured data, return a generic plain-English
  // fallback instead of leaking `{` or `[` into the UI.
  if (/^[\[{]/.test(cleaned) || cleaned.length <= 1) return "Background activity";
  return cleaned;
}

export function stripAnsiSequences(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function stripHermesBoxLine(line: string) {
  let next = line;
  if (/^\s*[│┃]/.test(next)) next = next.replace(/^\s*[│┃]\s?/, "");
  if (/[│┃]\s*$/.test(next)) next = next.replace(/\s*[│┃]\s*$/, "");
  return next.replace(/\s+$/g, "");
}

export function isHermesFrameLine(line: string) {
  const trimmed = line.trim();
  return /^[╭╰╮╯─━\s]+$/.test(trimmed) || /^[─━]{6,}$/.test(trimmed);
}

export function isHermesInventoryText(text: string) {
  return /Available Tools/i.test(text)
    && /Available Skills/i.test(text)
    && /MCP Servers/i.test(text)
    && !/╭.*Hermes/i.test(text);
}

export function looksLikeAssistantHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed || /^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) return false;
  if (/[.!?;:]$/.test(trimmed)) return false;
  if (/[,/]/.test(trimmed)) return false;
  if (trimmed.length > 58) return false;
  if (trimmed.split(/\s+/).length > 7) return false;
  return /^[A-Z][A-Za-z0-9’'() -]+$/.test(trimmed);
}

export function shouldPromotePlainLineToBullet(line: string) {
  const trimmed = line.trim();
  if (!trimmed || /^#{1,3}\s+/.test(trimmed) || /^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) return false;
  if (looksLikeAssistantHeading(trimmed)) return false;
  if (trimmed.length > 120) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  return true;
}

function plainBulletRunLength(lines: string[], startIndex: number) {
  let count = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!shouldPromotePlainLineToBullet(trimmed)) break;
    count += 1;
  }
  return count;
}

export function structureAssistantPlainText(lines: string[]) {
  const output: string[] = [];
  const headingPattern = /^(Summary|Main idea|Key features|Why it matters|Takeaway|Result|Details|Next steps|Practical answer|Where .+ wins|The nuance|Bottom line|Exo vs\..+|.+\s+vs\.\s+.+)$/i;
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      output.push(line);
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      output.push(line);
      continue;
    }
    if (!trimmed) {
      output.push("");
      continue;
    }
    if (/^#{1,3}\s+/.test(trimmed) || /^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      output.push(line);
      continue;
    }
    const previous = output.at(-1)?.trim() ?? "";
    const next = lines[index + 1]?.trim() ?? "";
    const afterColonList = previous.endsWith(":") && plainBulletRunLength(lines, index) >= 2;
    const continuingList = /^[-*]\s+/.test(previous) && shouldPromotePlainLineToBullet(trimmed) && !looksLikeAssistantHeading(next);
    if (afterColonList || continuingList) {
      output.push(`- ${trimmed}`);
      continue;
    }
    if (headingPattern.test(trimmed) || (looksLikeAssistantHeading(trimmed) && next && !previous.endsWith(":"))) {
      output.push(`### ${trimmed}`);
      continue;
    }
    output.push(line);
  }
  return output;
}

export function normalizeAssistantChatText(value: string) {
  const text = stripAnsiSequences(value || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  if (isHermesInventoryText(text)) return "";
  const lines = text.split("\n");
  let hermesBoxIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/╭.*Hermes.*[╮]/i.test(lines[index])) {
      hermesBoxIndex = index;
      break;
    }
  }
  const relevant = hermesBoxIndex >= 0 ? lines.slice(hermesBoxIndex) : lines;
  const cleaned: string[] = [];
  let skippingFooter = false;

  for (const rawLine of relevant) {
    const line = stripHermesBoxLine(rawLine);
    const trimmed = line.trim();
    if (/^Resume this session with:/i.test(trimmed) || /^Session:\s+/i.test(trimmed)) {
      skippingFooter = true;
    }
    if (skippingFooter) continue;
    if (!trimmed) {
      if (cleaned.at(-1) !== "") cleaned.push("");
      continue;
    }
    if (isHermesFrameLine(trimmed)) continue;
    if (/^(Query:|Initializing agent|↻ Resumed session|\(\d+\s+user message|hermes --resume|hermes -c\b)/i.test(trimmed)) continue;
    if (/^╭.*╮$/.test(trimmed) || /^╰.*╯$/.test(trimmed)) continue;
    cleaned.push(trimmed);
  }

  return structureAssistantPlainText(cleaned
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n"))
    .join("\n")
    .trim();
}

export function restoreRedactedLocalhostPreviewUrls(value: string) {
  return value.replace(
    /http:\/\/\s*\[\s*REDACTED[_\s-]*IP\s*\]\s*:(\d{2,5})(?=[/\s`'")\]}]|$)/gi,
    "http://localhost:$1",
  );
}

export function chatDisplayContent(message: ChatMessage) {
  return message.role === "assistant" ? restoreRedactedLocalhostPreviewUrls(normalizeAssistantChatText(message.content)) : message.content;
}

export function attachmentSummary(attachments: ChatAttachment[]) {
  if (attachments.length === 0) return "";
  const images = attachments.filter((attachment) => attachment.kind === "image").length;
  const audio = attachments.filter((attachment) => attachment.kind === "audio").length;
  const files = attachments.filter((attachment) => attachment.kind === "file").length;
  return [
    images ? `${images} image${images === 1 ? "" : "s"}` : "",
    audio ? `${audio} audio clip${audio === 1 ? "" : "s"}` : "",
    files ? `${files} file${files === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");
}

export function messageContentParts(text: string, attachments: ChatAttachment[]): string | ChatContentPart[] {
  if (attachments.length === 0) return text;
  const parts: ChatContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text: text.trim() });
  attachments.forEach((attachment) => {
    if (attachment.kind === "image") {
      parts.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
      return;
    }
    if (attachment.kind === "file") {
      parts.push({
        type: "file",
        file: {
          filename: attachment.name,
          file_data: attachment.dataUrl,
        },
      });
      return;
    }
    parts.push({
      type: "file",
      file: {
        filename: attachment.name,
        file_data: attachment.dataUrl,
      },
    });
  });
  return parts;
}

export function readAttachmentFile(file: File, kind: "image" | "file"): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error(`Could not read ${file.name}`));
        return;
      }
      resolve({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        kind,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataUrl,
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function readComposerFiles(files: FileList | File[], kind: "image" | "file") {
  const incoming = Array.from(files);
  if (incoming.length === 0) throw new Error("Choose at least one file.");
  const maxAttachmentBytes = 8_000_000;
  const oversized = incoming.find((file) => file.size > maxAttachmentBytes);
  if (oversized) throw new Error(`${oversized.name} is too large. Keep attachments under 8 MB.`);
  return Promise.all(incoming.map((file) => readAttachmentFile(file, kind)));
}

export function AgentResponseLoader() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const phrase = RESPONSE_LOADING_PHRASES[phraseIndex] ?? RESPONSE_LOADING_PHRASES[0];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhraseIndex((index) => (index + 1) % RESPONSE_LOADING_PHRASES.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={chatClass("responseLoader")} role="status" aria-live="polite" aria-label={`${phrase}...`}>
      <LottiePlayer src="/animations/Honey%20bee.lottie" size={30} ariaLabel="Worker bee thinking" />
      <span className={chatClass("responseLoaderText")}>
        {Array.from(phrase).map((letter, index) => (
          <span
            aria-hidden="true"
            className={chatClass("responseLoaderLetter")}
            key={`${phrase}-${index}`}
            style={{ animationDelay: `${index * 55}ms` }}
          >
            {letter === " " ? "\u00A0" : letter}
          </span>
        ))}
        <span aria-hidden="true" className={chatClass("responseLoaderDots")}>
          <span />
          <span />
          <span />
        </span>
      </span>
    </div>
  );
}

export async function pickLinkedDirectory(): Promise<LinkedDirectory | null> {
  type DirectoryPickerWindow = Window & typeof globalThis & {
    showDirectoryPicker?: () => Promise<{ name?: string }>;
  };
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error("Directory picker is not available in this browser.");
  try {
    const handle = await picker();
    const name = handle.name?.trim();
    return name ? { id: `${name}-${crypto.randomUUID()}`, name, lastUsedAt: Date.now() } : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export function recentDirectoryToLinkedDirectory(directory: RecentDirectory): LinkedDirectory {
  return {
    id: `${directory.name}-${directory.lastUsedAt}-${crypto.randomUUID()}`,
    name: directory.name,
    path: directory.path,
    machineName: directory.machineName,
    machineKey: directory.machineKey,
    lastUsedAt: Date.now(),
  };
}

export function recentDirectorySubtitle(directory: RecentDirectory) {
  if (directory.path?.trim()) return directory.machineName?.trim()
    ? `${directory.path.trim()} on ${directory.machineName.trim()}`
    : directory.path.trim();
  if (directory.machineName?.trim()) return directory.machineName.trim();
  if (directory.source === "kanban") return "Kanban history";
  if (directory.source === "chat") return "Chat history";
  return "No path saved yet";
}

export function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function AttachmentMenuContent({
  placement = "above",
  onAttachImages,
  onAttachFiles,
  onAttachDirectory,
  directoryPickerDisabled = false,
  directoryPickerDisabledReason,
  recentDirectories = [],
  recentDirectoriesExpanded,
  setRecentDirectoriesExpanded,
  onAttachRecentDirectory,
  stopPropagation = false,
}: {
  placement?: "above" | "below";
  onAttachImages: () => void;
  onAttachFiles: () => void;
  onAttachDirectory?: () => void;
  directoryPickerDisabled?: boolean;
  directoryPickerDisabledReason?: string;
  recentDirectories?: RecentDirectory[];
  recentDirectoriesExpanded?: boolean;
  setRecentDirectoriesExpanded?: (open: boolean | ((current: boolean) => boolean)) => void;
  onAttachRecentDirectory?: (directory: LinkedDirectory) => void;
  stopPropagation?: boolean;
}) {
  const run = (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
    if (stopPropagation) event.stopPropagation();
    action();
  };
  return (
    <div className={chatClass("attachmentMenu", placement === "below" && "attachmentMenuBelow")} role="menu">
      <button type="button" role="menuitem" onClick={(event) => run(event, onAttachImages)}>
        <Paperclip aria-hidden="true" />
        Images
      </button>
      <button type="button" role="menuitem" onClick={(event) => run(event, onAttachFiles)}>
        <FileUp aria-hidden="true" />
        Files
      </button>
      {onAttachDirectory ? (
        <button
          type="button"
          role="menuitem"
          onClick={(event) => run(event, onAttachDirectory)}
          disabled={directoryPickerDisabled}
          title={directoryPickerDisabledReason}
        >
          <FolderOpen aria-hidden="true" />
          Directories
        </button>
      ) : null}
      {onAttachRecentDirectory && setRecentDirectoriesExpanded ? (
        <div className={chatClass("attachmentRecents")}>
          <button
            type="button"
            role="menuitem"
            aria-expanded={Boolean(recentDirectoriesExpanded)}
            disabled={directoryPickerDisabled}
            title={directoryPickerDisabledReason}
            onClick={(event) => run(event, () => setRecentDirectoriesExpanded((open) => !open))}
          >
            <Clock3 aria-hidden="true" />
            Recents
            <ChevronDown aria-hidden="true" />
          </button>
          {recentDirectoriesExpanded ? (
            <div className={chatClass("attachmentRecentList")}>
              {recentDirectories.length > 0 ? recentDirectories.slice(0, 8).map((directory) => (
                <button
                  type="button"
                  role="menuitem"
                  key={directory.id}
                  disabled={directoryPickerDisabled}
                  onClick={(event) => run(event, () => onAttachRecentDirectory(recentDirectoryToLinkedDirectory(directory)))}
                >
                  <FolderOpen aria-hidden="true" />
                  <span>
                    <strong>{directory.name}</strong>
                    <small>{recentDirectorySubtitle(directory)}</small>
                  </span>
                </button>
              )) : (
                <p>No recent folders yet.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AttachmentListMenuContent({
  attachments,
  directories,
  onRemoveAttachment,
  onRemoveDirectory,
}: {
  attachments: KanbanTaskAttachment[];
  directories: LinkedDirectory[];
  onRemoveAttachment: (id: string) => void;
  onRemoveDirectory: (id: string) => void;
}) {
  const hasItems = attachments.length > 0 || directories.length > 0;
  return (
    <div className={kanbanClass("kanbanAttachmentListMenu")} role="menu">
      {hasItems ? (
        <>
          {directories.map((directory) => (
            <div className={kanbanClass("kanbanAttachmentListItem")} key={directory.id}>
              <FolderOpen aria-hidden="true" />
              <span>
                <strong>{directory.name}</strong>
                <small>{linkedDirectoryLabel(directory)}</small>
              </span>
              <button
                type="button"
                aria-label={`Remove ${directory.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveDirectory(directory.id);
                }}
              >
                <Minus aria-hidden="true" />
              </button>
            </div>
          ))}
          {attachments.map((attachment) => (
            <div className={kanbanClass("kanbanAttachmentListItem")} key={attachment.id}>
              <Paperclip aria-hidden="true" />
              <span>
                <strong>{attachment.name}</strong>
                <small>{attachment.kind === "image" ? "Image" : "File"} · {attachmentSizeLabel(attachment.size)}</small>
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveAttachment(attachment.id);
                }}
              >
                <Minus aria-hidden="true" />
              </button>
            </div>
          ))}
        </>
      ) : (
        <p>No attachments yet.</p>
      )}
    </div>
  );
}

export function ComposerField({
  value,
  onChange,
  placeholder,
  disabled,
  busy,
  compact = false,
  attachments,
  directories = [],
  attachmentError,
  attachmentMenuOpen,
  setAttachmentMenuOpen,
  attachmentMenuRef,
  fileInputRef,
  imageInputRef,
  onFileChange,
  onImageChange,
  onRemoveAttachment,
  onAttachDirectory,
  directoryPickerDisabled = false,
  directoryPickerDisabledReason,
  recentDirectories = [],
  recentDirectoriesExpanded,
  setRecentDirectoriesExpanded,
  onAttachRecentDirectory,
  onRemoveDirectory,
  workingDirectoryLabel,
  onChangeWorkingDirectory,
  recording,
  voiceBands,
  voiceTranscript,
  onToggleRecording,
  canRecord = true,
  canSend,
  onCancel,
  submitOnEnter = false,
  hermesSlashCommands = false,
  agentMode,
  onAgentModeChange,
  modelPicker,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  attachments: ChatAttachment[];
  directories?: LinkedDirectory[];
  attachmentError?: string;
  attachmentMenuOpen: boolean;
  setAttachmentMenuOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  attachmentMenuRef: RefObject<HTMLDivElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveAttachment: (id: string) => void;
  onAttachDirectory?: () => void;
  directoryPickerDisabled?: boolean;
  directoryPickerDisabledReason?: string;
  recentDirectories?: RecentDirectory[];
  recentDirectoriesExpanded?: boolean;
  setRecentDirectoriesExpanded?: (open: boolean | ((current: boolean) => boolean)) => void;
  onAttachRecentDirectory?: (directory: LinkedDirectory) => void;
  onRemoveDirectory?: (id: string) => void;
  workingDirectoryLabel?: string;
  onChangeWorkingDirectory?: () => void | Promise<void>;
  recording?: boolean;
  voiceBands: number[];
  voiceTranscript?: string;
  onToggleRecording?: () => void;
  canRecord?: boolean;
  canSend: boolean;
  onCancel?: () => void;
  submitOnEnter?: boolean;
  hermesSlashCommands?: boolean;
  agentMode?: "plan" | "act";
  onAgentModeChange?: (mode: "plan" | "act") => void;
  modelPicker?: ComposerModelPicker;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectedSlashCommandIndex, setSelectedSlashCommandIndex] = useState(0);
  const [agentModeMenuOpen, setAgentModeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [workingDirectoryMenuOpen, setWorkingDirectoryMenuOpen] = useState(false);
  const [workingDirectoryOpening, setWorkingDirectoryOpening] = useState(false);
  const slashTokenMatch = hermesSlashCommands ? value.match(/^\/([^\s/]*)$/) : null;
  const slashCommandQuery = slashTokenMatch?.[1]?.toLowerCase() ?? "";
  const filteredSlashCommands = useMemo(() => {
    if (!hermesSlashCommands) return [];
    const query = slashCommandQuery.trim();
    const matching = HERMES_SLASH_COMMANDS.filter((command) => {
      const haystack = [
        command.name,
        command.description,
        command.category,
        command.argsHint ?? "",
        ...(command.aliases ?? []),
      ].join(" ").toLowerCase();
      return !query || haystack.includes(query);
    });
    return matching.length ? matching : HERMES_SLASH_COMMANDS;
  }, [hermesSlashCommands, slashCommandQuery]);
  const slashCommandOpen = Boolean(hermesSlashCommands && slashTokenMatch && !disabled && filteredSlashCommands.length > 0);

  const selectSlashCommand = (command: HermesSlashCommand) => {
    const nextValue = `/${command.name}${command.name === "<skill-name>" ? "" : " "}`;
    onChange(nextValue);
    setSelectedSlashCommandIndex(0);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextValue.length, nextValue.length);
    });
  };

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (slashCommandOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedSlashCommandIndex((index) => Math.min(index + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSlashCommandIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectSlashCommand(filteredSlashCommands[selectedSlashCommandIndex] ?? filteredSlashCommands[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onChange("");
        setSelectedSlashCommandIndex(0);
        return;
      }
    }
    if (
      !submitOnEnter
      || event.key !== "Enter"
      || event.shiftKey
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.nativeEvent.isComposing
      || shouldKeepEnterAsNewline()
    ) {
      return;
    }
    if (disabled || !canSend) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className={chatClass("chatComposerField", compact && "compactComposer")}>
      {agentMode ? <input type="hidden" name="agentMode" value={agentMode} /> : null}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className={chatClass("chatFileInput")}
        onChange={onFileChange}
        disabled={disabled}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className={chatClass("chatFileInput")}
        onChange={onImageChange}
        disabled={disabled}
      />
      {attachments.length > 0 || directories.length > 0 ? (
        <div className={chatClass("attachmentTray")}>
          {directories.map((directory) => (
            <div className={chatClass("attachmentPill")} key={directory.id}>
              <span>Folder</span>
              <strong>{directory.name}</strong>
              <small>linked</small>
              {onRemoveDirectory ? (
                <CloseIconButton size="sm" aria-label={`Remove ${directory.name}`} onClick={() => onRemoveDirectory(directory.id)} disabled={disabled} />
              ) : null}
            </div>
          ))}
          {attachments.map((attachment) => (
            <div className={chatClass("attachmentPill")} key={attachment.id}>
              <span>{attachment.kind === "image" ? "Image" : attachment.kind === "audio" ? "Audio" : "File"}</span>
              <strong>{attachment.name}</strong>
              <small>{attachmentSizeLabel(attachment.size)}</small>
              <CloseIconButton size="sm" aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(attachment.id)} disabled={disabled} />
            </div>
          ))}
        </div>
      ) : null}
      <TooltipProvider>
        <Tooltip open={slashCommandOpen}>
          <TooltipTrigger asChild>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
                setSelectedSlashCommandIndex(0);
              }}
              onKeyDown={handleTextareaKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              aria-autocomplete={hermesSlashCommands ? "list" : undefined}
            />
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            sideOffset={10}
            className={chatClass("slashCommandTooltip")}
            onPointerDown={(event) => event.preventDefault()}
          >
            <div className={chatClass("slashCommandHeader")}>
              <strong>Hermes commands</strong>
              <span>{filteredSlashCommands.length} matches</span>
            </div>
            <div className={chatClass("slashCommandList")} role="listbox" aria-label="Hermes slash commands">
              {filteredSlashCommands.map((command, index) => {
                const active = index === selectedSlashCommandIndex;
                const usage = `/${command.name}${command.argsHint ? ` ${command.argsHint}` : ""}`;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={chatClass(active && "active")}
                    key={command.name}
                    onMouseEnter={() => setSelectedSlashCommandIndex(index)}
                    onClick={() => selectSlashCommand(command)}
                  >
                    <span>
                      <strong>{usage}</strong>
                      <small>{command.description}</small>
                      {command.aliases?.length ? <small>Aliases: {command.aliases.map((alias) => `/${alias}`).join(", ")}</small> : null}
                    </span>
                    <em>{command.gatewayOnly ? "gateway" : command.cliOnly ? "cli" : command.category}</em>
                  </button>
                );
              })}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {recording ? (
        <div className={chatClass("voiceRecorder")} aria-live="polite">
          <div className={chatClass("voiceWaveform")} aria-hidden="true">
            {voiceBands.map((level, index) => (
              <span key={index} style={{ transform: `scaleY(${0.18 + level * 1.8})` }} />
            ))}
          </div>
          <span>{voiceTranscript || "Listening..."}</span>
        </div>
      ) : null}
      <div className={chatClass("composerTools")}>
        <div className={chatClass("attachmentMenuWrap")} ref={attachmentMenuRef}>
          <button
            type="button"
            className={chatClass("composerIconButton")}
            onClick={() => setAttachmentMenuOpen((open) => !open)}
            disabled={disabled}
            aria-label="Add attachment"
            aria-expanded={attachmentMenuOpen}
          >
            <Plus aria-hidden="true" />
          </button>
          {agentMode && onAgentModeChange ? (
            <TooltipProvider>
              <Tooltip open={agentModeMenuOpen}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={chatClass("composerModeButton")}
                    onClick={() => setAgentModeMenuOpen((open) => !open)}
                    onBlur={(event) => {
                      if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
                        setAgentModeMenuOpen(false);
                      }
                    }}
                    disabled={disabled}
                    aria-label="Choose agent mode"
                    aria-expanded={agentModeMenuOpen}
                  >
                    <span>{agentMode === "plan" ? "Plan" : "Act"}</span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className={chatClass("agentModeTooltip")}
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <div className={chatClass("agentModeList")} role="listbox" aria-label="Agent mode">
                    {[
                      { mode: "plan" as const, label: "Plan", detail: "Think through steps and tradeoffs before changing things." },
                      { mode: "act" as const, label: "Act", detail: "Execute directly and keep moving unless blocked." },
                    ].map((option) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={agentMode === option.mode}
                        key={option.mode}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onAgentModeChange(option.mode);
                          setAgentModeMenuOpen(false);
                          window.requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.detail}</small>
                        </span>
                        {agentMode === option.mode ? <Check aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {modelPicker ? (
            <TooltipProvider>
              <Tooltip open={modelMenuOpen}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={chatClass("composerModeButton", "composerModelButton")}
                    onClick={() => setModelMenuOpen((open) => {
                      const next = !open;
                      if (next) modelPicker.onOpen?.();
                      return next;
                    })}
                    onBlur={(event) => {
                      if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
                        setModelMenuOpen(false);
                      }
                    }}
                    disabled={disabled}
                    aria-label="Switch model"
                    aria-expanded={modelMenuOpen}
                  >
                    <Cpu aria-hidden="true" />
                    <span>{modelPicker.label || "Model"}</span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className={chatClass("modelPickerTooltip")}
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <div className={chatClass("modelPickerHeader")}>
                    <strong>Switch model</strong>
                    {modelPicker.onRefresh ? (
                      <button
                        type="button"
                        className={chatClass("modelPickerRefresh", modelPicker.loading && "loading")}
                        aria-label="Refresh models"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => modelPicker.onRefresh?.()}
                        disabled={modelPicker.loading}
                      >
                        <RefreshCcw aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <div className={chatClass("modelPickerScroll")}>
                    {modelPicker.providers.length ? modelPicker.providers.map((provider) => (
                      <div className={chatClass("modelPickerGroup")} key={provider.slug}>
                        {modelPicker.providers.length > 1 ? (
                          <span className={chatClass("modelPickerGroupLabel")}>{provider.name}</span>
                        ) : null}
                        <div className={chatClass("modelPickerList")} role="listbox" aria-label={`${provider.name} models`}>
                          {provider.models.length ? provider.models.map((model) => {
                            const active = provider.slug === modelPicker.provider && model.id === modelPicker.model;
                            const optionLabel = model.name || model.id;
                            return (
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                key={`${provider.slug}-${model.id}`}
                                className={chatClass(active && "active")}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  modelPicker.onSelect(provider.slug, model.id);
                                  setModelMenuOpen(false);
                                  window.requestAnimationFrame(() => textareaRef.current?.focus());
                                }}
                              >
                                <span>
                                  <strong>{optionLabel}</strong>
                                  {model.name ? <small>{model.id}</small> : null}
                                </span>
                                {active ? <Check aria-hidden="true" /> : null}
                              </button>
                            );
                          }) : (
                            <p className={chatClass("modelPickerEmpty")}>No models reported.</p>
                          )}
                        </div>
                      </div>
                    )) : (
                      <p className={chatClass("modelPickerEmpty")}>
                        {modelPicker.loading ? "Loading models..." : modelPicker.emptyHint || "No models configured yet."}
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {onChangeWorkingDirectory ? (
            <TooltipProvider>
              <Tooltip open={workingDirectoryMenuOpen}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={chatClass("composerDirectoryButton")}
                    onClick={() => setWorkingDirectoryMenuOpen((open) => !open)}
                    onBlur={(event) => {
                      if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
                        setWorkingDirectoryMenuOpen(false);
                      }
                    }}
                    disabled={disabled || workingDirectoryOpening}
                    aria-label="Change working directory"
                    aria-expanded={workingDirectoryMenuOpen}
                  >
                    <FolderOpen aria-hidden="true" />
                    <span>{workingDirectoryOpening ? "Opening..." : workingDirectoryLabel || "Directory"}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  className={chatClass("workingDirectoryTooltip")}
                  onPointerDown={(event) => event.preventDefault()}
                >
                  <div className={chatClass("workingDirectoryPanel")}>
                    <span>Working directory</span>
                    <strong>{workingDirectoryLabel || "No directory selected"}</strong>
                    <button
                      type="button"
                      disabled={workingDirectoryOpening}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={async () => {
                        if (workingDirectoryOpening) return;
                        setWorkingDirectoryOpening(true);
                        setWorkingDirectoryMenuOpen(false);
                        try {
                          await onChangeWorkingDirectory();
                        } finally {
                          setWorkingDirectoryOpening(false);
                          window.requestAnimationFrame(() => textareaRef.current?.focus());
                        }
                      }}
                    >
                      <FolderOpen aria-hidden="true" />
                      {workingDirectoryOpening ? "Opening..." : "Change directory"}
                    </button>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {attachmentMenuOpen ? (
            <AttachmentMenuContent
              onAttachImages={() => imageInputRef.current?.click()}
              onAttachFiles={() => fileInputRef.current?.click()}
              onAttachDirectory={onAttachDirectory}
              directoryPickerDisabled={directoryPickerDisabled}
              directoryPickerDisabledReason={directoryPickerDisabledReason}
              recentDirectories={recentDirectories}
              recentDirectoriesExpanded={recentDirectoriesExpanded}
              setRecentDirectoriesExpanded={setRecentDirectoriesExpanded}
              onAttachRecentDirectory={onAttachRecentDirectory}
            />
          ) : null}
        </div>
        {attachmentError ? <span role="status">{attachmentError}</span> : null}
        <div className={chatClass("composerActions")}>
          {onCancel ? (
            <CloseIconButton className={chatClass("composerIconButton")} onClick={onCancel} disabled={disabled} aria-label="Cancel" />
          ) : null}
          {canRecord ? (
            <button
              type="button"
              className={chatClass("composerIconButton", recording && "recording")}
              onClick={onToggleRecording}
              disabled={disabled}
              aria-label={recording ? "Stop recording" : "Record audio"}
            >
              <Mic aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="submit"
            className={chatClass("composerIconButton", "sendButton")}
            disabled={disabled || !canSend}
            aria-label={busy ? "Waiting" : "Send"}
          >
            {busy ? "·" : compact ? <Check aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MessageAttachments({ attachments }: { attachments?: ChatAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className={chatClass("messageAttachments")}>
      {attachments.map((attachment) => (
        <figure className={chatClass("messageAttachment", attachment.kind)} key={attachment.id}>
          {attachment.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.dataUrl} alt={attachment.name} />
          ) : attachment.kind === "audio" ? (
            <audio src={attachment.dataUrl} controls preload="metadata" />
          ) : (
            <a href={attachment.dataUrl} download={attachment.name}>
              <FileText aria-hidden="true" />
              {attachment.name}
            </a>
          )}
          <figcaption>{attachment.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}
