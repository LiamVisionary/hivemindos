import type { KanbanBoard, KanbanColumnGroup, KanbanStatus, KanbanTask } from "@/lib/types/kanban";
import { KANBAN_COLUMNS } from "@/lib/types/kanban";

export function groupKanbanTasks(tasks: KanbanTask[], includeArchived = false): KanbanColumnGroup[] {
  const visibleColumns = includeArchived
    ? KANBAN_COLUMNS
    : KANBAN_COLUMNS.filter((column) => column.id !== "archived");

  return visibleColumns.map((column) => ({
    ...column,
    tasks: tasks
      .filter((task) => task.status === column.id)
      .sort((a, b) => {
        const priorityDelta = priorityWeight(b.priority) - priorityWeight(a.priority);
        return priorityDelta || b.updatedAt - a.updatedAt;
      }),
  }));
}

export function filterKanbanTasks(
  board: KanbanBoard,
  filters: { tenant?: string; assignee?: string; query?: string; includeArchived?: boolean },
) {
  const query = filters.query?.trim().toLowerCase();
  return board.tasks.filter((task) => {
    if (!filters.includeArchived && task.status === "archived") return false;
    if (filters.tenant && task.tenant !== filters.tenant) return false;
    if (filters.assignee && task.assignee !== filters.assignee) return false;
    if (!query) return true;
    return [task.title, task.body, task.result, task.assignee, task.tenant]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

export function activeKanbanTaskCount(tasks: KanbanTask[]) {
  return tasks.filter((task) => task.status !== "done" && task.status !== "archived").length;
}

export function moveTaskBetweenColumns(tasks: KanbanTask[], taskId: string, toStatus: KanbanStatus) {
  const now = Date.now();
  return tasks.map((task) => (
    task.id === taskId
      ? {
        ...task,
        status: toStatus,
        updatedAt: now,
        completedAt: toStatus === "done" ? now : undefined,
      }
      : task
  ));
}

export function priorityWeight(priority: KanbanTask["priority"]) {
  return { low: 0, normal: 1, high: 2, urgent: 3 }[priority] ?? 1;
}
