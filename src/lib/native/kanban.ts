import type { KanbanResponse } from "@/features/dashboard/dashboard-types";
import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export async function readNativeKanban(input: {
  board?: string;
  boardsOnly?: boolean;
  includeBoards?: boolean;
  includeArchived?: boolean;
  tenant?: string;
  assignee?: string;
  query?: string;
  vaultPath?: string;
  kanbanFolder?: string;
}): Promise<KanbanResponse | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<KanbanResponse>("kanban_read", {
      board: input.board,
      boardsOnly: input.boardsOnly,
      includeBoards: input.includeBoards,
      includeArchived: input.includeArchived,
      tenant: input.tenant,
      assignee: input.assignee,
      query: input.query,
      vaultPath: input.vaultPath,
      kanbanFolder: input.kanbanFolder,
    });
  } catch {
    return null;
  }
}
