import { acceptedDocumentExtensions } from "@/lib/services/document-ingestion-capabilities";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export type NativeBrainDropDocument = {
  name: string;
  mimeType: string;
  dataBase64: string;
};

export type NativeBrainDropReadResult = {
  documents: NativeBrainDropDocument[];
  skipped: number;
  truncated: boolean;
};

export async function openNativeBrainDropPaths(kind: "files" | "folders"): Promise<string[] | null> {
  if (!isTauriDesktopRuntime()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: kind === "folders",
    multiple: true,
    title: kind === "folders" ? "Choose folders to feed the brain" : "Choose files to feed the brain",
    ...(kind === "files"
      ? {
          filters: [{
            name: "Brain sources",
            extensions: acceptedDocumentExtensions().map((extension) => extension.slice(1)),
          }],
        }
      : {}),
  });
  if (!selected) return [];
  return (Array.isArray(selected) ? selected : [selected]).filter(Boolean);
}

export async function readNativeBrainDropDocuments(paths: string[]): Promise<NativeBrainDropReadResult> {
  if (!isTauriDesktopRuntime()) throw new Error("Native Brain Drop files require the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<NativeBrainDropReadResult>("read_local_brain_drop_documents", { paths });
}
