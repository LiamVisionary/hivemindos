export type DocumentCapability = {
  extension: string;
  kind: "document" | "spreadsheet" | "presentation" | "ebook" | "archive" | "text";
  label: string;
  mimeTypes: readonly string[];
};

export const DOCUMENT_INGESTION_CAPABILITIES: readonly DocumentCapability[] = [
  { extension: ".md", kind: "text", label: "Markdown", mimeTypes: ["text/markdown"] },
  { extension: ".markdown", kind: "text", label: "Markdown", mimeTypes: ["text/markdown"] },
  { extension: ".txt", kind: "text", label: "Plain text", mimeTypes: ["text/plain"] },
  { extension: ".csv", kind: "spreadsheet", label: "CSV", mimeTypes: ["text/csv"] },
  { extension: ".json", kind: "text", label: "JSON", mimeTypes: ["application/json"] },
  { extension: ".xml", kind: "text", label: "XML", mimeTypes: ["application/xml", "text/xml"] },
  { extension: ".html", kind: "document", label: "HTML", mimeTypes: ["text/html"] },
  { extension: ".htm", kind: "document", label: "HTML", mimeTypes: ["text/html"] },
  { extension: ".pdf", kind: "document", label: "PDF", mimeTypes: ["application/pdf"] },
  { extension: ".docx", kind: "document", label: "Word", mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  { extension: ".pptx", kind: "presentation", label: "PowerPoint", mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
  { extension: ".xlsx", kind: "spreadsheet", label: "Excel", mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  { extension: ".xls", kind: "spreadsheet", label: "Excel", mimeTypes: ["application/vnd.ms-excel"] },
  { extension: ".epub", kind: "ebook", label: "EPUB", mimeTypes: ["application/epub+zip"] },
  { extension: ".msg", kind: "document", label: "Outlook message", mimeTypes: ["application/vnd.ms-outlook"] },
  { extension: ".zip", kind: "archive", label: "ZIP archive", mimeTypes: ["application/zip"] },
] as const;

const CAPABILITY_BY_EXTENSION = new Map(
  DOCUMENT_INGESTION_CAPABILITIES.map((capability) => [capability.extension, capability]),
);

export function documentCapabilityFor(name: string): DocumentCapability | null {
  const normalized = name.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  const extension = dot >= 0 ? normalized.slice(dot) : "";
  return CAPABILITY_BY_EXTENSION.get(extension) ?? null;
}

export function acceptedDocumentExtensions(): string[] {
  return DOCUMENT_INGESTION_CAPABILITIES.map((capability) => capability.extension);
}

export const DOCUMENT_INGESTION_ACCEPT = acceptedDocumentExtensions().join(",");
