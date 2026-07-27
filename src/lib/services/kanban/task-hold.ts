import type { KanbanTask } from "@/lib/types/kanban";
import {
  event,
  readBoard,
  touch,
  withBoardMutation,
  writeBoard,
  type KanbanStorageOptions,
} from "@/lib/services/kanban/local-kanban-store";

/**
 * Sticky-hold ("park this") operations for needs-human tasks. Lives outside the
 * oversized local-kanban-store.ts (size ratchet) but reuses its board
 * read/write/lock helpers so a hold is a normal locked board mutation.
 *
 * A parked task KEEPS status needs-human (so nothing re-routes it) but is
 * stamped `held`, which the re-ask guards filter out: it leaves the approval
 * grid, stops pinging external channels, and stops counting toward the
 * autonomy-pause threshold — so a deferred pile can't wedge the company at
 * paused. `clearHold` is called on the answer path so a real decision
 * supersedes the park.
 */
export async function holdTask(
  slug: string | null,
  taskId: string,
  input: { by?: string; note?: string } = {},
  options: KanbanStorageOptions = {},
) {
  return withBoardMutation(slug, options, async () => {
    const board = await readBoard(slug, options);
    const task = board.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error("Task not found.");
    if (task.status !== "needs-human")
      throw new Error(`Task is '${task.status}'; hold only applies to Needs You tasks.`);
    const now = Date.now();
    const by = input.by?.trim() || "dashboard";
    const note = input.note?.trim() || undefined;
    const changed: KanbanTask = {
      ...task,
      held: { at: now, by, ...(note ? { note } : {}) },
      updatedAt: now,
    };
    board.tasks = board.tasks.map((item) => (item.id === taskId ? changed : item));
    board.events.unshift(
      event("task.held", `${by === "dashboard" ? "You" : by} parked ${task.title}`, taskId, note ? { note } : {}),
    );
    await writeBoard(touch(board), options);
    return { board, task: changed };
  });
}

/**
 * Clear a task's `held` marker (a real answer/decision supersedes the park).
 * A no-op when the task isn't held, so it's safe to call unconditionally after
 * answering. Never changes status.
 */
export async function clearHold(
  slug: string | null,
  taskId: string,
  options: KanbanStorageOptions = {},
) {
  return withBoardMutation(slug, options, async () => {
    const board = await readBoard(slug, options);
    const task = board.tasks.find((item) => item.id === taskId);
    if (!task || !task.held) return { board, task: task ?? null };
    const changed: KanbanTask = { ...task, held: undefined, updatedAt: Date.now() };
    board.tasks = board.tasks.map((item) => (item.id === taskId ? changed : item));
    await writeBoard(touch(board), options);
    return { board, task: changed };
  });
}
