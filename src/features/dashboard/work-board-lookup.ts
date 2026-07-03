/* work-board-lookup.ts — pure helpers to find and summarize Work Board tasks
 * for prompt contexts. Two consumers: the notification "Discuss" button (which
 * inlines the referenced task's real record so the Queen answers from facts)
 * and the Queen's chat-only `read_work_board` tool. Dependency-free so the
 * hermetic suite drives them directly; fetching stays in the callers.
 */

export type WorkBoardTaskLite = {
  id?: string;
  title?: string;
  status?: string;
  assignee?: string | null;
  priority?: string;
  source?: string | null;
  lastFailureReason?: string | null;
  result?: string | null;
  updatedAt?: number;
  completedAt?: number;
  targetMachine?: { name?: string; key?: string } | null;
};

/**
 * Flatten the /api/kanban GET `columns` payload. Live shape (confirmed against
 * the running route): an ARRAY of `{ id, title, description, tasks: [...] }`
 * lane objects. A lane→tasks map and a bare task array are tolerated too so a
 * shape drift degrades to fewer results, never a silent empty board.
 */
export function flattenKanbanColumns(columns: unknown): WorkBoardTaskLite[] {
  if (!columns || typeof columns !== "object") return [];
  const lanes = Array.isArray(columns) ? columns : Object.values(columns as Record<string, unknown>);
  return lanes
    .flatMap((lane) => {
      if (Array.isArray(lane)) return lane;
      if (!lane || typeof lane !== "object") return [];
      // Anything carrying a `tasks` key is a lane — even a malformed one is
      // never itself a task (lanes also have id/title, so keys alone can't
      // discriminate; `status` does).
      if ("tasks" in lane) {
        const tasks = (lane as { tasks?: unknown }).tasks;
        return Array.isArray(tasks) ? tasks : [];
      }
      return "status" in lane && "id" in lane ? [lane] : [];
    })
    .filter((task): task is WorkBoardTaskLite => Boolean(task && typeof task === "object"));
}

/** Exact id first, then title substring, then loose long-word match. */
export function findWorkBoardTasks(
  tasks: WorkBoardTaskLite[],
  lookup: { taskId?: string; query?: string },
): WorkBoardTaskLite[] {
  const taskId = lookup.taskId?.trim();
  if (taskId) {
    const exact = tasks.filter((task) => task.id === taskId);
    if (exact.length) return exact;
  }
  const query = lookup.query?.trim().toLowerCase();
  if (!query) return [];
  const contains = tasks.filter((task) => (task.title ?? "").toLowerCase().includes(query));
  if (contains.length) return contains;
  const words = query.split(/\s+/).filter((word) => word.length > 3);
  if (!words.length) return [];
  return tasks
    .map((task) => {
      const title = (task.title ?? "").toLowerCase();
      return { task, hits: words.filter((word) => title.includes(word)).length };
    })
    .filter(({ hits }) => hits >= Math.ceil(words.length / 2))
    .sort((a, b) => b.hits - a.hits)
    .map(({ task }) => task);
}

const snippet = (value: string | null | undefined, max = 320) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** One task as a compact fact block a model can reason over. */
export function formatWorkBoardTaskForPrompt(task: WorkBoardTaskLite): string {
  const when = (ms?: number) => (ms ? new Date(ms).toISOString() : "");
  return [
    `Task ${task.id ?? "?"}: ${task.title ?? "(untitled)"}`,
    `Status: ${task.status ?? "?"}${task.status === "needs-human" ? " (blocked on the user)" : ""}`,
    task.assignee ? `Assignee: ${task.assignee}` : null,
    task.priority ? `Priority: ${task.priority}` : null,
    task.targetMachine?.name || task.targetMachine?.key ? `Target machine: ${task.targetMachine.name ?? task.targetMachine.key}` : null,
    task.lastFailureReason ? `Last failure: ${snippet(task.lastFailureReason)}` : null,
    snippet(task.result) ? `Latest result: ${snippet(task.result)}` : null,
    task.updatedAt ? `Updated: ${when(task.updatedAt)}` : null,
    task.completedAt ? `Completed: ${when(task.completedAt)}` : null,
  ].filter(Boolean).join("\n");
}

/** Board totals by status — the no-arguments answer for `read_work_board`. */
export function summarizeWorkBoardByStatus(tasks: WorkBoardTaskLite[]): string {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const status = task.status ?? "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort(([, a], [, b]) => b - a).map(([status, count]) => `${status}: ${count}`);
  return `Work Board totals — ${parts.join(", ") || "empty"} (${tasks.length} tasks).`;
}
