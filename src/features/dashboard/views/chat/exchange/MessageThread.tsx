"use client";

import { Fragment, memo, useEffect, useState } from "react";
import type { ComponentType, Dispatch, ElementType, SetStateAction } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { JsonRenderSurface, extractJsonRenderPayload } from "@/components/json-render/JsonRenderSurface";
import { imageGenerationToApplicationGeneration } from "@/features/dashboard/chat-application-generation";
import { generatedMediaCardFromAssistantText } from "@/features/dashboard/chat-generated-media";
import { shouldRenderImageGenerationCard } from "@/features/dashboard/hooks/status-chat-process-image-generation";
import { ChatAttachmentView } from "@/features/chat/chat-attachment-view";
import { parseUserSlashCommandDisplay } from "@/features/queen-voice/queen-command-display";
import { chatProcessTimerIsActive, isHiddenChatProcessEvent, markdownText, messageKey, messageText, promptUiFromMessage } from "@/features/dashboard/views/chat/chat-panel-helpers";
import { AgentProcessPanel, normalizeProcessEvents, processEventsAreActive, type ProcessEvent } from "@/features/dashboard/views/chat/AgentProcessPanel";
import { ApplicationGenerationCard } from "@/features/dashboard/views/chat/ApplicationGenerationCard";
import { extractMiroSharkSimulationCard, MiroSharkSimulationCard } from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import { extractTranscriptCard } from "@/features/dashboard/chat-transcript-card";
import { TranscriptCard } from "@/features/dashboard/views/chat/TranscriptCard";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import type { ChatAttachment, ChatMessage } from "@/features/dashboard/dashboard-types";
import type { ChatResponseBilling } from "@/lib/types/chat-billing";
import type { CapabilityApprovalPlan } from "@/lib/types/capability-approval";
import type { DeliverableSourceMachine } from "@/lib/services/deliverable-open-client";
import { Dot, Glyph, ICON } from "./primitives";
import { AppArtifactCard } from "./AppArtifactCard";
import { CapabilityApprovalCard } from "./CapabilityApprovalCard";
import { HyperframesPromptBuilder } from "../HyperframesPromptBuilder";
import { HYPERFRAMES_PROMPT_BUILDER_ID } from "@/lib/services/chat/hyperframes-prompt";

type IconComponent = ElementType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
type AgentResponseLoaderComponent = ElementType<{ phrase?: string }>;
type ChatMarkdownComponent = ComponentType<{
  text: string;
  className?: string;
  headingClassName?: string;
  sourceMachine?: DeliverableSourceMachine;
  surface?: "chat" | "default";
}>;
type PromptResponse = { label: string; value?: string; respondedAt?: number };
type PromptOption = { label: string; value: string; permissionMode?: ChatPermissionMode; suppressUserMessage?: boolean };
type SendPromptOptions = { permissionMode?: ChatPermissionMode; promptResponse?: PromptResponse; suppressUserMessage?: boolean; visiblePrompt?: string };

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
  GitBranch?: IconComponent;
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

function userRequestBeforeMessage(
  messages: ThreadMessage[],
  messageIndex: number,
  chatDisplayContent?: (message: unknown) => string,
) {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
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
      ? <ChatMarkdown text={markdownText(text)} className="fr-chat-markdown" surface="chat" />
      : renderInline(text);
  }
  const stacked = /^[\t ]*\r?\n/.test(command.suffix);
  const suffix = command.suffix.trimStart();
  return (
    <div className={`fr-chat-user-command${stacked ? " is-stacked" : ""}`}>
      <span className="fr-chat-command-badge">{command.name}</span>
      {suffix ? (
        <div className="fr-chat-user-command-suffix">
          {ChatMarkdown ? <ChatMarkdown text={markdownText(suffix)} className="fr-chat-markdown" surface="chat" /> : renderInline(suffix)}
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
      suppressUserMessage: option.suppressUserMessage,
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

function AgentSessionStartLoader({ label }: { label: string }) {
  return (
    <div className="fr-agent-session-start" role="status" aria-live="polite" aria-label={`${label}...`}>
      <span className="fr-agent-session-start-label">{label}</span>
      <span className="fr-agent-session-progress" aria-hidden="true">
        <span className="fr-agent-session-progress-fill" />
      </span>
    </div>
  );
}

function MessageActions({
  Check,
  Copy,
  GitBranch,
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
  onFork,
  onToggleKanban,
  open,
  feedback,
  feedbackBusyKey,
  renderKey,
}: {
  Check?: IconComponent;
  Copy?: IconComponent;
  GitBranch?: IconComponent;
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
  onFork?: () => void;
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
        <TooltipProvider>
          {onFeedback ? (
            <div className="fr-chat-feedback-actions" aria-label="Rate this response">
              {(["up", "down"] as const).map((rating) => {
                const selected = feedback?.rating === rating;
                const busy = Boolean(feedbackBusyKey?.startsWith(`${renderKey}:`));
                const pending = feedbackBusyKey === `${renderKey}:${rating}`;
                const Icon = rating === "up" ? ThumbsUp : ThumbsDown;
                const label = rating === "up" ? "Good response" : "Bad response";
                return (
                  <Tooltip key={rating}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`fr-chat-feedback-button ${rating === "up" ? "is-positive" : "is-negative"}`}
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
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : null}
          <Tooltip {...(copied ? { open: true } : {})}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="fr-chat-feedback-button"
                aria-label={copied ? "Copied message" : "Copy message"}
                data-active={copied ? "true" : undefined}
                onClick={onCopy}
              >
                {copied && Check ? <Check aria-hidden="true" /> : Copy ? <Copy aria-hidden="true" /> : <Glyph d={ICON.paperclip} s={12} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{copied ? "Copied!" : "Copy message"}</TooltipContent>
          </Tooltip>
          {onFork ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="fr-chat-feedback-button"
                  aria-label="Fork chat from this response"
                  onClick={onFork}
                >
                  {GitBranch ? <GitBranch aria-hidden="true" /> : <Glyph d={ICON.sparkles} s={12} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Fork chat</TooltipContent>
            </Tooltip>
          ) : null}
          {generateKanbanTaskFromChat ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="fr-chat-feedback-button"
                  aria-label="Generate Kanban task from this message"
                  disabled={generating}
                  onClick={onToggleKanban}
                >
                  {generating && LoaderCircle ? <LoaderCircle aria-hidden="true" className="fr-chat-spin-icon" /> : KanbanSquare ? <KanbanSquare aria-hidden="true" /> : <Glyph d={ICON.sparkles} s={12} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Send to Kanban</TooltipContent>
            </Tooltip>
          ) : null}
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
  const visibleEvents = events.filter((event) => !isHiddenChatProcessEvent(event));
  if (!visibleEvents.length) return null;
  return (
    <>
      <WorkedForDivider active={active} events={visibleEvents} />
      <AgentProcessPanel {...iconProps} active={active} events={visibleEvents} />
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

function ResearchBriefTabs({ text, ChatMarkdown, sourceMachine }: {
  text: string;
  ChatMarkdown?: ChatMarkdownComponent;
  sourceMachine?: DeliverableSourceMachine;
}) {
  const sections = parseResearchBriefTabs(text);
  const [activeTab, setActiveTab] = useState(sections?.[0]?.id ?? "");
  if (!sections?.length) return ChatMarkdown ? <ChatMarkdown text={text} className="fr-chat-markdown" sourceMachine={sourceMachine} surface="chat" /> : <>{renderInline(text)}</>;
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
        {ChatMarkdown ? <ChatMarkdown text={active.content || "_No detail returned._"} className="fr-chat-markdown" sourceMachine={sourceMachine} surface="chat" /> : renderInline(active.content || "No detail returned.")}
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
  capabilityPlanSubmittingId,
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
  sourceMachine,
  sendPromptMessage,
  onCapabilityPlanChange,
  onCapabilityPlanSubmit,
  onForkResponse,
  onMessageFeedback,
  onOpenAppWorkspace,
  setCopiedMessageKey,
  setOpenKanbanTaskMenuKey,
  chatKanbanGeneration,
  dismissChatKanbanGeneration,
  sharedVault,
}: {
  AgentResponseLoader?: AgentResponseLoaderComponent;
  ChatMarkdown?: ChatMarkdownComponent;
  FileText?: IconComponent;
  Send?: IconComponent;
  activeChatTaskRunning?: boolean;
  /** "Coder · atlas" — the agent's role and machine, shown beside its name. */
  agentSubline?: string;
  busy?: boolean;
  capabilityPlanSubmittingId?: string;
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
  sourceMachine?: DeliverableSourceMachine;
  sendPromptMessage?: (prompt: string, options?: SendPromptOptions) => void | Promise<void>;
  onCapabilityPlanChange?: (plan: CapabilityApprovalPlan) => void;
  onCapabilityPlanSubmit?: (plan: CapabilityApprovalPlan) => void | Promise<void>;
  onForkResponse?: (responseIndex: number) => void;
  onMessageFeedback?: (message: ThreadMessage, renderKey: string, rating: "up" | "down") => void | Promise<void>;
  onOpenAppWorkspace?: () => void;
  setCopiedMessageKey: Dispatch<SetStateAction<string>>;
  setOpenKanbanTaskMenuKey: Dispatch<SetStateAction<string>>;
  chatKanbanGeneration?: ChatKanbanGeneration | null;
  dismissChatKanbanGeneration?: (key: string) => void;
  sharedVault?: { enabled?: boolean; vaultPath?: string } | null;
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
        const generatedMediaPathCard = !isUser && content ? generatedMediaCardFromAssistantText(content, message.createdAt) : null;
        const preferredApplicationGenerationCard = generatedMediaPathCard && rawApplicationGenerationCard?.status !== "ready"
          ? generatedMediaPathCard
          : rawApplicationGenerationCard;
        const applicationGenerationCard = shouldRenderImageGenerationCard(preferredApplicationGenerationCard)
          ? preferredApplicationGenerationCard
          : null;
        const capabilityApproval = !isUser ? message.capabilityApproval : undefined;
        const capabilityApprovalNeedsReview = Boolean(capabilityApproval);
        const appArtifact = !isUser ? message.appArtifact : undefined;
        const hasAssistantBody = Boolean(content || capabilityApprovalNeedsReview || applicationGenerationCard || generatedMediaPathCard || mirosharkCard || transcriptCard || appArtifact);
        const promptUi = !isUser && content ? promptUiFromMessage(message, content) : null;
        const isHyperframesPromptBuilder = !isUser && message.agentPrompt?.id === HYPERFRAMES_PROMPT_BUILDER_ID;
        const hyperframesSourceRequest = isHyperframesPromptBuilder
          ? userRequestBeforeMessage(messages, index, chatDisplayContent)
          : "";
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
          GitBranch: iconProps.GitBranch,
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
          onFork: !isUser && onForkResponse ? () => onForkResponse(index) : undefined,
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
              {userLiveEvents.length ? (
                <ProcessPanel
                  iconProps={iconProps}
                  active={chatProcessTimerIsActive(Boolean(busy), processEventsAreActive(userLiveEvents))}
                  events={userLiveEvents}
                />
              ) : null}
            </Fragment>
          );
        }

        return (
          <Fragment key={renderKey}>
            {events.length ? (
              <ProcessPanel
                iconProps={iconProps}
                active={chatProcessTimerIsActive(
                  Boolean(busy && index === messages.length - 1),
                  processEventsAreActive(events),
                )}
                events={events}
              />
            ) : null}
            {isPendingAssistant && !hasAssistantBody ? (
              <article aria-label={pendingAssistantLabel ? `${pendingAssistantLabel}...` : "Agent is thinking"} style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "var(--fg-2)", fontSize: 14.5, lineHeight: 1.7, paddingLeft: 13 }}>
                  {pendingAssistantLabel
                    ? <AgentSessionStartLoader label={pendingAssistantLabel} />
                    : <ThinkingLoader AgentResponseLoader={AgentResponseLoader} />}
                </div>
              </article>
            ) : hasAssistantBody ? (
              <article className={`fr-chat-agent-article${promptUi ? " fr-chat-prompt-article" : ""}`}>
                <div className="fr-chat-agent-message-header">
                  <strong className="fr-chat-agent-message-name">{selectedAgent?.name ?? "Agent"}</strong>
                  {(capabilityApprovalNeedsReview && capabilityApproval?.status === "pending") || (promptUi?.options?.length && !promptUi.response) ? (
                    /* Prototype 599: a pending decision reads "needs approval". */
                    <span className="fr-chat-agent-message-state is-approval">needs approval</span>
                  ) : activeChatTaskRunning && index === messages.length - 1 ? (
                    <span className="fr-chat-agent-message-state is-working">
                      <Dot state="working" size={6} />
                      working
                    </span>
                  ) : agentSubline ? (
                    <span className="fr-chat-agent-message-subline">{agentSubline}</span>
                  ) : null}
                </div>
                <div className="fr-chat-agent-message-body">
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
                  {capabilityApprovalNeedsReview && capabilityApproval ? (
                    <CapabilityApprovalCard
                      plan={capabilityApproval}
                      disabled={Boolean(busy || capabilityPlanSubmittingId === capabilityApproval.id)}
                      onChange={onCapabilityPlanChange}
                      onSubmit={onCapabilityPlanSubmit}
                    />
                  ) : null}
                  {appArtifact ? <AppArtifactCard artifact={appArtifact} onOpen={onOpenAppWorkspace} /> : null}
                  {applicationGenerationCard ? <ApplicationGenerationCard card={applicationGenerationCard} /> : null}
                  {!applicationGenerationCard && generatedMediaPathCard ? <ApplicationGenerationCard card={generatedMediaPathCard} /> : null}
                  {isHyperframesPromptBuilder ? (
                    <HyperframesPromptBuilder
                      sourceRequest={hyperframesSourceRequest}
                      disabled={Boolean(busy || message.agentPrompt?.response)}
                      sendPromptMessage={sendPromptMessage}
                    />
                  ) : null}
                  {mirosharkCard ? <MiroSharkSimulationCard card={mirosharkCard} ChatMarkdown={ChatMarkdown} /> : null}
                  {transcriptCard ? (
                    <TranscriptCard
                      brainEnabled={sharedVault?.enabled !== false}
                      card={transcriptCard.card}
                      vaultPath={sharedVault?.vaultPath}
                    />
                  ) : null}
                  {jsonRenderPayload && !applicationGenerationCard && !generatedMediaPathCard && !mirosharkCard?.hideRawContent && !isHyperframesPromptBuilder ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--honey)" aria-hidden><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" /></svg>
                        Generative UI
                      </div>
                      <JsonRenderSurface value={assistantDisplayText} className="m-0" />
                    </div>
                  ) : null}
                  {assistantError || capabilityApproval || applicationGenerationCard || generatedMediaPathCard || mirosharkCard?.hideRawContent || isHyperframesPromptBuilder ? null : ChatMarkdown
                    ? (assistantDisplayTextWithoutJsonRender
                      ? selectedAgent?.workerClass === "research"
                        ? <ResearchBriefTabs text={markdownText(assistantDisplayTextWithoutJsonRender)} ChatMarkdown={ChatMarkdown} sourceMachine={sourceMachine} />
                        : <ChatMarkdown text={markdownText(assistantDisplayTextWithoutJsonRender)} className="fr-chat-markdown" sourceMachine={sourceMachine} surface="chat" />
                      : null)
                    : renderInline(assistantDisplayTextWithoutJsonRender)}
                  {isHyperframesPromptBuilder ? null : promptUi?.response ? (
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
          {pendingAssistantStatusText
            ? <AgentSessionStartLoader label={pendingAssistantStatusText} />
            : <ThinkingLoader AgentResponseLoader={AgentResponseLoader} />}
        </div>
      ) : null}
    </>
  );
}

// Memoized so the transcript only re-renders when its own props change, not on
// every parent (DashboardApp) re-render from streaming tokens / composer keystrokes.
export const MessageThread = memo(MessageThreadBase);
