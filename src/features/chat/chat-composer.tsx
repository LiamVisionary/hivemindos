import { ArrowUp, Check, ChevronDown, Clock3, Cpu, FileText, FileUp, FolderOpen, Image as ImageIcon, Mic, Minus, Network, Paperclip, Plus, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { useVoiceBands } from "@/lib/stores/voice-bands-store";

import chatStyles from "@/app/chat.module.css";
import kanbanStyles from "@/app/kanban-board.module.css";
import { LottiePlayer } from "@/components/ui/lottie-player";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { attachmentSizeLabel, linkedDirectoryLabel } from "@/features/chat/chat-formatters";
import { CHAT_SLASH_COMMANDS, type HermesSlashCommand } from "@/features/chat/hermes-slash-commands";
import { listenForTauriComposerDragDrop, type TauriDragDropEvent, type TauriDropPosition, type TauriWebviewApi } from "@/features/chat/tauri-composer-drag-drop";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";
import type { KanbanLinkedDirectory, KanbanTaskAttachment } from "@/lib/types/kanban";
import type { RecentDirectory } from "@/lib/types/recent-directories";

export { attachmentSizeLabel, linkedDirectoryLabel } from "@/features/chat/chat-formatters";

const chatClass = createStyleClass(chatStyles);
const kanbanClass = createStyleClass(kanbanStyles);

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

type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

function basenameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "Dropped file";
}

function fileReferenceFromPath(path: string) {
  const cleanPath = path.trim();
  if (!cleanPath) return null;
  const file = new File([], basenameFromPath(cleanPath), { type: "application/octet-stream" }) as File & { path?: string };
  Object.defineProperty(file, "path", { value: cleanPath, configurable: true });
  return file;
}

function fileFromReferenceText(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "file:") return null;
    return fileReferenceFromPath(decodeURIComponent(parsed.pathname));
  } catch {
    return trimmed.startsWith("/") || trimmed.startsWith("~/")
      ? fileReferenceFromPath(trimmed)
      : null;
  }
}

function filesFromDataTransfer(dataTransfer: DataTransfer) {
  const directFiles = Array.from(dataTransfer.files ?? []);
  if (directFiles.length) return directFiles;
  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (itemFiles.length) return itemFiles;
  const textReferences = [
    dataTransfer.getData("text/uri-list"),
    dataTransfer.getData("text/plain"),
  ].filter(Boolean).join("\n");
  return textReferences
    .split(/\r?\n/)
    .map(fileFromReferenceText)
    .filter((file): file is File => Boolean(file));
}

function filesFromReferencePaths(paths: string[]) {
  return Array.from(new Set(paths))
    .map(fileReferenceFromPath)
    .filter((file): file is File => Boolean(file));
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

function attachmentReferenceTarget(attachment: ChatAttachment) {
  return attachment.referencePath?.trim() || attachment.name;
}

function attachmentReferenceText(attachments: ChatAttachment[]) {
  return [
    "Attached file references:",
    ...attachments.map((attachment) => {
      const target = attachmentReferenceTarget(attachment);
      const details = [
        target && target !== attachment.name ? `path: ${target}` : "",
        attachment.mimeType ? `type: ${attachment.mimeType}` : "",
        Number.isFinite(attachment.size) ? `size: ${attachmentSizeLabel(attachment.size)}` : "",
      ].filter(Boolean);
      return `- ${attachment.name}${details.length ? ` (${details.join("; ")})` : ""}`;
    }),
  ].join("\n");
}

export function messageContentParts(text: string, attachments: ChatAttachment[]): string | ChatContentPart[] {
  if (attachments.length === 0) return text;
  const parts: ChatContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text: text.trim() });
  const referenceAttachments: ChatAttachment[] = [];
  attachments.forEach((attachment) => {
    if (!attachment.dataUrl) {
      referenceAttachments.push(attachment);
      return;
    }
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
  if (referenceAttachments.length) {
    parts.push({ type: "text", text: attachmentReferenceText(referenceAttachments) });
  }
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

/**
 * The live mic level meter (18 bars). Isolated so the ~12fps voice-bands updates
 * re-render only these spans, not ComposerField or the dashboard tree. Reads the
 * global voice-bands store directly. See @/lib/stores/voice-bands-store.
 */
function VoiceWaveform() {
  const voiceBands = useVoiceBands();
  return (
    <>
      {voiceBands.map((level, index) => (
        <span key={index} style={{ transform: `scaleY(${0.18 + level * 1.8})` }} />
      ))}
    </>
  );
}

export function ComposerField({
  value,
  onChange,
  placeholder,
  className,
  floating = false,
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
  onDropFileReferences,
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
  voiceTranscript,
  onToggleRecording,
  canRecord = true,
  onSwarmCommand,
  onImageGenerationCommand,
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
  className?: string;
  floating?: boolean;
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
  onDropFileReferences?: (files: FileList | File[]) => void;
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
  /** @deprecated ignored — the meter now reads the global voice-bands store. Kept optional for call-site compat. */
  voiceBands?: number[];
  voiceTranscript?: string;
  onToggleRecording?: () => void;
  canRecord?: boolean;
  onSwarmCommand?: () => void;
  onImageGenerationCommand?: () => void;
  canSend: boolean;
  onCancel?: () => void;
  submitOnEnter?: boolean;
  hermesSlashCommands?: boolean;
  agentMode?: "plan" | "act";
  onAgentModeChange?: (mode: "plan" | "act") => void;
  modelPicker?: ComposerModelPicker;
}) {
  const composerFieldRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerDragDepthRef = useRef(0);
  const composerDropActiveRef = useRef(false);
  const composerValue = value ?? "";
  const [composerDropActive, setComposerDropActive] = useState(false);
  const [selectedSlashCommandIndex, setSelectedSlashCommandIndex] = useState(0);
  const [agentModeMenuOpen, setAgentModeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [workingDirectoryMenuOpen, setWorkingDirectoryMenuOpen] = useState(false);
  const [workingDirectoryOpening, setWorkingDirectoryOpening] = useState(false);
  const slashTokenMatch = hermesSlashCommands ? composerValue.match(/^\/([^\s/]*)$/) : null;
  const slashCommandQuery = slashTokenMatch?.[1]?.toLowerCase() ?? "";
  const filteredSlashCommands = useMemo(() => {
    if (!hermesSlashCommands) return [];
    const query = slashCommandQuery.trim();
    const matching = CHAT_SLASH_COMMANDS.filter((command) => {
      const haystack = [
        command.name,
        command.description,
        command.category,
        command.argsHint ?? "",
        ...(command.aliases ?? []),
      ].join(" ").toLowerCase();
      return !query || haystack.includes(query);
    });
    return matching.length ? matching : CHAT_SLASH_COMMANDS;
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

  const canDropFileReferences = Boolean(onDropFileReferences && !disabled);

  function setComposerDropActiveValue(active: boolean) {
    composerDropActiveRef.current = active;
    setComposerDropActive((current) => current === active ? current : active);
  }

  function resetComposerDropState() {
    composerDragDepthRef.current = 0;
    setComposerDropActiveValue(false);
  }

  useEffect(() => {
    if (!canDropFileReferences) return;

    function isInsideComposer(event: Pick<DragEvent, "clientX" | "clientY">) {
      const node = composerFieldRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
    }

    function handleDocumentDragEnter(event: DragEvent) {
      if (!isInsideComposer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      composerDragDepthRef.current += 1;
      setComposerDropActiveValue(true);
    }

    function handleDocumentDragOver(event: DragEvent) {
      if (!isInsideComposer(event)) {
        if (composerDropActiveRef.current) setComposerDropActiveValue(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setComposerDropActiveValue(true);
    }

    function handleDocumentDragLeave(event: DragEvent) {
      if (isInsideComposer(event)) return;
      composerDragDepthRef.current = 0;
      setComposerDropActiveValue(false);
    }

    function handleDocumentDrop(event: DragEvent) {
      if (!isInsideComposer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      composerDragDepthRef.current = 0;
      setComposerDropActiveValue(false);
      onDropFileReferences?.(event.dataTransfer ? filesFromDataTransfer(event.dataTransfer) : []);
    }

    document.addEventListener("dragenter", handleDocumentDragEnter, true);
    document.addEventListener("dragover", handleDocumentDragOver, true);
    document.addEventListener("dragleave", handleDocumentDragLeave, true);
    document.addEventListener("drop", handleDocumentDrop, true);
    return () => {
      document.removeEventListener("dragenter", handleDocumentDragEnter, true);
      document.removeEventListener("dragover", handleDocumentDragOver, true);
      document.removeEventListener("dragleave", handleDocumentDragLeave, true);
      document.removeEventListener("drop", handleDocumentDrop, true);
    };
  }, [canDropFileReferences, onDropFileReferences]);

  useEffect(() => {
    if (!canDropFileReferences) return;
    if (typeof window === "undefined" || !(window as TauriRuntimeWindow).__TAURI_INTERNALS__) return;

    let disposed = false;
    let safeUnlisten = createSafeTauriUnlisten();

    function isInsideComposerPosition(position: TauriDropPosition) {
      const node = composerFieldRef.current;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const contains = (x: number, y: number) => x >= rect.left
        && x <= rect.right
        && y >= rect.top
        && y <= rect.bottom;
      const scale = window.devicePixelRatio || 1;
      return contains(position.x, position.y)
        || (scale > 1 && contains(position.x / scale, position.y / scale));
    }

    function handleTauriDragDrop(event: TauriDragDropEvent) {
      const payload = event.payload;
      if (payload.type === "leave") {
        composerDragDepthRef.current = 0;
        setComposerDropActiveValue(false);
        return;
      }
      const insideComposer = isInsideComposerPosition(payload.position);
      if (!insideComposer) {
        if (composerDropActiveRef.current) setComposerDropActiveValue(false);
        return;
      }
      if (payload.type === "drop") {
        composerDragDepthRef.current = 0;
        setComposerDropActiveValue(false);
        onDropFileReferences?.(filesFromReferencePaths(payload.paths));
        return;
      }
      setComposerDropActiveValue(true);
    }

    void import("@tauri-apps/api/webview")
      .then((module) => {
        if (disposed) return undefined;
        const webviewApi = module as TauriWebviewApi;
        return listenForTauriComposerDragDrop(webviewApi, handleTauriDragDrop);
      })
      .then((unlisten) => {
        if (!unlisten) return;
        safeUnlisten = createSafeTauriUnlisten(unlisten);
        if (disposed) safeUnlisten();
      })
      .catch(() => {
        if (!disposed) {
          composerDragDepthRef.current = 0;
          setComposerDropActiveValue(false);
        }
      });

    return () => {
      disposed = true;
      safeUnlisten();
    };
  }, [canDropFileReferences, onDropFileReferences]);

  function handleComposerDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDropFileReferences) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current += 1;
    setComposerDropActiveValue(true);
  }

  function handleComposerDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDropFileReferences) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setComposerDropActiveValue(true);
  }

  function handleComposerDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDropFileReferences) return;
    event.preventDefault();
    event.stopPropagation();
    composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1);
    if (composerDragDepthRef.current === 0) setComposerDropActiveValue(false);
  }

  function handleComposerDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!canDropFileReferences) return;
    event.preventDefault();
    event.stopPropagation();
    resetComposerDropState();
    onDropFileReferences?.(event.dataTransfer ? filesFromDataTransfer(event.dataTransfer) : []);
  }

  return (
    <div
      ref={composerFieldRef}
      className={chatClass("chatComposerField", floating && "floatingComposer", compact && "compactComposer", composerDropActive && "dropActive", className)}
      onDragEnter={handleComposerDragEnter}
      onDragOver={handleComposerDragOver}
      onDragLeave={handleComposerDragLeave}
      onDrop={handleComposerDrop}
    >
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
      {composerDropActive ? (
        <div className={chatClass("composerDropOverlay")} aria-live="polite">
          <span className={chatClass("composerDropIcon")}>
            <FileUp aria-hidden="true" />
          </span>
          <strong>Drop item here to attach to chat</strong>
        </div>
      ) : null}
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
              <small>{attachment.referenceOnly ? "reference" : attachmentSizeLabel(attachment.size)}</small>
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
              value={composerValue}
              data-bee-composer
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
              <strong>Commands</strong>
              <span>{filteredSlashCommands.length} matches</span>
            </div>
            <div className={chatClass("slashCommandList")} role="listbox" aria-label="Chat slash commands">
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
            <VoiceWaveform />
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
          {onSwarmCommand ? (
            <button
              type="button"
              className={chatClass("composerIconButton")}
              onClick={() => {
                onSwarmCommand();
                window.requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              disabled={disabled}
              aria-label="Prepare swarm command"
              title="Prepare swarm command"
            >
              <Network aria-hidden="true" />
            </button>
          ) : null}
          {onImageGenerationCommand ? (
            <button
              type="button"
              className={chatClass("composerIconButton")}
              onClick={() => {
                onImageGenerationCommand();
                window.requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              disabled={disabled}
              aria-label="Prepare image generation command"
              title="Prepare image generation command"
            >
              <ImageIcon aria-hidden="true" />
            </button>
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
            data-bee-send
            disabled={disabled || !canSend}
            aria-label={busy ? "Queue message" : "Send"}
          >
            {busy ? <Clock3 aria-hidden="true" /> : compact ? <Check aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
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
            attachment.dataUrl ? <img src={attachment.dataUrl} alt={attachment.name} /> : null
          ) : attachment.kind === "audio" && attachment.dataUrl ? (
            <audio src={attachment.dataUrl} controls preload="metadata" />
          ) : attachment.dataUrl ? (
            <a href={attachment.dataUrl} download={attachment.name}>
              <FileText aria-hidden="true" />
              {attachment.name}
            </a>
          ) : (
            <div className={chatClass("messageAttachmentReference")}>
              <FileText aria-hidden="true" />
              <span>{attachmentReferenceTarget(attachment)}</span>
            </div>
          )}
          <figcaption>{attachment.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}
