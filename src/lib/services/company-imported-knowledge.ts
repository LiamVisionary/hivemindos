import type {
  CompanyImportedKnowledge,
  CompanyImportedKnowledgeDocument,
} from "@/lib/types/company-import";

function trimmed(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizedIsoDate(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function normalizeImportedKnowledgeDocument(value: unknown): CompanyImportedKnowledgeDocument | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CompanyImportedKnowledgeDocument>;
  const id = trimmed(raw.id);
  const sourceName = trimmed(raw.sourceName);
  const relativePath = trimmed(raw.relativePath);
  const title = trimmed(raw.title);
  const format = trimmed(raw.format);
  const sourceSha256 = trimmed(raw.sourceSha256);
  const notePath = trimmed(raw.notePath);
  if (!id || !sourceName || !relativePath || !title || !format || !sourceSha256 || !notePath) return null;
  const sourceBytes = Number(raw.sourceBytes);
  return {
    id,
    sourceName,
    relativePath,
    title,
    format,
    sourceBytes: Number.isFinite(sourceBytes) && sourceBytes >= 0 ? Math.floor(sourceBytes) : 0,
    sourceSha256,
    notePath,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.map(trimmed).filter((item): item is string => Boolean(item)).slice(0, 20)
      : [],
  };
}

export function normalizeImportedKnowledge(value: unknown): CompanyImportedKnowledge | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<CompanyImportedKnowledge>;
  const dataRoomPath = trimmed(raw.dataRoomPath);
  const notesFolder = trimmed(raw.notesFolder);
  if (!dataRoomPath || !notesFolder) return undefined;
  const documents = Array.isArray(raw.documents)
    ? raw.documents.map(normalizeImportedKnowledgeDocument).filter((item): item is CompanyImportedKnowledgeDocument => Boolean(item))
    : [];
  const failedFiles = Array.isArray(raw.failedFiles)
    ? raw.failedFiles.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const sourceName = trimmed((entry as { sourceName?: unknown }).sourceName);
        const error = trimmed((entry as { error?: unknown }).error);
        return sourceName && error ? [{ sourceName, error }] : [];
      })
    : [];
  const totalSourceBytes = Number(raw.totalSourceBytes);
  return {
    source: "data-room",
    importedAt: normalizedIsoDate(raw.importedAt),
    lastDiscoveredAt: normalizedIsoDate(raw.lastDiscoveredAt),
    dataRoomPath,
    notesFolder,
    documents,
    failedFiles,
    totalSourceBytes: Number.isFinite(totalSourceBytes) && totalSourceBytes >= 0 ? Math.floor(totalSourceBytes) : 0,
  };
}
