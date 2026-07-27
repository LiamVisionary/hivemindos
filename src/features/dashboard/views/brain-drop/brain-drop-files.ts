import { documentCapabilityFor } from "@/lib/services/document-ingestion-capabilities";

export const BRAIN_DROP_MAX_FILES = 20;
export const BRAIN_DROP_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const BRAIN_DROP_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export type BrainDropDocument = {
  file: File;
  sourceName: string;
};

type BrowserFileEntry = {
  isFile: true;
  isDirectory: false;
  name: string;
  file: (resolve: (file: File) => void, reject?: (error: DOMException) => void) => void;
};

type BrowserDirectoryReader = {
  readEntries: (
    resolve: (entries: BrowserFileSystemEntry[]) => void,
    reject?: (error: DOMException) => void,
  ) => void;
};

type BrowserDirectoryEntry = {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader: () => BrowserDirectoryReader;
};

export type BrowserFileSystemEntry = BrowserFileEntry | BrowserDirectoryEntry;

function cleanSourceName(value: string) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
    .slice(0, 240);
}

function fileFromEntry(entry: BrowserFileEntry) {
  return new Promise<File>((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryBatch(reader: BrowserDirectoryReader) {
  return new Promise<BrowserFileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
}

async function readAllDirectoryEntries(entry: BrowserDirectoryEntry) {
  const reader = entry.createReader();
  const entries: BrowserFileSystemEntry[] = [];
  while (true) {
    const batch = await readDirectoryBatch(reader);
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}

async function documentsFromEntry(entry: BrowserFileSystemEntry, parentPath: string): Promise<BrainDropDocument[]> {
  const sourceName = cleanSourceName([parentPath, entry.name].filter(Boolean).join("/"));
  if (entry.isFile) {
    return [{ file: await fileFromEntry(entry), sourceName }];
  }
  const children = await readAllDirectoryEntries(entry);
  const nested = await Promise.all(children.map((child) => documentsFromEntry(child, sourceName)));
  return nested.flat();
}

export async function documentsFromFileSystemEntries(entries: BrowserFileSystemEntry[]) {
  const documents = await Promise.all(entries.map((entry) => documentsFromEntry(entry, "")));
  return documents.flat();
}

export function documentsFromFileList(files: FileList | File[]) {
  return Array.from(files).map((file) => ({
    file,
    sourceName: cleanSourceName(file.webkitRelativePath || file.name),
  }));
}

export async function documentsFromDataTransfer(dataTransfer: DataTransfer) {
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => (item as unknown as {
      webkitGetAsEntry?: () => BrowserFileSystemEntry | null;
    }).webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is BrowserFileSystemEntry => Boolean(entry));
  return entries.length
    ? documentsFromFileSystemEntries(entries)
    : documentsFromFileList(dataTransfer.files);
}

export function prepareBrainDropDocuments(candidates: BrainDropDocument[]) {
  const documents: BrainDropDocument[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const sourceName = cleanSourceName(candidate.sourceName || candidate.file.name);
    const identity = `${sourceName}\u0000${candidate.file.size}\u0000${candidate.file.lastModified}`;
    if (
      !sourceName
      || seen.has(identity)
      || !documentCapabilityFor(sourceName)
      || candidate.file.size <= 0
      || candidate.file.size > BRAIN_DROP_MAX_FILE_BYTES
      || documents.length >= BRAIN_DROP_MAX_FILES
      || totalBytes + candidate.file.size > BRAIN_DROP_MAX_TOTAL_BYTES
    ) {
      skipped += 1;
      continue;
    }
    seen.add(identity);
    documents.push({ file: candidate.file, sourceName });
    totalBytes += candidate.file.size;
  }
  return { documents, skipped, totalBytes };
}

export function arrayBufferToBase64(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}
