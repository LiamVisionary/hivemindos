import { linkedDirectoryLabel } from "@/features/chat/chat-formatters";
import type { KanbanLinkedDirectory, KanbanTaskAttachment } from "@/lib/types/kanban";

export function linkedDirectoryMessageAttachment(directory: KanbanLinkedDirectory, index = 0): KanbanTaskAttachment {
  const label = linkedDirectoryLabel(directory).trim();
  const name = directory.name?.trim() || directory.path?.trim() || label || "Linked directory";
  return {
    id: `linked-directory-${directory.id || directory.path || name}-${index}`,
    kind: "file",
    name,
    mimeType: "inode/directory",
    size: 0,
    dataUrl: "",
    referencePath: directory.path?.trim() || label || name,
    referenceKind: "directory",
    referenceOnly: true,
    lastModified: directory.lastUsedAt,
  };
}

export function linkedDirectoriesToChatAttachments(directories: KanbanLinkedDirectory[] = []): KanbanTaskAttachment[] {
  return directories.map((directory, index) => linkedDirectoryMessageAttachment(directory, index));
}

export function messageVisibleAttachments(
  attachments: KanbanTaskAttachment[] = [],
  directories: KanbanLinkedDirectory[] = [],
): KanbanTaskAttachment[] {
  return [...attachments, ...linkedDirectoriesToChatAttachments(directories)];
}
