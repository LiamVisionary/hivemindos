import { listNativeLocalDirectories } from "@/lib/native/filesystem";

type FileReferenceKind = "file" | "directory";
type FileWithReferenceMetadata = File & {
  path?: string;
  referenceKind?: FileReferenceKind;
};
type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => { isDirectory?: boolean } | null;
};

function basenameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || "Dropped file";
}

function annotateFileReferenceKind(file: File, referenceKind: FileReferenceKind) {
  Object.defineProperty(file, "referenceKind", { value: referenceKind, configurable: true });
  return file as FileWithReferenceMetadata;
}

function fileReferenceFromPath(path: string, referenceKind: FileReferenceKind = "file") {
  const cleanPath = path.trim();
  if (!cleanPath) return null;
  const file = new File([], basenameFromPath(cleanPath), {
    type: referenceKind === "directory" ? "inode/directory" : "application/octet-stream",
  }) as FileWithReferenceMetadata;
  Object.defineProperty(file, "path", { value: cleanPath, configurable: true });
  return annotateFileReferenceKind(file, referenceKind);
}

function fileFromReferenceText(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "file:") return null;
    return fileReferenceFromPath(decodeURIComponent(parsed.pathname));
  } catch {
    return trimmed.startsWith("/") || trimmed.startsWith("~/")
      ? fileReferenceFromPath(trimmed)
      : null;
  }
}

export function filesFromDataTransfer(dataTransfer: DataTransfer) {
  const fileItems = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file");
  const directFiles = Array.from(dataTransfer.files ?? []).map((file, index) => {
    const entry = (fileItems[index] as DataTransferItemWithEntry | undefined)?.webkitGetAsEntry?.();
    return annotateFileReferenceKind(file, entry?.isDirectory ? "directory" : "file");
  });
  if (directFiles.length) return directFiles;
  const itemFiles = fileItems
    .map((item) => {
      const file = item.getAsFile();
      if (!file) return null;
      const entry = (item as DataTransferItemWithEntry).webkitGetAsEntry?.();
      return annotateFileReferenceKind(file, entry?.isDirectory ? "directory" : "file");
    })
    .filter((file): file is File => Boolean(file));
  if (itemFiles.length) return itemFiles;
  const textReferences = [
    dataTransfer.getData("text/uri-list"),
    dataTransfer.getData("text/plain"),
  ].filter(Boolean).join("\n");
  return textReferences
    .split(/\r?\n/)
    .map(fileFromReferenceText)
    .filter((file): file is File => Boolean(file));
}

async function fileReferenceKindFromPath(path: string): Promise<FileReferenceKind> {
  const listing = await listNativeLocalDirectories({ path });
  return listing ? "directory" : "file";
}

export async function filesFromReferencePaths(paths: string[]) {
  const files = await Promise.all(Array.from(new Set(paths))
    .map((path) => path.trim())
    .filter(Boolean)
    .map(async (path) => fileReferenceFromPath(path, await fileReferenceKindFromPath(path))));
  return files.filter((file): file is File => Boolean(file));
}
