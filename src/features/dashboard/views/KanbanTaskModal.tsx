// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { createStyleClass } from "@/features/dashboard/style-classes";
import { extractHumanAsk, extractResultArtifacts, formatPlainResultBody, isBriefGuidanceSection, isBriefGuidanceText, isBriefTechnicalField, parseTaskBrief } from "@/features/dashboard/kanban-result-format";
import { KanbanNeedsHumanPanel } from "./KanbanNeedsHumanPanel";
import convoStyles from "@/app/kanban-conversation.module.css";

const convoClass = createStyleClass(convoStyles);

// One task modal for everything: the "chat" view is a unified conversation
// merging the agent's recorded result, task notes (comments), and live agent
// messages into a single timeline, so a "Needs You" task always shows what the
// agent last said even when no streaming chat history exists on this device.
export function KanbanTaskModal(props: any) {
  const { ChatMarkdown, Check, ChevronDown, ComposerField, KANBAN_COLUMNS, KANBAN_STEER_TARGETS, MessageAttachments, answerKanbanNeedsHuman, attachKanbanSteerDirectory, attachKanbanSteerRecentDirectory, editAndInterruptKanbanTask, formatMessageTimestamp, formatRelativeTime, handleKanbanSteerFileChange, handleKanbanSteerImageChange, kanbanClass, kanbanEditDraft, kanbanEditPendingTaskId, kanbanEventLabel, kanbanAssigneeOptions, kanbanSteerAttachmentError, kanbanSteerAttachmentMenuOpen, kanbanSteerAttachmentMenuRef, kanbanSteerAttachments, kanbanSteerDirectories, kanbanSteerDraft, kanbanSteerFileInputRef, kanbanSteerImageInputRef, kanbanSteerTargetMenuOpen, kanbanSteerTargetMenuRef, kanbanSteerTargetStatus, kanbanSteeringTaskId, kanbanTaskModal, moveKanbanTask, patchKanbanTask, recentDirectories, recentDirectoriesExpanded, recording, removeKanbanSteerAttachment, removeKanbanSteerDirectory, saveKanbanNeedsHumanApiKey, selectedKanbanAgent, selectedKanbanAgentMessages, selectedKanbanComments, selectedKanbanEvents, selectedKanbanTask, setKanbanEditDraft, setKanbanSteerAttachmentMenuOpen, setKanbanSteerDraft, setKanbanSteerTargetMenuOpen, setKanbanSteerTargetStatus, setKanbanTaskModal, setRecentDirectoriesExpanded, startAudioRecording, steerSelectedKanbanTask, stopAudioRecording, voiceBands, voiceTarget, voiceTranscript } = props;
  const portalTarget = typeof document === "undefined" ? null : document.body;
  // Legacy "notes" openers land on the unified conversation too.
  const modal = kanbanTaskModal === "notes" ? "chat" : kanbanTaskModal;
  const task = selectedKanbanTask;
  // Dispatch plumbing in control-plane briefs (routing/worker/machine fields
  // and agent operating boilerplate) is collapsed by default behind a "technical
  // details" toggle. The toggle stores WHICH task it was opened for, so
  // switching tasks resets it without an effect.
  const [briefGuidanceFor, setBriefGuidanceFor] = useState("");
  const showBriefGuidance = Boolean(task) && briefGuidanceFor === task?.id;
  const agent = selectedKanbanAgent;
  const editPending = Boolean(task) && kanbanEditPendingTaskId === task?.id;
  const interrupting = task?.status === "working" && Boolean(agent);

  const commentAuthorLabel = (author: string) => {
    if (author === "queen-bee") return "Queen Bee";
    if (author === "dashboard") return "You";
    return author || "Note";
  };

  const conversation = useMemo(() => {
    if (!task) return [];
    const entries: any[] = [];
    const body = task.body?.trim();
    if (body) {
      // The brief anchors the feed (sorts oldest, at the bottom) so the
      // conversation stands alone without flipping back to the card.
      // Control-plane dispatch briefs parse into a structured layout.
      entries.push({
        id: `brief-${task.id}`,
        kind: "brief",
        author: "Task brief",
        body,
        brief: parseTaskBrief(body),
        at: task.createdAt,
      });
    }
    const result = task.result?.trim();
    if (result) {
      entries.push({
        id: `result-${task.id}`,
        kind: "result",
        author: task.assignee?.trim() || agent?.name || "Agent",
        body: result,
        at: task.completedAt ?? task.updatedAt,
      });
    }
    for (const comment of selectedKanbanComments) {
      entries.push({
        id: comment.id,
        kind: comment.author === "queen-bee" ? "system" : "note",
        author: commentAuthorLabel(comment.author),
        body: comment.body,
        at: comment.createdAt,
      });
    }
    // Structure recorded texts for reading: pull artifact paths into chips and
    // split unformatted walls of text into paragraphs (display only — the
    // stored task data is untouched). Live chat messages pass through as-is.
    for (const entry of entries) {
      if (entry.brief) continue; // structured briefs render themselves
      const { artifacts, remainder } = extractResultArtifacts(entry.body);
      entry.artifactLinks = artifacts;
      entry.body = formatPlainResultBody(remainder);
    }
    selectedKanbanAgentMessages.forEach((message: any, index: number) => {
      entries.push({
        id: `msg-${message.createdAt ?? "x"}-${index}`,
        kind: message.role === "user" ? "user" : "chat",
        author: message.role === "user" ? "You" : agent?.name ?? task.assignee ?? "Agent",
        body: message.content,
        attachments: message.attachments,
        at: message.createdAt ?? 0,
      });
    });
    return entries.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }, [task, agent, selectedKanbanComments, selectedKanbanAgentMessages]);

  const needsHumanAsk = task?.status === "needs-human" ? extractHumanAsk(task.result) : null;

  const openArtifact = async (artifact: any, action: "open" | "reveal") => {
    const response = await fetch("/api/kanban/deliverable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, path: artifact.path }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok || !data?.ok) alert(data?.error || "Could not open that artifact.");
  };

  if (!task || !modal || !portalTarget) return null;

  return createPortal((
    <div
      className={kanbanClass("kanbanModalBackdrop")}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setKanbanTaskModal("");
      }}
    >
      <section className={kanbanClass("kanbanTaskModal", modal === "chat" && "chatModal")} role="dialog" aria-modal="true" aria-labelledby="kanban-task-modal-title">
        <div className={kanbanClass("kanbanModalHeader")}>
          <div>
            <p className="eyebrow">{task.title}</p>
            <h3 id="kanban-task-modal-title">
              {modal === "assign" ? "Assign task" : modal === "chat" ? "Conversation" : modal === "edit" ? (interrupting ? "Edit & interrupt" : "Edit task") : "Task events"}
            </h3>
          </div>
          <CloseIconButton onClick={() => setKanbanTaskModal("")} aria-label="Close task modal" />
        </div>

        {modal === "assign" ? (
          <div className={kanbanClass("kanbanModalBody")}>
            <label>
              Assignee
              <select
                value={task.assignee ?? ""}
                onChange={(event) => patchKanbanTask(task.id, { assignee: event.target.value })}
              >
                <option value="">Unassigned</option>
                {kanbanAssigneeOptions.map((assignee) => <option value={assignee} key={assignee}>{assignee}</option>)}
              </select>
            </label>
            <label>
              Move to
              <select
                value={task.status}
                onChange={(event) => moveKanbanTask(task.id, event.target.value)}
              >
                {KANBAN_COLUMNS.map((column) => <option value={column.id} key={column.id}>{column.title}</option>)}
              </select>
            </label>
          </div>
        ) : null}

        {modal === "edit" ? (
          <form className={kanbanClass("kanbanModalBody", "kanbanEditForm")} onSubmit={editAndInterruptKanbanTask}>
            <label>
              Title
              <input
                value={kanbanEditDraft.title}
                onChange={(event) => setKanbanEditDraft((current) => ({ ...current, title: event.target.value }))}
                disabled={editPending}
              />
            </label>
            <label>
              Task details
              <textarea
                value={kanbanEditDraft.body}
                onChange={(event) => setKanbanEditDraft((current) => ({ ...current, body: event.target.value }))}
                disabled={editPending}
                placeholder="Add context, constraints, or the revised instruction."
              />
            </label>
            <p className={kanbanClass("kanbanEditHint")}>
              {interrupting
                ? `Saving resends the revised task to ${agent?.name ?? "the assigned agent"} and interrupts the current run.`
                : "Saving updates the card. Nothing is sent to an agent until the task is delegated."}
            </p>
            <div className={kanbanClass("kanbanEditActions")}>
              <button type="button" onClick={() => setKanbanTaskModal("")} disabled={editPending}>Cancel</button>
              <button type="submit" disabled={!kanbanEditDraft.title.trim() || editPending}>
                {editPending ? "Sending..." : interrupting ? "Save & interrupt" : "Save changes"}
              </button>
            </div>
          </form>
        ) : null}

        {modal === "chat" ? (
          <div className={`${kanbanClass("kanbanModalBody", "kanbanChatBody")} ${convoClass("convoScrollBody")}`}>
            {needsHumanAsk ? (
              <div className={convoClass("needsYouBanner")} role="status">
                <strong>Needs you</strong>
                <span>{needsHumanAsk.ask}</span>
                <KanbanNeedsHumanPanel
                  key={task.id}
                  ask={needsHumanAsk}
                  onAnswer={(answer) => answerKanbanNeedsHuman(task, answer)}
                  onSaveApiKey={(envKey, value) => saveKanbanNeedsHumanApiKey(task, envKey, value)}
                />
              </div>
            ) : null}
            <form className={`${kanbanClass("kanbanSteerComposer")} ${convoClass("convoComposer")}`} onSubmit={steerSelectedKanbanTask}>
              {agent ? (
                <div className={kanbanClass("kanbanSteerComposerTop")}>
                  <div className={kanbanClass("kanbanSteerTargetWrap")} ref={kanbanSteerTargetMenuRef}>
                    <button
                      type="button"
                      className={kanbanClass("kanbanSteerTargetButton")}
                      onClick={() => setKanbanSteerTargetMenuOpen((current) => !current)}
                      aria-label="Choose where to send this task after the message"
                      aria-expanded={kanbanSteerTargetMenuOpen}
                    >
                      Send to {KANBAN_COLUMNS.find((column) => column.id === kanbanSteerTargetStatus)?.title ?? "Working"}
                      <ChevronDown aria-hidden="true" />
                    </button>
                    {kanbanSteerTargetMenuOpen ? (
                      <div className={kanbanClass("kanbanSteerTargetTooltip")} role="tooltip">
                        <div className={kanbanClass("kanbanSteerTargetMenu")} role="menu" aria-label="Send task to">
                          {KANBAN_STEER_TARGETS.map((column) => (
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={kanbanSteerTargetStatus === column.id}
                              key={column.id}
                              onClick={() => {
                                setKanbanSteerTargetStatus(column.id);
                                setKanbanSteerTargetMenuOpen(false);
                              }}
                            >
                              <span>{column.title}</span>
                              {kanbanSteerTargetStatus === column.id ? <Check aria-hidden="true" /> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <ComposerField
                value={kanbanSteerDraft}
                onChange={setKanbanSteerDraft}
                placeholder={agent ? `Message ${agent.name}...` : "Add a note to this task..."}
                disabled={kanbanSteeringTaskId === task.id}
                busy={kanbanSteeringTaskId === task.id}
                compact
                autoGrow
                attachments={kanbanSteerAttachments}
                directories={kanbanSteerDirectories}
                attachmentError={kanbanSteerAttachmentError}
                attachmentMenuOpen={kanbanSteerAttachmentMenuOpen}
                setAttachmentMenuOpen={setKanbanSteerAttachmentMenuOpen}
                attachmentMenuRef={kanbanSteerAttachmentMenuRef}
                fileInputRef={kanbanSteerFileInputRef}
                imageInputRef={kanbanSteerImageInputRef}
                onFileChange={handleKanbanSteerFileChange}
                onImageChange={handleKanbanSteerImageChange}
                onRemoveAttachment={removeKanbanSteerAttachment}
                onAttachDirectory={() => void attachKanbanSteerDirectory()}
                recentDirectories={recentDirectories}
                recentDirectoriesExpanded={recentDirectoriesExpanded}
                setRecentDirectoriesExpanded={setRecentDirectoriesExpanded}
                onAttachRecentDirectory={attachKanbanSteerRecentDirectory}
                onRemoveDirectory={removeKanbanSteerDirectory}
                recording={recording && voiceTarget === "kanban-steer"}
                voiceBands={voiceBands}
                voiceTranscript={voiceTranscript}
                onToggleRecording={recording ? stopAudioRecording : () => void startAudioRecording("kanban-steer")}
                canSend={Boolean(kanbanSteerDraft.trim() || kanbanSteerAttachments.length || kanbanSteerDirectories.length)}
                submitOnEnter
              />
              {!agent ? (
                <p className={convoClass("convoComposerHint")}>
                  No agent is on this task right now, so messages are saved as task notes. Assign an agent or move the card to Waiting for Queen to hand it off.
                </p>
              ) : null}
            </form>
            <div className={convoClass("convoFeed")}>
              {conversation.map((entry) => (
                <article className={convoClass("convoEntry", entry.kind)} key={entry.id}>
                  <div className={convoClass("convoEntryHead")}>
                    <strong>
                      {entry.author}
                      {entry.kind === "result" ? <span className={convoClass("convoKind")}>Latest update</span> : null}
                      {entry.kind === "note" ? <span className={convoClass("convoKind")}>Note</span> : null}
                      {entry.kind === "brief" ? <span className={convoClass("convoKind")}>Brief</span> : null}
                    </strong>
                    <time>{formatMessageTimestamp(entry.at)}</time>
                  </div>
                  {entry.brief ? (() => {
                    // Agent operating boilerplate stays behind a toggle: count
                    // what would be hidden, then render the human-facing rest.
                    const hiddenCount = entry.brief.sections.reduce((count, section) => {
                      if (isBriefGuidanceSection(section)) return count + 1;
                      return count + section.blocks.reduce((inner, briefBlock) => {
                        if (briefBlock.kind === "prose") return inner + briefBlock.text.split("\n\n").filter(isBriefGuidanceText).length;
                        if (briefBlock.kind === "fields") return inner + briefBlock.fields.filter(isBriefTechnicalField).length;
                        return inner;
                      }, 0);
                    }, 0);
                    return (
                      <div className={convoClass("briefView")}>
                        {entry.brief.sections.map((section, sectionIndex) => {
                          if (!showBriefGuidance && isBriefGuidanceSection(section)) return null;
                          const blocks = section.blocks
                            .map((briefBlock, blockIndex) => {
                              if (briefBlock.kind === "fields") {
                                const fields = showBriefGuidance
                                  ? briefBlock.fields
                                  : briefBlock.fields.filter((field) => !isBriefTechnicalField(field));
                                if (!fields.length) return null;
                                return (
                                  <dl className={convoClass("briefFields")} key={blockIndex}>
                                    {fields.map((field, fieldIndex) => (
                                      <div key={`${field.key}-${fieldIndex}`}>
                                        <dt>{field.key}</dt>
                                        <dd>{field.value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                );
                              }
                              if (briefBlock.kind === "activity") {
                                return (
                                  <ul className={convoClass("briefActivity")} key={blockIndex}>
                                    {briefBlock.items.map((item, itemIndex) => (
                                      <li key={itemIndex}>
                                        <time>{item.date}</time>
                                        <span className={convoClass("briefActivityKind", item.kind.toLowerCase())}>{item.kind}</span>
                                        <span className={convoClass("briefActivityText")}>{item.text}</span>
                                      </li>
                                    ))}
                                  </ul>
                                );
                              }
                              const paragraphs = briefBlock.text.split("\n\n")
                                .filter((paragraph) => showBriefGuidance || !isBriefGuidanceText(paragraph));
                              if (!paragraphs.length) return null;
                              return (
                                <div className={convoClass("briefProse")} key={blockIndex}>
                                  {paragraphs.map((paragraph, paragraphIndex) => (
                                    <p key={paragraphIndex}>{paragraph}</p>
                                  ))}
                                </div>
                              );
                            })
                            .filter(Boolean);
                          if (!blocks.length) return null;
                          return (
                            <section className={convoClass("briefSection")} key={`${entry.id}-section-${sectionIndex}`}>
                              {section.title ? <h4 className={convoClass("briefTitle")}>{section.title}</h4> : null}
                              {blocks}
                            </section>
                          );
                        })}
                        {hiddenCount > 0 ? (
                          <button
                            type="button"
                            className={convoClass("briefGuidanceToggle")}
                            onClick={() => setBriefGuidanceFor(showBriefGuidance ? "" : task.id)}
                            aria-expanded={showBriefGuidance}
                          >
                            {showBriefGuidance ? "Hide technical details" : `Show technical details (${hiddenCount})`}
                          </button>
                        ) : null}
                      </div>
                    );
                  })() : (
                    <ChatMarkdown text={entry.body} className={convoClass("convoBody")} />
                  )}
                  {entry.artifactLinks?.length ? (
                    <div className={convoClass("convoArtifacts")}>
                      {entry.artifactLinks.map((artifact) => (
                        <span className={convoClass("convoArtifact")} key={artifact.path} title={artifact.path}>
                          <code>{artifact.label}</code>
                          <button type="button" onClick={() => void openArtifact(artifact, "open")}>Open</button>
                          <button type="button" onClick={() => void openArtifact(artifact, "reveal")}>Show in folder</button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {entry.attachments?.length ? <MessageAttachments attachments={entry.attachments} /> : null}
                </article>
              ))}
              {conversation.length === 0 ? (
                <p className={convoClass("convoEmpty")}>
                  Nothing here yet. {agent ? `Send ${agent.name} a message above.` : "Add a note above — it stays with the task."}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {modal === "events" ? (
          <div className={kanbanClass("kanbanModalBody")}>
            <div className={`${kanbanClass("kanbanEvents", "modalEvents")} ${convoClass("convoNoScroll")}`}>
              {selectedKanbanEvents.map((event) => (
                <article key={event.id}>
                  <div>
                    <span>{kanbanEventLabel(event.kind)}</span>
                    <time>{formatRelativeTime(event.createdAt)}</time>
                  </div>
                  <p>{event.message}</p>
                </article>
              ))}
              {selectedKanbanEvents.length === 0 ? <p className={kanbanClass("kanbanEmpty")}>No events yet.</p> : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  ), portalTarget);
}
