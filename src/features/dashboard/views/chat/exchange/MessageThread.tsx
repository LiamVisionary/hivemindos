"use client";

import { Fragment, memo, useState } from "react";
import type { ComponentType, Dispatch, ElementType, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { JsonRenderSurface, extractJsonRenderPayload } from "@/components/json-render/JsonRenderSurface";
import { imageGenerationToApplicationGeneration } from "@/features/dashboard/chat-application-generation";
import { generatedImageCardFromAssistantText } from "@/features/dashboard/chat-generated-media";
import { markdownText, messageKey, messageText, promptUiFromMessage } from "@/features/dashboard/views/chat/chat-panel-helpers";
import { AgentProcessPanel, normalizeProcessEvents, processEventsAreActive, type ProcessEvent } from "@/features/dashboard/views/chat/AgentProcessPanel";
import { ApplicationGenerationCard } from "@/features/dashboard/views/chat/ApplicationGenerationCard";
import { extractMiroSharkSimulationCard, MiroSharkSimulationCard } from "@/features/dashboard/views/chat/MiroSharkSimulationCard";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { ChatAttachment, ChatMessage } from "@/features/dashboard/dashboard-types";
import type { ChatResponseBilling } from "@/lib/types/chat-billing";
import { Dot, Glyph, ICON } from "./primitives";

type IconComponent = ElementType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
type ChatMarkdownComponent = ComponentType<{ text: string; className?: string; headingClassName?: string }>;

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
  Copy?: IconComponent;
  KanbanSquare?: IconComponent;
  LoaderCircle?: IconComponent;
  Sparkles?: IconComponent;
};

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

function InteractivePromptControls({ disabled, options, sendPromptMessage, Send }: {
  disabled?: boolean;
  options: Array<{ label: string; value: string }>;
  sendPromptMessage?: (prompt: string) => void | Promise<void>;
  Send?: IconComponent;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  if (!sendPromptMessage || !options.length) return null;
  const submitValue = (value: string) => {
    const prompt = value.trim();
    if (!prompt) return;
    void sendPromptMessage(prompt);
    setOtherText("");
    setOtherOpen(false);
  };
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }} aria-label="Prompt response options">
      <div style={{ display: "grid", gap: 7, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {options.map((option, index) => (
          <button key={`${option.value}-${index}`} type="button" className="fr-chat-mini-button" onClick={() => submitValue(option.value)} disabled={disabled}>
            <span>{index + 1}</span>
            <strong>{option.label}</strong>
          </button>
        ))}
        <button type="button" className="fr-chat-mini-button" onClick={() => setOtherOpen((open) => !open)} aria-expanded={otherOpen} disabled={disabled}>
          <span>{options.length + 1}</span>
          <strong>Other</strong>
        </button>
      </div>
      {otherOpen ? (
        <form
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 7 }}
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
            style={{ minWidth: 0, border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13, outline: 0, padding: "8px 10px" }}
          />
          <button type="submit" className="fr-chat-mini-button" disabled={disabled || !otherText.trim()} aria-label="Send other answer">
            {Send ? <Send aria-hidden="true" /> : "Send"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ThinkingLoader({ AgentResponseLoader }: { AgentResponseLoader?: ElementType }) {
  return AgentResponseLoader ? (
    <AgentResponseLoader />
  ) : (
    <span style={{ display: "flex", gap: 5 }} aria-label="Agent is thinking">
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
  onToggleKanban,
  open,
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
  onToggleKanban: () => void;
  open?: boolean;
  renderKey: string;
}) {
  if (!content?.trim()) return null;
  const generating = Boolean(generation && ["generating", "creating"].includes(generation.phase));
  return (
    <div style={{ position: "relative", justifySelf: "end" }}>
      <div className="fr-chat-action-row">
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

function AttachmentPills({ FileText, attachments }: { FileText?: IconComponent; attachments: ThreadAttachment[] }) {
  if (!attachments.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 5 }}>
      {attachments.map((attachment, index) => (
        <span key={`${attachment.name ?? index}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--panel-2)", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 10.5, padding: "3px 9px" }}>
          {FileText ? <FileText aria-hidden="true" /> : null}
          {attachment.name ?? attachment.label ?? "Attachment"}
        </span>
      ))}
    </div>
  );
}

function ProcessPanel({ iconProps, active, events }: { iconProps: ThreadIconProps; active: boolean; events: ProcessEvent[] }) {
  return <AgentProcessPanel {...iconProps} active={active} events={events} />;
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
  busy,
  chatDisplayContent,
  chatProcessScopeKey,
  copiedMessageKey,
  formatRelativeTime,
  generateKanbanTaskFromChat,
  hasStreamingChunk,
  iconProps,
  messages,
  openKanbanTaskMenuKey,
  processEventsForDisplay,
  processEventsTargetKey,
  selectedAgent,
  sendPromptMessage,
  setCopiedMessageKey,
  setOpenKanbanTaskMenuKey,
  chatKanbanGeneration,
  dismissChatKanbanGeneration,
}: {
  AgentResponseLoader?: ElementType;
  ChatMarkdown?: ChatMarkdownComponent;
  FileText?: IconComponent;
  Send?: IconComponent;
  activeChatTaskRunning?: boolean;
  busy?: boolean;
  chatDisplayContent?: (message: unknown) => string;
  chatProcessScopeKey: string;
  copiedMessageKey: string;
  formatRelativeTime?: (time: number | undefined) => string;
  generateKanbanTaskFromChat?: (lane: string, payload: { key: string; content: string }) => void | Promise<void>;
  hasStreamingChunk?: boolean;
  iconProps: ThreadIconProps;
  messages: ThreadMessage[];
  openKanbanTaskMenuKey: string;
  processEventsForDisplay: ProcessEvent[];
  processEventsTargetKey: string;
  selectedAgent?: AgentProfile | null;
  sendPromptMessage?: (prompt: string) => void | Promise<void>;
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
      <div style={{ display: "grid", justifyItems: "center", gap: 6, padding: "44px 16px", textAlign: "center" }}>
        <strong style={{ color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 16 }}>{selectedAgent ? `Start with ${selectedAgent.name}` : "No agent selected"}</strong>
        <p style={{ maxWidth: 360, margin: 0, color: "var(--fg-3)", fontSize: 13.5, lineHeight: 1.6 }}>{selectedAgent ? "Send a message from the composer below." : "Use the rail to select a chat or start a new one."}</p>
      </div>
    );
  }

  return (
    <>
      {messages.map((message, index) => {
        const content = messageText(message, chatDisplayContent);
        const isUser = message.role === "user";
        const mirosharkCard = !isUser && content ? extractMiroSharkSimulationCard(content) : null;
        const rawApplicationGenerationCard = !isUser
          ? message.applicationGeneration ?? (message.imageGeneration ? imageGenerationToApplicationGeneration(message.imageGeneration) : null)
          : null;
        const generatedImagePathCard = !isUser && content ? generatedImageCardFromAssistantText(content, message.createdAt) : null;
        const applicationGenerationCard = generatedImagePathCard && rawApplicationGenerationCard?.status !== "ready"
          ? generatedImagePathCard
          : rawApplicationGenerationCard;
        const hasAssistantBody = Boolean(content || applicationGenerationCard || generatedImagePathCard || mirosharkCard);
        const promptUi = !isUser && content ? promptUiFromMessage(message, content) : null;
        const assistantDisplayText = promptUi?.displayText ?? content;
        const jsonRenderPayload = !isUser && assistantDisplayText ? extractJsonRenderPayload(assistantDisplayText) : null;
        const assistantDisplayTextWithoutJsonRender = jsonRenderPayload?.remainingText ?? assistantDisplayText;
        const timeLabel = Number.isFinite(message.createdAt) ? formatRelativeTime?.(message.createdAt) : "";
        const attachments = message.attachments ?? [];
        const messageEvents = normalizeProcessEvents(message.processEvents ?? message.events);
        const responseBilling = !isUser ? responseBillingText(message.billing) : "";
        const isPendingAssistant = !isUser && !content && busy && index === messages.length - 1;
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
        const actionProps = {
          Check: iconProps.Check,
          Copy: iconProps.Copy,
          KanbanSquare: iconProps.KanbanSquare,
          LoaderCircle: iconProps.LoaderCircle,
          Sparkles: iconProps.Sparkles,
          content,
          copied: copiedMessageKey === renderKey,
          generation: generationForMessage,
          generateKanbanTaskFromChat,
          onCopy: () => copyMessageContent(renderKey, content),
          onDismissKanban: () => dismissKanbanPopover(renderKey),
          onToggleKanban: () => setOpenKanbanTaskMenuKey((current) => current === renderKey ? "" : renderKey),
          open: openKanbanTaskMenuKey === renderKey,
          renderKey,
        };

        if (isUser) {
          return (
            <Fragment key={renderKey}>
              <article style={{ display: "grid", justifyItems: "end", gap: 5 }}>
                <div style={{ maxWidth: "82%", border: "1px solid var(--honey-line)", borderRadius: "16px 16px 6px 16px", background: "var(--honey-soft)", color: "var(--fg)", fontSize: 14.5, lineHeight: 1.6, padding: "11px 16px" }}>
                  {ChatMarkdown ? <ChatMarkdown text={markdownText(content || "(sent attachments)")} className="fr-chat-markdown" /> : renderInline(content || "(sent attachments)")}
                </div>
                <AttachmentPills FileText={FileText} attachments={attachments} />
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
              <article aria-label="Agent is thinking" style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "var(--fg-2)", fontSize: 14.5, lineHeight: 1.7, paddingLeft: 13 }}>
                  <ThinkingLoader AgentResponseLoader={AgentResponseLoader} />
                </div>
              </article>
            ) : hasAssistantBody ? (
              <article style={{ display: "grid", gap: 9 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--f-mono)", fontSize: 11 }}>
                  <Dot state={activeChatTaskRunning && index === messages.length - 1 ? "working" : "ready"} size={6} />
                  <strong style={{ color: "var(--fg)", fontFamily: "var(--f-display)", fontWeight: 600, whiteSpace: "nowrap" }}>{selectedAgent?.name ?? "Agent"}</strong>
                </div>
                <div style={{ display: "grid", gap: 10, color: "var(--fg-2)", fontSize: 14.5, lineHeight: 1.7, paddingLeft: 14 }}>
                  {applicationGenerationCard ? <ApplicationGenerationCard card={applicationGenerationCard} /> : null}
                  {!applicationGenerationCard && generatedImagePathCard ? <ApplicationGenerationCard card={generatedImagePathCard} /> : null}
                  {mirosharkCard ? <MiroSharkSimulationCard card={mirosharkCard} ChatMarkdown={ChatMarkdown} /> : null}
                  {jsonRenderPayload && !applicationGenerationCard && !generatedImagePathCard && !mirosharkCard?.hideRawContent ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--honey)" aria-hidden><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" /></svg>
                        Generative UI
                      </div>
                      <JsonRenderSurface value={assistantDisplayText} className="m-0" />
                    </div>
                  ) : null}
                  {applicationGenerationCard || generatedImagePathCard || mirosharkCard?.hideRawContent ? null : ChatMarkdown
                    ? (assistantDisplayTextWithoutJsonRender
                      ? selectedAgent?.workerClass === "research"
                        ? <ResearchBriefTabs text={markdownText(assistantDisplayTextWithoutJsonRender)} ChatMarkdown={ChatMarkdown} />
                        : <ChatMarkdown text={markdownText(assistantDisplayTextWithoutJsonRender)} className="fr-chat-markdown" />
                      : null)
                    : renderInline(assistantDisplayTextWithoutJsonRender)}
                  {promptUi?.options?.length ? (
                    <InteractivePromptControls disabled={false} options={promptUi.options} sendPromptMessage={sendPromptMessage} Send={Send} />
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
        <div style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 1 }}>
          <span className="fr-dot live" style={{ color: "var(--live)" }} />
          <ThinkingLoader AgentResponseLoader={AgentResponseLoader} />
        </div>
      ) : null}
    </>
  );
}

// Memoized so the transcript only re-renders when its own props change, not on
// every parent (DashboardApp) re-render from streaming tokens / composer keystrokes.
export const MessageThread = memo(MessageThreadBase);
