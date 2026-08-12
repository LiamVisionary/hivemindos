import type { KanbanBoard } from "@/lib/types/kanban";

export function replaceIncomingTaskLinks(
  board: KanbanBoard,
  taskId: string,
  requestedParents: string[],
) {
  if (!Array.isArray(requestedParents)) throw new Error("parents must be an array of task ids.");
  const parentIds = [...new Set(requestedParents.map((parentId) => parentId.trim()).filter(Boolean))];
  const taskIds = new Set(board.tasks.map((task) => task.id));
  if (parentIds.includes(taskId)) throw new Error("A task cannot depend on itself.");
  const missingParent = parentIds.find((parentId) => !taskIds.has(parentId));
  if (missingParent) throw new Error(`Parent task not found: ${missingParent}`);
  const existingLinks = new Map(
    board.links.filter((link) => link.childId === taskId).map((link) => [link.parentId, link]),
  );
  board.links = board.links.filter((link) => link.childId !== taskId);
  const now = Date.now();
  for (const parentId of parentIds) {
    board.links.push(existingLinks.get(parentId) ?? { parentId, childId: taskId, createdAt: now });
  }
}

export function promoteReadyChildren(board: KanbanBoard, kind: string) {
  const now = Date.now();
  const tasksById = new Map(board.tasks.map((task) => [task.id, task]));
  const promotedIds = new Set<string>();
  for (const task of board.tasks) {
    // Needs Human is a later decision/file/access gate, not a dependency wait.
    if (task.status !== "ideas") continue;
    const parents = board.links.filter((link) => link.childId === task.id);
    if (!parents.length) continue;
    const ready = parents.every((link) => {
      const parent = tasksById.get(link.parentId);
      return parent?.status === "done" || parent?.status === "archived";
    });
    if (!ready) continue;
    task.status = "ready";
    task.updatedAt = now;
    task.claimLock = undefined;
    task.claimExpiresAt = undefined;
    task.lastHeartbeatAt = undefined;
    task.currentRunId = undefined;
    promotedIds.add(task.id);
  }
  for (const taskId of promotedIds) {
    const task = tasksById.get(taskId);
    board.events.unshift({
      id: `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      kind,
      message: `Promoted ${task?.title ?? taskId} after parent tasks completed.`,
      createdAt: Date.now(),
    });
  }
  return promotedIds.size;
}
