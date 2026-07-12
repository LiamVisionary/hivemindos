"use client";

import { Fragment, memo, useEffect, useState } from "react";
import type { ComponentType, Dispatch, ElementType, SetStateAction } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { JsonRenderSurface, extractJsonRenderPayload } from "@/components/json-render/JsonRenderSurface";
import { imageGenerationToApplicationGeneration } from "@/features/dashboard/chat-application-generation";
import { generatedImageCardFromAssistantText } from "@/features/dashboard/chat-generated-media";
import { shouldRenderImageGenerationCard } from "@/features/dashboard/hooks/status-chat-process-image-generation";
import { ChatAttachmentView } from "@/features/chat/chat-attachment-view";
import { parseUserSlashCommandDisplay } from "@/features/queen-voice/queen-command-display";
import { markdownText, messageKey, messageText, promptUiFromMessage } from "@/features/dashboard/views/chat/chat-panel-helpers";
import { AgentProcessPanel, normalizeProcessEvents, processEventsAreActive, type ProcessEvent } from "@/features/dashboard/views/chat/AgentProcessPanel";
import { ApplicationGenerationCard } from "@/features/dashboard/views/chat/ApplicationGenerationCard";
import { extractMiroSharkSimulationCard, MiroSharkSimulationCard } from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import { extractTranscriptCard } from "@/features/dashboard/chat-transcript-card";
import { TranscriptCard } from "@/features/dashboard/views/chat/TranscriptCard";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import type { ChatAttachment, ChatMessage } from "@/features/dashboard/dashboard-types";
import type { ChatResponseBilling } from "@/lib/types/chat-billing";
import { Dot, Glyph, ICON } from "./primitives";

type IconComponent = ElementType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
type AgentResponseLoaderComponent = ElementType<{ phrase?: string }>;
type ChatMarkdownComponent = ComponentType<{ text: string; className?: string; headingClassName?: string }>;
type PromptResponse = { label: string; value?: string; respondedAt?: number };
type PromptOption = { label: string; value: string; permissionMode?: ChatPermissionMode };
type SendPromptOptions = { permissionMode?: ChatPermissionMode; promptResponse?: PromptResponse };

// events/label are read defensively; the canonical ChatMessage/attachment types do not define them.
export type ThreadMessage = ChatMessage & { events?: ProcessEvent[] };
type ThreadAttachment = ChatAttachment & { label?: string };

export type ChatKanbanGeneration = {
  key: string;
  phase: string;
  message?: string;
  taskTitle?: string;
  status?: string;
};

export type ThreadIconProps = {
  Check?: IconComponent;
  CircleAlert?: IconComponent;
  Copy?: IconComponent;
  KanbanSquare?: IconComponent;
  LoaderCircle?: IconComponent;
  Sparkles?: IconComponent;
};

function assistantErrorDetail(content: string) {
  return content.match(/^Error:\s*([\s\S]+)$/i)?.[1]?.trim() ?? "";
}

function retryPromptForMessage(
  messages: ThreadMessage[],
  failedMessageIndex: number,
  chatDisplayContent?: (message: unknown) => string,
) {
  for (let index = failedMessageIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role !== "user") continue;
    const content = messageText(candidate, chatDisplayContent).trim();
    if (content) return content;
  }
  return "";
}

function formatBillingUsd(value: number) {
  const decimals = value > 0 && value < 0.001 ? 6 : value > 0 && value < 0.01 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

function responseBillingText(billing: ChatResponseBilling | undefined) {
  const costUsd = Number(billing?.costUsd);
  if (!Number.isFinite(costUsd)) return "";
  const balanceUsd = Number(billing?.balanceUsd);
  const parts = [`Model cost ${formatBillingUsd(costUsd)}`];
  if (Number.isFinite(balanceUsd)) parts.push(`balance ${formatBillingUsd(balanceUsd)}`);
  return parts.join(" · ");
}

function renderInline(text: string) {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={`strong-${key++}`} style={{ color: "var(--fg)", fontWeight: 600 }}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<code key={`code-${key++}`}>{token.slice(1, -1)}</code>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function UserMessageContent({ ChatMarkdown, text }: { ChatMarkdown?: ChatMarkdownComponent; text: string }) {
  const command = parseUserSlashCommandDisplay(text);
  if (!command) {
    return ChatMarkdown
      ? <ChatMarkdown text={markdownText(text)} className="fr-chat-markdown" />
      : renderInline(text);
  }
  const stacked = /^[\t ]*\r?\n/.test(command.suffix);
  const suffix = command.suffix.trimStart();
  return (
    <div className={`fr-chat-user-command${stacked ? " is-stacked" : ""}`}>
      <span className="fr-chat-command-badge">{command.name}</span>
      {suffix ? (
        <div className="fr-chat-user-command-suffix">
          {ChatMarkdown ? <ChatMarkdown text={markdownText(suffix)} className="fr-chat-markdown" /> : renderInline(suffix)}
        </div>
      ) : null}
    </div>
  );
}

function InteractivePromptControls({ allowFreeText = true, disabled, options, sendPromptMessage, Send }: {
  allowFreeText?: boolean;
  disabled?: boolean;
  options: PromptOption[];
  sendPromptMessage?: (prompt: string, options?: SendPromptOptions) => void | Promise<void>;
  Send?: IconComponent;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  if (!sendPromptMessage || !options.length) return null;
  const submitOption = (option: PromptOption) => {
    const prompt = option.value.trim();
    if (!prompt) return;
    void sendPromptMessage(prompt, {
      ...(option.permissionMode ? { permissionMode: option.permissionMode } : {}),
      promptResponse: { label: decisionResponseLabel(option.label, prompt), value: prompt },
    });
    setOtherText("");
    setOtherOpen(false);
  };
  const submitValue = (value: string) => {
    const prompt = value.trim();
    if (!prompt) return;
    void sendPromptMessage(prompt, { promptResponse: { label: "Answered", value: prompt } });
    setOtherText("");
    setOtherOpen(false);
  };
  return (
    <div className="fr-chat-prompt-actions" aria-label="Prompt response options">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        {options.map((option, index) => (
          <button
            key={`${option.value}-${index}`}
            type="button"
            className="cx-promptbtn"
            onClick={() => submitOption(option)}
            disabled={disabled}
            style={{ ...promptButtonStyle, ...(isAffirmativeOption(option.label) ? promptButtonPrimary : promptButtonSecondary) }}
          >
            {option.label}
          </button>
        ))}
        {allowFreeText ? (
          <button
            type="button"
            className="cx-promptbtn"
            onClick={() => setOtherOpen((open) => !open)}
            aria-expanded={otherOpen}
            disabled={disabled}
            style={{ ...promptButtonStyle, border: "1px solid color-mix(in srgb, var(--fg-4) 35%, transparent)", background: "var(--panel-2)", color: "var(--fg-3)" }}
          >
            Other
          </button>
        ) : null}
      </div>
      {allowFreeText && otherOpen ? (
        <form
          className="fr-chat-prompt-other-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitValue(otherText);
          }}
        >
          <input
            type="text"
            value={otherText}
            onChange={(event) => setOtherText(event.currentTarget.value)}
            placeholder="Type another answer..."
            disabled={disabled}
            autoFocus
          />
          <button type="submit" className="fr-chat-prompt-send-button" disabled={disabled || !otherText.trim()} aria-label="Send other answer">
            {Send ? <Send aria-hidden="true" /> : "Send"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

// The prototype's pill row: an affirmative choice reads honey, everything else
// reads muted. (Chat.dc.html lines 603-606.)
const promptButtonStyle: React.CSSProperties = {
  minHeight: 40,
  borderRadius: 999,
  cursor: "pointer",
  fontFamily: "var(--f-body)",
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  padding: "10px 14px",
};
const promptButtonPrimary: React.CSSProperties = {
  border: "1px solid var(--honey-line)",
  background: "var(--honey-soft)",
  color: "var(--honey)",
};
const promptButtonSecondary: React.CSSProperties = {
  border: "1px solid var(--line-2)",
  background: "var(--panel-2)",
  color: "var(--fg-3)",
};

function isAffirmativeOption(label: string) {
  return /^(approve|accept|yes|confirm|allow|deploy|continue)\b/i.test(label.trim());
}

function decisionResponseLabel(label: string, value: string) {
  const text = (label || value).replace(/\s+/g, " ").trim();
  if (/^approve\b/i.test(text)) return text.replace(/^approve\b/i, "Approved");
  if (/^accept\b/i.test(text)) return text.replace(/^accept\b/i, "Accepted");
  if (/^reject\b/i.test(text)) return text.replace(/^reject\b/i, "Rejected");
  return text || "Answered";
}

/** Tone of a settled prompt, derived from the label `decisionResponseLabel` produced. */
function settledPromptTone(label: string) {
  if (/^reject|^den(y|ied)|^declin/i.test(label)) {
    return { color: "var(--danger)", background: "var(--danger-soft)", border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)" };
  }
  if (/^approv|^accept/i.test(label)) {
    return { color: "var(--live)", background: "var(--honey-soft)", border: "1px solid var(--honey-line)" };
  }
  return { color: "var(--honey)", background: "var(--honey-soft)", border: "1px solid var(--honey-line)" };
}

function InteractivePromptResponse({ response }: { response: PromptResponse }) {
  const tone = settledPromptTone(response.label);
  return (
    <div
      aria-label={`Prompt response: ${response.label}`}
      style={{ display: "inline-flex", width: "fit-content", alignItems: "center", gap: 8, borderRadius: 999, fontFamily: "var(--f-body)", fontSize: 10, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 12px", ...tone }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: "currentColor" }} />
      {response.label}
    </div>
  );
}

function ThinkingLoader({ AgentResponseLoader, phrase }: { AgentResponseLoader?: AgentResponseLoaderComponent; phrase?: string }) {
  const cleanPhrase = phrase?.trim();
  return AgentResponseLoader ? (
    <AgentResponseLoader phrase={cleanPhrase || undefined} />
  ) : (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }} aria-label={cleanPhrase ? `${cleanPhrase}...` : "Agent is thinking"}>
      {cleanPhrase ? <span style={{ color: "var(--fg-3)", fontSize: 13, fontWeight: 600 }}>{cleanPhrase}</span> : null}
      {[0, 1, 2].map((index) => <span key={index} style={{ width: 6, height: 6, borderRadius: 999, background: "var(--fg-3)", animation: `fr-td 1.1s ease-in-out ${index * 0.18}s infinite` }} />)}
    </span>
  );
}

function MessageActions({
  Check,
  Copy,
  KanbanSquare,
  LoaderCircle,
  Sparkles,
  content,
  copied,
  generation,
  generateKanbanTaskFromChat,
  onCopy,
  onDismissKanban,
  onFeedback,
  onToggleKanban,
  open,
  feedback,
  feedbackBusyKey,
  renderKey,
}: {
  Check?: IconComponent;
  Copy?: IconComponent;
  KanbanSquare?: IconComponent;
  LoaderCircle?: IconComponent;
  Sparkles?: IconComponent;
  content: string;
  copied?: boolean;
  generation?: ChatKanbanGeneration | null;
  generateKanbanTaskFromChat?: (lane: string, payload: { key: string; content: string }) => void | Promise<void>;
  onCopy: () => void;
  onDismissKanban: () => void;
  onFeedback?: (rating: "up" | "down") => void | Promise<void>;
  onToggleKanban: () => void;
  open?: boolean;
  feedback?: ChatMessage["feedback"];
  feedbackBusyKey?: string;
  renderKey: string;
}) {
  if (!content?.trim()) return null;
  const generating = Boolean(generation && ["generating", "creating"].includes(generation.phase));
  return (
    <div style={{ position: "relative", justifySelf: "end" }}>
      <div className="fr-chat-action-row">
        {onFeedback ? (
          <div className="fr-chat-feedback-actions" aria-label="Rate this response">
            {(["up", "down"] as const).map((rating) => {
              const selected = feedback?.rating === rating;
              const busy = Boolean(feedbackBusyKey?.startsWith(`${renderKey}:`));
              const pending = feedbackBusyKey === `${renderKey}:${rating}`;
              const Icon = rating === "up" ? ThumbsUp : ThumbsDown;
              const label = rating === "up" ? "Good response" : "Bad response";
              return (
                <button
                  key={rating}
                  type="button"
                  className={`fr-chat-feedback-button ${rating === "up" ? "is-positive" : "is-negative"}`}
                  title={label}
                  aria-label={label}
                  aria-pressed={selected}
                  data-active={selected ? "true" : "false"}
                  disabled={busy}
                  onClick={() => void onFeedback(rating)}
                >
                  {pending && LoaderCircle
                    ? <LoaderCircle aria-hidden="true" className="cx-spin" />
                    : <Icon aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        ) : null}
        <TooltipProvider>
          <ButtonGroup className="fr-chat-segmented-actions">
            <Tooltip {...(copied ? { open: true } : {})}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  className="fr-chat-segmented-button"
                  aria-label={copied ? "Copied message" : "Copy message"}
                  data-active={copied ? "true" : undefined}
                  onClick={onCopy}
                >
                  {copied && Check ? <Check aria-hidden="true" /> : Copy ? <Copy aria-hidden="true" /> : <Glyph d={ICON.paperclip} s={12} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{copied ? "Copied!" : "Copy message"}</TooltipContent>
            </Tooltip>
            {generateKanbanTaskFromChat ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    className="fr-chat-segmented-button"
                    aria-label="Generate Kanban task from this message"
                    disabled={generating}
                    onClick={onToggleKanban}
                  >
                    {generating && LoaderCircle ? <LoaderCircle aria-hidden="true" className="fr-chat-spin-icon" /> : KanbanSquare ? <KanbanSquare aria-hidden="true" /> : <Glyph d={ICON.sparkles} s={12} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Send to Kanban</TooltipContent>
              </Tooltip>
            ) : null}
          </ButtonGroup>
        </TooltipProvider>
      </div>
      {generateKanbanTaskFromChat && (open || generation) ? (
        <div className="fr-chat-kanban-popover">
          <header>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              {generation?.phase === "done" && Check ? <Check aria-hidden="true" /> : Sparkles ? <Sparkles aria-hidden="true" /> : null}
              {generation ? generation.message : "Generate and send to"}
            </span>
            {!generation || ["done", "error"].includes(generation.phase) ? <button type="button" aria-label="Close Kanban menu" onClick={onDismissKanban}>x</button> : null}
          </header>
          {generation ? <small>{generation.taskTitle || (generation.status === "ready" ? "Ready lane" : "Ideas lane")}</small> : (
            <div>
              <button type="button" className="fr-chat-mini-button" onClick={() => void generateKanbanTaskFromChat("ideas", { key: renderKey, content })}>Ideas</button>
              <button type="button" className="fr-chat-mini-button" onClick={() => void generateKanbanTaskFromChat("ready", { key: renderKey, content })}>Ready</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MessageFooter({ actions, align = "agent", timeLabel }: { actions?: React.ReactNode; align?: "agent" | "user"; timeLabel?: string }) {
  if (!timeLabel && !actions) return null;
  return (
    <div className={`fr-chat-message-footer ${align === "user" ? "is-user" : "is-agent"}`}>
      {timeLabel ? <time className="fr-chat-message-time">{timeLabel}</time> : null}
      {actions}
    </div>
  );
}

function AttachmentPills({ attachments }: { attachments: ThreadAttachment[] }) {
  if (!attachments.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
      {attachments.map((attachment, index) => (
        <ChatAttachmentView key={`${attachment.id ?? attachment.name ?? index}-${index}`} attachment={attachment} surface="message" />
      ))}
    </div>
  );
}

function formatWorkedDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}h ` : ""}${minutes}m ${seconds % 60}s`;
}

/**
 * "Worked for 2m 47s" / live "Working for 1h 10m 41s" divider above a turn's
 * tool timeline (Chat.dc.html 409-412, 488-491).
 *
 * Timings come from the real `ProcessEvent.at` epochs. When the events carry no
 * usable timestamps the divider renders nothing rather than inventing a
 * duration.
 */
function WorkedForDivider({ active, events }: { active: boolean; events: ProcessEvent[] }) {
  const stamps = events.map((event) => Number(event.at)).filter((at) => Number.isFinite(at) && at > 0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || !stamps.length) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, stamps.length]);

  if (!stamps.length) return null;
  const first = Math.min(...stamps);
  const last = Math.max(...stamps);
  const elapsed = active ? Math.max(0, now - first) : last - first;
  if (!active && elapsed <= 0) return null;

  return (
    <div style={{ display: "grid", gap: 9, paddingTop: 6 }}>
      {active ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--live)" }}>
          <span className="cx-dot-live" style={{ width: 6, height: 6, borderRadius: 99, background: "currentColor" }} />
          Working for {formatWorkedDuration(elapsed)}
        </span>
      ) : (
        <span style={{ fontFamily: "var(--f-body)", fontSize: 12.5, color: "var(--fg-4)" }}>
          Worked for {formatWorkedDuration(elapsed)}
        </span>
      )}
      <span style={{ height: 1, background: "var(--line)" }} />
    </div>
  );
}

function ProcessPanel({ iconProps, active, events }: { iconProps: ThreadIconProps; active: boolean; events: ProcessEvent[] }) {
  return (
    <>
      <WorkedForDivider active={active} events={events} />
      <AgentProcessPanel {...iconProps} active={active} events={events} />
    </>
  );
}

const RESEARCH_BRIEF_TABS = [
  { id: "perspectives", label: "Perspectives", pattern: /^perspectives?\b|^multi[- ]?perspective/i },
  { id: "contradictions", label: "Contradictions", pattern: /^contradictions?\b|^contradiction map\b/i },
  { id: "synthesis", label: "Synthesis", pattern: /^synthesis\b|^briefing\b|^research briefing\b/i },
  { id: "peer-review", label: "Peer Review", pattern: /^peer review\b|^self[- ]?review\b|^confidence\b/i },
  { id: "sources", label: "Sources", pattern: /^sources?\b|^citations?\b|^references?\b/i },
];

function researchTabForHeading(heading: string) {
  const normalized = heading.trim().replace(/^[#\s]+/, "").replace(/[:\s]+$/g, "");
  return RESEARCH_BRIEF_TABS.find((tab) => tab.pattern.test(normalized));
}

function parseResearchBriefTabs(text: string) {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ id: string; label: string; content: string }> = [];
  let active: { id: string; label: string; lines: string[] } | null = null;
  const intro: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    const tab = heading ? researchTabForHeading(heading[1]) : null;
    if (tab) {
      if (active) sections.push({ id: active.id, label: active.label, content: active.lines.join("\n").trim() });
      active = { id: tab.id, label: tab.label, lines: [] };
      continue;
    }
    if (active) active.lines.push(line);
    else intro.push(line);
  }
  if (active) sections.push({ id: active.id, label: active.label, content: active.lines.join("\n").trim() });
  if (sections.length < 2) return null;
  const introText = intro.join("\n").trim();
  return introText ? [{ id: "overview", label: "Overview", content: introText }, ...sections] : sections;
}

function ResearchBriefTabs({ text, ChatMarkdown }: { text: string; ChatMarkdown?: ChatMarkdownComponent }) {
  const sections = parseResearchBriefTabs(text);
  const [activeTab, setActiveTab] = useState(sections?.[0]?.id ?? "");
  if (!sections?.length) return ChatMarkdown ? <ChatMarkdown text={text} className="fr-chat-markdown" /> : <>{renderInline(text)}</>;
  const active = sections.find((section) => section.id === activeTab) ?? sections[0];
  return (
    <div className="fr-research-brief" aria-label="Research brief">
      <div className="fr-research-tabs" role="tablist" aria-label="Research brief sections">
        {sections.map((section) => {
          const selected = section.id === active.id;
          return (
            <button
              type="button"
              key={section.id}
              role="tab"
              aria-selected={selected}
              className="fr-research-tab"
              data-active={selected}
              onClick={() => setActiveTab(section.id)}
            >
              {section.label}
            </button>
          );
        })}
      </div>
      <div className="fr-research-panel" role="tabpanel">
        {ChatMarkdown ? <ChatMarkdown text={active.content || "_No detail returned._"} className="fr-chat-markdown" /> : renderInline(active.content || "No detail returned.")}
      </div>
    </div>
  );
}

function MessageThreadBase({
  AgentResponseLoader,
  ChatMarkdown,
  FileText,
  Send,
  activeChatTaskRunning,
  agentSubline,
  busy,
  chatDisplayContent,
  chatProcessScopeKey,
  copiedMessageKey,
  feedbackBusyKey,
  formatRelativeTime,
  generateKanbanTaskFromChat,
  hasStreamingChunk,
  iconProps,
  messages,
  openKanbanTaskMenuKey,
  pendingAssistantStatusText,
  processEventsForDisplay,
  processEventsTargetKey,
  selectedAgent,
  sendPromptMessage,
  onMessageFeedback,
  setCopiedMessageKey,
  setOpenKanbanTaskMenuKey,
  chatKanbanGeneration,
  dismissChatKanbanGeneration,
}: {
  AgentResponseLoader?: AgentResponseLoaderComponent;
  ChatMarkdown?: ChatMarkdownComponent;
  FileText?: IconComponent;
  Send?: IconComponent;
  activeChatTaskRunning?: boolean;
  /** "Coder · atlas" — the agent's role and machine, shown beside its name. */
  agentSubline?: string;
  busy?: boolean;
  chatDisplayContent?: (message: unknown) => string;
  chatProcessScopeKey: string;
  copiedMessageKey: string;
  feedbackBusyKey?: string;
  formatRelativeTime?: (time: number | undefined) => string;
  generateKanbanTaskFromChat?: (lane: string, payload: { key: string; content: string }) => void | Promise<void>;
  hasStreamingChunk?: boolean;
  iconProps: ThreadIconProps;
  messages: ThreadMessage[];
  openKanbanTaskMenuKey: string;
  pendingAssistantStatusText?: string;
  processEventsForDisplay: ProcessEvent[];
  processEventsTargetKey: string;
  selectedAgent?: AgentProfile | null;
  sendPromptMessage?: (prompt: string, options?: SendPromptOptions) => void | Promise<void>;
  onMessageFeedback?: (message: ThreadMessage, renderKey: string, rating: "up" | "down") => void | Promise<void>;
  setCopiedMessageKey: Dispatch<SetStateAction<string>>;
  setOpenKanbanTaskMenuKey: Dispatch<SetStateAction<string>>;
  chatKanbanGeneration?: ChatKanbanGeneration | null;
  dismissChatKanbanGeneration?: (key: string) => void;
}) {
  const pendingAssistantBubbleVisible = busy && !hasStreamingChunk && messages.some((message, index) => (
    index === messages.length - 1
    && message?.role === "assistant"
    && !messageText(message, chatDisplayContent)
  ));

  function copyMessageContent(key: string, content: string) {
    void navigator.clipboard?.writeText(content).then(() => {
      setCopiedMessageKey(key);
      window.setTimeout(() => setCopiedMessageKey((current) => current === key ? "" : current), 1400);
    });
  }

  function dismissKanbanPopover(key: string) {
    dismissChatKanbanGeneration?.(key);
    setOpenKanbanTaskMenuKey((current) => current === key ? "" : current);
  }

  if (!messages.length) {
    return (
      <div className="cx-fade" style={{ display: "grid", justifyItems: "center", gap: 12, padding: "48px 20px", textAlign: "center" }}>
        <span style={{ display: "grid", placeItems: "center", width: 52, height: 52, border: "1px solid var(--line-2)", borderRadius: 16, background: "var(--bg-soft)", color: "var(--honey)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <div style={{ color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 17, fontWeight: 600 }}>
          {selectedAgent ? `New chat with ${selectedAgent.name}` : "No agent selected"}
        </div>
        <p style={{ maxWidth: 340, margin: 0, color: "var(--fg-3)", fontFamily: "var(--f-body)", fontSize: 13, lineHeight: 1.6 }}>
          {selectedAgent
            ? `Send a message to kick off a task. ${selectedAgent.name} runs on the machine you route it to and keeps spend and deploys behind approval.`
            : "Use the rail to select a chat or start a new one."}
        </p>
      </div>
    );
  }

  return (
    <>
      {messages.map((message, index) => {
        const content = messageText(message, chatDisplayContent);
        const isUser = message.role === "user";
        const assistantError = !isUser ? assistantErrorDetail(content) : "";
        const retryPrompt = assistantError
          ? retryPromptForMessage(messages, index, chatDisplayContent)
          : "";
        const CircleAlert = iconProps.CircleAlert;
        const mirosharkCard = !isUser && content ? extractMiroSharkSimulationCard(content) : null;
        const transcriptCard = !isUser && content ? extractTranscriptCard(content) : null;
        const rawApplicationGenerationCard = !isUser
          ? message.applicationGeneration ?? (message.imageGeneration ? imageGenerationToApplicationGeneration(message.imageGeneration) : null)
          : null;
        const generatedImagePathCard = !isUser && content ? generatedImageCardFromAssistantText(content, message.createdAt) : null;
        const preferredApplicationGenerationCard = generatedImagePathCard && rawApplicationGenerationCard?.status !== "ready"
          ? generatedImagePathCard
          : rawApplicationGenerationCard;
        const applicationGenerationCard = shouldRenderImageGenerationCard(preferredApplicationGenerationCard)
          ? preferredApplicationGenerationCard
          : null;
        const hasAssistantBody = Boolean(content || applicationGenerationCard || generatedImagePathCard || mirosharkCard || transcriptCard);
        const promptUi = !isUser && content ? promptUiFromMessage(message, content) : null;
        const assistantDisplayText = transcriptCard ? transcriptCard.remainingText : (promptUi?.displayText ?? content);
        const jsonRenderPayload = !isUser && assistantDisplayText ? extractJsonRenderPayload(assistantDisplayText) : null;
        const assistantDisplayTextWithoutJsonRender = jsonRenderPayload?.remainingText ?? assistantDisplayText;
        const timeLabel = Number.isFinite(message.createdAt) ? formatRelativeTime?.(message.createdAt) : "";
        const attachments = message.attachments ?? [];
        const messageEvents = normalizeProcessEvents(message.processEvents ?? message.events);
        const responseBilling = !isUser ? responseBillingText(message.billing) : "";
        const isPendingAssistant = !isUser && !content && busy && index === messages.length - 1;
        const pendingAssistantLabel = isPendingAssistant ? pendingAssistantStatusText : undefined;
        const renderKey = messageKey(message, index);
        const userProcessRenderKey = `${chatProcessScopeKey}\u001fuser\u001f${renderKey}`;
        const assistantProcessRenderKey = `${chatProcessScopeKey}\u001fassistant\u001f${renderKey}`;
        const liveEvents = !isUser && assistantProcessRenderKey === processEventsTargetKey && !messageEvents.length
          ? processEventsForDisplay
          : [];
        const nextAssistantHasProcessEvents = isUser ? (() => {
          for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
            const candidate = messages[nextIndex];
            if (candidate?.role === "user") return false;
            if (candidate?.role === "assistant" && normalizeProcessEvents(candidate.processEvents ?? candidate.events).length > 0) return true;
          }
          return false;
        })() : false;
        const userLiveEvents = isUser && userProcessRenderKey === processEventsTargetKey && !nextAssistantHasProcessEvents
          ? processEventsForDisplay
          : [];
        const events = messageEvents.length ? messageEvents : liveEvents;
        const generationForMessage = chatKanbanGeneration?.key === renderKey ? chatKanbanGeneration : null;
        // Copying a transcript message should yield the readable transcript +
        // summary, not the raw hidden marker that carries the card payload.
        const copyText = transcriptCard
          ? [transcriptCard.card.transcript, transcriptCard.remainingText].filter(Boolean).join("\n\n")
          : content;
        const actionProps = {
          Check: iconProps.Check,
          Copy: iconProps.Copy,
          KanbanSquare: iconProps.KanbanSquare,
          LoaderCircle: iconProps.LoaderCircle,
          Sparkles: iconProps.Sparkles,
          content: copyText,
          copied: copiedMessageKey === renderKey,
          generation: generationForMessage,
          generateKanbanTaskFromChat,
          onCopy: () => copyMessageContent(renderKey, copyText),
          onDismissKanban: () => dismissKanbanPopover(renderKey),
          onFeedback: !isUser && message.sourceSessionId && onMessageFeedback
            ? (rating: "up" | "down") => onMessageFeedback(message, renderKey, rating)
            : undefined,
          onToggleKanban: () => setOpenKanbanTaskMenuKey((current) => current === renderKey ? "" : renderKey),
          open: openKanbanTaskMenuKey === renderKey,
          feedback: !isUser ? message.feedback : undefined,
          feedbackBusyKey,
          renderKey,
        };

        if (isUser) {
          return (
            <Fragment key={renderKey}>
              <article style={{ display: "grid", justifyItems: "end", gap: 5 }}>
                <div style={{ maxWidth: "82%", border: "1px solid var(--honey-line)", borderRadius: "16px 16px 6px 16px", background: "var(--honey-soft)", color: "var(--fg)", fontSize: 14.5, lineHeight: 1.6, padding: "11px 16px" }}>
                  <UserMessageContent ChatMarkdown={ChatMarkdown} text={content || "(sent attachments)"} />
                </div>
                <AttachmentPills attachments={attachments} />
                <MessageFooter align="user" timeLabel={timeLabel} actions={<MessageActions {...actionProps} />} />
              </article>
              {userLiveEvents.length ? <ProcessPanel iconProps={iconProps} active={busy || processEventsAreActive(userLiveEvents)} events={userLiveEvents} /> : null}
            </Fragment>
          );
        }

        return (
          <Fragment key={renderKey}>
            {events.length ? (
              <ProcessPanel
                iconProps={iconProps}
                active={liveEvents.length ? busy || processEventsAreActive(liveEvents) : processEventsAreActive(messageEvents)}
                events={events}
              />
            ) : null}
            {isPendingAssistant && !hasAssistantBody ? (
              <article aria-label={pendingAssistantLabel ? `${pendingAssistantLabel}...` : "Agent is thinking"} style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "var(--fg-2)", fontSize: 14.5, lineHeight: 1.7, paddingLeft: 13 }}>
                  <ThinkingLoader AgentResponseLoader={AgentResponseLoader} phrase={pendingAssistantLabel} />
                </div>
              </article>
            ) : hasAssistantBody ? (
              <article className={promptUi ? "fr-chat-prompt-article" : undefined} style={{ display: "grid", gap: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <strong style={{ color: "var(--fg)", fontFamily: "var(--f-body)", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>{selectedAgent?.name ?? "Agent"}</strong>
                  {promptUi?.options?.length && !promptUi.response ? (
                    /* Prototype 599: a pending decision reads "needs approval". */
                    <span style={{ flexShrink: 0, fontFamily: "var(--f-body)", fontSize: 11, color: "var(--honey)" }}>needs approval</span>
                  ) : activeChatTaskRunning && index === messages.length - 1 ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, fontFamily: "var(--f-body)", fontSize: 11.5, color: "var(--live)" }}>
                      <Dot state="working" size={6} />
                      working
                    </span>
                  ) : agentSubline ? (
                    <span style={{ fontFamily: "var(--f-body)", fontSize: 11.5, color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agentSubline}</span>
                  ) : null}
                </div>
                <div style={{ display: "grid", gap: 10, color: "var(--fg-2)", fontSize: 14.5, lineHeight: 1.7, paddingLeft: 14 }}>
                  {assistantError ? (
                    <div className="fr-chat-error-card" role="alert">
                      <span className="fr-chat-error-card-icon" aria-hidden="true">
                        {CircleAlert ? <CircleAlert /> : "!"}
                      </span>
                      <div className="fr-chat-error-card-copy">
                        <strong>There was an error</strong>
                        <p>{assistantError}</p>
                      </div>
                      <button
                        type="button"
                        className="fr-chat-error-retry"
                        aria-label="Retry failed message"
                        disabled={busy || !retryPrompt || !sendPromptMessage}
                        onClick={() => {
                          if (retryPrompt) void sendPromptMessage?.(retryPrompt);
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : null}
                  {applicationGenerationCard ? <ApplicationGenerationCard card={applicationGenerationCard} /> : null}
                  {!applicationGenerationCard && generatedImagePathCard ? <ApplicationGenerationCard card={generatedImagePathCard} /> : null}
                  {mirosharkCard ? <MiroSharkSimulationCard card={mirosharkCard} ChatMarkdown={ChatMarkdown} /> : null}
                  {transcriptCard ? <TranscriptCard card={transcriptCard.card} /> : null}
                  {jsonRenderPayload && !applicationGenerationCard && !generatedImagePathCard && !mirosharkCard?.hideRawContent ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--honey)" aria-hidden><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" /></svg>
                        Generative UI
                      </div>
                      <JsonRenderSurface value={assistantDisplayText} className="m-0" />
                    </div>
                  ) : null}
                  {assistantError || applicationGenerationCard || generatedImagePathCard || mirosharkCard?.hideRawContent ? null : ChatMarkdown
                    ? (assistantDisplayTextWithoutJsonRender
                      ? selectedAgent?.workerClass === "research"
                        ? <ResearchBriefTabs text={markdownText(assistantDisplayTextWithoutJsonRender)} ChatMarkdown={ChatMarkdown} />
                        : <ChatMarkdown text={markdownText(assistantDisplayTextWithoutJsonRender)} className="fr-chat-markdown" />
                      : null)
                    : renderInline(assistantDisplayTextWithoutJsonRender)}
                  {promptUi?.response ? (
                    <InteractivePromptResponse response={promptUi.response} />
                  ) : promptUi?.options?.length ? (
                    <InteractivePromptControls allowFreeText={promptUi.allowFreeText !== false} disabled={false} options={promptUi.options} sendPromptMessage={sendPromptMessage} Send={Send} />
                  ) : null}
                </div>
                {responseBilling ? <div className="fr-chat-response-billing">{responseBilling}</div> : null}
                {!(busy && index === messages.length - 1) ? <MessageFooter align="agent" timeLabel={timeLabel} actions={<MessageActions {...actionProps} />} /> : null}
              </article>
            ) : null}
          </Fragment>
        );
      })}
      {busy && !hasStreamingChunk && !pendingAssistantBubbleVisible ? (
        <div className="fr-chat-enter" style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 1 }}>
          <span className="fr-dot live" style={{ color: "var(--live)" }} />
          <ThinkingLoader AgentResponseLoader={AgentResponseLoader} phrase={pendingAssistantStatusText} />
        </div>
      ) : null}
    </>
  );
}

// Memoized so the transcript only re-renders when its own props change, not on
// every parent (DashboardApp) re-render from streaming tokens / composer keystrokes.
export const MessageThread = memo(MessageThreadBase);
