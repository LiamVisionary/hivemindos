import type { KanbanTaskAttachment } from "@/lib/types/kanban";

type FileWithReferencePath = File & {
  path?: string;
  webkitRelativePath?: string;
};

function basename(path: string) {
  return path.split("/").filter(Boolean).at(-1) || "";
}

function createFileReferenceAttachment(file: File): KanbanTaskAttachment {
  const source = file as FileWithReferencePath;
  const referencePath = String(source.path || source.webkitRelativePath || "").trim();
  return {
    id: `file-ref-${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
    kind: "file",
    name: file.name || basename(referencePath) || "Dropped file",
    mimeType: file.type || "application/octet-stream",
    size: Number(file.size) || 0,
    dataUrl: "",
    referencePath: referencePath || undefined,
    referenceOnly: true,
    lastModified: Number(file.lastModified) || undefined,
  };
}

export function createFileReferenceAttachments(files: FileList | File[]) {
  return Array.from(files).map(createFileReferenceAttachment);
}
