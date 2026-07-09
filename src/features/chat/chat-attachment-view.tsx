"use client";

import { FileText } from "lucide-react";

import chatStyles from "@/app/chat.module.css";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { imageAttachmentPreviewSrc } from "@/features/chat/chat-file-references";
import { attachmentDetailLabel, attachmentKindLabel, attachmentReferenceTarget } from "@/features/chat/chat-formatters";
import { ImageAttachmentThumbnail } from "@/features/chat/image-attachment-preview";
import previewStyles from "@/features/chat/image-attachment-preview.module.css";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { KanbanTaskAttachment } from "@/lib/types/kanban";

const chatClass = createStyleClass(chatStyles);

/**
 * Where a chat attachment is being rendered:
 * - `composer`  — the composer tray (compact tile, removable pill fallback).
 * - `message`   — a sent chat bubble (aspect-preserved thumb, name-chip fallback).
 * - `gallery`   — the Kanban message list (captioned thumb, audio/file/reference fallback).
 */
export type ChatAttachmentSurface = "composer" | "message" | "gallery";

type ChatAttachmentLike = KanbanTaskAttachment & { label?: string };

const MESSAGE_CHIP_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid var(--line-2)",
  borderRadius: 8,
  background: "var(--panel-2)",
  color: "var(--fg-3)",
  fontFamily: "var(--f-mono)",
  fontSize: 10.5,
  padding: "3px 9px",
} as const;

/**
 * The single source of truth for rendering one chat attachment across the
 * composer, the message thread, and the Kanban message gallery. Images (by
 * kind, mime, or extension — via `imageAttachmentPreviewSrc`) always render as
 * the shared `ImageAttachmentThumbnail`; non-images fall back per surface.
 */
export function ChatAttachmentView({
  attachment,
  surface,
  onRemove,
  removeDisabled,
}: {
  attachment: ChatAttachmentLike;
  surface: ChatAttachmentSurface;
  onRemove?: (id: string) => void;
  removeDisabled?: boolean;
}) {
  const name = attachment.name ?? attachment.label ?? "Attachment";
  const previewSrc = imageAttachmentPreviewSrc(attachment);

  if (previewSrc) {
    const thumbnail = (
      <ImageAttachmentThumbnail
        src={previewSrc}
        alt={name}
        variant={surface === "composer" ? "composer" : "message"}
        onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
        removeDisabled={removeDisabled}
      />
    );
    if (surface === "gallery") {
      return (
        <figure className={previewStyles.captioned}>
          {thumbnail}
          <figcaption className={previewStyles.caption}>{name}</figcaption>
        </figure>
      );
    }
    return thumbnail;
  }

  if (surface === "composer") {
    return (
      <div className={chatClass("attachmentPill")}>
        <span>{attachmentKindLabel(attachment)}</span>
        <strong>{name}</strong>
        <small>{attachmentDetailLabel(attachment)}</small>
        {onRemove ? (
          <CloseIconButton size="sm" aria-label={`Remove ${name}`} onClick={() => onRemove(attachment.id)} disabled={removeDisabled} />
        ) : null}
      </div>
    );
  }

  if (surface === "gallery") {
    return (
      <figure className={chatClass("messageAttachment", attachment.kind)}>
        {attachment.kind === "audio" && attachment.dataUrl ? (
          <audio src={attachment.dataUrl} controls preload="metadata" />
        ) : attachment.dataUrl ? (
          <a href={attachment.dataUrl} download={name}>
            <FileText aria-hidden="true" />
            {name}
          </a>
        ) : (
          <div className={chatClass("messageAttachmentReference")}>
            <FileText aria-hidden="true" />
            <span>{attachmentReferenceTarget(attachment)}</span>
          </div>
        )}
        <figcaption>{name}</figcaption>
      </figure>
    );
  }

  // message (sent chat bubble) — compact name chip.
  return (
    <span style={MESSAGE_CHIP_STYLE}>
      <FileText aria-hidden="true" />
      {name}
    </span>
  );
}

/** Kanban message attachment list — a thin wrapper over the shared renderer. */
export function MessageAttachments({ attachments }: { attachments?: ChatAttachmentLike[] }) {
  if (!attachments?.length) return null;
  return (
    <div className={chatClass("messageAttachments")}>
      {attachments.map((attachment) => (
        <ChatAttachmentView key={attachment.id} attachment={attachment} surface="gallery" />
      ))}
    </div>
  );
}
