#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/features/dashboard/hooks/use-kanban-dispatch-controller.tsx", import.meta.url),
  "utf8",
);
const taskControllerSource = await readFile(
  new URL("../src/features/dashboard/hooks/use-kanban-task-controller.tsx", import.meta.url),
  "utf8",
);
const confirmSource = await readFile(
  new URL("../src/lib/utils/confirm-user-action.ts", import.meta.url),
  "utf8",
);

assert(
  source.includes("markKanbanTaskNeedsHumanFromDashboardDispatch"),
  "Dashboard dispatch failures must go through the stale-owner guard before moving cards to Needs You.",
);

assert(
  source.includes('startsWith("queen-bee-autonomous:")'),
  "Dashboard dispatch failures must not mark cards Needs You while Queen Bee autonomous pickup owns the claim.",
);

assert(
  /if \(options\.leaveKanbanOpen\) \{\s*return \{ ok: false, message \};\s*\}/m.test(source),
  "Retry orchestration must receive ok:false without a Needs You patch when leaveKanbanOpen is set.",
);

assert(
  !/if \(task\.targetMachine\?\.key\) \{\s*await patchKanbanTask\(task\.id, \{\s*status: "needs-human"/m.test(source),
  "Target-machine dispatch failures must not bypass the stale-owner guard.",
);

assert(
  (source.match(/markKanbanTaskNeedsHumanFromDashboardDispatch\(/g) ?? []).length >= 4,
  "All dashboard dispatch/session stall Needs You writes should use the stale-owner guard.",
);

assert(
  source.includes("patchKanbanTaskFromOwnedDispatch")
  && source.includes('logClientTelemetry("kanban.dispatch.patch_skipped_stale_owner"')
  && (source.match(/patchKanbanTaskFromOwnedDispatch\(task, agent/g) ?? []).length >= 7,
  "Dashboard dispatch completion/session writes must re-read ownership before stale closures can move cards back to Working or Done.",
);

assert(
  taskControllerSource.includes("function stopLocalKanbanTaskActivity")
  && taskControllerSource.includes("kanbanReadyPickupInFlightRef.current.delete(taskId)")
  && taskControllerSource.includes("kanbanReadyPickupAttemptRef.current.delete(taskId)")
  && taskControllerSource.includes("stopLocalKanbanTaskActivity(taskId, status, currentTask, { notify: true })")
  && taskControllerSource.includes('stopLocalKanbanTaskActivity(task.id, "archived", task)'),
  "Manual Kanban moves/deletes must clear local streams, pickup previews, and retry bookkeeping before stale automation can snap cards back.",
);

assert(
  confirmSource.includes("confirmWithInlineDialog")
  && confirmSource.includes("window.confirm(message)")
  && confirmSource.includes('role", "alertdialog"')
  && !confirmSource.includes("Could not open confirmation dialog."),
  "confirmUserAction must fall back to an inline confirmation dialog when the native/browser confirm bridge throws.",
);

console.log("Kanban dispatch reroute guard tests passed.");
