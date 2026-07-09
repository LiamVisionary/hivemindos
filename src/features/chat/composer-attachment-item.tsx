"use client";

import chatStyles from "@/app/chat.module.css";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { imageAttachmentPreviewSrc } from "@/features/chat/chat-file-references";
import { attachmentDetailLabel, attachmentKindLabel } from "@/features/chat/chat-formatters";
import { ImageAttachmentThumbnail } from "@/features/chat/image-attachment-preview";
import { createStyleClass } from "@/features/dashboard/style-classes";
import type { KanbanTaskAttachment } from "@/lib/types/kanban";

const chatClass = createStyleClass(chatStyles);

/**
 * One item in the chat composer's attachment tray: an image renders as a
 * clickable thumbnail (with a corner remove button); everything else keeps the
 * icon/name/detail pill.
 */
export function ComposerAttachmentItem({
  attachment,
  disabled,
  onRemove,
}: {
  attachment: KanbanTaskAttachment;
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  const previewSrc = imageAttachmentPreviewSrc(attachment);
  if (previewSrc) {
    return (
      <ImageAttachmentThumbnail
        src={previewSrc}
        alt={attachment.name}
        variant="composer"
        onRemove={() => onRemove(attachment.id)}
        removeDisabled={disabled}
      />
    );
  }
  return (
    <div className={chatClass("attachmentPill")}>
      <span>{attachmentKindLabel(attachment)}</span>
      <strong>{attachment.name}</strong>
      <small>{attachmentDetailLabel(attachment)}</small>
      <CloseIconButton size="sm" aria-label={`Remove ${attachment.name}`} onClick={() => onRemove(attachment.id)} disabled={disabled} />
    </div>
  );
}
